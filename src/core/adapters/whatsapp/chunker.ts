export function splitWhatsAppMessage(text: string, maxChunkSize: number = 3500): string[] {
    if (text.length <= maxChunkSize) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxChunkSize) {
        let splitIndex = remaining.lastIndexOf('\n', maxChunkSize);
        if (splitIndex === -1 || splitIndex < maxChunkSize * 0.5) {
            splitIndex = maxChunkSize;
        }
        chunks.push(remaining.substring(0, splitIndex).trim());
        remaining = remaining.substring(splitIndex).trim();
    }

    if (remaining.length > 0) {
        chunks.push(remaining);
    }

    return chunks;
}
