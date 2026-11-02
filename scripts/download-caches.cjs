const fs = require("fs");
const AdmZip = require("adm-zip");

const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) {
        return "0 Bytes";
    }

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function askQuestion(query) {
    return new Promise((resolve) =>
        rl.question(query, (ans) => {
            resolve(ans);
        }),
    );
}

// The cache the game runs on: GAME_CACHE_NAME in src/game/cache.ts
function getGameCacheName() {
    const source = fs.readFileSync("src/game/cache.ts", "utf8");
    return /GAME_CACHE_NAME = "([^"]+)"/.exec(source)[1];
}

async function fetchArchive(url) {
    const timeout = Number(process.env.CACHE_DOWNLOAD_TIMEOUT_MS ?? 30 * 60_000);
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
        throw new Error("CACHE_DOWNLOAD_TIMEOUT_MS must be a positive integer up to 2147483647");
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) {
        throw new Error(
            `Archive request failed: ${response.status} ${response.statusText} (${url})`,
        );
    }
    return response;
}

// The newest count caches, or with onlyName just the one that would be put in
// caches/<onlyName>/
async function downloadCaches(count, onlyName) {
    // renameCacheDirs();
    if (!fs.existsSync("caches/")) {
        fs.mkdirSync("caches/", { recursive: true });
    }

    const resp = await fetchArchive("https://archive.openrs2.org/caches.json");
    const json = await resp.json();

    const caches = json.filter(
        (cache) =>
            cache.scope === "runescape" &&
            cache.game === "oldschool" &&
            cache.language === "en" &&
            cache.builds.length > 0 &&
            cache.timestamp,
    );

    caches.push(
        ...json.filter(
            (cache) =>
                cache.scope === "runescape" &&
                cache.game === "runescape" &&
                cache.environment === "live" &&
                cache.language === "en" &&
                cache.builds.length > 0 &&
                cache.builds[0].major >= 186 &&
                cache.builds[0].major <= 736 &&
                cache.timestamp,
        ),
    );

    // sort new to old
    caches.sort((a, b) => {
        const isOsrsA = a.game === "oldschool";
        const isOsrsB = b.game === "oldschool";
        const isLiveA = a.environment === "live";
        const isLiveB = b.environment === "live";
        const buildA = a.builds[0].major;
        const buildB = b.builds[0].major;
        const dateA = Date.parse(a.timestamp);
        const dateB = Date.parse(b.timestamp);
        return (
            (isOsrsB ? 1 : 0) - (isOsrsA ? 1 : 0) ||
            (isLiveB ? 1 : 0) - (isLiveA ? 1 : 0) ||
            buildB - buildA ||
            dateB - dateA
        );
    });

    if (onlyName) {
        const wanted = caches.filter((cache) => getCacheDir(cache) === `caches/${onlyName}/`);
        if (wanted.length === 0) {
            throw new Error(`${onlyName} isn't in the OpenRS2 Archive's list of caches`);
        }
        caches.splice(0, caches.length, ...wanted);
    }

    const cachesToDownload = [];
    let totalBytes = 0;

    for (let i = 0; i < count && i < caches.length; i++) {
        const cache = caches[i];
        const cacheDir = getCacheDir(cache);
        if (fs.existsSync(cacheDir + "info.json")) {
            const oldCache = JSON.parse(fs.readFileSync(cacheDir + "info.json"));
            if (
                oldCache.valid_indexes === undefined ||
                oldCache.valid_groups === undefined ||
                oldCache.valid_keys === undefined ||
                cache.valid_indexes > oldCache.valid_indexes ||
                cache.valid_groups > oldCache.valid_groups ||
                cache.valid_keys > oldCache.valid_keys
            ) {
                cachesToDownload.push(cache);
                totalBytes += cache.size;
            }
        } else if (isValid(cache)) {
            cachesToDownload.push(cache);
            totalBytes += cache.size;
        }
    }

    // Without a terminal (a CI run) nobody can answer, and the script would just stop here
    if (totalBytes > 0 && process.stdin.isTTY) {
        await askQuestion("Downloading ~" + formatBytes(totalBytes) + ". Press enter to continue.");
    }

    for (const cache of cachesToDownload) {
        const cacheDir = getCacheDir(cache);
        await downloadCache(cache, cacheDir);
    }

    console.log("Finished downloading caches");

    deleteDuplicateCaches();
    createCacheList();
}

function getCacheDir(cache) {
    const build = cache.builds[0].major;
    const date = cache.timestamp.split("T")[0];
    if (cache.game === "oldschool") {
        if (cache.environment === "beta") {
            return `caches/osrs-beta-${build}_${date}/`;
        }
        return `caches/osrs-${build}_${date}/`;
    }
    const langPostfix = cache.language !== "en" ? "-" + cache.language : "";
    return `caches/rs2-${build}${langPostfix}_${date}/`;
}

async function downloadCache(cache, cacheDir) {
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir);
    }

    console.log("Downloading cache to:", cacheDir);

    const cacheZipBuffer = Buffer.from(await fetchCacheFiles(cache));
    const cacheZip = new AdmZip(cacheZipBuffer, { readEntries: true });
    cacheZip.extractEntryTo("cache/", cacheDir, false, true);

    const xteas = await fetchXteas(cache);

    fs.writeFileSync(cacheDir + "keys.json", JSON.stringify(xteas), "utf8");
    fs.writeFileSync(cacheDir + "info.json", JSON.stringify(cache), "utf8");
}

async function fetchCacheFiles(cache) {
    const resp = await fetchArchive(
        `https://archive.openrs2.org/caches/${cache.scope}/${cache.id}/disk.zip`,
    );
    return resp.arrayBuffer();
}

async function fetchXteas(cache) {
    const resp = await fetchArchive(
        `https://archive.openrs2.org/caches/${cache.scope}/${cache.id}/keys.json`,
    );
    const keys = await resp.json();

    const xteas = {};
    for (const entry of keys) {
        xteas[entry.group.toString()] = entry.key;
    }

    return xteas;
}

function renameCacheDirs() {
    const cachesPath = "caches/";

    const fileNames = fs.readdirSync(cachesPath);
    for (const name of fileNames) {
        const isDir = fs.lstatSync(cachesPath + name).isDirectory();
        if (!isDir || !fs.existsSync(cachesPath + name + "/info.json")) {
            continue;
        }
        if (name.startsWith("cache-")) {
            console.log("Renaming cache dir:", name);
            fs.renameSync(cachesPath + name, cachesPath + name.replace("cache-", "osrs-"));
        }
        // break;
    }
}

function isValid(info) {
    if (info.valid_indexes !== info.indexes) {
        return false;
    }
    const validGroupPercentage = info.valid_groups / info.groups;
    return validGroupPercentage >= 0.9;
}

function deleteDuplicateCaches() {
    const cachesPath = "caches/";

    const cacheIdDirsMap = new Map();

    const fileNames = fs.readdirSync(cachesPath);
    for (const name of fileNames) {
        const dir = cachesPath + name;
        const isDir = fs.lstatSync(dir).isDirectory();
        if (!isDir || !fs.existsSync(dir + "/info.json")) {
            continue;
        }
        const cacheInfoJson = fs.readFileSync(dir + "/info.json");
        const cacheInfo = JSON.parse(cacheInfoJson);

        const dirs = cacheIdDirsMap.get(cacheInfo.id);
        if (dirs) {
            dirs.push(dir);
        } else {
            cacheIdDirsMap.set(cacheInfo.id, [dir]);
        }
    }

    for (const dirs of cacheIdDirsMap.values()) {
        if (dirs.length <= 1) {
            continue;
        }

        dirs.sort((a, b) => {
            const aStat = fs.statSync(a + "/info.json");
            const bStat = fs.statSync(b + "/info.json");
            return bStat.mtimeMs - aStat.mtimeMs;
        });

        for (let i = 1; i < dirs.length; i++) {
            const dir = dirs[i];
            console.log("Deleting duplicate cache:", dir);
            fs.rmdirSync(dir, { recursive: true });
        }
    }
}

function createCacheList() {
    const cachesPath = "caches/";

    const caches = [];

    const fileNames = fs.readdirSync(cachesPath);
    for (const name of fileNames) {
        const dir = cachesPath + name;
        const isDir = fs.lstatSync(dir).isDirectory();
        if (!isDir || !fs.existsSync(dir + "/info.json")) {
            continue;
        }
        const cacheInfoJson = fs.readFileSync(dir + "/info.json");
        const cacheInfo = JSON.parse(cacheInfoJson);

        const revision = cacheInfo.builds[0].major;

        // Skip 311 for now, missing configs, no nice way to check atm
        if (
            !isValid(cacheInfo) ||
            cacheInfo.language !== "en" ||
            (cacheInfo.game === "runescape" && (revision < 186 || revision > 740)) ||
            revision === 311
        ) {
            continue;
        }

        const mapsPath = dir + "/maps/";
        if (fs.existsSync(mapsPath)) {
            const mapNames = fs
                .readdirSync(mapsPath)
                .filter((name) => name.startsWith("m") || name.startsWith("l"));

            console.log("Found " + mapNames.length + " map(s) for cache " + name);

            fs.writeFileSync(dir + "/maps.json", JSON.stringify(mapNames), "utf8");
        }

        const cache = {
            name,
            game: cacheInfo.game,
            environment: cacheInfo.environment,
            revision,
            timestamp: cacheInfo.timestamp,
            size: cacheInfo.size,
        };

        caches.push(cache);
    }

    fs.writeFileSync(cachesPath + "caches.json", JSON.stringify(caches), "utf8");

    console.log("Created a list of " + caches.length + " cache(s)");
}

// No argument: the cache the game runs on. A number (or "all"): that many of
// the newest caches, for the map viewer.
let downloadCount = 1;
let onlyName = getGameCacheName();
if (process.argv.length > 2) {
    const countArg = process.argv[2];
    onlyName = undefined;
    if (countArg === "all") {
        downloadCount = Number.MAX_SAFE_INTEGER;
    } else {
        downloadCount = parseInt(countArg);
    }
}

downloadCaches(downloadCount, onlyName).then(
    () => process.exit(0),
    (e) => {
        console.error("Cache download failed:", e.message);
        console.error(
            "Retry when the archive is reachable; adjust CACHE_DOWNLOAD_TIMEOUT_MS for slow connections.",
        );
        process.exit(1);
    },
);
