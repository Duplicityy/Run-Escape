// What the research scripts share: the cache's loaders, a rectangle of the real world as a
// TileGrid, and the same grid out of a ScapeRune recipe, so real and made maps go through
// one set of measurements. Run everything here through ~/tools/heavy.sh.
import {
    MAP_SQUARE_SIZE,
    TileGrid,
    createTileGrid,
    readLocs,
    readTerrain,
} from "../../../src/game/scaperune/format";
import { CacheSystem } from "../../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../../src/rs/cache/loader/CacheLoaderFactory";
import type { LocTypeLoader } from "../../../src/rs/config/loctype/LocTypeLoader";
import { loadGameCache } from "../../cache/scene-util";

export type LocMeta = {
    id: number;
    name: string;
    sizeX: number;
    sizeY: number;
    clipType: number;
    blocksProjectile: boolean;
    contoured: number;
    seqId: number;
    hasModel: boolean;
    actions: string[];
    mapSceneId: number;
    mapFunctionId: number;
    modelTypes: number[];
};

export type World = ReturnType<typeof openWorld>;

// What the measures need to know about a loc, kept as it's asked for
export function createLocs(locTypes: LocTypeLoader): (id: number) => LocMeta {
    const metas = new Map<number, LocMeta>();
    return (id) => {
        let meta = metas.get(id);
        if (!meta) {
            const type = locTypes.load(id);
            meta = {
                id,
                name: type.name ?? "null",
                sizeX: type.sizeX,
                sizeY: type.sizeY,
                clipType: type.clipType,
                blocksProjectile: type.blocksProjectile,
                contoured: type.contouredGround,
                seqId: type.seqId,
                hasModel: type.transforms !== undefined || (type.models?.length ?? 0) > 0,
                actions: (type.actions ?? []).filter(Boolean),
                mapSceneId: type.mapSceneId,
                mapFunctionId: type.mapFunctionId,
                modelTypes: type.types ?? [],
            };
            metas.set(id, meta);
        }
        return meta;
    };
}

export function openWorld() {
    const cache = loadGameCache();
    const factory = getCacheLoaderFactory(
        cache.info,
        CacheSystem.fromFiles(cache.type, cache.files),
    );
    const maps = factory.getMapFileLoader();
    const locTypes = factory.getLocTypeLoader();
    const underlays = factory.getUnderlayTypeLoader();
    const overlays = factory.getOverlayTypeLoader();
    const loc = createLocs(locTypes);
    // A rectangle of the world, in world tiles, with its corners and locs
    const rect = (x0: number, y0: number, sizeX: number, sizeY: number): TileGrid => {
        const grid = createTileGrid(sizeX, sizeY);
        const lastX = (x0 + sizeX) >> 6;
        const lastY = (y0 + sizeY) >> 6;
        for (let mapX = x0 >> 6; mapX <= lastX; mapX++) {
            for (let mapY = y0 >> 6; mapY <= lastY; mapY++) {
                const terrain = maps.getTerrainData(mapX, mapY);
                const locs = maps.getLocData(mapX, mapY, new Map());
                const offsetX = mapX * MAP_SQUARE_SIZE - x0;
                const offsetY = mapY * MAP_SQUARE_SIZE - y0;
                if (terrain) {
                    readTerrain(terrain, mapX, mapY, grid, offsetX, offsetY);
                }
                if (locs) {
                    readLocs(locs, grid, offsetX, offsetY);
                }
            }
        }
        return grid;
    };
    return { cache, factory, maps, locTypes, underlays, overlays, loc, rect };
}

// Part of a grid as a grid of its own: the arena of a made map, without its margin
export function cropGrid(
    grid: TileGrid,
    x0: number,
    y0: number,
    sizeX: number,
    sizeY: number,
): TileGrid {
    const out = createTileGrid(sizeX, sizeY);
    const corners = grid.sizeX + 1;
    grid.levels.forEach((from, level) => {
        const to = out.levels[level];
        for (let y = 0; y <= sizeY; y++) {
            for (let x = 0; x <= sizeX; x++) {
                to.heights[x + y * (sizeX + 1)] = from.heights[x0 + x + (y0 + y) * corners];
            }
        }
        for (let y = 0; y < sizeY; y++) {
            for (let x = 0; x < sizeX; x++) {
                const a = x + y * sizeX;
                const b = x0 + x + (y0 + y) * grid.sizeX;
                to.underlays[a] = from.underlays[b];
                to.overlays[a] = from.overlays[b];
                to.shapes[a] = from.shapes[b];
                to.rotations[a] = from.rotations[b];
                to.flags[a] = from.flags[b];
            }
        }
    });
    for (const loc of grid.locs) {
        const x = loc.x - x0;
        const y = loc.y - y0;
        if (x >= 0 && y >= 0 && x < sizeX && y < sizeY) {
            out.locs.push({ ...loc, x, y });
        }
    }
    return out;
}

// A name fit for tables: names are often null, so say which it was
export function locLabel(meta: LocMeta): string {
    return meta.name && meta.name !== "null" ? meta.name : `#${meta.id}`;
}

export function top<K>(counts: Map<K, number>, n: number): [K, number][] {
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function bump<K>(counts: Map<K, number>, key: K, by = 1): void {
    counts.set(key, (counts.get(key) ?? 0) + by);
}

export function percentile(sorted: ArrayLike<number>, p: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function round(v: number, places = 2): number {
    const scale = 10 ** places;
    return Math.round(v * scale) / scale;
}
