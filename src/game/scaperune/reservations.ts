// What's spoken for, tile by tile, and by what. A place is built in a strict order, and this is what
// keeps to it: each step asks before it takes ground, and nothing can take a tile from anything
// that came before it. If something doesn't fit it's left out. See "The flow" in the guide.

export const RESERVE_WALL = 1;

// A gate's kept-clear space
export const RESERVE_GATE = 2;

// A town's main streets and its square
export const RESERVE_STREET = 3;

// A building, its yard and its fence, as one block
export const RESERVE_PLOT = 4;

// Lanes, and all the other roads
export const RESERVE_LANE = 5;

// Set pieces, landmarks and ruins
export const RESERVE_PIECE = 6;

export class Reservations {
    // A tile's rank, the lower the earlier, or 0
    readonly ranks: Uint8Array;

    constructor(
        readonly sizeX: number,
        readonly sizeY: number,
        // Ground.reserved, which foliage and details ask through Ground.isClear
        readonly reserved: Uint8Array,
    ) {
        this.ranks = new Uint8Array(sizeX * sizeY);
    }

    private inside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.sizeX && y < this.sizeY;
    }

    // Whether nothing's on any of a rectangle of tiles
    isFree(x: number, y: number, sizeX: number, sizeY: number): boolean {
        for (let ty = y; ty < y + sizeY; ty++) {
            for (let tx = x; tx < x + sizeX; tx++) {
                if (!this.inside(tx, ty)) {
                    return false;
                }
                const i = tx + ty * this.sizeX;
                if (this.ranks[i] || this.reserved[i]) {
                    return false;
                }
            }
        }
        return true;
    }

    // Whether anything of a rank is within gap tiles of a rectangle
    hasNear(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        gap: number,
        rank: number,
    ): boolean {
        for (let ty = y - gap; ty < y + sizeY + gap; ty++) {
            for (let tx = x - gap; tx < x + sizeX + gap; tx++) {
                if (this.inside(tx, ty) && this.ranks[tx + ty * this.sizeX] === rank) {
                    return true;
                }
            }
        }
        return false;
    }

    // A tile's rank. The earliest stays, so that nothing later can take it, and the tile's left
    // reserved, so that foliage and details keep off.
    takeTile(i: number, rank: number): void {
        this.markTile(i, rank);
        this.reserved[i] = 1;
    }

    // The same without reserving it: what a road's painted edge reaches, which only matters to
    // what's built, not to what grows
    markTile(i: number, rank: number): void {
        if (this.ranks[i] === 0 || rank < this.ranks[i]) {
            this.ranks[i] = rank;
        }
    }

    take(x: number, y: number, sizeX: number, sizeY: number, rank: number): void {
        for (let ty = y; ty < y + sizeY; ty++) {
            for (let tx = x; tx < x + sizeX; tx++) {
                if (this.inside(tx, ty)) {
                    this.takeTile(tx + ty * this.sizeX, rank);
                }
            }
        }
    }
}
