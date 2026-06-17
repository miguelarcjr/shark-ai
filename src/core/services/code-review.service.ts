import { ConfigManager } from '../config-manager.js';
import { extractFirstJson } from '../agents/agent-response-parser.js';
import path from 'path';
import { ProviderResolver } from '../api/provider-resolver.js';
import { FileLogger } from '../debug/file-logger.js';

export class CodeReviewService {

    /**
     * Reviews the code modification and returns a status/feedback string.
     * This string is intended to be appended to the user Preview so the Agent can see it.
     */
    public static async reviewCode(filePath: string, newContent: string): Promise<string> {
        const config = ConfigManager.getInstance().getConfig();
        // Access via 'any' temporarily if types aren't fully propagated yet, or use typed config
        const validation = (config as any).validation || { llmReviewExtensions: ['.ts', '.tsx'], syntaxCheckExtensions: ['*'] };

        const ext = path.extname(filePath).toLowerCase();

        // 1. Check for LLM Review (High Priority)
        // Check if extension is in the list
        const needsLlmReview = validation.llmReviewExtensions.includes(ext) || validation.llmReviewExtensions.includes('*');

        if (needsLlmReview) {
            return await this.performLlmReview(filePath, newContent);
        }

        // 2. Check for Syntax Check (Basic Priority)
        const needsSyntaxCheck = validation.syntaxCheckExtensions.includes(ext) || validation.syntaxCheckExtensions.includes('*');

        if (needsSyntaxCheck) {
            return this.performSyntaxCheck(filePath, newContent);
        }

        return "ℹ️  No specific validation configured for this file type.";
    }

    private static async performLlmReview(filePath: string, content: string): Promise<string> {
        try {
            const prompt = `You are a Code Review Specialist. Analyze the following code modification for file: ${path.basename(filePath)}

NEW CODE TO BE ADDED:
\`\`\`
${content}
\`\`\`

Provide a concise review focusing on:
1. Syntax errors or obvious bugs
2. Potential runtime issues
3. Code quality concerns

Respond in JSON format with status, issues array, and summary.`;

            let reviewText = '';
            const provider = ProviderResolver.getProvider('code_review');
            await provider.streamChat(prompt, {
                agentType: 'code_review',
                onChunk: (chunk: string) => {
                    reviewText += chunk;
                }
            });

            const cleanedText = reviewText.trim();
            FileLogger.log('CODE_REVIEW', 'Raw Response Received', { length: cleanedText.length, content: cleanedText });

            // Parse JSON response
            try {
                // Use robust extraction that handles markdown fences and extra text
                const reviewData = extractFirstJson(cleanedText);
                return this.formatReviewResponse(reviewData);
            } catch (parseErr: any) {
                FileLogger.log('CODE_REVIEW', 'JSON Parse Failed', {
                    error: parseErr.message,
                    rawText: cleanedText
                });

                // If JSON parsing fails, return the raw text with a warning
                return `🤖 **[AI Code Review Agent]**\n⚠️ Response format error. Raw output:\n${cleanedText}`;
            }

        } catch (err: any) {
            FileLogger.log('CODE_REVIEW', 'LLM Review Failed', { error: err.message });
            // Fallback to syntax check
            return `⚠️ AI Review unavailable (${err.message}). Using syntax check:\n` + await this.performSyntaxCheck(filePath, content);
        }
    }

    private static formatReviewResponse(data: any): string {
        let report = `🤖 **[AI Code Review Agent]**\n`;

        // Status indicator
        const statusIcon = data.status === 'ok' ? '✅' : data.status === 'warning' ? '⚠️' : '❌';
        report += `${statusIcon} **Status:** ${data.status.toUpperCase()}\n`;

        // Issues
        if (data.issues && data.issues.length > 0) {
            report += `\n**Issues Found:**\n`;
            for (const issue of data.issues) {
                const severityIcon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
                const lineInfo = issue.line ? `Linha ${issue.line}: ` : '';
                report += `${severityIcon} ${lineInfo}${issue.message}\n`;
                if (issue.suggestion) {
                    report += `   💡 ${issue.suggestion}\n`;
                }
            }
        }

        // Summary
        report += `\n**Resumo:** ${data.summary}`;

        return report;
    }

    private static performSyntaxCheck(filePath: string, content: string): Promise<string> {
        // Basic Syntax Check (Non-AI)
        let report = `🔍 **[Syntax Validator]**\n`;

        // simple brace check
        const openBraces = (content.match(/\{/g) || []).length;
        const closeBraces = (content.match(/\}/g) || []).length;

        if (openBraces !== closeBraces) {
            report += `❌ **CRITICAL:** Brace mismatch detected! Found ${openBraces} '{' and ${closeBraces} '}'.\n`;
            report += `   **Review your code carefully. Do not confirm if the block is incomplete.**`;
        } else {
            report += `✅ File structure looks balanced (Braces match).\n`;
        }

        return Promise.resolve(report);
    }
}
