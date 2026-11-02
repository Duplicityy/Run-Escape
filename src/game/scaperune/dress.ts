import { Ground, OverlayChoice } from "./Ground";
import { RockDef } from "./biomes";
import { WATER_OVERLAYS } from "./catalogue";
import { FLOOR_KITS } from "./floorKits";
import { TILE_BLOCKED } from "./format";
import { createRng, distanceTo, smoothField } from "./noise";
import { getTileSlope } from "./terrain";

// What goes on the ground once it's shaped: rock's dressing and the carpet of small things
// that real ground has on every tile. Hand-made maps call these too, so they only need Ground.
// See the design research, sections 3 and 4.

const LOC_NORMAL = 10;
const LOC_FLOOR_DECORATION = 22;

// How steep a tile is before a heap of rock can stand on it, and how many of those get one
const SLIDE_SLOPE = 16;
const SLIDE_SHARE = 0.45;
// Rock with pebbles on it
const PEBBLE_SHARE = 0.4;
// Past this a pebble's bent to the ground so far that it reads as a black shard
const PEBBLE_SLOPE = 44;
// Facets cover rock this many tiles out from a face
const FACET_REACH = 3;

// Where a field stops, in the same units as paintOverlay's: far enough under 0 that a tile's
// edge runs through its middle rather than along its side
const OFF_THE_ROCK = -0.3;

// How much of a floor's real decoration a map gets. A map's scatter adds to the same layer,
// and between them they come to about 60% of what the real thing has.
const DRESS_SHARE = 0.6;
// The least a road has: real paths are at 30 to 60 per 100 tiles, whatever they're made of
const ROAD_PER_100 = 35;
// The least any floor has: the real thing's sand and snow are sparser, but it's all there is to
// see on them here
const LEAST_PER_100 = 25;
// On a floor the world doesn't use: decorations per 100 tiles, of the biome's own
const BIOME_DECOR_PER_100 = 30;
// The foot of a cliff has more on it than open ground: 29 to 93 per 100 in the real world
const FOOT_CHANCE = 0.4;
// Land beside water with a stone on it, and water beside land with a reed in it
const SHORE_CHANCE = 0.7;
const REED_CHANCE = 0.14;
export const REEDS = [1162, 5539, 5540, 5542];
// Water reeds grow in: not the sea, and not lava
const REED_WATER = new Set([6, 7]);

// What a tile of rock can have on it
export type RockKit = Pick<RockDef, "pebbles" | "rubble" | "facets">;

export type RockDressing = {
    kitAt: (x: number, y: number) => RockKit;
    seed: number;
    // Of the slides and facets a tile could have, how many it gets
    share: number;
};

// Rock's colour, on rock and nowhere else. paintOverlay's smoothing reaches over onto the tiles
// next to what it's given, and a real cliff stops at its foot: the ground beside it is plain
// ground. So a corner that touches anything but rock is kept out of the field.
export function paintRockFloor(
    ground: Ground,
    rock: Uint8Array,
    overlay: OverlayChoice,
    skip?: Uint8Array,
): Uint8Array {
    const { sizeX, sizeY } = ground;
    const cornersX = sizeX + 1;
    const field = new Float32Array(cornersX * (sizeY + 1));
    const edge = new Uint8Array(field.length);
    for (let y = 0; y <= sizeY; y++) {
        for (let x = 0; x <= sizeX; x++) {
            let count = 0;
            for (const [tx, ty] of [
                [x - 1, y - 1],
                [x, y - 1],
                [x - 1, y],
                [x, y],
            ]) {
                if (ground.inside(tx, ty) && rock[ground.tile(tx, ty)]) {
                    count++;
                }
            }
            field[x + y * cornersX] = count / 4 - 0.4;
            edge[x + y * cornersX] = count < 4 ? 1 : 0;
        }
    }
    const smoothed = smoothField(field, cornersX, sizeY + 1, 1);
    for (let i = 0; i < smoothed.length; i++) {
        if (edge[i]) {
            smoothed[i] = Math.min(smoothed[i], OFF_THE_ROCK);
        }
    }
    return ground.paintField(smoothed, overlay, false, skip);
}

// What's on rock: facets over everything near a face if the kit has them, low slides on a
// share of the steep band, and pebbles on most of what's left. Only on blocked ground, so
// nothing here changes where you walk.
export function dressRock(ground: Ground, rock: Uint8Array, dressing: RockDressing): void {
    const { kitAt, seed, share } = dressing;
    const { sizeX, sizeY } = ground;
    const { heights, flags, overlays } = ground.level0;
    const { locs } = ground.grid;
    const roll = createRng(seed);
    const corners = sizeX + 1;
    const isRock = (i: number) =>
        rock[i] !== 0 && (flags[i] & TILE_BLOCKED) !== 0 && !WATER_OVERLAYS.has(overlays[i]);
    const steep = new Uint8Array(rock.length);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            steep[i] = isRock(i) && getTileSlope(heights, corners, x, y) > SLIDE_SLOPE ? 1 : 0;
        }
    }
    const toFace = distanceTo(steep, sizeX, sizeY, FACET_REACH + 1);
    const taken = new Uint8Array(rock.length);
    const put = (id: number, type: number, x: number, y: number) =>
        locs.push({ id, type, rotation: Math.floor(roll() * 4), level: 0, x, y });
    const pick = (list: number[]) => list[Math.floor(roll() * list.length)];
    // The outermost tiles of a grid aren't drawn
    for (let y = 1; y < sizeY - 2; y++) {
        for (let x = 1; x < sizeX - 2; x++) {
            const i = x + y * sizeX;
            if (!isRock(i) || taken[i]) {
                continue;
            }
            const kit = kitAt(x, y);
            if (kit.facets && toFace[i] <= FACET_REACH) {
                if (roll() < share) {
                    taken[i] = 1;
                    put(pick(kit.facets), LOC_NORMAL, x, y);
                }
                continue;
            }
            const block = [i, i + 1, i + sizeX, i + sizeX + 1];
            if (
                steep[i] &&
                roll() < SLIDE_SHARE * share &&
                block.every((tile) => isRock(tile) && !taken[tile])
            ) {
                const [id] = kit.rubble[Math.floor(roll() * kit.rubble.length)];
                put(id, LOC_NORMAL, x, y);
                for (const tile of block) {
                    taken[tile] = 1;
                }
            }
        }
    }
    for (let y = 1; y < sizeY - 1; y++) {
        for (let x = 1; x < sizeX - 1; x++) {
            const i = x + y * sizeX;
            const lies = getTileSlope(heights, corners, x, y) <= PEBBLE_SLOPE;
            if (isRock(i) && !taken[i] && lies && roll() < PEBBLE_SHARE) {
                put(pick(kitAt(x, y).pebbles), LOC_FLOOR_DECORATION, x, y);
            }
        }
    }
}

// How a map's ground is dressed. density is the `dressing` setting.
export type GroundDressing = {
    seed: number;
    density: number;
    biomeDecor: (x: number, y: number) => number[];
};

// Ground decoration by what's underfoot, on everything but water, indoors and rock, once a
// tile as in the engine. A road gets its own floor's pebbles, and a shore its stones and
// reeds. It's the last thing a map does, so that nothing painted later sits on it, and it
// only uses what can't block, so where you can walk doesn't change.
export function dressGround(ground: Ground, dressing: GroundDressing): void {
    const { seed, density, biomeDecor } = dressing;
    const { sizeX, sizeY, footprint } = ground;
    const { flags, overlays, underlays, shapes } = ground.level0;
    const bridges = ground.grid.levels[1].flags;
    const { locs } = ground.grid;
    const roll = createRng(seed);
    const taken = new Uint8Array(sizeX * sizeY);
    for (const { level, type, x, y } of locs) {
        if (level === 0 && (type === LOC_FLOOR_DECORATION || type === LOC_NORMAL)) {
            taken[x + y * sizeX] = 1;
        }
    }
    const kitAt = (i: number) => {
        const own = overlays[i] !== 0 && shapes[i] === 0;
        return (
            (own || (overlays[i] !== 0 && roll() < 0.5)
                ? FLOOR_KITS[`o${overlays[i]}`]
                : undefined) ?? FLOOR_KITS[`u${underlays[i]}`]
        );
    };
    const isWater = (i: number) => WATER_OVERLAYS.has(overlays[i]);
    for (let y = 1; y < sizeY - 1; y++) {
        for (let x = 1; x < sizeX - 1; x++) {
            const i = x + y * sizeX;
            const near = [i - 1, i + 1, i - sizeX, i + sizeX];
            if (flags[i] & TILE_BLOCKED) {
                if (REED_WATER.has(overlays[i]) && !taken[i] && near.some((j) => !isWater(j))) {
                    if (!bridges[i] && roll() < REED_CHANCE * density) {
                        const id = REEDS[Math.floor(roll() * REEDS.length)];
                        const rotation = Math.floor(roll() * 4);
                        locs.push({ id, type: LOC_NORMAL, rotation, level: 0, x, y });
                    }
                }
                continue;
            }
            if (footprint[i] || taken[i] || bridges[i]) {
                continue;
            }
            const kit = kitAt(i);
            const least = overlays[i] !== 0 ? ROAD_PER_100 : LEAST_PER_100;
            const per100 = Math.max(kit?.per100 ?? BIOME_DECOR_PER_100, least);
            const byRock = near.some((j) => flags[j] & TILE_BLOCKED);
            const chance = near.some(isWater)
                ? SHORE_CHANCE
                : Math.max((per100 / 100) * DRESS_SHARE, byRock ? FOOT_CHANCE : 0);
            if (roll() < chance * density) {
                const ids = kit?.ids ?? biomeDecor(x, y);
                const id = ids[Math.floor(roll() * ids.length)];
                const rotation = Math.floor(roll() * 4);
                locs.push({ id, type: LOC_FLOOR_DECORATION, rotation, level: 0, x, y });
            }
        }
    }
}
