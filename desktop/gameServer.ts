import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

// The game's address, for good: localStorage belongs to it, so changing it loses every save.
// It's https because the game's download goes through the Cache API, whose put() refuses any other
// scheme than http(s), so a custom scheme fails on the first load. There's no port to collide
// with, as nothing listens: these requests never leave the app. .invalid can't resolve, so if
// one ever did leave, it wouldn't reach anyone.
export const GAME_ORIGIN = "https://run-escape.invalid";

const HEADERS = {
    // What makes the page cross-origin isolated, for SharedArrayBuffer. Workers need them too.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-cache",
};

const MIME_TYPES: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".md": "text/markdown; charset=utf-8",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
};

// Where the page may connect: the app, and the relay if it has one. protocol.handle in main.ts
// already answers every https request itself, but WebSockets don't go through it, so this is what
// keeps those in. Workers get their own copy, from their script's answer.
export function contentSecurityPolicy(relayOrigin: string | undefined): string {
    const relay = relayOrigin ? ` ${relayOrigin} ${relayOrigin.replace(/^https:/, "wss:")}` : "";
    return `connect-src 'self'${relay}`;
}

function status(code: number, headers: Record<string, string> = {}): Response {
    return new Response(null, { status: code, headers: { ...HEADERS, ...headers } });
}

// The file a URL path means, or undefined if it's outside root. A path can still carry %2f or %5c
// after the URL parser has resolved its dots, so this has to look at it decoded. A colon is a
// Windows drive or alternate data stream, and no game file has one.
export function resolveGamePath(root: string, pathname: string, paths = path): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return undefined;
    }
    if (decoded.includes("\0") || decoded.includes(":")) {
        return undefined;
    }
    const resolved = paths.resolve(root, "." + decoded);
    return resolved.startsWith(paths.resolve(root) + paths.sep) ? resolved : undefined;
}

// The bytes a Range header asks for, "unsatisfiable", or undefined to send the whole file.
// CacheFiles.ts resumes with bytes=<offset>-<MAX_SAFE_INTEGER>, and adds what comes back to what
// it has, so ignoring the header would corrupt the cache, and the end has to be clamped.
export function parseRange(
    header: string | null,
    size: number,
): { start: number; end: number } | "unsatisfiable" | undefined {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
    if (!match || (!match[1] && !match[2])) {
        return undefined;
    }
    const last = size - 1;
    if (!match[1]) {
        const suffix = Number(match[2]);
        return suffix === 0 || size === 0
            ? "unsatisfiable"
            : { start: Math.max(0, size - suffix), end: last };
    }
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), last) : last;
    if (start >= size) {
        return "unsatisfiable";
    }
    return end < start ? undefined : { start, end };
}

// The address the relay answers plain requests at, from the build's VITE_COOP_URL. The app answers
// every https request itself, so this one has to be let through for co-op to be offered.
export function getRelayOrigin(coopUrl: string): string | undefined {
    try {
        const url = new URL(coopUrl);
        return url.protocol === "wss:" ? `https://${url.host}` : undefined;
    } catch {
        return undefined;
    }
}

// Answers a request for the game like the static server it's written for. relayOrigin is the one
// address apart from the app's own that the page may connect to (see getRelayOrigin).
export async function serveGame(
    root: string,
    request: Request,
    relayOrigin?: string,
): Promise<Response> {
    const csp = { "Content-Security-Policy": contentSecurityPolicy(relayOrigin) };
    const url = new URL(request.url);
    if (url.origin !== GAME_ORIGIN) {
        return status(403, csp);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        return status(405, { ...csp, Allow: "GET, HEAD" });
    }
    const file = resolveGamePath(root, url.pathname === "/" ? "/index.html" : url.pathname);
    const info = file ? await stat(file).catch(() => undefined) : undefined;
    if (!file || !info?.isFile()) {
        return status(404, csp);
    }

    const range = parseRange(request.headers.get("Range"), info.size);
    if (range === "unsatisfiable") {
        return status(416, { ...csp, "Content-Range": `bytes */${info.size}` });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const headers: Record<string, string> = {
        ...HEADERS,
        ...csp,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    };
    if (range) {
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }
    const hasBody = request.method === "GET" && info.size > 0;
    const body = hasBody
        ? (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream)
        : null;
    return new Response(body, { status: range ? 206 : 200, headers });
}
