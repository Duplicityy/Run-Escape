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
            AbortSignal,
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

    it("terminates a request that never receives headers", async () => {
        expect.hasAssertions();
        const fetchMock = vi.fn<ArchiveFetch>((_url, options) => waitForAbort(options.signal));

        const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: "20" });

        expect(result.exitCode).toBe(1);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(result.error).toHaveBeenCalledWith("Cache download failed:", expect.any(String));
        expect(result.writeFile).not.toHaveBeenCalled();
    });

    it("terminates a stalled archive body before extraction or metadata writes", async () => {
        expect.hasAssertions();
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify([cacheInfo])))
            .mockImplementationOnce(async (_url, options) => ({
                ok: true,
                arrayBuffer: () => waitForAbort(options.signal),
            }));

        const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: "20" });

        expect(result.exitCode).toBe(1);
        expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
        expect(result.extract).not.toHaveBeenCalled();
        expect(result.writeFile).not.toHaveBeenCalled();
    });

    it("rejects an archive-list HTTP failure with the URL and status", async () => {
        expect.hasAssertions();
        const fetchMock = vi
            .fn<ArchiveFetch>()
            .mockResolvedValue(
                new Response("Unavailable", { status: 503, statusText: "Service Unavailable" }),
            );

        const result = await runDownloader(fetchMock);

        expect(result.exitCode).toBe(1);
        expect(result.error).toHaveBeenCalledWith(
            "Cache download failed:",
            expect.stringContaining(
                "503 Service Unavailable (https://archive.openrs2.org/caches.json)",
            ),
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

    it.each(["0", "-1", "NaN", "1.5", "2147483648"])(
        "rejects invalid timeout %s",
        async (timeout) => {
            expect.hasAssertions();
            const fetchMock = vi.fn<ArchiveFetch>();

            const result = await runDownloader(fetchMock, { CACHE_DOWNLOAD_TIMEOUT_MS: timeout });

            expect(result.exitCode).toBe(1);
            expect(fetchMock).not.toHaveBeenCalled();
            expect(result.error).toHaveBeenCalledWith(
                "Cache download failed:",
                expect.stringContaining("CACHE_DOWNLOAD_TIMEOUT_MS must be a positive integer"),
            );
        },
    );
});
