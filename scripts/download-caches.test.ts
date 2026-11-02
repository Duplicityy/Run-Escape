import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./download-caches.cjs", import.meta.url), "utf8");
const cacheName = "osrs-241_2026-09-30";
const cacheInfo = {
    id: 2727,
    scope: "runescape",
    game: "oldschool",
    environment: "live",
    language: "en",
    builds: [{ major: 241 }],
    timestamp: "2026-09-30T00:00:00Z",
    size: 100,
    indexes: 1,
    valid_indexes: 1,
    groups: 1,
    valid_groups: 1,
};
const retryHint = expect.stringContaining("CACHE_DOWNLOAD_TIMEOUT_MS");

type ArchiveFetch = (url: string, options: { signal: AbortSignal }) => Promise<Partial<Response>>;

async function runDownloader(fetchMock: ArchiveFetch, env: Record<string, string> = {}) {
    const files = new Map<string, string>([
        ["src/game/cache.ts", `export const GAME_CACHE_NAME = "${cacheName}";`],
    ]);
    const error = vi.fn();
    const extract = vi.fn();
    const writeFile = vi.fn((path: string, content: string) => files.set(path, content));
    const finished = new Promise<number>((resolve) => {
        runInNewContext(source, {
            Buffer,
            AbortController,
            setTimeout,
            clearTimeout,
            fetch: fetchMock,
            console: { log: vi.fn(), error },
            process: {
                argv: ["node", "scripts/download-caches.cjs"],
                env,
                stdin: { isTTY: false },
                stdout: {},
                exit: resolve,
            },
            require: (name: string) => {
                if (name === "fs") {
                    return {
                        readFileSync: (path: string) => files.get(path),
                        existsSync: (path: string) => path.endsWith("/") || files.has(path),
                        mkdirSync: vi.fn(),
                        readdirSync: () => [cacheName],
                        lstatSync: () => ({ isDirectory: () => true }),
                        writeFileSync: writeFile,
                    };
                }
                if (name === "adm-zip") {
                    return class {
                        extractEntryTo = extract;
                    };
                }
                if (name === "readline") {
                    return { createInterface: () => ({ question: vi.fn() }) };
                }
                throw new Error(`Unexpected dependency: ${name}`);
            },
        });
    });
    return { exitCode: await finished, files, error, extract, writeFile };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

// A body that sends a byte every `every` ms, `chunks` times, then ends
function trickle(chunks: number, every: number): Response {
    let sent = 0;
    return new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                return new Promise((resolve) =>
                    setTimeout(() => {
                        if (sent++ < chunks) {
                            controller.enqueue(new Uint8Array([1]));
                        } else {
                            controller.close();
                        }
                        resolve();
                    }, every),
                );
            },
        }),
    );
}

describe("cache download archive requests", () => {
    it("downloads the supported cache and writes its manifest without changing the revision", async () => {
        expect.hasAssertions();
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([cacheInfo])))
            .mockResolvedValueOnce(new Response("zip"))
            .mockResolvedValueOnce(new Response(JSON.stringify([{ group: 1, key: [1, 2, 3, 4] }])));

        const result = await runDownloader(fetchMock);

        expect(result.exitCode).toBe(0);
        expect(result.error).not.toHaveBeenCalled();
        expect(result.extract).toHaveBeenCalledWith("cache/", `caches/${cacheName}/`, false, true);
        expect(JSON.parse(result.files.get("caches/caches.json")!)).toEqual([
            expect.objectContaining({ name: cacheName, revision: 241 }),
        ]);
        expect(JSON.parse(result.files.get(`caches/${cacheName}/keys.json`)!)).toEqual({
            "1": [1, 2, 3, 4],
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const [, options] of fetchMock.mock.calls) {
            expect(options.signal).toBeInstanceOf(AbortSignal);
        }
    });

    it("gives up on a request that never receives headers, and says how to wait longer", async () => {
        expect.hasAssertions();
        const fetchMock = vi.fn<ArchiveFetch>((_url, options) => waitForAbort(options.signal));

        const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: "20" });

        expect(result.exitCode).toBe(1);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(result.error).toHaveBeenCalledWith(
            "Cache download failed:",
            expect.stringContaining(
                "Nothing arrived for 20 ms (https://archive.openrs2.org/caches.json)",
            ),
        );
        expect(result.error).toHaveBeenCalledWith(retryHint);
        expect(result.writeFile).not.toHaveBeenCalled();
    });

    it("gives up on a body that stops arriving, before extraction or metadata writes", async () => {
        expect.hasAssertions();
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([cacheInfo])))
            .mockImplementationOnce(
                async (_url, options) =>
                    new Response(new ReadableStream({ pull: () => waitForAbort(options.signal) })),
            );

        const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: "20" });

        expect(result.exitCode).toBe(1);
        expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
        expect(result.error).toHaveBeenCalledWith(
            "Cache download failed:",
            expect.stringContaining("disk.zip"),
        );
        expect(result.extract).not.toHaveBeenCalled();
        expect(result.writeFile).not.toHaveBeenCalled();
    });

    it("keeps a slow download going for as long as data arrives", async () => {
        expect.hasAssertions();
        // Eight chunks 10 ms apart take longer than the 40 ms timeout, but no gap does
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([cacheInfo])))
            .mockResolvedValueOnce(trickle(8, 10))
            .mockResolvedValueOnce(new Response(JSON.stringify([])));

        const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: "40" });

        expect(result.exitCode).toBe(0);
        expect(result.error).not.toHaveBeenCalled();
        expect(result.extract).toHaveBeenCalledTimes(1);
    });

    it("rejects an archive-list HTTP failure with the URL and status, without a retry hint", async () => {
        expect.hasAssertions();
        // No statusText, as over HTTP/2
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValue(new Response("Unavailable", { status: 503 }));

        const result = await runDownloader(fetchMock);

        expect(result.exitCode).toBe(1);
        expect(result.error).toHaveBeenCalledTimes(1);
        expect(result.error).toHaveBeenCalledWith(
            "Cache download failed:",
            "Archive request failed: 503 (https://archive.openrs2.org/caches.json)",
        );
        expect(result.writeFile).not.toHaveBeenCalled();
    });

    it("rejects a disk HTTP failure without extracting an error page", async () => {
        expect.hasAssertions();
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([cacheInfo])))
            .mockResolvedValueOnce(
                new Response("Missing", { status: 404, statusText: "Not Found" }),
            );

        const result = await runDownloader(fetchMock);

        expect(result.exitCode).toBe(1);
        expect(result.error).toHaveBeenCalledWith(
            "Cache download failed:",
            expect.stringContaining(
                "404 Not Found (https://archive.openrs2.org/caches/runescape/2727/disk.zip)",
            ),
        );
        expect(result.extract).not.toHaveBeenCalled();
        expect(result.writeFile).not.toHaveBeenCalled();
    });

    it("reports a network error with its cause and the retry hint", async () => {
        expect.hasAssertions();
        const fetchMock = vi.fn<ArchiveFetch>().mockRejectedValue(
            Object.assign(new TypeError("fetch failed"), {
                cause: new Error("getaddrinfo ENOTFOUND archive.openrs2.org"),
            }),
        );

        const result = await runDownloader(fetchMock);

        expect(result.exitCode).toBe(1);
        expect(result.error).toHaveBeenCalledWith(
            "Cache download failed:",
            "fetch failed (getaddrinfo ENOTFOUND archive.openrs2.org)",
        );
        expect(result.error).toHaveBeenCalledWith(retryHint);
    });

    it("uses the default timeout when CACHE_DOWNLOAD_TIMEOUT_MS is blank", async () => {
        expect.hasAssertions();
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([cacheInfo])))
            .mockResolvedValueOnce(new Response("zip"))
            .mockResolvedValueOnce(new Response(JSON.stringify([])));

        const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: " " });

        expect(result.exitCode).toBe(0);
        expect(result.error).not.toHaveBeenCalled();
    });

    it.each(["0", "-1", "NaN", "1.5", "2147483648"])(
        "rejects invalid timeout %s before touching the archive, without a retry hint",
        async (timeout) => {
            expect.hasAssertions();
            const fetchMock = vi.fn<ArchiveFetch>();

            const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: timeout });

            expect(result.exitCode).toBe(1);
            expect(fetchMock).not.toHaveBeenCalled();
            expect(result.error).toHaveBeenCalledTimes(1);
            expect(result.error).toHaveBeenCalledWith(
                "Cache download failed:",
                expect.stringContaining("CACHE_DOWNLOAD_TIMEOUT_MS must be a positive integer"),
            );
        },
    );
});
