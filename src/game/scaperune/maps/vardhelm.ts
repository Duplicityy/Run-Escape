import { Ground } from "../Ground";
import { BIOMES, BiomeDef, CLIFF_FALL } from "../biomes";
import { Exit } from "../building";
import { TileRect, blockTile, findReachable, findStranded, getCollisionFlags } from "../collision";
import { dressGround, dressRock, paintRockFloor } from "../dress";
import {
    FALL_ROWS,
    getFallDrop,
    getFallSeat,
    getSeatHeight,
    getSeatTiles,
    placeFalls,
    seatFall,
} from "../falls";
import { TILE_BLOCKED, TILE_BRIDGE } from "../format";
import { GeneratedMap } from "../generator";
import { shapeCliffs } from "../landforms";
import {
    Build,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    getTouchedTiles,
    lerp,
    smoothstep,
} from "../mapBuild";
import { blockSteepGround, finishHeights, getSnowLine } from "../mountains";
import { createNoise, createRidged, createRng, distanceTo, smoothField } from "../noise";
import { PathFinder, Point } from "../paths";
import { PREFABS, PrefabDef, PrefabKit } from "../prefabs";
import { BuildContext, MapRecipe } from "../recipe";
import { MAX_BANK, River, holdWater, sinkFresh } from "../rivers";
import { RoadLine } from "../roadGrades";
import { BRIDGE_ROAD_HALF_WIDTH, RoadNetwork, placeBridges } from "../roads";
import { DEFAULT_SETTINGS, GeneratorSettings } from "../settings";
import { PlacedBuilding, pinPlot } from "../settlements";
import { FOUNTAIN, PAVING, placeWaymarkers } from "../structures";
import { Terrain, getTileSlope, spreadNearest } from "../terrain";

// Vardhelm, a hand-made map: a kingdom that climbs a mountain from south to north, so that
// every cliff faces the camera. Nothing here's generated: the land's carved by hand out of
// a solid massif, each basin an outline with its own height, and the road's stops and
// heights, the river's course and falls, and every building's plot are all written down.

const SQUARES_X = 5;
const SQUARES_Y = 6;
const SIZE_X = SQUARES_X * 64;
const SIZE_Y = SQUARES_Y * 64;
const ARENA: TileRect = { x0: 64, y0: 64, x1: 255, y1: 319 };
const SPAWN: Point = { x: 112, y: 100 };
// Points along a road from a bridge's width to its own
const ROAD_WIDEN = 12;
// The walled city, in tiles
const CITY: TileRect = { x0: 170, y0: 248, x1: 244, y1: 315 };
// Where a rockfall stops the road south, out to the arena's edge
const ROCKFALL: TileRect = { x0: 100, y0: 64, x1: 116, y1: 71 };
// Keep Le Faye's wall, and the round towers at its door
const CITY_WALL = 1911;
const CITY_TOWER = 1867;
const TOWER_SPACING = 7;
const VALE_GRASS = [48, 99, 100];
const SHELF_GRASS = [52, 48, 100];
// Floes on the tarn
const FLOES = [60404, 60405];
// Underlays for rock, going up. The renderer blends hues, so that brown running straight
// into the snow's blue passes through a bright green: the greys come between them.
const BROWN_ROCK = 92;
const DRY_ROCK = [171, 172];
const GREY_ROCK = 111;
const NEUTRAL_SNOW = 58;
const SNOW_FROM = 205;
const FIELD_FENCE = BIOMES.meadow.fence;
const GREAT_BOULDER = 11433;
const PARAPET = 1902;
const GUARD = 818;
const SHRINE_CRYSTAL = 27878;
const STONES = [34780, 34781, 7016];
const GRAVES = [404, 405, 401, 400];
const LOW_TREES: [number, number][] = BIOMES.meadow.trees;
const PINES: [number, number][] = [
    [2091, 2],
    [2092, 3],
];
const HIGH_PINES: [number, number][] = [
    [1319, 3],
    [2092, 3],
    [1318, 3],
];
const SNOW_TREES: [number, number][] = [...BIOMES.snow.trees, [1318, 3]];
const SNOW_FLATS = BIOMES.snow.decor;

// Buildings from the real world that only this map has
export const VARDHELM_PREFABS: Record<string, PrefabDef> = {
    ...PREFABS,
    // Camelot
    camelot_keep: { worldX: 2745, worldY: 3489, sizeX: 27, sizeY: 30 },
    // Falador's party hall
    falador_hall: { worldX: 3035, worldY: 3370, sizeX: 22, sizeY: 17 },
    seers_church: { worldX: 2703, worldY: 3486, sizeX: 13, sizeY: 14 },
    // Keep Le Faye
    lefaye_keep: { worldX: 2762, worldY: 3394, sizeX: 16, sizeY: 17 },
    falador_houses: { worldX: 3044, worldY: 3351, sizeX: 10, sizeY: 18 },
    seers_pub: { worldX: 2688, worldY: 3487, sizeX: 14, sizeY: 13 },
};

// How high the three levels of the kingdom stand, and the river on each
const VALE = 46;
const SHELF = 90;
const HIGH = 216;
const RIVER_VALE = 16;
const RIVER_SHELF = 60;
// The ledge the great fall lands on halfway up
const RIVER_LEDGE = 123;
const RIVER_HIGH = 186;
const SHRINE = 232;

const SETTINGS: GeneratorSettings = {
    ...DEFAULT_SETTINGS,
    seed: 1187,
    squaresX: SQUARES_X - 2,
    squaresY: SQUARES_Y - 2,
    mountains: 1,
    peakHeight: 255,
    snow: 0.46,
    roadWidth: 2.2,
    waymarkers: 0.6,
    rockFaces: 0,
    riverValley: 0.6,
};

// The River Silverrun: where it runs for each row, north to south, straight at the bridges.
// [row, column, half width]
const COURSE: [number, number, number][] = [
    [0, 176, 6],
    [64, 168, 6],
    [84, 150, 5],
    [88, 150, 4.5],
    [112, 150, 4.5],
    [124, 145, 6],
    [138, 140, 6],
    [147, 139.5, 4.5],
    [151, 139.5, 4.5],
    [160, 137, 4],
    [172, 128, 4.5],
    [184, 126, 4.5],
    [208, 126, 4.5],
    [218, 129, 4],
    [228, 132, 5],
    [236, 133.5, 4.5],
    [245, 133.5, 4.5],
    [255, 146, 4.5],
    [274, 146, 4.5],
    [286, 142, 5],
    [300, 140, 5],
];
const CROSSINGS = [100, 196, 262];
// Where it falls: side by side across the river from x, on seats, so that the river's rows from
// foot to lip are level across and go by getSeatHeight. A fall's as tall as its model, so the
// great fall's two, one on the other's lip.
// They overlap by a tile, or the join shows the dark inside of a model's edge.
const FALL_STEP = 2;
const FALLS = [
    { foot: 147, x: 136, models: 3, seat: getFallSeat(RIVER_VALE, RIVER_SHELF)! },
    { foot: 236, x: 130, models: 3, seat: getFallSeat(RIVER_SHELF, RIVER_LEDGE)! },
    { foot: 240, x: 130, models: 3, seat: getFallSeat(RIVER_LEDGE, RIVER_HIGH)! },
];

// A pool of its own under a cliff, for a fall with no river behind it
const POOLS = [
    { x: 214, y: 225, across: 6, out: 4, level: 72 },
    // What feeds it, up on the cliff's lip
    { x: 214, y: 234, across: 4, out: 3, level: 137 },
    // Aldmere Water
    { x: 204, y: 90, across: 19, out: 12, level: 26 },
];
// The fall from one to the other
const POOL_FALL = { x: 213, y: 227, seat: getFallSeat(72, 137)! };

function getCourse(y: number): { centre: number; half: number } {
    let i = 0;
    while (i + 2 < COURSE.length && COURSE[i + 1][0] < y) {
        i++;
    }
    const [y0, x0, half0] = COURSE[i];
    const [y1, x1, half1] = COURSE[i + 1];
    const t = smoothstep((y - y0) / (y1 - y0));
    return { centre: lerp(x0, x1, t), half: lerp(half0, half1, t) };
}

function getRiverLevel(y: number): number {
    let level = RIVER_VALE;
    for (const { foot, seat } of FALLS) {
        if (y >= foot) {
            level = getSeatHeight(seat, y - foot);
        }
    }
    return level;
}

// A piece of the land, carved out of the massif: an outline, tiles the ground takes to come
// down to it at its edge, and how high it stands
type Basin = { outline: Point[]; edge: number; height: (x: number, y: number) => number };

function outline(...points: [number, number][]): Point[] {
    return points.map(([x, y]) => ({ x, y }));
}

// Tiles in from an outline's edge, negative outside
function toOutline(points: Point[], x: number, y: number): number {
    let inside = false;
    let nearest = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
        const wayX = b.x - a.x;
        const wayY = b.y - a.y;
        const t = Math.min(
            Math.max(((x - a.x) * wayX + (y - a.y) * wayY) / (wayX * wayX + wayY * wayY), 0),
            1,
        );
        nearest = Math.min(nearest, Math.hypot(x - a.x - wayX * t, y - a.y - wayY * t));
    }
    return inside ? nearest : -nearest;
}

// The King's Stair: rows of road, each a bench cut along the mountain with a cliff above it.
// Each row's [row, height at its west end, height at its east end].
const STAIR_WEST = 84;
const STAIR_EAST = 112;
const STAIR_ROWS: [number, number, number][] = [
    [212, 130, 92],
    [223, 150, 172],
    [234, 210, 190],
    [245, 216, 228],
];
// Half the width of a bench: past that it's the cliff up to the next
const BENCH = 4;
const stairWander = createNoise(SETTINGS.seed + 12, 1);

function getStairHeight(x: number, y: number): number {
    const along = Math.min(Math.max((x - STAIR_WEST) / (STAIR_EAST - STAIR_WEST), -0.3), 1.3);
    const rowHeight = ([, west, east]: [number, number, number]) => lerp(west, east, along);
    let row = 0;
    while (row + 1 < STAIR_ROWS.length && y > STAIR_ROWS[row + 1][0]) {
        row++;
    }
    const from = STAIR_ROWS[row];
    const to = STAIR_ROWS[Math.min(row + 1, STAIR_ROWS.length - 1)];
    const foot = from[0] + BENCH + (stairWander(x / 9, row * 7.3) - 0.5) * 2.4;
    const top = to[0] - BENCH + (stairWander(x / 7, row * 7.3 + 3) - 0.5) * 2.4;
    const t = to === from ? 0 : smoothstep((y - foot) / (top - foot));
    // Gullies down the face, for the light to catch
    const gully = (stairWander(x / 3.5, row * 3.1 + 11) - 0.5) * 22 * t * (1 - t) * 4;
    return lerp(rowHeight(from), rowHeight(to), t) + gully;
}

function getBasins(): Basin[] {
    const swell = createNoise(SETTINGS.seed + 1, 2);
    const drifts = createNoise(SETTINGS.seed + 11, 2);
    const hills = (x: number, y: number, amount: number) => (swell(x / 26, y / 26) - 0.5) * amount;
    return [
        // The Vale of Aldmere
        {
            outline: outline(
                [84, 76],
                [118, 70],
                [150, 68],
                [190, 70],
                [232, 74],
                [244, 96],
                [240, 118],
                [222, 130],
                [196, 136],
                [164, 142],
                [128, 144],
                [96, 136],
                [78, 112],
            ),
            edge: 6,
            height: (x, y) => VALE + hills(x, y, 12),
        },
        // Hillfoot: the long way up to the shelf
        {
            outline: outline([200, 104], [236, 104], [242, 192], [204, 192]),
            edge: 5,
            height: (_, y) => lerp(VALE, SHELF, Math.min(Math.max((y - 118) / 52, 0), 1)),
        },
        // The Shelf, under the city's cliff
        {
            outline: outline(
                [92, 160],
                [124, 154],
                [158, 156],
                [196, 166],
                [206, 174],
                [238, 178],
                [240, 204],
                [224, 226],
                [190, 232],
                [150, 233],
                [126, 232],
                [124, 214],
                [80, 214],
                [76, 186],
            ),
            edge: 4,
            height: (x, y) => SHELF + hills(x, y, 8),
        },
        // The Anvil, a crag standing up out of the Shelf
        {
            outline: outline(
                [158, 204],
                [172, 201],
                [182, 209],
                [179, 220],
                [165, 222],
                [155, 213],
            ),
            edge: 3,
            height: (x, y) => SHELF + 54 + hills(x, y, 14),
        },
        // The King's Stair
        {
            outline: outline([68, 205], [127, 205], [127, 254], [68, 254]),
            edge: 3,
            height: getStairHeight,
        },
        // The heights: Widow's Field, the city, and the tarn
        {
            outline: outline(
                [86, 245],
                [124, 245],
                [150, 244],
                [200, 243],
                [250, 250],
                [250, 300],
                [244, 318],
                [224, 318],
                [176, 318],
                [166, 306],
                [120, 300],
                [90, 296],
                [76, 270],
            ),
            edge: 3,
            height: (x, y) => {
                const inCity = x >= CITY.x0 - 2 && y >= CITY.y0 - 2;
                return HIGH + (inCity ? 0 : (drifts(x / 11, y / 11) - 0.5) * 16);
            },
        },
        // The way up to the Frosthorn's shrine
        {
            outline: outline([86, 288], [116, 288], [114, 316], [84, 316]),
            edge: 3,
            height: (_, y) => lerp(HIGH, SHRINE, smoothstep((y - 288) / 10)),
        },
    ];
}

// The whole of the land before anything's carved out of it, and how much of each corner's
// still massif
function shapeLand(terrain: Terrain): Float32Array {
    const { cornersX, cornersY, height } = terrain;
    const ridges = createRidged(SETTINGS.seed + 2, 4, 0.5);
    const bulk = createNoise(SETTINGS.seed + 3, 2);
    const fray = createNoise(SETTINGS.seed + 4, 2);
    const gullies = createNoise(SETTINGS.seed + 10, 2);
    const basins = getBasins();
    const massif = new Float32Array(height.length);
    for (let y = 0; y < cornersY; y++) {
        for (let x = 0; x < cornersX; x++) {
            const north = smoothstep((y - 30) / 280);
            const ridge = ridges(x / 70, y / 70);
            const gully = (gullies(x / 8, y / 26) - 0.5) * 26;
            let land =
                lerp(120, 225, north) + ridge * 90 + (bulk(x / 40, y / 40) - 0.5) * 50 + gully;
            if (land > 205) {
                land = 205 + 50 * (1 - Math.exp(-(land - 205) / 50));
            }
            let solid = 1;
            const frayed = (fray(x / 17, y / 17) - 0.5) * 7;
            for (const basin of basins) {
                const t = smoothstep((toOutline(basin.outline, x, y) + frayed) / basin.edge);
                if (t > 0) {
                    land = lerp(land, basin.height(x, y), t);
                    solid = Math.min(solid, 1 - t);
                }
            }
            const at = x + y * cornersX;
            height[at] = land;
            massif[at] = solid;
        }
    }
    return massif;
}

// The rows of corners in a fall that aren't water: from its seat up to its lip
function isFallRow(y: number, foot: number): boolean {
    return y > foot + 1 && y < foot + FALL_ROWS;
}

// Where the water goes: above 0 is water. rock leaves the falls' rows out of it.
function getWaterField(terrain: Terrain, rock: boolean): Float32Array {
    const { cornersX, cornersY } = terrain;
    const field = new Float32Array(cornersX * cornersY).fill(-100);
    for (let y = 0; y < cornersY; y++) {
        const { centre, half } = getCourse(y);
        for (let x = 0; x < cornersX; x++) {
            field[x + y * cornersX] = half - Math.abs(x - centre);
        }
    }
    const shore = createNoise(SETTINGS.seed + 5, 2);
    for (let y = 278; y < 320; y++) {
        for (let x = 110; x < 176; x++) {
            const away = Math.hypot((x - 138) / 1.2, y - 298);
            const edge = 13 + (shore(x / 20, y / 20) - 0.5) * 8 - away;
            field[x + y * cornersX] = Math.max(field[x + y * cornersX], edge);
        }
    }
    for (const { x: poolX, y: poolY, across, out } of POOLS) {
        for (let y = poolY - out * 2; y <= poolY + out * 2; y++) {
            for (let x = poolX - across * 2; x <= poolX + across * 2; x++) {
                const wobble = (shore(x / 24, y / 24) - 0.5) * 0.5;
                const away = Math.hypot((x - poolX) / across, (y - poolY) / out);
                const reach = (1 + wobble - away) * out;
                field[x + y * cornersX] = Math.max(field[x + y * cornersX], reach);
            }
        }
    }
    const smoothed = smoothField(field, cornersX, cornersY, 2);
    // Not across a fall's lip and foot: those are straight lines across the river
    if (rock) {
        for (let y = 0; y < cornersY; y++) {
            if (FALLS.some(({ foot }) => isFallRow(y, foot))) {
                smoothed.fill(-4, y * cornersX, (y + 1) * cornersX);
            }
        }
    }
    return smoothed;
}

type Stop = [x: number, y: number, height: number];

// A smooth line through stops, a point every half a tile or so, with its heights
function drawRoad(stops: Stop[]): { points: Point[]; heights: number[] } {
    const points: Point[] = [];
    const heights: number[] = [];
    const at = (i: number) => stops[Math.min(Math.max(i, 0), stops.length - 1)];
    for (let i = 0; i + 1 < stops.length; i++) {
        const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2);
        for (let step = 0; step < steps; step++) {
            const t = step / steps;
            const curve = (axis: number) =>
                0.5 *
                (2 * p1[axis] +
                    (p2[axis] - p0[axis]) * t +
                    (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t +
                    (3 * p1[axis] - p0[axis] - 3 * p2[axis] + p3[axis]) * t * t * t);
            points.push({ x: curve(0), y: curve(1) });
            heights.push(lerp(p1[2], p2[2], t));
        }
    }
    const last = stops[stops.length - 1];
    points.push({ x: last[0], y: last[1] });
    heights.push(last[2]);
    return { points, heights };
}

// Rounds off the creases where a road's grade changes. The ends stay.
function easeHeights(heights: number[], reach: number): number[] {
    let eased = heights;
    for (let pass = 0; pass < 2; pass++) {
        const from = eased;
        eased = from.map((height, i) => {
            const span = Math.min(reach, i, from.length - 1 - i);
            let sum = 0;
            for (let j = i - span; j <= i + span; j++) {
                sum += from[j];
            }
            return sum / (span * 2 + 1);
        });
    }
    return eased;
}

function pinRoad(terrain: Terrain, line: RoadLine, shoulder: number): void {
    terrain.pinLine(line.points, line.heights!, line.halfWidth + shoulder);
}

function createBuild(context: BuildContext): Build {
    const corners = { x: SIZE_X + 1, y: SIZE_Y + 1 };
    const terrain = new Terrain(corners.x, corners.y);
    const low: BiomeDef = BIOMES.meadow;
    const middle: BiomeDef = { ...BIOMES.meadow, bridge: "timber" };
    const high: BiomeDef = BIOMES.snow;
    const biomeAt = (x: number, y: number) => {
        const height = terrain.getHeight(x, y);
        return height < 70 ? low : height < 170 ? middle : high;
    };
    return {
        settings: SETTINGS,
        context,
        ground: new Ground(SIZE_X, SIZE_Y),
        rng: createRng(SETTINGS.seed),
        finder: new PathFinder(SIZE_X, SIZE_Y),
        kit: new PrefabKit(context, VARDHELM_PREFABS),
        sizeX: SIZE_X,
        sizeY: SIZE_Y,
        corners,
        spawn: SPAWN,
        arena: ARENA,
        biomeAt,
        biomeNear: biomeAt,
        toEdge: (x, y) => Math.min(x - ARENA.x0, ARENA.x1 + 1 - x, y - ARENA.y0, ARENA.y1 + 1 - y),
        relief: {
            terrain,
            mountain: new Float32Array(corners.x * corners.y),
            craters: [],
            hills: () => 0,
        },
        terrain,
        cliffs: new Uint8Array(SIZE_X * SIZE_Y),
        heldCorners: new Uint8Array(corners.x * corners.y),
        faces: new Uint8Array(SIZE_X * SIZE_Y),
        heldForNow: [],
        mainland: new Uint8Array(SIZE_X * SIZE_Y).fill(1),
        tileHeights: new Float32Array(SIZE_X * SIZE_Y),
        plots: [],
    };
}

function paintFloors(build: Build, massif: Float32Array): void {
    const { ground, terrain, sizeX, sizeY, cliffs } = build;
    const toCliff = distanceTo(cliffs, sizeX, sizeY, 4);
    const patches = createNoise(SETTINGS.seed + 6);
    const edges = createNoise(SETTINGS.seed + 7, 2);
    const toTarn = (x: number, y: number) => Math.hypot(x - 138, y - 298);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = ground.tile(x, y);
            const at = terrain.corner(x, y);
            const height = terrain.height[at] + (edges(x / 16, y / 16) - 0.5) * 40;
            const patch = Math.min(Math.max((patches(x / 14, y / 14) - 0.3) / 0.4, 0), 0.999);
            const grass = y < 150 ? VALE_GRASS : SHELF_GRASS;
            let floor = grass[Math.floor(patch * grass.length)];
            const onStair = x > 66 && x < 128 && y > 206 && y < 250;
            // Grey under what's left of a tile at the water's edge below a fall: rock stops at
            // whole tiles there, and brown would show its steps
            const byFall = FALLS.some(({ foot }) => Math.abs(y - foot) < 14);
            if (massif[at] > 0.35 || toCliff[i] < 3 || onStair) {
                floor =
                    height > 170
                        ? GREY_ROCK
                        : height > 120 || byFall
                          ? DRY_ROCK[patch > 0.5 ? 0 : 1]
                          : BROWN_ROCK;
            }
            // Snow's for the heights: on a lone peak lower down, rock running straight into it
            // blends through bright green
            if ((height > 188 && y > SNOW_FROM) || y >= 243 || toTarn(x, y) < 30) {
                floor = patch > 0.7 ? 218 : 59;
            }
            if (x > CITY.x0 && x < CITY.x1 && y > CITY.y0 && y < CITY.y1) {
                floor = patch > 0.6 ? 159 : 59;
            }
            // Neutral white, not blue, where it meets the rock of the Stair
            if (onStair && floor !== GREY_ROCK && height > 188) {
                floor = NEUTRAL_SNOW;
            }
            ground.level0.underlays[i] = floor;
        }
    }
}

// Trees, stones and grass, by how high the ground is. Everything goes through the rng, so
// the map comes out the same each time.
function scatter(build: Build, massif: Float32Array): void {
    const { ground, terrain, rng, sizeX, sizeY, spawn } = build;
    const clumps = createNoise(SETTINGS.seed + 8);
    const meadows = createNoise(SETTINGS.seed + 9, 1);
    const { flags } = ground.level0;
    const put = (id: number, type: number, x: number, y: number) =>
        ground.grid.locs.push({ id, type, rotation: Math.floor(rng() * 4), level: 0, x, y });
    const pickOf = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
    for (let y = 2; y < sizeY - 2; y++) {
        for (let x = 2; x < sizeX - 2; x++) {
            const roll = rng();
            const i = ground.tile(x, y);
            const at = terrain.corner(x, y);
            const wild = massif[at] > 0.5;
            if ((flags[i] & TILE_BLOCKED && !wild) || ground.reserved[i]) {
                continue;
            }
            const steep = getTileSlope(ground.level0.heights, build.corners.x, x, y) > 9;
            if (Math.hypot(x - spawn.x, y - spawn.y) < 9 || build.cliffs[i] || steep) {
                continue;
            }
            const height = terrain.height[at];
            const inCity = x >= CITY.x0 && x <= CITY.x1 && y >= CITY.y0 && y <= CITY.y1;
            const clump = clumps(x / 15, y / 15);
            const dense = inCity ? 0 : wild ? 0.2 : clump > 0.56 ? 0.1 : 0.006;
            const trees =
                height < 75
                    ? LOW_TREES
                    : height < 130
                      ? PINES
                      : height < 175
                        ? HIGH_PINES
                        : SNOW_TREES;
            if (roll < dense) {
                const [id, size] = pickOf(trees);
                if (ground.isClear(x - 1, y - 1, size + 2, size + 2)) {
                    ground.place(
                        { id, type: 10, rotation: Math.floor(rng() * 4), level: 0, x, y },
                        size,
                        size,
                    );
                }
                continue;
            }
            const biome = build.biomeAt(x, y);
            if (roll > 0.992 && height > 70 && !inCity) {
                const [id, size] = pickOf(biome.rock.rubble);
                if (ground.isClear(x - 1, y - 1, size + 2, size + 2)) {
                    ground.place({ id, type: 10, rotation: 0, level: 0, x, y }, size, size);
                }
            } else if (roll > 0.96 && height > 70 && ground.isClear(x, y, 1, 1)) {
                put(pickOf(biome.rock.stones), 22, x, y);
            } else if (roll > 0.9 && height >= 170 && !inCity && ground.isClear(x, y, 1, 1)) {
                ground.place(
                    { id: pickOf(SNOW_FLATS), type: 22, rotation: 0, level: 0, x, y },
                    1,
                    1,
                );
            } else if (roll > 0.72 && height < 170 && ground.isClear(x, y, 1, 1)) {
                put(pickOf(BIOMES.meadow.decor), 22, x, y);
            } else if (
                roll > 0.68 &&
                height < 75 &&
                meadows(x / 9, y / 9) > 0.62 &&
                ground.isClear(x, y, 1, 1)
            ) {
                ground.place(
                    { id: pickOf(BIOMES.meadow.flowers), type: 10, rotation: 0, level: 0, x, y },
                    1,
                    1,
                );
            }
        }
    }
}

// Rock on everything that's blocked for being steep, up to the snow. Returns its tiles.
function paintRockFaces(build: Build, skip: Uint8Array, massif: Float32Array): Uint8Array {
    const { ground, sizeX, sizeY, corners, cliffs, terrain } = build;
    const { heights, flags } = ground.level0;
    const snowLine = getSnowLine(SETTINGS);
    const rock = new Uint8Array(sizeX * sizeY);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = ground.tile(x, y);
            const steep = getTileSlope(heights, corners.x, x, y) > SETTINGS.walkSlope || cliffs[i];
            const summit =
                massif[terrain.corner(x, y)] > 0.8 && heights[x + y * corners.x] > snowLine;
            if (flags[i] & TILE_BLOCKED && steep && !skip[i] && !summit) {
                rock[i] = 1;
            }
        }
    }
    paintRockFloor(ground, rock, (x, y) => build.biomeAt(x, y).rock.overlay, skip);
    return rock;
}

// A field with a fence round it, crops in rows, on a level plot of its own
function fencedField(
    build: Build,
    x0: number,
    y0: number,
    sizeX: number,
    sizeY: number,
    height: number,
    crops: number[],
): TileRect {
    const { ground, rng } = build;
    pinPlot(build, x0, y0, sizeX, sizeY, height);
    const x1 = x0 + sizeX - 1;
    const y1 = y0 + sizeY - 1;
    const fence = (x: number, y: number, rotation: number) => {
        if (ground.reserved[ground.tile(x, y)]) {
            return;
        }
        ground.grid.locs.push({ id: FIELD_FENCE, type: 0, rotation, level: 0, x, y });
    };
    for (let x = x0; x <= x1; x++) {
        fence(x, y0, WALL_SOUTH);
        fence(x, y1, WALL_NORTH);
    }
    for (let y = y0; y <= y1; y++) {
        fence(x0, y, WALL_WEST);
        fence(x1, y, WALL_EAST);
    }
    for (let y = y0 + 1; y < y1; y++) {
        for (let x = x0 + 1; x < x1; x++) {
            const i = ground.tile(x, y);
            if (!ground.reserved[i] && rng() < 0.92) {
                const id = crops[Math.floor(rng() * crops.length)];
                ground.place({ id, type: 10, rotation: 0, level: 0, x, y }, 1, 1);
            }
            ground.reserved[i] = 1;
        }
    }
    return { x0, y0, x1, y1 };
}

// The city's wall, with round towers along it and a gate to the west where the road comes in
function placeCityWall(build: Build, roadTiles: Uint8Array): void {
    const { ground } = build;
    const { x0, y0, x1, y1 } = CITY;
    const put = (x: number, y: number, rotation: number, along: number) => {
        const i = ground.tile(x, y);
        if (ground.footprint[i] || roadTiles[i]) {
            return;
        }
        ground.grid.locs.push({ id: CITY_WALL, type: 0, rotation, level: 0, x, y });
        if (along % TOWER_SPACING === 0) {
            ground.grid.locs.push({ id: CITY_TOWER, type: 10, rotation: 0, level: 0, x, y });
        }
        ground.reserved[i] = 1;
    };
    for (let x = x0; x <= x1; x++) {
        put(x, y0, WALL_SOUTH, x - x0);
        put(x, y1, WALL_NORTH, x - x0);
    }
    for (let y = y0; y <= y1; y++) {
        put(x0, y, WALL_WEST, y - y0);
        put(x1, y, WALL_EAST, y - y0);
    }
}

export function buildVardhelm(context: BuildContext): GeneratedMap {
    const build = createBuild(context);
    const { ground, terrain, corners, sizeX, sizeY, spawn, arena } = build;
    const falls: Point[] = [];
    const massif = shapeLand(terrain);
    build.relief.mountain.set(massif);

    // The river. Its bed's carved along the falls' rows too, and painted only off them.
    const carved = getTouchedTiles(getWaterField(terrain, false), sizeX, sizeY);
    const levels = new Float32Array(corners.x * corners.y).fill(Infinity);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            if (carved[ground.tile(x, y)]) {
                for (const [cx, cy] of [
                    [x, y],
                    [x + 1, y],
                    [x, y + 1],
                    [x + 1, y + 1],
                ]) {
                    levels[cx + cy * corners.x] = getRiverLevel(cy);
                }
            }
        }
    }
    // The ground beside water goes by the nearest, so a pool takes the corners round it too
    for (const { x, y, across, out, level } of POOLS) {
        for (let cy = y - out * 2; cy <= y + out * 2; cy++) {
            for (let cx = x - across * 2; cx <= x + across * 2; cx++) {
                const away = Math.hypot((cx - x) / across, (cy - y) / out);
                if (levels[cx + cy * corners.x] !== Infinity && away < 1.5) {
                    levels[cx + cy * corners.x] = level;
                }
            }
        }
    }
    spreadNearest(levels, corners.x, corners.y);
    sinkFresh(build, distanceTo(carved, sizeX, sizeY, MAX_BANK), levels);
    const waterTiles = ground.paintField(getWaterField(terrain, true), BIOMES.meadow.water, true);
    holdWater(build, waterTiles);

    build.cliffs.set(shapeCliffs(terrain, SETTINGS.walkSlope));
    // Nothing wears the cliffs away but what's built on them
    for (const { foot } of FALLS) {
        for (let y = foot + 2; y < foot + FALL_ROWS; y++) {
            const { centre, half } = getCourse(y);
            for (let x = Math.floor(centre - half - 1); x <= centre + half + 1; x++) {
                build.faces[ground.tile(x, y)] = 1;
                build.cliffs[ground.tile(x, y)] = 1;
            }
        }
        // The bed stays as it's carved, level across, whatever's pinned nearby
        for (let y = foot; y <= foot + FALL_ROWS; y++) {
            const { centre, half } = getCourse(y);
            for (let x = Math.floor(centre - half); x <= Math.ceil(centre + half); x++) {
                terrain.pin(x, y, getRiverLevel(y));
            }
        }
    }
    build.cliffs.forEach((cliff, i) => {
        if (cliff) {
            const at = (i % sizeX) + Math.floor(i / sizeX) * corners.x;
            for (const corner of [at, at + 1, at + corners.x, at + corners.x + 1]) {
                if (!build.heldCorners[corner]) {
                    build.heldCorners[corner] = 1;
                    build.heldForNow.push(corner);
                }
            }
        }
    });
    seatFall(terrain, POOL_FALL.x, POOL_FALL.y, POOL_FALL.seat);
    {
        const { x0, y0, x1, y1 } = getSeatTiles(POOL_FALL.x, POOL_FALL.y);
        for (let y = y0; y <= y1; y++) {
            build.faces.fill(1, ground.tile(x0, y), ground.tile(x1 + 1, y));
        }
    }
    terrain.pinRect(spawn.x - 8, spawn.y - 8, 16, 16, VALE);
    paintFloors(build, massif);

    const river: River = {
        vertical: true,
        line: 150,
        crossings: CROSSINGS,
        wiggle: () => 0.5,
        amount: 0,
        halfWidth: 4.5,
        valley: Float32Array.from({ length: corners.y }, (_, y) => getCourse(y).centre),
        levels: Float32Array.from({ length: corners.y + 1 }, (_, y) => getRiverLevel(y)),
        drops: [],
    };
    const bridgeZone = new Uint8Array(waterTiles.length);
    const starts = placeBridges(build, [river], waterTiles, bridgeZone);
    const roads = new RoadNetwork(build, waterTiles, bridgeZone);

    const lay = (stops: Stop[], lead: Point[] = [], start?: number, half = roads.halfWidth) => {
        const drawn = drawRoad(stops);
        const points = [...lead, ...drawn.points];
        const heights = [...lead.map(() => start ?? 0), ...drawn.heights];
        const line: RoadLine = {
            points,
            lead: lead.length,
            halfWidth: half,
            start,
            grade: 5,
            heights: Float32Array.from(easeHeights(heights, 6)),
        };
        if (start !== undefined) {
            line.heights!.fill(start, 0, lead.length);
        }
        const leadWidth = half < roads.halfWidth ? half : BRIDGE_ROAD_HALF_WIDTH;
        const width = (i: number) =>
            i < lead.length
                ? leadWidth
                : lerp(leadWidth, half, Math.min((i - lead.length) / ROAD_WIDEN, 1));
        roads.add(line, width, true);
        pinRoad(terrain, line, 0.8);
    };

    const [aWest, aEast, bWest, bEast, cWest, cEast] = starts;
    // The Vale road: in from the south, through Aldmere, to the first bridge
    lay(
        [
            [aWest.from.x, 100, VALE],
            [122, 100, VALE],
            [110, 96, VALE],
            [108, 84, VALE],
            [108, 70, VALE],
            [106, 40, VALE],
        ],
        aWest.lead,
        aWest.height,
    );
    // Over the bridge and up Hillfoot, to meet the road from the second bridge at Lastlight
    lay(
        [
            [aEast.from.x, 100, VALE],
            [178, 101, VALE],
            [192, 106, VALE + 1],
            [206, 116, VALE + 2],
            [216, 130, 56],
            [220, 146, 69],
            [214, 160, 81],
            [208, 172, 90],
            [196, 182, SHELF],
        ],
        aEast.lead,
        aEast.height,
    );
    lay(
        [
            [bEast.from.x, 196, SHELF],
            [152, 196, SHELF],
            [166, 195, SHELF],
            [182, 189, SHELF],
            [196, 182, SHELF],
        ],
        bEast.lead,
        bEast.height,
    );
    // From the second bridge up the King's Stair
    lay(
        [
            [bWest.from.x, 196, SHELF],
            [104, 197, SHELF],
            [101, 202, SHELF],
            [99.5, 207, 95],
            [96, 211, 107],
            [91, 212, 120],
            [84, 212, 130],
            [80, 212, 133],
            [75.5, 214, 137],
            [74.5, 217.5, 140],
            [75.5, 221, 144],
            [80, 223, 147],
            [84, 223, 150],
            [98, 223, 161],
            [112, 223, 172],
            [116, 223, 174],
            [120.5, 225, 177],
            [121.5, 228.5, 180],
            [120.5, 232, 184],
            [116, 234, 187],
            [112, 234, 190],
            [98, 234, 200],
            [84, 234, 210],
            [80, 234, 212],
            [75.5, 236, 214],
            [74.5, 239.5, 215],
            [75.5, 243, 216],
            [80, 245, 216],
            [84, 245, 216],
            [98, 245, 222],
        ],
        bWest.lead,
        bWest.height,
    );
    // And from the top of it across Widow's Field to the third bridge
    lay(
        [
            [cWest.from.x, 262, HIGH],
            [125, 261, HIGH],
            [125, 256, 219],
            [120, 248, 226],
            [112, 245, 228],
            [98, 245, 222],
        ],
        cWest.lead,
        cWest.height,
    );
    // Through the west gate to the square, and on to the keep
    lay(
        [
            [cEast.from.x, 262, HIGH],
            [176, 262, HIGH],
            [192, 262, HIGH],
            [206, 263, HIGH],
            [206, 266, HIGH],
        ],
        cEast.lead,
        cEast.height,
    );
    // The square's between them, with its fountain
    lay(
        [
            [206, 278, HIGH],
            [206, 282, HIGH],
        ],
        [],
    );
    lay(
        [
            [206, 263, HIGH],
            [221, 263, HIGH],
            [238, 263, HIGH],
        ],
        [],
    );
    lay(
        [
            [190, 263, HIGH],
            [190, 290, HIGH],
            [190, 311, HIGH],
        ],
        [],
    );
    lay(
        [
            [221.5, 263, HIGH],
            [221.5, 290, HIGH],
            [221.5, 308, HIGH],
        ],
        [],
    );
    lay(
        [
            [99, 298, SHRINE],
            [101, 292, 224],
            [104, 286, HIGH],
            [111, 276, HIGH],
            [119, 266, HIGH],
            [125, 261, HIGH],
        ],
        [],
    );
    terrain.pinRect(CITY.x0, CITY.y0, CITY.x1 - CITY.x0, CITY.y1 - CITY.y0, HIGH, 0.5);
    roads.addSquare(206, 272, 5);
    roads.addSquare(99, 298, 2.5);
    ground.place({ id: FOUNTAIN, type: 10, rotation: 0, level: 0, x: 205, y: 271 }, 2, 2);

    const buildings: PlacedBuilding[] = [];
    // A building by its middle, at a height, turned to face the nearest road. With road, a road
    // of its own runs straight out of its door to that road.
    const building = (
        name: string,
        middleX: number,
        middleY: number,
        height: number,
        road = true,
        only?: number,
    ) => {
        let best: { turns: number; x: number; y: number; exit: Exit; facing: number } | undefined;
        for (let turns = 0; turns < 4; turns++) {
            if (only !== undefined && turns !== only) {
                continue;
            }
            const { prefab, exits } = build.kit.get(name, turns);
            const x = Math.round(middleX - prefab.sizeX / 2);
            const y = Math.round(middleY - prefab.sizeY / 2);
            for (const local of exits) {
                const exit = { ...local, x: local.x + x, y: local.y + y };
                const near = roads.getNearest(exit.x, exit.y);
                const length = Math.hypot(near.x - exit.x, near.y - exit.y) || 1;
                const facing =
                    (exit.outX * (near.x - exit.x) + exit.outY * (near.y - exit.y)) / length;
                if (!best || facing > best.facing) {
                    best = { turns, x, y, exit, facing };
                }
            }
        }
        if (!best) {
            return;
        }
        const { turns, x, y, exit } = best;
        const { prefab } = build.kit.get(name, turns);
        build.kit.stamp(ground, name, turns, x, y, true);
        // An upper floor reached from outside, which only one floor being drawn can't show
        for (let ty = y; ty < y + prefab.sizeY; ty++) {
            for (let tx = x; tx < x + prefab.sizeX; tx++) {
                ground.grid.levels[1].flags[ground.tile(tx, ty)] &= ~TILE_BRIDGE;
            }
        }
        pinPlot(build, x, y, prefab.sizeX, prefab.sizeY, height, exit);
        buildings.push({
            name,
            x,
            y,
            sizeX: prefab.sizeX,
            sizeY: prefab.sizeY,
            exit,
            hasRoad: road,
        });
        if (road) {
            const lead: Point[] = [];
            for (let step = 0; step <= roads.doorLead; step++) {
                lead.push({ x: exit.x + exit.outX * step, y: exit.y + exit.outY * step });
            }
            const end = lead[lead.length - 1];
            const near = roads.getNearest(end.x, end.y);
            lay(
                [
                    [end.x, end.y, height],
                    [near.x, near.y, height],
                ],
                lead,
                height,
                1.1,
            );
        }
    };

    // Aldmere, in the Vale
    building("lumbridge_house", 124, 110, VALE);
    building("lumbridge_house", 132, 90, VALE);
    building("varrock_shop", 121, 87, VALE);
    building("lumbridge_house", 96, 106, VALE);
    building("lumbridge_church", 92, 88, VALE);
    // Lastlight, on the Shelf
    building("rellekka_house", 208, 194, SHELF);
    building("rellekka_hut", 190, 196, SHELF);
    building("rellekka_house", 182, 174, SHELF);
    building("rellekka_hut", 222, 184, SHELF);
    // Widow's Keep, on the field over the Stair
    building("lefaye_keep", 96, 268, HIGH);
    // The city: the keep and the hall to the north, and the south row on the avenue
    building("camelot_keep", 206, 299, HIGH, true, 0);
    building("falador_hall", 233, 281, HIGH, false, 1);
    building("seers_church", 180, 272, HIGH, false);
    building("falador_houses", 180, 297, HIGH, false);
    building("seers_pub", 233, 304, HIGH, false);
    building("darkmeyer_house", 181, 254, HIGH, false);
    building("darkmeyer_shop", 196, 254, HIGH, false);
    building("varrock_shop", 213, 254, HIGH, false);
    building("darkmeyer_house", 230, 254, HIGH, false);

    const place = (id: number, x: number, y: number, size = 1, rotation = 0) => {
        ground.place({ id, type: 10, rotation, level: 0, x, y }, size, size);
    };
    // Market stalls round the square
    place(634, 196, 268, 2);
    place(11729, 196, 274, 2, 2);
    place(11730, 214, 268, 2, 2);
    place(634, 214, 274, 2, 2);
    place(355, 199, 270);
    place(362, 199, 271);
    place(361, 212, 277);
    // The king's guard, stood along the way to the keep and down the avenue
    for (let y = 277; y <= 281; y += 2) {
        place(GUARD, 203, y, 1, 1);
        place(GUARD, 209, y, 1, 3);
    }
    for (let x = 176; x <= 200; x += 6) {
        place(GUARD, x, 259, 1, 0);
        place(GUARD, x, 266, 1, 2);
    }
    // Crops, by the road out of Aldmere
    const fields = [
        fencedField(build, 98, 116, 24, 12, VALE, [15506, 15507, 15508]),
        fencedField(build, 118, 76, 20, 6, VALE, [312]),
        // And Lastlight's, what little grows up here
        fencedField(build, 214, 204, 12, 8, SHELF, [312]),
    ];
    place(299, 96, 113);
    place(304, 94, 114);
    // The old stones at Stonewake, on the Shelf's west end, and their dead
    for (let stone = 0; stone < 9; stone++) {
        const angle = (stone / 9) * Math.PI * 2;
        place(
            STONES[stone % STONES.length],
            Math.round(92 + Math.cos(angle) * 6),
            Math.round(180 + Math.sin(angle) * 6),
        );
    }
    place(GREAT_BOULDER, 91, 179, 2);
    for (let row = 0; row < 3; row++) {
        for (let grave = 0; grave < 6; grave++) {
            place(GRAVES[(row * 3 + grave) % GRAVES.length], 104 + grave * 2, 166 + row * 2);
        }
    }
    // A parapet along the outer edge of each row of the Stair
    for (const [row, x0, x1] of [
        [212, 84, 94],
        [223, 86, 112],
        [234, 86, 112],
    ]) {
        for (let x = x0; x <= x1; x++) {
            if ((x - x0) % 12 < 10) {
                ground.grid.locs.push({
                    id: PARAPET,
                    type: 0,
                    rotation: WALL_SOUTH,
                    level: 0,
                    x,
                    y: row - 3,
                });
            }
            if ((x - x0) % 12 === 0) {
                place(CITY_TOWER, x, row - 3);
            }
        }
    }
    // Widow's Gate, at the head of the Stair
    for (let y = 241; y <= 250; y++) {
        if (Math.abs(y - 244.5) > 1.5) {
            ground.grid.locs.push({
                id: CITY_WALL,
                type: 0,
                rotation: WALL_WEST,
                level: 0,
                x: 92,
                y,
            });
        }
    }
    place(CITY_TOWER, 92, 242);
    place(CITY_TOWER, 92, 247);
    place(CITY_TOWER, 91, 242);
    place(CITY_TOWER, 91, 247);
    // The city's gate
    place(CITY_TOWER, 169, 259);
    place(CITY_TOWER, 169, 265);
    place(CITY_TOWER, 171, 259);
    place(CITY_TOWER, 171, 265);
    // The Frosthorn's shrine, in a ring of stones
    terrain.pinRect(90, 298, 18, 16, SHRINE, 0.2);
    for (let stone = 0; stone < 10; stone++) {
        const angle = (stone / 10) * Math.PI * 2;
        place(
            STONES[stone % STONES.length],
            Math.round(99 + Math.cos(angle) * 6.5),
            Math.round(306 + Math.sin(angle) * 6.5),
        );
    }
    place(SHRINE_CRYSTAL, 97, 304, 5);
    // Rocks and dead trees on the way up Hillfoot
    place(GREAT_BOULDER, 228, 144, 2);
    place(1282, 206, 146, 2);
    place(1283, 226, 158, 2);
    place(1284, 204, 128, 2);
    // Ice on the tarn, all out on the water
    for (let floe = 0; floe < 40; floe++) {
        const x = Math.floor(lerp(118, 158, build.rng()));
        const y = Math.floor(lerp(290, 310, build.rng()));
        let water = true;
        for (const i of [0, 1, sizeX, sizeX + 1]) {
            water &&= waterTiles[ground.tile(x, y) + i] === 1;
        }
        if (water) {
            place(FLOES[floe % FLOES.length], x, y, 2, floe % 4);
        }
    }
    // A rockfall has shut the road south
    for (let x = ROCKFALL.x0; x < ROCKFALL.x1; x += 2) {
        place(11434, x, 68 + (x % 3), 2);
    }

    roads.pinTiles();
    terrain.smoothPins(2);
    // Whatever's been built on stops being cliff
    const pinned = new Uint8Array(corners.x * corners.y);
    terrain.markPinned(pinned);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const at = terrain.corner(x, y);
            if (
                pinned[at] &&
                pinned[at + 1] &&
                pinned[at + corners.x] &&
                pinned[at + corners.x + 1]
            ) {
                build.cliffs[ground.tile(x, y)] = 0;
            }
        }
    }
    finishHeights(build);
    blockSteepGround(build);
    // The massif's only to look at, however gently it rises, but for a road through it
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            if (massif[terrain.corner(x, y)] > 0.5 && !roads.isRoad(x, y)) {
                ground.level0.flags[ground.tile(x, y)] |= TILE_BLOCKED;
            }
        }
    }

    const paving = (x: number, y: number) => {
        const inCity = x > CITY.x0 && x < CITY.x1 && y > CITY.y0 && y < CITY.y1;
        return inCity ? 174 : y > 208 ? PAVING : undefined;
    };
    const roadTiles = roads.paint(paving);
    const rockSkip = new Uint8Array(waterTiles.length);
    for (let i = 0; i < rockSkip.length; i++) {
        rockSkip[i] = waterTiles[i] | roadTiles[i] | ground.footprint[i] | bridgeZone[i];
    }
    const rock = paintRockFaces(build, rockSkip, massif);
    const waterDrops: TileRect[] = [];
    for (const { foot, x, models, seat } of FALLS) {
        for (let model = 0; model < models; model++) {
            const fall = { x: x + model * FALL_STEP, y: foot, id: seat.id };
            placeFalls(build, [fall]);
            falls.push(fall);
        }
        waterDrops.push(getFallDrop({ x, y: foot }, models * FALL_STEP + 1));
    }
    placeFalls(build, [{ ...POOL_FALL, id: POOL_FALL.seat.id }]);
    falls.push(POOL_FALL);
    waterDrops.push(getFallDrop(POOL_FALL));
    placeCityWall(build, roadTiles);
    placeWaymarkers(build, roads);
    scatter(build, massif);
    dressRock(ground, rock, {
        kitAt: (x, y) => build.biomeAt(x, y).rock,
        seed: SETTINGS.seed + 202,
        share: SETTINGS.rockFaces,
    });

    // Anything you can't get to is only to look at
    const flags = getCollisionFlags(ground.grid, context.locs);
    const reached = findReachable(flags, sizeX, sizeY, arena, spawn.x, spawn.y);
    for (const i of findStranded(flags, sizeX, arena, reached)) {
        blockTile(ground.grid, i);
    }
    dressGround(ground, {
        seed: SETTINGS.seed + 300,
        density: SETTINGS.dressing,
        biomeDecor: (x, y) => build.biomeAt(x, y).decor,
    });
    roads.clearLocs(
        roadTiles,
        (x, y) => x >= ROCKFALL.x0 && y >= ROCKFALL.y0 && x <= ROCKFALL.x1 && y <= ROCKFALL.y1,
    );
    return {
        grid: ground.grid,
        footprint: ground.footprint,
        roadTiles,
        clippedRoads: roads.clipped,
        lines: roads.lines,
        buildings,
        landmarks: [],
        passes: [],
        walkSlope: SETTINGS.walkSlope,
        caves: [],
        falls,
        waterfalls: [],
        waterDrops,
        fields,
        closedRoads: [{ ...ROCKFALL, shownBy: "rubble" }],
    };
}

export const VARDHELM: MapRecipe = {
    id: "scaperune_vardhelm",
    mapX: 84,
    mapY: 80,
    squaresX: SQUARES_X,
    squaresY: SQUARES_Y,
    margin: 1,
    spawn: SPAWN,
    build: (context) => buildVardhelm(context).grid,
    detail: buildVardhelm,
    mapDef: {
        name: "Vardhelm",
        description:
            "The High Kingdom has shut its gates, and the trolls are coming down with the thaw. " +
            "Climb from the Vale of Aldmere over the three bridges of the Silverrun, up the " +
            "King's Stair and through Widow's Gate to the walled city under the Frosthorn.",
    },
    play: { waveSet: "fremennik", enemyDensity: 1, brightness: 1.12 },
};
