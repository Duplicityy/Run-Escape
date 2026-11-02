import { Ground } from "../Ground";
import { BIOMES } from "../biomes";
import { blockTile, findReachable, findStranded, getCollisionFlags } from "../collision";
import { dressGround, dressRock, paintRockFloor } from "../dress";
import { MAP_SQUARE_SIZE, TILE_BLOCKED } from "../format";
import type { GeneratedMap } from "../generator";
import { LOC_FLOOR_DECORATION, LOC_NORMAL, smoothstep } from "../mapBuild";
import { Rng, createNoise, createRng } from "../noise";
import { BuildContext, MapRecipe } from "../recipe";

// The Inquisitor's Field: where Phosani's Nightmare is fought (content/phosani.ts), on its
// own. A cavern under Slepe, after the real fight's room beneath the Sisterhood Sanctuary:
// one flat square of sanctuary floor, the four totems' corners and her lanes all on it,
// with the battlefield the Sisterhood's hunters died on running out past its edge to the
// cave's walls. The arena is the one map square in the middle: the margin round it is
// scenery, and the fight never leaves the square.
//
// Nothing solid stands on the arena, and build throws if anything does. What's on it you
// can walk through: bones, candles and scrub, the same ones Hallowed Night's circle has.

const SQUARES = 3;
const MARGIN = 1;
const SIZE = SQUARES * MAP_SQUARE_SIZE;
const ARENA_MIN = MARGIN * MAP_SQUARE_SIZE;
const ARENA_MAX = SIZE - ARENA_MIN - 1;
const MIDDLE = (ARENA_MIN + ARENA_MAX + 1) / 2;

// Heights, in units: the floor, and how far above it the cave's walls stand
const FLOOR = 40;
const WALL = 110;
// Tiles past the arena the battlefield runs flat, and over how many the walls then climb
const FIELD = 7;
const CLIMB = 16;
// Rock begins this far above the floor
const ROCK_RISE = 5;

// The sanctuary floor: a disc of paving, with a ring and spokes of the ritual stone on it,
// and the middle kept clear of everything
const PAVING_RADIUS = 25.5;
const RING_RADIUS = 14;
const CLEAR_RADIUS = 7;

// The way in, from the south: how wide the road is, and how wide the cut through the rock
const ROAD_HALF = 1;
const CUT_HALF = 3;

// Where the sanctuary's colonnade stands, in tiles past the arena, and how far apart
const COLONNADE = 2;
const PILLAR_SPACING = 8;

// Underlays, as the map files store them: Morytania's greys, and its rock
const GROUND = [97, 96, 92];
const ROCK_GROUND = 94;
// Overlays
const PAVING = 10;
const RITUAL = 194;
const ROCK = 99;
const ROAD = 110;
const DIRT = 14;
const BLOOD = 331;

// What you can walk through, as Hallowed Night's circle has them
export const BONES = [3665, 6893, 24706, 24707, 15549, 15551, 25090];
export const LONG_BONES = [24708];
export const CANDLES = [11472, 11473];
export const SCRUB = [3549, 3548, 3547, 12931, 5335];
export const LANTERNS = [46265, 46269, 46274];

// What blocks, [loc id, tiles across, tiles deep]. None of it stands on the arena.
type Solid = [id: number, sizeX: number, sizeY: number];
const RUINED_PILLARS: Solid[] = [
    [34795, 1, 1],
    [34796, 1, 1],
];
const STANDING_STONE: Solid = [34780, 1, 1];
const BONE_HEAPS: Solid[] = [
    [14032, 3, 3],
    [14472, 2, 2],
    [14472, 2, 2],
];
const COFFINS: Solid[] = [
    [398, 2, 2],
    [2145, 2, 2],
    [2615, 2, 2],
    [3577, 2, 2],
    [15052, 2, 2],
];
const GRAVES: Solid[] = [
    [404, 1, 1],
    [405, 1, 1],
    [9359, 1, 1],
    [9360, 1, 1],
    [9361, 1, 1],
    [5168, 1, 1],
];
const GIBBETS: Solid[] = [
    [29410, 2, 2],
    [30260, 2, 2],
];
const GALLOWS: Solid = [649, 2, 2];
// A combat dummy: a training post, for the hunters' camp
const DUMMY: Solid = [29336, 1, 1];
const STORES: Solid[] = [
    [357, 1, 1],
    [358, 1, 1],
    [362, 1, 1],
    [365, 1, 1],
    [39456, 1, 1],
    [39242, 1, 1],
];
const HAY: Solid = [300, 2, 2];
const CAULDRON: Solid = [34866, 2, 2];
const WEB: Solid = [25443, 1, 1];
const BIG_LANTERNS: Solid[] = [
    [55455, 2, 2],
    [55457, 2, 2],
    [55459, 2, 2],
    [55461, 2, 2],
    [55463, 2, 2],
];
const PALE_LANTERNS: Solid[] = [
    [55466, 2, 2],
    [55467, 2, 2],
];
const DEAD_TREES: Solid[] = [
    [1282, 2, 2],
    [1283, 2, 2],
    [14513, 2, 2],
    [1286, 1, 1],
    [1287, 1, 1],
    [14514, 1, 1],
    [1289, 1, 1],
];
const ROCK_HEAPS: Solid[] = [
    [11933, 2, 2],
    [4605, 2, 2],
];
// What the hunters came for, fallen at the north of the field, and the sanctuary's
// statues either side of it
const GREAT_SKELETON: Solid = [59324, 7, 3];
const STATUE: Solid = [7002, 2, 2];

// Everything above that blocks, for a test to build the map without the cache
export const SOLID_LOCS: Solid[] = [
    ...RUINED_PILLARS,
    STANDING_STONE,
    ...BONE_HEAPS,
    ...COFFINS,
    ...GRAVES,
    ...GIBBETS,
    GALLOWS,
    DUMMY,
    ...STORES,
    HAY,
    CAULDRON,
    WEB,
    ...BIG_LANTERNS,
    ...PALE_LANTERNS,
    ...DEAD_TREES,
    ...ROCK_HEAPS,
    GREAT_SKELETON,
    STATUE,
];

// The most tiles that can be shut in, as the field's wreckage can box a tile or two
const MAX_SEALED = 0;

const pick = <T>(rng: Rng, from: T[]): T => from[Math.floor(rng() * from.length)];

// How far a tile is outside the arena, 0 on it
function outside(x: number, y: number): number {
    return Math.max(ARENA_MIN - x, x - ARENA_MAX, ARENA_MIN - y, y - ARENA_MAX, 0);
}

// The same for a corner, which run to ARENA_MAX + 1
function cornerOutside(x: number, y: number): number {
    return Math.max(ARENA_MIN - x, x - ARENA_MAX - 1, ARENA_MIN - y, y - ARENA_MAX - 1, 0);
}

function inArena(x: number, y: number): boolean {
    return outside(x, y) === 0;
}

// Whether a tile's on the way in, which stays clear of the wreckage
function onRoad(x: number, y: number): boolean {
    return y < ARENA_MIN && Math.abs(x + 0.5 - MIDDLE) <= CUT_HALF + 1;
}

class Field {
    readonly rng = createRng(1877);
    readonly ground: Ground;
    // Tiles something's already standing on that you can walk through
    private readonly dressed = new Uint8Array(SIZE * SIZE);
    // Rock, once the heights are in
    rock = new Uint8Array(SIZE * SIZE);

    constructor(readonly context: BuildContext) {
        this.ground = new Ground(SIZE, SIZE);
    }

    // Something solid, off the arena, the road and the rock. gap keeps tiles clear round it.
    solid([id, sizeX, sizeY]: Solid, x: number, y: number, rotation = 0, gap = 0): boolean {
        for (let ty = y - gap; ty < y + sizeY + gap; ty++) {
            for (let tx = x - gap; tx < x + sizeX + gap; tx++) {
                if (!this.ground.inside(tx, ty) || inArena(tx, ty) || onRoad(tx, ty)) {
                    return false;
                }
                const i = this.ground.tile(tx, ty);
                if (this.rock[i] || this.dressed[i] || this.ground.reserved[i]) {
                    return false;
                }
            }
        }
        this.ground.place({ id, type: LOC_NORMAL, rotation, level: 0, x, y }, sizeX, sizeY);
        return true;
    }

    // Something you can walk through: one to a tile, and never on what's built or on rock.
    // Painted floor is fine: bones lie on stone.
    dress(id: number, type: number, x: number, y: number, rotation?: number): void {
        if (!this.ground.inside(x, y)) {
            return;
        }
        const i = this.ground.tile(x, y);
        if (this.dressed[i] || this.ground.footprint[i] || this.rock[i]) {
            return;
        }
        if (this.ground.reserved[i] && !this.ground.level0.overlays[i]) {
            return;
        }
        this.dressed[i] = 1;
        this.ground.grid.locs.push({
            id,
            type,
            rotation: rotation ?? Math.floor(this.rng() * 4),
            level: 0,
            x,
            y,
        });
    }
}

// Flat floor, the field flat past it, then the walls climbing to the cave's roof, rough on
// the way up, with the way in cut through the south wall
function shapeGround(field: Field): void {
    const { ground } = field;
    const rough = createNoise(1878, 2);
    const colour = createNoise(1879, 2);
    for (let y = 0; y <= SIZE; y++) {
        for (let x = 0; x <= SIZE; x++) {
            const out = cornerOutside(x, y);
            const climb = smoothstep((out - FIELD) / CLIMB);
            let height = FLOOR + WALL * climb;
            height += (rough(x / 9, y / 9) - 0.5) * 14 * smoothstep((out - FIELD) / 4);
            if (y < ARENA_MIN) {
                // The cut: flat along the road, the walls coming back either side of it
                const cut = smoothstep((Math.abs(x - MIDDLE) - CUT_HALF) / 3);
                height = FLOOR + (height - FLOOR) * cut;
            }
            ground.setHeight(x, y, height);
        }
    }
    const { underlays } = ground.level0;
    const cornersX = SIZE + 1;
    const { heights } = ground.level0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const i = ground.tile(x, y);
            const lowest = Math.min(
                heights[x + y * cornersX],
                heights[x + 1 + y * cornersX],
                heights[x + (y + 1) * cornersX],
                heights[x + 1 + (y + 1) * cornersX],
            );
            if (lowest > FLOOR + ROCK_RISE) {
                field.rock[i] = 1;
                underlays[i] = ROCK_GROUND;
                ground.level0.flags[i] |= TILE_BLOCKED;
                continue;
            }
            const shade = colour(x / 22, y / 22);
            const band = Math.min(Math.floor(shade * GROUND.length * 1.4), GROUND.length - 1);
            underlays[i] = GROUND[band];
        }
    }
}

// The floors: churned dirt over the field, the sanctuary's paving and its ritual lines in the
// middle of the arena, blood where the fighting was, the road in from the south, and rock's
// own colour on the walls
function paintFloors(field: Field): void {
    const { ground, rng } = field;
    const cornersX = SIZE + 1;
    const corners = (value: (x: number, y: number) => number) => {
        const out = new Float32Array(cornersX * (SIZE + 1));
        for (let y = 0; y <= SIZE; y++) {
            for (let x = 0; x <= SIZE; x++) {
                out[x + y * cornersX] = value(x, y);
            }
        }
        return out;
    };
    const fromMiddle = (x: number, y: number) => Math.hypot(x - MIDDLE, y - MIDDLE);

    // Dirt, in patches, over the arena and the field
    const churn = createNoise(1880, 2);
    ground.paintField(
        corners((x, y) => (cornerOutside(x, y) > FIELD + 1 ? -1 : (churn(x / 7, y / 7) - 0.6) * 4)),
        DIRT,
        false,
    );

    // The paving
    ground.paintField(
        corners((x, y) => PAVING_RADIUS - fromMiddle(x, y)),
        PAVING,
        false,
    );

    // The ring, the heart and four spokes, in the ritual stone
    ground.paintField(
        corners((x, y) => {
            const distance = fromMiddle(x, y);
            let value = Math.max(1.6 - Math.abs(distance - RING_RADIUS), 3.5 - distance);
            const dx = x - MIDDLE;
            const dy = y - MIDDLE;
            for (const [ax, ay] of [
                [1, 0],
                [0, 1],
            ]) {
                const along = Math.abs(dx * ax + dy * ay);
                const across = Math.abs(dx * ay - dy * ax);
                if (along > 3 && along < PAVING_RADIUS - 1) {
                    value = Math.max(value, 1.1 - across);
                }
            }
            return value;
        }),
        RITUAL,
        false,
    );

    // Blood, in pools, over the field and the arena's edge where the fighting was
    const pools: [x: number, y: number, radius: number][] = [];
    while (pools.length < 16) {
        const x = ARENA_MIN - FIELD + rng() * (ARENA_MAX - ARENA_MIN + FIELD * 2);
        const y = ARENA_MIN - FIELD + rng() * (ARENA_MAX - ARENA_MIN + FIELD * 2);
        const distance = fromMiddle(x, y);
        if (distance > PAVING_RADIUS - 6 && !onRoad(Math.floor(x), Math.floor(y))) {
            pools.push([x, y, 1.5 + rng() * 1.5]);
        }
    }
    ground.paintField(
        corners((x, y) => {
            let value = -1;
            for (const [px, py, radius] of pools) {
                value = Math.max(value, radius - Math.hypot(x - px, y - py));
            }
            return value;
        }),
        BLOOD,
        false,
    );

    // The way in
    const road = new Uint8Array(SIZE * SIZE);
    for (let y = 1; y < ARENA_MIN + 6; y++) {
        for (let x = MIDDLE - ROAD_HALF - 1; x <= MIDDLE + ROAD_HALF; x++) {
            road[ground.tile(x, y)] = 1;
        }
    }
    ground.paintOverlay(road, ROAD, false);

    // The walls
    paintRockFloor(ground, field.rock, ROCK);
    dressRock(ground, field.rock, {
        kitAt: () => BIOMES.deadlands.rock,
        seed: 1881,
        share: 1,
    });
}

// The sanctuary's colonnade round the arena, and the lanterns at its corners
function placeColonnade(field: Field): void {
    const { rng } = field;
    const low = ARENA_MIN - 1 - COLONNADE;
    const high = ARENA_MAX + 1 + COLONNADE;
    let n = 0;
    for (let along = ARENA_MIN + 4; along <= ARENA_MAX - 3; along += PILLAR_SPACING) {
        const pillar = RUINED_PILLARS[n++ % RUINED_PILLARS.length];
        // The north side's the skeleton's; the south's the way in
        if (Math.abs(along - MIDDLE) > 7) {
            field.solid(pillar, along, high, Math.floor(rng() * 4));
        }
        if (Math.abs(along - MIDDLE) > CUT_HALF + 2) {
            field.solid(pillar, along, low, Math.floor(rng() * 4));
        }
        field.solid(pillar, low, along, Math.floor(rng() * 4));
        field.solid(pillar, high, along, Math.floor(rng() * 4));
    }
    for (const [x, y] of [
        [low, low],
        [low, high],
        [high, low],
        [high, high],
    ]) {
        field.solid(STANDING_STONE, x, y, 0, 0);
    }
    const lantern = ARENA_MIN - 1 - FIELD + 1;
    const far = ARENA_MAX + 1 + FIELD - 2;
    for (const [x, y] of [
        [lantern, lantern],
        [lantern, far],
        [far, lantern],
        [far, far],
    ]) {
        field.solid(pick(rng, BIG_LANTERNS), x, y, Math.floor(rng() * 4), 1);
    }
}

// What the fight left: the Inquisition's gibbets and gallows to the east, its camp and
// its training posts to the west, the Sisterhood's dead to the south either side of the way
// in, and what the hunters came for fallen at the north, in the camera's view
function placeBattlefield(field: Field): void {
    const { rng } = field;
    const east = ARENA_MAX + 4;
    const west = ARENA_MIN - 5;
    const north = ARENA_MAX + 3;
    const south = ARENA_MIN - 4;

    field.solid(GREAT_SKELETON, MIDDLE - 3, north, 0, 1);
    field.solid(STATUE, MIDDLE - 10, north - 1, 0, 1);
    field.solid(STATUE, MIDDLE + 8, north - 1, 0, 1);

    [76, 88, 112, 120].forEach((y, i) => {
        field.solid(i % 2 === 0 ? pick(rng, GIBBETS) : GALLOWS, east, y, Math.floor(rng() * 4), 1);
    });
    for (let y = 72; y <= 120; y += 12) {
        field.solid(DUMMY, west, y, 0, 1);
    }
    field.solid(CAULDRON, west - 1, MIDDLE - 1, 0, 1);
    field.solid(HAY, west - 1, MIDDLE + 6, 1, 1);
    field.solid(HAY, west - 1, MIDDLE - 8, 2, 1);
    for (let i = 0; i < 8; i++) {
        field.solid(
            pick(rng, STORES),
            west + Math.floor(rng() * 3) - 1,
            70 + Math.floor(rng() * 52),
        );
    }

    field.solid(PALE_LANTERNS[0], MIDDLE - CUT_HALF - 5, south, 1, 1);
    field.solid(PALE_LANTERNS[1], MIDDLE + CUT_HALF + 3, south, 2, 1);
    for (const [x, y] of [
        [MIDDLE - 14, south - 1],
        [MIDDLE + 12, south - 1],
    ]) {
        field.solid(BONE_HEAPS[0], x, y, Math.floor(rng() * 4), 1);
    }

    // The rest lies where it fell, all round
    for (let y = ARENA_MIN - FIELD; y <= ARENA_MAX + FIELD; y++) {
        for (let x = ARENA_MIN - FIELD; x <= ARENA_MAX + FIELD; x++) {
            const out = outside(x, y);
            if (out === 0) {
                continue;
            }
            const roll = rng();
            const turn = Math.floor(rng() * 4);
            if (roll < 0.004) {
                field.solid(pick(rng, BONE_HEAPS), x, y, turn, 1);
            } else if (roll < 0.009) {
                field.solid(pick(rng, COFFINS), x, y, turn, 1);
            } else if (roll < 0.022) {
                field.solid(pick(rng, GRAVES), x, y, turn);
            } else if (roll < 0.026) {
                field.solid(WEB, x, y, turn, 1);
            } else if (roll < 0.029 && out >= 4) {
                field.solid(pick(rng, DEAD_TREES), x, y, turn, 1);
            } else if (roll < 0.031 && out >= 5) {
                field.solid(pick(rng, ROCK_HEAPS), x, y, turn);
            } else if (roll < 0.06) {
                field.dress(pick(rng, CANDLES), LOC_NORMAL, x, y);
            } else if (roll < 0.085) {
                field.dress(pick(rng, BONES), LOC_NORMAL, x, y);
            } else if (roll < 0.09) {
                field.dress(pick(rng, LONG_BONES), LOC_NORMAL, x, y);
            } else if (roll < 0.1) {
                field.dress(pick(rng, LANTERNS), LOC_NORMAL, x, y);
            }
        }
    }
}

// The arena itself: candles on the ring, and bones and scrub across the rest, thinner on
// the paving and never in the middle, where she rises
function dressArena(field: Field): void {
    const { rng } = field;
    const ring = 18;
    for (let i = 0; i < ring; i++) {
        const angle = (i * 2 * Math.PI) / ring;
        const x = Math.floor(MIDDLE + Math.cos(angle) * (RING_RADIUS + 2));
        const y = Math.floor(MIDDLE + Math.sin(angle) * (RING_RADIUS + 2));
        field.dress(pick(rng, CANDLES), LOC_NORMAL, x, y);
    }
    for (let y = ARENA_MIN; y <= ARENA_MAX; y++) {
        for (let x = ARENA_MIN; x <= ARENA_MAX; x++) {
            const distance = Math.hypot(x + 0.5 - MIDDLE, y + 0.5 - MIDDLE);
            if (distance < CLEAR_RADIUS) {
                continue;
            }
            const roll = rng() * (distance < PAVING_RADIUS ? 2 : 1);
            if (roll < 0.03) {
                field.dress(pick(rng, SCRUB), LOC_FLOOR_DECORATION, x, y);
            } else if (roll < 0.045) {
                field.dress(pick(rng, BONES), LOC_NORMAL, x, y);
            } else if (roll < 0.05) {
                field.dress(pick(rng, CANDLES), LOC_NORMAL, x, y);
            } else if (roll < 0.052) {
                field.dress(pick(rng, LONG_BONES), LOC_NORMAL, x, y);
            }
        }
    }
}

// Nothing solid on the arena, and all of it reachable from the way in
function finish(field: Field): void {
    const { context, ground } = field;
    const rect = { x0: ARENA_MIN, y0: ARENA_MIN, x1: ARENA_MAX, y1: ARENA_MAX };
    const collision = getCollisionFlags(ground.grid, context.locs);
    const { spawn } = INQUISITORS_FIELD;
    const reached = findReachable(collision, SIZE, SIZE, rect, spawn.x, spawn.y);
    const stranded = findStranded(collision, SIZE, rect, reached);
    if (stranded.length > MAX_SEALED) {
        throw new Error(`Inquisitor's Field: ${stranded.length} tiles cut off`);
    }
    for (const i of stranded) {
        blockTile(ground.grid, i);
    }
    for (let y = ARENA_MIN; y <= ARENA_MAX; y++) {
        for (let x = ARENA_MIN; x <= ARENA_MAX; x++) {
            const i = ground.tile(x, y);
            if (!reached[i] || ground.level0.flags[i] & TILE_BLOCKED) {
                throw new Error(`Inquisitor's Field: something solid on her ground at ${x},${y}`);
            }
        }
    }
}

function buildDetail(context: BuildContext): GeneratedMap {
    const field = new Field(context);
    shapeGround(field);
    paintFloors(field);
    placeColonnade(field);
    placeBattlefield(field);
    dressArena(field);
    dressGround(field.ground, {
        seed: 1882,
        density: 1,
        biomeDecor: () => BIOMES.deadlands.decor,
    });
    finish(field);
    const { ground } = field;
    return {
        grid: ground.grid,
        footprint: ground.footprint,
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
}

// MapDef.bossArena, in world tiles: the whole arena
export const INQUISITORS_BOSS_ARENA = {
    baseX: 78 * MAP_SQUARE_SIZE + ARENA_MIN,
    baseY: 72 * MAP_SQUARE_SIZE + ARENA_MIN,
    size: ARENA_MAX - ARENA_MIN + 1,
};

export const INQUISITORS_FIELD: MapRecipe = {
    id: "phosani",
    // East of Hallowed Night's squares, and clear of the rest (see CLAUDE.md's traps)
    mapX: 78,
    mapY: 72,
    squaresX: SQUARES,
    squaresY: SQUARES,
    margin: MARGIN,
    // At the south of the arena, where the way in comes out
    spawn: { x: MIDDLE, y: ARENA_MIN + 7 },
    build: (context) => buildDetail(context).grid,
    detail: buildDetail,
};
