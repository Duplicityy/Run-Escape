import type { TileRect } from "./collision";
import { Noise, createFractal, createNoise, createRidged, createRng, warpNoise } from "./noise";
import type { Point } from "./paths";
import { GeneratorSettings, HEIGHTMAP_SIZE, decodeHeightmap } from "./settings";
import { MAX_HEIGHT, Terrain, limitSlope } from "./terrain";

// The shape of the land, before water, roads or anything else: rolling hills, then mountain
// ranges and the features you can ask for, then terraces. Everything here's a field per
// tile corner, so each of these is one function that adds to the height. To add a
// landform, add a function here and call it from createRelief. See CLAUDE.md.

// Ground never comes lower than this from hills alone: under it there's no room to sink water
export const LAND_FLOOR = 34;
// The middle of the land with hills at 0 and at 1
const BASE_HEIGHT = 56;
const BASE_HEIGHT_HILLS = 30;
// How far the ground rises into a boundary of hills
const HILL_BOUNDARY_RISE = 150;
// Tiles round the spawn that stay low
const SPAWN_LOWLAND = 14;
// Tiles past that to the mountains' full height
const SPAWN_LOWLAND_FADE = 22;
// Share of the arena that's mountain, with mountains at 1
const MOUNTAIN_COVER = 0.6;
// The share of a range that's at full height, not on its way up
const RANGE_CORE = 0.6;
// The ring boundary's rock rises this far past the arena's edge
const RING_FADE = 26;
// How many tiles of cliff a plateau or mesa's edge takes
const MESA_EDGE = 3;
const PLATEAU_EDGE = 5;
const CANYON_WALL = 4;
const CRATER_WALL = 6;
// Tiles between the points of a noise's lattice
const LATTICE = 3;
// Tiles round a landform that keep off the next one
const FEATURE_GAP = 6;

export type LandformBounds = {
    corners: { x: number; y: number };
    arena: TileRect;
    spawn: Point;
    // Tiles in from the arena's edge, negative outside
    toEdge(x: number, y: number): number;
};

// A volcano's crater, for the lava that fills it
export type Crater = { x: number; y: number; radius: number; floor: number };

export type Relief = {
    // Heights, in Terrain
    terrain: Terrain;
    // How much of a mountain each corner is, 0 to 1, for rock and snow
    mountain: Float32Array;
    craters: Crater[];
    // The hills' noise, for flooding the low ground
    hills: Noise;
};

function smoothstep(t: number): number {
    const clamped = Math.min(Math.max(t, 0), 1);
    return clamped * clamped * (3 - 2 * clamped);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

type Shaping = {
    settings: GeneratorSettings;
    bounds: LandformBounds;
    terrain: Terrain;
    mountain: Float32Array;
    rng: () => number;
    // How far each corner is from anything that needs the ground low: the spawn
    lowland(x: number, y: number): number;
    // Spots taken by features so far
    taken: { x: number; y: number; radius: number }[];
};

function forCorners(terrain: Terrain, visit: (x: number, y: number, at: number) => void): void {
    for (let y = 0; y < terrain.cornersY; y++) {
        for (let x = 0; x < terrain.cornersX; x++) {
            visit(x, y, x + y * terrain.cornersX);
        }
    }
}

// Goes round a rectangle of corners near a point
function forCornersNear(
    terrain: Terrain,
    x: number,
    y: number,
    reach: number,
    visit: (cx: number, cy: number, at: number) => void,
): void {
    const x0 = Math.max(Math.floor(x - reach), 0);
    const y0 = Math.max(Math.floor(y - reach), 0);
    const x1 = Math.min(Math.ceil(x + reach), terrain.cornersX - 1);
    const y1 = Math.min(Math.ceil(y + reach), terrain.cornersY - 1);
    for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
            visit(cx, cy, cx + cy * terrain.cornersX);
        }
    }
}

// How high the ground rises into a boundary of hills, 0 to 1
export function getHillBoundaryRise(
    settings: GeneratorSettings,
    bounds: LandformBounds,
    x: number,
    y: number,
): number {
    if (settings.boundary !== "hills") {
        return 0;
    }
    return smoothstep(
        (settings.boundaryDepth - bounds.toEdge(x, y)) / (settings.boundaryDepth + 24),
    );
}

function addHills({ settings, bounds, terrain }: Shaping, hills: Noise): void {
    const amount = 8 + settings.hills * 260;
    const base = BASE_HEIGHT + settings.hills * BASE_HEIGHT_HILLS;
    forCorners(terrain, (x, y, at) => {
        const noise = hills(x / settings.hillScale, y / settings.hillScale) - 0.5;
        const height = Math.max(base + noise * amount, LAND_FLOOR);
        terrain.height[at] =
            height + getHillBoundaryRise(settings, bounds, x, y) * HILL_BOUNDARY_RISE;
    });
}

// The value a share of a field's samples is above
function getLineForShare(field: Noise, bounds: LandformBounds, scale: number, share: number) {
    const { arena } = bounds;
    const samples: number[] = [];
    for (let y = arena.y0; y <= arena.y1; y += 4) {
        for (let x = arena.x0; x <= arena.x1; x += 4) {
            samples.push(field(x / scale, y / scale));
        }
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor((samples.length - 1) * (1 - share))];
}

// A field for smooth noise, read off a lattice rather than worked out at every corner:
// heights finer than a few tiles can't draw, and big maps have millions of corners
function latticeOf(noise: Noise, terrain: Terrain, scale: number): Noise {
    const countX = Math.ceil(terrain.cornersX / LATTICE) + 2;
    const countY = Math.ceil(terrain.cornersY / LATTICE) + 2;
    const values = new Float32Array(countX * countY);
    for (let y = 0; y < countY; y++) {
        for (let x = 0; x < countX; x++) {
            values[x + y * countX] = noise((x * LATTICE) / scale, (y * LATTICE) / scale);
        }
    }
    return (x, y) => {
        const fx = x / LATTICE;
        const fy = y / LATTICE;
        const tx = Math.floor(fx);
        const ty = Math.floor(fy);
        const at = tx + ty * countX;
        const south = lerp(values[at], values[at + 1], fx - tx);
        const north = lerp(values[at + countX], values[at + countX + 1], fx - tx);
        return lerp(south, north, fy - ty);
    };
}

// Where ranges run: long bands, wide across, from a noise's zero lines
function createRange(seed: number): Noise {
    const noise = createFractal(seed, 2, 0.4);
    return (x, y) => 1 - Math.abs(noise(x, y));
}

// Ranges of mountains. Where they go is a ridged noise on a big scale, so they run in long
// chains, and how they look is a finer one, so that ridges run down from the crests.
function addMountains(shaping: Shaping): void {
    const { settings, bounds, terrain, mountain, lowland } = shaping;
    if (settings.mountains <= 0) {
        return;
    }
    const { seed, ridgeScale, ruggedness, warp, peakHeight } = settings;
    const bend = warp * 0.9;
    const chains = warpNoise(createRange(seed + 30), seed + 31, bend);
    const detail = warpNoise(
        createRidged(seed + 32, 3 + Math.round(ruggedness * 2), lerp(0.3, 0.62, ruggedness)),
        seed + 33,
        bend * 0.5,
    );
    const chainScale = ridgeScale * 2.6;
    const cover = settings.mountains * MOUNTAIN_COVER;
    const line = getLineForShare(chains, bounds, chainScale, cover);
    // The foothills: this much of the cover's on its way up
    const top = getLineForShare(chains, bounds, chainScale, cover * RANGE_CORE);
    const chainAt = latticeOf(chains, terrain, chainScale);
    const detailAt = latticeOf(detail, terrain, ridgeScale);
    forCorners(terrain, (x, y, at) => {
        const rise = (chainAt(x, y) - line) / (top - line);
        const body = smoothstep(rise) * lowland(x, y);
        if (body <= 0) {
            return;
        }
        const crest = detailAt(x, y);
        const peak = Math.max(peakHeight - terrain.height[at], 0);
        const shape = lerp(1, 0.35 + crest * 1.1, lerp(0.5, 1, ruggedness));
        terrain.height[at] += peak * Math.pow(body, 1.2) * shape;
        mountain[at] = Math.max(mountain[at], body);
    });
}

// A free spot for a landform, or undefined: its whole body on the land, and clear of the
// spawn and other landforms
function pickSpot(shaping: Shaping, radius: number): Point | undefined {
    const { bounds, rng, taken, settings } = shaping;
    const { arena, spawn } = bounds;
    const half = Math.min(arena.x1 - arena.x0, arena.y1 - arena.y0) / 2;
    const coast = settings.boundary === "sea" ? settings.island * half * 0.5 + 6 : 0;
    const inset = Math.min(radius + coast, half);
    for (let attempt = 0; attempt < 24; attempt++) {
        const x = lerp(arena.x0 + inset, arena.x1 - inset, rng());
        const y = lerp(arena.y0 + inset, arena.y1 - inset, rng());
        const free =
            Math.hypot(x - spawn.x, y - spawn.y) > radius + SPAWN_LOWLAND &&
            taken.every(
                (spot) => Math.hypot(x - spot.x, y - spot.y) > radius + spot.radius + FEATURE_GAP,
            );
        if (free) {
            taken.push({ x, y, radius });
            return { x, y };
        }
    }
    return undefined;
}

// A flat top with a wobbling edge, raised rise from the ground around it. Mesas are small and
// tall with sheer sides; plateaus are wide and low.
function addTableland(
    shaping: Shaping,
    x: number,
    y: number,
    radius: number,
    rise: number,
    edge: number,
    seed: number,
): void {
    const { terrain, mountain, lowland } = shaping;
    const wobble = createNoise(seed, 2);
    // The top's height is the height at its middle, so that it's flat
    const top = terrain.height[terrain.corner(Math.round(x), Math.round(y))] + rise;
    forCornersNear(terrain, x, y, radius * 1.5 + edge + 2, (cx, cy, at) => {
        const shape = radius * (0.72 + wobble(cx / 16, cy / 16) * 0.75);
        const inside = smoothstep((shape - Math.hypot(cx - x, cy - y)) / edge) * lowland(cx, cy);
        if (inside > 0) {
            terrain.height[at] = lerp(terrain.height[at], top, inside);
            mountain[at] = Math.max(mountain[at], inside);
        }
    });
}

function addPlateaus(shaping: Shaping): void {
    const { settings, rng } = shaping;
    for (let i = 0; i < settings.plateaus; i++) {
        const radius = 18 + rng() * 22;
        const spot = pickSpot(shaping, radius);
        if (spot) {
            const rise = 30 + rng() * 40;
            addTableland(
                shaping,
                spot.x,
                spot.y,
                radius,
                rise,
                PLATEAU_EDGE,
                settings.seed + 40 + i,
            );
        }
    }
}

function addMesas(shaping: Shaping): void {
    const { settings, rng } = shaping;
    for (let i = 0; i < settings.mesas; i++) {
        const radius = 7 + rng() * 9;
        const spot = pickSpot(shaping, radius);
        if (spot) {
            const rise = 45 + rng() * 50;
            addTableland(shaping, spot.x, spot.y, radius, rise, MESA_EDGE, settings.seed + 60 + i);
        }
    }
}

// Canyons: a winding trench with a flat floor, across the arena one way or the other. Its
// walls are steep enough to be cliffs, so it's a wall on the map with passes through it.
function addCanyons(shaping: Shaping): void {
    const { settings, bounds, terrain, mountain, rng, lowland } = shaping;
    const { arena } = bounds;
    for (let i = 0; i < settings.canyons; i++) {
        const vertical = rng() < 0.5;
        const [acrossMin, acrossMax] = vertical ? [arena.x0, arena.x1] : [arena.y0, arena.y1];
        const line = lerp(acrossMin, acrossMax, 0.2 + rng() * 0.6);
        const wander = createFractal(settings.seed + 70 + i, 2, 0.5);
        const widths = createNoise(settings.seed + 75 + i, 1);
        const depth = 26 + rng() * 22;
        const span = (vertical ? arena.y1 - arena.y0 : arena.x1 - arena.x0) * 0.45;
        const middle = vertical ? (arena.y0 + arena.y1) / 2 : (arena.x0 + arena.x1) / 2;
        const swing = (acrossMax - acrossMin) * 0.16;
        forCorners(terrain, (x, y, at) => {
            const along = vertical ? y : x;
            const across = vertical ? x : y;
            const centre = line + wander(along / 40, 2.5) * swing;
            const half = settings.canyonWidth * (0.4 + widths(along / 22, 6.5) * 0.9);
            const ends = 1 - smoothstep((Math.abs(along - middle) - span * 0.7) / (span * 0.5));
            const inside =
                smoothstep((half + CANYON_WALL - Math.abs(across - centre)) / CANYON_WALL) *
                ends *
                lowland(x, y);
            if (inside > 0) {
                terrain.height[at] = Math.max(terrain.height[at] - depth * inside, LAND_FLOOR / 2);
                mountain[at] = Math.max(mountain[at], inside * 0.6);
            }
        });
    }
}

// Volcanoes: a broad cone you can walk up, a rim, and a sheer-sided crater
function addVolcanoes(shaping: Shaping, craters: Crater[]): void {
    const { settings, terrain, mountain, rng } = shaping;
    for (let i = 0; i < settings.volcanoes; i++) {
        const radius = 26 + rng() * 14;
        const spot = pickSpot(shaping, radius);
        if (!spot) {
            continue;
        }
        const crater = radius * 0.3;
        const rim = Math.min(
            terrain.height[terrain.corner(Math.round(spot.x), Math.round(spot.y))] + 120,
            MAX_HEIGHT - 6,
        );
        const lip = createNoise(settings.seed + 80 + i, 2);
        const floor = rim - 34;
        forCornersNear(terrain, spot.x, spot.y, radius * 1.3, (cx, cy, at) => {
            const distance = Math.hypot(cx - spot.x, cy - spot.y);
            const edge = crater * (0.8 + lip(cx / 9, cy / 9) * 0.4);
            if (distance < edge + CRATER_WALL) {
                const wall = smoothstep((distance - edge) / CRATER_WALL);
                terrain.height[at] = lerp(floor, rim, wall);
                mountain[at] = 1;
            } else {
                const out = (distance - edge - CRATER_WALL) / (radius - edge - CRATER_WALL);
                const cone = rim - (rim - terrain.height[at]) * Math.pow(Math.min(out, 1), 0.8);
                terrain.height[at] = Math.max(terrain.height[at], cone);
                mountain[at] = Math.max(mountain[at], 1 - Math.min(out, 1));
            }
        });
        craters.push({ x: spot.x, y: spot.y, radius: crater, floor });
    }
}

// Mountains closing in on the arena: all rock from a little way in from the edge, rising
// on past it
function addMountainRing({ settings, bounds, terrain, mountain }: Shaping): void {
    if (settings.boundary !== "mountains") {
        return;
    }
    const crest = createFractal(settings.seed + 90, 3, 0.5);
    const wander = createFractal(settings.seed + 91, 2, 0.5);
    forCorners(terrain, (x, y, at) => {
        const edge = bounds.toEdge(x, y) + wander(x / 24, y / 24) * 5;
        const rise = smoothstep((settings.boundaryDepth - edge) / RING_FADE);
        if (rise > 0) {
            const shape = 0.72 + crest(x / 18, y / 18) * 0.55;
            const peak = settings.peakHeight - terrain.height[at];
            terrain.height[at] += Math.max(peak, 0) * rise * shape;
            mountain[at] = Math.max(mountain[at], rise);
        }
    });
}

// A height from an image, stretched over the arena and on past it, from the floor of the land
// at black to peakHeight at white. It takes the place of hills and ranges.
function addHeightmap({ settings, bounds, terrain, mountain }: Shaping): void {
    const bytes = decodeHeightmap(settings.heightmap);
    if (!bytes) {
        return;
    }
    const { arena } = bounds;
    const last = HEIGHTMAP_SIZE - 1;
    const read = (x: number, y: number) => bytes[x + y * HEIGHTMAP_SIZE] / 255;
    forCorners(terrain, (x, y, at) => {
        const u = Math.min(Math.max((x - arena.x0) / (arena.x1 + 1 - arena.x0), 0), 1) * last;
        const v = Math.min(Math.max((y - arena.y0) / (arena.y1 + 1 - arena.y0), 0), 1) * last;
        const tx = Math.min(Math.floor(u), last - 1);
        const ty = Math.min(Math.floor(v), last - 1);
        const south = lerp(read(tx, ty), read(tx + 1, ty), u - tx);
        const north = lerp(read(tx, ty + 1), read(tx + 1, ty + 1), u - tx);
        const value = lerp(south, north, v - ty);
        terrain.height[at] = lerp(LAND_FLOOR, settings.peakHeight, value);
        mountain[at] = smoothstep((value - 0.4) / 0.3);
    });
}

// Steps in the mountains: flat benches with risers between. Where the mountain's steep a
// riser's a cliff, and where it's gentle it's a slope, so they come out as ledges that
// run out into ramps by themselves.
function addTerraces({ settings, terrain, mountain }: Shaping): void {
    if (settings.terraces <= 0) {
        return;
    }
    const step = settings.terraceHeight;
    const wobble = createFractal(settings.seed + 95, 2, 0.5);
    const riser = 0.3;
    forCorners(terrain, (x, y, at) => {
        const body = mountain[at];
        if (body <= 0) {
            return;
        }
        const height = terrain.height[at];
        const shifted = height + wobble(x / 26, y / 26) * step * 1.2;
        const level = shifted / step;
        const whole = Math.floor(level);
        const stepped = (whole + smoothstep((level - whole - (1 - riser)) / riser)) * step;
        terrain.height[at] = lerp(
            height,
            stepped - shifted + height,
            settings.terraces * smoothstep(body * 2),
        );
    });
}

// The land's shape for some settings: all but water, roads and what's built on it
export function createRelief(settings: GeneratorSettings, bounds: LandformBounds): Relief {
    const { spawn, corners } = bounds;
    const terrain = new Terrain(corners.x, corners.y);
    const mountain = new Float32Array(terrain.height.length);
    const hills = createNoise(settings.seed + 3);
    const shaping: Shaping = {
        settings,
        bounds,
        terrain,
        mountain,
        rng: createRng(settings.seed + 20),
        lowland: (x, y) =>
            smoothstep((Math.hypot(x - spawn.x, y - spawn.y) - SPAWN_LOWLAND) / SPAWN_LOWLAND_FADE),
        taken: [],
    };
    const craters: Crater[] = [];
    addHills(shaping, hills);
    addMountains(shaping);
    addHeightmap(shaping);
    addPlateaus(shaping);
    addMesas(shaping);
    addCanyons(shaping);
    addTerraces(shaping);
    addVolcanoes(shaping, craters);
    addMountainRing(shaping);
    for (let i = 0; i < terrain.height.length; i++) {
        terrain.height[i] = Math.min(Math.max(terrain.height[i], 0), MAX_HEIGHT);
    }
    return { terrain, mountain, craters, hills };
}

// What mustn't be walked on: tiles steeper than slope, tidied up so that there are no
// specks of cliff in the fields or strips of field in the cliffs too thin to walk. The
// slopes that are left are then eased to fit, so that all the height that's lost on them
// goes into the cliffs. Returns the cliffs' tiles.
export function shapeCliffs(terrain: Terrain, walkSlope: number): Uint8Array {
    const { cornersX, cornersY, height } = terrain;
    const sizeX = cornersX - 1;
    const sizeY = cornersY - 1;
    const cliffs = new Uint8Array(sizeX * sizeY);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            cliffs[x + y * sizeX] = terrain.getSlope(x, y) > walkSlope ? 1 : 0;
        }
    }
    dropSmallPieces(cliffs, sizeX, sizeY, 1, MIN_CLIFF_PIECE);
    dropSmallPieces(cliffs, sizeX, sizeY, 0, MIN_LEDGE_PIECE);
    openLedges(cliffs, sizeX, sizeY);
    dropSmallPieces(cliffs, sizeX, sizeY, 0, MIN_LEDGE_PIECE);

    // Corners with no cliff on any side of them
    const open = new Uint8Array(height.length);
    for (let y = 0; y < cornersY; y++) {
        for (let x = 0; x < cornersX; x++) {
            let clear = 1;
            for (const [tx, ty] of [
                [x - 1, y - 1],
                [x, y - 1],
                [x - 1, y],
                [x, y],
            ]) {
                if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && cliffs[tx + ty * sizeX]) {
                    clear = 0;
                }
            }
            open[x + y * cornersX] = clear;
        }
    }
    limitSlope(height, cornersX, cornersY, walkSlope * SLOPE_MARGIN, open);
    return cliffs;
}

// Slopes are eased to under this share of what's walkable, so rounding doesn't tip them over
const SLOPE_MARGIN = 0.92;
// How far apart flat land's levels are, in height units. Each runs flat, then ramps up to the next.
const FLAT_STEP = 12;
// Slopes over this share of what's walkable stay as they are
const FLAT_SLOPE_SHARE = 0.5;
// Cliffs smaller than this are bumps, and go
const MIN_CLIFF_PIECE = 10;
// Walkable ground smaller than this among cliffs goes to the cliffs
const MIN_LEDGE_PIECE = 24;

// Three quarters of real walkable ground is dead flat, with the height in short ramps, and hills
// left to noise read as a soft blanket. This puts open ground on levels: flatness is the share
// of each level that's flat. Cliffs and what's held stay as they are.
export function flattenLand(
    terrain: Terrain,
    cliffs: Uint8Array,
    held: Uint8Array,
    flatness: number,
    walkSlope: number,
): void {
    const { cornersX, cornersY, height } = terrain;
    if (flatness <= 0) {
        return;
    }
    const sizeX = cornersX - 1;
    const sizeY = cornersY - 1;
    const open = new Uint8Array(height.length);
    for (let y = 0; y < cornersY; y++) {
        for (let x = 0; x < cornersX; x++) {
            let clear = 1;
            for (const [tx, ty] of [
                [x - 1, y - 1],
                [x, y - 1],
                [x - 1, y],
                [x, y],
            ]) {
                if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && cliffs[tx + ty * sizeX]) {
                    clear = 0;
                }
            }
            const at = x + y * cornersX;
            open[at] = clear && !held[at] ? 1 : 0;
        }
    }
    // A slope near the limit has no room for levels: its ramps would be too steep to walk, and
    // roads climbing it couldn't make their grade
    const before = Float32Array.from(height);
    for (let y = 1; y < cornersY - 1; y++) {
        for (let x = 1; x < cornersX - 1; x++) {
            const at = x + y * cornersX;
            if (!open[at]) {
                continue;
            }
            const slope = Math.max(
                Math.abs(before[at + 1] - before[at - 1]),
                Math.abs(before[at + cornersX] - before[at - cornersX]),
            );
            const room = 1 - smoothstep(slope / 2 / (walkSlope * FLAT_SLOPE_SHARE) - 0.5);
            const level = Math.floor(before[at] / FLAT_STEP);
            const along = before[at] / FLAT_STEP - level;
            const ramp = smoothstep((along - flatness) / (1 - flatness));
            height[at] = lerp(before[at], (level + ramp) * FLAT_STEP, room);
        }
    }
    limitSlope(height, cornersX, cornersY, walkSlope * SLOPE_MARGIN, open);
}

// Flips pieces of a value smaller than a size
function dropSmallPieces(
    tiles: Uint8Array,
    sizeX: number,
    sizeY: number,
    value: number,
    size: number,
): void {
    const seen = new Uint8Array(tiles.length);
    const stack: number[] = [];
    for (let start = 0; start < tiles.length; start++) {
        if (seen[start] || tiles[start] !== value) {
            continue;
        }
        const piece = [start];
        seen[start] = 1;
        stack.push(start);
        while (stack.length > 0) {
            const i = stack.pop()!;
            const x = i % sizeX;
            const y = (i - x) / sizeX;
            const visit = (j: number) => {
                if (!seen[j] && tiles[j] === value) {
                    seen[j] = 1;
                    stack.push(j);
                    piece.push(j);
                }
            };
            if (x > 0) {
                visit(i - 1);
            }
            if (x + 1 < sizeX) {
                visit(i + 1);
            }
            if (y > 0) {
                visit(i - sizeX);
            }
            if (y + 1 < sizeY) {
                visit(i + sizeX);
            }
        }
        if (piece.length < size) {
            for (const i of piece) {
                tiles[i] = 1 - value;
            }
        }
    }
}

// Ground you can't fit a 2 by 2 block on goes to the cliffs: a crowd can't get along a ledge
// a tile wide, and neither can you
function openLedges(cliffs: Uint8Array, sizeX: number, sizeY: number): void {
    const fits = new Uint8Array(cliffs.length);
    for (let y = 0; y + 1 < sizeY; y++) {
        for (let x = 0; x + 1 < sizeX; x++) {
            const i = x + y * sizeX;
            if (!cliffs[i] && !cliffs[i + 1] && !cliffs[i + sizeX] && !cliffs[i + sizeX + 1]) {
                fits[i] = fits[i + 1] = fits[i + sizeX] = fits[i + sizeX + 1] = 1;
            }
        }
    }
    for (let i = 0; i < cliffs.length; i++) {
        cliffs[i] = fits[i] ? 0 : 1;
    }
}
