import type { RunEventDef } from "../../content/types";
import { RUN_LENGTH, paced } from "../../content/waves";
import { Ground } from "../Ground";
import { WATERFALL } from "../biomes";
import { TileRect, blockTile, findReachable, findStranded, getCollisionFlags } from "../collision";
import { RockKit, dressGround, dressRock, paintRockFloor } from "../dress";
import { FALL_WIDTH, forSeatCorners, getFallDrop, getFallSeat } from "../falls";
import { TILE_BLOCKED, TileGrid } from "../format";
import { GeneratedMap } from "../generator";
import { lerp } from "../mapBuild";
import { Rng, createNoise, createRng, smoothField } from "../noise";
import { addPathToField, smoothPath } from "../paths";
import { rotatePrefab } from "../prefab";
import { BRIDGES, PrefabKit, loadPrefab } from "../prefabs";
import { BuildContext, MapRecipe } from "../recipe";
import { Terrain, getTileSlope, liftFaces, limitNorthFaces, spreadNearest } from "../terrain";

// The Shards of Ysmar: a hand-made map. When the sky god Ysmar fell, he broke the world he
// landed on. Six pieces of it still hang over the stars, joined by causeways his priests
// laid down: the Threshold where you arrive, the Redwold that drank his blood, the Glasswood
// his tears set into, the Sporeland that grew on his flesh, the Boneyard where his skeleton
// lies, and the Heartkeep, built round the heart that won't stop beating.
//
// Everything's placed by hand, in grid tiles, x east and y north: the outlines, the
// causeways, the roads, the river and every set piece. Only what's strewn about is rolled.

const SQUARES = 6;
const SIZE = SQUARES * 64;
const CORNERS = SIZE + 1;
const ARENA_MIN = 64;
const ARENA_MAX = SIZE - 65;

const WALK_SLOPE = 12;
// How steep the ground gets where it comes round to meet a causeway or plot
const SETTLE_SLOPE = 6;

const LOC_WALL = 0;
const LOC_NORMAL = 10;
const LOC_FLOOR_DECORATION = 22;
const WALL_WEST = 0;
const WALL_NORTH = 1;
const WALL_EAST = 2;
const WALL_SOUTH = 3;

// Floors, as the map files store them. No underlay at all draws nothing, and past the
// black the void's made of that, with stars here and there.
const VOID_STARS = 39;
const VOID_BLACK = 139;
// How much of the noise is cloud
const CLOUD_LINE = 0.56;
const ROCK_STONE = 2;
const ROCK_DARK = 99;
const COBBLES = 12;
const PLAIN_STONE = 10;
const STEEPEST_FACE = 72;
const DAIS_SIZE = 12;
const DAIS_RISE = 12;
const DAIS_STATUE = 7002;
const PILE_OF_BRICKS = 4769;
// Grey stone, on grey rock
const ROCK_KIT: RockKit = {
    pebbles: [336, 14483, 14482],
    rubble: [
        [11434, 2],
        [11435, 2],
    ],
};
const BLOOD = 331;
const LAVA = 19;
// A clear blue-green, for the Glasswood. Its one colour's edge is the shore's
const WATER = 568;

type Point = [x: number, y: number];

// [loc id, tiles across]
type Prop = [id: number, size: number];

type ShardDef = {
    outline: Point[];
    height: number;
    ground: number[];
    // Underlay of its rock, and of what's strewn near its edge
    rock: number;
    road: number;
    trail: number;
};

const THRESHOLD = 0;
const REDWOLD = 1;
const BONEYARD = 2;
const HEARTKEEP = 3;
const SPORELAND = 4;
const GLASSWOOD = 5;

const SHARDS: ShardDef[] = [
    {
        outline: [
            [168, 90],
            [182, 78],
            [204, 76],
            [218, 88],
            [220, 106],
            [206, 120],
            [192, 126],
            [176, 120],
            [166, 106],
        ],
        height: 150,
        ground: [99, 48, 99],
        rock: 94,
        road: 12,
        trail: 63,
    },
    {
        outline: [
            [78, 118],
            [92, 90],
            [120, 78],
            [148, 88],
            [152, 114],
            [140, 128],
            [150, 146],
            [136, 168],
            [110, 172],
            [90, 160],
            [72, 142],
        ],
        height: 124,
        ground: [235, 118, 234],
        rock: 241,
        road: 0,
        trail: 240,
    },
    {
        outline: [
            [76, 226],
            [98, 208],
            [130, 210],
            [136, 232],
            [128, 250],
            [152, 276],
            [136, 300],
            [104, 306],
            [78, 294],
            [72, 266],
            [68, 242],
        ],
        height: 112,
        ground: [97, 96, 92],
        rock: 94,
        road: 12,
        trail: 97,
    },
    {
        outline: [
            [170, 150],
            [214, 150],
            [232, 168],
            [236, 224],
            [218, 244],
            [168, 244],
            [150, 226],
            [148, 170],
        ],
        height: 196,
        ground: [97, 94, 92],
        rock: 94,
        road: 12,
        trail: 94,
    },
    {
        outline: [
            [254, 230],
            [264, 206],
            [292, 206],
            [312, 230],
            [302, 252],
            [312, 278],
            [296, 302],
            [262, 306],
            [240, 292],
            [232, 268],
            [244, 248],
        ],
        height: 150,
        ground: [23, 28, 23],
        rock: 24,
        road: 83,
        trail: 28,
    },
    {
        outline: [
            [240, 96],
            [262, 78],
            [292, 82],
            [310, 102],
            [304, 128],
            [312, 146],
            [296, 170],
            [264, 172],
            [244, 156],
            [250, 130],
            [236, 114],
        ],
        height: 176,
        ground: [143, 144, 143],
        rock: 162,
        road: 106,
        trail: 144,
    },
];

// The Threshold's east causeway has lost a span, and a bridge hangs in the gap. Its stamp's 18
// tiles long, so its deck runs from x 224 to x 236 here.
const SPAN_HEIGHT = 163;
const SPAN_X = 220;

// Where causeways meet: a platform if it has a radius
type Node = { x: number; y: number; height: number; radius: number };

const NODES: Record<string, Node> = {
    threshold_w: { x: 172, y: 104, height: 150, radius: 0 },
    threshold_e: { x: 214, y: 104, height: 150, radius: 0 },
    threshold_n: { x: 192, y: 122, height: 150, radius: 0 },
    redwold_e: { x: 146, y: 104, height: 124, radius: 0 },
    redwold_n: { x: 112, y: 168, height: 124, radius: 0 },
    west_stair: { x: 112, y: 190, height: 118, radius: 8 },
    boneyard_s: { x: 112, y: 212, height: 112, radius: 0 },
    boneyard_e: { x: 146, y: 266, height: 112, radius: 0 },
    crown: { x: 192, y: 266, height: 150, radius: 12 },
    sporeland_w: { x: 238, y: 266, height: 150, radius: 0 },
    sporeland_s: { x: 276, y: 212, height: 150, radius: 0 },
    east_stair: { x: 276, y: 190, height: 163, radius: 8 },
    glasswood_n: { x: 276, y: 168, height: 176, radius: 0 },
    glasswood_w: { x: 244, y: 104, height: 176, radius: 0 },
    // The span that fell: the ends of the causeway, with a bridge between them
    span_w: { x: 220, y: 104, height: SPAN_HEIGHT, radius: 0 },
    span_e: { x: 236, y: 104, height: SPAN_HEIGHT, radius: 0 },
    keep_s: { x: 192, y: 154, height: 196, radius: 0 },
    keep_n: { x: 192, y: 240, height: 196, radius: 0 },
};

const CAUSEWAY_HALF_WIDTH = 4;

const CAUSEWAYS: [from: string, to: string][] = [
    ["threshold_w", "redwold_e"],
    ["threshold_e", "span_w"],
    ["span_e", "glasswood_w"],
    ["threshold_n", "keep_s"],
    ["redwold_n", "west_stair"],
    ["west_stair", "boneyard_s"],
    ["boneyard_e", "crown"],
    ["crown", "sporeland_w"],
    ["crown", "keep_n"],
    ["sporeland_s", "east_stair"],
    ["east_stair", "glasswood_n"],
];

// Roads across the shards, between their causeways
const ROADS: { shard: number; points: Point[]; halfWidth: number; broken?: boolean }[] = [
    {
        shard: THRESHOLD,
        points: [
            [170, 104],
            [216, 104],
        ],
        halfWidth: 4,
    },
    {
        shard: THRESHOLD,
        points: [
            [192, 104],
            [192, 124],
        ],
        halfWidth: 4,
    },
    {
        shard: HEARTKEEP,
        points: [
            [192, 150],
            [192, 176],
        ],
        halfWidth: 4,
    },
    {
        shard: HEARTKEEP,
        points: [
            [192, 222],
            [192, 244],
        ],
        halfWidth: 4,
    },
    {
        shard: REDWOLD,
        points: [
            [148, 104],
            [136, 104],
            [124, 100],
            [106, 104],
            [96, 118],
            [98, 136],
            [108, 150],
            [112, 162],
            [112, 170],
        ],
        halfWidth: 1.7,
    },
    {
        shard: BONEYARD,
        broken: true,
        points: [
            [112, 210],
            [110, 224],
            [116, 238],
            [112, 252],
            [122, 262],
            [136, 266],
            [148, 266],
        ],
        halfWidth: 1.7,
    },
    {
        shard: SPORELAND,
        points: [
            [236, 266],
            [250, 268],
            [262, 258],
            [270, 244],
            [278, 232],
            [276, 214],
        ],
        halfWidth: 1.7,
    },
    {
        shard: GLASSWOOD,
        points: [
            [276, 170],
            [272, 156],
            [262, 146],
            [258, 130],
            [256, 114],
            [250, 106],
            [246, 104],
        ],
        halfWidth: 1.7,
    },
    // Straight off both ends of the bridge, on the line of corners its deck's on
    {
        shard: GLASSWOOD,
        points: [
            [246, 104],
            [292, 104],
        ],
        halfWidth: 1,
    },
];

// The river, north to south off the Glasswood's edge, with a lake at the head of it. Its
// straight is where the bridge goes.
const RIVER_LEVEL = 146;
// Where a bridge's deck starts and stops, in its stamp's corners
const DECK_WEST = 4;
const DECK_EAST = 15;
const BRIDGE_ROW = 104;
const RIVER_X = 270;
const RIVER: Point[] = [
    [284, 132],
    [278, 122],
    [271, 114],
    [270, 110],
    [270, 98],
    [269, 90],
    [266, 82],
    [264, 72],
];
const LAKE = { x: 286, y: 138, radiusX: 13, radiusY: 10 };

// The pool of blood in the Redwold, with the altar on its island
const BLOOD_POOL = { x: 122, y: 132, radius: 13, level: 110 };
const BLOOD_STREAM_WIDTH = 1.8;
// It runs off through the notch in the east side, and away down the rock
const BLOOD_STREAM: Point[] = [
    [132, 136],
    [140, 133],
    [146, 131],
];

// Cracks that go right through the land, with the stars under them
const CRACKS: { points: Point[]; halfWidth: number }[] = [
    {
        points: [
            [80, 224],
            [90, 228],
            [96, 222],
        ],
        halfWidth: 1.8,
    },
    {
        points: [
            [112, 292],
            [120, 282],
            [132, 284],
            [138, 296],
        ],
        halfWidth: 2.4,
    },
    {
        points: [
            [126, 216],
            [122, 226],
            [130, 232],
        ],
        halfWidth: 1.6,
    },
];

// Burning cracks in the Heartkeep's yard, running out from the heart
const FISSURES: Point[][] = [
    [
        [181, 188],
        [176, 184],
        [175, 179],
    ],
    [
        [203, 188],
        [208, 183],
        [210, 178],
    ],
    [
        [181, 208],
        [175, 213],
        [176, 219],
    ],
    [
        [203, 208],
        [209, 212],
        [209, 219],
    ],
];

// Bits of land that broke off, too far out to reach: x, y, radius, height, whose it is, and
// what's on it
type Islet = [x: number, y: number, radius: number, height: number, shard: number, prop?: number];

const ISLETS: Islet[] = [
    // South of the Threshold, in the first thing you see
    [150, 70, 5, 110, THRESHOLD, 1276],
    [228, 66, 4, 170, THRESHOLD],
    [196, 58, 6, 124, THRESHOLD, 10820],
    // Round the Redwold
    [54, 112, 6, 96, REDWOLD, 40798],
    [48, 140, 3.5, 140, REDWOLD],
    [100, 60, 5, 110, REDWOLD, 27884],
    [134, 56, 3, 70, REDWOLD],
    // Round the Boneyard
    [50, 280, 5, 90, BONEYARD, 1282],
    [60, 318, 3.5, 130, BONEYARD],
    [122, 326, 5, 80, BONEYARD, 14028],
    [168, 300, 3, 120, BONEYARD],
    // Between the shards
    [170, 136, 2.5, 110, HEARTKEEP],
    [216, 132, 3, 150, HEARTKEEP],
    [254, 190, 3.5, 120, GLASSWOOD, 27882],
    [58, 190, 5, 86, BONEYARD],
    [326, 190, 4.5, 130, GLASSWOOD, 27886],
    // Round the Sporeland
    [334, 244, 5, 120, SPORELAND, 43129],
    [334, 296, 3.5, 90, SPORELAND],
    [284, 326, 5, 110, SPORELAND, 43130],
    [236, 324, 3.5, 150, SPORELAND],
    // Round the Glasswood
    [334, 118, 6, 140, GLASSWOOD, 27878],
    [336, 156, 3.5, 100, GLASSWOOD],
    [300, 58, 5, 120, GLASSWOOD, 27882],
    [256, 56, 3, 90, GLASSWOOD],
    // Far out, past the arena
    [22, 180, 9, 130, BONEYARD],
    [28, 60, 7, 90, REDWOLD],
    [358, 60, 8, 120, GLASSWOOD],
    [364, 200, 10, 150, SPORELAND],
    [190, 26, 9, 120, THRESHOLD],
    [196, 358, 11, 130, HEARTKEEP],
    [30, 350, 7, 100, BONEYARD],
    [350, 350, 7, 110, SPORELAND],
];

// What comes at you: what the crystal's grown into, then the Redwold's, the Sporeland's and
// the Boneyard's, and the keep's own demons at the end
const YSMAR_WAVES = paced([
    [
        { id: "crystalline_rat", weight: 3 },
        { id: "ghast", weight: 1 },
    ],
    [
        { id: "crystalline_rat", weight: 2 },
        { id: "crystalline_bat", weight: 2 },
    ],
    [
        { id: "crystalline_bat", weight: 3 },
        { id: "bloodworm", weight: 2 },
    ],
    [
        { id: "bloodworm", weight: 3 },
        { id: "vampyre_juvenile", weight: 2 },
    ],
    [
        { id: "crystalline_spider", weight: 2 },
        { id: "fiyr_shade", weight: 2 },
        { id: "vampyre_juvenile", weight: 1 },
    ],
    [
        { id: "blood_jaguar", weight: 3 },
        { id: "fiyr_shade", weight: 1 },
    ],
    [
        { id: "blood_jaguar", weight: 2 },
        { id: "vampyre_juvinate", weight: 2 },
    ],
    [
        { id: "crypt_spider", weight: 3 },
        { id: "nail_beast", weight: 1 },
    ],
    [
        { id: "nail_beast", weight: 2 },
        { id: "bloodveld", weight: 2 },
    ],
    [
        { id: "jelly", weight: 2 },
        { id: "mutated_bloodveld", weight: 2 },
    ],
    [
        { id: "skeleton", weight: 3 },
        { id: "shade", weight: 2 },
    ],
    [
        { id: "shade", weight: 2 },
        { id: "ghost", weight: 2 },
        { id: "skeletal_mystic", weight: 1 },
    ],
    [
        { id: "ankou", weight: 2 },
        { id: "skeletal_mystic", weight: 2 },
        { id: "ghost", weight: 1 },
    ],
    [
        { id: "lesser_demon", weight: 3 },
        { id: "hellhound", weight: 2 },
    ],
    [
        { id: "lesser_demon", weight: 2 },
        { id: "revenant_demon", weight: 2 },
        { id: "corrupted_wolf", weight: 1 },
    ],
]);

const YSMAR_EVENTS: RunEventDef[] = [
    { at: 100, kind: "elite", enemyId: "crystalline_wolf" },
    { at: 200, kind: "elite", enemyId: "vampyre_juvinate" },
    { at: 300, kind: "boss", enemyId: "zalcano", hp: 3600 },
    { at: 330, kind: "ring", enemyId: "bloodworm", count: 30 },
    { at: 390, kind: "elite", enemyId: "feral_vampyre" },
    { at: 450, kind: "boss", enemyId: "sotetseg", hp: 5000 },
    { at: 480, kind: "elite", enemyId: "giant_crypt_spider" },
    { at: 540, kind: "elite", enemyId: "ankou" },
    { at: 600, kind: "boss", enemyId: "skotizo", hp: 6500 },
    { at: 620, kind: "ring", enemyId: "ghost", count: 40 },
    { at: 720, kind: "elite", enemyId: "reanimated_demon" },
    { at: 780, kind: "elite", enemyId: "corrupted_bear" },
    { at: 840, kind: "ring", enemyId: "hellhound", count: 50 },
];

// How far a point is from a line's segment
function toSegment(px: number, py: number, a: Point, b: Point): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.min(Math.max(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy), 0), 1);
    return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
}

// Tiles inside an outline, negative outside
function toOutline(px: number, py: number, outline: Point[]): number {
    let distance = Infinity;
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const a = outline[i];
        const b = outline[j];
        distance = Math.min(distance, toSegment(px, py, a, b));
        if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
            inside = !inside;
        }
    }
    return inside ? distance : -distance;
}

function toLine(px: number, py: number, points: Point[]): number {
    let distance = Infinity;
    for (let i = 1; i < points.length; i++) {
        distance = Math.min(distance, toSegment(px, py, points[i - 1], points[i]));
    }
    return distance;
}

// A line through hand-placed points, smoothed, as path points
function smoothLine(points: Point[]): { x: number; y: number }[] {
    const dense: { x: number; y: number }[] = [];
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
        for (let step = 0; step < steps; step++) {
            dense.push({ x: ax + ((bx - ax) * step) / steps, y: ay + ((by - ay) * step) / steps });
        }
    }
    const [lastX, lastY] = points[points.length - 1];
    dense.push({ x: lastX, y: lastY });
    return smoothPath(dense, 4, 3);
}

// What a map's made of, tile by tile
type Map3 = {
    context: BuildContext;
    ground: Ground;
    terrain: Terrain;
    rng: Rng;
    // Above 0 on land, in tiles from its edge
    land: Float32Array;
    // Whose land each corner is, how far into it, and how far into a causeway
    owner: Int8Array;
    shardLand: Float32Array;
    deck: Float32Array;
    // Where the ground's cut off, past the foot of the rock
    foot: Float32Array;
    // Which islet a corner's on, or -1
    islet: Int16Array;
    // Tiles of water and blood, and the field that paints the water
    water: Uint8Array;
    roadTiles: Uint8Array;
    waterField: Float32Array;
    // Bridges: their stamps, and the height of their banks
    bridges: BridgeSite[];
    // Corners under a bridge over the void, which stay where the bridge wants them
    spanCorners: Uint8Array;
};

type BridgeSite = {
    prefab: TileGrid;
    x: number;
    y: number;
    height: number;
    bankHeight: number;
    // Over the river, rather than the void
    overWater?: boolean;
};

function makeLand(map: Map3): void {
    const { land, owner, deck } = map;
    const wobble = createNoise(11, 2);
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const at = x + y * CORNERS;
            const wx = x + (wobble(x / 16, y / 16) - 0.5) * 8;
            const wy = y + (wobble(x / 16 + 40, y / 16) - 0.5) * 8;
            let best = -Infinity;
            let who = 0;
            SHARDS.forEach((shard, i) => {
                const distance = toOutline(wx, wy, shard.outline);
                if (distance > best) {
                    best = distance;
                    who = i;
                }
            });
            for (const crack of CRACKS) {
                const inCrack = crack.halfWidth - toLine(wx, wy, crack.points);
                best = Math.min(best, -inCrack);
            }
            let stone = -Infinity;
            for (const [from, to] of CAUSEWAYS) {
                const a = NODES[from];
                const b = NODES[to];
                // They're straight, so their ends are square
                const across = a.x === b.x ? Math.abs(x - a.x) : Math.abs(y - a.y);
                const along = a.x === b.x ? [a.y, b.y, y] : [a.x, b.x, x];
                const end = Math.min(
                    along[2] - Math.min(along[0], along[1]) + 4,
                    Math.max(along[0], along[1]) + 4 - along[2],
                );
                stone = Math.max(stone, Math.min(CAUSEWAY_HALF_WIDTH + 0.01 - across, end));
            }
            for (const node of Object.values(NODES)) {
                if (node.radius > 0) {
                    const out = Math.max(Math.abs(x - node.x), Math.abs(y - node.y));
                    const round = Math.hypot(x - node.x, y - node.y);
                    stone = Math.max(stone, Math.min(node.radius - out, node.radius + 3 - round));
                }
            }
            deck[at] = stone;
            map.shardLand[at] = best;
            map.islet[at] = -1;
            ISLETS.forEach(([ix, iy, radius, , shard], i) => {
                const reach = Math.hypot(x - ix, y - iy);
                if (reach < radius + 12) {
                    const edge = radius * (0.75 + wobble(x / 3, y / 3) * 0.5) - reach;
                    if (edge > best) {
                        best = edge;
                        who = shard;
                        map.islet[at] = i;
                    }
                }
            });
            land[at] = Math.max(best, stone);
            owner[at] = who;
        }
    }
}

// The pieces of ground over the void, up to where they end
function shapeGround(map: Map3, plots: Plot[]): void {
    const { land, owner, deck, terrain } = map;
    const count = CORNERS * CORNERS;
    const hills = createNoise(12, 2);
    const heldCorners = new Uint8Array(count);
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const at = x + y * CORNERS;
            const islet = map.islet[at];
            const noise = (hills(x / 15, y / 15) - 0.5) * 34;
            terrain.height[at] = (islet >= 0 ? ISLETS[islet][3] : SHARDS[owner[at]].height) + noise;
            heldCorners[at] = land[at] > 0 ? 0 : 1;
        }
    }

    // The Redwold sinks to its pool, and the Heartkeep's yard stands proud
    const pool = BLOOD_POOL;
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const at = x + y * CORNERS;
            if (owner[at] === REDWOLD && land[at] > 0) {
                const reach = Math.hypot(x - pool.x, y - pool.y);
                const sink = Math.max(1 - reach / 34, 0);
                terrain.height[at] -= sink * sink * 18;
            }
        }
    }

    // Flat where the Heartkeep stands
    terrain.pinRect(156, 158, 72, 78, KEEP_HEIGHT);

    // Water stands level, with its corners held
    const water = new Float32Array(count).fill(-4);
    const riverLine = smoothLine(RIVER);
    addPathToField(water, CORNERS, CORNERS, riverLine, (i) => {
        const y = riverLine[Math.min(i, riverLine.length - 1)].y;
        return y < 90 ? 2.6 : 4.5;
    });
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const at = x + y * CORNERS;
            const across = (x - LAKE.x) / LAKE.radiusX;
            const up = (y - LAKE.y) / LAKE.radiusY;
            const inLake = (1 - Math.hypot(across, up)) * LAKE.radiusY;
            water[at] = Math.max(water[at], inLake);
            if (water[at] > -1.5) {
                terrain.pin(x, y, RIVER_LEVEL);
            }
            const reach = Math.hypot(x - pool.x, y - pool.y);
            const isle = Math.max(
                5 - reach,
                5 -
                    toLine(x, y, [
                        [pool.x, pool.y],
                        [104, 142],
                    ]) *
                        2.2,
            );
            const running = BLOOD_STREAM_WIDTH + 1.5 - toLine(x, y, BLOOD_STREAM);
            if ((reach < pool.radius + 1 && isle < 0) || running > 0) {
                terrain.pin(x, y, pool.level);
            }
        }
    }
    // The bridges' own ground. A deck's stored over what's under it: over the void that stays as
    // it was in the prefab, where it isn't drawn, and over the river it's stored again once the
    // heights are done (reseatDecks). Water stays level, and a bank runs level to the deck's ends.
    for (const bridge of map.bridges) {
        const cornersOfStamp = bridge.prefab.sizeX + 1;
        for (let cy = 0; cy <= bridge.prefab.sizeY; cy++) {
            for (let cx = 0; cx <= bridge.prefab.sizeX; cx++) {
                const x = bridge.x + cx;
                const y = bridge.y + cy;
                const at = x + y * CORNERS;
                const own = bridge.prefab.levels[0].heights[cx + cy * cornersOfStamp];
                const onDeck = cx >= DECK_WEST && cx <= DECK_EAST;
                const rise = onDeck && !bridge.overWater ? own - bridge.bankHeight : 0;
                const wet =
                    bridge.overWater &&
                    cx > DECK_WEST &&
                    (water[at] > 0 ||
                        water[at + 1] > 0 ||
                        water[at - 1] > 0 ||
                        water[at + CORNERS] > 0 ||
                        water[at - CORNERS] > 0);
                if (!wet) {
                    // Ahead of the water's own margin
                    terrain.pin(x, y, bridge.height + rise, -1);
                }
                if (land[at] <= 0) {
                    map.spanCorners[at] = 1;
                }
            }
        }
    }

    map.waterField.set(water);

    // Causeways, from the height of one end to the other
    for (const [fromName, toName] of CAUSEWAYS) {
        const from = NODES[fromName];
        const to = NODES[toName];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const points = [];
        const heights = [];
        for (let i = 0; i <= length * 2; i++) {
            const t = i / (length * 2);
            points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
            // It only starts to climb once it's off a platform
            const skipFrom = from.radius > 0 ? (from.radius + 4) / length : 0;
            const skipTo = to.radius > 0 ? (to.radius + 4) / length : 0;
            const up = Math.min(Math.max((t - skipFrom) / (1 - skipFrom - skipTo), 0), 1);
            heights.push(from.height + (to.height - from.height) * up * up * (3 - 2 * up));
        }
        terrain.pinLine(points, heights, CAUSEWAY_HALF_WIDTH + 0.5);
    }
    for (const node of Object.values(NODES)) {
        if (node.radius > 0) {
            const reach = node.radius + 3;
            for (let y = node.y - reach; y <= node.y + reach; y++) {
                for (let x = node.x - reach; x <= node.x + reach; x++) {
                    if (land[x + y * CORNERS] > -1) {
                        terrain.pin(x, y, node.height);
                    }
                }
            }
        }
        if (node.radius === 0) {
            terrain.pinRect(node.x - 5, node.y - 5, 10, 10, node.height, 3);
        }
    }

    for (const plot of plots) {
        const height = terrain.getPinned(plot.x + (plot.size >> 1), plot.y + (plot.size >> 1));
        terrain.pinRect(plot.x, plot.y, plot.size, plot.size, height, 1);
    }

    terrain.settle(SETTLE_SLOPE, heldCorners);
}

// Off the edge the rock falls away to nothing, further on the side the camera sees
function dropEdges(map: Map3): void {
    const { land, terrain, deck } = map;
    const count = CORNERS * CORNERS;
    const rills = createNoise(13, 2);
    const fine = createNoise(15, 1);
    const surface = Float32Array.from(terrain.height);
    for (let i = 0; i < count; i++) {
        if (land[i] <= 0) {
            surface[i] = Infinity;
        }
    }
    spreadNearest(surface, CORNERS, CORNERS);
    const foot = map.foot;
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const at = x + y * CORNERS;
            if (land[at] > 0 || map.spanCorners[at]) {
                continue;
            }
            const south =
                land[Math.min(at + CORNERS * 2, count - 1)] - land[Math.max(at - CORNERS * 2, 0)];
            const facing = Math.min(Math.max(south / 4, 0), 1);
            const nearSpan = Math.abs(x - SPAN_X - 8) < 14 && Math.abs(y - BRIDGE_ROW) < 12;
            const size = nearSpan
                ? 1.6 + facing * 3
                : deck[at] > -14
                  ? 3 + facing * 5
                  : 3.5 + facing * (surface[at] / 15);
            const reach = size * (0.72 + rills(x / 3.5, y / 9) * 0.4 + fine(x / 1.6, y / 5) * 0.16);
            const fall = Math.max(1 + land[at] / reach, 0);
            foot[at] = -land[at] - reach;
            terrain.height[at] = surface[at] * Math.pow(fall, 1.25);
        }
    }
}

// No face past what the real world has: the rock off the edge comes up to meet the land, which
// stays as it is
function easeEdges(map: Map3): void {
    const { terrain, land, spanCorners } = map;
    const held = Uint8Array.from(land, (value, i) => (value > 0 || spanCorners[i] ? 1 : 0));
    liftFaces(terrain.height, CORNERS, CORNERS, STEEPEST_FACE, held);
}

// Ground made flat: for one big thing, which check-maps.ts holds to it, or a whole site
type Plot = { x: number; y: number; size: number; site?: boolean };

function paintFloors(map: Map3): void {
    const { ground, land, owner } = map;
    const count = CORNERS * CORNERS;
    const patches = createNoise(14, 2);
    const nebula = createNoise(16, 2);
    const bandNoise = createNoise(18, 2);
    const { underlays } = ground.level0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const at = x + y * CORNERS;
            const i = ground.tile(x, y);
            const shard = SHARDS[owner[at]];
            const patch = Math.min(Math.max((patches(x / 9, y / 9) - 0.3) / 0.4, 0), 0.999);
            const out = -land[at];
            if (out <= 0) {
                underlays[i] = shard.ground[Math.floor(patch * shard.ground.length)];
            } else if (out < 3) {
                underlays[i] = shard.rock;
            } else if (map.foot[at] < 1.5) {
                underlays[i] = VOID_BLACK;
            } else {
                // Clouds where there are no stars. Nothing's drawn at all round them.
                const cloud = nebula(x / 22, y / 22);
                if (cloud > CLOUD_LINE + 0.09) {
                    underlays[i] = cloud > CLOUD_LINE + 0.15 ? 28 : 24;
                } else {
                    underlays[i] = VOID_BLACK;
                }
            }
        }
    }

    // Stars. Their texture's black isn't quite the underlay's, so where they stop shows, and
    // the foot of the rock's too rough a line to stop at: it's evened out well first
    const stars = new Float32Array(count);
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const cloud = nebula(x / 22, y / 22);
            stars[x + y * CORNERS] = Math.min(
                map.foot[x + y * CORNERS] - 1,
                (CLOUD_LINE + 0.09 - cloud) * 40,
            );
        }
    }
    ground.paintField(smoothField(stars, CORNERS, CORNERS, 8), VOID_STARS, false);

    // The rock under the edge, in bands: bare stone at the top, going dark on the way down
    // and ending in crags. Their edges are lines, so that it's strata rather than steps.
    const stone = new Float32Array(count);
    const upper = new Float32Array(count);
    const lower = new Float32Array(count);
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const at = x + y * CORNERS;
            const out = -land[at];
            const reach = out - map.foot[at];
            const wander = bandNoise(x / 6, y / 6);
            stone[at] = Math.min(out, 1 + wander * 2 - out);
            upper[at] = Math.min(out, (0.5 + wander * 0.3) * reach - out);
            lower[at] = Math.min(out, (0.86 + wander * 0.24) * reach - out);
        }
    }
    ground.paintField(lower, ROCK_DARK, false);
    ground.paintField(upper, ROCK_DARK, false);
    ground.paintField(stone, ROCK_STONE, false);

    // Nothing's drawn under the fallen span, whose ground is up at the bridge
    for (let y = BRIDGE_ROW - 6; y < BRIDGE_ROW + 6; y++) {
        for (let x = SPAN_X + 4; x < SPAN_X + 16; x++) {
            if (land[x + y * CORNERS] <= 0) {
                const i = ground.tile(x, y);
                underlays[i] = 0;
                ground.level0.overlays[i] = 0;
            }
        }
    }
}

// Roads, water, blood and paving, over what's there
function paintWays(map: Map3): void {
    const { ground, deck, land } = map;
    const count = CORNERS * CORNERS;
    const { underlays } = ground.level0;

    const worn = createNoise(19, 2);
    // All the paving's painted at once, in one field. Painted in pieces, each would take the
    // shared tiles along a join for itself, and the join would show as a line of gaps.
    const paving = new Float32Array(count).fill(-4);
    const pave = (x: number, y: number, value: number) => {
        const at = x + y * CORNERS;
        paving[at] = Math.max(paving[at], value);
    };

    // Stains under roads, then the roads
    for (const road of ROADS) {
        const line = smoothLine(road.points);
        const stain = new Float32Array(count).fill(-4);
        addPathToField(stain, CORNERS, CORNERS, line, road.halfWidth + 1.8);
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                if (stain[x + y * CORNERS] > 0 && land[x + y * CORNERS] > 0) {
                    underlays[ground.tile(x, y)] = SHARDS[road.shard].trail;
                }
            }
        }
        // A path in the woods is only worn ground
        const { road: overlay } = SHARDS[road.shard];
        if (overlay === COBBLES) {
            const field = new Float32Array(count).fill(-4);
            addPathToField(field, CORNERS, CORNERS, line, road.halfWidth);
            for (let i = 0; i < count; i++) {
                // What's left of a road that's mostly gone
                const left = road.broken
                    ? (worn((i % CORNERS) / 6, Math.floor(i / CORNERS) / 6) - 0.42) * 12
                    : 4;
                paving[i] = Math.max(paving[i], Math.min(field[i], left));
            }
        } else if (overlay) {
            const field = new Float32Array(count).fill(-4);
            addPathToField(field, CORNERS, CORNERS, line, road.halfWidth);
            const tiles = ground.paintField(field, overlay, false, map.water);
            tiles.forEach((tile, i) => {
                map.roadTiles[i] |= tile;
            });
        } else {
            // Only overlays reserve their tiles, and a worn path has none, so trees would
            // grow on it
            for (let y = 0; y < SIZE; y++) {
                for (let x = 0; x < SIZE; x++) {
                    if (stain[x + y * CORNERS] > 1) {
                        ground.reserved[ground.tile(x, y)] = 1;
                    }
                }
            }
        }
    }

    // The river and lake, and the blood. A deck comes down on its banks, so no water at its ends.
    const deckEnds = new Uint8Array(SIZE * SIZE);
    for (const { x, y, prefab, overWater } of map.bridges) {
        for (let ty = y - 1; ty <= y + prefab.sizeY && overWater; ty++) {
            deckEnds[x + DECK_WEST - 1 + ty * SIZE] = 1;
            deckEnds[x + DECK_WEST + ty * SIZE] = 1;
        }
    }
    const waterTiles = ground.paintField(map.waterField, WATER, true, deckEnds);
    map.water.set(waterTiles);
    const pool = BLOOD_POOL;
    const blood = new Float32Array(count);
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const reach = Math.hypot(x - pool.x, y - pool.y);
            const isle = Math.max(
                5 - reach,
                5 -
                    toLine(x, y, [
                        [pool.x, pool.y],
                        [104, 142],
                    ]) *
                        2.2,
            );
            const running = BLOOD_STREAM_WIDTH - toLine(x, y, BLOOD_STREAM);
            blood[x + y * CORNERS] = Math.max(Math.min(pool.radius - reach, -isle), running);
        }
    }
    const bloodTiles = ground.paintField(blood, BLOOD, true);
    bloodTiles.forEach((tile, i) => {
        map.water[i] |= tile;
    });

    // The Heartkeep's yard, paved, with what's left of its paving broken at the edges
    for (let y = 0; y < CORNERS; y++) {
        for (let x = 0; x < CORNERS; x++) {
            const edge = Math.min(x - YARD.x0, YARD.x1 - x, y - YARD.y0, YARD.y1 - y);
            pave(x, y, Math.min(edge + (worn(x / 7, y / 7) - 0.5) * 8 + 5, 2));
            // The worn stones you arrive on
            const reach = Math.hypot(
                x - SHATTERED_REALM.spawn.x,
                (y - SHATTERED_REALM.spawn.y) * 1.1,
            );
            pave(x, y, 5 + worn(x / 4, y / 4) * 5 - reach);
            // The causeways, wearing out where they come ashore
            const ashore = Math.max(map.shardLand[x + y * CORNERS], 0);
            const frayed = (Math.min(ashore, 3) / 3) * (worn(x / 3, y / 3) - 0.62) * 9;
            const end = deck[x + y * CORNERS] + frayed;
            pave(x, y, Math.min(end, 3 + worn(x / 4, y / 4) * 11 - ashore));
        }
    }

    // A tile holds one overlay, so the paving stops short of the lava, and what's between
    // is scorched ground rather than the edge of a tile
    const fissures = new Float32Array(count).fill(-4);
    for (const line of FISSURES) {
        addPathToField(fissures, CORNERS, CORNERS, smoothLine(line), 1.4);
    }
    const raised = terrainAbove(map, KEEP_HEIGHT + 1.5);
    const paved = paving.map((value, i) =>
        Math.max(Math.min(value, -fissures[i] - 1.6), raised[i]),
    );
    ground.paintField(paved, getPaving, false);
    ground.paintField(fissures, LAVA, true);

    // The terrace's cliff
    const { heights } = ground.level0;
    const cliff = new Uint8Array(SIZE * SIZE);
    for (let y = 144; y < SIZE - 64; y++) {
        for (let x = 276; x < SIZE - 64; x++) {
            if (land[x + y * CORNERS] > 0.5 && getTileSlope(heights, CORNERS, x, y) > WALK_SLOPE) {
                cliff[ground.tile(x, y)] = 1;
            }
        }
    }
    paintRockFloor(ground, cliff, ROCK_STONE, map.water);
}

// Plain paving, as real towns are, and cobbles only in the square round the heart: a texture's
// for a small patch, and over a whole yard it's a band across the screen
function getPaving(x: number, y: number): number {
    const inSquare = Math.abs(x - HEART_SQUARE.x) < HEART_SQUARE.half;
    return inSquare && Math.abs(y - HEART_SQUARE.y) < HEART_SQUARE.half ? COBBLES : PLAIN_STONE;
}

const YARD = { x0: 166, y0: 170, x1: 218, y1: 226 };
const HEART_SQUARE = { x: 192, y: 198, half: 14 };
const KEEP_HEIGHT = 196;
const WALL_RISE = 46;
const TOWER_RISE = 74;
// Round towers on the curtain wall, tiles across
const TOWERS: Point[] = [
    [YARD.x0, YARD.y0],
    [YARD.x1, YARD.y0],
    [YARD.x0, YARD.y1],
    [YARD.x1, YARD.y1],
    [182, YARD.y0],
    [202, YARD.y0],
    [182, YARD.y1],
    [202, YARD.y1],
];

// A shelf of rock over the Glasswood's lake, with a fall into it and a ramp up the west side
const TERRACE: Point[] = [
    [281, 149],
    [300, 149],
    [314, 152],
    [302, 174],
    [282, 174],
];
const TERRACE_RISE = 38;
const TERRACE_RAMP = { y: 161, halfWidth: 3, x0: 279, x1: 293 };
const FALL = { x: 285, y: 147 };
const FALL_SEAT = getFallSeat(RIVER_LEVEL, 208)!;
// Where the river runs off the rock's edge
const RIVER_EDGE: TileRect = { x0: 260, y0: 68, x1: 268, y1: 80 };

function raiseTerrace(map: Map3): void {
    const { terrain, land } = map;
    for (let y = 140; y < CORNERS - 64; y++) {
        for (let x = 270; x < CORNERS - 64; x++) {
            const at = x + y * CORNERS;
            const inside = toOutline(x, y, TERRACE);
            if (inside <= 0 || land[at] <= 0) {
                continue;
            }
            const ramp = TERRACE_RAMP;
            const up = Math.min(Math.max((x - ramp.x0) / (ramp.x1 - ramp.x0), 0), 1);
            const onRamp = Math.abs(y - ramp.y) <= ramp.halfWidth;
            terrain.height[at] += TERRACE_RISE * (onRamp ? up : Math.min(inside / 1.2, 1));
        }
    }
    // The fall's seat, cut into its south edge
    forSeatCorners(FALL.x, FALL.y, FALL_SEAT, FALL_WIDTH, (x, y, seated, out) => {
        const at = x + y * CORNERS;
        terrain.height[at] = lerp(seated, terrain.height[at], out);
    });
}

// A field that's above 0 where the ground's over a height, near the keep
function terrainAbove(map: Map3, height: number): Float32Array {
    const { terrain } = map;
    const field = new Float32Array(CORNERS * CORNERS).fill(-1);
    for (let y = YARD.y0 - 8; y <= YARD.y1 + 8; y++) {
        for (let x = YARD.x0 - 8; x <= YARD.x1 + 8; x++) {
            field[x + y * CORNERS] = terrain.height[x + y * CORNERS] - height;
        }
    }
    return field;
}

// The curtain wall's made of the ground itself, so that it has some bulk: a wall loc's a thin
// thing that's hardly seen on the sides running north and south
function raiseKeep(map: Map3): void {
    const { terrain } = map;
    const worn = createNoise(21, 2);
    const held = new Uint8Array(CORNERS * CORNERS).fill(1);
    for (let y = YARD.y0 - 8; y <= YARD.y1 + 8; y++) {
        for (let x = YARD.x0 - 8; x <= YARD.x1 + 8; x++) {
            const at = x + y * CORNERS;
            held[at] = 0;
            const out = Math.max(YARD.x0 - x, x - YARD.x1, YARD.y0 - y, y - YARD.y1);
            const gate = Math.abs(x - 192) <= 5;
            const breach = worn(x / 8, y / 8);
            let rise = 0;
            if (Math.abs(out) <= 1 && !gate) {
                rise = WALL_RISE * Math.min(Math.max((breach - 0.38) / 0.05, 0), 1);
            }
            for (const [tx, ty] of TOWERS) {
                if (Math.hypot(x - tx, y - ty) < 4.6) {
                    rise = TOWER_RISE;
                }
            }
            terrain.height[at] += rise;
        }
    }
    limitNorthFaces(terrain.height, CORNERS, CORNERS, 30, held);
}

// Puts down a big thing where a plot's been made for it
function placeProp(map: Map3, id: number, size: number, x: number, y: number, rotation = 0): void {
    map.ground.place({ id, type: LOC_NORMAL, rotation, level: 0, x, y }, size, size);
}

const PLOTS: Plot[] = [
    // The Threshold's portal
    { x: 188, y: 80, size: 8 },
    // The Redwold's altar
    { x: 120, y: 130, size: 4 },
    // The great skeleton and what's round it
    { x: 80, y: 236, size: 30, site: true },
    { x: 80, y: 262, size: 28, site: true },
    // The Redwold's giants
    { x: 86, y: 138, size: 6 },
    { x: 92, y: 104, size: 6 },
    { x: 122, y: 88, size: 6 },
    { x: 138, y: 94, size: 6 },
    { x: 112, y: 158, size: 6 },
    { x: 96, y: 150, size: 6 },
    // The elves' hamlet
    { x: 284, y: 92, size: 20, site: true },
    // The Sporeland's giants, against its north edge
    { x: 266, y: 289, size: 9 },
    { x: 284, y: 288, size: 9 },
    { x: 248, y: 284, size: 6 },
    // The keep's yard's already flat
];

// A floor of plain stone raised on the ground, 12 tiles a side, with a rail round it and a
// statue at each corner. It blocks, and nothing that stops you should look like ground, so
// it stands proud and the rail says so.
function placeDais(map: Map3, x: number, y: number): void {
    const { ground } = map;
    const { locs } = ground.grid;
    for (let cy = y; cy <= y + DAIS_SIZE; cy++) {
        for (let cx = x; cx <= x + DAIS_SIZE; cx++) {
            ground.setHeight(cx, cy, ground.getHeight(cx, cy) + DAIS_RISE);
        }
    }
    const { overlays, shapes, rotations, flags } = ground.level0;
    for (let ty = y; ty < y + DAIS_SIZE; ty++) {
        for (let tx = x; tx < x + DAIS_SIZE; tx++) {
            const i = ground.tile(tx, ty);
            overlays[i] = PLAIN_STONE;
            shapes[i] = 0;
            rotations[i] = 0;
            flags[i] |= TILE_BLOCKED;
            ground.reserved[i] = 1;
        }
    }
    const rail = (tx: number, ty: number, rotation: number) =>
        locs.push({ id: 1902, type: LOC_WALL, rotation, level: 0, x: tx, y: ty });
    for (let i = 0; i < DAIS_SIZE; i++) {
        rail(x + i, y, WALL_SOUTH);
        rail(x + i, y + DAIS_SIZE - 1, WALL_NORTH);
        rail(x, y + i, WALL_WEST);
        rail(x + DAIS_SIZE - 1, y + i, WALL_EAST);
    }
    for (const [tx, ty] of [
        [x + 1, y + 1],
        [x + DAIS_SIZE - 3, y + 1],
        [x + 1, y + DAIS_SIZE - 3],
        [x + DAIS_SIZE - 3, y + DAIS_SIZE - 3],
    ]) {
        placeProp(map, DAIS_STATUE, 2, tx, ty);
    }
}

// What came down of the keep: heaps of stone, with bricks among them
function placeFallenStone(map: Map3, x: number, y: number): void {
    placeProp(map, 11433, 2, x + 1, y + 3, x & 3);
    placeProp(map, 11434, 2, x + 3, y + 1, y & 3);
    placeProp(map, 11435, 2, x + 4, y + 4, (x + y) & 3);
    placeProp(map, PILE_OF_BRICKS, 1, x, y + 1, 1);
    placeProp(map, PILE_OF_BRICKS, 1, x + 3, y + 3, 2);
    placeProp(map, PILE_OF_BRICKS, 1, x + 6, y + 3, 0);
}

// Where the river goes over the edge, 3 tiles of foam each
const RIVER_DROPS: { x: number; y: number }[] = [
    { x: 263, y: 80 },
    { x: 266, y: 80 },
];

const GIANT_MUSHROOMS: Point[] = [
    [266, 289],
    [284, 288],
];

function placeSetPieces(map: Map3): void {
    const { ground } = map;
    // The way you came in
    placeProp(map, 33037, 8, 188, 81);
    // A ring of stones round where you start
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + 0.26;
        const x = Math.round(192 + Math.cos(angle) * 11);
        const y = Math.round(92 + Math.sin(angle) * 10);
        if (ground.isClear(x, y, 1, 1)) {
            placeProp(map, [34780, 34781, 7016][i % 3], 1, x, y, i & 3);
        }
    }
    placeProp(map, 27978, 4, 120, 130);
    // Waystones either side of the road north
    placeProp(map, 28914, 3, 185, 112);
    placeProp(map, 28914, 3, 197, 112);

    // The Redwold's great trees
    for (const [x, y] of [
        [86, 138],
        [92, 104],
        [122, 88],
        [138, 94],
        [112, 158],
        [96, 150],
    ]) {
        placeProp(map, 40791, 5, x, y);
    }
    placeProp(map, 37989, 6, 134, 126);

    // The Redwold's great crystals, round its pool
    placeProp(map, 27881, 6, 136, 112);
    placeProp(map, 27880, 5, 100, 124);
    placeProp(map, 27880, 5, 134, 148);
    placeProp(map, 27884, 3, 112, 148);
    for (const [x, y] of [
        [104, 116],
        [130, 118],
        [146, 138],
        [126, 152],
    ]) {
        placeProp(map, 10048, 3, x, y);
    }

    // The Glasswood's: spires round the lake, one standing in it, and elven walls beyond
    placeProp(map, 27878, 5, 284, 136);
    placeProp(map, 27878, 5, 262, 120);
    placeProp(map, 27882, 3, 296, 118);
    placeProp(map, 27878, 5, 266, 156);
    placeProp(map, 27878, 5, 278, 88);
    placeProp(map, 27882, 3, 296, 96);

    // A fairy ring, and spiral things by the Sporeland's road
    for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const x = Math.round(290 + Math.cos(angle) * 6);
        const y = Math.round(246 + Math.sin(angle) * 6);
        placeProp(map, [12005, 12006, 4057][i % 3], 1, x, y, i & 3);
    }
    placeProp(map, 29495, 1, 290, 246);
    placeProp(map, 30663, 3, 258, 250);
    placeProp(map, 30664, 3, 280, 224);

    // The Boneyard's dead: a dragon that came to look, and a field of graves
    placeProp(map, 25202, 4, 120, 232);
    placeProp(map, 56266, 4, 118, 276);
    placeProp(map, 56273, 4, 130, 268);
    for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 7; column++) {
            placeProp(
                map,
                [404, 405, 401, 400][(row + column) & 3],
                1,
                124 + column * 2,
                240 + row * 2,
            );
        }
    }

    // What the Heartkeep's platforms have in the middle of them
    placeProp(map, 3479, 4, 110, 188);
    placeProp(map, 3479, 4, 274, 186);

    // The great skeleton: its skull, and its ribs running north behind it
    placeProp(map, 55142, 7, 92, 238);
    for (let i = 0; i < 6; i++) {
        const y = 250 + i * 6;
        placeProp(map, 49341, 4, 84, y, 0);
        placeProp(map, 49341, 4, 96, y, 2);
        placeProp(map, 11434, 2, 94, y + 1, i & 3);
    }
    placeProp(map, 59324, 3, 102, 240, 0);

    // Their caps are all you'd see of anything just north of them, so nothing goes there: the
    // rock's blocked, under a bank of smaller ones
    for (const [x, y] of GIANT_MUSHROOMS) {
        placeProp(map, 43131, 9, x, y);
        for (let ty = y + 9; ty < y + 15; ty++) {
            for (let tx = x - 1; tx < x + 10; tx++) {
                const i = ground.tile(tx, ty);
                ground.level0.flags[i] |= TILE_BLOCKED;
                if (!((tx ^ ty) & 1) && map.land[tx + ty * CORNERS] > 1) {
                    ground.grid.locs.push({
                        id: (tx + ty) & 2 ? 3886 : 12077,
                        type: LOC_NORMAL,
                        rotation: tx & 3,
                        level: 0,
                        x: tx,
                        y: ty,
                    });
                }
            }
        }
    }
    placeProp(map, 43130, 6, 248, 284);

    // The heart, on its mosaic, with the throne behind it and a carpet up to it
    placeDais(map, 186, 192);
    placeProp(map, 27881, 6, 189, 195);
    placeProp(map, 56265, 9, 188, 208);
    placeProp(map, 61250, 7, 189, 171);
    placeProp(map, 61250, 7, 189, 178);
    placeProp(map, 61250, 7, 189, 185);
    for (let i = 0; i < 8; i++) {
        const angle = ((i + 0.5) / 8) * Math.PI * 2;
        const x = Math.round(192 + Math.cos(angle) * 14) - 1;
        const y = Math.round(198 + Math.sin(angle) * 14) - 1;
        if (ground.isClear(x, y, 3, 3)) {
            placeProp(map, 6283, 3, x, y);
        }
    }

    // Battlements on the south wall, where you see them from
    for (let x = YARD.x0 + 5; x < YARD.x1 - 4; x++) {
        const at = x + (YARD.y0 - 1) * CORNERS;
        if (x & 1 && map.terrain.height[at] > KEEP_HEIGHT + WALL_RISE - 2) {
            ground.grid.locs.push({
                id: 1902,
                type: LOC_WALL,
                rotation: WALL_SOUTH,
                level: 0,
                x,
                y: YARD.y0 - 1,
            });
        }
    }

    // An avenue of statues up to each gate
    for (const y of [154, 160, 166]) {
        placeProp(map, 38428, 3, 183, y);
        placeProp(map, 38449, 3, 198, y);
    }
    for (const y of [229, 235]) {
        placeProp(map, 38449, 3, 183, y);
        placeProp(map, 38428, 3, 198, y);
    }

    // Bits of the keep's roof, where they came down
    placeFallenStone(map, 172, 196);
    placeFallenStone(map, 206, 200);
    placeFallenStone(map, 176, 216);

    // The crown, where the north causeways meet
    placeDais(map, 186, 260);
    placeProp(map, 37818, 6, 189, 272);
    for (const [x, y] of [
        [181, 256],
        [201, 256],
        [181, 274],
        [201, 274],
        [106, 184],
        [116, 184],
        [106, 194],
        [116, 194],
        [270, 182],
        [280, 182],
        [270, 192],
        [280, 192],
    ]) {
        placeProp(map, 33320, 2, x, y);
    }

    // The fall off the terrace, into the lake
    placeProp(map, FALL_SEAT.id, FALL_WIDTH, FALL.x, FALL.y);

    // What's on the bits that broke off
    for (const [x, y, , , , prop] of ISLETS) {
        if (prop !== undefined) {
            const { sizeX } = map.context.locs(prop);
            ground.grid.locs.push({
                id: prop,
                type: LOC_NORMAL,
                rotation: x & 3,
                level: 0,
                x: x - (sizeX >> 1),
                y: y - (sizeX >> 1),
            });
        }
    }

    // The river goes over the edge
    for (const { x, y } of RIVER_DROPS) {
        ground.grid.locs.push({ id: WATERFALL, type: LOC_NORMAL, rotation: 0, level: 0, x, y });
    }
}

// The low walls along a causeway, broken here and there, with a lamp at each end of a stretch
function dressCauseways(map: Map3): void {
    const { ground, rng, land } = map;
    const wall = (x: number, y: number, rotation: number) =>
        ground.grid.locs.push({ id: 1902, type: LOC_WALL, rotation, level: 0, x, y });
    for (const [fromName, toName] of CAUSEWAYS) {
        const from = NODES[fromName];
        const to = NODES[toName];
        const along = from.x === to.x ? "y" : "x";
        const start = Math.min(from[along], to[along]);
        const end = Math.max(from[along], to[along]);
        const across = along === "y" ? from.x : from.y;
        const low = across - CAUSEWAY_HALF_WIDTH;
        const high = across + CAUSEWAY_HALF_WIDTH - 1;
        for (const side of [low, high]) {
            let gap = 0;
            for (let at = start; at <= end; at++) {
                const x = along === "y" ? side : at;
                const y = along === "y" ? at : side;
                const out = along === "y" ? (side === low ? x - 1 : x + 1) : x;
                const outY = along === "y" ? y : side === low ? y - 1 : y + 1;
                // Only over the void
                if (land[out + outY * CORNERS] > 0 || land[x + y * CORNERS] <= 0) {
                    continue;
                }
                if (gap > 0) {
                    gap--;
                    continue;
                }
                if (rng() < 0.12) {
                    gap = 1 + Math.floor(rng() * 3);
                    continue;
                }
                if (rng() < 0.05) {
                    const inX = along === "y" ? x + (side === low ? 1 : -1) : x;
                    const inY = along === "y" ? y : y + (side === low ? 1 : -1);
                    ground.grid.locs.push({
                        id: rng() < 0.5 ? 3614 : 11439,
                        type: LOC_FLOOR_DECORATION,
                        rotation: Math.floor(rng() * 4),
                        level: 0,
                        x: inX,
                        y: inY,
                    });
                }
                const rotation =
                    along === "y"
                        ? side === low
                            ? WALL_WEST
                            : WALL_EAST
                        : side === low
                          ? WALL_SOUTH
                          : WALL_NORTH;
                wall(x, y, rotation);
            }
        }
    }
}

type Strewn = {
    trees: Prop[];
    big: Prop[];
    rocks: Prop[];
    decor: number[];
    flowers: number[];
    treeChance: number;
    bigChance: number;
    // The clump noise trees stand above
    clumpLine: number;
    decorChance: number;
};

const STREWN: Strewn[] = [
    {
        trees: [
            [1276, 2],
            [1278, 2],
            [10820, 3],
        ],
        big: [
            [10790, 2],
            [11434, 2],
        ],
        rocks: [
            [5605, 1],
            [10790, 2],
        ],
        decor: [4735, 4736, 4737, 4738],
        flowers: [1187, 1188, 1189],
        treeChance: 0.09,
        bigChance: 0.004,
        clumpLine: 0.52,
        decorChance: 0.42,
    },
    {
        trees: [
            [40789, 2],
            [40790, 2],
            [40788, 2],
            [40793, 3],
            [40798, 3],
        ],
        big: [
            [27888, 2],
            [27884, 3],
            [1388, 3],
        ],
        rocks: [
            [60918, 2],
            [60927, 2],
        ],
        decor: [652, 652, 40837, 40836, 40838, 61097, 61098],
        flowers: [30830, 60876, 60877],
        treeChance: 0.26,
        bigChance: 0.01,
        clumpLine: 0.46,
        decorChance: 0.2,
    },
    {
        trees: [
            [1282, 2],
            [1283, 2],
            [14513, 2],
            [1289, 1],
            [14514, 1],
        ],
        big: [
            [14028, 3],
            [14029, 3],
            [14032, 3],
            [14472, 2],
            [651, 3],
        ],
        rocks: [
            [11933, 2],
            [4605, 2],
        ],
        decor: [3549, 3548, 3547, 12931, 5358, 5359, 14523],
        flowers: [404, 405, 401, 400],
        treeChance: 0.03,
        bigChance: 0.012,
        clumpLine: 0.5,
        decorChance: 0.2,
    },
    {
        trees: [
            [1282, 2],
            [1283, 2],
            [1289, 1],
        ],
        big: [
            [14028, 3],
            [11933, 2],
            [12749, 2],
            [23564, 2],
        ],
        rocks: [[11933, 2]],
        decor: [3549, 3548, 3547, 3614, 11439, 185, 3703],
        flowers: [],
        treeChance: 0.02,
        bigChance: 0.01,
        clumpLine: 0.5,
        decorChance: 0.3,
    },
    {
        trees: [
            [43129, 4],
            [43129, 4],
            [3883, 2],
            [3886, 1],
            [12077, 1],
        ],
        big: [
            [30663, 3],
            [30664, 3],
            [3885, 3],
        ],
        rocks: [
            [3894, 2],
            [3897, 1],
        ],
        decor: [12052, 12055, 12053, 12054, 15506, 15507, 15508],
        flowers: [12005, 12006, 4057, 12056, 12057],
        treeChance: 0.05,
        bigChance: 0.006,
        clumpLine: 0.5,
        decorChance: 0.2,
    },
    {
        trees: [
            [36672, 2],
            [36674, 3],
        ],
        big: [
            [27886, 2],
            [27882, 3],
            [27878, 5],
            [36530, 3],
        ],
        rocks: [
            [3896, 1],
            [3894, 2],
        ],
        decor: [3549, 3548, 3547, 60420, 60419, 60418, 60423],
        flowers: [36549, 36550, 36551, 3904],
        treeChance: 0.03,
        bigChance: 0.02,
        clumpLine: 0.52,
        decorChance: 0.2,
    },
];

function strew(map: Map3): void {
    const { ground, rng, land, owner, deck } = map;
    const clumps = createNoise(20, 2);
    const spawn = SHATTERED_REALM.spawn;
    const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
    for (let y = ARENA_MIN - 20; y < ARENA_MAX + 20; y++) {
        for (let x = ARENA_MIN - 20; x < ARENA_MAX + 20; x++) {
            const at = x + y * CORNERS;
            if (land[at] < 2 || deck[at] > -2) {
                continue;
            }
            if (Math.hypot(x - spawn.x, y - spawn.y) < 9) {
                continue;
            }
            const strewn = STREWN[owner[at]];
            const place = ([id, size]: Prop, gap: number) => {
                const { min, max } = map.terrain.getRange(x, y, size, size);
                const level = size < 4 || max - min < 8;
                if (level && ground.isClear(x - gap, y - gap, size + gap * 2, size + gap * 2)) {
                    placeProp(map, id, size, x, y, Math.floor(rng() * 4));
                }
            };
            const clump = clumps(x / 14, y / 14);
            const roll = rng();
            const trees = clump > strewn.clumpLine ? strewn.treeChance : strewn.treeChance * 0.1;
            if (roll < trees) {
                place(pick(strewn.trees), 1);
            } else if (roll < trees + strewn.bigChance) {
                place(pick(strewn.big), 1);
            } else if (roll < trees + strewn.bigChance + 0.006) {
                place(pick(strewn.rocks), 0);
            } else if (
                roll < trees + strewn.bigChance + strewn.decorChance &&
                ground.isClear(x, y, 1, 1)
            ) {
                ground.grid.locs.push({
                    id: pick(strewn.decor),
                    type: LOC_FLOOR_DECORATION,
                    rotation: Math.floor(rng() * 4),
                    level: 0,
                    x,
                    y,
                });
            } else if (
                roll < trees + strewn.bigChance + strewn.decorChance + 0.03 &&
                strewn.flowers.length > 0
            ) {
                if (ground.isClear(x, y, 1, 1)) {
                    placeProp(map, pick(strewn.flowers), 1, x, y, Math.floor(rng() * 4));
                }
            }
        }
    }
}

function buildDetail(context: BuildContext): GeneratedMap {
    const ground = new Ground(SIZE, SIZE);
    const count = CORNERS * CORNERS;
    const kit = new PrefabKit(context);
    const def = BRIDGES.elven;
    const prefab = rotatePrefab(loadPrefab(context, def), def.turns, context.locs);
    const map = {
        context,
        ground,
        terrain: new Terrain(CORNERS, CORNERS),
        rng: createRng(7),
        land: new Float32Array(count),
        owner: new Int8Array(count),
        deck: new Float32Array(count),
        shardLand: new Float32Array(count),
        foot: new Float32Array(count),
        islet: new Int16Array(count),
        water: new Uint8Array(SIZE * SIZE),
        roadTiles: new Uint8Array(SIZE * SIZE),
        waterField: new Float32Array(count),
        bridges: [
            {
                prefab,
                x: RIVER_X - 9,
                y: BRIDGE_ROW - 3,
                height: RIVER_LEVEL + def.bankHeight,
                bankHeight: def.bankHeight,
                overWater: true,
            },
            {
                prefab,
                x: SPAN_X,
                y: BRIDGE_ROW - 3,
                height: SPAN_HEIGHT,
                bankHeight: def.bankHeight,
            },
        ],
        spanCorners: new Uint8Array(count),
    };

    makeLand(map);
    shapeGround(map, PLOTS);
    dropEdges(map);
    raiseKeep(map);
    raiseTerrace(map);
    easeEdges(map);
    map.terrain.write((x, y, height) => ground.setHeight(x, y, height));
    paintFloors(map);
    paintWays(map);

    for (const bridge of map.bridges) {
        ground.stamp(prefab, bridge.x, bridge.y, {
            floor: (overlay) => overlay === 61,
            feather: 0,
            flatten: false,
            height: bridge.height,
            anchor: bridge.bankHeight,
            keepUnderlays: true,
            keepHeights: true,
        });
        // A deck stands where it stood in the prefab, over whatever's under it now
        const stampCorners = prefab.sizeX + 1;
        const decks = ground.grid.levels[1].heights;
        for (let cy = 0; cy <= prefab.sizeY && bridge.overWater; cy++) {
            for (let cx = 0; cx <= prefab.sizeX; cx++) {
                const x = bridge.x + cx;
                const y = bridge.y + cy;
                const own = prefab.levels[0].heights[cx + cy * stampCorners];
                const deck = bridge.height - bridge.bankHeight + own + decks[x + y * CORNERS];
                decks[x + y * CORNERS] = Math.max(deck - ground.getHeight(x, y), 0);
            }
        }
    }

    // Ruins in the Heartkeep's yard
    kit.stampRuin(ground, "darkmeyer_house", 1, 168, 174, map.rng, true);
    kit.stampRuin(ground, "darkmeyer_hall", 0, 202, 174, map.rng, true);
    kit.stampRuin(ground, "darkmeyer_shop", 2, 168, 212, map.rng, true);
    // And the elves' hamlet past the bridge
    kit.stampRuin(ground, "prif_house", 0, 286, 108, map.rng, true);
    kit.stampRuin(ground, "prif_hut", 1, 284, 94, map.rng, true);
    kit.stampRuin(ground, "prif_shop", 2, 296, 104, map.rng, true);

    placeSetPieces(map);
    dressCauseways(map);
    strew(map);

    // What's over the void, or too steep to stand on, is blocked
    const { heights, flags } = ground.level0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const at = x + y * CORNERS;
            const edge =
                map.land[at] +
                map.land[at + 1] +
                map.land[at + CORNERS] +
                map.land[at + CORNERS + 1];
            const bridged = ground.grid.levels[1].flags[ground.tile(x, y)] !== 0;
            if ((getTileSlope(heights, CORNERS, x, y) > WALK_SLOPE || edge <= 0) && !bridged) {
                flags[ground.tile(x, y)] |= TILE_BLOCKED;
            }
        }
    }

    // Islets and anything else you can't get to
    const rect = { x0: ARENA_MIN, y0: ARENA_MIN, x1: ARENA_MAX, y1: ARENA_MAX };
    const collision = getCollisionFlags(ground.grid, context.locs);
    const { spawn } = SHATTERED_REALM;
    const reached = findReachable(collision, SIZE, SIZE, rect, spawn.x, spawn.y);
    for (const i of findStranded(collision, SIZE, rect, reached)) {
        blockTile(ground.grid, i);
    }

    // What's on the rock, and on the ground
    const { overlays } = ground.level0;
    const rock = Uint8Array.from(overlays, (overlay, i) =>
        (overlay === ROCK_STONE || overlay === ROCK_DARK) && flags[i] & TILE_BLOCKED ? 1 : 0,
    );
    dressRock(ground, rock, { kitAt: () => ROCK_KIT, seed: 202, share: 1 });
    dressGround(ground, {
        seed: 300,
        density: 1,
        biomeDecor: (x, y) => STREWN[Math.max(map.owner[x + y * CORNERS], 0)].decor,
    });
    return {
        grid: ground.grid,
        footprint: ground.footprint,
        roadTiles: map.roadTiles,
        lines: [],
        buildings: [],
        landmarks: PLOTS.filter(({ site }) => !site).map(({ x, y, size }) => ({
            name: "plot",
            x,
            y,
            sizeX: size,
            sizeY: size,
            onLand: true,
        })),
        passes: [],
        walkSlope: WALK_SLOPE,
        caves: [],
        falls: [FALL],
        waterfalls: RIVER_DROPS,
        waterDrops: [RIVER_EDGE, getFallDrop(FALL)],
    };
}

export const SHATTERED_REALM: MapRecipe = {
    id: "scaperune_ysmar",
    mapX: 88,
    mapY: 72,
    squaresX: SQUARES,
    squaresY: SQUARES,
    margin: 1,
    spawn: { x: 192, y: 92 },
    build: (context) => buildDetail(context).grid,
    detail: buildDetail,
    mapDef: {
        name: "The Shards of Ysmar",
        description:
            "A dead god's world, broken in pieces over the stars. Cross the causeways from the " +
            "Redwold that drank his blood to the Glasswood his tears set into, past his bones, " +
            "to the Heartkeep, where his heart still beats and something still guards it.",
        // A blood rune
        iconObjId: 565,
        difficulty: { hp: 1.25, damage: 1.15 },
        waves: YSMAR_WAVES,
        events: YSMAR_EVENTS,
        // Dev maps have to be fun maps to be open: endless, with the heart's keeper at the end
        // of each round
        fun: { bosses: { pool: ["kril_tsutsaroth"], firstAt: RUN_LENGTH, every: [300, 300] } },
    },
};
