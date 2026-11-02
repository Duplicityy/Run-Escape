// Which overlay shape draws what. An overlay's edge can only cross a tile's side
// at a corner or the middle of the side, so what a tile draws is fixed by which of
// its eight half sides it covers. Two tiles share the half sides between them, so
// picking shapes this way keeps edges in one line. A test holds this table to what
// SceneTileModel really draws.

// Half sides, clockwise from the south half of the west side, as bits. West, then
// north, east and south, two bits each.
export const OVERLAY_SHAPES = new Map<number, [shape: number, rotation: number]>([
    [255, [0, 0]],
    // Half a tile, along a line from corner to corner
    [195, [1, 0]],
    [15, [1, 1]],
    [60, [1, 2]],
    [240, [1, 3]],
    // A wedge, from a corner to the middle of a side, and what's left of the tile
    [7, [2, 0]],
    [28, [2, 1]],
    [112, [2, 2]],
    [193, [2, 3]],
    [56, [3, 0]],
    [224, [3, 1]],
    [131, [3, 2]],
    [14, [3, 3]],
    [248, [4, 0]],
    [227, [4, 1]],
    [143, [4, 2]],
    [62, [4, 3]],
    [199, [5, 0]],
    [31, [5, 1]],
    [124, [5, 2]],
    [241, [5, 3]],
    // Half a tile, along a line from side to side
    [135, [6, 0]],
    [30, [6, 1]],
    [120, [6, 2]],
    [225, [6, 3]],
    // A corner, from the middle of a side to the middle of the next, and the rest
    [129, [7, 0]],
    [6, [7, 1]],
    [24, [7, 2]],
    [96, [7, 3]],
    [126, [8, 0]],
    [249, [8, 1]],
    [231, [8, 2]],
    [159, [8, 3]],
]);

function countBits(bits: number): number {
    let count = 0;
    for (let b = bits; b !== 0; b &= b - 1) {
        count++;
    }
    return count;
}

// How much of a tile some half sides are: under half, and it's still ground
// you can stand on
export function getCoveredShare(sides: number): number {
    return countBits(sides) / 8;
}

// Whether a side's half nearest to a is covered, by the field along it
function isHalfCovered(a: number, b: number): boolean {
    return a * 3 + b > 0;
}

// A side's two half sides
function getSideBits(a: number, b: number): number {
    return (isHalfCovered(a, b) ? 1 : 0) | (isHalfCovered(b, a) ? 2 : 0);
}

// The half sides a tile covers, from a field at its corners
export function getCoveredSides(sw: number, se: number, ne: number, nw: number): number {
    return (
        getSideBits(sw, nw) |
        (getSideBits(nw, ne) << 2) |
        (getSideBits(ne, se) << 4) |
        (getSideBits(se, sw) << 6)
    );
}

// The shape for some half sides, undefined for none. Patterns with no shape are
// edges running along the tile's side, which the tile next door draws: a lone half
// side or a whole side is nothing here, and all but those is a full tile. Shape 11
// looks like it fits a whole side, but it dips to both corners, so a row of them is
// a row of teeth. Two strips on opposite sides go by the field at the tile's middle.
export function getOverlayShape(
    sides: number,
    middle: number,
): [shape: number, rotation: number] | undefined {
    const shape = OVERLAY_SHAPES.get(sides);
    if (shape) {
        return shape;
    }
    const count = countBits(sides);
    if (count <= 2) {
        return undefined;
    }
    return count >= 6 || middle > 0 ? OVERLAY_SHAPES.get(255) : undefined;
}
