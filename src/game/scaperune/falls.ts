import { CLIFF_FALL, LOW_FALL } from "./biomes";
import { TileRect } from "./collision";
import { Build, LOC_NORMAL, WaterPaint, lerp } from "./mapBuild";
import { Point } from "./paths";
import { holdWater } from "./rivers";
import { Terrain } from "./terrain";

// Waterfalls off cliffs that face the camera, each into a pool of its own, and how a fall sits
// in the ground. The models are made for dead flat ground against a wall: the height of every
// vertex is added to the ground under it, so any cliff under one lifts its back and shows what's
// behind it. So a fall gets a seat: level across, level under its front, and a face of a tile
// up to its lip, right behind its top. See CLAUDE.md.

// A fall a cliff can take, and how tall it stands over flat ground
export type FallModel = { id: number; height: number };

export const FALL_MODELS: FallModel[] = [
    { id: LOW_FALL, height: 33 },
    { id: CLIFF_FALL, height: 65 },
];

export const FALL_WIDTH = 3;

// Corners from a fall's south row to the row of its lip
export const FALL_ROWS = 4;

// The shelf at its top can climb this much, to reach a lip higher than the model...
const FALL_STRETCH = 25;

// ...and the ground under it can sink this much, for one a little lower
const FALL_SINK = 6;

// The tallest it can be: a higher cliff gets a cleft cut down to that
const TALLEST_FALL = FALL_MODELS[1].height + FALL_STRETCH;

const TILES_BEHIND = FALL_ROWS;

const FALLS_A_SQUARE = 1.2;

// How far a pool reaches from the middle of the fall's foot, across and out from the cliff
const POOL_ACROSS = 4;

const POOL_OUT = 3;

// Columns either side that stand as the fall does, so that its edges meet rock at its own
// heights, and that then ease back to the ground, with rows past the lip the same
const FLANK = 2;

const SEAT_BLEND = 3;

// How deep the flat of a lip is, and the water that feeds the fall on it
const LIP_DEPTH = 3;

const SOURCE_ACROSS = 3;

const SOURCE_OUT = 2.5;

// How far from level the top of a cliff can be across a fall's seat
const CLIFF_EVEN = 20;

// How high a fall stands at its foot, on its seat and at its lip
export type FallSeat = { id: number; level: number; base: number; lip: number };

// The seat for a fall from level up to lip, or none if there's no fall that fits
export function getFallSeat(level: number, lip: number): FallSeat | undefined {
    const top = Math.min(lip, level + TALLEST_FALL);
    const rise = top - level;
    const model = [...FALL_MODELS].reverse().find(({ height }) => rise >= height - FALL_SINK);
    if (!model || rise > model.height + FALL_STRETCH) {
        return undefined;
    }
    return { id: model.id, level, base: top - model.height, lip: top };
}

// How high a seat is, by corner rows north of the fall's south row
export function getSeatHeight({ level, base, lip }: FallSeat, row: number): number {
    return row < FALL_ROWS - 1 ? level : row === FALL_ROWS - 1 ? base : lip;
}

// Each corner of a seat, tiles wide from x, and how far it's eased back to the ground round it,
// from 0 on the seat to under 1
export function forSeatCorners(
    x: number,
    y: number,
    seat: FallSeat,
    width: number,
    visit: (cx: number, cy: number, height: number, out: number) => void,
): void {
    const x0 = x - FLANK;
    const x1 = x + width + FLANK;
    const lastRow = FALL_ROWS + LIP_DEPTH;
    for (let row = 0; row <= lastRow + SEAT_BLEND; row++) {
        for (let cx = x0 - SEAT_BLEND; cx <= x1 + SEAT_BLEND; cx++) {
            const out = Math.max(x0 - cx, cx - x1, row - lastRow, 0) / (SEAT_BLEND + 1);
            visit(cx, y + row, getSeatHeight(seat, row), out);
        }
    }
}

// Pins a seat, and eases it back to the ground round it
export function seatFall(
    terrain: Terrain,
    x: number,
    y: number,
    seat: FallSeat,
    width: number = FALL_WIDTH,
): void {
    forSeatCorners(x, y, seat, width, (cx, cy, height, out) => {
        terrain.pin(cx, cy, lerp(height, terrain.height[terrain.corner(cx, cy)], out));
    });
}

// The tiles a seat makes a cliff of, whatever it's done to their slope
export function getSeatTiles(x: number, y: number, width: number = FALL_WIDTH): TileRect {
    return { x0: x - FLANK, y0: y + 1, x1: x + width + FLANK - 1, y1: y + FALL_ROWS - 1 };
}

function fits(build: Build, water: Uint8Array, x: number, y: number): boolean {
    const { ground, cliffs, mainland, terrain, toEdge, spawn, biomeAt } = build;
    if (biomeAt(x, y).molten || toEdge(x, y) < POOL_ACROSS + 3) {
        return false;
    }
    if (Math.hypot(x - spawn.x, y - spawn.y) < POOL_ACROSS * 3) {
        return false;
    }
    for (let tx = x; tx < x + FALL_WIDTH; tx++) {
        if (!cliffs[ground.tile(tx, y + 1)] || !cliffs[ground.tile(tx, y + 2)]) {
            return false;
        }
    }
    const middle = x + (FALL_WIDTH >> 1);
    for (let ty = y - POOL_OUT - 2; ty < y; ty++) {
        for (let tx = middle - POOL_ACROSS - 1; tx <= middle + POOL_ACROSS + 1; tx++) {
            const i = ground.tile(tx, ty);
            if (!ground.inside(tx, ty) || cliffs[i] || !mainland[i] || water[i]) {
                return false;
            }
            if (ground.reserved[i]) {
                return false;
            }
        }
    }
    // A straight cliff with nothing on it: not a corner or a spur, which would need the fall's
    // edges to float
    const x0 = x - FLANK - SEAT_BLEND;
    const x1 = x + FALL_WIDTH + FLANK + SEAT_BLEND;
    for (let ty = y; ty <= y + FALL_ROWS + LIP_DEPTH + SEAT_BLEND; ty++) {
        for (let tx = x0; tx < x1; tx++) {
            const i = ground.tile(tx, ty);
            if (!ground.inside(tx, ty) || water[i] || ground.reserved[i]) {
                return false;
            }
        }
    }
    const { min, max } = terrain.getRange(x0 + SEAT_BLEND, y + TILES_BEHIND, x1 - x0 - 6, 0);
    return max - min <= CLIFF_EVEN;
}

export type PlacedFall = Point & { id: number };

// Picks where falls go and makes their pools, while the ground can still move for them. A spot
// with no seat that fits is left alone.
export function placeFallPools(build: Build, water: WaterPaint): PlacedFall[] {
    const { settings, ground, arena, terrain, corners, rng, biomeAt } = build;
    const falls: PlacedFall[] = [];
    const pools = new Float32Array(corners.x * corners.y).fill(-4);
    const wanted = Math.round(
        settings.cliffFalls * settings.squaresX * settings.squaresY * FALLS_A_SQUARE,
    );
    for (let attempt = 0; attempt < wanted * 600 && falls.length < wanted; attempt++) {
        const x = Math.floor(lerp(arena.x0, arena.x1 - FALL_WIDTH, rng()));
        const y = Math.floor(lerp(arena.y0 + POOL_OUT + 2, arena.y1 - TILES_BEHIND - 1, rng()));
        const clear = falls.every(
            (other) => Math.hypot(other.x - x, other.y - y) > POOL_ACROSS * 4,
        );
        if (!clear || !fits(build, water.tiles, x, y)) {
            continue;
        }
        const level = Math.round(
            terrain.getRange(
                x - POOL_ACROSS,
                y - POOL_OUT,
                FALL_WIDTH + POOL_ACROSS * 2,
                POOL_OUT + 1,
            ).min,
        );
        const lip = Math.round(terrain.getHeight(x + (FALL_WIDTH >> 1), y + TILES_BEHIND));
        const seat = getFallSeat(level, lip);
        if (!seat) {
            continue;
        }
        const middleX = x + FALL_WIDTH / 2;
        const middleY = y - 0.5;
        for (let cy = y - POOL_OUT - 1; cy <= y + 1; cy++) {
            for (let cx = x - POOL_ACROSS; cx <= x + POOL_ACROSS + FALL_WIDTH; cx++) {
                const across = (cx - middleX) / POOL_ACROSS;
                const out = (cy - middleY) / POOL_OUT;
                const reach = (1 - Math.hypot(across, out)) * POOL_OUT;
                const at = cx + cy * corners.x;
                pools[at] = Math.max(pools[at], reach);
                water.field[at] = Math.max(water.field[at], reach);
                if (reach > -2) {
                    terrain.pin(cx, cy, level);
                }
            }
        }
        // After the pool, whose level goes first: it's water
        seatFall(terrain, x, y, seat);
        // What feeds it, on the lip
        const sourceY = y + FALL_ROWS + SOURCE_OUT - 1;
        for (let cy = y + FALL_ROWS; cy <= y + FALL_ROWS + LIP_DEPTH; cy++) {
            for (let cx = x - SOURCE_ACROSS; cx <= x + FALL_WIDTH + SOURCE_ACROSS; cx++) {
                const across = (cx - middleX) / SOURCE_ACROSS;
                const out = (cy - sourceY) / SOURCE_OUT;
                const reach = (1 - Math.hypot(across, out)) * SOURCE_OUT;
                const at = cx + cy * corners.x;
                pools[at] = Math.max(pools[at], reach);
                water.field[at] = Math.max(water.field[at], reach);
            }
        }
        for (let ty = y - POOL_OUT - 1; ty <= y + FALL_ROWS + LIP_DEPTH; ty++) {
            for (let tx = x - POOL_ACROSS; tx < x + POOL_ACROSS + FALL_WIDTH; tx++) {
                ground.reserved[ground.tile(tx, ty)] = 1;
            }
        }
        const { x0, y0, x1, y1 } = getSeatTiles(x, y);
        for (let ty = y0; ty <= y1; ty++) {
            build.faces.fill(1, ground.tile(x0, ty), ground.tile(x1 + 1, ty));
        }
        falls.push({ x, y, id: seat.id });
    }
    if (falls.length > 0) {
        const painted = ground.paintField(pools, (x, y) => biomeAt(x, y).water, true);
        painted.forEach((tile, i) => {
            water.tiles[i] |= tile;
        });
        holdWater(build, painted);
    }
    return falls;
}

// The falls themselves, once the heights are settled and the pools are painted
export function placeFalls(build: Build, falls: PlacedFall[]): void {
    for (const { x, y, id } of falls) {
        build.ground.grid.locs.push({ id, type: LOC_NORMAL, rotation: 0, level: 0, x, y });
    }
}

// The tile that a fall's water tilts on, between the lip and the top of its shelf
export function getFallDrop({ x, y }: Point, width: number = FALL_WIDTH): TileRect {
    const row = y + FALL_ROWS - 2;
    return { x0: x - FLANK, y0: row, x1: x + width + FLANK - 1, y1: row + 1 };
}
