import { Ground } from "../Ground";
import { BIOMES, BiomeDef } from "../biomes";
import { blockTile, findReachable, findStranded, getCollisionFlags } from "../collision";
import { dressGround } from "../dress";
import { getFallDrop, placeFallPools, placeFalls } from "../falls";
import { TILE_BLOCKED } from "../format";
import { DEFAULT_SETTINGS, GeneratedMap, GeneratorSettings } from "../generator";
import { Relief, shapeCliffs } from "../landforms";
import {
    Build,
    LOC_FLOOR_DECORATION,
    LOC_NORMAL,
    LOC_WALL,
    SPAWN_CLEAR,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    getTouchedTiles,
    lerp,
    pick,
    refreshTileHeights,
    smoothstep,
} from "../mapBuild";
import {
    blockSteepGround,
    cutPasses,
    dressCliffs,
    finishHeights,
    paintRock,
    placeCaves,
} from "../mountains";
import { createNoise, createRng, distanceTo, smoothField } from "../noise";
import { PathFinder, Point, smoothPath } from "../paths";
import { PrefabDef, PrefabKit, isDoor, loadPrefab } from "../prefabs";
import { BuildContext, MapRecipe } from "../recipe";
import {
    MAX_BANK,
    Pool,
    River,
    SEA_BED,
    createWaterLevels,
    getWaterDrops,
    holdWater,
    riverCentre,
    riverHalfWidth,
    sinkFresh,
} from "../rivers";
import { gradeRoads } from "../roadGrades";
import {
    BRIDGE_ROAD_HALF_WIDTH,
    ROAD_SHOULDER,
    ROAD_SMOOTHING,
    ROAD_STEEPEST,
    RoadNetwork,
    RoadStart,
    placeBridges,
} from "../roads";
import { PlacedBuilding, getPlotHeight, markOffLimits, pinPlot } from "../settlements";
import { PlacedPiece, placeWaymarkers } from "../structures";
import { Terrain } from "../terrain";

// Kalua's Wake: an island chain round a smoking volcano. Everything on it is placed by hand,
// in chart tiles: x east and y north from the arena's south-west corner, 0 to 255 by 0 to 191.
//
// It's built as the generator builds a map, a stage at a time, but with its coasts, roads, water
// and everything on them drawn here. See generateMapDetail for the order things must go in.
//
// When the fire-priests of the Sun Temple let their flame die, Mount Kalua woke. Its lava cut
// the great island in two and ran a fleet aground, and the Tai'Mara took to their stilts.
//
// It lands at Landfall Bay in the south. A road goes north through the jungle to a crossroads:
// west over a bridge to Tai'Mara's stilts and the burnt Cinder Spit, north up the volcano to
// the Maw, and east over the Ember Bridge, through the ash, to the Sun Temple and Wreckers' Key.

const SQUARES_X = 6;
const SQUARES_Y = 5;
const SIZE_X = SQUARES_X * 64;
const SIZE_Y = SQUARES_Y * 64;
// The chart's corner, in grid tiles
const CHART = 64;

const SEED = 77;

const SETTINGS: GeneratorSettings = {
    ...DEFAULT_SETTINGS,
    seed: SEED,
    squaresX: SQUARES_X - 2,
    squaresY: SQUARES_Y - 2,
    boundary: "sea",
    // Says there's relief: the volcano's made here, not by the setting
    volcanoes: 1,
    // Every fall the lava has comes down at a drop: it lies flat between them, as water does
    waterfalls: 1,
    roadWidth: 2.4,
    roadCurviness: 0.15,
    rockFaces: 1,
    cliffFalls: 0.25,
    caves: 0.25,
    passWidth: 6,
    waymarkers: 0.5,
};

const SPAWN = { x: CHART + 118, y: CHART + 37 };

const SEA_OVERLAY = 442;
const LAVA_OVERLAY = BIOMES.ash.rock.lava;
const PLANKS = 52;
const SANDSTONE = 84;

// Black sand, the shore of what's burnt
const BLACK_SAND = 147;

// What's been burnt: warm dark rock, so that it's not just black, with lava breaking through
const JUNGLE: BiomeDef = {
    ...BIOMES.jungle,
    trees: [
        [58541, 1],
        [58542, 1],
        [58543, 1],
        [4818, 1],
        [1304, 2],
        [13703, 2],
        [53188, 2],
        [51762, 2],
        [57792, 2],
        [57793, 2],
    ],
    props: [
        [1402, 2],
        [1400, 2],
        [1314, 3],
        [57544, 2],
        [57511, 3],
        [57513, 3],
        [57569, 1],
    ],
    // The volcano's rock comes down through the jungle
    rock: { ...BIOMES.jungle.rock, overlay: 99 },
};

const TROPICAL: BiomeDef = {
    ...BIOMES.tropical,
    road: JUNGLE.road,
    trail: JUNGLE.trail,
    rock: JUNGLE.rock,
};

const SCORCHED: BiomeDef = {
    ...BIOMES.ash,
    ground: [101, 187, 169],
    hillGround: 155,
    trail: 176,
    // The same road all over: it can't change colour without a line across it
    road: JUNGLE.road,
    props: [
        [20234, 2],
        [49388, 2],
        [20232, 1],
        [14461, 2],
        [11933, 2],
    ],
    rock: { ...BIOMES.ash.rock, ground: 155 },
};

// Height the land stands at away from the sea and the volcano
const LAND = 46;

// The volcano
const KALUA = { x: CHART + 138, y: CHART + 128 };
const RIM_RADIUS = 15;
const FOOT_RADIUS = 72;
const CONE_RISE = 36;
const CRATER_FLOOR = 190;
// Cliffs round it, lowest first, with a way up through each at an angle (degrees, as atan2)
const RINGS = [
    { radius: 59, rise: 50, gap: 232, faces: "south" },
    { radius: 43, rise: 50, gap: 208, faces: "all" },
    { radius: 29, rise: 50, gap: 228, faces: "all" },
];
const SHORE_REACH = 11;
const RISER = 3;
const RAMP = 26;
const GAP_WIDTH = 20;

// The lava's course, from the crater to the sea: [chart y, chart x], north to south
const LAVA_COURSE: [number, number][] = [
    [128, 138],
    [112, 143],
    [100, 149],
    [88, 156],
    [72, 160],
    [58, 164],
    [44, 172],
    [34, 179],
    [24, 184],
];
// Lava standing in pools: [chart x, chart y, radius]
const LAVA_PONDS: [number, number, number][] = [
    [19, 160, 6],
    [50, 172, 5],
    [28, 172, 4],
    // Where the lava gives out at the sea
    [184, 24, 7],
];
const LAVA_CRUST = 1.2;
const LAVA_WIDTH = 12;
// A bridge spans this either side of its middle
const BRIDGE_HALF = 4.5;
const EMBER_CROSSING = 72;

// Points in chart tiles, as "x,y x,y"
function chart(points: string): Point[] {
    return points.split(" ").map((point) => {
        const [x, y] = point.split(",").map(Number);
        return { x: x + CHART, y: y + CHART };
    });
}

// A river's line, or a strait's: bridges over the sea are rivers with one crossing
type Crossing = { vertical: boolean; line: number; at: number };

const EMBER: Crossing = { vertical: true, line: 160, at: EMBER_CROSSING };

const STRAITS: Crossing[] = [
    // Main island to Tai'Mara
    { vertical: true, line: 64, at: 80 },
    // Tai'Mara to the Cinder Spit
    { vertical: false, line: 140, at: 30 },
    // Main island to the Sun Isle
    { vertical: true, line: 210, at: 92 },
    // The Sun Isle to Wreckers' Key
    { vertical: false, line: 52, at: 232 },
];

// Coasts, as closed loops of chart tiles
const ISLANDS: Point[][] = [
    // Kalua
    chart(
        "84,48 96,30 118,19 146,20 166,26 176,34 186,32 198,30 204,46 204,66 206,92 204,118 " +
            "194,146 174,168 146,178 118,176 96,164 84,146 78,124 74,100 69,86 69,74 76,60",
    ),
    // Tai'Mara, round its bay
    chart(
        "59,88 52,104 44,120 37,136 23,136 17,118 12,96 8,70 10,46 18,30 28,28 22,42 22,60 " +
            "34,69 50,70 59,72",
    ),
    // The Cinder Spit
    chart("20,145 42,145 56,156 60,170 46,180 26,178 12,166 12,152"),
    // The Sun Isle
    chart(
        "215,84 214,104 211,124 216,142 230,149 245,146 253,124 251,88 244,66 238,57 226,57 " +
            "218,66",
    ),
    // Wreckers' Key
    chart("222,48 242,48 248,34 244,18 228,10 214,16 212,34"),
];

// Rectangles of planks over the bay, in chart tiles: x0, y0, x1, y1, inclusive
type Rect = [number, number, number, number];
const DECK: Rect[] = [
    // The walk out from the shore, and across
    [40, 36, 42, 74],
    [26, 49, 56, 51],
    // Pads for huts
    [26, 52, 34, 60],
    [48, 52, 56, 60],
    [26, 40, 34, 48],
    [48, 40, 56, 48],
    [33, 22, 49, 35],
];
const DECK_HEIGHT = 24;
const DECK_RAIL = 9025;
const DECK_PILE = 16951;
// Nets, rafts and things on the deck: [loc id, x, y, tiles across, tiles deep]
const DECK_THINGS: [number, number, number, number, number][] = [
    [392, 43, 44, 1, 1],
    [392, 38, 50, 1, 1],
    [2849, 38, 44, 1, 2],
    [2849, 45, 57, 1, 2],
    [1987, 37, 56, 1, 2],
    [1988, 45, 38, 2, 2],
];

const BEACH_DECOR = [57982, 57983, 30797, 729, 3171, 51810, 51811];

const SURF_SPACING = 16;

const SEAWEED = [30537, 30538, 30542];

const MAX_STRANDED = 500;

// Thick jungle, under the trees
const UNDERGROWTH = [9010, 9015, 1204, 4825, 1398, 1390];

const CORAL = [12498, 12507, 12529, 12509, 12518, 12487];

// Places nothing tall grows: [chart x, chart y, radius]
const CLEARINGS: [number, number, number][] = [
    [232, 146, 8],
    [30, 100, 11],
    [118, 44, 15],
    [112, 64, 20],
    [106, 80, 9],
    [86, 80, 7],
    [40, 76, 12],
    [30, 110, 12],
    [34, 160, 16],
    [122, 114, 8],
    [160, 72, 10],
    [186, 76, 14],
    [232, 110, 28],
    [232, 76, 9],
    [230, 32, 13],
];

// A smooth line through points: Catmull-Rom, about a point a tile
function splineThrough(points: Point[], closed: boolean): Point[] {
    const count = points.length;
    const at = (i: number) =>
        closed ? points[(i + count) % count] : points[Math.min(Math.max(i, 0), count - 1)];
    const line: Point[] = [];
    const spans = closed ? count : count - 1;
    for (let i = 0; i < spans; i++) {
        const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        const steps = Math.max(Math.ceil(Math.hypot(c.x - b.x, c.y - b.y)), 1);
        for (let step = 0; step < steps; step++) {
            const t = step / steps;
            const blend = (p: number, q: number, r: number, s: number) =>
                0.5 *
                (2 * q +
                    (r - p) * t +
                    (2 * p - 5 * q + 4 * r - s) * t * t +
                    (3 * q - p - 3 * r + s) * t * t * t);
            line.push({ x: blend(a.x, b.x, c.x, d.x), y: blend(a.y, b.y, c.y, d.y) });
        }
    }
    if (!closed) {
        line.push(points[count - 1]);
    }
    return line;
}

// How far inside a loop a corner is, near its coast: negative outside
function addIsland(field: Float32Array, cornersX: number, cornersY: number, loop: Point[]): void {
    const REACH = 10;
    const x0 = Math.max(Math.floor(Math.min(...loop.map((p) => p.x)) - REACH), 0);
    const x1 = Math.min(Math.ceil(Math.max(...loop.map((p) => p.x)) + REACH), cornersX - 1);
    const y0 = Math.max(Math.floor(Math.min(...loop.map((p) => p.y)) - REACH), 0);
    const y1 = Math.min(Math.ceil(Math.max(...loop.map((p) => p.y)) + REACH), cornersY - 1);
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            let inside = false;
            let nearest = Infinity;
            for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
                const a = loop[i];
                const b = loop[j];
                if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) {
                    inside = !inside;
                }
                nearest = Math.min(nearest, (a.x - x) ** 2 + (a.y - y) ** 2);
            }
            const distance = Math.sqrt(nearest);
            const at = x + y * cornersX;
            field[at] = Math.max(field[at], inside ? distance : -distance);
        }
    }
}

// Where the lava's centre is, for a row of the grid
function createLavaLine(): Float32Array {
    const line = new Float32Array(SIZE_Y + 1);
    const course = LAVA_COURSE.map(([y, x]) => ({ x: x + CHART, y: y + CHART })).reverse();
    const spline = splineThrough(course, false);
    for (let y = 0; y <= SIZE_Y; y++) {
        let best = spline[0];
        for (const point of spline) {
            if (Math.abs(point.y - y) < Math.abs(best.y - y)) {
                best = point;
            }
        }
        line[y] = best.x;
    }
    return line;
}

function createLava(line: Float32Array): River {
    return {
        vertical: true,
        line: EMBER.line + CHART,
        crossings: [EMBER.at + CHART],
        wiggle: () => 0.5,
        amount: 0,
        halfWidth: LAVA_WIDTH / 2,
        levels: new Float32Array(SIZE_Y + 2),
        drops: [],
        valley: line,
    };
}

function createStrait({ vertical, line, at }: Crossing): River {
    return {
        vertical,
        line: line + CHART,
        crossings: [at + CHART],
        wiggle: () => 0.5,
        amount: 0,
        halfWidth: 4.5,
        levels: new Float32Array(Math.max(SIZE_X, SIZE_Y) + 2).fill(SEA_BED),
        drops: [],
    };
}

// The sea: above 0 is water. Straits are 9 tiles wide at their bridges, and solid to either side
function createSea(): Float32Array {
    const cornersX = SIZE_X + 1;
    const cornersY = SIZE_Y + 1;
    const land = new Float32Array(cornersX * cornersY).fill(-12);
    for (const outline of ISLANDS) {
        addIsland(land, cornersX, cornersY, splineThrough(outline, true));
    }
    const coast = createNoise(SEED + 1, 2);
    const sea = land.map((value, i) => {
        const x = i % cornersX;
        const y = Math.floor(i / cornersX);
        return -value - (coast(x / 22, y / 22) - 0.5) * 9;
    });
    const smooth = smoothField(sea, cornersX, cornersY, 3);
    for (const { vertical, line, at } of STRAITS) {
        const strait = line + CHART;
        const crossing = at + CHART;
        for (let along = crossing - 12; along <= crossing + 12; along++) {
            for (let across = strait - 19; across <= strait + 19; across++) {
                const i = vertical ? across + along * cornersX : along + across * cornersX;
                const away = Math.abs(across - strait);
                const held = 4.5 - away;
                const weight = 1 - smoothstep((Math.abs(along - crossing) - 6) / 6);
                const solid =
                    away > 5 && Math.abs(along - crossing) <= 7 ? Math.min(held, -2) : held;
                smooth[i] = away < 19 ? lerp(smooth[i], solid, weight) : smooth[i];
            }
        }
    }
    // The deck and a tile round it stand clear of the water, with straight edges: that
    // tile's left out when water's painted, so the corners round it can be water's
    for (const [x0, y0, x1, y1] of DECK) {
        for (let y = y0 + CHART - 4; y <= y1 + CHART + 5; y++) {
            for (let x = x0 + CHART - 4; x <= x1 + CHART + 5; x++) {
                const outX = Math.max(x0 + CHART - x, x - x1 - CHART - 1);
                const outY = Math.max(y0 + CHART - y, y - y1 - CHART - 1);
                const out = Math.max(outX, outY);
                const i = x + y * cornersX;
                smooth[i] = Math.min(smooth[i], out > 0 ? out : -1);
            }
        }
    }
    return smooth;
}

type Shape = {
    sea: Float32Array;
    seaTiles: Uint8Array;
    toSea: Float32Array;
    lavaLine: Float32Array;
};

// How burnt a spot is, 0 to 1: near the lava, high on the volcano, and all of the Cinder Spit
function createScorch(lavaLine: Float32Array): (x: number, y: number) => number {
    const edge = createNoise(SEED + 3, 2);
    return (x, y) => {
        const wander = edge(x / 18, y / 18);
        const row = Math.min(Math.max(Math.round(y), 0), SIZE_Y);
        const onRiver = y < KALUA.y + 8 && y > CHART + 20;
        // The wind's from the west, so the east bank has come off worst
        const side = x > lavaLine[row] ? 0.5 : 1;
        const fromLava = onRiver ? Math.abs(x - lavaLine[row]) * side : Infinity;
        const lava = 1.1 - fromLava / (12 + wander * 22);
        const peak = 1.1 - (Math.hypot(x - KALUA.x, y - KALUA.y) - 22) / (10 + wander * 18);
        const spit = y > CHART + 141 && x < CHART + 66 ? 1 : 0;
        // The volcano's north side, facing away from everyone, is all ash down to the sea
        const north = x > CHART + 78 && x < CHART + 210 && y > KALUA.y + 26 + wander * 12 ? 1 : 0;
        return Math.max(Math.min(Math.max(lava, peak), 1), spit, north);
    };
}

function createBiomes(shape: Shape): {
    biomeAt: Build["biomeAt"];
    biomeNear: Build["biomeNear"];
} {
    const scorch = createScorch(shape.lavaLine);
    const near = createNoise(SEED + 4, 2);
    const at = (x: number, y: number, roll: number): BiomeDef => {
        const burnt = scorch(x, y) + (roll - 0.5) * 0.3;
        if (burnt > 0.5) {
            return SCORCHED;
        }
        const i = Math.min(x, SIZE_X - 1) + Math.min(y, SIZE_Y - 1) * SIZE_X;
        const shore = shape.toSea[i] + near(x / 20, y / 20) * 10 + roll * 3;
        return shore < 13 ? TROPICAL : JUNGLE;
    };
    return {
        biomeAt: (x, y) => at(x, y, 0.5),
        biomeNear: at,
    };
}

function createBuild(context: BuildContext, shape: Shape): Build {
    const corners = { x: SIZE_X + 1, y: SIZE_Y + 1 };
    const arena = { x0: CHART, y0: CHART, x1: SIZE_X - CHART - 1, y1: SIZE_Y - CHART - 1 };
    const terrain = new Terrain(corners.x, corners.y);
    const relief: Relief = {
        terrain,
        mountain: new Float32Array(terrain.height.length),
        craters: [],
        hills: createNoise(SEED + 5),
    };
    return {
        ...createBiomes(shape),
        settings: SETTINGS,
        context,
        ground: new Ground(SIZE_X, SIZE_Y),
        rng: createRng(SEED),
        finder: new PathFinder(SIZE_X, SIZE_Y),
        kit: new PrefabKit(context),
        sizeX: SIZE_X,
        sizeY: SIZE_Y,
        corners,
        spawn: SPAWN,
        arena,
        toEdge: (x, y) => Math.min(x - arena.x0, arena.x1 + 1 - x, y - arena.y0, arena.y1 + 1 - y),
        relief,
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

// Degrees between two angles
function angleBetween(a: number, b: number): number {
    const difference = Math.abs(a - b) % 360;
    return Math.min(difference, 360 - difference);
}

// The volcano's rise over the land at a corner, with its share of mountain, ringed with cliffs
function getVolcano(x: number, y: number, wobble: number): { rise: number; body: number } {
    const dx = x - KALUA.x;
    const dy = y - KALUA.y;
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const distance = Math.hypot(dx, dy) * (1 + (wobble - 0.5) * 0.22);
    if (distance < RIM_RADIUS) {
        const wall = smoothstep((distance - (RIM_RADIUS - 5)) / 5);
        return { rise: lerp(CRATER_FLOOR, totalRise(), wall) - LAND, body: 1 };
    }
    const out = Math.min((distance - RIM_RADIUS) / (FOOT_RADIUS - RIM_RADIUS), 1);
    let rise = CONE_RISE * Math.pow(1 - out, 1.5);
    for (const ring of RINGS) {
        const gap = smoothstep(1 - angleBetween(angle, ring.gap) / GAP_WIDTH);
        const width = lerp(RISER, RAMP, gap);
        // The lowest would run into the north shore, so it fades out along the flanks
        const share = ring.faces === "south" ? smoothstep((angleBetween(angle, 90) - 75) / 30) : 1;
        rise += ring.rise * share * smoothstep((ring.radius + width / 2 - distance) / width);
    }
    return { rise, body: smoothstep((1 - out) * 1.6) };
}

function totalRise(): number {
    return LAND + CONE_RISE + RINGS.reduce((sum, ring) => sum + ring.rise, 0);
}

function shapeLand(build: Build, shape: Shape): void {
    const { terrain, relief, corners } = build;
    const hills = relief.hills;
    const wobble = createNoise(SEED + 6, 1);
    for (let y = 0; y < corners.y; y++) {
        for (let x = 0; x < corners.x; x++) {
            const at = terrain.corner(x, y);
            const lump = (hills(x / 30, y / 30) - 0.5) * 22;
            const { rise, body } = getVolcano(x, y, wobble(x / 18, y / 18));
            terrain.height[at] = LAND + lump * (1 - body) + rise;
            relief.mountain[at] = body;
        }
    }
    sinkCoast(build, shape);
}

// Takes the land down to the sea
function sinkCoast(build: Build, shape: Shape): void {
    const { terrain, corners } = build;
    const { height } = terrain;
    for (let y = 0; y < corners.y; y++) {
        for (let x = 0; x < corners.x; x++) {
            const at = terrain.corner(x, y);
            let distance = Infinity;
            for (const [tx, ty] of [
                [x - 1, y - 1],
                [x, y - 1],
                [x - 1, y],
                [x, y],
            ]) {
                if (tx >= 0 && ty >= 0 && tx < SIZE_X && ty < SIZE_Y) {
                    distance = Math.min(distance, shape.toSea[tx + ty * SIZE_X]);
                }
            }
            const share = Math.min(distance / SHORE_REACH, 1);
            height[at] = SEA_BED + (height[at] - SEA_BED) * share;
        }
    }
}

function paintFloors(build: Build, shape: Shape): void {
    const { ground, sizeX, sizeY, biomeAt, terrain, relief, cliffs } = build;
    const patches = createNoise(SEED + 7);
    const edges = createNoise(SEED + 8, 2);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const biome = biomeAt(x, y);
            const i = ground.tile(x, y);
            const patch = Math.min(Math.max((patches(x / 17, y / 17) - 0.3) / 0.4, 0), 0.999);
            let floor = biome.ground[Math.floor(patch * biome.ground.length)];
            const edge = edges(x / 16, y / 16);
            if (relief.mountain[terrain.corner(x, y)] > 0.45 + edge * 0.5 || cliffs[i]) {
                floor = biome.rock.ground;
            }
            if (shape.toSea[i] < 5 + edge * 5) {
                floor = biome === SCORCHED ? BLACK_SAND : biome.shore;
            }
            ground.level0.underlays[i] = floor;
        }
    }
}

// Tiles of rectangles, grown by some tiles
function createRectMask(rects: Rect[], grow: number): Uint8Array {
    const mask = new Uint8Array(SIZE_X * SIZE_Y);
    for (const [x0, y0, x1, y1] of rects) {
        for (let y = y0 + CHART - grow; y <= y1 + CHART + grow; y++) {
            mask.fill(1, x0 + CHART - grow + y * SIZE_X, x1 + CHART + grow + 1 + y * SIZE_X);
        }
    }
    return mask;
}

// Whole tiles of an overlay: a field's shapes would cut a rectangle's corners off
function fillTiles(ground: Ground, mask: Uint8Array, overlay: number, skip?: Uint8Array): void {
    const { overlays, shapes, rotations } = ground.level0;
    mask.forEach((tile, i) => {
        if (tile && !skip?.[i]) {
            overlays[i] = overlay;
            shapes[i] = 0;
            rotations[i] = 0;
            ground.reserved[i] = 1;
        }
    });
}

// Every tile of the deck, and its edge
function createDeckMask(): { deck: Uint8Array; skirt: Uint8Array } {
    const deck = new Uint8Array(SIZE_X * SIZE_Y);
    const skirt = new Uint8Array(SIZE_X * SIZE_Y);
    for (const [x0, y0, x1, y1] of DECK) {
        for (let y = y0 + CHART; y <= y1 + CHART; y++) {
            deck.fill(1, x0 + CHART + y * SIZE_X, x1 + CHART + 1 + y * SIZE_X);
        }
    }
    for (let y = 1; y < SIZE_Y - 1; y++) {
        for (let x = 1; x < SIZE_X - 1; x++) {
            const i = x + y * SIZE_X;
            let beside = false;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    beside ||= deck[i + dx + dy * SIZE_X] !== 0;
                }
            }
            skirt[i] = beside && !deck[i] ? 1 : 0;
        }
    }
    return { deck, skirt };
}

// The deck stands level over the bay, on corners of its own
function pinDeck(build: Build, deck: Uint8Array): void {
    const { terrain, ground } = build;
    for (let y = 0; y < SIZE_Y; y++) {
        for (let x = 0; x < SIZE_X; x++) {
            if (deck[ground.tile(x, y)]) {
                terrain.pinRect(x, y, 1, 1, DECK_HEIGHT);
            }
        }
    }
    for (const [x0, y0, x1, y1] of DECK) {
        build.plots.push({
            x: x0 + CHART,
            y: y0 + CHART,
            sizeX: x1 - x0 + 1,
            sizeY: y1 - y0 + 1,
            height: DECK_HEIGHT,
        });
    }
}

// A building at a spot, turned so that a way out faces a point, with a road from its door
function placeHouse(
    build: Build,
    roads: RoadNetwork,
    name: string,
    x: number,
    y: number,
    toward: Point,
    wantsRoad: boolean,
    stand?: number,
): PlacedBuilding | undefined {
    const { ground, kit } = build;
    let best: { turns: number; exit: PlacedBuilding["exit"]; facing: number } | undefined;
    for (let turns = 0; turns < 4; turns++) {
        for (const local of kit.get(name, turns).exits) {
            const exit = { ...local, x: local.x + x, y: local.y + y };
            const length = Math.hypot(toward.x - exit.x, toward.y - exit.y) || 1;
            const facing =
                (exit.outX * (toward.x - exit.x) + exit.outY * (toward.y - exit.y)) / length;
            if (!best || facing > best.facing) {
                best = { turns, exit, facing };
            }
        }
    }
    if (!best?.exit) {
        return undefined;
    }
    const { turns, exit } = best;
    const { prefab } = kit.get(name, turns);
    const plot: PlacedBuilding = {
        name,
        x,
        y,
        sizeX: prefab.sizeX,
        sizeY: prefab.sizeY,
        exit,
        hasRoad: wantsRoad,
    };
    const lead: Point[] = [];
    for (let step = 0; step <= roads.doorLead; step++) {
        lead.push({ x: exit.x + exit.outX * step, y: exit.y + exit.outY * step });
    }
    const end = lead[lead.length - 1];
    const from = { x: Math.floor(end.x), y: Math.floor(end.y) };
    markOffLimits(build, roads, x, y, prefab.sizeX, prefab.sizeY, 1);
    const route = wantsRoad ? roads.findRoute(from, lead) : [];
    const joining = route.length > 0 ? build.tileHeights[route[0]] : undefined;
    const height = stand ?? getPlotHeight(build, x, y, prefab.sizeX, prefab.sizeY, joining) ?? LAND;
    kit.stamp(ground, name, turns, x, y, true);
    pinPlot(build, x, y, prefab.sizeX, prefab.sizeY, height, wantsRoad ? exit : undefined);
    if (wantsRoad) {
        roads.lay(from, lead, route, roads.halfWidth, height);
    }
    return plot;
}

// The roads, by hand. Where they end, by a bridge, the bridge's own road comes to meet them.
const ROADS: Point[][] = [
    // Landfall to the crossroads and on east to the Ember Bridge
    chart("118,36 117,50 110,66 106,78 116,80 130,74 136,72"),
    // West, to the bridge to Tai'Mara
    chart("106,78 96,82 88,80"),
    // Up the volcano
    chart("106,78 100,86 96,96 102,106 108,111 114,108 120,107 124,111 125,114"),
    // Over the ash to the Sun Isle
    chart("184,72 190,82 188,92"),
    // Tai'Mara: down to the walk, and north to the Spit
    chart("40,80 41,76"),
    chart("40,80 30,96 30,116"),
    // On the Cinder Spit
    chart("30,160 34,166 44,167"),
    // The Sun Isle
    chart("234,92 232,84 232,76"),
    chart("234,92 233.5,92"),
    // On Wreckers' Key
    chart("232,30 231,25 228,20"),
];

function layRoads(build: Build, roads: RoadNetwork): void {
    for (const road of ROADS) {
        const raw = splineThrough(road, false);
        roads.addRun(smoothPath(raw, 3, 3));
    }
}

function placeVillage(build: Build, roads: RoadNetwork): PlacedBuilding[] {
    const built: (PlacedBuilding | undefined)[] = [];
    const house = (name: string, x: number, y: number, tx: number, ty: number) => {
        built.push(
            placeHouse(
                build,
                roads,
                name,
                x + CHART,
                y + CHART,
                { x: tx + CHART, y: ty + CHART },
                true,
            ),
        );
    };
    // Landfall, in a clearing either side of the road
    house("taibwo_hut", 100, 54, 116, 58);
    house("taibwo_house", 124, 52, 114, 58);
    house("taibwo_hut", 122, 68, 112, 68);
    house("taibwo_hall", 88, 60, 110, 68);
    return built.filter((building) => building !== undefined);
}

// Huts on the deck, each with its door to the walk
function placeStilts(build: Build, roads: RoadNetwork): PlacedBuilding[] {
    const huts: [string, number, number, number, number][] = [
        ["taibwo_hut", 27, 53, 41, 50],
        ["ape_hut", 49, 53, 41, 50],
        ["taibwo_hut", 27, 41, 41, 50],
        ["taibwo_hut", 49, 41, 41, 50],
        ["taibwo_house", 36, 24, 41, 36],
    ];
    return huts.flatMap(([name, x, y, tx, ty]) => {
        const hut = placeHouse(
            build,
            roads,
            name,
            x + CHART,
            y + CHART,
            { x: tx + CHART, y: ty + CHART },
            false,
            DECK_HEIGHT,
        );
        return hut ? [hut] : [];
    });
}

// A big loc, in chart tiles
function put(
    build: Build,
    id: number,
    x: number,
    y: number,
    sizeX = 1,
    sizeY = sizeX,
    rotation = 0,
): void {
    const across = rotation & 1 ? sizeY : sizeX;
    const deep = rotation & 1 ? sizeX : sizeY;
    build.ground.place(
        { id, type: LOC_NORMAL, rotation, level: 0, x: x + CHART, y: y + CHART },
        across,
        deep,
    );
}

// What's lying about, where there's room for it: [loc id, x, y, tiles across, tiles deep]
const THINGS: [number, number, number, number, number][] = [
    // Landfall's yards
    [29085, 113, 72, 1, 1],
    [4764, 112, 74, 1, 1],
    [4764, 115, 72, 1, 1],
    [4764, 112, 71, 1, 1],
    [4277, 106, 62, 2, 2],
    [9534, 107, 53, 1, 1],
    [9535, 108, 55, 1, 1],
    [9519, 107, 61, 1, 1],
    [396, 99, 53, 1, 1],
    [358, 121, 52, 1, 1],
    [357, 122, 54, 1, 1],
    [365, 121, 56, 1, 1],
    [620, 120, 66, 1, 1],
    [4754, 94, 54, 2, 2],
    [4749, 118, 62, 2, 2],
    [4754, 131, 64, 2, 2],
    [4749, 128, 76, 2, 2],
    [4861, 111, 56, 1, 1],
    [1160, 134, 56, 2, 2],
    // What came ashore at Landfall Bay
    [52684, 104, 27, 3, 3],
    [52683, 137, 27, 2, 3],
    [271, 122, 29, 1, 1],
    [821, 135, 31, 1, 2],
    [9519, 126, 31, 1, 1],
    [358, 125, 30, 1, 1],
    [14174, 113, 27, 2, 2],
    [30843, 142, 31, 1, 2],
    [32319, 130, 31, 1, 1],
    [32319, 133, 24, 1, 1],
    [13609, 96, 38, 2, 2],
    // On the stilts, and tied up to them
    [4277, 49, 49, 2, 2],
    [27523, 31, 50, 1, 1],
    [16872, 29, 50, 1, 1],
    [4277, 34, 33, 2, 2],
    [392, 47, 33, 1, 1],
    [392, 47, 28, 1, 1],
    [27523, 47, 30, 1, 1],
    [9519, 34, 24, 1, 1],
    [357, 35, 23, 1, 1],
    [358, 47, 24, 1, 1],
    // The Sun Isle's north end: the old gods, down the back stair
    [51888, 224, 142, 4, 4],
    [51895, 240, 142, 4, 4],
    [60984, 231, 144, 1, 1],
    [60984, 236, 144, 1, 1],
    // Banana groves on Tai'Mara
    [4754, 34, 98, 2, 2],
    [4749, 38, 101, 2, 2],
    [4754, 35, 104, 2, 2],
    [4749, 39, 106, 2, 2],
    [4754, 22, 92, 2, 2],
    [4749, 20, 96, 2, 2],
    [4754, 23, 100, 2, 2],
    [1160, 26, 104, 2, 2],
    // Wreckers' Key: what they've salvaged, round a fire
    [29085, 228, 33, 1, 1],
    [821, 224, 36, 1, 2],
    [821, 235, 32, 1, 2],
    [271, 233, 23, 1, 1],
    [362, 226, 30, 1, 1],
    [357, 225, 29, 1, 1],
    [358, 227, 28, 1, 1],
    [14174, 220, 24, 2, 2],
    // The Maw
    [60984, 122, 113, 1, 1],
];

// Tied up at the stilts
const BOATS: [number, number, number, number, number][] = [
    [52684, 44, 34, 3, 3],
    [52683, 37, 37, 2, 3],
    [52683, 58, 46, 2, 3],
];

function placeThings(build: Build): void {
    for (const [id, x, y, across, deep] of THINGS) {
        if (build.ground.isClear(x + CHART, y + CHART, across, deep)) {
            put(build, id, x, y, across, deep);
        }
    }
    for (const [id, x, y, across, deep] of BOATS) {
        put(build, id, x, y, across, deep);
    }
}

// Something big that stands on the land, on a plot of its own: [loc id, x, y, tiles across, tiles
// deep, rotation]
type Piece = [number, number, number, number, number, number];

const LAND_PIECES: Piece[] = [
    // Landfall Bay, where the fleet ran aground
    [49423, 128, 26, 6, 4, 0],
    [59372, 99, 37, 6, 3, 0],
    // Landfall's idol
    [21, 109, 50, 4, 4, 0],
    // The Cinder Spit
    [59324, 40, 158, 7, 3, 0],
    [30666, 40, 172, 3, 3, 0],
    // Wreckers' Key
    [49423, 220, 18, 6, 4, 1],
    [59372, 235, 25, 6, 3, 0],
    [60475, 216, 30, 4, 4, 0],
    [60479, 240, 35, 4, 4, 0],
];

function pinPieces(build: Build, roads: RoadNetwork): PlacedPiece[] {
    return LAND_PIECES.map(([id, x, y, across, deep, rotation]) => {
        const sizeX = rotation & 1 ? deep : across;
        const sizeY = rotation & 1 ? across : deep;
        const gridX = x + CHART;
        const gridY = y + CHART;
        const height = getPlotHeight(build, gridX, gridY, sizeX, sizeY) ?? LAND;
        pinPlot(build, gridX, gridY, sizeX, sizeY, height);
        markOffLimits(build, roads, gridX, gridY, sizeX, sizeY, 1);
        put(build, id, x, y, across, deep, rotation);
        return { name: `loc ${id}`, x: gridX, y: gridY, sizeX, sizeY, onLand: true };
    });
}

// What's left of what the lava reached, and of a shrine in the trees: [name, turns, x, y]
const RUINS: [string, number, number, number][] = [
    ["taibwo_house", 1, 176, 60],
    ["taibwo_hut", 0, 193, 56],
    ["taibwo_hut", 2, 186, 84],
    ["ape_hut", 1, 114, 86],
    ["taibwo_hut", 3, 42, 152],
];

function placeRuins(build: Build, roads: RoadNetwork): void {
    const { ground, kit, rng } = build;
    for (const [name, turns, x, y] of RUINS) {
        const { prefab } = kit.get(name, turns);
        const gridX = x + CHART;
        const gridY = y + CHART;
        const height = getPlotHeight(build, gridX, gridY, prefab.sizeX, prefab.sizeY) ?? LAND;
        kit.stampRuin(ground, name, turns, gridX, gridY, rng, true);
        pinPlot(build, gridX, gridY, prefab.sizeX, prefab.sizeY, height);
        markOffLimits(build, roads, gridX, gridY, prefab.sizeX, prefab.sizeY, 1);
    }
}

// The Sun Temple: Marim's great temple on a platform of its own, with a stair up the south side
const TEMPLE: PrefabDef = { worldX: 2785, worldY: 2774, sizeX: 27, sizeY: 29 };
const TEMPLE_X = 220;
const TEMPLE_Y = 102;
const PLATFORM: Rect = [218, 100, 247, 132];
const PLATFORM_HEIGHT = 62;
const STAIRS: { rect: Rect; foot: number; top: number }[] = [
    { rect: [231, 92, 236, 100], foot: 92, top: 100 },
    { rect: [231, 132, 236, 141], foot: 142, top: 133 },
];
const STAIR_FOOT = 46;
const TEMPLE_UNDERLAY = 62;

function pinTemple(build: Build): void {
    const { terrain, plots } = build;
    const [x0, y0, x1, y1] = PLATFORM;
    const sizeX = x1 - x0 + 1;
    const sizeY = y1 - y0 + 1;
    terrain.pinRect(x0 + CHART, y0 + CHART, sizeX, sizeY, PLATFORM_HEIGHT);
    plots.push({ x: x0 + CHART, y: y0 + CHART, sizeX, sizeY, height: PLATFORM_HEIGHT });
    for (const { rect, foot, top } of STAIRS) {
        const [stairX0, stairY0, stairX1, stairY1] = rect;
        for (let cy = stairY0; cy <= stairY1 + 1; cy++) {
            const climb = Math.min(Math.max((cy - foot) / (top - foot), 0), 1);
            for (let cx = stairX0; cx <= stairX1 + 1; cx++) {
                terrain.pin(cx + CHART, cy + CHART, lerp(STAIR_FOOT, PLATFORM_HEIGHT, climb));
            }
        }
    }
    // A wall of stone round it, too steep to climb: what's pinned first stays
    terrain.pinRect(x0 + CHART - 1, y0 + CHART - 1, sizeX + 2, sizeY + 2, PLATFORM_HEIGHT - 16);
}

// Its walls and floors, on stone of ours where its own courts are flooded
function stampTemple(build: Build): void {
    const { ground, context } = build;
    const prefab = loadPrefab(context, TEMPLE);
    const [x0, y0, x1, y1] = PLATFORM;
    for (let y = y0 + CHART; y <= y1 + CHART; y++) {
        ground.level0.underlays.fill(
            TEMPLE_UNDERLAY,
            x0 + CHART + y * SIZE_X,
            x1 + CHART + 1 + y * SIZE_X,
        );
    }
    ground.stamp(prefab, TEMPLE_X + CHART, TEMPLE_Y + CHART, {
        floor: (overlay) => overlay !== 0 && overlay !== SEA_OVERLAY,
        feather: 0,
        flatten: true,
        keepHeights: true,
        keepUnderlays: true,
        skipLoc: (loc) => isDoor(context, loc),
    });
    // The gods at the stair's head
    put(build, 51879, 226, 101, 4);
    put(build, 51899, 238, 101, 4);
}

// The Maw: broken pillars where the road gives out at the crater's rim
function dressMaw(build: Build): void {
    // Smoke off the crater's rim, and off the shore where the lava meets the sea
    for (const [x, y] of [
        [126, 124],
        [148, 136],
        [130, 140],
        [149, 121],
        [175, 24],
        [193, 25],
    ]) {
        put(build, 22975, x, y, 2, 3);
    }
    for (const [x, y] of [
        [121, 116],
        [128, 112],
        [122, 119],
        [130, 115],
    ]) {
        put(build, 34796, x, y);
    }
    put(build, 60984, 124, 117);
}

// Rails and posts on the deck, and what the Tai'Mara leave lying about on it
function dressDeck(build: Build, deck: Uint8Array): void {
    const { ground, rng, context } = build;
    const { footprint } = ground;
    // What came with the huts from dry land
    ground.grid.locs = ground.grid.locs.filter(
        (loc) =>
            !deck[ground.tile(loc.x, loc.y)] ||
            loc.type !== LOC_NORMAL ||
            !/tree|plant|bush/i.test(context.locs(loc.id).name),
    );
    const rail = (x: number, y: number, rotation: number) => {
        ground.grid.locs.push({ id: DECK_RAIL, type: LOC_WALL, rotation, level: 0, x, y });
    };
    for (let y = CHART + 20; y < CHART + 72; y++) {
        for (let x = CHART + 20; x < CHART + 62; x++) {
            const i = ground.tile(x, y);
            if (!deck[i] || footprint[i]) {
                continue;
            }
            if (!deck[i - 1]) {
                rail(x, y, WALL_WEST);
            }
            if (!deck[i + 1]) {
                rail(x, y, WALL_EAST);
            }
            if (!deck[i - SIZE_X]) {
                rail(x, y, WALL_SOUTH);
            }
            if (!deck[i + SIZE_X]) {
                rail(x, y, WALL_NORTH);
            }
            // Piles, along the outside of it
            if (!deck[i - SIZE_X] && (x + y) % 3 === 0) {
                ground.grid.locs.push({
                    id: DECK_PILE,
                    type: LOC_NORMAL,
                    rotation: 0,
                    level: 0,
                    x,
                    y: y - 2,
                });
            }
        }
    }
    for (const [id, x, y, sizeX, sizeY] of DECK_THINGS) {
        put(build, id, x, y, sizeX, sizeY, Math.floor(rng() * 4) & 2);
    }
}

// What's out at sea: [loc id, x, y, tiles across, tiles deep]
const SEA_PIECES: [number, number, number, number, number][] = [
    // The fleet, off Landfall Bay and round the islands, where you can see it from the shore
    [60471, 108, 12, 4, 4],
    [60479, 138, 12, 4, 4],
    [60465, 124, 15, 2, 1],
    [60473, 198, 20, 2, 2],
    [60475, 166, 16, 4, 4],
    [60467, 64, 92, 3, 2],
    [60469, 64, 66, 3, 2],
    [60477, 66, 160, 5, 3],
    [60469, 207, 140, 3, 2],
    [59352, 8, 142, 5, 3],
    [60475, 150, 183, 4, 4],
    // The ghost of one of them
    [59333, 247, 52, 4, 4],
    // Stacks of rock
    [60444, 88, 20, 6, 4],
    [60444, 244, 150, 6, 4],
    [60444, 4, 22, 6, 4],
    [60444, 66, 172, 6, 4],
    [60440, 60, 28, 2, 2],
    [60440, 248, 14, 2, 2],
    // The old harbour, drowned when the land went down: its steeple and stones
    [48327, 62, 122, 9, 9],
    [34795, 56, 118, 1, 1],
    [34796, 72, 120, 1, 1],
    [34780, 58, 134, 1, 1],
    [34795, 73, 132, 1, 1],
    [34796, 66, 135, 1, 1],
    [34780, 54, 126, 1, 1],
];

function placeSea(build: Build, water: Uint8Array): PlacedPiece[] {
    const { ground, rng, sizeX, sizeY } = build;
    const placed: PlacedPiece[] = [];
    for (const [id, x, y, across, deep] of SEA_PIECES) {
        let wet = true;
        for (let ty = y; ty < y + deep; ty++) {
            for (let tx = x; tx < x + across; tx++) {
                wet &&= water[ground.tile(tx + CHART, ty + CHART)] !== 0;
            }
        }
        if (wet) {
            put(build, id, x, y, across, deep);
            const { x: gridX, y: gridY } = { x: x + CHART, y: y + CHART };
            placed.push({
                name: `loc ${id}`,
                x: gridX,
                y: gridY,
                sizeX: across,
                sizeY: deep,
                onLand: false,
            });
        }
    }
    // Coral in the shallows
    const land = water.map((tile) => 1 - tile);
    const toLand = distanceTo(land, sizeX, sizeY, 12);
    for (let y = CHART - 20; y < sizeY - CHART + 20; y++) {
        for (let x = CHART - 20; x < sizeX - CHART + 20; x++) {
            const i = ground.tile(x, y);
            if (
                water[i] &&
                toLand[i] >= 2 &&
                toLand[i] < 9 &&
                rng() < 0.016 &&
                ground.level0.overlays[i] === SEA_OVERLAY &&
                ground.isClear(x, y, 1, 1)
            ) {
                ground.grid.locs.push({
                    id: pick(rng, CORAL),
                    type: LOC_NORMAL,
                    rotation: Math.floor(rng() * 4),
                    level: 0,
                    x,
                    y,
                });
            }
        }
    }
    return placed;
}

// Seaweed washed up along the beaches, a tile at a time. Foam is for the foot of a fall.
function placeSurf(build: Build, water: Uint8Array, shape: Shape, zone: Uint8Array): void {
    const { ground, biomeAt } = build;
    for (let y = CHART - 8; y < SIZE_Y - CHART + 8; y++) {
        for (let x = CHART - 8; x < SIZE_X - CHART + 8; x++) {
            const i = ground.tile(x, y);
            if (ground.level0.overlays[i] !== SEA_OVERLAY || biomeAt(x, y) === SCORCHED) {
                continue;
            }
            // Not in among the stilts
            const inBay = x - CHART < 60 && y - CHART > 22 && y - CHART < 74 && x - CHART > 20;
            if (shape.toSea[i] !== 0 || inBay || !water[i] || zone[i]) {
                continue;
            }
            if ((x * 5 + y * 3) % SURF_SPACING === 0) {
                const id = SEAWEED[(x + y) % SEAWEED.length];
                const rotation = (x * 3 + y) & 3;
                ground.grid.locs.push({ id, type: LOC_NORMAL, rotation, level: 0, x, y });
            }
        }
    }
}

// The rest of the ground's dressing, by what's on it
function scatter(build: Build, water: Uint8Array, shape: Shape): void {
    const { ground, rng, biomeNear, sizeX, sizeY, arena } = build;
    const clumps = createNoise(SEED + 9);
    const place = (id: number, size: number, type: number, x: number, y: number) => {
        ground.place({ id, type, rotation: Math.floor(rng() * 4), level: 0, x, y }, size, size);
    };
    const clearAt = (x: number, y: number) =>
        CLEARINGS.some(([cx, cy, radius]) => Math.hypot(x - cx - CHART, y - cy - CHART) < radius);
    const reach = 40;
    for (let y = Math.max(arena.y0 - reach, 1); y < Math.min(arena.y1 + reach, sizeY - 2); y++) {
        for (
            let x = Math.max(arena.x0 - reach, 1);
            x < Math.min(arena.x1 + reach, sizeX - 2);
            x++
        ) {
            const i = ground.tile(x, y);
            if (water[i] || ground.level0.flags[i] & TILE_BLOCKED || ground.reserved[i]) {
                continue;
            }
            if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < SPAWN_CLEAR) {
                continue;
            }
            const roll = rng();
            const biome = biomeNear(x, y, rng());
            const clump = clumps(x / 15, y / 15);
            const beach = shape.toSea[i] < 7;
            const open = clearAt(x, y);
            const tree = beach || open ? 0.02 : clump > 0.5 ? 0.3 : 0.06;
            if (roll < tree) {
                const [id, size] =
                    biome === TROPICAL && beach
                        ? pick(rng, TROPICAL.trees.slice(0, 3))
                        : pick(rng, biome.trees);
                if (ground.isClear(x - 1, y - 1, size + 2, size + 2)) {
                    place(id, size, LOC_NORMAL, x, y);
                }
            } else if (roll < tree + 0.05) {
                if (biome === JUNGLE && clump > 0.5 && ground.isClear(x, y, 1, 1)) {
                    place(pick(rng, UNDERGROWTH), 1, LOC_NORMAL, x, y);
                }
            } else if (roll < tree + 0.062) {
                const [id, size] = pick(rng, biome.rocks);
                if (ground.isClear(x, y, size, size)) {
                    place(id, size, LOC_NORMAL, x, y);
                }
            } else if (roll < tree + 0.074) {
                const [id, size] = pick(rng, biome.props);
                if (ground.isClear(x - 1, y - 1, size + 2, size + 2)) {
                    place(id, size, LOC_NORMAL, x, y);
                }
            } else if (roll < tree + 0.22) {
                if (ground.isClear(x, y, 1, 1)) {
                    const decor = beach ? BEACH_DECOR : biome.decor;
                    ground.grid.locs.push({
                        id: pick(rng, decor),
                        type: LOC_FLOOR_DECORATION,
                        rotation: Math.floor(rng() * 4),
                        level: 0,
                        x,
                        y,
                    });
                }
            } else if (roll < tree + 0.24) {
                if (ground.isClear(x, y, 1, 1) && !open) {
                    place(pick(rng, biome.flowers), 1, LOC_NORMAL, x, y);
                }
            }
        }
    }
}

// paintRock's smoothing takes off anything under 3 tiles across, which is all of a sharp
// cliff: this puts it back, to the tile, so that what's blocked looks it
function paintThinRock(build: Build, rock: Uint8Array, skip: Uint8Array): void {
    const { ground, corners, biomeAt } = build;
    const field = new Float32Array(corners.x * corners.y).fill(-1);
    for (let y = 0; y < SIZE_Y; y++) {
        for (let x = 0; x < SIZE_X; x++) {
            if (rock[ground.tile(x, y)]) {
                for (const at of [
                    x + y * corners.x,
                    x + 1 + y * corners.x,
                    x + (y + 1) * corners.x,
                    x + 1 + (y + 1) * corners.x,
                ]) {
                    field[at] = 1;
                }
            }
        }
    }
    const smooth = smoothField(field, corners.x, corners.y, 1);
    // Only on rock's own tiles: the ground beside a cliff stays plain ground
    const offRock = skip.map((skipped, i) => (skipped || !rock[i] ? 1 : 0));
    ground.paintField(smooth, (x, y) => biomeAt(x, y).rock.overlay, false, offRock);
}

// Anything that can't be walked to is shut off, so nobody stands at it from the far side
function shutOffStranded(build: Build): void {
    const { ground, context, arena, spawn } = build;
    const { grid, sizeX, sizeY } = ground;
    const flags = getCollisionFlags(grid, context.locs);
    const reached = findReachable(flags, sizeX, sizeY, arena, spawn.x, spawn.y);
    const stranded = findStranded(flags, sizeX, arena, reached);
    // Pockets by the cliffs, not an island: check-maps can't see this once they're blocked
    if (stranded.length > MAX_STRANDED) {
        throw new Error(`${stranded.length} tiles can't be reached: is a bridge shut?`);
    }
    for (const i of stranded) {
        blockTile(grid, i);
    }
}

// The lava: out of the crater and down to the sea, and in pools. Above 0 is lava.
function createLavaField(lava: River): { field: Float32Array; pools: Pool[] } {
    const corners = { x: SIZE_X + 1, y: SIZE_Y + 1 };
    const fresh = new Float32Array(corners.x * corners.y).fill(-8);
    const [lavaNorth, , , , , , , , lavaSouth] = LAVA_COURSE;
    for (let y = lavaSouth[0] + CHART; y <= lavaNorth[0] + CHART; y++) {
        // Narrow out of the crater, spreading as it nears the sea
        const spread = lerp(0.45, 1.2, (KALUA.y - y) / (KALUA.y - lavaSouth[0] - CHART));
        const half = BRIDGE_HALF + (riverHalfWidth(lava, y) - BRIDGE_HALF) * spread;
        const centre = riverCentre(lava, y);
        for (let x = Math.floor(centre - half - 4); x <= Math.ceil(centre + half + 4); x++) {
            fresh[x + y * corners.x] = half - Math.abs(x - centre);
        }
    }
    const pools: Pool[] = [
        { x: KALUA.x, y: KALUA.y, radius: RIM_RADIUS - 6, level: 0, source: true },
        ...LAVA_PONDS.map(([x, y, radius]) => ({
            x: x + CHART,
            y: y + CHART,
            radius,
            level: 0,
        })),
    ];
    const lip = createNoise(SEED + 10, 1);
    for (const pool of pools) {
        const reach = Math.ceil(pool.radius * 1.5) + 8;
        for (let y = pool.y - reach; y <= pool.y + reach; y++) {
            for (let x = pool.x - reach; x <= pool.x + reach; x++) {
                const at = x + y * corners.x;
                const edge = pool.radius * (0.75 + lip(x / 9, y / 9) * 0.5);
                fresh[at] = Math.max(fresh[at], edge - Math.hypot(x - pool.x, y - pool.y));
            }
        }
    }
    return { field: smoothField(fresh, corners.x, corners.y, 2), pools };
}

function buildMap(context: BuildContext): GeneratedMap {
    const lavaLine = createLavaLine();
    const lava = createLava(lavaLine);
    const { field: smoothFresh, pools } = createLavaField(lava);
    const sea = createSea();
    // The sea stands off the lava, with a crust of black rock between them
    for (let i = 0; i < sea.length; i++) {
        sea[i] = Math.min(sea[i], -smoothFresh[i] - LAVA_CRUST);
    }
    const { deck, skirt } = createDeckMask();
    const notSea = deck.map((tile, i) => tile | skirt[i]);
    const seaTiles = getTouchedTiles(sea, SIZE_X, SIZE_Y).map((tile, i) => tile & (1 - notSea[i]));
    const shape: Shape = {
        sea,
        seaTiles,
        toSea: distanceTo(seaTiles, SIZE_X, SIZE_Y, 16),
        lavaLine,
    };
    const build = createBuild(context, shape);
    const { ground, terrain, corners } = build;
    shapeLand(build, shape);

    const flood = new Uint8Array(corners.x * corners.y);
    const levels = createWaterLevels(build, [lava], pools, smoothFresh, flood, seaTiles);
    const freshTiles = getTouchedTiles(smoothFresh, SIZE_X, SIZE_Y);
    sinkFresh(build, distanceTo(freshTiles, SIZE_X, SIZE_Y, MAX_BANK), levels, shape.toSea);

    const waterTiles = ground.paintField(sea, SEA_OVERLAY, true, notSea);
    ground.paintField(smoothFresh, LAVA_OVERLAY, true).forEach((tile, i) => {
        waterTiles[i] |= tile;
    });
    holdWater(build, seaTiles);
    holdWater(build, freshTiles);

    build.cliffs.set(shapeCliffs(terrain, SETTINGS.walkSlope));
    const passes = cutPasses(build);
    refreshTileHeights(build);
    paintFloors(build, shape);

    pinDeck(build, deck);
    pinTemple(build);

    const bridgeZone = new Uint8Array(waterTiles.length);
    const roads = new RoadNetwork(build, waterTiles, bridgeZone);
    const bridgeStarts: RoadStart[] = [
        ...placeBridges(build, [lava], waterTiles, bridgeZone),
        ...STRAITS.flatMap((strait) =>
            placeBridges(build, [createStrait(strait)], waterTiles, bridgeZone),
        ),
    ];
    layRoads(build, roads);
    for (const { from, lead, height } of bridgeStarts) {
        roads.lay(from, lead, roads.findRoute(from, lead), BRIDGE_ROAD_HALF_WIDTH, height);
    }
    const buildings = [...placeVillage(build, roads), ...placeStilts(build, roads)];
    const landmarks = pinPieces(build, roads);
    placeRuins(build, roads);
    const waterField = sea.map((value, i) => Math.max(value, smoothFresh[i]));
    const falls = placeFallPools(build, { field: waterField, tiles: waterTiles });

    const steepest = SETTINGS.walkSlope * ROAD_STEEPEST;
    gradeRoads(terrain, [...roads.lines, ...passes], build.plots, ROAD_SHOULDER, steepest);
    roads.pinTiles(passes);
    terrain.smoothPins(ROAD_SMOOTHING);
    finishHeights(build);
    blockSteepGround(build);

    // No little square of road where the spawn is: the road just ends on the sand
    bridgeZone[ground.tile(SPAWN.x + 2, SPAWN.y)] = 1;
    const roadTiles = roads.paint();
    const floored = Uint8Array.from(ground.level0.overlays, (overlay) => (overlay ? 1 : 0));
    fillTiles(ground, deck, PLANKS, floored);
    const stone = createRectMask([PLATFORM, ...STAIRS.map(({ rect }) => rect)], 1);
    fillTiles(ground, stone, SANDSTONE);
    const rockSkip = new Uint8Array(waterTiles.length);
    for (let i = 0; i < rockSkip.length; i++) {
        rockSkip[i] =
            waterTiles[i] |
            roadTiles[i] |
            ground.footprint[i] |
            bridgeZone[i] |
            deck[i] |
            skirt[i] |
            stone[i];
    }
    const rock = paintRock(build, rockSkip);
    paintThinRock(build, rock, rockSkip);
    const caves = placeCaves(build, rock);
    fillTiles(ground, skirt, PLANKS);
    placeFalls(build, falls);
    placeWaymarkers(build, roads);
    stampTemple(build);
    dressMaw(build);
    dressDeck(build, deck);
    placeThings(build);
    landmarks.push(...placeSea(build, waterTiles));
    placeSurf(build, waterTiles, shape, bridgeZone);
    scatter(build, waterTiles, shape);
    dressCliffs(build, rock, rockSkip, falls);
    shutOffStranded(build);
    dressGround(ground, {
        seed: SEED + 300,
        density: SETTINGS.dressing,
        biomeDecor: (x, y) => build.biomeAt(x, y).decor,
    });

    roads.clearLocs(roadTiles);
    return {
        grid: ground.grid,
        footprint: ground.footprint,
        roadTiles,
        clippedRoads: roads.clipped,
        // The road up from the landing clips the corner of this hut: a tile, and it reads as meant
        designed: [{ x0: 192, y0: 137, x1: 192, y1: 137 }],
        lines: roads.lines,
        buildings,
        landmarks,
        passes,
        walkSlope: SETTINGS.walkSlope,
        caves,
        falls,
        waterDrops: [...getWaterDrops(build, [lava]), ...falls.map((fall) => getFallDrop(fall))],
        waterfalls: lava.drops.map(({ along }) => ({ x: riverCentre(lava, along), y: along })),
    };
}

export const KALUAS_WAKE: MapRecipe = {
    id: "scaperune_kalua",
    mapX: 72,
    mapY: 88,
    squaresX: SQUARES_X,
    squaresY: SQUARES_Y,
    margin: 1,
    spawn: SPAWN,
    build: (context) => buildMap(context).grid,
    detail: buildMap,
    mapDef: {
        name: "Kalua's Wake",
        description:
            "An island chain round a smoking volcano. Fight from Landfall Bay through the jungle " +
            "and the ash to the Sun Temple, the stilts of Tai'Mara and the mouth of Mount Kalua.",
    },
    play: { waveSet: "karamja", enemyDensity: 1, brightness: 1 },
};
