import stringWidth from 'string-width';
import { colors } from '../colors';

interface BoxOptions {
    padding?: number;
    width?: number; // Optional override
}

/**
 * Renders a content box with a title in the border.
 * Respects terminal width for responsiveness.
 */
export function renderBox(title: string, content: string | string[], options: BoxOptions = {}): string {
    const padding = options.padding ?? 1;
    const terminalWidth = options.width ?? (process.stdout.columns || 80);
    const isCompact = terminalWidth < 80;

    const contentLines = Array.isArray(content) ? content : content.split('\n');

    if (isCompact) {
        // Compact Mode: Simple Header + Content
        const header = colors.secondary(colors.bold(title.toUpperCase()));
        const body = contentLines.map(line => `  ${line}`).join('\n');
        return `\n${header}\n${body}\n`;
    }

    // Standard Mode: Box Drawing
    const maxContentWidth = Math.max(...contentLines.map(line => stringWidth(line)));
    // Box width is determined by content + padding, but capped at terminal width
    // Minimum width to fit title + decorations
    const titleWidth = stringWidth(title);
    const minWidth = titleWidth + 6; // ┌─ title ─┐

    // Calculate final box width
    const boxWidth = Math.max(minWidth, maxContentWidth + (padding * 2) + 2);
    const actualBoxWidth = Math.min(boxWidth, terminalWidth);
    const innerWidth = actualBoxWidth - 2;

    // Top Border with Title
    const horizontalStart = '─'.repeat(1);
    const horizontalEnd = '─'.repeat(Math.max(0, innerWidth - titleWidth - 2)); // -2 for spaced title

    const topBorder = `${colors.secondary('┌')}${colors.secondary(horizontalStart)} ${colors.secondary(colors.bold(title))} ${colors.secondary(horizontalEnd)}${colors.secondary('┐')}`;
    const bottomBorder = `${colors.secondary('└')}${colors.secondary('─'.repeat(innerWidth))}${colors.secondary('┘')}`;

    // Content Rendering
    const renderedLines = contentLines.map(line => {
        const lineWidth = stringWidth(line);
        const spaceRight = Math.max(0, innerWidth - lineWidth - padding); // Simplified padding logic
        const padLeft = ' '.repeat(padding);
        const padRight = ' '.repeat(spaceRight);

        // We need to be careful with alignment if content is wider than box (clipping)
        // For now assuming content fits or is manually wrapped
        return `${colors.secondary('│')}${padLeft}${line}${padRight}${colors.secondary('│')}`;
    });

    return `${topBorder}\n${renderedLines.join('\n')}\n${bottomBorder}`;
}
