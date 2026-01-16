import * as path from 'node:path';
import { CodeEditor } from '../interfaces/code-editor.interface.js';
import { TypeScriptEditor } from './typescript-editor.js';

export class CodeEditorFactory {
    private static tsEditor: TypeScriptEditor | null = null;

    /**
     * Returns appropriate editor for the file, or null if AST editing not supported
     */
    static getEditor(filePath: string): CodeEditor | null {
        const ext = path.extname(filePath).toLowerCase();

        // TypeScript/JavaScript
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            // Reuse singleton instance for performance (ts-morph Project is heavy)
            if (!this.tsEditor) {
                this.tsEditor = new TypeScriptEditor();
            }
            return this.tsEditor;
        }

        // HTML - TODO: Implement in Phase 2
        // if (ext === '.html') {
        //   return new TreeSitterEditor('html');
        // }

        // For unsupported files, return null (will fallback to modify_file)
        return null;
    }

    /**
     * Clear cached editors (useful for testing)
     */
    static clearCache(): void {
        this.tsEditor = null;
    }
}
