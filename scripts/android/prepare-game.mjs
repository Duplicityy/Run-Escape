// Android carries the same web build and slim cache as the desktop app.
import JSZip from "jszip";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_GAME_BYTES = 256 * 1024 * 1024;

function safeName(name) {
    return (
        typeof name === "string" &&
        name.length > 0 &&
        !name.startsWith("/") &&
        !/[\\:\0]/.test(name) &&
        !name.split("/").includes("..")
    );
}

async function validateGame(directory) {
    if (!(await stat(path.join(directory, "index.html"))).isFile()) {
        throw new Error("The game build has no index.html");
    }
    const caches = JSON.parse(await readFile(path.join(directory, "caches/caches.json"), "utf8"));
    if (!Array.isArray(caches) || caches.length === 0) {
        throw new Error("The game build has no slim cache");
    }
    for (const cache of caches) {
        if (
            !cache.slimOf ||
            typeof cache.name !== "string" ||
            !safeName(cache.name) ||
            cache.name.includes("/")
        ) {
            throw new Error("Android needs the build's slim cache; run npm run slim-cache first");
        }
        for (const file of ["main_file_cache.dat2", "main_file_cache.idx255"]) {
            const info = await stat(path.join(directory, "caches", cache.name, file));
            if (!info.isFile() || info.size === 0) {
                throw new Error(`Missing cache data: ${file}`);
            }
        }
    }
}

// A release directory has game-manifest.json and its matching game-<version>.zip.
// A local build (--dist) already has the files, including dist/caches.
export async function prepareGame(source, destination, { version = "", dist = false } = {}) {
    const staging = `${destination}.staging-${randomUUID()}`;
    await mkdir(path.dirname(destination), { recursive: true });
    try {
        if (dist) {
            await validateGame(source);
            await cp(source, staging, {
                recursive: true,
                filter: (file) => !file.endsWith(".map") && path.basename(file) !== ".htaccess",
            });
        } else {
            const manifest = JSON.parse(
                await readFile(path.join(source, "game-manifest.json"), "utf8"),
            );
            if (manifest.version !== version || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
                throw new Error("The desktop game's version or checksum manifest does not match");
            }
            const bytes = await readFile(path.join(source, `game-${version}.zip`));
            if (
                bytes.length > MAX_GAME_BYTES ||
                createHash("sha256").update(bytes).digest("hex") !== manifest.sha256
            ) {
                throw new Error("The desktop game ZIP failed its SHA-256 check");
            }
            const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
            let total = 0;
            await mkdir(staging, { recursive: true });
            for (const entry of Object.values(zip.files)) {
                const name = entry.unsafeOriginalName ?? entry.name;
                if (!safeName(name) || (Number(entry.unixPermissions) & 0xf000) === 0xa000) {
                    throw new Error("The game ZIP contains an unsafe path");
                }
                if (entry.dir || name.endsWith(".map") || path.basename(name) === ".htaccess") {
                    continue;
                }
                const content = await entry.async("nodebuffer");
                total += content.length;
                if (total > MAX_GAME_BYTES) {
                    throw new Error("The game ZIP expands beyond the Android asset limit");
                }
                const file = path.join(staging, name);
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(file, content);
            }
        }
        await validateGame(staging);
        await rm(destination, { recursive: true, force: true });
        await rename(staging, destination);
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const dist = args[0] === "--dist";
    const source = args[dist ? 1 : 0];
    if (!source || args.length !== (dist ? 2 : 1)) {
        console.error(
            "Usage: node scripts/android/prepare-game.mjs <release directory> | --dist <dist directory>",
        );
        process.exitCode = 1;
    } else {
        const { version } = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
        await prepareGame(
            path.resolve(source),
            path.join(ROOT, "android/app/src/main/assets/game"),
            {
                version,
                dist,
            },
        );
        console.log(`Android game assets ready (${version})`);
    }
}
