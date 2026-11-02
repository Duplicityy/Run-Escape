import { describe, expect, it } from "vitest";

import { Ground } from "./Ground";
import { BIOMES, BiomeId } from "./biomes";
import { findBannedLocs } from "./catalogue";
import {
    CITY_WALLS,
    CITY_WALL_IDS,
    CityGate,
    getGateColumns,
    getWallInset,
    getWallSide,
    placeCityWall,
} from "./cityWalls";
import { Clash, describeClashes, findClashes } from "./clashes";
import { findReachable, findStranded, getCollisionFlags, getStepGrid } from "./collision";
import { TILE_BLOCKED, TILE_SHOWN, createTileGrid, writeLocs, writeTerrain } from "./format";
import {
    DEFAULT_SETTINGS,
    GeneratorSettings,
    SETTING_PRESETS,
    generateMapDetail,
    getGeneratedArena,
    getGeneratedSpawn,
} from "./generator";
import { BRIDGES, PREFABS } from "./prefabs";
import type { BuildContext } from "./recipe";
import {
    RESERVE_LANE,
    RESERVE_PLOT,
    RESERVE_STREET,
    RESERVE_WALL,
    Reservations,
} from "./reservations";
import { OVERLAY_SHAPES } from "./shapes";
import { SET_PIECES, getPieceLocs } from "./structures";
import { GATE_CLEAR_IN, getGateClear } from "./townWalls";

// A world with no cache behind it: everything cut from it is one small walled room
const worldSquare = (() => {
    const grid = createTileGrid(64, 64);
    for (let at = 1; at < 8; at++) {
        grid.locs.push({ id: 1, type: 0, rotation: 3, level: 0, x: at, y: 1 });
        grid.locs.push({ id: 1, type: 0, rotation: 1, level: 0, x: at, y: 7 });
        grid.locs.push({ id: 1, type: 0, rotation: 0, level: 0, x: 1, y: at });
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

function expectAllReachable(full: GeneratorSettings): void {
    const { grid } = generateMapDetail(full, context);
    const arena = getGeneratedArena(full);
    const spawn = getGeneratedSpawn(full);
    const flags = getCollisionFlags(grid, context.locs);
    const reached = findReachable(flags, grid.sizeX, grid.sizeY, arena, spawn.x, spawn.y);
    expect(findStranded(flags, grid.sizeX, arena, reached)).toEqual([]);
}

describe("the catalogue", () => {
    const grid = (id: number, overlay: number) => {
        const out = createTileGrid(4, 4);
        out.levels[0].overlays[0] = overlay;
        out.locs.push({ id, type: 10, rotation: 0, level: 0, x: 0, y: 0 });
        return out;
    };

    it("finds a banned loc on any ground", () => {
        expect(findBannedLocs(grid(45881, 0))).toHaveLength(1);
        expect(findBannedLocs(grid(45881, 6))).toHaveLength(1);
    });

    it("lets sea rocks stand in water, and nowhere else", () => {
        expect(findBannedLocs(grid(60440, 0))).toHaveLength(1);
        expect(findBannedLocs(grid(60440, 442))).toEqual([]);
        expect(findBannedLocs(grid(1276, 0))).toEqual([]);
    });

    it.each(Object.keys(BIOMES))("%s names nothing banned", (id) => {
        const biome = BIOMES[id as keyof typeof BIOMES];
        const { rocks, props, rock } = biome;
        const ids = [...rocks, ...props, ...rock.rubble].map(([loc]) => loc);
        const out = createTileGrid(4, 4);
        for (const loc of [...ids, ...biome.decor, ...biome.flowers]) {
            out.locs.push({ id: loc, type: 10, rotation: 0, level: 0, x: 0, y: 0 });
        }
        expect(findBannedLocs(out)).toEqual([]);
    });
});

describe("biomes", () => {
    it.each(Object.keys(BIOMES))("%s only names what's there", (id) => {
        const biome = BIOMES[id as keyof typeof BIOMES];
        for (const name of [...biome.buildings, ...(biome.ruins ?? [])]) {
            expect(PREFABS[name], name).toBeDefined();
        }
        for (const name of biome.landmarks) {
            expect(SET_PIECES[name], name).toBeDefined();
        }
        expect(BRIDGES[biome.bridge]).toBeDefined();
        expect(biome.rock.pebbles.length).toBeGreaterThan(0);
        expect(biome.ruins ?? biome.buildings).not.toEqual([]);
    });

    it("has a preset for each that starts from it", () => {
        const shown = Object.values(SETTING_PRESETS).map((preset) => preset.biome ?? "meadow");
        expect(new Set(shown)).toEqual(new Set(Object.keys(BIOMES)));
    });

    it("keeps each piece of water one kind on a mixed map", () => {
        const full = settings({
            biome: "ash",
            secondBiome: "meadow",
            biomeMix: 0.5,
            squaresX: 3,
            squaresY: 3,
            rivers: 2,
            lakes: 3,
            buildings: 0,
        });
        const { grid } = generateMapDetail(full, context);
        const { flags, overlays } = grid.levels[0];
        const water = new Set([BIOMES.ash.water, BIOMES.meadow.water]);
        const { sizeX } = grid;
        const steps = overlays.reduce((count, overlay, i) => {
            const other = overlays[i + 1];
            const beside = flags[i] & TILE_BLOCKED && flags[i + 1] & TILE_BLOCKED;
            return beside && water.has(overlay) && water.has(other) && overlay !== other
                ? count + 1
                : count;
        }, 0);
        expect(sizeX).toBeGreaterThan(0);
        expect(steps).toBe(0);
    });

    it("paints each biome's own road on a mixed map", () => {
        const full = settings({
            biome: "desert",
            secondBiome: "snow",
            biomeMix: 0.5,
            squaresX: 4,
            squaresY: 4,
            roads: 1,
            roadStyle: "ring",
        });
        const { grid, roadTiles } = generateMapDetail(full, context);
        const used = new Set(
            grid.levels[0].overlays.filter((overlay, i) => roadTiles[i] && overlay !== 0),
        );
        expect(used).toEqual(new Set([BIOMES.desert.road, BIOMES.snow.road]));
    });
});

describe("set pieces", () => {
    it("has a size for every loc", () => {
        for (const piece of Object.values(SET_PIECES)) {
            for (const [id, across, deep] of getPieceLocs(piece)) {
                expect(id).toBeGreaterThan(0);
                expect(across * deep).toBeGreaterThan(0);
            }
        }
    });

    it.each(Object.keys(BIOMES))("leaves all of %s reachable with its set pieces", (id) => {
        expectAllReachable(
            settings({
                biome: id as keyof typeof BIOMES,
                landmarks: 1,
                hills: 0.1,
                squaresX: 3,
                squaresY: 3,
                lakes: 3,
                ruins: 0.5,
                seed: 4,
            }),
        );
    });

    it("leaves a way into a walled town", () => {
        for (const seed of [1, 2, 3]) {
            expectAllReachable(
                settings({
                    seed,
                    towns: 2,
                    townSize: 20,
                    townWalls: 1,
                    buildings: 1,
                    squaresX: 3,
                    squaresY: 3,
                    waymarkers: 1,
                }),
            );
        }
    });
});

describe("city walls", () => {
    const SIZE = 96;
    const rect = { x0: 24, y0: 28, x1: 70, y1: 64 };
    const inside = { x: 47, y: 46 };
    const gates: CityGate[] = [
        { side: "south", at: 48 },
        { side: "west", at: 44 },
        { side: "north", at: 48 },
        { side: "east", at: 44 },
    ];
    const flatGround = () => {
        const ground = new Ground(SIZE, SIZE);
        ground.level0.heights.fill(40);
        return ground;
    };
    const reaches = (ground: Ground) => {
        const flags = getCollisionFlags(ground.grid, context.locs);
        const whole = { x0: 1, y0: 1, x1: SIZE - 2, y1: SIZE - 2 };
        return findReachable(flags, SIZE, SIZE, whole, 2, 2)[inside.x + inside.y * SIZE] !== 0;
    };

    it.each(CITY_WALL_IDS)("%s keeps everything out but for its gates", (id) => {
        const shut = flatGround();
        placeCityWall(shut, CITY_WALLS[id], rect, []);
        expect(reaches(shut)).toBe(false);
        for (const gate of gates) {
            const open = flatGround();
            placeCityWall(open, CITY_WALLS[id], rect, [gate]);
            expect(reaches(open)).toBe(true);
        }
    });

    it.each(CITY_WALL_IDS)("%s stays sealed with its corners cut by different amounts", (id) => {
        const cut = { ...rect, cuts: [3, 9, 14, 6] };
        const shut = flatGround();
        placeCityWall(shut, CITY_WALLS[id], cut, []);
        expect(reaches(shut)).toBe(false);
        const seen = new Set<string>();
        for (const { x, y, level, type } of shut.grid.locs) {
            if (type <= 3) {
                const key = `${x},${y},${level}`;
                expect(seen.has(key), key).toBe(false);
                seen.add(key);
            }
        }
        const open = flatGround();
        placeCityWall(open, CITY_WALLS[id], cut, gates);
        expect(reaches(open)).toBe(true);
    });

    it.each(CITY_WALL_IDS)("%s has room for a crowd in each gate, straight through", (id) => {
        const kit = CITY_WALLS[id];
        const ground = flatGround();
        placeCityWall(ground, kit, rect, gates);
        const flags = getCollisionFlags(ground.grid, context.locs);
        const steps = getStepGrid(flags, SIZE, { x0: 1, y0: 1, x1: SIZE - 2, y1: SIZE - 2 });
        for (const gate of gates) {
            const { side, start } = getGateColumns(kit, rect, gate);
            let clear = 0;
            for (let along = start; along < start + kit.gateSize; along++) {
                let through = true;
                for (let across = -2; across <= kit.width + 2; across++) {
                    through &&= !steps.isSolid(side.x(along, across), side.y(along, across));
                }
                clear += through ? 1 : 0;
            }
            expect(clear).toBeGreaterThanOrEqual(4);
        }
    });

    it.each(CITY_WALL_IDS)("%s only puts one wall on a tile, as the scene can hold", (id) => {
        const ground = flatGround();
        placeCityWall(ground, CITY_WALLS[id], rect, gates);
        const seen = new Set<string>();
        for (const { x, y, level, type } of ground.grid.locs) {
            if (type <= 3) {
                const key = `${x},${y},${level}`;
                expect(seen.has(key), key).toBe(false);
                seen.add(key);
            }
        }
    });

    it.each(CITY_WALL_IDS)("%s shows everything over the ground, level by level", (id) => {
        const ground = flatGround();
        placeCityWall(ground, CITY_WALLS[id], rect, gates);
        const { levels, locs } = ground.grid;
        for (const { x, y, level } of locs) {
            if (level > 0) {
                expect(levels[level].flags[x + y * SIZE] & TILE_SHOWN).not.toBe(0);
            }
        }
        for (const i of levels[1].overlays.keys()) {
            if (levels[1].overlays[i] !== 0) {
                expect(levels[1].flags[i] & TILE_SHOWN).not.toBe(0);
            }
        }
    });

    it("blocks all of a thick wall's walkway, and takes nothing off the ground beside it", () => {
        const kit = CITY_WALLS.kourend;
        const ground = flatGround();
        placeCityWall(ground, kit, rect, gates);
        const flags = getCollisionFlags(ground.grid, context.locs);
        const steps = getStepGrid(flags, SIZE, { x0: 1, y0: 1, x1: SIZE - 2, y1: SIZE - 2 });
        const side = getWallSide(rect, 0);
        const along = getWallInset(kit) + 2;
        for (let across = 0; across < kit.width; across++) {
            expect(steps.isSolid(side.x(along, across), side.y(along, across))).toBe(true);
        }
        expect(steps.isSolid(side.x(along, -1), side.y(along, -1))).toBe(false);
        expect(steps.isSolid(side.x(along, kit.width), side.y(along, kit.width))).toBe(false);
    });

    it("stops short of what it can't stand on, with a cap", () => {
        const kit = CITY_WALLS.varrock;
        const ground = flatGround();
        const river = (x: number) => x >= 44 && x <= 50;
        placeCityWall(ground, kit, rect, [], (x) => river(x));
        const onRiver = ground.grid.locs.filter(({ x }) => river(x));
        expect(onRiver).toEqual([]);
        const caps = ground.grid.locs.filter(
            ({ x, y, type }) => x === 43 && y === 28 && type === 0,
        );
        expect(caps.length).toBeGreaterThan(0);
    });

    it("gives every gate a road through it, and at least two ways into a town", () => {
        for (const seed of [1, 2, 3]) {
            const walled = settings({
                seed,
                towns: 1,
                townSize: 24,
                townWalls: 1,
                buildings: 1,
                roads: 1,
                squaresX: 3,
                squaresY: 3,
            });
            const { walled: towns, roadTiles, grid } = generateMapDetail(walled, context);
            for (const town of towns ?? []) {
                expect(town.gates.length).toBeGreaterThanOrEqual(2);
                for (const gate of town.gates) {
                    const { side, start } = getGateColumns(town.kit, town, gate);
                    const middle = start + (town.kit.gateSize >> 1);
                    const i = side.x(middle, 0) + side.y(middle, 0) * grid.sizeX;
                    expect(roadTiles[i]).not.toBe(0);
                }
            }
        }
    });

    it("picks a wall by a town's buildings, then its biome", () => {
        const pickFor = (biome: BiomeId) => {
            const map = generateMapDetail(
                settings({
                    biome,
                    towns: 1,
                    townSize: 20,
                    townWalls: 1,
                    buildings: 1,
                    squaresX: 3,
                    squaresY: 3,
                }),
                context,
            );
            return map.walled?.[0]?.kit;
        };
        expect(CITY_WALLS.civitas.biomes).toContain("desert");
        const kit = pickFor("desert");
        if (kit) {
            expect(kit).toBe(CITY_WALLS.civitas);
        }
    });

    it("leaves a map alone that has no walled towns, whatever wall it's set to", () => {
        const plain = settings({ towns: 1, buildings: 1 });
        const set = { ...plain, wallKit: "kourend" as const };
        expect(generateMapDetail(set, context).grid.locs).toEqual(
            generateMapDetail(plain, context).grid.locs,
        );
    });
});

describe("the flow", () => {
    const CITY = {
        towns: 1,
        townSize: 40,
        townWalls: 1,
        buildings: 1,
        gardens: 1,
        roads: 1,
        landmarks: 1,
        ruins: 1,
        hills: 0.1,
        squaresX: 3,
        squaresY: 3,
    };

    it("lets nothing take a tile from what came before it", () => {
        const reserved = new Uint8Array(16);
        const claims = new Reservations(4, 4, reserved);
        claims.take(0, 0, 2, 2, RESERVE_WALL);
        claims.take(1, 1, 2, 2, RESERVE_PLOT);
        expect(claims.ranks[1 + 4]).toBe(RESERVE_WALL);
        expect(claims.ranks[2 + 8]).toBe(RESERVE_PLOT);
        expect(claims.isFree(0, 0, 1, 1)).toBe(false);
        expect(claims.isFree(3, 3, 1, 1)).toBe(true);
        expect(claims.isFree(3, 3, 2, 1)).toBe(false);
        expect(reserved[2 + 8]).toBe(1);
    });

    it("keeps what's only painted out of a plot, without keeping foliage out", () => {
        const reserved = new Uint8Array(16);
        const claims = new Reservations(4, 4, reserved);
        claims.markTile(5, RESERVE_LANE);
        expect(reserved[5]).toBe(0);
        expect(claims.isFree(1, 1, 1, 1)).toBe(false);
        expect(claims.hasNear(2, 1, 1, 1, 1, RESERVE_LANE)).toBe(true);
        expect(claims.hasNear(3, 3, 1, 1, 1, RESERVE_LANE)).toBe(false);
        expect(claims.hasNear(2, 1, 1, 1, 1, RESERVE_STREET)).toBe(false);
    });

    it.each([1, 2, 3, 4])("keeps a walled city to the rules, on seed %i", (seed) => {
        const map = generateMapDetail(settings({ ...CITY, seed }), context);
        expect(map.walled?.length).toBeGreaterThan(0);
        expect(describeClashes(findClashes(map, context.locs))).toEqual([]);
    });

    it.each([1, 2, 3])("keeps towns and hamlets to the same rules, on seed %i", (seed) => {
        const town = settings({ ...CITY, seed, townWalls: 0, roadStyle: "ring", towns: 2 });
        const hamlets = settings({ ...CITY, seed, townWalls: 0, towns: 0, sites: 1 });
        for (const full of [town, hamlets]) {
            const map = generateMapDetail(full, context);
            expect(map.buildings.length).toBeGreaterThan(0);
            expect(describeClashes(findClashes(map, context.locs))).toEqual([]);
        }
    });

    it.each([0, 0.5, 1])("keeps to the rules with side streets at %f", (sideStreets) => {
        const full = settings({ ...CITY, seed: 2, sideStreets });
        const map = generateMapDetail(full, context);
        expect(map.walled?.length).toBeGreaterThan(0);
        expect(describeClashes(findClashes(map, context.locs))).toEqual([]);
    });

    it("lays more street, and more buildings on it, with side streets up", () => {
        const city = (sideStreets: number) =>
            generateMapDetail(settings({ ...CITY, seed: 2, sideStreets }), context);
        const roads = (map: ReturnType<typeof city>) => map.roadTiles.reduce((a, b) => a + b, 0);
        const [none, most] = [city(0), city(1)];
        expect(roads(most)).toBeGreaterThan(roads(none));
        expect(most.buildings.length).toBeGreaterThanOrEqual(none.buildings.length);
    });

    it("fits a city's buildings inside its wall, and leaves each gate clear behind it", () => {
        const map = generateMapDetail(settings({ ...CITY, seed: 2 }), context);
        const town = map.walled![0];
        const members = map.buildings.filter(
            ({ x, y }) => x > town.x0 && x < town.x1 && y > town.y0 && y < town.y1,
        );
        expect(members.length).toBeGreaterThan(0);
        for (const gate of town.gates) {
            const [inside] = getGateClear(town.kit, town, gate);
            const deep = Math.max(inside.x1 - inside.x0, inside.y1 - inside.y0) + 1;
            expect(deep).toBeGreaterThanOrEqual(GATE_CLEAR_IN);
            for (const { x, y, sizeX, sizeY } of map.buildings) {
                const apart =
                    x > inside.x1 ||
                    y > inside.y1 ||
                    x + sizeX - 1 < inside.x0 ||
                    y + sizeY - 1 < inside.y0;
                expect(apart).toBe(true);
            }
        }
    });

    it("leaves things out sooner than break a rule", () => {
        const tight = settings({ ...CITY, seed: 3, townSize: 16, buildings: 1, squaresX: 5 });
        const map = generateMapDetail(tight, context);
        const wanted = Math.round(1 * 5 * 3 * 3);
        expect(map.buildings.length).toBeLessThanOrEqual(wanted);
        expect(describeClashes(findClashes(map, context.locs))).toEqual([]);
    });

    describe("what it finds", () => {
        const SIZE = 16;
        const full = OVERLAY_SHAPES.get(255)!;
        const blank = (): Parameters<typeof findClashes>[0] => {
            const grid = createTileGrid(SIZE, SIZE);
            return {
                grid,
                footprint: new Uint8Array(SIZE * SIZE),
                roadTiles: new Uint8Array(SIZE * SIZE),
                lines: [],
                buildings: [],
                landmarks: [],
                passes: [],
                walkSlope: 12,
                caves: [],
                falls: [],
                waterfalls: [],
            };
        };
        const paint = (map: ReturnType<typeof blank>, x: number, y: number, sides = 255) => {
            const i = x + y * SIZE;
            const [shape, rotation] = OVERLAY_SHAPES.get(sides) ?? full;
            map.roadTiles[i] = 1;
            map.grid.levels[0].shapes[i] = shape;
            map.grid.levels[0].rotations[i] = rotation;
        };
        const rules = (found: Clash[]) => found.map(({ rule }) => rule);

        it("a fence a road runs across", () => {
            const map = blank();
            paint(map, 5, 5);
            paint(map, 4, 5);
            const owner = { x0: 5, y0: 5, x1: 8, y1: 8 };
            map.fences = [{ x: 5, y: 5, rotation: 0, owner }];
            expect(rules(findClashes(map, context.locs))).toEqual(["fence"]);
        });

        it("not a road that runs along a fence", () => {
            const map = blank();
            paint(map, 4, 5);
            const owner = { x0: 5, y0: 5, x1: 8, y1: 8 };
            map.fences = [{ x: 5, y: 5, rotation: 0, owner }];
            expect(findClashes(map, context.locs)).toEqual([]);
        });

        it("not a road that's painted on the next tile, but stops short of the fence", () => {
            const map = blank();
            paint(map, 5, 5);
            // The western half of the tile: nothing reaches its east side, where the fence is
            paint(map, 4, 5, 135);
            const owner = { x0: 5, y0: 5, x1: 8, y1: 8 };
            map.fences = [{ x: 5, y: 5, rotation: 0, owner }];
            expect(findClashes(map, context.locs)).toEqual([]);
        });

        it("a fence on another building's plot", () => {
            const map = blank();
            const plot = { x0: 2, y0: 2, x1: 6, y1: 6 };
            map.buildings = [
                { name: "house", x: 3, y: 3, sizeX: 3, sizeY: 3, hasRoad: false, plot },
            ];
            const owner = { x0: 5, y0: 5, x1: 8, y1: 8 };
            map.fences = [{ x: 5, y: 5, rotation: 0, owner }];
            expect(rules(findClashes(map, context.locs))).toEqual(["fence"]);
        });

        it("a road on a yard, but not a building's own way out of it", () => {
            const map = blank();
            const plot = { x0: 2, y0: 2, x1: 9, y1: 9 };
            const exit = { x: 6, y: 7, outX: 0, outY: 1 };
            const building = {
                name: "house",
                x: 4,
                y: 4,
                sizeX: 4,
                sizeY: 3,
                hasRoad: true,
                exit,
                plot,
                yard: plot,
            };
            map.buildings = [building];
            paint(map, 6, 8);
            expect(findClashes(map, context.locs)).toEqual([]);
            paint(map, 3, 3);
            expect(rules(findClashes(map, context.locs))).toEqual(["road"]);
        });

        it("a road that only stops at a wall because painting does", () => {
            const map = blank();
            map.buildings = [{ name: "church", x: 3, y: 3, sizeX: 4, sizeY: 4, hasRoad: false }];
            map.clippedRoads = new Uint8Array(SIZE * SIZE);
            map.clippedRoads[3 + 3 * SIZE] = 1;
            const found = findClashes(map, context.locs);
            expect(rules(found)).toEqual(["road"]);
            expect(found[0]).toMatchObject({ x: 3, y: 3 });
        });

        it("nothing a recipe says is designed that way", () => {
            const map = blank();
            paint(map, 5, 5);
            paint(map, 4, 5);
            const owner = { x0: 5, y0: 5, x1: 8, y1: 8 };
            map.fences = [{ x: 5, y: 5, rotation: 0, owner }];
            map.designed = [{ x0: 4, y0: 4, x1: 6, y1: 6 }];
            expect(findClashes(map, context.locs)).toEqual([]);
        });

        it("says how many and where", () => {
            const lines = describeClashes([
                { rule: "wall", x: 1, y: 2, what: "loc 4 on a wall" },
                { rule: "wall", x: 3, y: 4, what: "loc 5 on a wall" },
            ]);
            expect(lines).toEqual([
                "2 wall clashes: loc 4 on a wall at 1,2; loc 5 on a wall at 3,4",
            ]);
        });
    });
});
