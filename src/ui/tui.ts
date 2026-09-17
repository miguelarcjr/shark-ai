import * as p from '@clack/prompts';
import * as readline from 'node:readline';
import { colors } from './colors.js';
import { t } from '../core/i18n/index.js';

export interface TuiSpinner {
    start(msg?: string): void;
    stop(msg?: string, code?: number): void;
    message(msg: string): void;
}

function isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function readLineNonTTY(promptMsg: string): Promise<string> {
    process.stdout.write(promptMsg);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });
    return new Promise((resolve) => {
        let resolved = false;
        rl.once('line', (line) => {
            resolved = true;
            rl.close();
            resolve(line.trim());
        });
        rl.once('close', () => {
            if (!resolved) {
                resolve('');
            }
        });
    });
}

class TuiMutex {
    private queue: (() => void)[] = [];
    private locked = false;

    async acquireLock(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    releaseLock(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
        } else {
            this.locked = false;
        }
    }
}

const mutex = new TuiMutex();

export const tui = {
    _readLine: readLineNonTTY,
    async acquireLock(): Promise<void> {
        await mutex.acquireLock();
    },

    releaseLock(): void {
        mutex.releaseLock();
    },

    intro(title: string) {
        if (!isInteractive()) {
            console.log(`\n=== ${title} ===\n`);
            return;
        }
        p.intro(colors.inverse(` ${title} `));
    },

    log: {
        message(msg: string) { if (!isInteractive()) console.log(msg); else p.log.message(msg); },
        info(msg: string) { if (!isInteractive()) console.log(`[INFO] ${msg}`); else p.log.info(msg); },
        success(msg: string) { if (!isInteractive()) console.log(`[SUCCESS] ${msg}`); else p.log.success(msg); },
        step(msg: string) { if (!isInteractive()) console.log(`[STEP] ${msg}`); else p.log.step(msg); },
        warn(msg: string) { if (!isInteractive()) console.warn(`[WARN] ${msg}`); else p.log.warn(msg); },
        warning(msg: string) { if (!isInteractive()) console.warn(`[WARN] ${msg}`); else p.log.warning(msg); },
        error(msg: string) { if (!isInteractive()) console.error(`[ERROR] ${msg}`); else p.log.error(msg); },
    },
    isCancel: p.isCancel,

    outro(msg: string) {
        if (!isInteractive()) {
            console.log(`\n=== ${msg} ===\n`);
            return;
        }
        p.outro(colors.primary(msg));
    },

    spinner(): TuiSpinner {
        if (!isInteractive()) {
            return {
                start: (msg) => { if (msg) console.log(`[START] ${msg}`); },
                stop: (msg, _code = 0) => { if (msg) console.log(`[DONE] ${msg}`); },
                message: (msg) => { if (msg) console.log(`[INFO] ${msg}`); },
            };
        }
        const s = p.spinner();
        return {
            start: (msg) => s.start(msg),
            stop: (msg, code = 0) => s.stop(msg, code),
            message: (msg) => s.message(msg),
        };
    },

    async text(opts: p.TextOptions): Promise<string> {
        await this.acquireLock();
        try {
            if (!isInteractive()) {
                const promptMsg = `${opts.message}${opts.initialValue ? ` [${opts.initialValue}]` : ''}: `;
                const input = await this._readLine(promptMsg);
                return input || (opts.initialValue as string) || '';
            }
            const result = await p.text(opts);
            this.handleCancel(result);
            return result as string;
        } finally {
            this.releaseLock();
        }
    },

    async password(opts: p.PasswordOptions): Promise<string> {
        if (!isInteractive()) {
            return this._readLine(`${opts.message}: `);
        }
        const result = await p.password(opts);
        this.handleCancel(result);
        return result as string;
    },

    async confirm(opts: p.ConfirmOptions): Promise<boolean> {
        await this.acquireLock();
        try {
            if (!isInteractive()) {
                const hint = opts.initialValue ? 'Y/n' : 'y/N';
                const input = await this._readLine(`${opts.message} (${hint}): `);
                if (!input) return Boolean(opts.initialValue);
                const lower = input.toLowerCase();
                return lower === 'y' || lower === 'yes' || lower === 's' || lower === 'sim';
            }
            const result = await p.confirm(opts);
            this.handleCancel(result);
            return result as boolean;
        } finally {
            this.releaseLock();
        }
    },

    async select<Value>(opts: p.SelectOptions<any, Value>): Promise<Value> {
        await this.acquireLock();
        try {
            if (!isInteractive()) {
                console.log(opts.message);
                opts.options.forEach((opt: any, idx: number) => {
                    const hintStr = opt.hint ? ` (${opt.hint})` : '';
                    console.log(`  [${idx + 1}] ${opt.label || String(opt.value)}${hintStr}`);
                });
                const defaultIdx = opts.initialValue !== undefined 
                    ? opts.options.findIndex((o: any) => o.value === opts.initialValue) + 1 
                    : 1;
                const input = await this._readLine(`Escolha [1-${opts.options.length}] (padrão: ${defaultIdx}): `);
                const choiceNum = parseInt(input, 10);
                if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= opts.options.length) {
                    return opts.options[choiceNum - 1].value;
                }
                const matchByValOrLabel = opts.options.find((o: any) => 
                    String(o.value) === input || String(o.label) === input
                );
                if (matchByValOrLabel) {
                    return matchByValOrLabel.value;
                }
                return opts.options[defaultIdx - 1]?.value ?? opts.options[0].value;
            }
            const result = await p.select(opts);
            this.handleCancel(result);
            return result as Value;
        } finally {
            this.releaseLock();
        }
    },

    async multiselect<Value>(opts: p.MultiSelectOptions<any, Value>): Promise<Value[]> {
        await this.acquireLock();
        try {
            if (!isInteractive()) {
                console.log(opts.message);
                opts.options.forEach((opt: any, idx: number) => {
                    const hintStr = opt.hint ? ` (${opt.hint})` : '';
                    console.log(`  [${idx + 1}] ${opt.label || String(opt.value)}${hintStr}`);
                });
                const input = await readLineNonTTY(`Escolha os números separados por vírgula (ex: 1,2): `);
                if (!input) return [];
                const indices = input.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= opts.options.length);
                return indices.map(i => opts.options[i - 1].value);
            }
            const result = await p.multiselect(opts);
            this.handleCancel(result);
            return result as Value[];
        } finally {
            this.releaseLock();
        }
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
