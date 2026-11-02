// Serves a build (npm run build, then npm run slim-cache for its slim cache)
// with everything it needs, co-op's relay included, from one Node process
// with no packages:
//
//   npm run serve                          # on port 8080 (or PORT), co-op included
//   npm run serve:singleplayer             # without co-op (or MULTIPLAYER=off)
//   ... -- --proxy=cloudflare              # behind a proxy (or PROXY=local|cloudflare;
//                                          # see client-ip.mjs)
//   ... -- --any-map                       # rooms take players without their map
//                                          # (or MULTIPLAYER_ANY_MAP=on; see coop-relay.mjs)
//   ... -- --max-rooms=1000                # rooms at once, 500 unless it's set
//                                          # (or MULTIPLAYER_MAX_ROOMS=1000)
//   MULTIPLAYER_METRICS=false              # disable local Prometheus metrics (on by default)
//
// Without a slim cache in the build it serves the full one from caches/, like
// `vite preview` does.
//
// It sends the headers the game can't load without (see Hosting in
// docs/DEVELOPMENT.md). Players need HTTPS (or localhost), so on a server put
// something that does it in front, like Caddy.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

import { proxyMode } from "./client-ip.mjs";
import {
    RELAY_PATH,
    createRelay,
    isAnyMapOn,
    isMultiplayerOn,
    maxRoomsSetting,
    requestPath,
} from "./coop-relay.mjs";

const REPO = resolve(fileURLToPath(import.meta.url), "../..");
const ROOT = resolve(process.env.DIST ?? join(REPO, "dist"));
// The build's slim cache, or the full one
const CACHES = existsSync(join(ROOT, "caches")) ? join(ROOT, "caches") : join(REPO, "caches");
const PORT = parseInt(process.env.PORT ?? "8080");
const HOST = process.env.HOST ?? "0.0.0.0";
const MULTIPLAYER = isMultiplayerOn();

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".ogg": "audio/ogg",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

// The game shares the cache with its workers in a SharedArrayBuffer, which
// browsers only allow on a cross-origin isolated page
const ISOLATION = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};

// Where a request goes on disk, or undefined for one outside the build (and
// the cache)
function findFile(urlPath) {
    let path;
    try {
        path = decodeURIComponent(urlPath);
    } catch {
        return undefined;
    }
    const inCaches = path.startsWith("/caches/");
    const root = inCaches ? CACHES : ROOT;
    const file = normalize(join(root, inCaches ? path.slice("/caches/".length) : path));
    const rel = relative(root, file);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
        return undefined;
    }
    try {
        const stat = statSync(file);
        if (stat.isDirectory()) {
            const index = join(file, "index.html");
            return { file: index, size: statSync(index).size };
        }
        return { file, size: stat.size };
    } catch {
        return undefined;
    }
}

// Built files and the slim cache are named after what's in them, so they
// keep; the page and the notice (edited on the server) are checked each time
function cacheControl(urlPath) {
    return urlPath.startsWith("/assets/") || /^\/caches\/[^/]+\//.test(urlPath)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
}

// A Range header's single span of a file this size: { start, end } (end
// included), "unsatisfiable", or undefined for the whole file. The cache
// download resumes with one, and adds what comes back to what it has.
function parseRange(header, size) {
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

const relay = MULTIPLAYER ? createRelay() : undefined;

const server = createServer((req, res) => {
    if (relay?.handleRequest(req, res)) {
        return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
    }
    const urlPath = requestPath(req);
    const found = urlPath !== undefined ? findFile(urlPath) : undefined;
    if (!found) {
        res.writeHead(urlPath === undefined ? 400 : 404, {
            "Content-Type": "text/plain",
            ...ISOLATION,
        });
        res.end(urlPath === undefined ? "Bad request\n" : "Not found\n");
        return;
    }
    const range = parseRange(req.headers.range, found.size);
    if (range === "unsatisfiable") {
        res.writeHead(416, { "Content-Range": `bytes */${found.size}`, ...ISOLATION });
        res.end();
        return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? found.size - 1;
    res.writeHead(range ? 206 : 200, {
        "Content-Type": MIME_TYPES[extname(found.file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range && { "Content-Range": `bytes ${start}-${end}/${found.size}` }),
        "Cache-Control": cacheControl(urlPath),
        ...ISOLATION,
    });
    if (req.method === "HEAD" || found.size === 0) {
        res.end();
        return;
    }
    // pipeline, not pipe: it closes the file when the player goes mid-download
    pipeline(createReadStream(found.file, { start, end }), res, () => {});
});

// Nothing else here upgrades, so anything but the relay is turned away
// rather than left open
if (relay) {
    relay.attach(server, RELAY_PATH, { closeOthers: true });
} else {
    server.on("upgrade", (_req, socket) => socket.destroy());
}

if (!existsSync(join(ROOT, "index.html"))) {
    console.error(`No build in ${ROOT}. Run npm run build first.`);
    process.exit(1);
}
if (!existsSync(join(CACHES, "caches.json"))) {
    console.error(`No cache in ${CACHES}. Run npm run download-caches (or npm run slim-cache).`);
    process.exit(1);
}

server.listen(PORT, HOST, () => {
    console.log(`Run Escape on http://localhost:${PORT} (serving ${ROOT})`);
    console.log(`Cache from ${CACHES}`);
    console.log(
        MULTIPLAYER
            ? `Multiplayer on: co-op relay at ${RELAY_PATH}, proxy in front: ${proxyMode()}, ` +
                  `up to ${maxRoomsSetting()} rooms, ` +
                  (isAnyMapOn()
                      ? "rooms take anyone (MULTIPLAYER_ANY_MAP)"
                      : "rooms take only players with their map unlocked")
            : "Multiplayer off (MULTIPLAYER=off or serve:singleplayer): the game hides co-op",
    );
});
