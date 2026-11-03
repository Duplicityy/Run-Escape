import {
    COLLISION_LOC_STRIDE,
    REGION_TILE_BRIDGE,
    REGION_TILE_INSIDE,
    type RegionData,
} from "../../../mapviewer/worker/RegionData";
import { CollisionFlag } from "../../../rs/pathfinder/flag/CollisionFlag";
import { Steps, canStep } from "./FlowField";

// Tiles nothing can stand on: objects (trees, rocks, furniture), blocked floor
// (water, the edge of the world) and blocking floor decorations.
export const SOLID_FLAGS =
    CollisionFlag.OBJECT | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;

// Everything outside the arena counts as solid.
const OUTSIDE_FLAGS = CollisionFlag.OBJECT;

// Walls along a tile's edges and the posts at its corners
const WALL_FLAGS =
    CollisionFlag.WALL_NORTH |
    CollisionFlag.WALL_EAST |
    CollisionFlag.WALL_SOUTH |
    CollisionFlag.WALL_WEST |
    CollisionFlag.WALL_NORTH_WEST |
    CollisionFlag.WALL_NORTH_EAST |
    CollisionFlag.WALL_SOUTH_EAST |
    CollisionFlag.WALL_SOUTH_WEST;

// Objects block this much less than their tile on the sides facing open
// ground, where there's no going by the ground they stand on. It stays under
// the smallest radius over √2 (enemies' 0.3), so nothing's centre gets into
// such a tile.
export const OBJECT_INSET = 0.2;

const DIR_X = [0, 1, 0, -1, 1, 1, -1, -1];
const DIR_Y = [1, 0, -1, 0, 1, -1, -1, 1];

export type Box = { x0: number; y0: number; x1: number; y1: number };

// The playable part of the world: collision and ground heights for one
// rectangle on one plane, indexed by world tile. Coordinates are world tiles, x east and y
// north; fractional positions are inside a tile (3222.5 is the middle of 3222).
export class ArenaGrid {
    readonly baseX: number;
    readonly baseY: number;
    readonly sizeX: number;
    readonly sizeY: number;
    readonly plane: number;
    // Whether getHeight follows the two triangles a tile's drawn as, rather than easing
    // across it. It only shows on steep ground: ScapeRune maps (scaperune/CLAUDE.md).
    exactGround = false;
    // The cache's collision flags, less the locs that draw nothing and can go
    private readonly flags: Int32Array;
    // What blocks on each solid tile: a box, x0, y0, x1, y1 in tiles from the
    // tile's south-west corner
    private readonly boxes: Float32Array;
    // Which steps out of each tile are allowed, for finding the way
    readonly steps: Steps;

    constructor(readonly data: RegionData) {
        this.baseX = data.baseX;
        this.baseY = data.baseY;
        this.sizeX = data.sizeX;
        this.sizeY = data.sizeY;
        this.plane = data.plane;
        this.flags = data.collisionFlags.slice();

        const owners = this.findStandaloneLocs();
        const locs = data.collisionLocs;
        // Standalone locs that draw nothing don't block at all
        for (let i = 0; i < owners.length; i++) {
            const at = owners[i] * COLLISION_LOC_STRIDE;
            if (owners[i] >= 0 && locs[at + 4] > locs[at + 6]) {
                this.flags[i] &= ~(CollisionFlag.OBJECT | CollisionFlag.OBJECT_PROJECTILE_BLOCKER);
            }
        }
        this.boxes = new Float32Array(this.sizeX * this.sizeY * 4);
        for (let y = 0; y < this.sizeY; y++) {
            for (let x = 0; x < this.sizeX; x++) {
                const tileX = this.baseX + x;
                const tileY = this.baseY + y;
                if (!this.isSolid(tileX, tileY)) {
                    continue;
                }
                const i = x + y * this.sizeX;
                this.setInsetBox(tileX, tileY, i);
                const owner = owners[i];
                if (owner >= 0) {
                    // Where the loc's model stands, if that's less (a crate that
                    // fills its tile blocks no more than it would without this)
                    const at = owner * COLLISION_LOC_STRIDE;
                    const fit = (v: number, lo: number, hi: number) =>
                        Math.min(Math.max(v, lo), hi);
                    const [x0, y0, x1, y1] = this.boxes.subarray(i * 4, i * 4 + 4);
                    this.boxes[i * 4] = fit(locs[at + 4] - tileX, x0, x1);
                    this.boxes[i * 4 + 1] = fit(locs[at + 5] - tileY, y0, y1);
                    this.boxes[i * 4 + 2] = fit(locs[at + 6] - tileX, x0, x1);
                    this.boxes[i * 4 + 3] = fit(locs[at + 7] - tileY, y0, y1);
                }
            }
        }
        this.steps = new Steps(this, this.baseX, this.baseY, this.sizeX, this.sizeY);
    }

    // The whole tile, but for objects a little less on each side that has open
    // ground all along it. Water and blocked floor fill their tiles, and walls
    // on an object's tile already follow its edges.
    private setInsetBox(tileX: number, tileY: number, i: number): void {
        const flags = this.getFlags(tileX, tileY);
        const boxes = this.boxes;
        boxes[i * 4] = boxes[i * 4 + 1] = 0;
        boxes[i * 4 + 2] = boxes[i * 4 + 3] = 1;
        if ((flags & CollisionFlag.FLOOR) !== 0 || (flags & WALL_FLAGS) !== 0) {
            return;
        }
        // A side is open if nothing's solid beyond it or at either end, so
        // objects touching at a corner still meet there
        const free = (dx: number, dy: number) => !this.isSolid(tileX + dx, tileY + dy);
        const nw = free(-1, 1);
        const ne = free(1, 1);
        const se = free(1, -1);
        const sw = free(-1, -1);
        if (free(-1, 0) && sw && nw) {
            boxes[i * 4] = OBJECT_INSET;
        }
        if (free(0, -1) && se && sw) {
            boxes[i * 4 + 1] = OBJECT_INSET;
        }
        if (free(1, 0) && ne && se) {
            boxes[i * 4 + 2] = 1 - OBJECT_INSET;
        }
        if (free(0, 1) && nw && ne) {
            boxes[i * 4 + 3] = 1 - OBJECT_INSET;
        }
    }

    // Locs that stand on their own block only where their model stands (a
    // signpost on its post) rather than on all their tiles: ones with nothing
    // else blocking on their tiles, no other such loc next to them, and all the
    // open ground round them one piece, so getting between them and whatever's
    // beside them opens no way anywhere that couldn't be reached before. Locs
    // that draw nothing (invisible walls) stand together with any others next
    // to them, the open ground round them all one piece, and a drawn loc next
    // to them keeps its tiles.
    // Returns the standalone loc on each tile (an index into collisionLocs), or
    // -1.
    private findStandaloneLocs(): Int32Array {
        const locs = this.data.collisionLocs;
        const count = locs.length / COLLISION_LOC_STRIDE;
        const tileCount = this.sizeX * this.sizeY;

        // Which loc blocks each tile; -2 if more than one
        const owners = new Int32Array(tileCount).fill(-1);
        const candidate = new Uint8Array(count);
        for (let loc = 0; loc < count; loc++) {
            const at = loc * COLLISION_LOC_STRIDE;
            let ok = !Number.isNaN(locs[at + 4]);
            this.forLocTiles(loc, (tileX, tileY) => {
                if (!this.contains(tileX, tileY)) {
                    ok = false;
                    return;
                }
                const i = tileX - this.baseX + (tileY - this.baseY) * this.sizeX;
                owners[i] = owners[i] === -1 ? loc : -2;
                const flags = this.getFlags(tileX, tileY);
                if (
                    (flags &
                        (WALL_FLAGS | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION)) !==
                    0
                ) {
                    ok = false;
                }
            });
            candidate[loc] = ok ? 1 : 0;
        }

        const drawsNothing = (loc: number) =>
            locs[loc * COLLISION_LOC_STRIDE + 4] > locs[loc * COLLISION_LOC_STRIDE + 6];
        const pieces = this.findOpenPieces();
        const standalone = new Int32Array(tileCount).fill(-1);
        // The first loc of the group each loc's in, once it's in one
        const groupOf = new Int32Array(count).fill(-1);
        for (let loc = 0; loc < count; loc++) {
            if (!candidate[loc] || groupOf[loc] !== -1) {
                continue;
            }
            const group = [loc];
            groupOf[loc] = loc;
            let ok = true;
            let piece = -1;
            for (let g = 0; g < group.length; g++) {
                const member = group[g];
                this.forLocTiles(member, (tileX, tileY) => {
                    const i = tileX - this.baseX + (tileY - this.baseY) * this.sizeX;
                    ok &&= owners[i] === member;
                });
                this.forLocRing(member, (i) => {
                    const other = owners[i];
                    if (other >= 0 && candidate[other]) {
                        if (groupOf[other] === loc) {
                            return;
                        }
                        if (!drawsNothing(member)) {
                            ok = false;
                        } else if (drawsNothing(other)) {
                            group.push(other);
                            groupOf[other] = loc;
                        }
                        // A loc that's drawn next to it keeps all its tiles
                    } else if (pieces[i] >= 0) {
                        ok &&= piece === -1 || piece === pieces[i];
                        piece = pieces[i];
                    }
                });
            }
            if (ok) {
                for (const member of group) {
                    this.forLocTiles(member, (tileX, tileY) => {
                        standalone[tileX - this.baseX + (tileY - this.baseY) * this.sizeX] = member;
                    });
                }
            }
        }
        return standalone;
    }

    private forLocTiles(loc: number, f: (tileX: number, tileY: number) => void): void {
        const locs = this.data.collisionLocs;
        const at = loc * COLLISION_LOC_STRIDE;
        for (let dy = 0; dy < locs[at + 3]; dy++) {
            for (let dx = 0; dx < locs[at + 2]; dx++) {
                f(locs[at] + dx, locs[at + 1] + dy);
            }
        }
    }

    // The tiles in the grid all round a loc's, by index
    private forLocRing(loc: number, f: (i: number) => void): void {
        const locs = this.data.collisionLocs;
        const at = loc * COLLISION_LOC_STRIDE;
        const x0 = locs[at] - 1;
        const y0 = locs[at + 1] - 1;
        const x1 = locs[at] + locs[at + 2];
        const y1 = locs[at + 1] + locs[at + 3];
        for (let tileY = y0; tileY <= y1; tileY++) {
            for (let tileX = x0; tileX <= x1; tileX++) {
                const inside = tileX > x0 && tileX < x1 && tileY > y0 && tileY < y1;
                if (!inside && this.contains(tileX, tileY)) {
                    f(tileX - this.baseX + (tileY - this.baseY) * this.sizeX);
                }
            }
        }
    }

    // Numbers the pieces of open ground that can be walked between with the
    // OSRS rules, per tile; -1 for solid tiles
    private findOpenPieces(): Int32Array {
        const pieces = new Int32Array(this.sizeX * this.sizeY).fill(-1);
        const queue: number[] = [];
        let next = 0;
        for (let start = 0; start < pieces.length; start++) {
            const startX = this.baseX + (start % this.sizeX);
            const startY = this.baseY + Math.floor(start / this.sizeX);
            if (pieces[start] !== -1 || this.isSolid(startX, startY)) {
                continue;
            }
            const piece = next++;
            pieces[start] = piece;
            queue.push(start);
            while (queue.length > 0) {
                const i = queue.pop()!;
                const tileX = this.baseX + (i % this.sizeX);
                const tileY = this.baseY + Math.floor(i / this.sizeX);
                for (let d = 0; d < 8; d++) {
                    const toX = tileX + DIR_X[d];
                    const toY = tileY + DIR_Y[d];
                    if (
                        !this.contains(toX, toY) ||
                        !canStep(this, tileX, tileY, DIR_X[d], DIR_Y[d])
                    ) {
                        continue;
                    }
                    const j = toX - this.baseX + (toY - this.baseY) * this.sizeX;
                    if (pieces[j] === -1) {
                        pieces[j] = piece;
                        queue.push(j);
                    }
                }
            }
        }
        return pieces;
    }

    contains(tileX: number, tileY: number): boolean {
        const x = tileX - this.baseX;
        const y = tileY - this.baseY;
        return x >= 0 && y >= 0 && x < this.sizeX && y < this.sizeY;
    }

    getFlags(tileX: number, tileY: number): number {
        const x = tileX - this.baseX;
        const y = tileY - this.baseY;
        if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) {
            return OUTSIDE_FLAGS;
        }
        return this.flags[x + y * this.sizeX];
    }

    isSolid(tileX: number, tileY: number): boolean {
        return (this.getFlags(tileX, tileY) & SOLID_FLAGS) !== 0;
    }

    // The box that blocks on a solid tile, in world tiles: a signpost's post,
    // the middle of a bush or the whole of a stretch of water
    getSolidBox(tileX: number, tileY: number, out: Box): Box {
        const x = tileX - this.baseX;
        const y = tileY - this.baseY;
        if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) {
            out.x0 = tileX;
            out.y0 = tileY;
            out.x1 = tileX + 1;
            out.y1 = tileY + 1;
            return out;
        }
        const i = (x + y * this.sizeX) * 4;
        out.x0 = tileX + this.boxes[i];
        out.y0 = tileY + this.boxes[i + 1];
        out.x1 = tileX + this.boxes[i + 2];
        out.y1 = tileY + this.boxes[i + 3];
        return out;
    }

    getTileFlags(tileX: number, tileY: number): number {
        const x = tileX - this.baseX;
        const y = tileY - this.baseY;
        if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) {
            return 0;
        }
        return this.data.tileFlags[x + y * this.sizeX];
    }

    isInside(tileX: number, tileY: number): boolean {
        return (this.getTileFlags(tileX, tileY) & REGION_TILE_INSIDE) !== 0;
    }

    // Ground height at a world position in scene units (128 per tile, negative
    // is up). On bridges this is the bridge deck, not the river bed.
    getHeight(x: number, y: number): number {
        const lx = Math.min(Math.max(x - this.baseX, 0), this.sizeX - 0.001);
        const ly = Math.min(Math.max(y - this.baseY, 0), this.sizeY - 0.001);
        const tx = Math.floor(lx);
        const ty = Math.floor(ly);
        const fx = lx - tx;
        const fy = ly - ty;

        const bridge = (this.data.tileFlags[tx + ty * this.sizeX] & REGION_TILE_BRIDGE) !== 0;
        const heights = bridge ? this.data.bridgeHeights : this.data.heights;
        const stride = this.sizeX + 1;
        const i = tx + ty * stride;
        const h00 = heights[i];
        const h10 = heights[i + 1];
        const h01 = heights[i + stride];
        const h11 = heights[i + stride + 1];
        if (this.exactGround) {
            // Tiles split from south-east to north-west (SceneTileModel)
            return fx + fy <= 1
                ? h00 + (h10 - h00) * fx + (h01 - h00) * fy
                : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fy);
        }
        const south = h00 + (h10 - h00) * fx;
        const north = h01 + (h11 - h01) * fx;
        return south + (north - south) * fy;
    }
}
