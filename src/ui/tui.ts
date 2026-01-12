import * as p from '@clack/prompts';
import { colors } from './colors.js';
import { t } from '../core/i18n/index.js';

export interface TuiSpinner {
    start(msg?: string): void;
    stop(msg?: string, code?: number): void;
    message(msg: string): void;
}

export const tui = {
    intro(title: string) {
        p.intro(colors.inverse(` ${title} `));
    },

    log: p.log,
    isCancel: p.isCancel,

    outro(msg: string) {
        p.outro(colors.primary(msg));
    },

    spinner(): TuiSpinner {
        const s = p.spinner();
        return {
            start: (msg) => s.start(msg),
            stop: (msg, code = 0) => s.stop(msg, code),
            message: (msg) => s.message(msg),
        };
    },

    async text(opts: p.TextOptions): Promise<string> {
        const result = await p.text(opts);
        this.handleCancel(result);
        return result as string;
    },

    async password(opts: p.PasswordOptions): Promise<string> {
        const result = await p.password(opts);
        this.handleCancel(result);
        return result as string;
    },

    async confirm(opts: p.ConfirmOptions): Promise<boolean> {
        const result = await p.confirm(opts);
        this.handleCancel(result);
        return result as boolean;
    },

    async select<Value>(opts: p.SelectOptions<any, Value>): Promise<Value> {
        const result = await p.select(opts);
        this.handleCancel(result);
        return result as Value;
    },

    async multiselect<Value>(opts: p.MultiSelectOptions<any, Value>): Promise<Value[]> {
        const result = await p.multiselect(opts);
        this.handleCancel(result);
        return result as Value[];
    },

    /**
     * Centralized cancel handler.
     * If the user presses Ctrl+C, Clack returns a symbol.
     * We detect it and exit gracefully.
     */
    handleCancel(value: unknown) {
        if (p.isCancel(value)) {
            p.cancel(t('common.operationCancelled'));
            process.exit(0);
        }
    },

    // Expose raw clack for advanced use cases if strictly necessary
    raw: p
};
