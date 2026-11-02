import { Ground } from "./Ground";
import { BIOMES, BiomeDef } from "./biomes";
import { TileRect } from "./collision";
import { Relief } from "./landforms";
import { Rng } from "./noise";
import { PathFinder, Point } from "./paths";
import { PrefabKit } from "./prefabs";
import { BuildContext } from "./recipe";
import { Plot } from "./roadGrades";
import { GeneratorSettings } from "./settings";
import type { PlacedFence } from "./settlements";
import { Terrain } from "./terrain";
import type { PlannedTown } from "./townPlan";

// What's kept while a generated map's built, and what the parts of the generator share.

// One square of scenery round the arena
export const MARGIN = 1;

// Tiles round the spawn kept clear of water and scenery
export const SPAWN_CLEAR = 7;

// How steep the sides of cuttings and embankments are, in height units a tile: a share of
// what's walkable, so that you can walk up out of a road
export const SETTLE_SLOPE = 0.8;

export const LOC_WALL = 0;

export const LOC_NORMAL = 10;

export const LOC_FLOOR_DECORATION = 22;

// Rotation is the side of the tile a wall stands on
export const WALL_WEST = 0;

export const WALL_NORTH = 1;

export const WALL_EAST = 2;

export const WALL_SOUTH = 3;

// What's kept while a map is built
export type Build = {
    settings: GeneratorSettings;
    context: BuildContext;
    ground: Ground;
    rng: Rng;
    finder: PathFinder;
    kit: PrefabKit;
    sizeX: number;
    sizeY: number;
    corners: { x: number; y: number };
    spawn: Point;
    arena: TileRect;
    biomeAt(x: number, y: number): BiomeDef;
    // The same for what's scattered on it: roll, from 0 to 1, frays the edge between two
    biomeNear(x: number, y: number, roll: number): BiomeDef;
    // Tiles in from the arena's edge, negative outside
    toEdge(x: number, y: number): number;
    // The land's shape, and its heights as they're being worked on
    relief: Relief;
    terrain: Terrain;
    // Tiles of cliff, and of water, whose corners stay where they are
    cliffs: Uint8Array;
    heldCorners: Uint8Array;
    // Tiles that are cliff whatever their slope comes to: a fall's seat
    faces: Uint8Array;
    // Those held only until the ground's settled, not against the limit on north faces
    heldForNow: number[];
    // Ground you can get to from the spawn, as far as cliffs go: anything else stays empty
    mainland: Uint8Array;
    // Tiles' heights, for how steep a step is
    tileHeights: Float32Array;
    // Buildings' plots, for roads to keep to
    plots: Plot[];
    // Towns laid out from the middle
    towns?: PlannedTown[];
    // Places things gather at, with quieter land between them
    sites?: Point[];
    // Every fence that's part of a plot or a piece
    fences?: PlacedFence[];
};

// The water as painted: repainted when a ford cuts through it. dry is tiles it stays off, for
// the ends of bridges.
export type WaterPaint = { field: Float32Array; tiles: Uint8Array; dry?: Uint8Array };

export function pick<T>(rng: Rng, list: T[]): T {
    return list[Math.floor(rng() * list.length)];
}

// One of a list that runs smallest to biggest: the first at 0, the last at 1, and any
// of them in between
export function pickBySize<T>(rng: Rng, list: T[], size: number): T {
    if (size < 0.2) {
        return list[0];
    }
    return size > 0.8 ? list[list.length - 1] : pick(rng, list);
}

export function smoothstep(t: number): number {
    const clamped = Math.min(Math.max(t, 0), 1);
    return clamped * clamped * (3 - 2 * clamped);
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// Whether there's more to the land than hills
export function hasRelief(settings: GeneratorSettings): boolean {
    return (
        settings.mountains > 0 ||
        settings.heightmap !== "" ||
        settings.boundary === "mountains" ||
        settings.plateaus > 0 ||
        settings.mesas > 0 ||
        settings.canyons > 0 ||
        settings.volcanoes > 0 ||
        BIOMES[settings.biome].chasm === true ||
        (settings.secondBiome !== "none" && BIOMES[settings.secondBiome].chasm === true)
    );
}

// The indexes of the tiles a mask has
export function getTileList(tiles: Uint8Array): number[] {
    const list: number[] = [];
    tiles.forEach((tile, i) => {
        if (tile) {
            list.push(i);
        }
    });
    return list;
}

// The tiles a corner field has anything of
export function getTouchedTiles(field: Float32Array, sizeX: number, sizeY: number): Uint8Array {
    const cornersX = sizeX + 1;
    const tiles = new Uint8Array(sizeX * sizeY);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const at = x + y * cornersX;
            tiles[x + y * sizeX] =
                field[at] > 0 ||
                field[at + 1] > 0 ||
                field[at + cornersX] > 0 ||
                field[at + cornersX + 1] > 0
                    ? 1
                    : 0;
        }
    }
    return tiles;
}

// A corner's distance from a tile field: the least of the tiles round it
export function getCornerDistance(build: Build, tiles: Float32Array, x: number, y: number): number {
    const { sizeX, sizeY } = build;
    let distance = Infinity;
    for (const [tx, ty] of [
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y],
        [x, y],
    ]) {
        if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY) {
            distance = Math.min(distance, tiles[tx + ty * sizeX]);
        }
    }
    return distance;
}

export function refreshTileHeights(build: Build): void {
    const { terrain, sizeX, sizeY, corners, tileHeights } = build;
    const { height } = terrain;
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const at = x + y * corners.x;
            tileHeights[x + y * sizeX] =
                (height[at] +
                    height[at + 1] +
                    height[at + corners.x] +
                    height[at + corners.x + 1]) /
                4;
        }
    }
}

// Brings the ground to its pins, and whatever that's made walkable stops being cliff
export function settleTerrain(build: Build): void {
    const { terrain, settings, cliffs, heldCorners, sizeX, sizeY } = build;
    const before = Float32Array.from(terrain.height);
    terrain.settle(settings.walkSlope * SETTLE_SLOPE, heldCorners);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            if (
                cliffs[i] &&
                terrain.getSlope(x, y) <= settings.walkSlope &&
                terrain.height[terrain.corner(x, y)] !== before[terrain.corner(x, y)]
            ) {
                cliffs[i] = 0;
            }
        }
    }
    refreshTileHeights(build);
}

// What a step costs a road or pass, as a multiple: nothing extra up to its grade, and
// quickly more after that, so it goes round or winds up a slope rather than straight up it
export function createClimb(build: Build, grade: number, cost: number) {
    const { tileHeights } = build;
    return (from: number, to: number): number => {
        const over = Math.abs(tileHeights[to] - tileHeights[from]) / grade - 1;
        return over > 0 ? 1 + over * over * cost : 1;
    };
}

// The tiles a road's points are on, or near
export function forTilesNear(
    build: Build,
    points: Point[],
    radius: number,
    visit: (i: number) => void,
): void {
    const { ground } = build;
    const reach = Math.ceil(radius);
    for (const point of points) {
        const px = Math.floor(point.x);
        const py = Math.floor(point.y);
        for (let y = py - reach; y <= py + reach; y++) {
            for (let x = px - reach; x <= px + reach; x++) {
                if (
                    ground.inside(x, y) &&
                    Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y) <= radius
                ) {
                    visit(ground.tile(x, y));
                }
            }
        }
    }
}
