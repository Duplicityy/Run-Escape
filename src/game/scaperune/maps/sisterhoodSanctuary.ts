import { Ground } from "../Ground";
import { BIOMES } from "../biomes";
import { blockTile, findReachable, getCollisionFlags } from "../collision";
import { dressGround, dressRock, paintRockFloor } from "../dress";
import { MAP_SQUARE_SIZE, TILE_BLOCKED } from "../format";
import type { GeneratedMap } from "../generator";
import {
    LOC_FLOOR_DECORATION,
    LOC_NORMAL,
    LOC_WALL,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    smoothstep,
} from "../mapBuild";
import { Rng, createNoise, createRng } from "../noise";
import { BuildContext, MapRecipe } from "../recipe";

// The Sisterhood Sanctuary: where Phosani's Nightmare is fought (content/phosani.ts), on its
// own. It's the real fight's two places in one, both read from the cache's own squares. The
// arena is The Nightmare's dream (map square 60,155): her dark floor, dead grass
// and nightmare flowers over it, walled round in the Sanctuary's own stone with a gate north
// and south, each closed by its barrier. Round that is the chamber she sleeps in under Slepe
// (square 59,152): the Sisterhood's masonry and rock blocks, Lumiere's candles, braziers,
// hooded statues, coffins, the chains she broke, the Pool of Nightmares and Phosani's coffin
// beyond the north gate, the scythe statues and the stairs down at the south one, and the
// Theatre of Blood's dead raiders where the Sisterhood's hunters fell.
//
// The arena is the one map square in the middle, and the fight never leaves it: nothing solid
// stands on it, and build throws if anything does. The chamber round it is scenery, and every
// tile of it is blocked, as the barriers seal the real arena: enemies turn up anywhere walkable
// 19 to 24 tiles from the player, and a wall round the arena would strand them outside it.
//
// The cache has no dead inquisitor: the Sisterhood's dead are their coffins and tombs here,
// and their Inquisitor is Phosani, in hers.

const SQUARES = 3;
const MARGIN = 1;
const SIZE = SQUARES * MAP_SQUARE_SIZE;
const ARENA_MIN = MARGIN * MAP_SQUARE_SIZE;
const ARENA_MAX = SIZE - ARENA_MIN - 1;
const MIDDLE = (ARENA_MIN + ARENA_MAX + 1) / 2;

// Heights, in units: the floor, and how far above it the cave's roof stands
const FLOOR = 40;
const WALL = 110;
// Tiles past the arena the chamber's floor runs: its wall stands on the next, and rock blocks
// behind that, then the cave climbs over CLIMB tiles
const CHAMBER = 9;
const WALL_RING = CHAMBER + 1;
const BLOCKS_RING = CHAMBER + 2;
const CLIMB = 14;

// The gate in the spikes, north and south: this many tiles either side of the middle, and
// the way through it kept clear of the chamber's clutter
const GATE_HALF = 2;
const GATEWAY_HALF = 4;
// Nothing within this of the middle, where she rises
const CLEAR_RADIUS = 5;

// Underlays, as the map files store them (the cache's id plus one). The dream's real floor
// (72) is black, with its slabs over it; here it's a deep indigo with slate in it, so the
// fight's faint warnings read. The Sanctuary's floor and its rock are the real ones.
const DREAM_GROUND = [24, 24, 24, 104];
const CHAMBER_GROUND = 98;
const ROCK_GROUND = 97;
// Overlays: the Sanctuary's dirt, and rock's own colour
const DIRT = 88;
const ROCK = 99;

// The dream's small flowers (clip 0, so walked over). The real floor's slabs (37632) are
// left out: they draw as plain black here, and the fight's warnings are drawn faint
const DREAM_FLOWER = 37633;
// What the dream grows underfoot (loc type 22): dead grass, and the nightmare's flowers
// Mostly the light tufts: the thick one is 336 triangles, and there are hundreds of them
export const DEAD_GRASS = [37717, 37717, 37718, 37718, 37718, 37716];
export const NIGHTMARE_FLOWERS = [37712, 37713, 37714, 37714, 37715, 37710];
// The Sanctuary's floor: Morytania's bones and pebbles, and its own bone bits. Its flags
// (37786 to 37809) are left out: from the camera they read as loose chequered tiles.
export const CHAMBER_FLOOR = [12705, 12910, 12911, 33623, 33635];
// Blood, the Theatre's and the Nightmare's
export const BLOOD = [652, 653, 654, 37846, 37847, 37848];
// Lumiere's candles, lit all through the Sanctuary, and Hallowed Night's
export const CANDLES = [12301, 12302, 12302, 11472, 11473];

// What blocks, [loc id, tiles across, tiles deep] unturned. None of it stands on the arena.
type Solid = [id: number, sizeX: number, sizeY: number];
// The barrier across each gate, the one piece of the dream's own ring that reads from the
// camera. Its spikes (37646 to 37657) are fragments of a wall stacked over several levels and
// show as loose shards on their own, its posts (37865) as flat plates, its fallen trunks
// (37709) as black bars, and its gates (37637, 37639) as a dark canopy from above.
const BARRIER: Solid = [37730, 1, 5];
// The dream's dead trees and its bats
const DEAD_TREES: Solid[] = [
    [37706, 2, 2],
    [37706, 2, 2],
    [37707, 3, 3],
];
const GREAT_TREE: Solid = [37708, 6, 6];
const BAT: Solid = [37724, 2, 2];

// The Sanctuary's kit
const SANCTUARY_WALL = 37746;
const LOC_WALL_CORNER = 2;
const PILASTERS: Solid[] = [
    [37783, 2, 2],
    [37784, 2, 2],
];
const ROCK_BLOCK: Solid = [37754, 1, 1];
const BRAZIER: Solid = [37826, 1, 1];
const HOODED_STATUE: Solid = [37842, 2, 2];
const SMALL_STATUE: Solid = [37843, 1, 1];
const SCYTHE_STATUES: Solid[] = [
    [37818, 6, 4],
    [37819, 6, 4],
];
const POOL_OF_NIGHTMARES: Solid = [37825, 2, 2];
const PHOSANIS_COFFIN: Solid = [37951, 2, 1];
const TOMBS: Solid[] = [
    [37879, 2, 4],
    [37881, 2, 4],
];
const STANDING_COFFIN: Solid = [37849, 1, 1];
const COFFIN: Solid = [37850, 2, 1];
const CHAINS: Solid = [37853, 1, 1];
const BROKEN_CHAIN: Solid = [37852, 1, 1];
const STAIRS: Solid = [37832, 2, 3];
const RUBBLE: Solid[] = [
    [37813, 2, 2],
    [37814, 2, 2],
    [37815, 2, 2],
];
const STONES: Solid[] = [
    [37810, 1, 1],
    [37811, 1, 1],
    [37812, 1, 1],
    [37816, 1, 1],
    [37817, 1, 1],
];
const BRIAR: Solid = [30704, 1, 1];
const WEB: Solid = [25443, 1, 1];
// The camp at the south east: the Sisterhood's table, its altar cloths and its stores
const RITUAL_TABLE: Solid = [37839, 2, 1];
const BENCH: Solid = [37840, 2, 1];
const ALTAR_CLOTHS: Solid[] = [
    [37837, 1, 1],
    [37838, 1, 1],
];
const LECTERN: Solid = [37820, 1, 1];
const BIG_CHEST: Solid = [37845, 2, 2];
const CRATE: Solid = [37936, 1, 1];
// The Theatre of Blood's dead: the skeletons in Verzik's hall, the armoured one in Ver Sinhaza,
// and the mercenaries' bodies and the corpses Xarpus exhumes, which his room's script lays
// out (they're not in its square). The exhumed one is floor decoration, so it goes by dress.
const DEAD_RAIDERS: Solid[] = [
    [32735, 2, 1],
    [32742, 2, 1],
    [32741, 2, 1],
    [32754, 1, 1],
    [32754, 1, 1],
];
const EXHUMED = 32743;
// The dream's sleepers, the armoured figures that hang round her arena. In the cache they
// stand on an upper level over the void; LocOverrides.ts lifts them off the ground here.
const SLEEPERS: Solid[] = [
    [37732, 1, 1],
    [37733, 1, 1],
    [37734, 1, 1],
    [37735, 1, 1],
    [37736, 1, 1],
    [37737, 1, 1],
];

// Everything above that blocks, for a test to build the map without the cache
export const SOLID_LOCS: Solid[] = [
    BARRIER,
    ...DEAD_TREES,
    GREAT_TREE,
    BAT,
    ...PILASTERS,
    ROCK_BLOCK,
    BRAZIER,
    HOODED_STATUE,
    SMALL_STATUE,
    ...SCYTHE_STATUES,
    POOL_OF_NIGHTMARES,
    PHOSANIS_COFFIN,
    ...TOMBS,
    STANDING_COFFIN,
    COFFIN,
    CHAINS,
    BROKEN_CHAIN,
    STAIRS,
    ...RUBBLE,
    ...STONES,
    BRIAR,
    WEB,
    RITUAL_TABLE,
    BENCH,
    ...ALTAR_CLOTHS,
    LECTERN,
    BIG_CHEST,
    CRATE,
    ...DEAD_RAIDERS,
    ...SLEEPERS,
];
// And what's walked through
export const WALK_THROUGH = [
    DREAM_FLOWER,
    EXHUMED,
    ...DEAD_GRASS,
    ...NIGHTMARE_FLOWERS,
    ...CHAMBER_FLOOR,
    ...BLOOD,
    ...CANDLES,
];

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

// Whether a tile's on the way through a gate, north or south, which stays clear
function onGateway(x: number, y: number): boolean {
    return (
        Math.abs(x + 0.5 - MIDDLE) <= GATEWAY_HALF + 0.5 &&
        (y < ARENA_MIN || y > ARENA_MAX) &&
        outside(x, y) <= CHAMBER
    );
}

// A side of the arena, for what stands along each: along runs with the side, out is tiles
// past the arena
type Side = (along: number, out: number) => [x: number, y: number];
const NORTH: Side = (along, out) => [MIDDLE + along, ARENA_MAX + out];
const SOUTH: Side = (along, out) => [MIDDLE + along, ARENA_MIN - out];
const WEST: Side = (along, out) => [ARENA_MIN - out, MIDDLE + along];
const EAST: Side = (along, out) => [ARENA_MAX + out, MIDDLE + along];

class Sanctuary {
    readonly rng = createRng(1877);
    readonly ground: Ground;
    // Tiles something's already standing on that you can walk through
    private readonly dressed = new Uint8Array(SIZE * SIZE);
    // Rock, once the heights are in
    rock = new Uint8Array(SIZE * SIZE);

    constructor(readonly context: BuildContext) {
        this.ground = new Ground(SIZE, SIZE);
    }

    // Something solid, off the arena, the gateways and the rock, at its south west tile.
    // gap keeps tiles clear round it, and onWay lets the gates' own things stand on a gateway.
    solid(
        [id, sizeX, sizeY]: Solid,
        x: number,
        y: number,
        rotation = 0,
        gap = 0,
        onWay = false,
    ): boolean {
        const across = rotation & 1 ? sizeY : sizeX;
        const deep = rotation & 1 ? sizeX : sizeY;
        for (let ty = y - gap; ty < y + deep + gap; ty++) {
            for (let tx = x - gap; tx < x + across + gap; tx++) {
                if (!this.ground.inside(tx, ty) || inArena(tx, ty)) {
                    return false;
                }
                if (!onWay && onGateway(tx, ty)) {
                    return false;
                }
                const i = this.ground.tile(tx, ty);
                // Painted floor's fine to stand on: only what's built is in the way
                if (this.rock[i] || this.dressed[i] || this.ground.footprint[i]) {
                    return false;
                }
            }
        }
        this.ground.place({ id, type: LOC_NORMAL, rotation, level: 0, x, y }, across, deep);
        return true;
    }

    // The same, on rock: the blocks the cave's built of
    onRock([id, sizeX, sizeY]: Solid, x: number, y: number, rotation = 0): void {
        if (!this.ground.inside(x, y) || this.ground.footprint[this.ground.tile(x, y)]) {
            return;
        }
        this.ground.place({ id, type: LOC_NORMAL, rotation, level: 0, x, y }, sizeX, sizeY);
    }

    // Something you can walk through: one to a tile, and never on what's built or on rock.
    // Painted floor is fine: candles stand on stone.
    dress(
        id: number,
        type: number,
        x: number,
        y: number,
        rotation?: number,
        onWay = false,
    ): boolean {
        if (!this.ground.inside(x, y) || (!onWay && onGateway(x, y))) {
            return false;
        }
        const i = this.ground.tile(x, y);
        if (this.dressed[i] || this.ground.footprint[i] || this.rock[i]) {
            return false;
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
        return true;
    }

    // A few of something, somewhere along a side between the arena and the chamber's wall
    scatter(
        side: Side,
        count: number,
        from: number,
        to: number,
        put: (x: number, y: number, turn: number) => boolean,
    ): void {
        const reach = ARENA_MAX - ARENA_MIN;
        for (let placed = 0, tries = 0; placed < count && tries < count * 12; tries++) {
            const along = Math.floor(this.rng() * (reach + 1)) - Math.floor(reach / 2);
            const out = from + Math.floor(this.rng() * (to - from + 1));
            const [x, y] = side(along, out);
            if (put(x, y, Math.floor(this.rng() * 4))) {
                placed++;
            }
        }
    }
}

// The floor flat across the arena and the chamber, then the cave climbing to its roof,
// rough on the way up
function shapeGround(sanctuary: Sanctuary): void {
    const { ground } = sanctuary;
    const rough = createNoise(1878, 2);
    for (let y = 0; y <= SIZE; y++) {
        for (let x = 0; x <= SIZE; x++) {
            const out = cornerOutside(x, y);
            const climb = smoothstep((out - BLOCKS_RING - 1) / CLIMB);
            let height = FLOOR + WALL * climb;
            height += (rough(x / 9, y / 9) - 0.5) * 14 * smoothstep((out - BLOCKS_RING - 1) / 4);
            ground.setHeight(x, y, height);
        }
    }
    const { underlays, flags } = ground.level0;
    const shade = createNoise(1879, 2);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const i = ground.tile(x, y);
            const out = outside(x, y);
            if (out >= BLOCKS_RING) {
                sanctuary.rock[i] = 1;
                underlays[i] = ROCK_GROUND;
                flags[i] |= TILE_BLOCKED;
            } else if (out === 0) {
                const band = Math.floor(shade(x / 16, y / 16) * DREAM_GROUND.length * 1.3);
                underlays[i] = DREAM_GROUND[Math.min(band, DREAM_GROUND.length - 1)];
            } else {
                underlays[i] = CHAMBER_GROUND;
            }
        }
    }
}

// The floors: dirt in patches over the chamber and down from each gate, and rock's own colour
// on the cave, with its blocks along the foot
function paintFloors(sanctuary: Sanctuary): void {
    const { ground, rng } = sanctuary;
    const cornersX = SIZE + 1;
    const churn = createNoise(1880, 2);
    const field = new Float32Array(cornersX * (SIZE + 1));
    for (let y = 0; y <= SIZE; y++) {
        for (let x = 0; x <= SIZE; x++) {
            const out = cornerOutside(x, y);
            if (out === 0 || out > CHAMBER) {
                field[x + y * cornersX] = -1;
                continue;
            }
            const gateway = Math.abs(x - MIDDLE) <= GATEWAY_HALF - 1 && out >= 1;
            field[x + y * cornersX] = gateway ? 1 : (churn(x / 6, y / 6) - 0.62) * 4;
        }
    }
    const arena = new Uint8Array(SIZE * SIZE);
    for (let y = ARENA_MIN; y <= ARENA_MAX; y++) {
        for (let x = ARENA_MIN; x <= ARENA_MAX; x++) {
            arena[ground.tile(x, y)] = 1;
        }
    }
    ground.paintField(field, DIRT, false, arena);

    paintRockFloor(ground, sanctuary.rock, ROCK);
    dressRock(ground, sanctuary.rock, {
        kitAt: () => BIOMES.deadlands.rock,
        seed: 1881,
        share: 1,
    });
    // The blocks the Sanctuary's cut from, along the foot of the cave behind its wall
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (outside(x, y) === BLOCKS_RING && rng() < 0.8) {
                sanctuary.onRock(ROCK_BLOCK, x, y, Math.floor(rng() * 4));
            }
        }
    }
}

// The ring round the arena: the Sanctuary's own wall on the tile past its edge, facing in, a
// pilaster at each corner and either side of the gate north and south, and the barrier across
// each gate. The dream's own ring pieces don't read from the camera (see BARRIER).
function placeRing(sanctuary: Sanctuary): void {
    const { ground, rng } = sanctuary;
    const { locs } = ground.grid;
    const wall = (x: number, y: number, type: number, rotation: number) =>
        locs.push({ id: SANCTUARY_WALL, type, rotation, level: 0, x, y });
    const low = ARENA_MIN - 1;
    const high = ARENA_MAX + 1;
    const inGate = (tile: number) => tile >= MIDDLE - GATE_HALF && tile <= MIDDLE + GATE_HALF;
    for (let along = ARENA_MIN; along <= ARENA_MAX; along++) {
        // Each on its tile's inner edge, facing the arena
        if (!inGate(along)) {
            wall(along, low, LOC_WALL, WALL_NORTH);
            wall(along, high, LOC_WALL, WALL_SOUTH);
        }
        wall(low, along, LOC_WALL, WALL_EAST);
        wall(high, along, LOC_WALL, WALL_WEST);
    }
    // Corners turn to meet both inner edges: a corner piece's rotation is the corner it turns
    wall(low, low, LOC_WALL_CORNER, 1);
    wall(low, high, LOC_WALL_CORNER, 2);
    wall(high, high, LOC_WALL_CORNER, 3);
    wall(high, low, LOC_WALL_CORNER, 0);
    for (const [x, y] of [
        [low - 1, low - 1],
        [low - 1, high],
        [high, high],
        [high, low - 1],
    ]) {
        sanctuary.solid(pick(rng, PILASTERS), x, y);
    }
    for (const side of [NORTH, SOUTH]) {
        // Pilasters either side of the gate, and the barrier across it, five long
        sanctuary.solid(pick(rng, PILASTERS), ...side(-GATE_HALF - 3, 1), 0, 0, true);
        sanctuary.solid(pick(rng, PILASTERS), ...side(GATE_HALF + 2, 1), 0, 0, true);
        sanctuary.solid(BARRIER, ...side(-GATE_HALF, 1), 1, 0, true);
    }
}

// The chamber's wall, with its pilasters, on the tiles round the floor
function placeWall(sanctuary: Sanctuary): void {
    const { ground, rng } = sanctuary;
    const { locs } = ground.grid;
    const wall = (x: number, y: number, type: number, rotation: number) =>
        locs.push({ id: SANCTUARY_WALL, type, rotation, level: 0, x, y });
    const low = ARENA_MIN - WALL_RING;
    const high = ARENA_MAX + WALL_RING;
    for (let along = low + 1; along < high; along++) {
        // Each on its tile's inner edge, facing the floor
        wall(along, low, LOC_WALL, WALL_NORTH);
        wall(along, high, LOC_WALL, WALL_SOUTH);
        wall(low, along, LOC_WALL, WALL_EAST);
        wall(high, along, LOC_WALL, WALL_WEST);
    }
    // Corners turn to meet both inner edges: a corner piece's rotation is the corner it turns
    wall(low, low, LOC_WALL_CORNER, 1);
    wall(low, high, LOC_WALL_CORNER, 2);
    wall(high, high, LOC_WALL_CORNER, 3);
    wall(high, low, LOC_WALL_CORNER, 0);
    // Pilasters against the wall, a dozen tiles apart, two tiles square
    for (let along = -30; along <= 30; along += 12) {
        for (const side of [NORTH, SOUTH, WEST, EAST]) {
            const [x, y] = side(along, CHAMBER);
            const across = side === NORTH || side === SOUTH;
            sanctuary.solid(pick(rng, PILASTERS), across ? x : x - 1, across ? y - 1 : y, 0);
        }
    }
}

// Beyond the north gate: the Pool of Nightmares, where her fight is drunk from, with Phosani's
// coffin behind it against the wall, the Sisterhood's tombs either side, and the hooded
// statues watching the gate
function placeNorthAlcove(sanctuary: Sanctuary): void {
    const { rng } = sanctuary;
    sanctuary.solid(POOL_OF_NIGHTMARES, ...NORTH(-1, 7), 0, 0, true);
    sanctuary.solid(PHOSANIS_COFFIN, ...NORTH(-1, 9), 0, 0, true);
    sanctuary.solid(BRAZIER, ...NORTH(-5, 8));
    sanctuary.solid(BRAZIER, ...NORTH(4, 8));
    sanctuary.solid(TOMBS[0], ...NORTH(-8, 5));
    sanctuary.solid(TOMBS[1], ...NORTH(6, 5));
    sanctuary.solid(HOODED_STATUE, ...NORTH(-7, 2), 3);
    sanctuary.solid(HOODED_STATUE, ...NORTH(5, 2), 1);
    for (let i = 0; i < 12; i++) {
        const angle = (i * 2 * Math.PI) / 12;
        const [x, y] = NORTH(Math.round(Math.cos(angle) * 3), 8 + Math.round(Math.sin(angle) * 2));
        sanctuary.dress(pick(rng, CANDLES), LOC_NORMAL, x, y, undefined, true);
    }
}

// Beyond the south gate: the scythe statues that flank the Sanctuary's own way in, and the
// stairs down from Slepe against the wall; the Sisterhood's camp east of them, and their
// coffins west
function placeSouth(sanctuary: Sanctuary): void {
    const { rng } = sanctuary;
    // Four deep, so they stand from the wall's foot to just short of the ring's spikes
    sanctuary.solid(SCYTHE_STATUES[0], ...SOUTH(-11, 7));
    sanctuary.solid(SCYTHE_STATUES[1], ...SOUTH(5, 7));
    sanctuary.solid(STAIRS, ...SOUTH(-1, 7), 2, 0, true);
    sanctuary.solid(BRAZIER, ...SOUTH(-5, 9));
    sanctuary.solid(BRAZIER, ...SOUTH(4, 9));
    // The camp
    sanctuary.solid(BIG_CHEST, ...SOUTH(22, 9));
    sanctuary.solid(RITUAL_TABLE, ...SOUTH(17, 6), 0, 1);
    sanctuary.solid(BENCH, ...SOUTH(17, 4), 2);
    sanctuary.solid(LECTERN, ...SOUTH(14, 9));
    sanctuary.solid(ALTAR_CLOTHS[0], ...SOUTH(19, 9));
    sanctuary.solid(ALTAR_CLOTHS[1], ...SOUTH(20, 9));
    sanctuary.solid(BRAZIER, ...SOUTH(20, 3));
    for (const [along, out] of [
        [25, 6],
        [26, 7],
        [25, 8],
        [27, 5],
        [12, 7],
    ]) {
        sanctuary.solid(CRATE, ...SOUTH(along, out), Math.floor(rng() * 4));
    }
    for (const [along, out] of [
        [16, 9],
        [24, 9],
        [29, 7],
    ]) {
        sanctuary.solid(WEB, ...SOUTH(along, out), Math.floor(rng() * 4));
    }
    // The coffins, the standing ones against the wall
    for (const along of [-29, -24, -19, -14]) {
        sanctuary.solid(STANDING_COFFIN, ...SOUTH(along, 9), 2);
        sanctuary.dress(pick(rng, CANDLES), LOC_NORMAL, ...SOUTH(along + 1, 9));
    }
    for (const [along, out] of [
        [-27, 6],
        [-21, 7],
        [-16, 5],
    ]) {
        sanctuary.solid(COFFIN, ...SOUTH(along, out), Math.floor(rng() * 4), 1);
    }
}

// All round the chamber: the Sisterhood's dead and the Theatre's, the chains she broke, the
// dream's trees and bats come through the gates, rubble, briars, statues along the walls,
// braziers, and candles everywhere
function placeChamber(sanctuary: Sanctuary): void {
    const { rng } = sanctuary;
    const sides = [NORTH, SOUTH, WEST, EAST];
    // The dream's great trees in the chamber's corners
    for (const [x, y] of [
        [ARENA_MIN - CHAMBER, ARENA_MAX + 3],
        [ARENA_MAX + 3, ARENA_MAX + 3],
        [ARENA_MIN - CHAMBER, ARENA_MIN - 9],
        [ARENA_MAX + 3, ARENA_MIN - 9],
    ]) {
        sanctuary.solid(GREAT_TREE, x, y, Math.floor(rng() * 4));
    }
    for (const side of sides) {
        const along = side === WEST || side === EAST;
        // Braziers and small statues along the wall
        for (const at of [-18, 18]) {
            sanctuary.solid(BRAZIER, ...side(at, 9));
        }
        for (const at of [-26, -9, 10, 27]) {
            sanctuary.solid(SMALL_STATUE, ...side(at, 9), side === NORTH ? 2 : 0);
        }
        if (along) {
            for (const at of [-22, -4, 14, 30]) {
                sanctuary.solid(STANDING_COFFIN, ...side(at, 9), side === WEST ? 1 : 3);
            }
        }
        // The Theatre's dead, over the empty ground, each in its own blood
        sanctuary.scatter(side, 10, 2, 8, (x, y, turn) => {
            if (!sanctuary.solid(pick(rng, DEAD_RAIDERS), x, y, turn, 1)) {
                return false;
            }
            for (const [dx, dy] of [
                [-1, 0],
                [2, 0],
                [0, 1],
                [1, -1],
            ]) {
                if (rng() < 0.7) {
                    sanctuary.dress(pick(rng, BLOOD), LOC_FLOOR_DECORATION, x + dx, y + dy);
                }
            }
            // And now and then one of Xarpus's exhumed beside it
            if (rng() < 0.3) {
                sanctuary.dress(EXHUMED, LOC_FLOOR_DECORATION, x - 1, y + 1);
            }
            return true;
        });
        // The dream's sleepers, hanging in the dark over the chamber
        sanctuary.scatter(side, 4, 3, 8, (x, y, turn) =>
            sanctuary.solid(pick(rng, SLEEPERS), x, y, turn),
        );
        sanctuary.scatter(side, 3, 2, 3, (x, y, turn) => sanctuary.solid(CHAINS, x, y, turn));
        sanctuary.scatter(side, 4, 2, 4, (x, y, turn) => sanctuary.solid(BROKEN_CHAIN, x, y, turn));
        sanctuary.scatter(side, 3, 4, 7, (x, y, turn) =>
            sanctuary.solid(pick(rng, DEAD_TREES), x, y, turn, 1),
        );
        sanctuary.scatter(side, 2, 2, 8, (x, y, turn) => sanctuary.solid(BAT, x, y, turn));
        sanctuary.scatter(side, 3, 6, 8, (x, y, turn) =>
            sanctuary.solid(pick(rng, RUBBLE), x, y, turn),
        );
        sanctuary.scatter(side, 8, 3, 9, (x, y, turn) =>
            sanctuary.solid(pick(rng, STONES), x, y, turn),
        );
        sanctuary.scatter(side, 4, 8, 9, (x, y, turn) => sanctuary.solid(BRIAR, x, y, turn));
        // Blood where the dead lie, and candles against the spikes and along the wall
        sanctuary.scatter(side, 20, 2, 8, (x, y) =>
            sanctuary.dress(pick(rng, BLOOD), LOC_FLOOR_DECORATION, x, y),
        );
        sanctuary.scatter(side, 14, 1, 2, (x, y) =>
            sanctuary.dress(pick(rng, CANDLES), LOC_NORMAL, x, y),
        );
        sanctuary.scatter(side, 10, 8, 9, (x, y) =>
            sanctuary.dress(pick(rng, CANDLES), LOC_NORMAL, x, y),
        );
    }
}

// The arena itself: her small flowers, and dead grass and the nightmare's flowers
// thick over it as the dream has them, with the middle kept clear, where she rises
function dressArena(sanctuary: Sanctuary): void {
    const { rng } = sanctuary;
    for (let y = ARENA_MIN; y <= ARENA_MAX; y++) {
        for (let x = ARENA_MIN; x <= ARENA_MAX; x++) {
            const distance = Math.hypot(x + 0.5 - MIDDLE, y + 0.5 - MIDDLE);
            if (distance < CLEAR_RADIUS) {
                continue;
            }
            const roll = rng();
            if (roll < 0.03) {
                sanctuary.dress(DREAM_FLOWER, LOC_NORMAL, x, y);
            } else if (roll < 0.15) {
                sanctuary.dress(pick(rng, DEAD_GRASS), LOC_FLOOR_DECORATION, x, y);
            } else if (roll < 0.2) {
                sanctuary.dress(pick(rng, NIGHTMARE_FLOWERS), LOC_FLOOR_DECORATION, x, y);
            }
        }
    }
}

// Nothing solid on the arena, all of it reachable, and the chamber sealed
function finish(sanctuary: Sanctuary): void {
    const { context, ground } = sanctuary;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (!inArena(x, y)) {
                blockTile(ground.grid, ground.tile(x, y));
            }
        }
    }
    const rect = { x0: ARENA_MIN, y0: ARENA_MIN, x1: ARENA_MAX, y1: ARENA_MAX };
    const collision = getCollisionFlags(ground.grid, context.locs);
    const { spawn } = SISTERHOOD_SANCTUARY;
    const reached = findReachable(collision, SIZE, SIZE, rect, spawn.x, spawn.y);
    for (let y = ARENA_MIN; y <= ARENA_MAX; y++) {
        for (let x = ARENA_MIN; x <= ARENA_MAX; x++) {
            const i = ground.tile(x, y);
            if (!reached[i] || ground.level0.flags[i] & TILE_BLOCKED) {
                throw new Error(`Sisterhood Sanctuary: something solid on her ground at ${x},${y}`);
            }
        }
    }
}

function buildDetail(context: BuildContext): GeneratedMap {
    const sanctuary = new Sanctuary(context);
    shapeGround(sanctuary);
    paintFloors(sanctuary);
    placeRing(sanctuary);
    placeWall(sanctuary);
    placeNorthAlcove(sanctuary);
    placeSouth(sanctuary);
    placeChamber(sanctuary);
    dressArena(sanctuary);
    dressGround(sanctuary.ground, {
        seed: 1882,
        density: 1,
        biomeDecor: (x, y) => (inArena(x, y) ? DEAD_GRASS : CHAMBER_FLOOR),
    });
    finish(sanctuary);
    const { ground } = sanctuary;
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
export const SANCTUARY_BOSS_ARENA = {
    baseX: 78 * MAP_SQUARE_SIZE + ARENA_MIN,
    baseY: 72 * MAP_SQUARE_SIZE + ARENA_MIN,
    size: ARENA_MAX - ARENA_MIN + 1,
};

export const SISTERHOOD_SANCTUARY: MapRecipe = {
    id: "phosani",
    // East of Hallowed Night's squares, and clear of the rest (see CLAUDE.md's traps)
    mapX: 78,
    mapY: 72,
    squaresX: SQUARES,
    squaresY: SQUARES,
    margin: MARGIN,
    // The middle of the arena, where her entrance puts the player anyway
    spawn: { x: MIDDLE, y: MIDDLE },
    build: (context) => buildDetail(context).grid,
    detail: buildDetail,
};
