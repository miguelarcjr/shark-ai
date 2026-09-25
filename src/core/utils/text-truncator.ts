import { encode } from 'gpt-tokenizer';

export function truncateToolOutput(output: string, maxTokens: number = 2000): string {
    const tokens = encode(output);
    if (tokens.length <= maxTokens) {
        return output;
    }
    const lines = output.split('\n');
    if (lines.length <= 80) {
        return output;
    }
    const head = lines.slice(0, 40).join('\n');
    const tail = lines.slice(-40).join('\n');
    return `${head}\n\n... [TRUNCADO PARA ECONOMIZAR CONTEXTO - ${lines.length - 80} LINHAS OCULTAS] ...\n\n${tail}`;
}
