import { describe, expect, it } from "vitest";

import { MAP_SQUARE_SIZE, TILE_BLOCKED, createTileGrid, writeLocs, writeTerrain } from "../format";
import { LOC_FLOOR_DECORATION } from "../mapBuild";
import { BuildContext, getRecipeArena } from "../recipe";
import {
    BONES,
    CANDLES,
    INQUISITORS_BOSS_ARENA,
    INQUISITORS_FIELD,
    LANTERNS,
    LONG_BONES,
    SCRUB,
    SOLID_LOCS,
} from "./inquisitorsField";

// The field builds without the cache: a loc's size and whether it blocks are all the build
// asks, and the recipe says which of its own block. Anything else is as the worst a loc could be.
const sizes = new Map(SOLID_LOCS.map(([id, sizeX, sizeY]) => [id, { sizeX, sizeY }]));
const walkThrough = new Set([...BONES, ...LONG_BONES, ...CANDLES, ...SCRUB, ...LANTERNS]);
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

describe("the Inquisitor's Field", () => {
    const map = INQUISITORS_FIELD.detail!(context);
    const size = INQUISITORS_FIELD.squaresX * MAP_SQUARE_SIZE;
    const { flags } = map.grid.levels[0];
    const arenaMin = INQUISITORS_FIELD.margin * MAP_SQUARE_SIZE;
    const arenaMax = size - arenaMin - 1;

    it("keeps her square clear of anything solid, and flat", () => {
        const { heights } = map.grid.levels[0];
        const corners = size + 1;
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
            for (let y = loc.y; y < loc.y + info.sizeY; y++) {
                for (let x = loc.x; x < loc.x + info.sizeX; x++) {
                    const onArena =
                        x >= arenaMin && x <= arenaMax && y >= arenaMin && y <= arenaMax;
                    expect(onArena, `loc ${loc.id} at ${x},${y}`).toBe(false);
                }
            }
        }
    });

    it("has the cave's walls round the field, and the way in through the south one", () => {
        const { heights } = map.grid.levels[0];
        const corners = size + 1;
        const floor = heights[arenaMin + arenaMin * corners];
        // High at the grid's edge, all round
        expect(heights[2 + 2 * corners]).toBeGreaterThan(floor + 60);
        expect(heights[size - 2 + (size - 2) * corners]).toBeGreaterThan(floor + 60);
        expect(heights[size / 2 + 2 * corners]).toBe(floor);
        expect(flags[size / 2 + 2 * size] & TILE_BLOCKED).toBe(0);
        // And walked through on the way to the spawn: the road's a floor of its own
        const road = map.grid.levels[0].overlays[size / 2 + 10 * size];
        expect(road).not.toBe(0);
    });

    it("stands where the map says, with her square the whole arena", () => {
        const arena = getRecipeArena(INQUISITORS_FIELD);
        expect(arena).toEqual({ baseX: 79 * 64, baseY: 73 * 64, sizeX: 64, sizeY: 64 });
        expect(INQUISITORS_BOSS_ARENA).toEqual({ baseX: 79 * 64, baseY: 73 * 64, size: 64 });
        const { spawn } = INQUISITORS_FIELD;
        expect(spawn.x).toBeGreaterThanOrEqual(arenaMin);
        expect(spawn.x).toBeLessThanOrEqual(arenaMax);
        expect(spawn.y).toBeGreaterThanOrEqual(arenaMin);
        expect(spawn.y).toBeLessThanOrEqual(arenaMax);
    });

    it("has the battlefield round the square, and the same one every time", () => {
        const solid = map.grid.locs.filter((loc) => context.locs(loc.id).clipType !== 0);
        expect(solid.length).toBeGreaterThan(60);
        const dressed = map.grid.locs.filter((loc) => context.locs(loc.id).clipType === 0);
        expect(dressed.length).toBeGreaterThan(200);
        const again = INQUISITORS_FIELD.build(context);
        expect(writeLocs(again, 0, 0)).toEqual(writeLocs(map.grid, 0, 0));
        expect(writeTerrain(again, 0, 0)).toEqual(writeTerrain(map.grid, 0, 0));
    });
});
