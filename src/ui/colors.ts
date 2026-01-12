import pico from 'picocolors';

// Deep Ocean Theme Palette
// Primary (Action): Cyan
// Secondary (Context): Blue
// Text: White/Gray

export const colors = {
    // Semantic Colors
    primary: (text: string | number) => pico.cyan(text),
    secondary: (text: string | number) => pico.blue(text),

    // Status Colors
    success: (text: string | number) => pico.green(text),
    error: (text: string | number) => pico.red(text),
    warning: (text: string | number) => pico.yellow(text),

    // Neutral Colors
    dim: (text: string | number) => pico.dim(text),
    inverse: (text: string | number) => pico.inverse(text),
    white: (text: string | number) => pico.white(text),
    gray: (text: string | number) => pico.gray(text),

    // Styling
    bold: (text: string | number) => pico.bold(text),
    italic: (text: string | number) => pico.italic(text),
};
