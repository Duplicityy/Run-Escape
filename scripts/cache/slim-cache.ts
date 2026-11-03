// Writes a slim copy of the game's cache for hosting: only the groups the game
// reads, in the same dat2 format, so a first visit downloads a few MB instead
// of the whole cache.
//
// What the game reads is found by loading what it loads, with its own loaders:
// the renderer's textures, every model it bakes (enemies, spot animations,
// pickups and power-ups, the player in every outfit and every wearable item),
// its sounds and sprites, an icon for every item in the content, and each map's
// arena with MAP_MARGIN map squares around it. Then it all gets loaded again
// from the slim cache, and a group that's missing fails the script.
//
//   npx tsx scripts/cache/slim-cache.ts [out dir]
//
// The out dir (dist/caches by default, so run it after the build) gets a
// caches.json and the slim cache, named after what's in it so browsers fetch
// a changed one. Make it again whenever the content changes.
import { createHash } from "node:crypto";
import fs from "node:fs";

import { GAME_CACHE_NAME } from "../../src/game/cache";
import {
    GameAssets,
    HITSPLAT_SPRITES,
    PICKUP_OBJS,
    PILE_LOOKS,
    PLAYER_SEQS,
    getCharacterAppearance,
    getPlayerAttackSeqs,
    getPowerUpLookRequests,
} from "../../src/game/client/GameAssets";
import { getGameSoundIds } from "../../src/game/client/GameSounds";
import { CHARACTERS } from "../../src/game/content/characters";
import { ENEMIES } from "../../src/game/content/enemies";
import { FLAG_SPRITE } from "../../src/game/content/flags";
import { CASKETS, GEAR, GEAR_SLOT_BY_ID, ITEMS } from "../../src/game/content/items";
import { ALL_MAPS, getArenaRegion } from "../../src/game/content/maps";
import { PASSIVES } from "../../src/game/content/passives";
import { POWER_UPS, THRALLS } from "../../src/game/content/powerups";
import { RANDOM_EVENTS } from "../../src/game/content/randomEvents";
import { SHOP_UPGRADES } from "../../src/game/content/shop";
import { getPlayerStanceSeqs } from "../../src/game/content/stances";
import {
    COLLECTION_LOG_OBJ,
    REFUND_SPRITE,
    TITLE_TAB_SPRITES,
} from "../../src/game/content/titleIcons";
import { TROPHIES } from "../../src/game/content/trophies";
import { WEAPONS } from "../../src/game/content/weapons";
import { installRecipeInSceneBuilder } from "../../src/game/scaperune/squares";
import { LoadedCache } from "../../src/mapviewer/Caches";
import { ActorBakeLoader } from "../../src/mapviewer/webgl/actor/ActorBakeLoader";
import { BakeRequest } from "../../src/mapviewer/webgl/actor/ActorBakeTypes";
import { SdMapDataLoader } from "../../src/mapviewer/webgl/loader/SdMapDataLoader";
import { getSdTextureIds } from "../../src/mapviewer/webgl/loader/TextureIndex";
import { ItemIconLoader } from "../../src/mapviewer/worker/ItemIconLoader";
import { loadMinimapData } from "../../src/mapviewer/worker/MinimapData";
import { RegionDataLoader } from "../../src/mapviewer/worker/RegionDataLoader";
import { RenderDataLoader } from "../../src/mapviewer/worker/RenderDataLoader";
import { SoundLoader } from "../../src/mapviewer/worker/SoundLoader";
import { SpriteDataLoader } from "../../src/mapviewer/worker/SpriteDataLoader";
import {
    WorkerState,
    clearWorkerStateCaches,
    createWorkerState,
} from "../../src/mapviewer/worker/WorkerState";
import { CacheFiles } from "../../src/rs/cache/CacheFiles";
import { CacheIndex } from "../../src/rs/cache/CacheIndex";
import { CacheInfo } from "../../src/rs/cache/CacheInfo";
import { MemoryStore } from "../../src/rs/cache/store/MemoryStore";
import { Sector } from "../../src/rs/cache/store/Sector";
import { SectorCluster } from "../../src/rs/cache/store/SectorCluster";
import {
    EquipSlot,
    PlayerAppearance,
    createAppearance,
} from "../../src/rs/model/player/PlayerModelLoader";
import { Scene } from "../../src/rs/scene/Scene";
import { Hasher } from "../../src/util/Hasher";
import { loadCache, loadCacheInfos } from "./load-util";

// Map squares loaded around each arena. The camera can be up to ~15 tiles
// outside the arena and sees 72 tiles (GameApp's RENDER_DISTANCE), so the
// renderer asks for at most two squares past the edge.
const MAP_MARGIN = 2;

const SECTOR_SIZE = Sector.SIZE;

const outDir = (process.argv[2] ?? "dist/caches").replace(/\/?$/, "/");

// The map loaders draw minimap images on an OffscreenCanvas, which Node
// doesn't have. Only what they read from the cache matters here.
class NodeImageData {
    readonly data: Uint8ClampedArray;

    constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
    }
}
class NodeOffscreenCanvas {
    getContext() {
        return { putImageData() {} };
    }

    convertToBlob(): Promise<Blob> {
        return Promise.resolve(new Blob());
    }
}
Object.assign(globalThis, { ImageData: NodeImageData, OffscreenCanvas: NodeOffscreenCanvas });

// Every group read, as "index:archive"
const reads = new Set<string>();
const readGroup = MemoryStore.prototype.read;
MemoryStore.prototype.read = function (indexId: number, archiveId: number): Int8Array {
    reads.add(indexId + ":" + archiveId);
    return readGroup.call(this, indexId, archiveId);
};

// Every item the player can wear, in its slot: the outfits, held weapons, the
// pieces passives put on and casket gear
function getWornObjs(): [EquipSlot, number][] {
    const worn: [EquipSlot, number][] = [];
    for (const character of CHARACTERS) {
        for (const [slot, objId] of Object.entries(character.equipment)) {
            if (objId !== undefined) {
                worn.push([Number(slot), objId]);
            }
        }
    }
    // The fun maps' players (baked in getBaseRequests too)
    for (const enemy of ENEMIES) {
        for (const outfit of enemy.outfits ?? []) {
            for (const [slot, objId] of Object.entries(outfit.equipment)) {
                if (objId !== undefined && objId !== -1) {
                    worn.push([Number(slot), objId]);
                }
            }
        }
    }
    for (const weapon of WEAPONS) {
        for (const level of weapon.levels) {
            if (level.objId !== undefined) {
                worn.push([EquipSlot.WEAPON, level.objId]);
            }
        }
    }
    for (const passive of PASSIVES) {
        for (const piece of passive.equipment ?? []) {
            for (const objId of piece.objIds) {
                if (objId !== -1) {
                    worn.push([piece.slot, objId]);
                }
            }
        }
    }
    for (const gear of GEAR) {
        const equipSlot = GEAR_SLOT_BY_ID.get(gear.slot)?.equipSlot;
        if (equipSlot !== undefined) {
            worn.push([equipSlot, gear.objId]);
        }
    }
    return worn;
}

// Every item id in the content (objId, iconObjId, casketObjId, objIds...), for
// their icons
function getContentObjIds(): number[] {
    const ids = new Set<number>([
        COLLECTION_LOG_OBJ,
        ...Object.values(PICKUP_OBJS),
        ...Object.values(PILE_LOOKS).flatMap((looks) => looks.map((look) => look.objId)),
    ]);
    for (const [, objId] of getWornObjs()) {
        ids.add(objId);
    }
    const seen = new Set<object>();
    const visit = (value: unknown, key: string): void => {
        if (typeof value === "number") {
            if (/objIds?$/i.test(key) && value >= 0) {
                ids.add(value);
            }
        } else if (value && typeof value === "object" && !seen.has(value)) {
            seen.add(value);
            for (const [childKey, child] of Object.entries(value)) {
                visit(child, Array.isArray(value) ? key : childKey);
            }
        }
    };
    visit(
        {
            CHARACTERS,
            ENEMIES,
            WEAPONS,
            PASSIVES,
            ITEMS,
            CASKETS,
            POWER_UPS,
            RANDOM_EVENTS,
            THRALLS,
            ALL_MAPS,
            SHOP_UPGRADES,
            TROPHIES,
        },
        "",
    );
    return [...ids];
}

// Stackables like coins have a model per stack size
function getStackCounts(state: WorkerState, objId: number): number[] {
    const counts = state.objTypeLoader.load(objId).countCo ?? [];
    return [1, ...counts.filter((count) => count > 1)];
}

function playerRequest(key: string, appearance: PlayerAppearance, seqIds: number[]): BakeRequest {
    return { kind: "player", key, appearance, seqIds };
}

// Bake requests to put through one buffer
const BAKE_BATCH = 25;

// The map loader logs every square
async function quietly<T>(load: () => Promise<T>): Promise<T> {
    const { log, time, timeEnd } = console;
    console.log = console.time = console.timeEnd = () => {};
    try {
        return await load();
    } finally {
        Object.assign(console, { log, time, timeEnd });
    }
}

async function loadWhatTheGameLoads(cache: LoadedCache): Promise<void> {
    const state = createWorkerState(cache, [], [], undefined as unknown as Cache);
    const load = async <I, D>(loader: RenderDataLoader<I, D>, input: I): Promise<void> => {
        loader.init();
        await loader.load(state, input);
        clearWorkerStateCaches(state);
    };

    // The renderer's texture array
    for (const id of getSdTextureIds(state.textureLoader)) {
        state.textureLoader.getPixelsArgb(id, 128, true, 1.0);
    }

    const playerSeqs = [...Object.values(PLAYER_SEQS), ...getPlayerAttackSeqs()];
    const playerRequests: BakeRequest[] = [
        // Every body kit
        playerRequest("bare", createAppearance(), playerSeqs),
        // Only the look holding the weapon plays these, so one bake reads them
        playerRequest("stances", createAppearance(), getPlayerStanceSeqs()),
        ...CHARACTERS.map((character) =>
            playerRequest(character.id, getCharacterAppearance(character.id), playerSeqs),
        ),
        // Power-ups' worn items and their animations
        ...getPowerUpLookRequests(createAppearance()),
        ...getWornObjs().map(([slot, objId]) =>
            playerRequest(`${slot}:${objId}`, createAppearance({ [slot]: objId }), []),
        ),
    ];
    const bakeLoader = new ActorBakeLoader();
    const enemyRequests = GameAssets.getEnemyRequests(ENEMIES);
    for (const all of [GameAssets.getBaseRequests(), enemyRequests, playerRequests]) {
        // The game bakes a map's worth at a time. Everything in one buffer is more
        // than an array can hold (Invalid array length).
        for (let i = 0; i < all.length; i += BAKE_BATCH) {
            const requests = all.slice(i, i + BAKE_BATCH);
            await load(bakeLoader, { requests, loadedTextureIds: new Set<number>() });
        }
    }

    await load(new SoundLoader(), { ids: getGameSoundIds() });
    // The hitsplats, the title screen's tabs, the skills' refund button, co-op's
    // flags (every frame comes with the first), and the passives with an
    // interface sprite for an icon
    const spriteIds = [
        ...Object.values(HITSPLAT_SPRITES),
        ...Object.values(TITLE_TAB_SPRITES),
        REFUND_SPRITE,
        FLAG_SPRITE,
        ...PASSIVES.flatMap((passive) =>
            passive.iconSpriteId !== undefined ? [passive.iconSpriteId] : [],
        ),
    ];
    await load(new SpriteDataLoader(), { spriteIds });
    await load(new ItemIconLoader(), {
        requests: getContentObjIds().flatMap((objId) =>
            getStackCounts(state, objId).map((count) => ({ objId, count })),
        ),
    });

    const mapLoader = new SdMapDataLoader();
    for (const map of ALL_MAPS) {
        installRecipeInSceneBuilder(state.sceneBuilder, map.id);
        const region = getArenaRegion(map);
        await load(new RegionDataLoader(), region);

        const { baseX, baseY, sizeX, sizeY, plane } = region;
        const firstX = Math.floor(baseX / Scene.MAP_SQUARE_SIZE);
        const firstY = Math.floor(baseY / Scene.MAP_SQUARE_SIZE);
        const lastX = Math.ceil((baseX + sizeX) / Scene.MAP_SQUARE_SIZE) - 1;
        const lastY = Math.ceil((baseY + sizeY) / Scene.MAP_SQUARE_SIZE) - 1;
        for (let mapX = firstX - MAP_MARGIN; mapX <= lastX + MAP_MARGIN; mapX++) {
            for (let mapY = firstY - MAP_MARGIN; mapY <= lastY + MAP_MARGIN; mapY++) {
                // GameWebGLRenderer's settings
                await quietly(() =>
                    load(mapLoader, {
                        mapX,
                        mapY,
                        minLevel: plane,
                        maxLevel: plane,
                        loadObjs: false,
                        loadNpcs: false,
                        smoothTerrain: false,
                        minimizeDrawCalls: false,
                        loadedTextureIds: new Set<number>(),
                    }),
                );
            }
        }
        // The minimap's images
        for (let mapX = firstX; mapX <= lastX; mapX++) {
            for (let mapY = firstY; mapY <= lastY; mapY++) {
                await loadMinimapData(state, mapX, mapY, plane, true);
            }
        }
    }
}

function parseKey(key: string): [number, number] {
    const [indexId, archiveId] = key.split(":").map(Number);
    return [indexId, archiveId];
}

function getIndexId(fileName: string): number | undefined {
    if (!fileName.startsWith(CacheFiles.INDEX_FILE_PREFIX)) {
        return undefined;
    }
    return parseInt(fileName.slice(CacheFiles.INDEX_FILE_PREFIX.length));
}

// A group's stored size, from its index file entry
function getGroupSize(files: CacheFiles, indexId: number, archiveId: number): number {
    const indexFile = files.files.get(CacheFiles.INDEX_FILE_PREFIX + indexId);
    const ptr = archiveId * SectorCluster.SIZE;
    if (!indexFile || ptr + SectorCluster.SIZE > indexFile.byteLength) {
        return 0;
    }
    const entry = new Uint8Array(indexFile, ptr, 3);
    return (entry[0] << 16) | (entry[1] << 8) | entry[2];
}

// Writes the groups the way the client stores them: each one in a chain of
// sectors in the dat2, its index file entry pointing at the first. Index files
// keep their length; the groups left out have empty entries.
function writeSlimFiles(full: CacheFiles, keys: string[]): Map<string, Uint8Array> {
    const store = MemoryStore.fromFiles(full);
    const indexFiles = new Map<number, Buffer>();
    for (const [name, data] of full.files) {
        const indexId = getIndexId(name);
        if (indexId !== undefined) {
            indexFiles.set(indexId, Buffer.alloc(data.byteLength));
        }
    }

    // Sector 0 stays empty: an entry pointing there means no group
    const sectors: Buffer[] = [Buffer.alloc(SECTOR_SIZE)];
    for (const [indexId, archiveId] of keys.map(parseKey)) {
        const data = readGroup.call(store, indexId, archiveId);
        const indexFile = indexFiles.get(indexId);
        if (data.length === 0 || !indexFile) {
            continue;
        }
        const extended = archiveId > 0xffff;
        const dataSize = extended ? Sector.EXTENDED_DATA_SIZE : Sector.DATA_SIZE;
        const count = Math.ceil(data.length / dataSize);
        const first = sectors.length;
        indexFile.writeUIntBE(data.length, archiveId * SectorCluster.SIZE, 3);
        indexFile.writeUIntBE(first, archiveId * SectorCluster.SIZE + 3, 3);
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.length);
        for (let chunk = 0; chunk < count; chunk++) {
            const sector = Buffer.alloc(SECTOR_SIZE);
            let offset = extended
                ? sector.writeInt32BE(archiveId, 0)
                : sector.writeUInt16BE(archiveId, 0);
            offset = sector.writeUInt16BE(chunk, offset);
            offset = sector.writeUIntBE(chunk + 1 < count ? first + chunk + 1 : 0, offset, 3);
            offset = sector.writeUInt8(indexId, offset);
            sector.set(bytes.subarray(chunk * dataSize, (chunk + 1) * dataSize), offset);
            sectors.push(sector);
        }
    }

    const files = new Map<string, Uint8Array>();
    files.set(CacheFiles.DAT2_FILE_NAME, Buffer.concat(sectors));
    for (const [indexId, indexFile] of indexFiles) {
        files.set(CacheFiles.INDEX_FILE_PREFIX + indexId, indexFile);
    }
    return files;
}

function formatMb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1).padStart(6) + " MB";
}

function printSummary(full: CacheFiles, keys: string[]): void {
    const kept = new Map<number, { groups: number; bytes: number }>();
    for (const [indexId, archiveId] of keys.map(parseKey)) {
        const size = getGroupSize(full, indexId, archiveId);
        if (size > 0) {
            const index = kept.get(indexId) ?? { groups: 0, bytes: 0 };
            index.groups++;
            index.bytes += size;
            kept.set(indexId, index);
        }
    }
    const indexIds = [...full.files.keys()]
        .map(getIndexId)
        .filter((indexId) => indexId !== undefined)
        .sort((a, b) => a - b);
    console.log("index    groups kept              size kept");
    for (const indexId of indexIds) {
        const indexFile = full.files.get(CacheFiles.INDEX_FILE_PREFIX + indexId)!;
        let groups = 0;
        let bytes = 0;
        for (
            let archiveId = 0;
            archiveId < indexFile.byteLength / SectorCluster.SIZE;
            archiveId++
        ) {
            const size = getGroupSize(full, indexId, archiveId);
            if (size > 0) {
                groups++;
                bytes += size;
            }
        }
        const index = kept.get(indexId) ?? { groups: 0, bytes: 0 };
        console.log(
            String(indexId).padStart(5),
            `${index.groups} / ${groups}`.padStart(17),
            `${formatMb(index.bytes)} / ${formatMb(bytes)}`,
        );
    }
}

// Every group comes out of the slim cache as it went in, and loading what the
// game loads from it reads nothing that's missing
async function checkSlimCache(full: LoadedCache, slim: LoadedCache, keys: string[]): Promise<void> {
    const fullStore = MemoryStore.fromFiles(full.files);
    const slimStore = MemoryStore.fromFiles(slim.files);
    for (const [indexId, archiveId] of keys.map(parseKey)) {
        const expected = readGroup.call(fullStore, indexId, archiveId);
        const actual = readGroup.call(slimStore, indexId, archiveId);
        if (Buffer.compare(Buffer.from(expected), Buffer.from(actual)) !== 0) {
            throw new Error(`Group ${indexId}:${archiveId} was written wrong`);
        }
    }
    reads.clear();
    await loadWhatTheGameLoads(slim);
    // Including reads whose error a loader caught and went on from
    const missing = [...reads].filter((key) => {
        const [indexId, archiveId] = parseKey(key);
        return (
            getGroupSize(full.files, indexId, archiveId) > 0 &&
            getGroupSize(slim.files, indexId, archiveId) === 0
        );
    });
    if (missing.length > 0) {
        throw new Error(`Missing from the slim cache: ${missing.join(", ")}`);
    }
}

async function main(): Promise<void> {
    const started = performance.now();
    await Hasher.init();

    const fullInfo = loadCacheInfos().find((c) => c.name === GAME_CACHE_NAME);
    if (!fullInfo) {
        throw new Error(`Cache ${GAME_CACHE_NAME} not found in caches/caches.json`);
    }
    const full = loadCache(fullInfo);

    console.log(`Loading what the game loads from ${GAME_CACHE_NAME}...`);
    await loadWhatTheGameLoads(full);
    const metaEntries = full.files.files.get(CacheFiles.META_FILE_NAME)!.byteLength;
    for (let indexId = 0; indexId < metaEntries / SectorCluster.SIZE; indexId++) {
        // The reference tables, for every index
        reads.add(CacheIndex.META_INDEX_ID + ":" + indexId);
    }
    const keys = [...reads].sort((a, b) => {
        const [indexA, archiveA] = parseKey(a);
        const [indexB, archiveB] = parseKey(b);
        return indexA - indexB || archiveA - archiveB;
    });
    printSummary(full.files, keys);

    const files = writeSlimFiles(full.files, keys);
    const hash = createHash("sha256");
    for (const name of [...files.keys()].sort()) {
        hash.update(name).update(files.get(name)!);
    }
    const name = `${GAME_CACHE_NAME}-slim-${hash.digest("hex").slice(0, 8)}`;
    let size = 0;
    for (const data of files.values()) {
        size += data.byteLength;
    }
    const slimInfo: CacheInfo = { ...fullInfo, name, size, slimOf: GAME_CACHE_NAME };

    const dir = outDir + name + "/";
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [fileName, data] of files) {
        fs.writeFileSync(dir + fileName, data);
    }
    fs.copyFileSync(`./caches/${GAME_CACHE_NAME}/keys.json`, dir + "keys.json");

    console.log(`Checking ${name}...`);
    try {
        await checkSlimCache(full, loadCache(slimInfo, outDir), keys);
    } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw e;
    }

    // Only the newest slim cache stays
    for (const entry of fs.readdirSync(outDir)) {
        if (entry !== name && entry.startsWith(GAME_CACHE_NAME + "-slim-")) {
            fs.rmSync(outDir + entry, { recursive: true, force: true });
        }
    }
    fs.writeFileSync(outDir + "caches.json", JSON.stringify([slimInfo]), "utf8");

    const seconds = ((performance.now() - started) / 1000).toFixed(0);
    console.log(`Wrote ${outDir}${name} (${formatMb(size).trim()}) in ${seconds}s`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
