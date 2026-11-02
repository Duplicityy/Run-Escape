import { getInsideTiles } from "./building";
import { PlacedLoc, TILE_BLOCKED, TileGrid, TileLevel, createTileGrid } from "./format";
import { smoothField } from "./noise";
import { Reservations } from "./reservations";
import { getCoveredShare, getCoveredSides, getOverlayShape } from "./shapes";

export type StampOptions = {
    // "all" takes the prefab's floor too, the whole rectangle. "footprint"
    // keeps our ground and takes only the floor inside the walls, so there's no
    // edge to see and the ground runs right up to them. A function says which
    // overlays to take, and keeps our ground everywhere else (a bridge, over our
    // own river).
    floor: "all" | "footprint" | ((overlay: number) => boolean);
    // Over how many tiles the ground eases into it
    feather: number;
    // Ignore the prefab's own heights and stand it on flat ground
    flatten: boolean;
    // The height to stand it at; the ground's around it when unset
    height?: number;
    // Which of the prefab's own heights that means; its edge's when unset
    anchor?: number;
    // Leaves a loc out (doors, so you can walk in)
    skipLoc?: (loc: PlacedLoc) => boolean;
    // Leaves the ground's height alone. The generator does this, and pins it in Terrain.
    keepHeights?: boolean;
    // Keeps our underlays under the prefab's overlays, for one from other ground: a
    // Lumbridge bridge's grass would show as a green halo in the snow
    keepUnderlays?: boolean;
};

// An overlay, or which one for a tile
export type OverlayChoice = number | ((x: number, y: number) => number);

// A box of tile corners, both ends in
type CornerArea = { x0: number; y0: number; x1: number; y1: number };

// How many corners past a mask paintOverlay can reach, with one spare for smoothing's edge
const OVERLAY_REACH = 3;

function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
}

// A map being built: our own ground, in plain tile terms, with prefabs stamped
// on it.
export class Ground {
    readonly grid: TileGrid;
    readonly level0: TileLevel;
    readonly sizeX: number;
    readonly sizeY: number;
    // Tiles nothing gets scattered on
    readonly reserved: Uint8Array;
    // Tiles of buildings, walls included. Nothing else goes on these.
    readonly footprint: Uint8Array;
    // What's spoken for, and by what: see reservations.ts
    readonly claims: Reservations;

    constructor(sizeX: number, sizeY: number) {
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        this.grid = createTileGrid(sizeX, sizeY);
        this.level0 = this.grid.levels[0];
        this.reserved = new Uint8Array(sizeX * sizeY);
        this.footprint = new Uint8Array(sizeX * sizeY);
        this.claims = new Reservations(sizeX, sizeY, this.reserved);
    }

    inside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.sizeX && y < this.sizeY;
    }

    tile(x: number, y: number): number {
        return x + y * this.sizeX;
    }

    getHeight(x: number, y: number): number {
        return this.level0.heights[x + y * (this.sizeX + 1)];
    }

    setHeight(x: number, y: number, height: number): void {
        const clamped = Math.min(Math.max(Math.round(height), 0), 255);
        this.level0.heights[x + y * (this.sizeX + 1)] = clamped;
    }

    // Paints an overlay where a field is above 0. The field's per tile corner,
    // x + y * (sizeX + 1), so edges come out as lines rather than steps of whole
    // tiles (shapes.ts). The overlay can depend on where it is. Blocked also blocks tiles
    // at least half covered, so that collision follows what's drawn. skip leaves tiles
    // alone. Returns the tiles it touched. Given an area, the field's only that area's corners.
    paintField(
        field: Float32Array,
        overlay: OverlayChoice,
        blocked: boolean,
        skip?: Uint8Array,
        area: CornerArea = { x0: 0, y0: 0, x1: this.sizeX, y1: this.sizeY },
    ): Uint8Array {
        const { overlays, shapes, rotations, flags } = this.level0;
        const { x0, y0, x1, y1 } = area;
        const cornersX = x1 - x0 + 1;
        const touched = new Uint8Array(this.sizeX * this.sizeY);
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const i = this.tile(x, y);
                const at = x - x0 + (y - y0) * cornersX;
                const sw = field[at];
                const se = field[at + 1];
                const ne = field[at + cornersX + 1];
                const nw = field[at + cornersX];
                const sides = getCoveredSides(sw, se, ne, nw);
                const shape = getOverlayShape(sides, sw + se + ne + nw);
                if (!shape || skip?.[i]) {
                    continue;
                }
                overlays[i] = typeof overlay === "number" ? overlay : overlay(x, y);
                shapes[i] = shape[0];
                rotations[i] = shape[1];
                touched[i] = 1;
                this.reserved[i] = 1;
                if (blocked && getCoveredShare(sides) >= 0.5) {
                    flags[i] |= TILE_BLOCKED;
                }
            }
        }
        return touched;
    }

    // Paints an overlay on the tiles of a mask, for hand-made maps. Its corners
    // are smoothed, so a mask of whole tiles gets edges like a real shore's. skip leaves
    // tiles alone.
    paintOverlay(
        mask: Uint8Array,
        overlay: OverlayChoice,
        blocked: boolean,
        skip?: Uint8Array,
    ): Uint8Array {
        const area = this.getMaskArea(mask);
        if (!area) {
            return new Uint8Array(this.sizeX * this.sizeY);
        }
        const { x0, y0, x1, y1 } = area;
        const cornersX = x1 - x0 + 1;
        const cornersY = y1 - y0 + 1;
        const isSet = (x: number, y: number) => this.inside(x, y) && mask[this.tile(x, y)] !== 0;
        const field = new Float32Array(cornersX * cornersY);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const count =
                    (isSet(x - 1, y - 1) ? 1 : 0) +
                    (isSet(x, y - 1) ? 1 : 0) +
                    (isSet(x - 1, y) ? 1 : 0) +
                    (isSet(x, y) ? 1 : 0);
                field[x - x0 + (y - y0) * cornersX] = count / 4 - 0.4;
            }
        }
        const smoothed = smoothField(field, cornersX, cornersY, 1);
        return this.paintField(smoothed, overlay, blocked, skip, area);
    }

    // The corners round a mask that can come to anything, as a big map's mask is one small
    // square: a set tile lifts its own corners, the smoothing those a corner further, and the
    // tiles on those are all that can be painted. Undefined for an empty mask.
    private getMaskArea(mask: Uint8Array): CornerArea | undefined {
        let x0 = this.sizeX;
        let y0 = this.sizeY;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < this.sizeY; y++) {
            for (let x = 0; x < this.sizeX; x++) {
                if (mask[this.tile(x, y)]) {
                    x0 = Math.min(x0, x);
                    y0 = Math.min(y0, y);
                    x1 = Math.max(x1, x);
                    y1 = Math.max(y1, y);
                }
            }
        }
        if (x1 < 0) {
            return undefined;
        }
        return {
            x0: Math.max(x0 - OVERLAY_REACH, 0),
            y0: Math.max(y0 - OVERLAY_REACH, 0),
            x1: Math.min(x1 + 1 + OVERLAY_REACH, this.sizeX),
            y1: Math.min(y1 + 1 + OVERLAY_REACH, this.sizeY),
        };
    }

    // Takes an overlay off tiles, as a mask or just one, and what blocked them
    clearOverlay(tiles: Uint8Array | number): void {
        const { overlays, shapes, rotations, flags } = this.level0;
        const clear = (i: number) => {
            overlays[i] = 0;
            shapes[i] = 0;
            rotations[i] = 0;
            flags[i] &= ~TILE_BLOCKED;
        };
        if (typeof tiles === "number") {
            clear(tiles);
            return;
        }
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i]) {
                clear(i);
            }
        }
    }

    // Whether a tile's blocked water, as paintField leaves it
    isWaterTile(x: number, y: number): boolean {
        return (this.level0.flags[this.tile(x, y)] & TILE_BLOCKED) !== 0;
    }

    // Whether a loc of this many tiles fits with nothing else there
    isClear(x: number, y: number, sizeX: number, sizeY: number): boolean {
        for (let ty = y; ty < y + sizeY; ty++) {
            for (let tx = x; tx < x + sizeX; tx++) {
                if (!this.inside(tx, ty) || this.reserved[this.tile(tx, ty)]) {
                    return false;
                }
            }
        }
        return true;
    }

    place(loc: PlacedLoc, sizeX: number, sizeY: number): void {
        this.grid.locs.push(loc);
        for (let ty = loc.y; ty < loc.y + sizeY; ty++) {
            for (let tx = loc.x; tx < loc.x + sizeX; tx++) {
                if (this.inside(tx, ty)) {
                    this.reserved[this.tile(tx, ty)] = 1;
                }
            }
        }
    }

    // Average height along a rectangle's edge
    edgeHeight(x: number, y: number, sizeX: number, sizeY: number): number {
        let sum = 0;
        let count = 0;
        for (let cy = y; cy <= y + sizeY; cy++) {
            for (let cx = x; cx <= x + sizeX; cx++) {
                if (cx === x || cy === y || cx === x + sizeX || cy === y + sizeY) {
                    sum += this.getHeight(cx, cy);
                    count++;
                }
            }
        }
        return sum / count;
    }

    // Pastes a prefab with its south-west corner at (x, y)
    stamp(prefab: TileGrid, x: number, y: number, options: StampOptions): void {
        const { sizeX, sizeY } = prefab;
        const base = options.height ?? this.edgeHeight(x, y, sizeX, sizeY);
        const from0 = prefab.levels[0];

        // The prefab's height along its own edge is what meets the ground
        let edgeSum = 0;
        let edgeCount = 0;
        for (let cy = 0; cy <= sizeY; cy++) {
            for (let cx = 0; cx <= sizeX; cx++) {
                if (cx === 0 || cy === 0 || cx === sizeX || cy === sizeY) {
                    edgeSum += from0.heights[cx + cy * (sizeX + 1)];
                    edgeCount++;
                }
            }
        }
        const prefabEdge = options.anchor ?? edgeSum / edgeCount;

        // Heights: the corners under it, then a ring easing back to the ground
        for (let cy = 0; cy <= sizeY && !options.keepHeights; cy++) {
            for (let cx = 0; cx <= sizeX; cx++) {
                const own = from0.heights[cx + cy * (sizeX + 1)];
                this.setHeight(x + cx, y + cy, options.flatten ? base : base + own - prefabEdge);
            }
        }
        const feather = options.keepHeights ? 0 : options.feather;
        for (let cy = -feather; cy <= sizeY + feather; cy++) {
            for (let cx = -feather; cx <= sizeX + feather; cx++) {
                const nearX = Math.min(Math.max(cx, 0), sizeX);
                const nearY = Math.min(Math.max(cy, 0), sizeY);
                const distance = Math.hypot(cx - nearX, cy - nearY);
                if (distance === 0 || distance >= feather) {
                    continue;
                }
                const gx = x + cx;
                const gy = y + cy;
                if (gx < 0 || gy < 0 || gx > this.sizeX || gy > this.sizeY) {
                    continue;
                }
                const edge = this.getHeight(x + nearX, y + nearY);
                const t = smoothstep(distance / feather);
                this.setHeight(gx, gy, edge + (this.getHeight(gx, gy) - edge) * t);
            }
        }

        // Floors
        const inside = options.floor === "footprint" ? getInsideTiles(prefab) : undefined;
        for (let level = 0; level < prefab.levels.length; level++) {
            const from = prefab.levels[level];
            const to = this.grid.levels[level];
            for (let ty = 0; ty < sizeY; ty++) {
                for (let tx = 0; tx < sizeX; tx++) {
                    const i = tx + ty * sizeX;
                    const j = this.tile(x + tx, y + ty);
                    if (!inside || inside[i]) {
                        this.reserved[j] = 1;
                    }
                    if (inside && inside[i]) {
                        this.footprint[j] = 1;
                    }
                    const take =
                        typeof options.floor === "function" && level === 0
                            ? options.floor(from.overlays[i])
                            : !inside || inside[i] !== 0;
                    if (!take) {
                        continue;
                    }
                    // An overlay hides the underlay, which would only bleed into
                    // the ground. Without one, the underlay is the floor.
                    if (!options.keepUnderlays || from.overlays[i] === 0) {
                        to.underlays[j] = from.underlays[i] || to.underlays[j];
                    }
                    to.overlays[j] = from.overlays[i];
                    to.shapes[j] = from.shapes[i];
                    to.rotations[j] = from.rotations[i];
                    to.flags[j] = from.flags[i];
                }
            }
            if (level > 0) {
                for (let cy = 0; cy <= sizeY; cy++) {
                    for (let cx = 0; cx <= sizeX; cx++) {
                        to.heights[x + cx + (y + cy) * (this.sizeX + 1)] =
                            from.heights[cx + cy * (sizeX + 1)];
                    }
                }
            }
        }

        // Locs, but in footprint mode not the ground's own bits around it
        for (const loc of prefab.locs) {
            if (options.skipLoc?.(loc)) {
                continue;
            }
            // Nor the ground's own bits outside the walls
            const at = loc.x + loc.y * sizeX;
            if (
                loc.type === 22 &&
                ((inside && !inside[at]) || (options.floor !== "all" && from0.overlays[at] === 0))
            ) {
                continue;
            }
            this.grid.locs.push({ ...loc, x: loc.x + x, y: loc.y + y });
            if (inside && loc.level === 0 && (loc.type <= 3 || loc.type === 9)) {
                this.footprint[this.tile(loc.x + x, loc.y + y)] = 1;
                this.reserved[this.tile(loc.x + x, loc.y + y)] = 1;
            }
        }
    }
}
