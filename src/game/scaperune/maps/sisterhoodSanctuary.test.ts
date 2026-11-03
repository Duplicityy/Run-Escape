import { describe, expect, it } from "vitest";

import { MAP_SQUARE_SIZE, TILE_BLOCKED, createTileGrid, writeLocs, writeTerrain } from "../format";
import { LOC_FLOOR_DECORATION, LOC_WALL } from "../mapBuild";
import { BuildContext, getRecipeArena } from "../recipe";
import {
    SANCTUARY_BOSS_ARENA,
    SISTERHOOD_SANCTUARY,
    SOLID_LOCS,
    WALK_THROUGH,
} from "./sisterhoodSanctuary";

// The Sanctuary builds without the cache: a loc's size and whether it blocks are all the build
// asks, and the recipe says which of its own block. Anything else is as the worst a loc could be.
const sizes = new Map(SOLID_LOCS.map(([id, sizeX, sizeY]) => [id, { sizeX, sizeY }]));
const walkThrough = new Set(WALK_THROUGH);
const emptySquare = (() => {
    const grid = createTileGrid(64, 64);
    return { terrain: writeTerrain(grid, 0, 0), locs: writeLocs(grid, 0, 0) };
})();
const context: BuildContext = {
    maps: { getTerrainData: () => emptySquare.terrain, getLocData: () => emptySquare.locs },
    locs: (id) => ({
        name: String(id),
        ...(sizes.get(id) ?? { sizeX: 1, sizeY: 1 }),
        clipType: walkThrough.has(id) ? 0 : 2,
        blocksProjectile: !walkThrough.has(id),
        drawn: true,
    }),
};

describe("the Sisterhood Sanctuary", () => {
    const map = SISTERHOOD_SANCTUARY.detail!(context);
    const size = SISTERHOOD_SANCTUARY.squaresX * MAP_SQUARE_SIZE;
    const { flags, heights } = map.grid.levels[0];
    const corners = size + 1;
    const arenaMin = SISTERHOOD_SANCTUARY.margin * MAP_SQUARE_SIZE;
    const arenaMax = size - arenaMin - 1;
    const middle = (arenaMin + arenaMax + 1) / 2;
    const onArena = (x: number, y: number) =>
        x >= arenaMin && x <= arenaMax && y >= arenaMin && y <= arenaMax;

    it("keeps her square clear of anything solid, and flat", () => {
        for (let y = arenaMin; y <= arenaMax; y++) {
            for (let x = arenaMin; x <= arenaMax; x++) {
                expect(flags[x + y * size] & TILE_BLOCKED, `${x},${y}`).toBe(0);
                expect(heights[x + y * corners]).toBe(heights[arenaMin + arenaMin * corners]);
            }
        }
        for (const loc of map.grid.locs) {
            const info = context.locs(loc.id);
            // Floor decoration is the dressing's pebbles and grass, which never block
            if (info.clipType === 0 || loc.type === LOC_FLOOR_DECORATION) {
                continue;
            }
            // A turned loc's footprint turns with it
            const across = loc.rotation & 1 ? info.sizeY : info.sizeX;
            const deep = loc.rotation & 1 ? info.sizeX : info.sizeY;
            for (let y = loc.y; y < loc.y + deep; y++) {
                for (let x = loc.x; x < loc.x + across; x++) {
                    expect(onArena(x, y), `loc ${loc.id} at ${x},${y}`).toBe(false);
                }
            }
        }
    });

    it("seals the chamber round her square, under the cave's roof", () => {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (!onArena(x, y)) {
                    expect(flags[x + y * size] & TILE_BLOCKED, `${x},${y}`).toBe(TILE_BLOCKED);
                }
            }
        }
        const floor = heights[arenaMin + arenaMin * corners];
        // Flat across the chamber, high at the grid's edge, all round
        expect(heights[arenaMin - 8 + (arenaMin - 8) * corners]).toBe(floor);
        expect(heights[2 + 2 * corners]).toBeGreaterThan(floor + 60);
        expect(heights[size - 2 + (size - 2) * corners]).toBeGreaterThan(floor + 60);
        expect(heights[size / 2 + 2 * corners]).toBeGreaterThan(floor + 60);
    });

    it("walls her square round, with a gate north and south", () => {
        const onRing = (loc: { x: number; y: number }) =>
            loc.x >= arenaMin - 1 &&
            loc.x <= arenaMax + 1 &&
            loc.y >= arenaMin - 1 &&
            loc.y <= arenaMax + 1 &&
            (loc.x === arenaMin - 1 ||
                loc.x === arenaMax + 1 ||
                loc.y === arenaMin - 1 ||
                loc.y === arenaMax + 1);
        const ring = map.grid.locs.filter((loc) => loc.type === LOC_WALL && onRing(loc));
        // A wall on every tile of the ring but the five of each gate
        expect(ring.length).toBe(64 * 4 - 5 * 2);
        for (const y of [arenaMin - 1, arenaMax + 1]) {
            for (let x = middle - 2; x <= middle + 2; x++) {
                expect(
                    ring.some((loc) => loc.x === x && loc.y === y),
                    `${x},${y}`,
                ).toBe(false);
            }
        }
        // And the chamber has a wall of its own all round, further out
        const walls = map.grid.locs.filter((loc) => loc.type === LOC_WALL && !onRing(loc));
        expect(walls.length).toBeGreaterThan(300);
    });

    it("has the gates, and what stands beyond each of them", () => {
        const count = (id: number) => map.grid.locs.filter((loc) => loc.id === id).length;
        // The barriers, north and south, and the pilasters at the gates and the corners
        expect(count(37730)).toBe(2);
        expect(count(37783) + count(37784)).toBeGreaterThanOrEqual(8 + 16);
        // The Theatre's dead over the chamber's ground, and the dream's sleepers over it
        expect(count(32735) + count(32741) + count(32742) + count(32754)).toBeGreaterThanOrEqual(
            20,
        );
        expect(count(32743)).toBeGreaterThanOrEqual(3);
        const sleepers = [37732, 37733, 37734, 37735, 37736, 37737].reduce(
            (sum, id) => sum + count(id),
            0,
        );
        expect(sleepers).toBeGreaterThanOrEqual(12);
        // The Pool of Nightmares and Phosani's coffin beyond the north gate, the scythe
        // statues and the stairs beyond the south one
        expect(count(37825)).toBe(1);
        expect(count(37951)).toBe(1);
        expect(count(37818)).toBe(1);
        expect(count(37819)).toBe(1);
        expect(count(37832)).toBe(1);
    });

    it("stands where the map says, with her square the whole arena", () => {
        const arena = getRecipeArena(SISTERHOOD_SANCTUARY);
        expect(arena).toEqual({ baseX: 79 * 64, baseY: 73 * 64, sizeX: 64, sizeY: 64 });
        expect(SANCTUARY_BOSS_ARENA).toEqual({ baseX: 79 * 64, baseY: 73 * 64, size: 64 });
        const { spawn } = SISTERHOOD_SANCTUARY;
        expect(onArena(spawn.x, spawn.y)).toBe(true);
    });

    it("has the chamber dressed round the square, and the same one every time", () => {
        const solid = map.grid.locs.filter((loc) => context.locs(loc.id).clipType !== 0);
        expect(solid.length).toBeGreaterThan(200);
        const dressed = map.grid.locs.filter((loc) => context.locs(loc.id).clipType === 0);
        expect(dressed.length).toBeGreaterThan(600);
        const again = SISTERHOOD_SANCTUARY.build(context);
        expect(writeLocs(again, 0, 0)).toEqual(writeLocs(map.grid, 0, 0));
        expect(writeTerrain(again, 0, 0)).toEqual(writeTerrain(map.grid, 0, 0));
    });
});
