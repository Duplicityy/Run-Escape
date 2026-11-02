// One tab plays with the save at a time. Each tab keeps the whole save in
// memory and writes all of it, so two at once would undo each other's runs and
// purchases. The tab with the lock saves, and the others don't until they take
// it over or it closes.

// Every version of the game has to use this name, or an old tab and a new one
// won't see each other
const LOCK_NAME = "run-escape-save";

export class SaveLock {
    // Whether this tab has it, once the browser's said
    held?: boolean;
    private listener?: (held: boolean) => void;
    // Waiting for the tab that has it to close
    private queued?: AbortController;

    // Without Web Locks (Safari before 15.4, or a page that isn't https or
    // localhost), every tab saves, as before there was a lock
    constructor(private readonly locks: LockManager | undefined = globalThis.navigator?.locks) {
        if (locks) {
            this.request({ ifAvailable: true });
        } else {
            this.held = true;
        }
    }

    // Called now if the browser's said, then whenever it changes, until what it
    // returns is called
    listen(listener: (held: boolean) => void): () => void {
        this.listener = listener;
        if (this.held !== undefined) {
            listener(this.held);
        }
        return () => {
            // Not one that came after it
            if (this.listener === listener) {
                this.listener = undefined;
            }
        };
    }

    // Takes it from the tab that has it, which stops saving
    takeOver(): void {
        if (!this.locks || this.held) {
            return;
        }
        this.queued?.abort();
        this.queued = undefined;
        this.request({ steal: true });
    }

    private request(options: LockOptions): void {
        const { signal } = options;
        this.locks!.request(LOCK_NAME, options, (lock) => {
            if (!lock) {
                // Another tab has it
                this.set(false);
                this.wait();
                return;
            }
            this.set(true);
            // Held until this tab closes, or another takes it
            return new Promise<void>(() => {});
        }).catch((e: unknown) => {
            if (signal?.aborted) {
                // This tab took it over instead of waiting
                return;
            }
            if ((e as Error)?.name !== "AbortError") {
                console.error("The save lock doesn't work here", e);
                this.set(true);
                return;
            }
            // Another tab took it
            this.set(false);
            this.wait();
        });
    }

    private wait(): void {
        this.queued = new AbortController();
        this.request({ signal: this.queued.signal });
    }

    private set(held: boolean): void {
        if (this.held !== held) {
            this.held = held;
            this.listener?.(held);
        }
    }
}
