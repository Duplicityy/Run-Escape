import { SaveLock } from "./SaveLock";

type Request = {
    tab: number;
    callback: LockGrantedCallback<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};

// A browser's Web Locks for one lock, shared by its tabs: granted in turn,
// taken with steal (the tab that had it hears an AbortError), and let go of
// when a tab closes
class FakeLocks {
    private held?: Request;
    private queue: Request[] = [];

    get waiting(): number {
        return this.queue.length;
    }

    // A tab's navigator.locks
    tab(tab: number): LockManager {
        const request = (
            _name: string,
            options: LockOptions,
            callback: LockGrantedCallback<unknown>,
        ) =>
            new Promise((resolve, reject) => {
                const request = { tab, callback, resolve, reject };
                if (options.steal) {
                    this.held?.reject(new DOMException("Stolen", "AbortError"));
                    this.grant(request);
                } else if (!this.held && this.queue.length === 0) {
                    this.grant(request);
                } else if (options.ifAvailable) {
                    Promise.resolve()
                        .then(() => callback(null))
                        .then(resolve, reject);
                } else {
                    this.queue.push(request);
                    options.signal?.addEventListener("abort", () => {
                        this.queue = this.queue.filter((r) => r !== request);
                        reject(new DOMException("Aborted", "AbortError"));
                    });
                }
            });
        return { request } as unknown as LockManager;
    }

    close(tab: number): void {
        this.queue = this.queue.filter((r) => r.tab !== tab);
        if (this.held?.tab === tab) {
            this.held = undefined;
            this.next();
        }
    }

    private grant(request: Request): void {
        this.held = request;
        Promise.resolve()
            .then(() => request.callback({ name: "run-escape-save", mode: "exclusive" }))
            .then((value) => {
                if (this.held === request) {
                    this.held = undefined;
                    this.next();
                }
                request.resolve(value);
            }, request.reject);
    }

    private next(): void {
        const request = this.queue.shift();
        if (request) {
            this.grant(request);
        }
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the save lock", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("the first tab saves, and a second waits", async () => {
        const browser = new FakeLocks();
        const a = new SaveLock(browser.tab(1));
        const b = new SaveLock(browser.tab(2));
        await settle();
        expect(a.held).toBe(true);
        expect(b.held).toBe(false);
        // Until the first closes
        browser.close(1);
        await settle();
        expect(b.held).toBe(true);
    });

    test("taking it over stops the other tab, which gets it back when this one closes", async () => {
        const browser = new FakeLocks();
        const a = new SaveLock(browser.tab(1));
        const b = new SaveLock(browser.tab(2));
        await settle();
        const heldA: boolean[] = [];
        a.listen((held) => heldA.push(held));
        b.takeOver();
        await settle();
        expect(b.held).toBe(true);
        expect(a.held).toBe(false);
        // Only the tab that lost it is waiting: this one stopped waiting
        expect(browser.waiting).toBe(1);
        // And back again
        a.takeOver();
        await settle();
        expect([a.held, b.held]).toEqual([true, false]);
        b.takeOver();
        await settle();
        browser.close(2);
        await settle();
        expect(a.held).toBe(true);
        expect(heldA).toEqual([true, false, true, false, true]);
    });

    test("tells a listener now, and not once it's stopped listening", async () => {
        const browser = new FakeLocks();
        const a = new SaveLock(browser.tab(1));
        const b = new SaveLock(browser.tab(2));
        const heldB = vi.fn();
        const stop = b.listen(heldB);
        // Not until the browser's said
        expect(heldB).not.toHaveBeenCalled();
        await settle();
        expect(heldB).toHaveBeenCalledWith(false);
        stop();
        browser.close(1);
        await settle();
        expect(b.held).toBe(true);
        expect(heldB).toHaveBeenCalledTimes(1);
        expect(a.held).toBe(true);
    });

    test("stopping an old listener leaves the one after it", async () => {
        const browser = new FakeLocks();
        new SaveLock(browser.tab(1));
        const b = new SaveLock(browser.tab(2));
        const stopOld = b.listen(() => {});
        const heldB = vi.fn();
        b.listen(heldB);
        stopOld();
        await settle();
        expect(heldB).toHaveBeenCalledWith(false);
    });

    test("without Web Locks, every tab saves", () => {
        vi.stubGlobal("navigator", {});
        expect(new SaveLock().held).toBe(true);
    });

    test("where locks don't work, it saves as before rather than trying again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const request = vi.fn(() => Promise.reject(new DOMException("No", "SecurityError")));
        const lock = new SaveLock({ request } as unknown as LockManager);
        await settle();
        expect(lock.held).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
