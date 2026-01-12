import * as diff from 'diff';
import { colors } from '../colors.js';

interface DiffOptions {
    showLineNumbers?: boolean;
}

/**
 * Renders a side-by-side (or unified) diff for terminal usage.
 * Currently implements a unified view (lines stacked).
 */
export function renderDiff(oldText: string, newText: string, options: DiffOptions = {}): string {
    const changes = diff.diffLines(oldText, newText);
    let output = '';
    // Simple line counter for reference (naive implementation for now)
    // let lineCount = 1; 

    changes.forEach(part => {
        // Determine lines, handling trailing newline gracefully from diff output
        const lines = part.value.split('\n');
        // If the last element is empty (because value ended in \n), drop it to avoid an extra blank line
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        lines.forEach(line => {
            if (part.added) {
                output += colors.success(`+ ${line}`) + '\n';
            } else if (part.removed) {
                output += colors.error(`- ${line}`) + '\n';
            } else {
                output += colors.dim(`  ${line}`) + '\n';
            }
        });
    });

    return output;
}
