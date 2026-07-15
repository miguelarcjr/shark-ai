import { ChatMessage } from '../workflow/history-manager.js';
import { EmbeddingService } from '../workflow/embedding-service.js';
import { encode } from 'gpt-tokenizer';
import * as path from 'path';
import { parse, Lang } from '@ast-grep/napi';

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

function formatClassNode(classNode: any, isExported: boolean): string {
    const fullText = classNode.text();
    const braceIdx = fullText.indexOf('{');
    const header = braceIdx !== -1 ? fullText.substring(0, braceIdx).trim() : fullText;
    let result = (isExported ? 'export ' : '') + header + ' {\n';

    const lastChild = classNode.child(classNode.children().length - 1);
    if (lastChild && lastChild.kind() === 'class_body') {
        for (const member of lastChild.children()) {
            if (member.kind() === 'method_definition') {
                const mText = member.text();
                const mBrace = mText.indexOf('{');
                const mHeader = mBrace !== -1 ? mText.substring(0, mBrace).trim() : mText;
                result += `  ${mHeader};\n`;
            }
        }
    }
    result += '}';
    return result;
}

function formatFunctionNode(funcNode: any, isExported: boolean): string {
    const text = funcNode.text();
    const braceIdx = text.indexOf('{');
    const header = braceIdx !== -1 ? text.substring(0, braceIdx).trim() : text;
    return (isExported ? 'export ' : '') + header + ';';
}

function extractFallbackOutline(sourceCode: string, ext: string): string {
    let cleaned = '';
    let inSingleLineComment = false;
    let inMultiLineComment = false;
    let inString = false;
    let stringChar = '';
    let i = 0;

    while (i < sourceCode.length) {
        const char = sourceCode[i];
        const nextChar = sourceCode[i + 1] || '';

        if (inSingleLineComment) {
            if (char === '\n') {
                inSingleLineComment = false;
                cleaned += '\n';
            }
        } else if (inMultiLineComment) {
            if (char === '*' && nextChar === '/') {
                inMultiLineComment = false;
                i++; // skip '/'
            }
        } else if (inString) {
            if (char === '\\') {
                i++; // skip next char to handle escaped strings
            } else if (char === stringChar) {
                inString = false;
                cleaned += stringChar;
            }
        } else {
            if (char === '/' && nextChar === '/') {
                inSingleLineComment = true;
                i++;
            } else if (char === '/' && nextChar === '*') {
                inMultiLineComment = true;
                i++;
            } else if (char === '#') {
                inSingleLineComment = true;
            } else if (char === '"' || char === "'" || char === '`') {
                inString = true;
                stringChar = char;
                cleaned += char;
            } else {
                cleaned += char;
            }
        }
        i++;
    }

    const lines = cleaned.split('\n');
    let outline = '';
    const isPython = ext === '.py';
    const isGo = ext === '.go';
    const isRust = ext === '.rs';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let isMatch = false;
        if (isPython) {
            if (
                trimmed.startsWith('def ') ||
                trimmed.startsWith('class ') ||
                trimmed.startsWith('import ') ||
                trimmed.startsWith('from ')
            ) {
                isMatch = true;
            }
        } else if (isGo) {
            if (
                trimmed.startsWith('func ') ||
                trimmed.startsWith('type ') ||
                trimmed.startsWith('package ') ||
                trimmed.startsWith('import ')
            ) {
                isMatch = true;
            }
        } else if (isRust) {
            if (
                trimmed.startsWith('fn ') ||
                trimmed.startsWith('struct ') ||
                trimmed.startsWith('enum ') ||
                trimmed.startsWith('impl ') ||
                trimmed.startsWith('trait ') ||
                trimmed.startsWith('use ') ||
                trimmed.startsWith('pub fn ') ||
                trimmed.startsWith('pub struct ') ||
                trimmed.startsWith('pub enum ') ||
                trimmed.startsWith('pub trait ')
            ) {
                isMatch = true;
            }
        } else {
            if (
                trimmed.startsWith('class ') ||
                trimmed.startsWith('interface ') ||
                trimmed.startsWith('struct ') ||
                trimmed.startsWith('function ') ||
                trimmed.startsWith('def ') ||
                trimmed.startsWith('func ') ||
                trimmed.startsWith('fn ') ||
                trimmed.startsWith('import ')
            ) {
                isMatch = true;
            }
        }

        if (isMatch) {
            outline += line + '\n';
        }
    }

    return outline.trim() || 'No structural signatures found.';
}

function generateSignatures(content: string, filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();

    // 1. AST-based Outline for supported languages
    if (['.ts', '.js', '.tsx', '.jsx', '.html', '.css'].includes(ext)) {
        try {
            let lang: any = Lang.TypeScript;
            if (ext === '.js' || ext === '.jsx') lang = Lang.JavaScript;
            else if (ext === '.tsx') lang = Lang.Tsx;
            else if (ext === '.html') lang = Lang.Html;
            else if (ext === '.css') lang = Lang.Css;

            const ast = parse(lang, content);
            const root = ast.root();
            let outline = '';

            const children = root.children();
            for (const node of children) {
                const kind = node.kind();
                if (kind === 'import_statement' || kind === 'export_statement') {
                    const inner = node.child(1);
                    const innerKind = inner ? inner.kind() : '';
                    if (innerKind === 'class_declaration') {
                        outline += formatClassNode(inner, true) + '\n';
                    } else if (innerKind === 'interface_declaration') {
                        outline += node.text() + '\n';
                    } else if (innerKind === 'function_declaration') {
                        outline += formatFunctionNode(inner, true) + '\n';
                    } else {
                        outline += node.text() + '\n';
                    }
                } else if (kind === 'class_declaration') {
                    outline += formatClassNode(node, false) + '\n';
                } else if (kind === 'interface_declaration') {
                    outline += node.text() + '\n';
                } else if (kind === 'function_declaration') {
                    outline += formatFunctionNode(node, false) + '\n';
                }
            }
            return outline.trim() || 'No structural signatures found.';
        } catch (e) {
            // Fallback if AST parsing throws
        }
    }

    // 2. Lexical/State-machine fallback for other languages
    return extractFallbackOutline(content, ext);
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

            if (['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.h', '.cs', '.css', '.html'].includes(ext)) {
                return header + generateSignatures(fileContent, filePath);
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
    const pinnedIndices = new Set<number>();
    pinnedIndices.add(0); // Turn 0 (system message)
    pinnedIndices.add(rawHistory.length - 1); // Turn T (current prompt)
    if (rawHistory.length > 2) {
        pinnedIndices.add(rawHistory.length - 2); // Turn T-1 (previous tool output or assistant thought)
    }
    const firstUserMsgIdx = rawHistory.findIndex((m, idx) => m.role === 'user' && idx > 0);
    if (firstUserMsgIdx !== -1) {
        pinnedIndices.add(firstUserMsgIdx); // Turn 1 (original task instruction)
    }

    // Structural Deduplication Scan
    const seenReadFiles = new Set<string>();
    const seenCommands = new Set<string>();
    const forceDropIndices = new Set<number>();

    for (let i = rawHistory.length - 1; i >= 0; i--) {
        const msg = rawHistory[i];
        if (msg.role === 'user' || msg.role === 'system') {
            if (msg.content.startsWith('[Action read_file(')) {
                const pathMatch = msg.content.match(/read_file\(([^)]+)\)/);
                const filePath = pathMatch ? pathMatch[1] : '';
                if (filePath) {
                    if (seenReadFiles.has(filePath)) {
                        if (!pinnedIndices.has(i)) {
                            forceDropIndices.add(i);
                        }
                    } else {
                        seenReadFiles.add(filePath);
                    }
                }
            } else if (msg.content.startsWith('[Action run_command(')) {
                const cmdMatch = msg.content.match(/run_command\(([^)]+)\)/);
                const cmd = cmdMatch ? cmdMatch[1] : '';
                if (cmd) {
                    if (seenCommands.has(cmd)) {
                        if (!pinnedIndices.has(i)) {
                            forceDropIndices.add(i);
                        }
                    } else {
                        seenCommands.add(cmd);
                    }
                }
            }
        }
    }

    const intermediateTurns: { msg: ChatMessage, originalIndex: number }[] = [];
    for (let i = 0; i < rawHistory.length; i++) {
        if (!pinnedIndices.has(i) && !forceDropIndices.has(i)) {
            intermediateTurns.push({ msg: rawHistory[i], originalIndex: i });
        }
    }

    const embeddingService = new EmbeddingService();
    const turnTexts = intermediateTurns.map(t => {
        if (t.msg.role === 'assistant') {
            const info = parseAssistantInfo(t.msg.content);
            return `Thought: ${info.thought} Summary: ${info.summary} Action: ${JSON.stringify(info.action)}`;
        }
        return t.msg.content;
    });

    let normalizedScores: number[] = [];
    if (intermediateTurns.length > 0) {
        const rawScores = embeddingService.scoreDocumentsBM25(queryStr, turnTexts);
        const maxScore = Math.max(...rawScores, 0.0001);
        normalizedScores = rawScores.map(score => {
            if (maxScore < 0.5) return score; // Do not upscale if the highest score is extremely low noise
            return score / maxScore;
        });
    }

    // 3. Candidate State Classification (Before Budgeting)
    const classifiedCandidates = intermediateTurns.map((turnObj, idx) => {
        const nScore = normalizedScores[idx];
        return {
            turn: turnObj.msg,
            originalIndex: turnObj.originalIndex,
            idx,
            nScore,
            isRawCandidate: nScore > 0.50,
            isAbstractCandidate: nScore >= 0.20 && nScore <= 0.50,
            tokenEstimate: countTokens(turnObj.msg.content)
        };
    });

    // 4. Physical Token Budget Enforcement
    let remainingBudget = budgetCeiling;

    // Deduct pinned messages (Turn 0, Turn 1, Turn T, Turn T-1)
    for (const idx of pinnedIndices) {
        remainingBudget -= countTokens(rawHistory[idx].content);
    }

    // Deduct initial Abstract candidates from remainingBudget
    for (const cand of classifiedCandidates) {
        if (!cand.isRawCandidate && cand.isAbstractCandidate) {
            const abstractContent = generateAbstract(cand.turn);
            remainingBudget -= countTokens(abstractContent);
        }
    }

    // Sort RAW candidates by score (descending) and recency (descending)
    const rawCandidates = classifiedCandidates
        .filter(c => c.isRawCandidate)
        .sort((a, b) => {
            if (Math.abs(a.nScore - b.nScore) > 0.0001) {
                return b.nScore - a.nScore; // Higher score first
            }
            return b.originalIndex - a.originalIndex; // More recent first
        });

    const rawIndices = new Set<number>(); // Holds original indices to be kept RAW
    for (const cand of rawCandidates) {
        if (cand.tokenEstimate <= remainingBudget) {
            rawIndices.add(cand.originalIndex);
            remainingBudget -= cand.tokenEstimate;
        } else {
            // Downgrade due to budget constraints
            cand.isRawCandidate = false;
            cand.isAbstractCandidate = cand.nScore >= 0.20;
            if (cand.isAbstractCandidate) {
                const abstractContent = generateAbstract(cand.turn);
                remainingBudget -= countTokens(abstractContent);
            }
        }
    }

    // 5. Construct Final Orchestrated History
    const orchestrated: ChatMessage[] = [];
    for (let i = 0; i < rawHistory.length; i++) {
        if (pinnedIndices.has(i) || rawIndices.has(i)) {
            orchestrated.push(rawHistory[i]);
        } else {
            // It's an intermediate turn that is NOT raw
            const cand = classifiedCandidates.find(c => c.originalIndex === i);
            if (cand && cand.isAbstractCandidate) {
                orchestrated.push({
                    role: rawHistory[i].role,
                    content: generateAbstract(rawHistory[i])
                });
            }
            // If drop (score < 0.20), it is not pushed to orchestrated history
        }
    }

    return orchestrated;
}
