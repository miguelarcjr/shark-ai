import { ChatMessage } from '../workflow/history-manager.js';
import { EmbeddingService } from '../workflow/embedding-service.js';
import { encode } from 'gpt-tokenizer';
import * as path from 'path';

function countTokens(text: string): number {
    if (!text) return 0;
    return encode(text).length;
}

function parseAssistantInfo(content: string): { thought: string; summary: string; action: any } {
    try {
        const parsed = JSON.parse(content);
        return {
            thought: parsed.thought || '',
            summary: parsed.summary || '',
            action: parsed.action || null
        };
    } catch {
        return { thought: '', summary: content, action: null };
    }
}

function generateSignatures(content: string): string {
    const lines = content.split('\n');
    let signatureText = '';
    let braceCount = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('import ') || trimmed.startsWith('export {') || trimmed.startsWith('export default')) {
            signatureText += line + '\n';
            continue;
        }
        if (
            trimmed.includes('class ') || 
            trimmed.includes('interface ') || 
            trimmed.includes('function ') || 
            trimmed.includes('constructor') ||
            (trimmed.includes('public ') && (trimmed.includes('(') || trimmed.includes('=>'))) ||
            (trimmed.includes('private ') && (trimmed.includes('(') || trimmed.includes('=>'))) ||
            (trimmed.includes('export ') && (trimmed.includes('class ') || trimmed.includes('interface ') || trimmed.includes('function ')))
        ) {
            if (braceCount === 0) {
                signatureText += line + '\n';
            }
        }
        
        for (const char of line) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
        }
    }
    return signatureText.trim() || 'No signatures found.';
}

export function generateAbstract(msg: ChatMessage): string {
    if (msg.role === 'assistant') {
        const info = parseAssistantInfo(msg.content);
        return JSON.stringify({
            thought: info.thought,
            summary: info.summary,
            action: info.action ? { type: info.action.type, path: info.action.path } : null
        });
    }

    // User / Tool output
    const content = msg.content;
    if (content.startsWith('[Action read_file(')) {
        const parts = content.split('Success]:\n');
        if (parts.length > 1) {
            const header = parts[0] + 'Success (Signatures/Abstract)]:\n';
            const fileContent = parts.slice(1).join('Success]:\n');
            
            // Determine file extension
            const pathMatch = content.match(/read_file\(([^)]+)\)/);
            const filePath = pathMatch ? pathMatch[1] : '';
            const ext = path.extname(filePath).toLowerCase();

            if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
                return header + generateSignatures(fileContent);
            } else {
                // Non-code files: size + line count + first 10 lines
                const lines = fileContent.split('\n');
                const head = lines.slice(0, 10).join('\n');
                const meta = `[File Metadata: ${lines.length} lines, ${content.length} chars]\n`;
                return header + meta + head + (lines.length > 10 ? '\n... [TRUNCATED] ...' : '');
            }
        }
    }

    if (content.startsWith('[Action run_command(')) {
        const lines = content.split('\n');
        const header = lines[0];
        if (lines.length > 5) {
            const body = lines.slice(1, 5).join('\n');
            return `${header}\n${body}\n... [OUTPUT TRUNCATED] ...`;
        }
    }

    // Default fallback: first line or small summary
    const lines = content.split('\n');
    if (lines.length > 3) {
        return lines.slice(0, 3).join('\n') + '\n... [TRUNCATED] ...';
    }
    return content;
}

export async function orchestrateContext(
    rawHistory: ChatMessage[],
    currentPrompt: string,
    compactionTokenLimit: number
): Promise<ChatMessage[]> {
    if (rawHistory.length <= 2) {
        return rawHistory;
    }

    const totalRawTokens = rawHistory.reduce((sum, msg) => sum + countTokens(msg.content), 0);
    const budgetCeiling = Math.floor(0.80 * compactionTokenLimit);
    if (totalRawTokens <= budgetCeiling) {
        return rawHistory;
    }

    // 1. Query Composition
    const firstUserMsg = rawHistory.find(m => m.role === 'user');
    let lastThoughts = '';
    const lastAssistantTurn = [...rawHistory].reverse().find(m => m.role === 'assistant');
    if (lastAssistantTurn) {
        const info = parseAssistantInfo(lastAssistantTurn.content);
        lastThoughts = info.thought || info.summary || '';
    }
    const queryStr = `${firstUserMsg?.content || ''} ${lastThoughts} ${currentPrompt}`.trim();

    // 2. Score intermediate turns
    const systemMsg = rawHistory[0];
    const lastTurn = rawHistory[rawHistory.length - 1]; // T-1
    const intermediateTurns = rawHistory.slice(1, rawHistory.length - 1);

    const embeddingService = new EmbeddingService();
    const turnTexts = intermediateTurns.map(t => {
        if (t.role === 'assistant') {
            const info = parseAssistantInfo(t.content);
            return `Thought: ${info.thought} Summary: ${info.summary} Action: ${JSON.stringify(info.action)}`;
        }
        return t.content;
    });

    const rawScores = embeddingService.scoreDocumentsBM25(queryStr, turnTexts);
    const maxScore = Math.max(...rawScores, 0.0001);
    const normalizedScores = rawScores.map(score => {
        if (maxScore < 0.5) return score; // Do not upscale if the highest score is extremely low noise
        return score / maxScore;
    });

    // 3. Candidate State Classification (Before Budgeting)
    const classifiedCandidates = intermediateTurns.map((turn, idx) => {
        const nScore = normalizedScores[idx];
        return {
            turn,
            idx,
            nScore,
            isRawCandidate: nScore > 0.50,
            isAbstractCandidate: nScore >= 0.20 && nScore <= 0.50,
            tokenEstimate: countTokens(turn.content)
        };
    });

    // 4. Physical Token Budget Enforcement
    let remainingBudget = budgetCeiling;

    // Deduct pinned messages (Turn 0 and Turn T-1)
    remainingBudget -= countTokens(systemMsg.content);
    remainingBudget -= countTokens(lastTurn.content);

    // Sort RAW candidates by score (descending) and recency (descending)
    const rawCandidates = classifiedCandidates
        .filter(c => c.isRawCandidate)
        .sort((a, b) => {
            if (Math.abs(a.nScore - b.nScore) > 0.0001) {
                return b.nScore - a.nScore; // Higher score first
            }
            return b.idx - a.idx; // More recent first
        });

    const rawIndices = new Set<number>();
    for (const cand of rawCandidates) {
        if (cand.tokenEstimate <= remainingBudget) {
            rawIndices.add(cand.idx);
            remainingBudget -= cand.tokenEstimate;
        } else {
            // Downgrade due to budget constraints
            cand.isRawCandidate = false;
            cand.isAbstractCandidate = cand.nScore >= 0.20;
        }
    }

    // 5. Construct Final Orchestrated History
    const orchestrated: ChatMessage[] = [];
    orchestrated.push(systemMsg);

    for (let i = 0; i < intermediateTurns.length; i++) {
        const turn = intermediateTurns[i];
        if (rawIndices.has(i)) {
            orchestrated.push(turn);
        } else {
            const cand = classifiedCandidates[i];
            if (cand.isAbstractCandidate) {
                orchestrated.push({
                    role: turn.role,
                    content: generateAbstract(turn)
                });
            }
            // If drop (score < 0.20), it is not pushed to orchestrated history
        }
    }

    orchestrated.push(lastTurn);
    return orchestrated;
}
