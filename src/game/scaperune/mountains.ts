import { SNOW_ROCK } from "./biomes";
import { dressRock, paintRockFloor } from "./dress";
import { TILE_BLOCKED, TILE_BRIDGE } from "./format";
import {
    Build,
    LOC_NORMAL,
    SPAWN_CLEAR,
    createClimb,
    getTouchedTiles,
    hasRelief,
    lerp,
    refreshTileHeights,
    settleTerrain,
} from "./mapBuild";
import { createRng, distanceTo } from "./noise";
import { Point, smoothPath } from "./paths";
import { findWaterPieces, holdWater } from "./rivers";
import { RoadLine, gradeRoads } from "./roadGrades";
import { ROAD_STEEPEST } from "./roads";
import { GeneratorSettings } from "./settings";
import { getTileSlope, liftFaces, limitFaces, limitNorthFaces } from "./terrain";

// What the land's shape comes to: passes through it, what can be walked, rock and caves.

// A pass climbs a little steeper than a road, as a share of what's walkable
const PASS_GRADE = 0.6;

const PASS_CLIFF_COST = 5;

// Pieces of ground this big that cliffs cut off get a pass. Smaller ones stay out of reach.
const MIN_PASS_PIECE = 300;

// Tiles a pass runs on past the cliffs at each end
const PASS_RUN_OUT = 7;

const PASSES_A_SQUARE = 4;

// How steep a cliff can drop away to the north, in height units a tile. The camera looks
// north from high up, at 70 degrees, which is 45 units a tile: anything steeper hides
// the ground at its foot. This leaves a margin for the top of the screen.
const NORTH_FACE_SLOPE = 30;

// How steep any face can be, in height units a tile. 99.96% of the real world's tiles are 80
// or under, and past that a tile stretches one row of triangles across the screen.
const STEEPEST_FACE = 72;

// Snow starts this high, with the setting at its least and its most
const SNOW_LINE_HIGH = 235;

const SNOW_LINE_LOW = 110;

// A cliff's waterfall stands on this many tiles a side
const FALL_TILES = 3;

const ROCK_SEED = 202;

const SNOW_SEED = 203;

const CAVES_A_SQUARE = 1.5;

const CAVE_WIDTH = 3;

const CAVE_DEPTH = 2;

// How much higher the ground has to rise behind a cave for there to be a cliff to go in
const CAVE_CLIFF = 24;

// Tiles roads and what's standing keep from lava
const LAVA_CLEAR = 2;

// The ground round the spawn is level and walkable, whatever the land's doing there
function pinSpawn(build: Build): void {
    const { terrain, spawn, cliffs, plots, sizeX, settings } = build;
    if (!hasRelief(settings)) {
        return;
    }
    const height = Math.round(terrain.getHeight(spawn.x, spawn.y));
    const reach = SPAWN_CLEAR + 1;
    // A plot, or a road out of here is graded as if the ground's free to move
    plots.push({
        x: spawn.x - reach,
        y: spawn.y - reach,
        sizeX: reach * 2,
        sizeY: reach * 2,
        height,
    });
    for (let y = spawn.y - reach; y <= spawn.y + reach; y++) {
        for (let x = spawn.x - reach; x <= spawn.x + reach; x++) {
            if (Math.hypot(x - spawn.x, y - spawn.y) <= reach) {
                terrain.pin(x, y, height, 0);
                cliffs[x + y * sizeX] = 0;
            }
        }
    }
}

// Pieces of open ground, by tile: 0 for cliff and outside the arena
function findGroundPieces(build: Build): {
    labels: Int32Array;
    sizes: number[];
    // A tile of each, and how far it is from the spawn
    starts: number[];
} {
    const { cliffs, arena, sizeX } = build;
    const labels = new Int32Array(cliffs.length);
    const sizes = [0];
    const starts = [0];
    const stack: number[] = [];
    for (let y = arena.y0; y <= arena.y1; y++) {
        for (let x = arena.x0; x <= arena.x1; x++) {
            const start = x + y * sizeX;
            if (labels[start] || cliffs[start]) {
                continue;
            }
            const label = sizes.length;
            let size = 0;
            labels[start] = label;
            stack.push(start);
            while (stack.length > 0) {
                const i = stack.pop()!;
                size++;
                const tx = i % sizeX;
                const ty = (i - tx) / sizeX;
                for (const [nx, ny] of [
                    [tx - 1, ty],
                    [tx + 1, ty],
                    [tx, ty - 1],
                    [tx, ty + 1],
                ]) {
                    if (nx < arena.x0 || ny < arena.y0 || nx > arena.x1 || ny > arena.y1) {
                        continue;
                    }
                    const j = nx + ny * sizeX;
                    if (!labels[j] && !cliffs[j]) {
                        labels[j] = label;
                        stack.push(j);
                    }
                }
            }
            sizes.push(size);
            starts.push(start);
        }
    }
    return { labels, sizes, starts };
}

// Cuts a pass to each big piece of ground the cliffs have cut off from the spawn: a graded
// way through, that roads can then use
export function cutPasses(build: Build): RoadLine[] {
    const { terrain, cliffs, arena, spawn, finder, settings, sizeX } = build;
    const passes: RoadLine[] = [];
    if (!hasRelief(settings)) {
        return passes;
    }
    pinSpawn(build);
    settleTerrain(build);
    const { labels, sizes, starts } = findGroundPieces(build);
    const joined = new Uint8Array(sizes.length);
    joined[labels[spawn.x + spawn.y * sizeX]] = 1;
    const inset = 3;
    // Not through a crater, which lava will fill, or water, which won't move for it
    const lava = getTouchedTiles(createLavaField(build), build.sizeX, build.sizeY);
    const { flags } = build.ground.level0;
    const cost = (x: number, y: number) => {
        const inside =
            x >= arena.x0 + inset &&
            y >= arena.y0 + inset &&
            x <= arena.x1 - inset &&
            y <= arena.y1 - inset;
        const i = x + y * sizeX;
        if (!inside || lava[i] || flags[i] & TILE_BLOCKED) {
            return Infinity;
        }
        return cliffs[x + y * sizeX] ? PASS_CLIFF_COST : 1;
    };
    refreshTileHeights(build);
    const passGrade = settings.walkSlope * PASS_GRADE;
    const climb = createClimb(build, passGrade, 2);
    // Nearest first, so that each has something near to join
    const toSpawn = (label: number) => {
        const x = starts[label] % sizeX;
        return Math.hypot(x - spawn.x, Math.floor(starts[label] / sizeX) - spawn.y);
    };
    const order = sizes
        .map((size, label) => ({ size, label }))
        .filter(({ size, label }) => label > 0 && size >= MIN_PASS_PIECE)
        .sort((a, b) => toSpawn(a.label) - toSpawn(b.label));
    const maxPasses = settings.squaresX * settings.squaresY * PASSES_A_SQUARE;
    for (const { label } of order) {
        if (joined[label] || passes.length >= maxPasses) {
            continue;
        }
        const start = starts[label];
        const path = finder.find(
            { x: start % sizeX, y: Math.floor(start / sizeX) },
            cost,
            (i) => joined[labels[i]] !== 0,
            climb,
        );
        if (path.length === 0) {
            continue;
        }
        for (const i of path) {
            joined[labels[i]] = 1;
        }
        // Only where it needs cutting, and a little either side, to ease into the ground
        const firstCliff = path.findIndex((i) => cliffs[i]);
        const lastCliff = path.length - 1 - [...path].reverse().findIndex((i) => cliffs[i]);
        const cut = path.slice(
            Math.max(firstCliff - PASS_RUN_OUT, 0),
            lastCliff + PASS_RUN_OUT + 1,
        );
        const raw = cut.map((i) => ({ x: (i % sizeX) + 0.5, y: Math.floor(i / sizeX) + 0.5 }));
        const points = smoothPath(raw, 4, 4);
        passes.push({ points, lead: 0, halfWidth: settings.passWidth / 2, grade: passGrade });
    }
    // Cut now, so that roads find them. They're graded again with the roads at the end.
    gradeRoads(terrain, passes, [], 0, settings.walkSlope * ROAD_STEEPEST);
    settleTerrain(build);
    terrain.clearPins();
    pinSpawn(build);
    const after = findGroundPieces(build).labels;
    const home = after[spawn.x + spawn.y * sizeX];
    for (let i = 0; i < after.length; i++) {
        build.mainland[i] = after[i] === home ? 1 : 0;
    }
    return passes;
}

// How high snow starts, in height units: past the top of everything with no snow
export function getSnowLine(settings: GeneratorSettings): number {
    return settings.snow > 0 ? lerp(SNOW_LINE_HIGH, SNOW_LINE_LOW, settings.snow) : Infinity;
}

// Where the lava goes: above 0 is lava
function createLavaField(build: Build): Float32Array {
    const { relief, corners } = build;
    const field = new Float32Array(corners.x * corners.y).fill(-4);
    for (const { x, y, radius } of relief.craters) {
        const reach = Math.ceil(radius) + 4;
        for (let cy = Math.round(y) - reach; cy <= Math.round(y) + reach; cy++) {
            for (let cx = Math.round(x) - reach; cx <= Math.round(x) + reach; cx++) {
                const at = cx + cy * corners.x;
                field[at] = Math.max(field[at], radius - Math.hypot(cx - x, cy - y));
            }
        }
    }
    return field;
}

// Lava comes last, so that it's painted over what's made of the land: until then, roads, and
// anything standing, are kept off where it'll be
export function keepOffLava(build: Build, avoid: Uint8Array): void {
    const { ground, relief, sizeX, sizeY } = build;
    if (relief.craters.length === 0) {
        return;
    }
    const lava = getTouchedTiles(createLavaField(build), sizeX, sizeY);
    distanceTo(lava, sizeX, sizeY, LAVA_CLEAR + 1).forEach((distance, i) => {
        if (distance <= LAVA_CLEAR) {
            avoid[i] = 1;
            ground.reserved[i] = 1;
        }
    });
}

// Lava lies level, as water does, at the lowest point of its edge, so that it fills its crater
// as a lake fills a basin rather than sinking a pit, with its corners held like water's
export function levelLava(build: Build): void {
    const { relief, sizeX, sizeY, corners, terrain } = build;
    if (relief.craters.length === 0) {
        return;
    }
    const tiles = getTouchedTiles(createLavaField(build), sizeX, sizeY);
    const pieces = findWaterPieces(build, tiles, new Uint8Array(tiles.length));
    const lowest = new Map<number, number>();
    const forCorners = (i: number, visit: (x: number, y: number) => void) => {
        const x = i % sizeX;
        const y = (i - x) / sizeX;
        visit(x, y);
        visit(x + 1, y);
        visit(x, y + 1);
        visit(x + 1, y + 1);
    };
    pieces.forEach((piece, i) => {
        if (piece >= 0) {
            forCorners(i, (x, y) => {
                const round = [
                    x - 1 + (y - 1) * sizeX,
                    x + (y - 1) * sizeX,
                    x - 1 + y * sizeX,
                    x + y * sizeX,
                ];
                if (round.some((tile) => !tiles[tile])) {
                    const height = terrain.height[x + y * corners.x];
                    lowest.set(piece, Math.min(lowest.get(piece) ?? Infinity, height));
                }
            });
        }
    });
    pieces.forEach((piece, i) => {
        if (piece >= 0) {
            forCorners(i, (x, y) => terrain.pin(x, y, Math.round(lowest.get(piece)!)));
        }
    });
    holdWater(build, tiles);
}

export function paintLava(build: Build): void {
    const { ground, relief, biomeAt } = build;
    if (relief.craters.length > 0) {
        ground.paintField(createLavaField(build), (x, y) => biomeAt(x, y).rock.lava, true);
    }
}

// Which tiles are rock, and which are the same under snow: everything too steep to walk,
// less what's skipped
function findRockTiles(build: Build, skip: Uint8Array): { rock: Uint8Array; snowy: Uint8Array } {
    const { ground, settings, sizeX, sizeY, corners, cliffs, terrain } = build;
    const { heights, flags } = ground.level0;
    const snowLine = getSnowLine(settings);
    const rock = new Uint8Array(sizeX * sizeY);
    const snowy = new Uint8Array(sizeX * sizeY);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            if (!(flags[i] & TILE_BLOCKED) || skip[i]) {
                continue;
            }
            const steep = getTileSlope(heights, corners.x, x, y) > settings.walkSlope;
            if (steep || cliffs[i]) {
                const high = terrain.height[terrain.corner(x, y)] > snowLine;
                (high ? snowy : rock)[i] = 1;
            }
        }
    }
    return { rock, snowy };
}

// Rock's colour on everything too steep to walk. It's painted after the roads, and goes
// round them.
export function paintRock(build: Build, skip: Uint8Array): Uint8Array {
    const { ground, settings, sizeX, sizeY, biomeAt } = build;
    if (!hasRelief(settings)) {
        return new Uint8Array(sizeX * sizeY);
    }
    const { rock } = findRockTiles(build, skip);
    paintRockFloor(ground, rock, (x, y) => biomeAt(x, y).rock.overlay, skip);
    return rock;
}

// What's on the rock, and on the snow over it, once everything that stands on a cliff has
// taken its tiles out of the mask
export function dressCliffs(
    build: Build,
    painted: Uint8Array,
    skip: Uint8Array,
    falls: Point[],
): void {
    const { ground, settings, sizeX, biomeAt } = build;
    // Land with no rock on it still has steep banks
    const found = findRockTiles(build, skip);
    const { snowy } = found;
    const rock = hasRelief(settings) ? painted : found.rock;
    for (const { x, y } of falls) {
        for (let ty = y; ty < y + FALL_TILES; ty++) {
            rock.fill(0, x + ty * sizeX, x + FALL_TILES + ty * sizeX);
            snowy.fill(0, x + ty * sizeX, x + FALL_TILES + ty * sizeX);
        }
    }
    const share = settings.rockFaces;
    const kitAt = (x: number, y: number) => biomeAt(x, y).rock;
    dressRock(ground, rock, { kitAt, seed: settings.seed + ROCK_SEED, share });
    dressRock(ground, snowy, { kitAt: () => SNOW_ROCK, seed: settings.seed + SNOW_SEED, share });
}

// Cave mouths, for looks: in the foot of a cliff that faces the camera
export function placeCaves(build: Build, rock: Uint8Array): Point[] {
    const { settings, ground, arena, biomeAt, sizeX, corners } = build;
    const caves: Point[] = [];
    const { heights, flags } = ground.level0;
    const wanted = Math.round(
        settings.caves * settings.squaresX * settings.squaresY * CAVES_A_SQUARE,
    );
    const roll = createRng(settings.seed + 201);
    const fits = (x: number, y: number) => {
        for (let tx = x; tx < x + CAVE_WIDTH; tx++) {
            const i = tx + y * sizeX;
            if (!rock[i] || !(flags[i + sizeX] & TILE_BLOCKED) || flags[i - sizeX] & TILE_BLOCKED) {
                return false;
            }
        }
        const rise =
            heights[x + 1 + (y + CAVE_DEPTH + 1) * corners.x] - heights[x + 1 + y * corners.x];
        return rise >= CAVE_CLIFF;
    };
    let placed = 0;
    for (let attempt = 0; attempt < wanted * 300 && placed < wanted; attempt++) {
        const x = Math.floor(lerp(arena.x0, arena.x1 - CAVE_WIDTH, roll()));
        const y = Math.floor(lerp(arena.y0 + 1, arena.y1 - CAVE_DEPTH - 2, roll()));
        if (fits(x, y)) {
            caves.push({ x, y });
            ground.place(
                { id: biomeAt(x, y).rock.cave, type: LOC_NORMAL, rotation: 0, level: 0, x, y },
                CAVE_WIDTH,
                CAVE_DEPTH,
            );
            for (let ty = y; ty < y + CAVE_DEPTH; ty++) {
                rock.fill(0, x + ty * sizeX, x + CAVE_WIDTH + ty * sizeX);
            }
            placed++;
        }
    }
    return caves;
}

// Ground's height and what's walkable, once everything's been placed on it
export function finishHeights(build: Build): void {
    const { terrain, ground, corners, heldCorners } = build;
    settleTerrain(build);
    for (const at of build.heldForNow) {
        heldCorners[at] = 0;
    }
    const fixed = Uint8Array.from(heldCorners);
    terrain.markPinned(fixed);
    limitNorthFaces(terrain.height, corners.x, corners.y, NORTH_FACE_SLOPE, fixed);
    limitFaces(terrain.height, corners.x, corners.y, STEEPEST_FACE, fixed);
    liftFaces(terrain.height, corners.x, corners.y, STEEPEST_FACE, fixed);
    limitNorthFaces(terrain.height, corners.x, corners.y, NORTH_FACE_SLOPE, fixed);
    terrain.write((x, y, height) => ground.setHeight(x, y, height));
}

// Tiles too steep to walk are blocked, going by the heights as they'll be drawn, and so is
// what's left of the cliffs. Bridges are walked on a level up.
export function blockSteepGround(build: Build): void {
    const { ground, settings, cliffs, faces, sizeX, sizeY, corners } = build;
    const { heights, flags } = ground.level0;
    const bridges = ground.grid.levels[1].flags;
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            cliffs[i] |= faces[i];
            const steep = getTileSlope(heights, corners.x, x, y) > settings.walkSlope;
            if ((steep || cliffs[i]) && !(bridges[i] & TILE_BRIDGE)) {
                flags[i] |= TILE_BLOCKED;
                ground.reserved[i] = 1;
            }
        }
    }
}
