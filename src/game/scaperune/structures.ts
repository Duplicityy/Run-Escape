import { TileRect } from "./collision";
import {
    Build,
    LOC_NORMAL,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    getTileList,
    lerp,
    pick,
} from "./mapBuild";
import { distanceTo } from "./noise";
import { Point } from "./paths";
import { RESERVE_PIECE } from "./reservations";
import { RoadNetwork } from "./roads";
import { fitsBuilding, getPlotHeight, markOffLimits, pinPlot, putFence } from "./settlements";

// What a place is known for: one big thing, or a few that belong together, standing on a plot
// as a building does, because a big loc on a slope shows its underside. Then what only makes
// sense on a map that's otherwise done: wrecks and drowned towns in the water, and stones along
// the roads. Biomes say which pieces they have (biomes.ts).

// [loc id, tiles across, tiles deep]
export type PieceLoc = [number, number, number];

export type SetPiece =
    // One big thing, picked from a list
    | { kind: "single"; locs: PieceLoc[] }
    // Stones in a ring, with something in the middle if there's anything
    | { kind: "ring"; stones: PieceLoc[]; count: number; radius: number; middle?: PieceLoc }
    // A loose crowd in a circle
    | { kind: "grove"; locs: PieceLoc[]; count: number; radius: number }
    // Rows, as graves are
    | {
          kind: "rows";
          locs: PieceLoc[];
          across: number;
          deep: number;
          gap: number;
          // What grows round the outside
          edge?: PieceLoc[];
      }
    // In the water, close in to the shore
    | { kind: "wreck"; locs: PieceLoc[] }
    // Out in the water: the top of something tall, and what's left of a town round it
    | { kind: "sunken"; middle: PieceLoc[]; stones: PieceLoc[]; count: number; radius: number }
    // A hedge maze, cells a side, with something to find in the middle
    | { kind: "maze"; hedges: number[]; cells: number; middle: PieceLoc }
    // The biome's wall round a yard, tiles a side, with a gate each way and things inside
    | { kind: "fort"; size: number; inside: PieceLoc[]; count: number }
    // Normal things put together, at places on a plot of its own: what a real landmark is
    | RecipePiece;

// [loc id, tiles across, tiles deep, x and y on the plot, rotation]
type RecipeLoc = [number, number, number, number, number, number?];

type RecipePiece = {
    kind: "recipe";
    sizeX: number;
    sizeY: number;
    locs: RecipeLoc[];
    // Paved, as a town's square is
    paved?: boolean;
    // A fence round it, open at a gate in its south side
    fenced?: boolean;
    // What grows on the plot, on all that's left of it, in rows
    crops?: number[];
};

function single(...locs: PieceLoc[]): SetPiece {
    return { kind: "single", locs };
}

const STANDING_STONES: PieceLoc[] = [
    [34780, 1, 1],
    [34781, 1, 1],
    [7016, 1, 1],
];
const SANDSTONE_PILLARS: PieceLoc[] = [
    [10019, 1, 1],
    [10020, 1, 1],
];
const GRAVES: PieceLoc[] = [
    [404, 1, 1],
    [405, 1, 1],
    [401, 1, 1],
    [400, 1, 1],
];
// Real graves stand among bushes: they're 87 to 115 times likelier together than by chance
const BUSHES: PieceLoc[] = [
    [1124, 1, 1],
    [1124, 1, 1],
    [1393, 1, 1],
];
const MUSHROOM_TREES: PieceLoc[] = [
    [43129, 4, 4],
    [43130, 6, 6],
];
const RUINED_PILLARS: PieceLoc[] = [
    [34795, 1, 1],
    [34796, 1, 1],
    [34780, 1, 1],
];

export const SET_PIECES: Record<string, SetPiece> = {
    hedge_maze: { kind: "maze", hedges: [1116, 1117], cells: 5, middle: [879, 2, 2] },
    fort: {
        kind: "fort",
        size: 17,
        inside: [
            [724, 1, 1],
            [42044, 2, 3],
            [23061, 2, 3],
            [13435, 1, 1],
        ],
        count: 8,
    },
    stone_circle: { kind: "ring", stones: STANDING_STONES, count: 9, radius: 6 },
    desert_circle: {
        kind: "ring",
        stones: SANDSTONE_PILLARS,
        count: 8,
        radius: 5,
        middle: [11100, 2, 2],
    },
    market: {
        kind: "recipe",
        sizeX: 15,
        sizeY: 11,
        paved: true,
        locs: [
            [884, 2, 2, 7, 5],
            [634, 2, 2, 2, 2],
            [11729, 2, 2, 11, 2, 2],
            [11730, 2, 2, 2, 7],
            [634, 2, 2, 11, 7, 2],
            [362, 1, 1, 4, 2],
            [357, 1, 1, 10, 3],
            [365, 1, 1, 4, 8],
            [358, 1, 1, 10, 7],
        ],
    },
    farm: {
        kind: "recipe",
        sizeX: 16,
        sizeY: 11,
        fenced: true,
        crops: [15506, 15507, 15508],
        locs: [
            [300, 2, 2, 2, 7],
            [304, 1, 1, 5, 8],
            [304, 1, 1, 5, 7],
        ],
    },
    orchard: {
        kind: "recipe",
        sizeX: 15,
        sizeY: 11,
        fenced: true,
        locs: [
            [1276, 2, 2, 2, 2],
            [1278, 2, 2, 7, 2],
            [1276, 2, 2, 12, 2],
            [1278, 2, 2, 2, 7],
            [1276, 2, 2, 7, 7],
            [1278, 2, 2, 12, 7],
            [300, 2, 2, 5, 5],
        ],
    },
    shrine: {
        kind: "recipe",
        sizeX: 9,
        sizeY: 9,
        paved: true,
        locs: [
            [7002, 2, 2, 3, 4],
            [34780, 1, 1, 1, 1],
            [34781, 1, 1, 7, 1],
            [34781, 1, 1, 1, 7],
            [34780, 1, 1, 7, 7],
            [1188, 1, 1, 2, 3],
            [1187, 1, 1, 6, 3],
            [1188, 1, 1, 2, 6],
            [1187, 1, 1, 6, 6],
        ],
    },
    great_skeleton: single([59324, 7, 3]),
    beached_wreck: single([49423, 6, 4], [59372, 6, 3]),
    fairy_ring: {
        kind: "ring",
        stones: [
            [12005, 1, 1],
            [12006, 1, 1],
            [4057, 1, 1],
        ],
        count: 12,
        radius: 4,
        middle: [29495, 1, 1],
    },
    great_boulder: {
        kind: "grove",
        locs: [
            [11433, 2, 2],
            [11434, 2, 2],
            [11435, 2, 2],
        ],
        count: 5,
        radius: 4,
    },
    giant_mushroom: single([43131, 9, 9]),
    mushroom_grove: { kind: "grove", locs: MUSHROOM_TREES, count: 4, radius: 7 },
    toadstools: {
        kind: "grove",
        locs: [
            [4057, 1, 1],
            [12005, 1, 1],
            [12006, 1, 1],
        ],
        count: 14,
        radius: 6,
    },
    crystal: single([27878, 5, 5], [27882, 3, 3]),
    crystal_field: {
        kind: "grove",
        locs: [
            [27882, 3, 3],
            [27878, 5, 5],
            [36530, 3, 2],
        ],
        count: 4,
        radius: 7,
    },
    dark_crystal: single([27879, 5, 5], [27883, 3, 3]),
    black_crystal: single([30666, 3, 3]),
    crater: single([43204, 5, 5], [43203, 4, 4], [43202, 3, 3]),
    crater_field: {
        kind: "grove",
        locs: [
            [43202, 3, 3],
            [43203, 4, 4],
        ],
        count: 4,
        radius: 7,
    },
    graveyard: { kind: "rows", locs: GRAVES, across: 6, deep: 4, gap: 2, edge: BUSHES },
    blisterwood: single([37989, 6, 4]),
    redwoods: {
        kind: "grove",
        locs: [
            [47372, 4, 4],
            [47374, 4, 4],
        ],
        count: 3,
        radius: 6,
    },
    great_tree: single([40791, 5, 4]),
    black_trees: {
        kind: "grove",
        locs: [
            [40812, 2, 2],
            [40818, 2, 2],
            [40819, 2, 2],
            [40820, 2, 2],
        ],
        count: 6,
        radius: 6,
    },
    great_stump: {
        kind: "grove",
        locs: [
            [57511, 3, 3],
            [57513, 3, 3],
            [50935, 3, 3],
        ],
        count: 4,
        radius: 6,
    },
    idol: single([21, 4, 4]),
    shipwreck: {
        kind: "wreck",
        locs: [
            [60471, 4, 4],
            [60479, 4, 4],
            [60475, 4, 4],
            [60467, 3, 2],
            [60469, 3, 2],
        ],
    },
    longship: {
        kind: "wreck",
        locs: [
            [59372, 6, 3],
            [60477, 5, 3],
        ],
    },
    drowned_town: {
        kind: "sunken",
        middle: [
            [48327, 9, 9],
            [48311, 9, 9],
        ],
        stones: RUINED_PILLARS,
        count: 12,
        radius: 11,
    },
};

export type PlacedPiece = {
    name: string;
    x: number;
    y: number;
    sizeX: number;
    sizeY: number;
    // Stands on a plot of its own, rather than in water
    onLand: boolean;
};

// Set pieces to a map square, with the setting at 1
const PIECES_A_SQUARE = 1.5;

const TRIES_A_PIECE = 40;

// How near a town a site counts as taken, tries at each site, and how far off it a piece can be
const SITE_TAKEN = 30;

const SITE_TRIES = 8;

const SITE_JITTER = 16;

// Houses in a drowned town
const DROWNED_HOUSES = 3;

// A wreck's this near the shore, in tiles from its edge
const WRECK_REACH = 4;

// The same for a fort's
const FORT_GATE = 2;

// In a walled town's square
export const FOUNTAIN = 879;

// Varrock's street stone, a plain warm grey. Texture's for small patches.
export const PAVING = 171;

// Small things tried round a big one, and the share of a rectangle's edge that gets one
const ROUND_A_PIECE = 14;

// Tiles of ground a single big thing keeps round it for them
const ROUND_TILES = 3;

const EDGE_SHARE = 0.7;

// Tiles along a road between stones, and off its edge
const MARKER_SPACING = 16;

const MARKER_OFFSET = 2;

const ROADSIDE_MARKERS = 0.4;

// Tiles across a maze's corridors, with a tile of hedge between them. Crowds have to fit.
const MAZE_CELL = 3;

// Of a maze's hedges between cells, the share knocked through, so that it isn't a trap
const MAZE_LOOPS = 0.2;

// All the locs a piece can use, for the palette
export function getPieceLocs(piece: SetPiece): PieceLoc[] {
    switch (piece.kind) {
        case "ring":
            return [...piece.stones, ...(piece.middle ? [piece.middle] : [])];
        case "sunken":
            return [...piece.middle, ...piece.stones];
        case "maze":
            return [piece.middle, ...piece.hedges.map((id): PieceLoc => [id, 1, 1])];
        case "fort":
            return piece.inside;
        case "recipe":
            return [
                ...piece.locs.map(([id, across, deep]): PieceLoc => [id, across, deep]),
                ...(piece.crops ?? []).map((id): PieceLoc => [id, 1, 1]),
            ];
        case "rows":
            return [...piece.locs, ...(piece.edge ?? [])];
        default:
            return piece.locs;
    }
}

// The rectangle a piece needs
function getPieceSize(piece: SetPiece): { sizeX: number; sizeY: number } {
    if (piece.kind === "single" || piece.kind === "wreck") {
        const round = piece.kind === "single" ? ROUND_TILES * 2 : 0;
        return {
            sizeX: Math.max(...piece.locs.map((loc) => loc[1])) + round,
            sizeY: Math.max(...piece.locs.map((loc) => loc[2])) + round,
        };
    }
    if (piece.kind === "recipe") {
        return { sizeX: piece.sizeX, sizeY: piece.sizeY };
    }
    if (piece.kind === "rows") {
        return { sizeX: piece.across * piece.gap, sizeY: piece.deep * piece.gap };
    }
    if (piece.kind === "maze") {
        const size = piece.cells * (MAZE_CELL + 1) + 1;
        return { sizeX: size, sizeY: size };
    }
    if (piece.kind === "fort") {
        return { sizeX: piece.size, sizeY: piece.size };
    }
    const size = piece.radius * 2 + 3;
    return { sizeX: size, sizeY: size };
}

function putLoc(
    build: Build,
    [id, across, deep]: PieceLoc,
    x: number,
    y: number,
    rotation: number,
): void {
    const sizeX = rotation & 1 ? deep : across;
    const sizeY = rotation & 1 ? across : deep;
    build.ground.place({ id, type: LOC_NORMAL, rotation, level: 0, x, y }, sizeX, sizeY);
}

function putRing(
    build: Build,
    stones: PieceLoc[],
    count: number,
    radius: number,
    x: number,
    y: number,
): void {
    const { rng } = build;
    const turn = rng() * Math.PI;
    for (let i = 0; i < count; i++) {
        const angle = turn + (i / count) * Math.PI * 2;
        const stoneX = Math.round(x + Math.cos(angle) * radius);
        const stoneY = Math.round(y + Math.sin(angle) * radius);
        putLoc(build, pick(rng, stones), stoneX, stoneY, Math.floor(rng() * 4));
    }
}

// A maze's hedges, a tile to a tile: every cell can be got to, by a tree of corridors with a
// few of its walls knocked through, and there's a way in on each side
function placeMaze(
    build: Build,
    piece: Extract<SetPiece, { kind: "maze" }>,
    x: number,
    y: number,
): void {
    const { ground, rng } = build;
    const { cells } = piece;
    const step = MAZE_CELL + 1;
    const size = cells * step + 1;
    const hedge = new Uint8Array(size * size);
    for (let ty = 0; ty < size; ty++) {
        for (let tx = 0; tx < size; tx++) {
            hedge[tx + ty * size] = tx % step === 0 || ty % step === 0 ? 1 : 0;
        }
    }
    const open = (cellX: number, cellY: number, wayX: number, wayY: number) => {
        // The hedge between a cell and the next, all but its posts
        for (let at = 1; at <= MAZE_CELL; at++) {
            const tx = wayX !== 0 ? cellX * step + (wayX > 0 ? step : 0) : cellX * step + at;
            const ty = wayY !== 0 ? cellY * step + (wayY > 0 ? step : 0) : cellY * step + at;
            hedge[tx + ty * size] = 0;
        }
    };
    const WAYS = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    const seen = new Uint8Array(cells * cells);
    const trail = [[rng() * cells, rng() * cells].map(Math.floor)];
    seen[trail[0][0] + trail[0][1] * cells] = 1;
    while (trail.length > 0) {
        const [cellX, cellY] = trail[trail.length - 1];
        const ways = WAYS.filter(([wayX, wayY]) => {
            const nextX = cellX + wayX;
            const nextY = cellY + wayY;
            const inside = nextX >= 0 && nextY >= 0 && nextX < cells && nextY < cells;
            return inside && !seen[nextX + nextY * cells];
        });
        if (ways.length === 0) {
            trail.pop();
            continue;
        }
        const [wayX, wayY] = pick(rng, ways);
        open(cellX, cellY, wayX, wayY);
        seen[cellX + wayX + (cellY + wayY) * cells] = 1;
        trail.push([cellX + wayX, cellY + wayY]);
    }
    for (let cellY = 0; cellY < cells; cellY++) {
        for (let cellX = 0; cellX + 1 < cells; cellX++) {
            if (rng() < MAZE_LOOPS) {
                open(cellX, cellY, 1, 0);
            }
            if (rng() < MAZE_LOOPS) {
                open(cellY, cellX, 0, 1);
            }
        }
    }
    const door = () => Math.floor(rng() * cells);
    open(door(), 0, 0, -1);
    open(door(), cells - 1, 0, 1);
    open(0, door(), -1, 0);
    open(cells - 1, door(), 1, 0);
    for (let ty = 0; ty < size; ty++) {
        for (let tx = 0; tx < size; tx++) {
            if (hedge[tx + ty * size]) {
                // Along its line: they're longer than they're wide
                const rotation = hedge[tx + 1 + ty * size] || hedge[tx - 1 + ty * size] ? 1 : 0;
                const id = pick(rng, piece.hedges);
                ground.place(
                    { id, type: LOC_NORMAL, rotation, level: 0, x: x + tx, y: y + ty },
                    1,
                    1,
                );
            }
        }
    }
    const middle = (cells >> 1) * step + 1;
    putLoc(build, piece.middle, x + middle, y + middle, 0);
}

// A walled yard, the biome's wall all round it with a gate in the middle of each side
function placeFort(
    build: Build,
    piece: Extract<SetPiece, { kind: "fort" }>,
    x: number,
    y: number,
    owner: TileRect,
): void {
    const { ground, rng, biomeAt } = build;
    const last = piece.size - 1;
    const id = biomeAt(x, y).wall;
    const gate = (at: number) => Math.abs(at - (last >> 1)) <= FORT_GATE;
    const wall = (tx: number, ty: number, rotation: number) => {
        putFence(build, id, tx, ty, rotation, owner);
        ground.reserved[ground.tile(tx, ty)] = 1;
    };
    for (let at = 0; at <= last; at++) {
        if (!gate(at)) {
            wall(x + at, y, WALL_SOUTH);
            wall(x + at, y + last, WALL_NORTH);
            wall(x, y + at, WALL_WEST);
            wall(x + last, y + at, WALL_EAST);
        }
    }
    const room = piece.size - 6;
    for (let i = 0; i < piece.count; i++) {
        const loc = pick(rng, piece.inside);
        const tx = x + 3 + Math.floor(rng() * room);
        const ty = y + 3 + Math.floor(rng() * room);
        if (ground.isClear(tx - 1, ty - 1, loc[1] + 2, loc[2] + 2)) {
            putLoc(build, loc, tx, ty, 0);
        }
    }
}

function placeOnPlot(build: Build, piece: SetPiece, x: number, y: number): void {
    const { ground, rng } = build;
    const { sizeX, sizeY } = getPieceSize(piece);
    const owner = { x0: x, y0: y, x1: x + sizeX - 1, y1: y + sizeY - 1 };
    const middleX = x + (sizeX >> 1);
    const middleY = y + (sizeY >> 1);
    if (piece.kind === "single") {
        const loc = pick(rng, piece.locs);
        putLoc(build, loc, x + ((sizeX - loc[1]) >> 1), y + ((sizeY - loc[2]) >> 1), 0);
        placeRound(build, x, y, sizeX, sizeY);
    } else if (piece.kind === "recipe") {
        placeRecipe(build, piece, x, y, owner);
    } else if (piece.kind === "ring") {
        putRing(build, piece.stones, piece.count, piece.radius, middleX, middleY);
        if (piece.middle) {
            const [, across, deep] = piece.middle;
            putLoc(build, piece.middle, middleX - (across >> 1), middleY - (deep >> 1), 0);
        }
    } else if (piece.kind === "grove") {
        let placed = 0;
        for (let attempt = 0; attempt < piece.count * 12 && placed < piece.count; attempt++) {
            const angle = rng() * Math.PI * 2;
            const reach = Math.sqrt(rng()) * piece.radius;
            const loc = pick(rng, piece.locs);
            const tx = Math.round(middleX + Math.cos(angle) * reach - loc[1] / 2);
            const ty = Math.round(middleY + Math.sin(angle) * reach - loc[2] / 2);
            if (
                tx >= x &&
                ty >= y &&
                tx + loc[1] <= x + sizeX &&
                ty + loc[2] <= y + sizeY &&
                ground.isClear(tx - 1, ty - 1, loc[1] + 2, loc[2] + 2)
            ) {
                putLoc(build, loc, tx, ty, 0);
                placed++;
            }
        }
    } else if (piece.kind === "rows") {
        for (let row = 0; row < piece.deep; row++) {
            for (let column = 0; column < piece.across; column++) {
                const loc = pick(rng, piece.locs);
                if (rng() < 0.85) {
                    putLoc(build, loc, x + column * piece.gap, y + row * piece.gap, 3);
                }
            }
        }
        if (piece.edge) {
            placeEdge(build, piece.edge, x - 1, y - 1, sizeX + 1, sizeY + 1);
        }
    } else if (piece.kind === "maze") {
        placeMaze(build, piece, x, y);
    } else if (piece.kind === "fort") {
        placeFort(build, piece, x, y, owner);
    }
}

// A single big thing isn't a place by itself: this puts the biome's own small things round it
function placeRound(build: Build, x: number, y: number, sizeX: number, sizeY: number): void {
    const { ground, rng, biomeAt } = build;
    const { flowers } = biomeAt(x + (sizeX >> 1), y + (sizeY >> 1));
    if (flowers.length === 0) {
        return;
    }
    for (let i = 0; i < ROUND_A_PIECE; i++) {
        const tx = x + Math.floor(rng() * sizeX);
        const ty = y + Math.floor(rng() * sizeY);
        if (ground.isClear(tx, ty, 1, 1)) {
            putLoc(build, [pick(rng, flowers), 1, 1], tx, ty, Math.floor(rng() * 4));
        }
    }
}

// Things along the outside of a rectangle, with gaps, leaving a way in on every side
function placeEdge(
    build: Build,
    locs: PieceLoc[],
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
): void {
    const { ground, rng } = build;
    const put = (tx: number, ty: number) => {
        if (rng() < EDGE_SHARE && ground.isClear(tx, ty, 1, 1)) {
            putLoc(build, pick(rng, locs), tx, ty, Math.floor(rng() * 4));
        }
    };
    for (let along = 0; along <= sizeX; along += 2) {
        put(x + along, y);
        put(x + along, y + sizeY);
    }
    for (let along = 2; along < sizeY; along += 2) {
        put(x, y + along);
        put(x + sizeX, y + along);
    }
}

function placeRecipe(
    build: Build,
    piece: RecipePiece,
    x: number,
    y: number,
    owner: TileRect,
): void {
    const { ground, rng, biomeAt } = build;
    const { sizeX, sizeY } = piece;
    const biome = biomeAt(x + (sizeX >> 1), y + (sizeY >> 1));
    if (piece.paved) {
        const mask = new Uint8Array(ground.sizeX * ground.sizeY);
        for (let ty = y; ty < y + sizeY; ty++) {
            mask.fill(1, ground.tile(x, ty), ground.tile(x + sizeX, ty));
        }
        ground.paintOverlay(mask, biome.paving ?? PAVING, false);
    }
    for (const [id, across, deep, tx, ty, rotation] of piece.locs) {
        putLoc(build, [id, across, deep], x + tx, y + ty, rotation ?? 0);
    }
    if (piece.crops) {
        for (let ty = y + 1; ty < y + sizeY - 1; ty += 2) {
            for (let tx = x + 1; tx < x + sizeX - 1; tx++) {
                if (ground.isClear(tx, ty, 1, 1)) {
                    putLoc(build, [pick(rng, piece.crops), 1, 1], tx, ty, 0);
                }
            }
        }
    }
    if (piece.fenced) {
        const post = (tx: number, ty: number, rotation: number) =>
            putFence(build, biome.fence, tx, ty, rotation, owner);
        const gate = x + (sizeX >> 1);
        for (let tx = x; tx < x + sizeX; tx++) {
            if (Math.abs(tx - gate) > 1) {
                post(tx, y, WALL_SOUTH);
            }
            post(tx, y + sizeY - 1, WALL_NORTH);
        }
        for (let ty = y; ty < y + sizeY; ty++) {
            post(x, ty, WALL_WEST);
            post(x + sizeX - 1, ty, WALL_EAST);
        }
    }
}

// Places the pieces that stand on land, where their biome has them, spread out over the map.
// What goes in water comes later: see placeWaterPieces.
export function placeSetPieces(build: Build, roads: RoadNetwork, water: Uint8Array): PlacedPiece[] {
    const { settings, rng, biomeAt, arena, ground } = build;
    const wanted = Math.round(
        settings.landmarks * settings.squaresX * settings.squaresY * PIECES_A_SQUARE,
    );
    const placed: PlacedPiece[] = [];
    const used = new Map<string, number>();
    // The sites with nothing on them first, a little off their middles. Rolled for anyway, so
    // that a map with no sites comes out as it did.
    const sites = (build.sites ?? []).filter(
        (site) =>
            !build.towns?.some(
                ({ x0, y0, x1, y1 }) =>
                    Math.hypot(site.x - (x0 + x1) / 2, site.y - (y0 + y1) / 2) < SITE_TAKEN,
            ),
    );
    for (let attempt = 0; attempt < wanted * TRIES_A_PIECE && placed.length < wanted; attempt++) {
        const site = sites[attempt % Math.max(sites.length, 1)];
        const spotX = lerp(arena.x0, arena.x1, rng());
        const spotY = lerp(arena.y0, arena.y1, rng());
        const onSite = site && attempt < sites.length * SITE_TRIES;
        const nearX = site ? site.x + (spotX / arena.x1 - 0.5) * SITE_JITTER : spotX;
        const nearY = site ? site.y + (spotY / arena.y1 - 0.5) * SITE_JITTER : spotY;
        const middleX = Math.round(onSite ? nearX : spotX);
        const middleY = Math.round(onSite ? nearY : spotY);
        const names = biomeAt(middleX, middleY).landmarks.filter(
            (name) => !["wreck", "sunken"].includes(SET_PIECES[name].kind),
        );
        if (names.length === 0) {
            continue;
        }
        // Least used first, so that it isn't all the one thing
        const fewest = Math.min(...names.map((name) => used.get(name) ?? 0));
        const name = pick(
            rng,
            names.filter((other) => (used.get(other) ?? 0) === fewest),
        );
        const piece = SET_PIECES[name];
        const { sizeX, sizeY } = getPieceSize(piece);
        const x = middleX - (sizeX >> 1);
        const y = middleY - (sizeY >> 1);
        if (!fitsBuilding(build, water, x, y, sizeX, sizeY)) {
            continue;
        }
        // A city's no place for a piece that's a place of its own
        const inCity = build.towns?.some(
            ({ wall }) =>
                wall && x < wall.x1 && y < wall.y1 && x + sizeX > wall.x0 && y + sizeY > wall.y0,
        );
        if (inCity && piece.kind !== "recipe") {
            continue;
        }
        const height = getPlotHeight(build, x, y, sizeX, sizeY);
        if (height === undefined) {
            continue;
        }
        pinPlot(build, x, y, sizeX, sizeY, height);
        markOffLimits(build, roads, x, y, sizeX, sizeY, 1);
        placeOnPlot(build, piece, x, y);
        ground.claims.take(x, y, sizeX, sizeY, RESERVE_PIECE);
        used.set(name, (used.get(name) ?? 0) + 1);
        placed.push({ name, x, y, sizeX, sizeY, onLand: true });
    }
    return placed;
}

// What's left of a drowned town's houses, standing in the water where they fell
function placeDrownedWalls(build: Build, radius: number, x: number, y: number): void {
    const { kit, rng, biomeAt } = build;
    const biome = biomeAt(x, y);
    const names = biome.ruins ?? biome.buildings;
    const turn = rng() * Math.PI * 2;
    for (let i = 0; i < DROWNED_HOUSES && names.length > 0; i++) {
        const angle = turn + (i / DROWNED_HOUSES) * Math.PI * 2;
        const turns = Math.floor(rng() * 4);
        const name = pick(rng, names);
        const { prefab } = kit.get(name, turns);
        const reach = radius - Math.max(prefab.sizeX, prefab.sizeY) / 2 - 1;
        const houseX = Math.round(x + Math.cos(angle) * reach - prefab.sizeX / 2);
        const houseY = Math.round(y + Math.sin(angle) * reach - prefab.sizeY / 2);
        kit.stampRuin(build.ground, name, turns, houseX, houseY, rng, true);
    }
}

// Whether a rectangle's all water
function isAllWater(
    build: Build,
    water: Uint8Array,
    bridgeZone: Uint8Array,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
) {
    const { ground } = build;
    for (let ty = y; ty < y + sizeY; ty++) {
        for (let tx = x; tx < x + sizeX; tx++) {
            const i = ground.tile(tx, ty);
            if (!ground.inside(tx, ty) || !water[i] || bridgeZone[i]) {
                return false;
            }
        }
    }
    return true;
}

// Wrecks close in to the shore, and drowned towns further out, wherever there's water
// for them: on heights that won't move, so there are no plots
export function placeWaterPieces(
    build: Build,
    water: Uint8Array,
    bridgeZone: Uint8Array,
): PlacedPiece[] {
    const { settings, rng, arena, biomeAt, sizeX, sizeY } = build;
    const placed: PlacedPiece[] = [];
    const wanted = Math.round(settings.landmarks * settings.squaresX * settings.squaresY);
    if (wanted === 0) {
        return placed;
    }
    const tiles = getTileList(water);
    if (tiles.length === 0) {
        return placed;
    }
    const land = water.map((tile) => 1 - tile);
    const toLand = distanceTo(land, sizeX, sizeY, WRECK_REACH + 12);
    for (let attempt = 0; attempt < wanted * TRIES_A_PIECE && placed.length < wanted; attempt++) {
        const i = pick(rng, tiles);
        const tx = i % sizeX;
        const ty = Math.floor(i / sizeX);
        const inArena = tx >= arena.x0 && ty >= arena.y0 && tx <= arena.x1 && ty <= arena.y1;
        const names = biomeAt(tx, ty).landmarks.filter((name) =>
            ["wreck", "sunken"].includes(SET_PIECES[name].kind),
        );
        if (names.length === 0 || !inArena) {
            continue;
        }
        const name = pick(rng, names);
        const piece = SET_PIECES[name];
        const size = getPieceSize(piece);
        const x = tx - (size.sizeX >> 1);
        const y = ty - (size.sizeY >> 1);
        const clear = placed.every(
            (other) => Math.hypot(other.x - x, other.y - y) > other.sizeX + size.sizeX,
        );
        if (!clear || !isAllWater(build, water, bridgeZone, x, y, size.sizeX, size.sizeY)) {
            continue;
        }
        if (piece.kind === "wreck") {
            if (toLand[i] > WRECK_REACH + size.sizeX / 2) {
                continue;
            }
            const loc = pick(rng, piece.locs);
            putLoc(build, loc, x, y, 0);
        } else if (piece.kind === "sunken") {
            const loc = pick(rng, piece.middle);
            putLoc(build, loc, tx - (loc[1] >> 1), ty - (loc[2] >> 1), 0);
            putRing(build, piece.stones, piece.count, piece.radius, tx, ty);
            placeDrownedWalls(build, piece.radius, tx, ty);
        }
        placed.push({ name, x, y, ...size, onLand: false });
    }
    return placed;
}

// Old stones along the roads, the same way apart on either side of them in turn
export function placeWaymarkers(build: Build, roads: RoadNetwork): Point[] {
    const { settings, ground, biomeAt, rng, toEdge } = build;
    const markers: Point[] = [];
    // Something to see on the way, on a map of sites: no road goes far with nothing by it
    const share = Math.max(settings.waymarkers, settings.sites * ROADSIDE_MARKERS);
    if (share <= 0) {
        return markers;
    }
    for (const line of roads.lines) {
        const { points, lead, halfWidth } = line;
        let side = rng() < 0.5 ? 1 : -1;
        const spacing = Math.round(MARKER_SPACING / share);
        for (let at = lead + spacing; at + 1 < points.length; at += spacing) {
            const from = points[at];
            const to = points[at + 1];
            const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            const reach = halfWidth + MARKER_OFFSET;
            const x = Math.floor(from.x - ((to.y - from.y) / length) * reach * side);
            const y = Math.floor(from.y + ((to.x - from.x) / length) * reach * side);
            side = -side;
            if (
                ground.inside(x, y) &&
                toEdge(x, y) > 2 &&
                ground.isClear(x - 1, y - 1, 3, 3) &&
                !ground.isWaterTile(x, y)
            ) {
                const id = biomeAt(x, y).marker;
                ground.place({ id, type: LOC_NORMAL, rotation: 0, level: 0, x, y }, 1, 1);
                markers.push({ x, y });
            }
        }
    }
    return markers;
}
