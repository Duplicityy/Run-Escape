import { CollisionFlag } from "../../../rs/pathfinder/flag/CollisionFlag";
import { ArenaGrid, Box, SOLID_FLAGS } from "./ArenaGrid";

export type Vec2 = { x: number; y: number };

// What moving a circle needs of a grid
type BlockGrid = Pick<ArenaGrid, "getFlags" | "getSolidBox">;

const MAX_ITERATIONS = 4;

const solidBox: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };

// The deepest overlap found so far: resolving only that one per iteration keeps
// circles from catching on the seams between neighbouring walls and tiles.
const contact = { depth: 0, nx: 0, ny: 0 };

// Overlap between a circle and an axis aligned box. Walls are boxes with no
// width, wall corners are boxes with no size.
function testBox(pos: Vec2, radius: number, x0: number, y0: number, x1: number, y1: number) {
    const cx = Math.min(Math.max(pos.x, x0), x1);
    const cy = Math.min(Math.max(pos.y, y0), y1);
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq >= radius * radius) {
        return;
    }
    let depth: number;
    let nx: number;
    let ny: number;
    if (distSq > 1e-12) {
        const dist = Math.sqrt(distSq);
        depth = radius - dist;
        nx = dx / dist;
        ny = dy / dist;
    } else {
        // Centre inside the box: leave through the nearest side
        const left = pos.x - x0;
        const right = x1 - pos.x;
        const down = pos.y - y0;
        const up = y1 - pos.y;
        const min = Math.min(left, right, down, up);
        depth = min + radius;
        nx = 0;
        ny = 0;
        if (min === left) {
            nx = -1;
        } else if (min === right) {
            nx = 1;
        } else if (min === down) {
            ny = -1;
        } else {
            ny = 1;
        }
    }
    if (depth > contact.depth) {
        contact.depth = depth;
        contact.nx = nx;
        contact.ny = ny;
    }
}

function testTile(grid: BlockGrid, pos: Vec2, radius: number, tileX: number, tileY: number) {
    const flags = grid.getFlags(tileX, tileY);
    if (flags === 0) {
        return;
    }
    const x0 = tileX;
    const y0 = tileY;
    const x1 = tileX + 1;
    const y1 = tileY + 1;
    if ((flags & SOLID_FLAGS) !== 0) {
        const box = grid.getSolidBox(tileX, tileY, solidBox);
        testBox(pos, radius, box.x0, box.y0, box.x1, box.y1);
        return;
    }
    if (flags & CollisionFlag.WALL_NORTH) {
        testBox(pos, radius, x0, y1, x1, y1);
    }
    if (flags & CollisionFlag.WALL_SOUTH) {
        testBox(pos, radius, x0, y0, x1, y0);
    }
    if (flags & CollisionFlag.WALL_EAST) {
        testBox(pos, radius, x1, y0, x1, y1);
    }
    if (flags & CollisionFlag.WALL_WEST) {
        testBox(pos, radius, x0, y0, x0, y1);
    }
    // Wall corners only stop diagonal steps in OSRS; here they're posts.
    if (flags & CollisionFlag.WALL_NORTH_WEST) {
        testBox(pos, radius, x0, y1, x0, y1);
    }
    if (flags & CollisionFlag.WALL_NORTH_EAST) {
        testBox(pos, radius, x1, y1, x1, y1);
    }
    if (flags & CollisionFlag.WALL_SOUTH_EAST) {
        testBox(pos, radius, x1, y0, x1, y0);
    }
    if (flags & CollisionFlag.WALL_SOUTH_WEST) {
        testBox(pos, radius, x0, y0, x0, y0);
    }
}

// Rounding room for the tiles a circle can touch: one whose edge is a hair
// from the circle's, as far as floating point can tell, is still looked at.
const TILE_EPSILON = 1e-7;

// Moves a circle out of everything it overlaps.
export function resolveCircle(grid: BlockGrid, pos: Vec2, radius: number): void {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        contact.depth = 0;
        // Only the tiles under the circle: everything on a tile (its box,
        // walls and posts) stays inside it, so nothing further can touch
        const minX = Math.floor(pos.x - radius - TILE_EPSILON);
        const maxX = Math.floor(pos.x + radius + TILE_EPSILON);
        const minY = Math.floor(pos.y - radius - TILE_EPSILON);
        const maxY = Math.floor(pos.y + radius + TILE_EPSILON);
        for (let tileY = minY; tileY <= maxY; tileY++) {
            for (let tileX = minX; tileX <= maxX; tileX++) {
                testTile(grid, pos, radius, tileX, tileY);
            }
        }
        if (contact.depth <= 0) {
            return;
        }
        pos.x += contact.nx * contact.depth;
        pos.y += contact.ny * contact.depth;
    }
}

// Moves a circle by (dx, dy), sliding along whatever it hits. Long moves are
// split into steps shorter than the radius so nothing thin is skipped over.
export function moveCircle(
    grid: BlockGrid,
    pos: Vec2,
    dx: number,
    dy: number,
    radius: number,
): void {
    const maxStep = radius * 0.5;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
    const stepX = dx / steps;
    const stepY = dy / steps;
    for (let i = 0; i < steps; i++) {
        pos.x += stepX;
        resolveCircle(grid, pos, radius);
        pos.y += stepY;
        resolveCircle(grid, pos, radius);
    }
}

// Whether a circle at this position overlaps nothing.
export function isCircleFree(grid: BlockGrid, x: number, y: number, radius: number): boolean {
    const probe = { x, y };
    resolveCircle(grid, probe, radius);
    return Math.abs(probe.x - x) < 1e-6 && Math.abs(probe.y - y) < 1e-6;
}

// The free spot nearest (x, y) for a circle this size: (x, y) itself if it's
// free, otherwise the nearest free tile centre, searching outwards a ring of
// tiles at a time from its own. (x, y) when there's nothing free within
// maxDistance tiles. Tiles that allowed turns down don't count as free.
export function findFreeSpot(
    grid: ArenaGrid,
    x: number,
    y: number,
    radius: number,
    allowed?: (tileX: number, tileY: number) => boolean,
    maxDistance = 32,
): Vec2 {
    const isFree = (px: number, py: number) =>
        isCircleFree(grid, px, py, radius) && (!allowed || allowed(Math.floor(px), Math.floor(py)));
    if (isFree(x, y)) {
        return { x, y };
    }
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let d = 0; d <= maxDistance; d++) {
        let best: Vec2 | undefined;
        let bestDistSq = Infinity;
        for (let ty = cy - d; ty <= cy + d; ty++) {
            for (let tx = cx - d; tx <= cx + d; tx++) {
                if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== d) {
                    continue;
                }
                const px = tx + 0.5;
                const py = ty + 0.5;
                if (!grid.contains(tx, ty) || !isFree(px, py)) {
                    continue;
                }
                const distSq = (px - x) * (px - x) + (py - y) * (py - y);
                if (distSq < bestDistSq) {
                    best = { x: px, y: py };
                    bestDistSq = distSq;
                }
            }
        }
        if (best) {
            return best;
        }
    }
    return { x, y };
}
