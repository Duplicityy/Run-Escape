import { REGION_TILE_LIQUID } from "../../../mapviewer/worker/RegionData";
import { CollisionFlag } from "../../../rs/pathfinder/flag/CollisionFlag";
import { ArenaGrid, Box } from "./ArenaGrid";
import { Steps } from "./FlowField";

// A clump of blocked tiles this many across, all ways, is terrain rather than
// things standing about: no tree's that big, and a river bank's too thin
const TERRAIN_SIZE = 4;

// Where flying enemies can't go, for moving them and finding their way: terrain
// walls, the rock and void round a cave or a mountain. They go over everything
// else that stops the walkers: fences, buildings' walls, trees and water.
export class FlightGrid {
    private readonly baseX: number;
    private readonly baseY: number;
    private readonly sizeX: number;
    private readonly sizeY: number;
    private readonly terrain: Uint8Array;
    readonly steps: Steps;

    constructor(grid: ArenaGrid) {
        this.baseX = grid.baseX;
        this.baseY = grid.baseY;
        this.sizeX = grid.sizeX;
        this.sizeY = grid.sizeY;
        this.terrain = findTerrain(grid);
        this.steps = new Steps(this, this.baseX, this.baseY, this.sizeX, this.sizeY);
    }

    isSolid(tileX: number, tileY: number): boolean {
        const x = tileX - this.baseX;
        const y = tileY - this.baseY;
        return (
            x < 0 ||
            y < 0 ||
            x >= this.sizeX ||
            y >= this.sizeY ||
            this.terrain[x + y * this.sizeX] !== 0
        );
    }

    getFlags(tileX: number, tileY: number): number {
        return this.isSolid(tileX, tileY) ? CollisionFlag.OBJECT : 0;
    }

    getSolidBox(tileX: number, tileY: number, out: Box): Box {
        out.x0 = tileX;
        out.y0 = tileY;
        out.x1 = tileX + 1;
        out.y1 = tileY + 1;
        return out;
    }
}

// 1 on each tile of terrain: any solid clump TERRAIN_SIZE across (what's beyond
// the arena counts towards one, so it holds up against the edge), and the
// blocked floor joined to it, however thin (a cave's rim)
function findTerrain(grid: ArenaGrid): Uint8Array {
    const { baseX, baseY, sizeX, sizeY } = grid;
    const isFloor = (x: number, y: number) =>
        (grid.getFlags(baseX + x, baseY + y) & CollisionFlag.FLOOR) !== 0 &&
        (grid.getTileFlags(baseX + x, baseY + y) & REGION_TILE_LIQUID) === 0;
    const isRock = (x: number, y: number) =>
        x < 0 ||
        y < 0 ||
        x >= sizeX ||
        y >= sizeY ||
        isFloor(x, y) ||
        (grid.getFlags(baseX + x, baseY + y) & CollisionFlag.OBJECT) !== 0;

    const terrain = new Uint8Array(sizeX * sizeY);
    const queue: number[] = [];
    for (let y = 1 - TERRAIN_SIZE; y < sizeY; y++) {
        for (let x = 1 - TERRAIN_SIZE; x < sizeX; x++) {
            let clump = true;
            for (let dy = 0; dy < TERRAIN_SIZE && clump; dy++) {
                for (let dx = 0; dx < TERRAIN_SIZE && clump; dx++) {
                    clump = isRock(x + dx, y + dy);
                }
            }
            if (!clump) {
                continue;
            }
            for (let dy = 0; dy < TERRAIN_SIZE; dy++) {
                for (let dx = 0; dx < TERRAIN_SIZE; dx++) {
                    const tileX = x + dx;
                    const tileY = y + dy;
                    if (tileX < 0 || tileY < 0 || tileX >= sizeX || tileY >= sizeY) {
                        continue;
                    }
                    const i = tileX + tileY * sizeX;
                    if (terrain[i] === 0) {
                        terrain[i] = 1;
                        queue.push(i);
                    }
                }
            }
        }
    }
    while (queue.length > 0) {
        const i = queue.pop()!;
        const x = i % sizeX;
        const y = Math.floor(i / sizeX);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const toX = x + dx;
                const toY = y + dy;
                if (toX < 0 || toY < 0 || toX >= sizeX || toY >= sizeY) {
                    continue;
                }
                const j = toX + toY * sizeX;
                if (terrain[j] === 0 && isFloor(toX, toY)) {
                    terrain[j] = 1;
                    queue.push(j);
                }
            }
        }
    }
    return terrain;
}
