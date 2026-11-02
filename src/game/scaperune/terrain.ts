import { Point } from "./paths";

// The ground's height as a layer of its own, while a map's being built: floats per tile
// corner, in the map files' height units. Things that need the ground to be a certain
// height (a road, a building, a bridge) pin it, and settle() brings the rest of the
// ground to meet them. Only the finished heights go into the grid. See CLAUDE.md.

// A byte per corner, 8 scene units each: 16 tiles of height, top to bottom
export const MAX_HEIGHT = 255;
// A tile's 128 units across, so 16 height units a tile is 45 degrees
export const UNITS_PER_TILE = 16;

const DIAGONAL = Math.SQRT2;

// How steep a tile is, in height units a tile: its steepest edge or diagonal. Heights can
// be a byte grid or floats. collision and check-maps.ts hold ground to this.
export function getTileSlope(
    heights: ArrayLike<number>,
    cornersX: number,
    x: number,
    y: number,
): number {
    const at = x + y * cornersX;
    const sw = heights[at];
    const se = heights[at + 1];
    const nw = heights[at + cornersX];
    const ne = heights[at + cornersX + 1];
    return Math.max(
        Math.abs(sw - se),
        Math.abs(nw - ne),
        Math.abs(sw - nw),
        Math.abs(se - ne),
        Math.abs(sw - ne) / DIAGONAL,
        Math.abs(se - nw) / DIAGONAL,
    );
}

// Walks a field south-west to north-east and back again, each corner looking at the
// ones it's already been past. visit gets the corner, the one it's looking at, and how
// far that is. This is a chamfer distance's two passes.
function sweep(
    cornersX: number,
    cornersY: number,
    visit: (at: number, from: number, distance: number) => void,
): void {
    for (let y = 0; y < cornersY; y++) {
        for (let x = 0; x < cornersX; x++) {
            const at = x + y * cornersX;
            if (x > 0) {
                visit(at, at - 1, 1);
            }
            if (y > 0) {
                visit(at, at - cornersX, 1);
                if (x > 0) {
                    visit(at, at - cornersX - 1, DIAGONAL);
                }
                if (x + 1 < cornersX) {
                    visit(at, at - cornersX + 1, DIAGONAL);
                }
            }
        }
    }
    for (let y = cornersY - 1; y >= 0; y--) {
        for (let x = cornersX - 1; x >= 0; x--) {
            const at = x + y * cornersX;
            if (x + 1 < cornersX) {
                visit(at, at + 1, 1);
            }
            if (y + 1 < cornersY) {
                visit(at, at + cornersX, 1);
                if (x + 1 < cornersX) {
                    visit(at, at + cornersX + 1, DIAGONAL);
                }
                if (x > 0) {
                    visit(at, at + cornersX - 1, DIAGONAL);
                }
            }
        }
    }
}

// Takes the tops off a field until nothing's steeper than slope a tile, among the corners
// keep says to look at. Corners either side of something keep leaves out can be as far
// apart as they like, so all the height that's lost on slopes goes into cliffs there.
export function limitSlope(
    field: Float32Array,
    cornersX: number,
    cornersY: number,
    slope: number,
    keep?: Uint8Array,
): void {
    const pass = (at: number, from: number, distance: number) => {
        if (!keep || (keep[at] && keep[from])) {
            field[at] = Math.min(field[at], field[from] + slope * distance);
        }
    };
    // More than once, because a route round a cliff can need to double back
    for (let round = 0; round < (keep ? 3 : 1); round++) {
        sweep(cornersX, cornersY, pass);
    }
}

// Takes the tops off a field until nothing's steeper than slope a tile, in any direction. Corners
// held stay put, though what's next to them is held to them.
export function limitFaces(
    field: Float32Array,
    cornersX: number,
    cornersY: number,
    slope: number,
    held: Uint8Array,
): void {
    const pass = (at: number, from: number, distance: number) => {
        if (!held[at]) {
            field[at] = Math.min(field[at], field[from] + slope * distance);
        }
    };
    for (let round = 0; round < 3; round++) {
        sweep(cornersX, cornersY, pass);
    }
}

// The same from below: brings up what's too far under its neighbours, for where a corner held
// high can only be met by the ground coming up to it
export function liftFaces(
    field: Float32Array,
    cornersX: number,
    cornersY: number,
    slope: number,
    held: Uint8Array,
): void {
    const pass = (at: number, from: number, distance: number) => {
        if (!held[at]) {
            field[at] = Math.max(field[at], field[from] - slope * distance);
        }
    };
    for (let round = 0; round < 3; round++) {
        sweep(cornersX, cornersY, pass);
    }
}

// Fills the unset corners of a field (Infinity) with the value of the nearest set one
export function spreadNearest(field: Float32Array, cornersX: number, cornersY: number): void {
    const distances = new Float32Array(field.length).fill(Infinity);
    for (let i = 0; i < field.length; i++) {
        if (field[i] !== Infinity) {
            distances[i] = 0;
        }
    }
    sweep(cornersX, cornersY, (at, from, distance) => {
        if (distances[from] + distance < distances[at]) {
            distances[at] = distances[from] + distance;
            field[at] = field[from];
        }
    });
}

// Cuts the top of anything dropping away to the north steeper than slope a tile, working
// south from the north edge. The camera's fixed and looks north, so this keeps cliffs from
// hiding what's at their foot. Corners held stay put.
export function limitNorthFaces(
    field: Float32Array,
    cornersX: number,
    cornersY: number,
    slope: number,
    held: Uint8Array,
): void {
    for (let y = cornersY - 2; y >= 0; y--) {
        for (let x = 0; x < cornersX; x++) {
            const at = x + y * cornersX;
            if (!held[at]) {
                field[at] = Math.min(field[at], field[at + cornersX] + slope);
            }
        }
    }
}

export class Terrain {
    readonly height: Float32Array;
    // What a corner's been pinned to, NaN if it hasn't
    private readonly pins: Float32Array;
    // How far each pin is from the middle of what pinned it, so that the nearest wins
    private readonly pinDistance: Float32Array;
    // Corners nothing can pin from now on: water's, which everything else has to meet
    private readonly locked: Uint8Array;

    constructor(
        readonly cornersX: number,
        readonly cornersY: number,
    ) {
        const count = cornersX * cornersY;
        this.height = new Float32Array(count);
        this.pins = new Float32Array(count).fill(NaN);
        this.pinDistance = new Float32Array(count).fill(Infinity);
        this.locked = new Uint8Array(count);
    }

    corner(x: number, y: number): number {
        return x + y * this.cornersX;
    }

    insideCorners(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.cornersX && y < this.cornersY;
    }

    // Height at any point, from the corners round it
    getHeight(x: number, y: number): number {
        const cx = Math.min(Math.max(x, 0), this.cornersX - 1.001);
        const cy = Math.min(Math.max(y, 0), this.cornersY - 1.001);
        const tx = Math.floor(cx);
        const ty = Math.floor(cy);
        const fx = cx - tx;
        const fy = cy - ty;
        const at = tx + ty * this.cornersX;
        const { height } = this;
        const south = height[at] + (height[at + 1] - height[at]) * fx;
        const north =
            height[at + this.cornersX] +
            (height[at + this.cornersX + 1] - height[at + this.cornersX]) * fx;
        return south + (north - south) * fy;
    }

    getSlope(x: number, y: number): number {
        return getTileSlope(this.height, this.cornersX, x, y);
    }

    // The lowest and highest ground on a rectangle of tiles
    getRange(x: number, y: number, sizeX: number, sizeY: number): { min: number; max: number } {
        let min = Infinity;
        let max = -Infinity;
        for (let cy = Math.max(y, 0); cy <= Math.min(y + sizeY, this.cornersY - 1); cy++) {
            for (let cx = Math.max(x, 0); cx <= Math.min(x + sizeX, this.cornersX - 1); cx++) {
                const height = this.height[this.corner(cx, cy)];
                min = Math.min(min, height);
                max = Math.max(max, height);
            }
        }
        return { min, max };
    }

    // Pins a corner. Nearer the middle of what's pinning wins, or the first if it's the same.
    pin(x: number, y: number, height: number, distance = 0): void {
        if (!this.insideCorners(x, y)) {
            return;
        }
        const at = this.corner(x, y);
        if (distance < this.pinDistance[at] && !this.locked[at]) {
            this.pins[at] = height;
            this.pinDistance[at] = distance;
        }
    }

    // Stops a corner being pinned from here on. One that's pinned already stays pinned.
    lock(at: number): void {
        this.locked[at] = 1;
    }

    unlock(at: number): void {
        this.locked[at] = 0;
    }

    // Pinned by something that doesn't give way, as a plot does
    isHardPinned(x: number, y: number): boolean {
        return this.pinDistance[this.corner(x, y)] <= 0;
    }

    isLocked(at: number): boolean {
        return this.locked[at] !== 0;
    }

    pinRect(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        height: number,
        distance = 0,
    ): void {
        for (let cy = y; cy <= y + sizeY; cy++) {
            for (let cx = x; cx <= x + sizeX; cx++) {
                this.pin(cx, cy, height, distance);
            }
        }
    }

    isPinned(x: number, y: number): boolean {
        return !Number.isNaN(this.pins[this.corner(x, y)]);
    }

    // Evens out corners that were pinned from a line, which can only go by the nearest point
    // of the nearest road, among themselves. What's pinned hard (distance 0) stays.
    smoothPins(passes: number): void {
        const { pins, pinDistance, cornersX, cornersY } = this;
        for (let pass = 0; pass < passes; pass++) {
            const from = Float32Array.from(pins);
            for (let y = 1; y + 1 < cornersY; y++) {
                for (let x = 1; x + 1 < cornersX; x++) {
                    const at = x + y * cornersX;
                    if (Number.isNaN(from[at]) || pinDistance[at] <= 0) {
                        continue;
                    }
                    let sum = 0;
                    let count = 0;
                    for (let ny = -1; ny <= 1; ny++) {
                        for (let nx = -1; nx <= 1; nx++) {
                            const value = from[at + nx + ny * cornersX];
                            if (!Number.isNaN(value)) {
                                sum += value;
                                count++;
                            }
                        }
                    }
                    pins[at] = sum / count;
                }
            }
        }
    }

    // Lets go of everything, keeping the heights
    clearPins(): void {
        this.pins.fill(NaN);
        this.pinDistance.fill(Infinity);
    }

    // Marks the corners that are pinned
    markPinned(into: Uint8Array): void {
        for (let i = 0; i < into.length; i++) {
            if (!Number.isNaN(this.pins[i])) {
                into[i] = 1;
            }
        }
    }

    // What a corner's pinned to, or its height
    getPinned(x: number, y: number): number {
        const at = this.corner(x, y);
        return Number.isNaN(this.pins[at]) ? this.height[at] : this.pins[at];
    }

    // Pins the ground along a line to the heights given, as wide as halfWidth either side
    pinLine(points: Point[], heights: ArrayLike<number>, halfWidth: number): void {
        const reach = Math.ceil(halfWidth) + 1;
        points.forEach((point, i) => {
            const x0 = Math.floor(point.x) - reach;
            const y0 = Math.floor(point.y) - reach;
            for (let y = y0; y <= y0 + reach * 2 + 1; y++) {
                for (let x = x0; x <= x0 + reach * 2 + 1; x++) {
                    const distance = Math.hypot(x - point.x, y - point.y);
                    if (distance <= halfWidth) {
                        // Anything flat that's already pinned wins: a building's plot
                        this.pin(x, y, heights[i], Math.max(distance, 0.01));
                    }
                }
            }
        });
    }

    // Brings the ground to its pins. Nothing's left steeper than slope a tile away from a
    // pin: ground too high is cut back and ground too low is built up, as a road's cuttings
    // and embankments are. Where two pins disagree by more than that, they stay pinned.
    // Corners held don't move, and make nothing else move: water.
    settle(slope: number, held: Uint8Array): void {
        const { height, pins, cornersX, cornersY } = this;
        const count = height.length;
        const high = new Float32Array(count).fill(Infinity);
        const low = new Float32Array(count).fill(-Infinity);
        for (let i = 0; i < count; i++) {
            if (!Number.isNaN(pins[i])) {
                high[i] = low[i] = pins[i];
            }
        }
        sweep(cornersX, cornersY, (at, from, distance) => {
            const step = slope * distance;
            high[at] = Math.min(high[at], high[from] + step);
            low[at] = Math.max(low[at], low[from] - step);
        });
        for (let i = 0; i < count; i++) {
            if (held[i] && Number.isNaN(pins[i])) {
                continue;
            }
            if (!Number.isNaN(pins[i])) {
                height[i] = pins[i];
            } else if (low[i] > high[i]) {
                height[i] = (low[i] + high[i]) / 2;
            } else {
                height[i] = Math.min(Math.max(height[i], low[i]), high[i]);
            }
        }
    }

    // Writes the corners out, rounded, through set
    write(set: (x: number, y: number, height: number) => void): void {
        for (let y = 0; y < this.cornersY; y++) {
            for (let x = 0; x < this.cornersX; x++) {
                set(x, y, this.height[this.corner(x, y)]);
            }
        }
    }
}
