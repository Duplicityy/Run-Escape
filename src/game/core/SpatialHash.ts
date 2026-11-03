export type Positioned = { x: number; y: number };

// The tiles a hash keeps in flat arrays (the arena); cells beyond go in a map
export type HashBounds = { baseX: number; baseY: number; sizeX: number; sizeY: number };

// Buckets things by grid cell for "what's near here" queries. Rebuilt every
// tick: clear() keeps the buckets and their arrays, so it doesn't allocate.
export class SpatialHash<T extends Positioned> {
    // The cells in the bounds, x then y: each one's things, and how many of
    // them are in it now (a bucket's array only grows)
    private readonly originX: number = 0;
    private readonly originY: number = 0;
    private readonly width: number = 0;
    private readonly height: number = 0;
    private readonly buckets: (T[] | undefined)[];
    private readonly counts: Int32Array;
    // The cells with anything in, to clear
    private readonly used: Int32Array;
    private usedCount = 0;
    // Cells beyond the bounds
    private readonly outside = new Map<number, T[]>();
    private readonly usedOutside: T[][] = [];

    constructor(
        readonly cellSize: number,
        bounds?: HashBounds,
    ) {
        if (bounds) {
            this.originX = Math.floor(bounds.baseX / cellSize);
            this.originY = Math.floor(bounds.baseY / cellSize);
            this.width = Math.floor((bounds.baseX + bounds.sizeX) / cellSize) - this.originX + 1;
            this.height = Math.floor((bounds.baseY + bounds.sizeY) / cellSize) - this.originY + 1;
        }
        const cells = this.width * this.height;
        this.buckets = new Array<T[] | undefined>(cells).fill(undefined);
        this.counts = new Int32Array(cells);
        this.used = new Int32Array(cells);
    }

    private key(cellX: number, cellY: number): number {
        return ((cellX & 0xffff) << 16) | (cellY & 0xffff);
    }

    // A cell's index in the flat arrays, or -1 beyond the bounds
    private index(cellX: number, cellY: number): number {
        const x = cellX - this.originX;
        const y = cellY - this.originY;
        return x >= 0 && y >= 0 && x < this.width && y < this.height ? x + y * this.width : -1;
    }

    clear(): void {
        for (let i = 0; i < this.usedCount; i++) {
            this.counts[this.used[i]] = 0;
        }
        this.usedCount = 0;
        for (const bucket of this.usedOutside) {
            bucket.length = 0;
        }
        this.usedOutside.length = 0;
    }

    insert(item: T): void {
        const cellX = Math.floor(item.x / this.cellSize);
        const cellY = Math.floor(item.y / this.cellSize);
        const index = this.index(cellX, cellY);
        if (index >= 0) {
            let bucket = this.buckets[index];
            if (!bucket) {
                bucket = this.buckets[index] = [];
            }
            const count = this.counts[index];
            if (count === 0) {
                this.used[this.usedCount++] = index;
            }
            bucket[count] = item;
            this.counts[index] = count + 1;
            return;
        }
        const key = this.key(cellX, cellY);
        let bucket = this.outside.get(key);
        if (!bucket) {
            bucket = [];
            this.outside.set(key, bucket);
        }
        if (bucket.length === 0) {
            this.usedOutside.push(bucket);
        }
        bucket.push(item);
    }

    // Calls back for everything in the cells overlapping the circle, cell by
    // cell (rows from the south, each from the west) and in the order they
    // went in; callers check the exact distance themselves.
    query(x: number, y: number, radius: number, callback: (item: T) => void): void {
        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minY = Math.floor((y - radius) / this.cellSize);
        const maxY = Math.floor((y + radius) / this.cellSize);
        for (let cellY = minY; cellY <= maxY; cellY++) {
            for (let cellX = minX; cellX <= maxX; cellX++) {
                const index = this.index(cellX, cellY);
                if (index >= 0) {
                    const count = this.counts[index];
                    const bucket = this.buckets[index];
                    for (let i = 0; i < count; i++) {
                        callback(bucket![i]);
                    }
                    continue;
                }
                const bucket = this.outside.get(this.key(cellX, cellY));
                if (bucket) {
                    for (let i = 0; i < bucket.length; i++) {
                        callback(bucket[i]);
                    }
                }
            }
        }
    }
}
