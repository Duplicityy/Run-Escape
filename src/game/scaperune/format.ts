import { ByteBuffer } from "../../rs/io/ByteBuffer";
import { generateHeight } from "../../rs/util/HeightCalc";

// The cache's two map file formats, both ways, on a plain in-memory tile grid.
// The terrain's the rev 209+ format (16-bit values). SceneBuilder.decodeTerrain
// and decodeLocs are the other half of this.

export const MAP_SQUARE_SIZE = 64;
export const LEVELS = 4;

// A tile with no height of its own on an upper level sits this far over the
// one below, in height units (8 scene units each)
const LEVEL_HEIGHT = 30;

// Bits of a tile's render flags
export const TILE_BLOCKED = 0x1;
export const TILE_BRIDGE = 0x2;
export const TILE_INSIDE = 0x4;
// Drawn from the ground whatever floor it's on: the top of a city wall
export const TILE_SHOWN = 0x8;

// One level of tiles, x + y * sizeX
export type TileLevel = {
    // Corners, x + y * (sizeX + 1), in height units going up: from nothing on
    // level 0, and from the level below on the others
    heights: Uint8Array;
    // Cache ids plus one (0 = none), as they're stored
    underlays: Uint16Array;
    overlays: Uint16Array;
    // The overlay's shape (0 fills the tile) and rotation
    shapes: Uint8Array;
    rotations: Uint8Array;
    flags: Uint8Array;
};

export type PlacedLoc = {
    id: number;
    // LocModelType
    type: number;
    rotation: number;
    level: number;
    // Tiles in the grid's own coordinates, its south-west corner
    x: number;
    y: number;
};

export type TileGrid = {
    sizeX: number;
    sizeY: number;
    levels: TileLevel[];
    locs: PlacedLoc[];
};

export function createTileLevel(sizeX: number, sizeY: number): TileLevel {
    const count = sizeX * sizeY;
    return {
        heights: new Uint8Array((sizeX + 1) * (sizeY + 1)),
        underlays: new Uint16Array(count),
        overlays: new Uint16Array(count),
        shapes: new Uint8Array(count),
        rotations: new Uint8Array(count),
        flags: new Uint8Array(count),
    };
}

export function createTileGrid(sizeX: number, sizeY: number): TileGrid {
    const levels: TileLevel[] = [];
    for (let level = 0; level < LEVELS; level++) {
        const tiles = createTileLevel(sizeX, sizeY);
        if (level > 0) {
            tiles.heights.fill(LEVEL_HEIGHT);
        }
        levels.push(tiles);
    }
    return { sizeX, sizeY, levels, locs: [] };
}

// Reads a map square's terrain into a grid, at (offsetX, offsetY). The height
// of tiles with none stored comes from the client's noise, from where they are
// in the world. Corners on the grid's far edge come from the square past it.
export function readTerrain(
    data: Int8Array,
    mapX: number,
    mapY: number,
    grid: TileGrid,
    offsetX: number,
    offsetY: number,
): void {
    const buffer = new ByteBuffer(data);
    const cornersX = grid.sizeX + 1;
    const inHeights = (x: number, y: number) =>
        x >= 0 && y >= 0 && x <= grid.sizeX && y <= grid.sizeY;
    const inTiles = (x: number, y: number) => x >= 0 && y >= 0 && x < grid.sizeX && y < grid.sizeY;
    for (let level = 0; level < LEVELS; level++) {
        const tiles = grid.levels[level];
        for (let localX = 0; localX < MAP_SQUARE_SIZE; localX++) {
            for (let localY = 0; localY < MAP_SQUARE_SIZE; localY++) {
                const x = localX + offsetX;
                const y = localY + offsetY;
                const i = x + y * grid.sizeX;
                const inside = inTiles(x, y);
                for (;;) {
                    const v = buffer.readUnsignedShort();
                    if (v === 0 || v === 1) {
                        let height = level === 0 ? 0 : LEVEL_HEIGHT;
                        if (v === 1) {
                            height = buffer.readUnsignedByte();
                            height = height === 1 ? 0 : height;
                        } else if (level === 0) {
                            height = generateHeight(
                                mapX * MAP_SQUARE_SIZE + localX + 932731,
                                mapY * MAP_SQUARE_SIZE + localY + 556238,
                            );
                        }
                        if (inHeights(x, y)) {
                            tiles.heights[x + y * cornersX] = height;
                        }
                        break;
                    }
                    if (v <= 49) {
                        const overlay = buffer.readUnsignedShort();
                        if (inside) {
                            tiles.overlays[i] = overlay;
                            tiles.shapes[i] = (v - 2) >> 2;
                            tiles.rotations[i] = (v - 2) & 3;
                        }
                    } else if (v <= 81) {
                        if (inside) {
                            tiles.flags[i] = v - 49;
                        }
                    } else if (inside) {
                        tiles.underlays[i] = v - 81;
                    }
                }
            }
        }
    }
}

// Writes one map square of a grid, the one starting at (offsetX, offsetY)
export function writeTerrain(grid: TileGrid, offsetX: number, offsetY: number): Int8Array {
    // At most an overlay, flags, an underlay and a height, a tile
    const bytes = new Int8Array(LEVELS * MAP_SQUARE_SIZE * MAP_SQUARE_SIZE * 11);
    let size = 0;
    const byte = (v: number) => {
        bytes[size++] = v;
    };
    const short = (v: number) => {
        byte(v >> 8);
        byte(v & 0xff);
    };
    const cornersX = grid.sizeX + 1;
    for (let level = 0; level < LEVELS; level++) {
        const tiles = grid.levels[level];
        for (let localX = 0; localX < MAP_SQUARE_SIZE; localX++) {
            for (let localY = 0; localY < MAP_SQUARE_SIZE; localY++) {
                const x = localX + offsetX;
                const y = localY + offsetY;
                if (x >= grid.sizeX || y >= grid.sizeY) {
                    short(0);
                    continue;
                }
                const i = x + y * grid.sizeX;
                if (tiles.overlays[i] !== 0) {
                    short(2 + tiles.shapes[i] * 4 + tiles.rotations[i]);
                    short(tiles.overlays[i]);
                }
                if (tiles.flags[i] !== 0) {
                    short(49 + tiles.flags[i]);
                }
                if (tiles.underlays[i] !== 0) {
                    short(81 + tiles.underlays[i]);
                }
                const height = tiles.heights[x + y * cornersX];
                if (level > 0 && height === LEVEL_HEIGHT) {
                    short(0);
                } else {
                    short(1);
                    // 1 would read as 0
                    byte(height === 1 ? 2 : height);
                }
            }
        }
    }
    return bytes.slice(0, size);
}

// A map square's locs, at (offsetX, offsetY) in the grid. Those off the grid
// are left out.
export function readLocs(data: Int8Array, grid: TileGrid, offsetX: number, offsetY: number): void {
    const buffer = new ByteBuffer(data);
    let id = -1;
    let idDelta: number;
    while ((idDelta = buffer.readSmart3()) !== 0) {
        id += idDelta;
        let pos = 0;
        let posDelta: number;
        while ((posDelta = buffer.readUnsignedSmart()) !== 0) {
            pos += posDelta - 1;
            const attributes = buffer.readUnsignedByte();
            const x = ((pos >> 6) & 0x3f) + offsetX;
            const y = (pos & 0x3f) + offsetY;
            if (x >= 0 && y >= 0 && x < grid.sizeX && y < grid.sizeY) {
                grid.locs.push({
                    id,
                    type: attributes >> 2,
                    rotation: attributes & 3,
                    level: pos >> 12,
                    x,
                    y,
                });
            }
        }
    }
}

function writeSmart(out: number[], v: number): void {
    if (v < 128) {
        out.push(v);
    } else {
        const packed = v + 0x8000;
        out.push(packed >> 8, packed & 0xff);
    }
}

function writeSmart3(out: number[], v: number): void {
    while (v >= 32767) {
        writeSmart(out, 32767);
        v -= 32767;
    }
    writeSmart(out, v);
}

// Writes the locs on one map square of a grid. A big map can pass only that square's
// locs, or going through all of them for every square takes a while.
export function writeLocs(
    grid: TileGrid,
    offsetX: number,
    offsetY: number,
    locsOnSquare: PlacedLoc[] = grid.locs,
): Int8Array {
    const pack = (loc: PlacedLoc) =>
        (loc.level << 12) | ((loc.x - offsetX) << 6) | (loc.y - offsetY);
    const locs = locsOnSquare
        .filter(
            (loc) =>
                loc.x >= offsetX &&
                loc.y >= offsetY &&
                loc.x < offsetX + MAP_SQUARE_SIZE &&
                loc.y < offsetY + MAP_SQUARE_SIZE,
        )
        .sort((a, b) => a.id - b.id || pack(a) - pack(b));

    const out: number[] = [];
    let i = 0;
    let lastId = -1;
    while (i < locs.length) {
        const id = locs[i].id;
        writeSmart3(out, id - lastId);
        lastId = id;
        let lastPos = 0;
        for (; i < locs.length && locs[i].id === id; i++) {
            const pos = pack(locs[i]);
            writeSmart(out, pos - lastPos + 1);
            lastPos = pos;
            out.push((locs[i].type << 2) | locs[i].rotation);
        }
        writeSmart(out, 0);
    }
    writeSmart3(out, 0);
    return Int8Array.from(out);
}
