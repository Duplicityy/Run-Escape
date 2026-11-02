// A heap of tiles by priority, in arrays of numbers: a find on a big map pushes millions
class TileHeap {
    size = 0;
    private priorities = new Float64Array(1024);
    private tiles = new Int32Array(1024);

    get topPriority(): number {
        return this.priorities[0];
    }

    push(priority: number, tile: number): void {
        if (this.size === this.tiles.length) {
            const priorities = new Float64Array(this.size * 2);
            const tiles = new Int32Array(this.size * 2);
            priorities.set(this.priorities);
            tiles.set(this.tiles);
            this.priorities = priorities;
            this.tiles = tiles;
        }
        const { priorities, tiles } = this;
        let at = this.size++;
        while (at > 0) {
            const up = (at - 1) >> 1;
            if (priorities[up] <= priority) {
                break;
            }
            priorities[at] = priorities[up];
            tiles[at] = tiles[up];
            at = up;
        }
        priorities[at] = priority;
        tiles[at] = tile;
    }

    pop(): number {
        const { priorities, tiles } = this;
        const top = tiles[0];
        const size = --this.size;
        const priority = priorities[size];
        const tile = tiles[size];
        let at = 0;
        for (;;) {
            let child = at * 2 + 1;
            if (child >= size) {
                break;
            }
            if (child + 1 < size && priorities[child + 1] < priorities[child]) {
                child++;
            }
            if (priority <= priorities[child]) {
                break;
            }
            priorities[at] = priorities[child];
            tiles[at] = tiles[child];
            at = child;
        }
        priorities[at] = priority;
        tiles[at] = tile;
        return top;
    }
}

// Finds cheapest paths on one grid, again and again without clearing it each time:
// a big map has hundreds of roads to lay.
export class PathFinder {
    private readonly best: Float64Array;
    private readonly from: Int32Array;
    private readonly seen: Uint32Array;
    // What stepping onto a tile costs, asked once a find, as its neighbours each want it
    private readonly costs: Float64Array;
    private readonly costSeen: Uint32Array;
    private readonly heap = new TileHeap();
    private stamp = 0;

    constructor(
        readonly sizeX: number,
        readonly sizeY: number,
    ) {
        const count = sizeX * sizeY;
        this.best = new Float64Array(count);
        this.from = new Int32Array(count);
        this.seen = new Uint32Array(count);
        this.costs = new Float64Array(count);
        this.costSeen = new Uint32Array(count);
    }

    // The cheapest path from a tile to any tile a test accepts (Dijkstra, eight ways
    // but never cutting a corner past a blocked tile). cost says what stepping onto a
    // tile costs, Infinity if it can't be stepped on, and climb (if given) what a step
    // from one tile to the next multiplies that by, for when which way you go matters: a
    // slope that's cheap to walk across and dear to walk up. Returns the tiles walked by
    // index, the end tile first, or nothing if there's no way.
    find(
        start: { x: number; y: number },
        cost: (x: number, y: number) => number,
        isEnd: (i: number) => boolean,
        climb?: (from: number, to: number) => number,
    ): number[] {
        const { sizeX, sizeY, best, from, seen, costs, costSeen, heap } = this;
        const stamp = ++this.stamp;
        const costAt = (x: number, y: number) => {
            const i = x + y * sizeX;
            if (costSeen[i] !== stamp) {
                costSeen[i] = stamp;
                costs[i] = cost(x, y);
            }
            return costs[i];
        };

        heap.size = 0;
        const first = start.x + start.y * sizeX;
        best[first] = 0;
        from[first] = -1;
        seen[first] = stamp;
        heap.push(0, first);
        while (heap.size > 0) {
            const priority = heap.topPriority;
            const i = heap.pop();
            if (priority > best[i]) {
                continue;
            }
            if (isEnd(i)) {
                const path: number[] = [];
                for (let at = i; at !== -1; at = from[at]) {
                    path.push(at);
                }
                return path;
            }
            const x = i % sizeX;
            const y = Math.floor(i / sizeX);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= sizeX || ny >= sizeY) {
                        continue;
                    }
                    if (
                        dx !== 0 &&
                        dy !== 0 &&
                        (costAt(nx, y) === Infinity || costAt(x, ny) === Infinity)
                    ) {
                        continue;
                    }
                    const j = nx + ny * sizeX;
                    const step =
                        costAt(nx, ny) *
                        (dx !== 0 && dy !== 0 ? 1.41 : 1) *
                        (climb ? climb(i, j) : 1);
                    const total = priority + step;
                    if (total !== Infinity && (seen[j] !== stamp || total < best[j])) {
                        seen[j] = stamp;
                        best[j] = total;
                        from[j] = i;
                        heap.push(total, j);
                    }
                }
            }
        }
        return [];
    }
}

export type Point = { x: number; y: number };

// Rounds a path off: each point moves to the average of those around it, a few
// times over. The end stays where it is, and so do the first pinned points, a stretch
// that has to stay straight, which the rest then curves away from.
export function smoothPath(path: Point[], reach: number, passes: number, pinned = 1): Point[] {
    let points = path;
    for (let pass = 0; pass < passes; pass++) {
        points = points.map((point, i) => {
            if (i < pinned || i === points.length - 1) {
                return point;
            }
            const span = Math.min(reach, i, points.length - 1 - i);
            let x = 0;
            let y = 0;
            for (let j = i - span; j <= i + span; j++) {
                x += points[j].x;
                y += points[j].y;
            }
            return { x: x / (span * 2 + 1), y: y / (span * 2 + 1) };
        });
    }
    return points;
}

// Raises a corner field along a path: above 0 within halfWidth of it, as a band of
// steady width, or one that changes along the path
export function addPathToField(
    field: Float32Array,
    sizeX: number,
    sizeY: number,
    path: Point[],
    width: number | ((point: number) => number),
): void {
    for (let i = 0; i + 1 < path.length; i++) {
        const halfWidth = typeof width === "number" ? width : width(i);
        const reach = Math.ceil(halfWidth) + 2;
        const a = path[i];
        const b = path[i + 1];
        const steps = Math.max(Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2), 1);
        for (let step = 0; step <= steps; step++) {
            const x = a.x + ((b.x - a.x) * step) / steps;
            const y = a.y + ((b.y - a.y) * step) / steps;
            const x0 = Math.max(Math.floor(x) - reach, 0);
            const y0 = Math.max(Math.floor(y) - reach, 0);
            const x1 = Math.min(Math.ceil(x) + reach, sizeX - 1);
            const y1 = Math.min(Math.ceil(y) + reach, sizeY - 1);
            for (let cy = y0; cy <= y1; cy++) {
                for (let cx = x0; cx <= x1; cx++) {
                    const value = halfWidth - Math.hypot(cx - x, cy - y);
                    field[cx + cy * sizeX] = Math.max(field[cx + cy * sizeX], value);
                }
            }
        }
    }
}
