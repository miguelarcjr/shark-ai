import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { colors } from '../colors.js';

// Configure marked with TerminalRenderer
marked.setOptions({
    renderer: new TerminalRenderer({
        // Custom styles for Deep Ocean theme
        heading: colors.primary,
        firstHeading: colors.secondary,

        // Inline styles
        strong: colors.bold,
        em: colors.italic,
        codespan: colors.warning,

        // Block styles
        code: (text: string) => `  ${colors.dim(text)}`, // Indent code blocks
        blockquote: (text: string) => `  ${colors.dim('│')} ${colors.dim(text)}`,

        // List styles
        listitem: (text: string) => `  • ${text}`,

        // General
        width: 80, // Default wrapping width
        reflowText: true,
    })
});

/**
 * Renders markdown text for the terminal.
 */
export function renderMarkdown(text: string): string {
    // marked returns string | Promise<string>, but with clean inputs and sync renderer it's string.
    // Casting to string to simplify consumption, as standard usage here is synchronous.
    return marked(text) as string;
}
