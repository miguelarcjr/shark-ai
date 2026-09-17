export class InterruptManager {
    private stdin: NodeJS.ReadStream;
    private abortController: AbortController | null = null;
    private interrupted: boolean = false;
    private dataHandler: ((data: Buffer) => void) | null = null;

    constructor(stdinStream: NodeJS.ReadStream = process.stdin) {
        this.stdin = stdinStream;
    }

    public start(onInterrupt?: () => void): AbortSignal {
        this.abortController = new AbortController();
        this.interrupted = false;

        if (this.stdin && this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
            try {
                this.stdin.setRawMode(true);
                if (typeof this.stdin.resume === 'function') {
                    this.stdin.resume();
                }

                this.dataHandler = (data: Buffer) => {
                    if (data.length === 1 && data[0] === 3) {
                        // Ctrl+C
                        this.stop();
                        process.exit(130);
                    }

                    // Single Esc byte (27 / \x1b)
                    if (data.length === 1 && data[0] === 27) {
                        if (!this.interrupted) {
                            this.interrupted = true;
                            this.stop();
                            if (this.abortController) {
                                this.abortController.abort();
                            }
                            if (onInterrupt) {
                                onInterrupt();
                            }
                        }
                    }
                };

                this.stdin.on('data', this.dataHandler);
            } catch {
                // Ignore raw mode errors in environments that mimic TTY
            }
        }

        return this.abortController.signal;
    }

    public stop(): void {
        if (this.dataHandler) {
            this.stdin.removeListener('data', this.dataHandler);
            this.dataHandler = null;
        }

        if (this.stdin && this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
            try {
                this.stdin.setRawMode(false);
            } catch {
                // Ignore errors resetting raw mode
            }
        }
    }

    public isInterrupted(): boolean {
        return this.interrupted;
    }

    public getSignal(): AbortSignal {
        if (!this.abortController) {
            this.abortController = new AbortController();
        }
        return this.abortController.signal;
    }
}
