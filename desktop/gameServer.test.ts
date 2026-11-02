import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    GAME_ORIGIN,
    contentSecurityPolicy,
    getRelayOrigin,
    parseRange,
    resolveGamePath,
    serveGame,
} from "./gameServer";

// CacheFiles.ts sends Number.MAX_SAFE_INTEGER as the end of a resume
const RESUME_END = "9007199254740991";

let root: string;
const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "game-server-"));
    mkdirSync(path.join(root, "caches", "c"), { recursive: true });
    writeFileSync(path.join(root, "index.html"), "<html></html>");
    writeFileSync(path.join(root, "worker.js"), "1");
    writeFileSync(path.join(root, "module.wasm"), "1");
    writeFileSync(path.join(root, "empty.dat"), "");
    writeFileSync(path.join(root, "caches", "c", "main_file_cache.dat2"), data);
    writeFileSync(path.join(root, "..", "game-server-outside.txt"), "secret");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(path.join(root, "..", "game-server-outside.txt"), { force: true });
});

function head(pathname: string): Promise<Response> {
    return serveGame(root, new Request(GAME_ORIGIN + pathname, { method: "HEAD" }));
}

function get(pathname: string, headers: Record<string, string> = {}): Promise<Response> {
    return serveGame(root, new Request(GAME_ORIGIN + pathname, { headers }));
}

describe("parseRange", () => {
    test("reads the ranges a client sends", () => {
        expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
        expect(parseRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
        expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
        expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    });

    test("clamps the end the game's resume sends", () => {
        expect(parseRange(`bytes=500-${RESUME_END}`, 1000)).toEqual({ start: 500, end: 999 });
    });

    test("can't satisfy a start past the end", () => {
        expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
        expect(parseRange(`bytes=5000-${RESUME_END}`, 1000)).toBe("unsatisfiable");
        expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
        expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
    });

    test("ignores what it doesn't understand", () => {
        expect(parseRange(null, 1000)).toBeUndefined();
        expect(parseRange("bytes=-", 1000)).toBeUndefined();
        expect(parseRange("bytes=5-1", 1000)).toBeUndefined();
        expect(parseRange("bytes=0-1,5-6", 1000)).toBeUndefined();
        expect(parseRange("items=0-1", 1000)).toBeUndefined();
    });
});

describe("resolveGamePath", () => {
    test("finds files inside the root", () => {
        expect(resolveGamePath("/g", "/index.html", path.posix)).toBe("/g/index.html");
        expect(resolveGamePath("/g", "/a%20b.js", path.posix)).toBe("/g/a b.js");
    });

    test.each([["/%2e%2e/x"], ["/..%2fx"], ["/a/..%2f..%2fx"], ["/%00"], ["/%zz"], ["/"]])(
        "refuses %s",
        (pathname) => {
            expect(resolveGamePath("/g", pathname)).toBeUndefined();
        },
    );

    test("refuses backslashes that climb out on Windows", () => {
        const root = "C:\\game";
        expect(resolveGamePath(root, "/assets/a.js", path.win32)).toBe("C:\\game\\assets\\a.js");
        expect(resolveGamePath(root, "/..%5c..%5cWindows", path.win32)).toBeUndefined();
        expect(resolveGamePath(root, "/%2e%2e%5cx", path.win32)).toBeUndefined();
        expect(resolveGamePath(root, "/C:%5cWindows", path.win32)).toBeUndefined();
        expect(resolveGamePath(root, "/index.html:stream", path.win32)).toBeUndefined();
    });
});

describe("getRelayOrigin", () => {
    test("gives the origin of a secure relay", () => {
        expect(getRelayOrigin("wss://example.com/game/coop")).toBe("https://example.com");
        expect(getRelayOrigin("wss://example.com:8443/coop")).toBe("https://example.com:8443");
    });

    test.each([[""], ["not a url"], ["ws://example.com/coop"], ["https://example.com/coop"]])(
        "lets nothing out for %j",
        (url) => {
            expect(getRelayOrigin(url)).toBeUndefined();
        },
    );
});

describe("serveGame", () => {
    test("serves the page at the root, with the headers for cross-origin isolation", async () => {
        const response = await get("/");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("<html></html>");
        expect(response.headers.get("Content-Type")).toContain("text/html");
        expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
        expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    });

    test("sends the isolation headers with every answer, as workers need them too", async () => {
        for (const response of [
            await get("/worker.js"),
            await get("/missing"),
            await get("/index.html", { Range: "bytes=999-" }),
        ]) {
            expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
        }
    });

    test("gives scripts and wasm the types browsers insist on", async () => {
        expect((await get("/worker.js")).headers.get("Content-Type")).toContain("text/javascript");
        expect((await get("/module.wasm")).headers.get("Content-Type")).toBe("application/wasm");
    });

    test("gives the size, which the game's progress reads", async () => {
        const response = await get("/caches/c/main_file_cache.dat2");
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Length")).toBe("1000");
        expect(response.headers.get("Accept-Ranges")).toBe("bytes");
        expect(Buffer.from(await response.arrayBuffer()).equals(data)).toBe(true);
    });

    test("resumes a download the way CacheFiles.ts asks", async () => {
        const response = await get("/caches/c/main_file_cache.dat2", {
            Range: `bytes=600-${RESUME_END}`,
        });
        expect(response.status).toBe(206);
        expect(response.headers.get("Content-Range")).toBe("bytes 600-999/1000");
        // CacheFiles.ts adds this to its offset for the total, so it has to be what's left
        expect(response.headers.get("Content-Length")).toBe("400");
        expect(Buffer.from(await response.arrayBuffer()).equals(data.subarray(600))).toBe(true);
    });

    test("says so when a range is past the end", async () => {
        const response = await get("/caches/c/main_file_cache.dat2", { Range: "bytes=1000-" });
        expect(response.status).toBe(416);
        expect(response.headers.get("Content-Range")).toBe("bytes */1000");
    });

    test("serves an empty file", async () => {
        const response = await get("/empty.dat");
        expect(response.status).toBe(200);
        expect((await response.arrayBuffer()).byteLength).toBe(0);
    });

    test("answers HEAD with no body", async () => {
        const request = new Request(GAME_ORIGIN + "/index.html", { method: "HEAD" });
        const response = await serveGame(root, request);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Length")).toBe("13");
        expect(response.body).toBeNull();
    });

    test("doesn't serve folders, missing files or anything outside the root", async () => {
        expect((await get("/caches")).status).toBe(404);
        expect((await get("/missing.js")).status).toBe(404);
        expect((await get("/..%2fgame-server-outside.txt")).status).toBe(404);
    });

    test("serves only the game's origin, and only reads", async () => {
        const elsewhere = new Request("https://example.com/index.html");
        expect((await serveGame(root, elsewhere)).status).toBe(403);
        const post = new Request(GAME_ORIGIN + "/index.html", { method: "POST" });
        expect((await serveGame(root, post)).status).toBe(405);
    });
});

describe("contentSecurityPolicy", () => {
    test("lets the page connect to the app alone, and to the relay if there is one", () => {
        expect(contentSecurityPolicy(undefined)).toBe("connect-src 'self'");
        expect(contentSecurityPolicy("https://example.com:8443")).toBe(
            "connect-src 'self' https://example.com:8443 wss://example.com:8443",
        );
    });

    test("is sent with every answer, workers' scripts and refusals included", async () => {
        expect((await head("/")).headers.get("Content-Security-Policy")).toBe("connect-src 'self'");
        const relay = "https://relay.example.com";
        for (const pathname of ["/", "/worker.js", "/missing.js"]) {
            const request = new Request(GAME_ORIGIN + pathname, { method: "HEAD" });
            const response = await serveGame(root, request, relay);
            expect(response.headers.get("Content-Security-Policy")).toBe(
                `connect-src 'self' ${relay} wss://relay.example.com`,
            );
        }
    });
});
