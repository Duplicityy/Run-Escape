import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { GAME_CACHE_NAME } from "../cache";
import { BIOMES, BiomeId } from "./biomes";
import { WATER_OVERLAYS } from "./catalogue";
import { TileRect, findReachable, findStranded, getCollisionFlags } from "./collision";
import { createTileGrid, writeLocs, writeTerrain } from "./format";
import {
    DEFAULT_SETTINGS,
    GeneratorSettings,
    HEIGHTMAP_SIZE,
    MAX_ARENA_SQUARES,
    SETTINGS,
    SETTING_PRESETS,
    SETTING_SECTIONS,
    SettingKey,
    decodeHeightmap,
    encodeHeightmap,
    formatSettings,
    generateMap,
    generateMapDetail,
    generatedRecipe,
    getGeneratedArena,
    getGeneratedSpawn,
    getSettingsError,
    parseSettings,
    randomSettings,
} from "./generator";
import { createRng } from "./noise";
import type { BuildContext } from "./recipe";

// A world with no cache behind it, where everything cut from it is walled rooms
// with no way in: the worst a prefab could be for reachability
const worldSquare = (() => {
    const grid = createTileGrid(64, 64);
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            if (x % 5 === 0 || y % 5 === 0) {
                grid.locs.push({ id: 1, type: 10, rotation: 0, level: 0, x, y });
            }
        }
    }
    return { terrain: writeTerrain(grid, 0, 0), locs: writeLocs(grid, 0, 0) };
})();

const context: BuildContext = {
    maps: { getTerrainData: () => worldSquare.terrain, getLocData: () => worldSquare.locs },
    locs: () => ({
        name: "Crate",
        sizeX: 1,
        sizeY: 1,
        clipType: 2,
        blocksProjectile: true,
        drawn: true,
    }),
};

function settings(overrides: Partial<GeneratorSettings>): GeneratorSettings {
    return { seed: 1, ...DEFAULT_SETTINGS, ...overrides };
}

describe("generateMap", () => {
    // These run back to back with nothing to wait for, and vitest's worker gives up on the main
    // process after a minute without a turn to hear from it
    afterEach(() => new Promise((resolve) => setTimeout(resolve)));

    it("makes the same map from the same seed and settings", () => {
        const a = generateMap(settings({ seed: 5, rivers: 1 }), context);
        const b = generateMap(settings({ seed: 5, rivers: 1 }), context);
        expect(writeTerrain(a, 64, 64)).toEqual(writeTerrain(b, 64, 64));
        expect(writeLocs(a, 64, 64)).toEqual(writeLocs(b, 64, 64));
    }, 15_000);

    it("makes a different map from another seed", () => {
        const a = generateMap(settings({ seed: 5 }), context);
        const b = generateMap(settings({ seed: 6 }), context);
        expect(writeTerrain(a, 64, 64)).not.toEqual(writeTerrain(b, 64, 64));
    });

    it("has a definition and a section for every setting, and none extra", () => {
        const keys = Object.keys(DEFAULT_SETTINGS).sort();
        expect(Object.keys(SETTINGS).sort()).toEqual(keys);
        expect(SETTING_SECTIONS.flatMap((section) => section.keys).sort()).toEqual(keys);
    });

    it("has defaults and presets inside the limits", () => {
        expect(getSettingsError(settings({}))).toBeUndefined();
        for (const [name, preset] of Object.entries(SETTING_PRESETS)) {
            expect(getSettingsError(settings(preset)), name).toBeUndefined();
        }
    });

    // Rising from west to east
    const ramp = new Uint8Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE).map((_, i) =>
        Math.round(((i % HEIGHTMAP_SIZE) / (HEIGHTMAP_SIZE - 1)) * 255),
    );

    it("rolls random settings inside the limits, keeping the map's size and how it plays", () => {
        const start = settings({
            squaresX: 5,
            squaresY: 3,
            heightmap: encodeHeightmap(ramp),
            waveSet: "karamja",
        });
        const roll = createRng(7);
        const biomes = new Set<string>();
        for (let i = 0; i < 300; i++) {
            const random = randomSettings(start, roll);
            expect(getSettingsError(random)).toBeUndefined();
            expect(random.seed).toBe(start.seed);
            expect(random.squaresX).toBe(5);
            expect(random.squaresY).toBe(3);
            expect(random.heightmap).toBe(start.heightmap);
            expect(random.waveSet).toBe("karamja");
            biomes.add(random.biome);
        }
        expect(biomes.size).toBe(Object.keys(BIOMES).length);
    });

    it("reads back the settings it writes, and refuses what aren't settings", () => {
        const full = settings({ seed: 42, boundary: "forest", squaresX: 7, houses: false });
        expect(parseSettings(formatSettings(full))).toEqual(full);
        expect(parseSettings('{"seed":3,"rivers":2}')).toEqual(settings({ seed: 3, rivers: 2 }));
        expect(() => parseSettings("nonsense")).toThrow(/valid JSON/);
        expect(() => parseSettings("[1]")).toThrow(/settings/);
        expect(() => parseSettings('{"wibble":1}')).toThrow(/wibble/);
        expect(() => parseSettings('{"rivers":99}')).toThrow(/Rivers/);
        expect(() => parseSettings('{"biome":"moon"}')).toThrow(/moon/);
    });

    it("takes the ground's height from a heightmap", () => {
        const full = settings({ heightmap: encodeHeightmap(ramp), ponds: 0, boundary: "forest" });
        const grid = generateMap(full, context);
        const arena = getGeneratedArena(full);
        const heightAt = (x: number) =>
            grid.levels[0].heights[x + ((arena.y0 + arena.y1) >> 1) * (grid.sizeX + 1)];
        expect(heightAt(arena.x1 - 4)).toBeGreaterThan(heightAt(arena.x0 + 4) + 80);
        expect(decodeHeightmap(encodeHeightmap(ramp))).toEqual(ramp);
    });

    it("won't take something that isn't a heightmap", () => {
        expect(getSettingsError(settings({ heightmap: "nonsense" }))).toBeDefined();
        expect(getSettingsError(settings({ heightmap: 5 as unknown as string }))).toBeDefined();
    });

    // What to change, on top of what makes the setting count at all
    const CHANGES: { [K in SettingKey]: [GeneratorSettings[K], Partial<GeneratorSettings>?] } = {
        squaresX: [3],
        squaresY: [3],
        biome: ["snow"],
        secondBiome: ["desert"],
        biomeMix: [0.8, { secondBiome: "desert" }],
        boundary: ["forest"],
        island: [0.8],
        boundaryDepth: [24, { boundary: "forest" }],
        shoreRoughness: [1],
        hills: [1],
        hillScale: [70],
        waterLevel: [0.5],
        groundPatches: [36],
        walkSlope: [8, { mountains: 0.6, rivers: 1 }],
        mountains: [0.6],
        peakHeight: [255, { mountains: 0.6 }],
        ridgeScale: [80, { mountains: 0.6 }],
        ruggedness: [1, { mountains: 0.6 }],
        warp: [1, { mountains: 0.6 }],
        terraces: [1, { mountains: 0.6 }],
        terraceHeight: [50, { mountains: 0.6 }],
        rockFaces: [0, { mountains: 0.6 }],
        rubble: [1, { mountains: 0.6 }],
        snow: [0.8, { mountains: 0.6 }],
        passWidth: [12, { mountains: 0.8 }],
        heightmap: [encodeHeightmap(ramp)],
        plateaus: [2],
        mesas: [3],
        canyons: [1],
        canyonWidth: [14, { canyons: 1 }],
        volcanoes: [1],
        caves: [1, { mountains: 0.8, squaresX: 3, squaresY: 3 }],
        rivers: [1],
        riverWidth: [18, { rivers: 1 }],
        riverValley: [0, { rivers: 1, mountains: 0.6 }],
        waterfalls: [0, { rivers: 2, mountains: 1, peakHeight: 255, squaresX: 3, squaresY: 3 }],
        cliffFalls: [1, { mountains: 0.8, squaresX: 3, squaresY: 3 }],
        lakes: [2],
        ponds: [6],
        trees: [1],
        treeClumping: [1],
        treeMix: [1],
        rocks: [1],
        rockMix: [1],
        grass: [1],
        dressing: [0],
        flatness: [0],
        sites: [0],
        flowers: [1],
        props: [1],
        roads: [0],
        roadStyle: ["spine", { roads: 1 }],
        roadWidth: [6, { roadStyle: "ring" }],
        roadCurviness: [1, { roadStyle: "ring" }],
        buildings: [1],
        towns: [2, { buildings: 1 }],
        townSize: [12, { buildings: 1, towns: 2 }],
        houses: [false, { buildings: 1 }],
        shops: [false, { buildings: 1 }],
        churches: [false, { buildings: 1, sites: 0 }],
        anyBuildings: [true, { buildings: 1 }],
        gardens: [1, { buildings: 1 }],
        ruins: [1],
        landmarks: [1],
        townWalls: [1, { towns: 1, buildings: 1 }],
        sideStreets: [1, { towns: 1, buildings: 1, townSize: 40, squaresX: 3, squaresY: 3 }],
        wallKit: [
            "varrock",
            {
                towns: 1,
                buildings: 1,
                townWalls: 1,
                wallKit: "falador",
                squaresX: 3,
                squaresY: 3,
            },
        ],
        waymarkers: [1, { roads: 1, sites: 0 }],
        spawnX: [0.1],
        spawnY: [0.1],
        waveSet: ["karamja"],
        enemyDensity: [3],
        brightness: [0.6],
    };
    const PLAY_SETTINGS = ["waveSet", "enemyDensity", "brightness"];

    it.each(Object.keys(CHANGES) as SettingKey[])(
        "does something with %s",
        (key) => {
            const [value, needs] = CHANGES[key] as [unknown, Partial<GeneratorSettings>?];
            const before = settings({ seed: 21, ...needs });
            const after = { ...before, [key]: value };
            if (PLAY_SETTINGS.includes(key)) {
                const was = generatedRecipe("a", 70, 134, before).play;
                expect(generatedRecipe("a", 70, 134, after).play).not.toEqual(was);
                return;
            }
            const a = generateMap(before, context);
            const b = generateMap(after, context);
            const sameSize = a.sizeX === b.sizeX && a.sizeY === b.sizeY;
            // Terrain in a square of it, and locs all over: a few things can be anywhere on a map
            const sameLocs =
                a.locs.length === b.locs.length &&
                a.locs.every((loc, i) => {
                    const { id, x, y, rotation } = b.locs[i];
                    return loc.id === id && loc.x === x && loc.y === y && loc.rotation === rotation;
                });
            const sameMap =
                sameSize &&
                writeTerrain(a, 64, 64).join() === writeTerrain(b, 64, 64).join() &&
                sameLocs;
            expect(sameMap).toBe(false);
            // Two maps each, a few seconds on the release runner
        },
        15_000,
    );

    it("runs land past the arena when the boundary isn't the sea", () => {
        const full = settings({ boundary: "forest", ponds: 0 });
        const grid = generateMap(full, context);
        const arena = getGeneratedArena(full);
        // Tiles at the arena's edge and well past it, all round
        for (const [x, y] of [
            [arena.x0 - 40, (arena.y0 + arena.y1) >> 1],
            [arena.x1 + 40, (arena.y0 + arena.y1) >> 1],
            [(arena.x0 + arena.x1) >> 1, arena.y0 - 40],
            [(arena.x0 + arena.x1) >> 1, arena.y1 + 40],
        ]) {
            expect(grid.levels[0].overlays[x + y * grid.sizeX]).toBe(0);
        }
        const trees = grid.locs.filter((loc) => loc.type === 10);
        expect(trees.some((loc) => loc.x < arena.x0)).toBe(true);
        expect(trees.some((loc) => loc.y > arena.y1)).toBe(true);
    });

    it("builds arenas that aren't square", () => {
        const full = settings({ squaresX: 1, squaresY: 3, rivers: 1 });
        const grid = generateMap(full, context);
        expect([grid.sizeX, grid.sizeY]).toEqual([3 * 64, 5 * 64]);
    });

    it("rejects the too small and too big", () => {
        expect(getSettingsError(settings({ squaresX: MAX_ARENA_SQUARES }))).toBeUndefined();
        expect(getSettingsError(settings({ squaresX: MAX_ARENA_SQUARES + 1 }))).toBeDefined();
        expect(getSettingsError(settings({ squaresY: 0 }))).toBeDefined();
    });

    it("says what's wrong with bad settings, and won't build them", () => {
        expect(getSettingsError(settings({}))).toBeUndefined();
        const bad: Partial<GeneratorSettings>[] = [
            { seed: NaN },
            { seed: -1 },
            { seed: 1.5 },
            { squaresX: 99 },
            { squaresX: 1.5 },
            { island: 2 },
            { ponds: NaN },
            { rivers: 9 },
            { boundary: "lava" as GeneratorSettings["boundary"] },
            { houses: 1 as unknown as boolean },
            { biome: "moon" as BiomeId },
        ];
        for (const overrides of bad) {
            const full = settings(overrides);
            expect(getSettingsError(full)).toBeDefined();
            expect(() => generateMap(full, context)).toThrow();
        }
    });

    it("refuses to make a map with too little ground to play on", () => {
        for (const seed of [1, 2, 3]) {
            const drowned = settings({ squaresX: 1, squaresY: 1, waterLevel: 1, island: 1, seed });
            expect(() => generateMap(drowned, context)).toThrow(/too little ground/);
        }
    });

    it("listens to its settings", () => {
        const count = (overrides: Partial<GeneratorSettings>) =>
            generateMap(settings(overrides), context).locs.filter((loc) => loc.type === 10).length;
        expect(count({ trees: 1, rocks: 1 })).toBeGreaterThan(count({ trees: 0, rocks: 0 }));
    });

    // Water tiles with corners off level, but for the drops at falls
    const countTilted = (overrides: Partial<GeneratorSettings>) => {
        const map = generateMapDetail(settings(overrides), context);
        const { grid, waterDrops = [] } = map;
        const { heights, overlays } = grid.levels[0];
        const cornersX = grid.sizeX + 1;
        const inDrop = (x: number, y: number) =>
            waterDrops.some(
                ({ x0, y0, x1, y1 }: TileRect) => x >= x0 && y >= y0 && x <= x1 && y <= y1,
            );
        let tilted = 0;
        for (let y = 0; y < grid.sizeY; y++) {
            for (let x = 0; x < grid.sizeX; x++) {
                const at = x + y * cornersX;
                const round = [at, at + 1, at + cornersX, at + cornersX + 1].map(
                    (corner) => heights[corner],
                );
                const flat = Math.max(...round) === Math.min(...round);
                if (WATER_OVERLAYS.has(overlays[x + y * grid.sizeX]) && !flat && !inDrop(x, y)) {
                    tilted++;
                }
            }
        }
        return { tilted, drops: waterDrops.length };
    };

    it.each<Partial<GeneratorSettings>>([
        { rivers: 2, ponds: 4, hills: 1, squaresX: 3, squaresY: 3 },
        { rivers: 2, lakes: 3, island: 0.3 },
        { mountains: 0.8, rivers: 2, peakHeight: 240, squaresX: 3, squaresY: 3 },
        { waterLevel: 0.6, rivers: 1, ponds: 4 },
    ])("lays water level, with only falls between levels: %o", (overrides) => {
        expect(countTilted(overrides).tilted).toBe(0);
    });

    it("runs a river with no falls at one level, end to end", () => {
        const flat = { mountains: 0.8, rivers: 1, peakHeight: 240, squaresX: 3, squaresY: 3 };
        const { tilted, drops } = countTilted({ ...flat, waterfalls: 0, cliffFalls: 0 });
        expect(tilted).toBe(0);
        expect(drops).toBe(0);
    });

    const CASES: Partial<GeneratorSettings>[] = [
        {},
        { squaresX: 1, squaresY: 1, island: 1 },
        { squaresX: 3, squaresY: 3, boundary: "forest", rivers: 2 },
        { squaresX: 1, squaresY: 3, boundary: "hills", rivers: 1 },
        { biome: "desert", boundary: "fence", ponds: 6 },
        { biome: "swamp", island: 0.2, rivers: 2, ponds: 6, trees: 1 },
        { biome: "snow", island: 0.6, rivers: 1, buildings: 1, trees: 1, rocks: 1 },
        { boundary: "forest", rivers: 2, buildings: 1, roads: 0 },
    ];
    const SEEDS = [1, 2, 3, 4, 5];

    it.each(CASES)(
        "leaves no open tile cut off from the spawn: %o",
        (overrides) => {
            for (const seed of SEEDS) {
                const full = settings({ ...overrides, seed });
                const grid = generateMap(full, context);
                const arena = getGeneratedArena(full);
                const spawn = getGeneratedSpawn(full);
                const flags = getCollisionFlags(grid, context.locs);
                const reached = findReachable(
                    flags,
                    grid.sizeX,
                    grid.sizeY,
                    arena,
                    spawn.x,
                    spawn.y,
                );
                expect(reached[spawn.x + spawn.y * grid.sizeX]).toBe(1);
                expect(findStranded(flags, grid.sizeX, arena, reached)).toEqual([]);
                // And it didn't get there by blocking the whole map
                expect(reached.reduce((sum, v) => sum + v, 0)).toBeGreaterThanOrEqual(300);
            }
        },
        30000,
    );
});

// Against the game's real collision and the real prefabs, when there's a cache.
// In a script, because the cache's loaders don't load under vitest.
describe.skipIf(!existsSync(`caches/${GAME_CACHE_NAME}`))("generated maps", () => {
    // Not to block the test runner, which gives up on a worker that goes quiet for a minute
    const run = promisify(execFile);
    // Node itself, as Windows has no plain `npx` to start
    const tsx = (script: string) => ["--import", "tsx", script];

    it("reach everywhere with the game's own collision", async () => {
        const { stdout } = await run(process.execPath, tsx("scripts/scaperune/check-maps.ts"), {
            encoding: "utf8",
            timeout: 400000,
        });
        expect(stdout).toContain("All open tiles reach the spawn");
    }, 410000);

    it("have every prefab's floor, in every rotation", async () => {
        const { stdout } = await run(process.execPath, tsx("scripts/scaperune/check-prefabs.ts"), {
            encoding: "utf8",
            timeout: 60000,
        });
        expect(stdout).toContain("check out in all 4 rotations");
    }, 70000);
});
