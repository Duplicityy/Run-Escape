import { Ground } from "./Ground";
import { BIOMES, BiomeDef } from "./biomes";
import { TileRect, blockTile, findReachable, findStranded, getCollisionFlags } from "./collision";
import { dressGround } from "./dress";
import { getFallDrop, placeFallPools, placeFalls } from "./falls";
import { MAP_SQUARE_SIZE, TILE_BLOCKED, TileGrid } from "./format";
import {
    LandformBounds,
    createRelief,
    flattenLand,
    getHillBoundaryRise,
    shapeCliffs,
} from "./landforms";
import {
    Build,
    LOC_FLOOR_DECORATION,
    LOC_NORMAL,
    LOC_WALL,
    MARGIN,
    SPAWN_CLEAR,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    WaterPaint,
    getTileList,
    getTouchedTiles,
    hasRelief,
    lerp,
    pick,
    pickBySize,
    refreshTileHeights,
} from "./mapBuild";
import {
    blockSteepGround,
    cutPasses,
    dressCliffs,
    finishHeights,
    getSnowLine,
    keepOffLava,
    levelLava,
    paintLava,
    paintRock,
    placeCaves,
} from "./mountains";
import { createNoise, createRng, distanceTo } from "./noise";
import { PathFinder, Point, addPathToField, smoothPath } from "./paths";
import { PrefabKit } from "./prefabs";
import { BuildContext, MapRecipe } from "./recipe";
import { RESERVE_WALL } from "./reservations";
import {
    MAX_BANK,
    createRivers,
    createWaterFields,
    createWaterLevels,
    getWaterDrops,
    holdWater,
    placeWaterfalls,
    riverCentre,
    sinkFresh,
    sinkSea,
} from "./rivers";
import { RoadLine, gradeRoads } from "./roadGrades";
import {
    BRIDGE_ROAD_HALF_WIDTH,
    ROAD_SHOULDER,
    ROAD_SMOOTHING,
    ROAD_STEEPEST,
    RoadNetwork,
    RoadStart,
    getMainRoadLine,
    layMainRoads,
    placeBridges,
} from "./roads";
import { DEFAULT_SETTINGS, GeneratorSettings, getSettingsError } from "./settings";
import { PlacedBuilding, PlacedFence, placeBuildings, placeRuins, planTowns } from "./settlements";
import {
    PAVING,
    PlacedPiece,
    placeSetPieces,
    placeWaterPieces,
    placeWaymarkers,
} from "./structures";
import { limitFaces } from "./terrain";
import { connectTown, createPace, createTownFade, getTownPaving } from "./townPlan";
import { WalledTown, getPaving, placeTownWalls } from "./townWalls";
import { placeVignettes } from "./vignettes";

export * from "./settings";

// Makes a whole map from a seed and settings. The same seed and settings give
// the same map, anywhere: everything random comes from the seed. It only uses
// what's in BIOMES, PREFABS and BRIDGES (palette.ts), so the slim cache can hold
// all that any seed could ask for. See CLAUDE.md.

export const FORD_HALF_WIDTH = 2;

// The spawn stays this far in from the arena's edge
const SPAWN_INSET = 14;

// A stranded piece of ground this big gets a ford. Smaller ones get blocked.
const MIN_STRANDED_PIECE = 150;

const MAX_FORDS = 16;

// Every so many tiles of a piece of water are looked at to see what it's in
const WATER_SAMPLE = 7;

// Fewer reachable tiles than this isn't a map you can play
const MIN_PLAYABLE_TILES = 300;

// Chances a tile of mountain gets a heap of rubble and a stone, with the setting at 1
const RUBBLE_CHANCE = 0.006;

const STONE_CHANCE = 0.12;

// Chance a tile gets something big, with the setting at 1, and how much the edge between two
// biomes frays, in the noise that divides them. That's about 8 tiles each way.
const PROP_CHANCE = 0.006;

const BIOME_FRAY = 0.16;

// Dressing runs last, on a seed of its own, so that it moves nothing else
const DRESS_SEED = 300;

// Where hills meet the arena's edge: chances a tile gets a heap of rock, or a heap or a stone
const HILL_RUBBLE = 0.14;

const HILL_STONES = 0.34;

export type { RoadLine };

// A field of crops: level ground, unless a recipe says it's meant to slope
export type PlacedField = TileRect & { slopes?: boolean };

// A road that's shut on purpose, on these tiles, and what shows it in the world
export type ClosedRoad = TileRect & { shownBy: "gate" | "rubble" | "broken end" };

// A map, and what check-maps.ts needs to hold it to the rules
export type GeneratedMap = {
    grid: TileGrid;
    // Tiles of buildings, walls included
    footprint: Uint8Array;
    roadTiles: Uint8Array;
    lines: RoadLine[];
    buildings: PlacedBuilding[];
    landmarks: PlacedPiece[];
    // Passes cut through cliffs
    passes: RoadLine[];
    walkSlope: number;
    caves: Point[];
    // Off cliffs, into pools
    falls: Point[];
    // Rivers' own
    waterfalls: Point[];
    // The tiles of water that drop at a fall, which are the only ones that can tilt
    waterDrops?: TileRect[];
    fields?: PlacedField[];
    closedRoads?: ClosedRoad[];
    // Towns' squares: paved, with things standing on them on purpose
    squares?: TileRect[];
    // Only the generator's towns: a hand-made map's own wall is its own business
    walled?: WalledTown[];
    // Fences that are part of a building's plot or a piece
    fences?: PlacedFence[];
    // Tiles of buildings a road wanted, which painting stopped it at
    clippedRoads?: Uint8Array;
    // Rectangles of tiles a recipe says are designed that way: check-maps.ts lets clashes on these
    // go. Nothing generated has any.
    designed?: TileRect[];
};

export function getGeneratedSize(settings: Pick<GeneratorSettings, "squaresX" | "squaresY">): {
    sizeX: number;
    sizeY: number;
} {
    return {
        sizeX: (settings.squaresX + MARGIN * 2) * MAP_SQUARE_SIZE,
        sizeY: (settings.squaresY + MARGIN * 2) * MAP_SQUARE_SIZE,
    };
}

export function getGeneratedArena(
    settings: Pick<GeneratorSettings, "squaresX" | "squaresY">,
): TileRect {
    const { sizeX, sizeY } = getGeneratedSize(settings);
    const min = MARGIN * MAP_SQUARE_SIZE;
    return { x0: min, y0: min, x1: sizeX - min - 1, y1: sizeY - min - 1 };
}

// Where the player starts: always kept open, and known without building
export function getGeneratedSpawn(
    settings: Pick<GeneratorSettings, "squaresX" | "squaresY" | "spawnX" | "spawnY">,
): Point {
    const arena = getGeneratedArena(settings);
    const place = (min: number, max: number, at: number) => {
        const inset = Math.min(SPAWN_INSET, (max - min) >> 1);
        return Math.round(min + inset + (max - min - inset * 2) * at);
    };
    return {
        x: place(arena.x0, arena.x1, settings.spawnX),
        y: place(arena.y0, arena.y1, settings.spawnY),
    };
}

function paintFloors(build: Build, toSea: Float32Array): void {
    const { settings, ground, sizeX, sizeY, biomeAt, terrain, relief, cliffs } = build;
    const patches = createNoise(settings.seed + 4);
    const edges = createNoise(settings.seed + 10, 2);
    const span = settings.groundPatches;
    const snowLine = getSnowLine(settings);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const biome = biomeAt(x, y);
            const i = ground.tile(x, y);
            // The noise bunches round the middle, so stretch it
            const patch = Math.min(Math.max((patches(x / span, y / span) - 0.3) / 0.4, 0), 0.999);
            let floor = biome.ground[Math.floor(patch * biome.ground.length)];
            if (getHillBoundaryRise(settings, build, x, y) > 0.08) {
                floor = biome.hillGround;
            }
            const edge = edges(x / 16, y / 16);
            const rocky = relief.mountain[terrain.corner(x, y)] > 0.25 + edge * 0.5 || cliffs[i];
            if (rocky) {
                floor = biome.rock.ground;
            }
            if (terrain.height[terrain.corner(x, y)] + edge * 40 > snowLine) {
                floor = biome.rock.snowGround;
            }
            ground.level0.underlays[i] = toSea[i] < 4 ? biome.shore : floor;
        }
    }
}

// What stops you at the arena's edge, other than the sea and the hills' ground. A fence
// runs round it; a forest and hills are in scatter.
function placeBoundary(build: Build, roadTiles: Uint8Array): void {
    const { settings, ground, arena } = build;
    if (settings.boundary !== "fence") {
        return;
    }
    const inset = settings.boundaryDepth;
    const x0 = arena.x0 + inset;
    const x1 = arena.x1 - inset;
    const y0 = arena.y0 + inset;
    const y1 = arena.y1 - inset;
    const fence = (x: number, y: number, rotation: number) => {
        // A way through for a road, as well as nothing in the water
        if (!ground.isWaterTile(x, y) && !roadTiles[ground.tile(x, y)]) {
            const { fence: id } = build.biomeAt(x, y);
            ground.grid.locs.push({ id, type: LOC_WALL, rotation, level: 0, x, y });
        }
    };
    for (let x = x0; x <= x1; x++) {
        fence(x, y0, WALL_SOUTH);
        fence(x, y1, WALL_NORTH);
    }
    for (let y = y0; y <= y1; y++) {
        fence(x0, y, WALL_WEST);
        fence(x1, y, WALL_EAST);
    }
}

function scatter(build: Build, water: Uint8Array): void {
    const { settings, ground, rng, arena, spawn, biomeNear, toEdge, sizeX, sizeY, relief } = build;
    const { terrain } = build;
    const snowLine = getSnowLine(settings);
    const clumpScale = lerp(8, 28, settings.treeClumping);
    const clumps = createNoise(settings.seed + 6);
    const flowerPatches = createNoise(settings.seed + 9, 1);
    const hillWander = createNoise(settings.seed + 11, 1);
    const clumpLine = lerp(0.5, 0.56, settings.treeClumping);
    const inClump = lerp(0.1, 0.4, settings.treeClumping);
    const outOfClump = lerp(0.1, 0, settings.treeClumping);
    const townFade = createTownFade(build);
    const paceAt = createPace(build);
    const place = (id: number, size: number, type: number, x: number, y: number) => {
        // A list's size for a loc isn't always all of it
        const { sizeX: across, sizeY: deep } = build.context.locs(id);
        const whole = Math.max(size, across, deep);
        const rotation = Math.floor(rng() * 4);
        if (whole === size || ground.isClear(x, y, whole, whole)) {
            ground.place({ id, type, rotation, level: 0, x, y }, whole, whole);
        }
    };
    // Past the arena there's only anything to see on land, and then it goes on
    const reach = settings.boundary === "sea" ? 24 : MARGIN * MAP_SQUARE_SIZE;
    const belt = settings.boundary === "forest";
    const stones = settings.boundary === "hills";
    const x0 = Math.max(arena.x0 - reach, 0);
    const y0 = Math.max(arena.y0 - reach, 0);
    const x1 = Math.min(arena.x1 + reach, sizeX - 2);
    const y1 = Math.min(arena.y1 + reach, sizeY - 2);
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const roll = rng();
            const i = ground.tile(x, y);
            if (water[i] || ground.level0.flags[i] & TILE_BLOCKED) {
                continue;
            }
            if (Math.hypot(x - spawn.x, y - spawn.y) < SPAWN_CLEAR) {
                continue;
            }
            const biome = biomeNear(x, y, rng());
            const edge = toEdge(x, y);
            const inBelt = belt && edge < settings.boundaryDepth;
            const clump = clumps(x / clumpScale, y / clumpScale);
            const density = clump > clumpLine ? inClump : outOfClump;
            // Trees thin out up the mountains, and stones take over
            const mountain = relief.mountain[terrain.corner(x, y)];
            const rocky = Math.min(mountain * 1.6, 1);
            if (rocky > 0) {
                const chance = settings.rubble * rocky;
                const { rubble, stones } = biome.rock;
                if (roll < chance * RUBBLE_CHANCE) {
                    const [id, size] = pick(rng, rubble);
                    if (ground.isClear(x - 1, y - 1, size + 2, size + 2)) {
                        place(id, size, LOC_NORMAL, x, y);
                    }
                    continue;
                }
                if (roll < chance * STONE_CHANCE && ground.isClear(x, y, 1, 1)) {
                    ground.grid.locs.push({
                        id: pick(rng, stones),
                        type: LOC_FLOOR_DECORATION,
                        rotation: Math.floor(rng() * 4),
                        level: 0,
                        x,
                        y,
                    });
                    continue;
                }
            }
            // Nothing grows on the snow, and trees take over from a town's buildings
            const bare = terrain.height[terrain.corner(x, y)] > snowLine ? 0 : 1 - rocky;
            const fade = townFade(x, y);
            const pace = inBelt ? 1 : paceAt(x, y);
            const treeChance = (inBelt ? 0.5 : settings.trees * density * pace) * bare * fade;
            const rockChance = settings.rocks * (clump < 0.44 ? 0.025 : 0.006) * fade * pace;
            const propChance = settings.props * PROP_CHANCE * bare * fade * pace;
            if (stones && edge + hillWander(x / 14, y / 14) * 8 < 5 && edge > -6) {
                // Rock heaped along the edge, where the ground gets too steep, in a line
                // that wanders so that it doesn't show the arena's edge
                if (roll < HILL_RUBBLE) {
                    const [id, size] = pick(rng, biome.rock.rubble);
                    if (ground.isClear(x, y, size, size)) {
                        place(id, size, LOC_NORMAL, x, y);
                    }
                } else if (roll < HILL_STONES && ground.isClear(x, y, 1, 1)) {
                    ground.grid.locs.push({
                        id: pick(rng, biome.rock.stones),
                        type: LOC_FLOOR_DECORATION,
                        rotation: Math.floor(rng() * 4),
                        level: 0,
                        x,
                        y,
                    });
                }
                continue;
            }
            if (roll < treeChance) {
                const [id, size] = inBelt
                    ? pick(rng, biome.trees)
                    : pickBySize(rng, biome.trees, settings.treeMix);
                // A tile's gap all round: this game needs room to run, and big trees
                // packed tight are a wall with dead ends. A forest's edge is one.
                const gap = inBelt ? 0 : 1;
                if (ground.isClear(x - gap, y - gap, size + gap * 2, size + gap * 2)) {
                    place(id, size, LOC_NORMAL, x, y);
                }
            } else if (roll < treeChance + rockChance) {
                const [id, size] = pickBySize(rng, biome.rocks, settings.rockMix);
                if (ground.isClear(x, y, size, size)) {
                    place(id, size, LOC_NORMAL, x, y);
                }
            } else if (roll < treeChance + rockChance + propChance) {
                const [id, size] = pick(rng, biome.props);
                if (ground.isClear(x - 1, y - 1, size + 2, size + 2)) {
                    place(id, size, LOC_NORMAL, x, y);
                }
            } else if (roll < treeChance + rockChance + propChance + settings.grass * 0.56 * bare) {
                if (ground.isClear(x, y, 1, 1)) {
                    ground.grid.locs.push({
                        id: pick(rng, biome.decor),
                        type: LOC_FLOOR_DECORATION,
                        rotation: Math.floor(rng() * 4),
                        level: 0,
                        x,
                        y,
                    });
                }
            } else if (
                rng() < settings.flowers * 0.4 * bare * pace &&
                flowerPatches(x / 9, y / 9) > 0.55 &&
                ground.isClear(x, y, 1, 1)
            ) {
                place(pick(rng, biome.flowers), 1, LOC_NORMAL, x, y);
            }
        }
    }
}

// Pieces of a list of tiles, joined by touching sides, biggest first
function groupTiles(tiles: number[], sizeX: number, count: number): number[][] {
    const left = new Uint8Array(count);
    for (const tile of tiles) {
        left[tile] = 1;
    }
    const pieces: number[][] = [];
    for (const start of tiles) {
        if (!left[start]) {
            continue;
        }
        left[start] = 0;
        const piece = [start];
        for (let at = 0; at < piece.length; at++) {
            const i = piece[at];
            for (const j of [i - 1, i + 1, i - sizeX, i + sizeX]) {
                if (left[j]) {
                    left[j] = 0;
                    piece.push(j);
                }
            }
        }
        pieces.push(piece);
    }
    return pieces.sort((a, b) => b.length - a.length);
}

// Which water each tile gets. A step in water's colour would show as a line across it, so
// each piece of water is all one kind: the kind of the biome most of it's in.
function getWaterOverlay(build: Build, tiles: Uint8Array): (x: number, y: number) => number {
    const { ground, sizeX, biomeAt } = build;
    const list = getTileList(tiles);
    const kinds = new Map<number, number>();
    for (const piece of groupTiles(list, sizeX, tiles.length)) {
        const counts = new Map<BiomeDef, number>();
        for (let at = 0; at < piece.length; at += WATER_SAMPLE) {
            const i = piece[at];
            const biome = biomeAt(i % sizeX, Math.floor(i / sizeX));
            counts.set(biome, (counts.get(biome) ?? 0) + 1);
        }
        const { water } = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        for (const i of piece) {
            kinds.set(i, water);
        }
    }
    return (x, y) => kinds.get(ground.tile(x, y)) ?? biomeAt(x, y).water;
}

// Paints water, as a piece at a time. It's painted twice: the first says what's in a piece.
function paintWater(build: Build, field: Float32Array): Uint8Array {
    const { ground } = build;
    const tiles = ground.paintField(field, 0, true);
    return ground.paintField(field, getWaterOverlay(build, tiles), true);
}

// Dries a band along a path, taking off anything standing there
function layFord(build: Build, path: number[], water: WaterPaint): void {
    const { ground, sizeX, sizeY, corners, biomeAt } = build;
    const points = path.map((i) => ({ x: (i % sizeX) + 0.5, y: Math.floor(i / sizeX) + 0.5 }));
    const line = smoothPath(points, 3, 3);
    const band = new Float32Array(corners.x * corners.y).fill(-4);
    addPathToField(band, corners.x, corners.y, line, FORD_HALF_WIDTH);
    for (let i = 0; i < band.length; i++) {
        water.field[i] = Math.min(water.field[i], -band[i]);
    }
    const ford = getTouchedTiles(band, sizeX, sizeY);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = ground.tile(x, y);
            if (ford[i] && !ground.footprint[i]) {
                ground.level0.underlays[i] = biomeAt(x, y).shore;
                ground.reserved[i] = 1;
            }
        }
    }
    ground.clearOverlay(water.tiles);
    const overlay = getWaterOverlay(build, water.tiles);
    water.tiles = ground.paintField(water.field, overlay, true, water.dry);
    blockSteepGround(build);
    ground.grid.locs = ground.grid.locs.filter(
        (loc) =>
            !ford[ground.tile(loc.x, loc.y)] ||
            loc.level !== 0 ||
            ground.footprint[ground.tile(loc.x, loc.y)],
    );
}

// Every open tile left must be reachable from the spawn: big pieces get a ford,
// and whatever's still cut off is blocked. Nobody can get next to a blocked tile
// from the other side, so it's never an invisible wall.
function connectGround(build: Build, water: WaterPaint, offLimits: Uint8Array): RoadLine[] {
    const { ground, context, arena, spawn, finder, cliffs } = build;
    const { grid, sizeX, sizeY } = ground;
    const fords: RoadLine[] = [];
    let flags = getCollisionFlags(grid, context.locs);
    let reached = findReachable(flags, sizeX, sizeY, arena, spawn.x, spawn.y);
    const cost = (x: number, y: number) => {
        const inArena = x >= arena.x0 && y >= arena.y0 && x <= arena.x1 && y <= arena.y1;
        const i = ground.tile(x, y);
        return inArena && !offLimits[i] && !cliffs[i] ? 1 : Infinity;
    };
    for (let count = 0; count < MAX_FORDS; count++) {
        const stranded = findStranded(flags, sizeX, arena, reached);
        // The biggest piece a ford can get to: cliffs can be in the way
        let path: number[] = [];
        for (const piece of groupTiles(stranded, sizeX, flags.length)) {
            if (piece.length < MIN_STRANDED_PIECE) {
                break;
            }
            const at = piece[0];
            const start = { x: at % sizeX, y: Math.floor(at / sizeX) };
            path = finder.find(start, cost, (i) => reached[i] !== 0);
            if (path.length > 0) {
                break;
            }
        }
        if (path.length === 0) {
            break;
        }
        layFord(build, path, water);
        fords.push({
            points: path.map((i) => ({ x: (i % sizeX) + 0.5, y: Math.floor(i / sizeX) + 0.5 })),
            lead: 0,
            halfWidth: FORD_HALF_WIDTH,
        });
        flags = getCollisionFlags(grid, context.locs);
        reached = findReachable(flags, sizeX, sizeY, arena, spawn.x, spawn.y);
    }
    for (const i of findStranded(flags, sizeX, arena, reached)) {
        blockTile(grid, i);
    }
    if (reached.reduce((sum, tile) => sum + tile, 0) < MIN_PLAYABLE_TILES) {
        throw new Error("These settings leave too little ground to play on.");
    }
    return fords;
}

function createBuild(settings: GeneratorSettings, context: BuildContext): Build {
    const { sizeX, sizeY } = getGeneratedSize(settings);
    const arena = getGeneratedArena(settings);
    const first = BIOMES[settings.biome];
    const second = settings.secondBiome === "none" ? first : BIOMES[settings.secondBiome];
    const regions = createNoise(settings.seed + 7, 2);
    const secondLine = 0.25 + settings.biomeMix * 0.5;
    const hasSecond = settings.secondBiome !== "none" && settings.biomeMix > 0;
    const corners = { x: sizeX + 1, y: sizeY + 1 };
    const bounds: LandformBounds = {
        corners,
        arena,
        spawn: getGeneratedSpawn(settings),
        toEdge: (x, y) => Math.min(x - arena.x0, arena.x1 + 1 - x, y - arena.y0, arena.y1 + 1 - y),
    };
    const relief = createRelief(settings, bounds);
    return {
        ...bounds,
        settings,
        context,
        ground: new Ground(sizeX, sizeY),
        rng: createRng(settings.seed),
        finder: new PathFinder(sizeX, sizeY),
        kit: new PrefabKit(context),
        sizeX,
        sizeY,
        biomeAt: hasSecond
            ? (x, y) => (regions(x / 60, y / 60) < secondLine ? second : first)
            : () => first,
        biomeNear: hasSecond
            ? (x, y, roll) =>
                  regions(x / 60, y / 60) + (roll - 0.5) * BIOME_FRAY < secondLine ? second : first
            : () => first,
        relief,
        terrain: relief.terrain,
        cliffs: new Uint8Array(sizeX * sizeY),
        heldCorners: new Uint8Array(corners.x * corners.y),
        faces: new Uint8Array(sizeX * sizeY),
        heldForNow: [],
        mainland: new Uint8Array(sizeX * sizeY).fill(1),
        tileHeights: new Float32Array(sizeX * sizeY),
        plots: [],
    };
}

export function generateMapDetail(
    settings: GeneratorSettings,
    context: BuildContext,
): GeneratedMap {
    const error = getSettingsError(settings);
    if (error) {
        throw new Error(error);
    }
    const build = createBuild(settings, context);
    const { ground, sizeX, sizeY, biomeAt, relief, terrain, corners } = build;

    const rivers = createRivers(build);
    const fields = createWaterFields(build, rivers, relief.hills);
    const seaTiles = getTouchedTiles(fields.sea, sizeX, sizeY);
    const freshTiles = getTouchedTiles(fields.fresh, sizeX, sizeY);
    const toSea = distanceTo(seaTiles, sizeX, sizeY, 8);
    const toFresh = distanceTo(freshTiles, sizeX, sizeY, MAX_BANK);
    sinkSea(build, toSea);
    const levels = createWaterLevels(
        build,
        rivers,
        fields.pools,
        fields.fresh,
        fields.flood,
        seaTiles,
    );
    sinkFresh(build, toFresh, levels, toSea);

    const waterField = fields.sea.map((value, i) => Math.max(value, fields.fresh[i]));
    const waterTiles = paintWater(build, waterField);
    const dry = new Uint8Array(waterTiles.length);
    const water: WaterPaint = { field: waterField, tiles: waterTiles, dry };
    holdWater(build, waterTiles);

    if (hasRelief(settings)) {
        build.cliffs.set(shapeCliffs(terrain, settings.walkSlope));
    } else {
        const slope = settings.walkSlope * 0.92;
        limitFaces(terrain.height, corners.x, corners.y, slope, build.heldCorners);
    }
    const passes = cutPasses(build);
    refreshTileHeights(build);
    paintFloors(build, toSea);

    const bridgeZone = new Uint8Array(waterTiles.length);
    const roads = new RoadNetwork(build, waterTiles, bridgeZone, dry);
    keepOffLava(build, roads.avoid);
    // With no roads to meet them, rivers are crossed by fords
    const bridgeStarts =
        settings.roads > 0
            ? placeBridges(build, rivers, waterTiles, bridgeZone, dry, roads.avoid)
            : [];
    // The flow every place goes through: see the guide. Site, walls and gates, main streets and
    // square, in planTowns. The roads between places come next, because gates are where they
    // arrive. Then plots, lanes, set pieces, and at the end of all this foliage and details.
    roads.plannedLine = getMainRoadLine(build);
    roads.arrivalPoints.push(...bridgeStarts.map(({ from }) => from));
    const plans = planTowns(build, roads, waterTiles);
    if (settings.roads > 0) {
        layMainRoads(build, roads, bridgeZone);
        const byDistance = (a: RoadStart, b: RoadStart) =>
            Math.hypot(a.from.x - build.spawn.x, a.from.y - build.spawn.y) -
            Math.hypot(b.from.x - build.spawn.x, b.from.y - build.spawn.y);
        for (const { from, lead, height } of bridgeStarts.sort(byDistance)) {
            roads.lay(from, lead, roads.findRoute(from, lead), BRIDGE_ROAD_HALF_WIDTH, height);
        }
        plans.plans.forEach((plan) => connectTown(build, roads, plan));
        roads.finishCuts();
    }
    const buildings = placeBuildings(build, roads, waterTiles, plans);
    placeVignettes(build, buildings);
    const landmarks = placeSetPieces(build, roads, waterTiles);
    placeRuins(build, roads, waterTiles);
    const falls = placeFallPools(build, water);
    levelLava(build);
    const walled = plans.plans.flatMap(({ wall }) => (wall ? [wall] : []));
    const steepest = settings.walkSlope * ROAD_STEEPEST;
    gradeRoads(terrain, [...roads.lines, ...passes], build.plots, ROAD_SHOULDER, steepest);
    roads.pinTiles(passes);
    terrain.smoothPins(ROAD_SMOOTHING);
    // After the roads are graded, so that they don't have levels to fight, and settling then
    // brings the ground to them
    flattenLand(terrain, build.cliffs, build.heldCorners, settings.flatness, settings.walkSlope);
    finishHeights(build);
    roads.easeTiles(passes);
    blockSteepGround(build);

    const paving = (x: number, y: number) =>
        getTownPaving(build, x, y) || getPaving(walled, x, y)
            ? (biomeAt(x, y).paving ?? PAVING)
            : undefined;
    const roadTiles = settings.roads > 0 ? roads.paint(paving) : new Uint8Array(waterTiles.length);
    const rockSkip = new Uint8Array(waterTiles.length);
    for (let i = 0; i < rockSkip.length; i++) {
        rockSkip[i] = waterTiles[i] | roadTiles[i] | ground.footprint[i] | bridgeZone[i];
    }
    const rock = paintRock(build, rockSkip);
    const caves = placeCaves(build, rock);
    paintLava(build);
    placeWaterfalls(build, rivers);
    placeFalls(build, falls);
    dressCliffs(build, rock, rockSkip, falls);
    placeBoundary(build, roadTiles);
    placeTownWalls(build, walled);
    placeWaymarkers(build, roads);
    landmarks.push(...placeWaterPieces(build, waterTiles, bridgeZone));
    scatter(build, waterTiles);
    const fords = connectGround(build, water, roads.offLimits);
    dressGround(ground, {
        seed: settings.seed + DRESS_SEED,
        density: settings.dressing,
        biomeDecor: (x, y) => biomeAt(x, y).decor,
    });
    // What's meant to stand on a road: a gate's own parts, and what's in a square
    roads.clearLocs(roadTiles, (x, y) => {
        const onSquare = roads.squares.some(
            (rect) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1,
        );
        return onSquare || ground.claims.ranks[ground.tile(x, y)] === RESERVE_WALL;
    });
    return {
        grid: ground.grid,
        footprint: ground.footprint,
        roadTiles,
        lines: [...roads.lines, ...fords],
        squares: roads.squares,
        buildings,
        landmarks,
        passes,
        walkSlope: settings.walkSlope,
        caves,
        falls,
        walled,
        fences: build.fences,
        clippedRoads: roads.clipped,
        waterDrops: [...getWaterDrops(build, rivers), ...falls.map((fall) => getFallDrop(fall))],
        waterfalls: rivers.flatMap((river) =>
            river.drops.map(({ along }) => {
                const across = riverCentre(river, along);
                return river.vertical ? { x: across, y: along } : { x: along, y: across };
            }),
        ),
    };
}

export function generateMap(settings: GeneratorSettings, context: BuildContext): TileGrid {
    return generateMapDetail(settings, context).grid;
}

// A generated map as a recipe, at the map squares from (mapX, mapY)
export function generatedRecipe(
    id: string,
    mapX: number,
    mapY: number,
    settings: Partial<GeneratorSettings> & { seed: number },
): MapRecipe {
    const full: GeneratorSettings = { ...DEFAULT_SETTINGS, ...settings };
    return {
        id,
        mapX,
        mapY,
        squaresX: full.squaresX + MARGIN * 2,
        squaresY: full.squaresY + MARGIN * 2,
        margin: MARGIN,
        spawn: getGeneratedSpawn(full),
        build: (context) => generateMap(full, context),
        play: {
            waveSet: full.waveSet,
            enemyDensity: full.enemyDensity,
            brightness: full.brightness,
        },
    };
}
