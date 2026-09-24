import { describe, it, expect } from 'vitest';
import { splitWhatsAppMessage } from './chunker.js';

describe('WhatsApp Message Chunker', () => {
    it('returns single chunk when under 3500 chars', () => {
        const text = 'Mensagem curta';
        const chunks = splitWhatsAppMessage(text, 3500);
        expect(chunks).toEqual(['Mensagem curta']);
    });

    it('splits message exceeding limit preserving newline boundaries', () => {
        const line = 'A'.repeat(2000) + '\n';
        const bigText = line + line; // 4002 chars
        const chunks = splitWhatsAppMessage(bigText, 3500);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBeLessThanOrEqual(3500);
    });
});
