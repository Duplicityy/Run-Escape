import type { Ground } from "./Ground";
import { TILE_BLOCKED, TILE_SHOWN } from "./format";

// City walls as the real ones are built. A real city wall isn't one loc: it's a band of tiles,
// with a face on the far edge of the tiles each side of a blocked middle, and a walkway a level up
// over the lot, railed on both sides. The upper level's tiles are flagged to show from the ground,
// which is the one thing the game draws above its plane. The ids and numbers are all measured:
// scripts/scaperune/research/wall-survey.ts reads a place's section, corners and gates.

// The settings read this file, so it can't lean on mapBuild for these
const LOC_WALL = 0;
const LOC_POST = 1;
const LOC_INNER_CORNER = 2;
const LOC_DIAGONAL = 9;
const LOC_NORMAL = 10;

// A wall's rotation: which of a tile's edges it's on, in the frame of getWallSide
const NORTH = 1;
const EAST = 2;
const SOUTH = 3;
const WEST = 0;

// One face of a wall: the wall on the ground and the rail on top of it, a level up. A wall a
// loc thick has no rail, and nothing behind it.
export type WallFace = { wall: number; rail?: number };

// A loc of a gate: tiles along the wall from the gate's first column, tiles in from the wall's
// middle (the outer face's tile is -1), level, id, type and rotation, with the outside to the south
export type GatePart = [
    along: number,
    across: number,
    level: number,
    id: number,
    type: number,
    rotation: number,
];

// A tower, an octagon, solid to the top: inside is how many tiles across inside its faces, chamfer
// how far its corners are cut, and it stands storeys high with its floor and rail on top of that
export type WallTower = {
    wall: number;
    rail: number;
    floor: number;
    inside: number;
    chamfer: number;
    storeys: number;
    rise: number;
};

export type CityWallKit = {
    label: string;
    outer: WallFace;
    // With a width of 0 there's only the outer face: a plain wall with nothing on top
    inner: WallFace;
    // The walkway's floor, as the map files store it, how high it stands in height units, and how
    // many tiles wide it is
    walk: number;
    rise: number;
    width: number;
    // How many tiles a corner's cut back on the diagonal, as the real ones are. 0 is square.
    // Only walkways a tile wide have a diagonal.
    chamfer: number;
    // Columns a gate takes up. With no parts, the wall ends with a cap either side of the gap, and
    // the first and last of those columns have the cap on them: you can walk through them all.
    gateSize: number;
    gateParts?: GatePart[];
    // A buttress against the outer face, every so many tiles
    pier?: { id: number; every: number };
    // A tower on each corner in place of the corner
    tower?: WallTower;
    // Nothing in it's contoured, so it's only for level ground: the generator levels its ring
    level?: boolean;
    // For the automatic choice: the town families and the biomes it suits
    families: string[];
    biomes: string[];
};

// Measured from the cache. Rotations in gateParts are with the outside to the south.
const KITS = {
    // Falador's: the west wall at 2935,3372, and its north gate at 2963 to 2968,3392
    falador: {
        label: "Falador",
        outer: { wall: 24029, rail: 24026 },
        inner: { wall: 24029, rail: 24035 },
        walk: 123,
        rise: 37,
        width: 1,
        chamfer: 3,
        families: ["lumbridge"],
        biomes: ["meadow", "elven", "astral", "fairy"],
        gateSize: 6,
        gateParts: [
            [0, -1, 0, 24029, LOC_POST, 0],
            [0, -1, 1, 24026, LOC_POST, 0],
            [0, 0, 0, 24029, LOC_WALL, 0],
            [0, 0, 1, 24028, LOC_WALL, 0],
            [0, 0, 0, 23982, LOC_NORMAL, 0],
            [0, 0, 1, 23985, LOC_NORMAL, 0],
            [0, 1, 0, 24029, LOC_POST, 3],
            [0, 1, 1, 24035, LOC_POST, 3],
            [0, 1, 0, 23983, LOC_NORMAL, 0],
            [0, 1, 1, 23986, LOC_NORMAL, 0],
            [0, 2, 0, 23984, LOC_NORMAL, 0],
            [0, 2, 1, 23987, LOC_NORMAL, 0],
            [5, -1, 0, 24029, LOC_POST, 1],
            [5, -1, 1, 24026, LOC_POST, 1],
            [5, 0, 0, 24175, LOC_WALL, 2],
            [5, 0, 1, 24027, LOC_WALL, 2],
            [5, 0, 0, 23988, LOC_NORMAL, 2],
            [5, 0, 1, 23991, LOC_NORMAL, 2],
            [5, 1, 0, 24029, LOC_POST, 2],
            [5, 1, 1, 24035, LOC_POST, 2],
            [5, 1, 0, 23989, LOC_NORMAL, 2],
            [5, 1, 1, 23992, LOC_NORMAL, 2],
            [5, 2, 0, 23990, LOC_NORMAL, 2],
            [5, 2, 1, 23993, LOC_NORMAL, 2],
        ],
    },
    // Varrock's north-west wall at 3186 to 3188,3464, with its gap for the road at 3189,3489
    varrock: {
        label: "Varrock",
        outer: { wall: 23795, rail: 23777 },
        inner: { wall: 23795, rail: 23777 },
        walk: 171,
        rise: 37,
        width: 1,
        chamfer: 3,
        gateSize: 6,
        pier: { id: 23811, every: 6 },
        families: ["varrock"],
        biomes: ["meadow", "swamp", "deadlands", "darkwood"],
    },
    // Kourend Castle's curtain wall at 1631,3657, three tiles across the top, with the castle's
    // octagon towers at 1593,3661. Its rails stand level, so they step on a slope.
    kourend: {
        label: "Kourend Castle",
        outer: { wall: 23780, rail: 23775 },
        inner: { wall: 23780, rail: 23775 },
        walk: 11,
        rise: 37,
        width: 3,
        chamfer: 0,
        gateSize: 6,
        tower: {
            wall: 23818,
            rail: 23775,
            floor: 11,
            inside: 7,
            chamfer: 2,
            storeys: 2,
            rise: 37,
        },
        families: ["hosidius"],
        biomes: ["autumn"],
    },
    // Shayzien's at 1503,3542
    shayzien: {
        label: "Shayzien",
        outer: { wall: 14543, rail: 14558 },
        inner: { wall: 14543, rail: 14558 },
        walk: 11,
        rise: 30,
        width: 1,
        chamfer: 3,
        gateSize: 6,
        families: ["shayzien", "lovakengj"],
        biomes: ["ash"],
    },
    // Civitas illa Fortis's at 1747,3162, three tiles tall
    civitas: {
        label: "Civitas illa Fortis",
        outer: { wall: 52287, rail: 52296 },
        inner: { wall: 52286, rail: 52296 },
        walk: 159,
        rise: 48,
        width: 1,
        chamfer: 3,
        gateSize: 6,
        families: ["al", "pollnivneach", "sophanem", "ape", "taibwo"],
        biomes: ["desert", "jungle", "tropical"],
    },
    // Yanille's at 2542,3110
    yanille: {
        label: "Yanille",
        level: true,
        outer: { wall: 17088, rail: 1913 },
        inner: { wall: 17088, rail: 1913 },
        walk: 10,
        rise: 36,
        width: 2,
        chamfer: 0,
        gateSize: 6,
        families: [],
        biomes: [],
    },
    // Jatizso's: one wall, and nothing on it
    jatizso: {
        label: "Jatizso",
        outer: { wall: 21407 },
        inner: { wall: 21407 },
        walk: 0,
        rise: 0,
        width: 0,
        chamfer: 3,
        gateSize: 6,
        families: ["rellekka"],
        biomes: ["snow"],
    },
} satisfies Record<string, CityWallKit>;

export type CityWallId = keyof typeof KITS;

export const CITY_WALLS: Record<CityWallId, CityWallKit> = KITS;

export const CITY_WALL_IDS = Object.keys(CITY_WALLS) as CityWallId[];

// The middle of a wall's walkway, in tiles: the corners of the rectangle it runs round. Any corner
// can be cut further than its kit's own, for a shape that's less of a box, by the side that starts
// there. A kit with towers or square corners stays as it is.
export type WallRect = { x0: number; y0: number; x1: number; y1: number; cuts?: number[] };

// Which side of a rectangle: its turn from south, clockwise
export type WallSide = "south" | "west" | "north" | "east";

export const WALL_SIDES: WallSide[] = ["south", "west", "north", "east"];

// A gate, by the tile at its middle along that side: an x on the north and south, a y on the others
export type CityGate = { side: WallSide; at: number };

// A side of the rectangle in its own frame, the same on every side: along runs from one corner
// to the next, across runs in, and the outside's to the south. Going along, the sides come
// round anticlockwise.
export function getWallSide(rect: WallRect, turn: number) {
    const { x0, y0, x1, y1 } = rect;
    return {
        length: turn & 1 ? y1 - y0 : x1 - x0,
        x: (along: number, across: number) =>
            [x0 + along, x0 + across, x1 - along, x1 - across][turn],
        y: (along: number, across: number) =>
            [y0 + across, y1 - along, y1 - across, y0 + along][turn],
    };
}

// How many tiles from a corner a tower covers along a wall, with its centre on the walkway's
export function getTowerSpan(kit: CityWallKit): { back: number; on: number } {
    const across = (kit.tower?.inside ?? 0) + 2;
    const back = ((across - 1) >> 1) - ((kit.width - 1) >> 1);
    return { back, on: across - back };
}

// How far along a side its first column stands, past what's at the corner
export function getWallInset(kit: CityWallKit): number {
    return kit.tower ? getTowerSpan(kit).on : kit.chamfer;
}

// Whether a kit's corners can be cut further
export function canCutCorners(kit: CityWallKit): boolean {
    return !kit.tower && kit.chamfer > 0;
}

// How far a corner's cut, by the side that starts there
function getCornerCut(kit: CityWallKit, rect: WallRect, turn: number): number {
    return canCutCorners(kit) ? (rect.cuts?.[turn & 3] ?? kit.chamfer) : getWallInset(kit);
}

// How far in from each end of a side its columns start and stop
export function getSideInsets(kit: CityWallKit, rect: WallRect, turn: number): [number, number] {
    return [getCornerCut(kit, rect, turn), getCornerCut(kit, rect, turn + 3)];
}

// Where a gate is on its side: the first of the columns it takes up
export function getGateColumns(kit: CityWallKit, rect: WallRect, gate: CityGate) {
    const turn = WALL_SIDES.indexOf(gate.side);
    const side = getWallSide(rect, turn);
    const along = turn === 0 || turn === 3 ? gate.at - (turn ? rect.y0 : rect.x0) : 0;
    const back = turn === 1 ? rect.y1 - gate.at : rect.x1 - gate.at;
    const start = (turn === 0 || turn === 3 ? along : back) - ((kit.gateSize - 1) >> 1);
    return { turn, side, start };
}

// The tiles a wall stands on, for keeping things off them before it goes up
export function forWallTiles(
    kit: CityWallKit,
    rect: WallRect,
    visit: (x: number, y: number) => void,
): void {
    for (let turn = 0; turn < 4; turn++) {
        const side = getWallSide(rect, turn);
        const [first, last] = getSideInsets(kit, rect, turn);
        const corner = canCutCorners(kit) ? first : 0;
        const end = canCutCorners(kit) ? side.length - last : side.length;
        for (let along = corner - 1; along <= end + 1; along++) {
            for (let across = -1; across <= kit.width; across++) {
                visit(side.x(along, across), side.y(along, across));
            }
        }
        // Down a cut corner, both faces and what's between them
        for (let sum = corner - 2; corner > 0 && sum <= corner + 2; sum++) {
            for (let along = -1; along <= sum + 1; along++) {
                visit(side.x(along, sum - along), side.y(along, sum - along));
            }
        }
        if (kit.tower) {
            const { back, on } = getTowerSpan(kit);
            for (let along = -back; along < on; along++) {
                for (let across = -back; across < on; across++) {
                    visit(side.x(along, across), side.y(along, across));
                }
            }
        }
    }
}

// A tower with its south-west corner at a tile. It's blocked right through.
function placeTower(ground: Ground, tower: WallTower, x: number, y: number): void {
    const { wall, rail, floor, inside, chamfer, storeys, rise } = tower;
    const rect = { x0: x + 1, y0: y + 1, x1: x + inside, y1: y + inside };
    const corners = ground.sizeX + 1;
    const up = (level: number, tileX: number, tileY: number) => {
        const tiles = ground.grid.levels[level];
        tiles.flags[ground.tile(tileX, tileY)] |= TILE_SHOWN;
        for (const corner of [0, 1, corners, corners + 1]) {
            tiles.heights[tileX + tileY * corners + corner] = rise;
        }
    };
    for (let tileY = y; tileY < y + inside + 2; tileY++) {
        for (let tileX = x; tileX < x + inside + 2; tileX++) {
            const i = ground.tile(tileX, tileY);
            ground.reserved[i] = 1;
            for (let level = 1; level <= storeys; level++) {
                up(level, tileX, tileY);
            }
            const fromX = Math.min(tileX - rect.x0, rect.x1 - tileX);
            const fromY = Math.min(tileY - rect.y0, rect.y1 - tileY);
            if (fromX >= 0 && fromY >= 0 && fromX + fromY >= chamfer) {
                ground.level0.flags[i] |= TILE_BLOCKED;
                ground.grid.levels[storeys].overlays[i] = floor;
            }
        }
    }
    const put = (level: number, type: number, rotation: number, tileX: number, tileY: number) =>
        ground.grid.locs.push({
            id: level === storeys ? rail : wall,
            type,
            rotation: rotation & 3,
            level,
            x: tileX,
            y: tileY,
        });
    for (let turn = 0; turn < 4; turn++) {
        const side = getWallSide(rect, turn);
        for (let level = 0; level <= storeys; level++) {
            for (let along = chamfer; along <= side.length - chamfer; along++) {
                put(level, LOC_WALL, NORTH + turn, side.x(along, -1), side.y(along, -1));
            }
            for (let i = 0; i < chamfer; i++) {
                const diagonalX = side.x(i, chamfer - 1 - i);
                const diagonalY = side.y(i, chamfer - 1 - i);
                put(level, LOC_DIAGONAL, NORTH + turn, diagonalX, diagonalY);
                if (level === storeys) {
                    const tiles = ground.grid.levels[level];
                    const at = ground.tile(diagonalX, diagonalY);
                    tiles.overlays[at] = floor;
                    tiles.shapes[at] = 1;
                    tiles.rotations[at] = (NORTH + turn + 1) & 3;
                }
            }
            for (let i = 0; i <= chamfer; i++) {
                const postX = side.x(i - 1, chamfer - 1 - i);
                const postY = side.y(i - 1, chamfer - 1 - i);
                put(level, LOC_POST, NORTH + turn, postX, postY);
            }
        }
    }
}

// Builds a wall round a rectangle. skip says where it can't stand: it stops short of those tiles
// with a cap, as it does at a gate. A hand-made map calls this once its heights are done: the wall
// goes up on the ground as it is, and only needs a Ground. Pin a gate's ground flat, and a tower's:
// see the guide, on slopes.
export function placeCityWall(
    ground: Ground,
    kit: CityWallKit,
    rect: WallRect,
    gates: CityGate[],
    skip: (x: number, y: number) => boolean = () => false,
): void {
    const { outer, inner, walk, rise, width, chamfer, pier, tower } = kit;
    const levelUp = ground.grid.levels[1];
    const corners = ground.sizeX + 1;
    const free = (x: number, y: number) => ground.inside(x, y) && !skip(x, y);

    // A floor a level up, flagged to show from the ground
    const shown = (x: number, y: number) => {
        levelUp.flags[ground.tile(x, y)] |= TILE_SHOWN;
        for (const corner of [0, 1, corners, corners + 1]) {
            levelUp.heights[x + y * corners + corner] = rise;
        }
    };
    const put = (
        id: number,
        type: number,
        rotation: number,
        level: number,
        x: number,
        y: number,
    ) => {
        ground.grid.locs.push({ id, type, rotation: rotation & 3, level, x, y });
        ground.reserved[ground.tile(x, y)] = 1;
        if (level > 0) {
            shown(x, y);
        }
    };
    const solid = (x: number, y: number) => {
        const i = ground.tile(x, y);
        ground.level0.flags[i] |= TILE_BLOCKED;
        ground.reserved[i] = 1;
        shown(x, y);
        levelUp.overlays[i] = walk;
    };
    // Half a tile of walkway, on the walkway's side of a diagonal
    const halfDeck = (rotation: number, x: number, y: number) => {
        const i = ground.tile(x, y);
        levelUp.overlays[i] = walk;
        levelUp.shapes[i] = 1;
        levelUp.rotations[i] = (rotation + 1) & 3;
    };

    const sides = WALL_SIDES.map((_, turn) => getWallSide(rect, turn));
    // Columns by a gate that has its own ends, which don't want a cap too
    const capless = sides.map((side) => new Uint8Array(side.length + 1));
    // Which columns of each side stand. A column's the tiles across the wall at one along.
    const columns = sides.map((side, turn) => {
        const stands = new Uint8Array(side.length + 1);
        const [first, end] = getSideInsets(kit, rect, turn);
        for (let along = first; along <= side.length - end; along++) {
            let clear = 1;
            for (let across = -1; across <= width; across++) {
                clear &= free(side.x(along, across), side.y(along, across)) ? 1 : 0;
            }
            stands[along] = clear;
        }
        for (const gate of gates) {
            if (WALL_SIDES.indexOf(gate.side) === turn) {
                const { start } = getGateColumns(kit, rect, gate);
                stands.fill(0, Math.max(start, 0), start + kit.gateSize);
                if (kit.gateParts) {
                    capless[turn].fill(1, Math.max(start - 1, 0), start + kit.gateSize + 1);
                }
            }
        }
        return stands;
    });

    // Whether each side's first corner has room
    const cornersClear = sides.map((side, turn) => {
        const [cut] = getSideInsets(kit, rect, turn);
        const reach = Math.max(cut, width) + 1;
        for (let across = -1; across <= reach; across++) {
            for (let along = -1; along <= reach; along++) {
                const onCut = chamfer === 0 || Math.abs(along + across - cut) <= 2;
                if (onCut && !free(side.x(along, across), side.y(along, across))) {
                    return false;
                }
            }
        }
        return true;
    });

    sides.forEach((side, turn) => {
        const stands = columns[turn];
        const [inset, lastInset] = getSideInsets(kit, rect, turn);
        const last = side.length - lastInset;
        const walkEnd = chamfer > 0 || tower ? last : side.length - width;
        const innerFrom = tower ? inset : chamfer > 0 ? inset + 1 : width + 1;
        const innerTo = tower ? last : chamfer > 0 ? last - 1 : side.length - width - 1;
        const x = side.x;
        const y = side.y;
        // Both of a face, the wall and its rail
        const face = (
            { wall, rail }: WallFace,
            type: number,
            rotation: number,
            along: number,
            across: number,
        ) => {
            const at = [x(along, across), y(along, across)] as const;
            put(wall, type, rotation + turn, 0, ...at);
            if (rail !== undefined) {
                put(rail, type, rotation + turn, 1, ...at);
            }
        };
        const hasInner = width > 0;

        // A run of wall, and a cap at each end that isn't a corner
        let along = inset;
        while (along <= last) {
            if (!stands[along]) {
                along++;
                continue;
            }
            let start = along;
            while (along <= last && stands[along]) {
                along++;
            }
            let end = along - 1;
            // A cap needs ground of its own, so a wall that's stopped by something stops a column
            // shorter
            const capFits = (column: number) => {
                for (let across = -1; across <= width; across++) {
                    if (!free(x(column, across), y(column, across))) {
                        return false;
                    }
                }
                return true;
            };
            while (end >= start && end < last && !capFits(end + 1)) {
                end--;
            }
            while (start <= end && start > inset && !capFits(start - 1)) {
                start++;
            }
            // Anything shorter than this is only a lump
            if (end - start < 2) {
                continue;
            }
            for (let at = start; at <= end; at++) {
                face(outer, LOC_WALL, NORTH, at, -1);
                if (hasInner && at >= innerFrom && at <= innerTo) {
                    face(inner, LOC_WALL, SOUTH, at, width);
                }
                if (at <= walkEnd) {
                    for (let across = 0; across < width; across++) {
                        solid(x(at, across), y(at, across));
                    }
                }
                if (pier && (at - start + 3) % pier.every === 0 && end - at > 1) {
                    const tile = [x(at, -1), y(at, -1)] as const;
                    put(pier.id, LOC_NORMAL, NORTH + turn, 0, ...tile);
                }
            }
            if (start > inset && !capless[turn][start - 1]) {
                face(outer, LOC_POST, NORTH, start - 1, -1);
                if (hasInner) {
                    face(inner, LOC_POST, EAST, start - 1, width);
                }
                for (let across = 0; across < width; across++) {
                    face(outer, LOC_WALL, EAST, start - 1, across);
                }
            }
            if (end < last && !capless[turn][end + 1]) {
                face(outer, LOC_POST, WEST, end + 1, -1);
                if (hasInner) {
                    face(inner, LOC_POST, SOUTH, end + 1, width);
                }
                for (let across = 0; across < width; across++) {
                    face(outer, LOC_WALL, WEST, end + 1, across);
                }
            }
        }

        // The corner at this side's start, where the side before it comes in
        const before = (turn + 1) % 4;
        const stood =
            cornersClear[turn] && columns[before][sides[before].length - inset] && stands[inset];
        if (stood && tower) {
            // The tower's faces take the tile where the wall would meet it, so it stops a tile
            // short with only its walkway going on
            const { back, on } = getTowerSpan(kit);
            const towerX = Math.min(x(-back, -back), x(on - 1, on - 1));
            const towerY = Math.min(y(-back, -back), y(on - 1, on - 1));
            placeTower(ground, tower, towerX, towerY);
            const end = sides[before];
            for (let across = 0; across < width; across++) {
                solid(x(on - 1, across), y(on - 1, across));
                solid(end.x(end.length - on + 1, across), end.y(end.length - on + 1, across));
            }
        } else if (stood && chamfer === 0) {
            face(outer, LOC_POST, NORTH, -1, -1);
            if (hasInner) {
                face(inner, LOC_INNER_CORNER, SOUTH, width, width);
            }
        } else if (stood) {
            const c = inset;
            if (hasInner) {
                for (let i = 1; i < c; i++) {
                    solid(x(i, c - i), y(i, c - i));
                }
            }
            for (let i = 0; i < c; i++) {
                face(outer, LOC_DIAGONAL, NORTH, i, c - 1 - i);
                if (hasInner) {
                    face(inner, LOC_DIAGONAL, SOUTH, i + 1, c - i);
                    halfDeck(NORTH + turn, x(i, c - 1 - i), y(i, c - 1 - i));
                    halfDeck(SOUTH + turn, x(i + 1, c - i), y(i + 1, c - i));
                }
            }
            for (let i = 0; i <= c; i++) {
                face(outer, LOC_POST, NORTH, i - 1, c - 1 - i);
            }
            if (hasInner) {
                for (let i = 0; i < c - 1; i++) {
                    face(inner, LOC_POST, SOUTH, i + 2, c - i);
                }
            }
        }
    });

    for (const gate of gates) {
        const { turn, side, start } = getGateColumns(kit, rect, gate);
        for (const [along, across, level, id, type, rotation] of kit.gateParts ?? []) {
            const tileX = side.x(start + along, across);
            const tileY = side.y(start + along, across);
            put(id, type, rotation + turn, level, tileX, tileY);
        }
    }
}
