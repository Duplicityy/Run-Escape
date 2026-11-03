// Lists what a real map square is made of, level by level: its locs (by id:type, with names and sizes),
// its underlays and overlays. WHERE=id,id prints every position of those ids.
//   npx tsx scripts/cache/dump-square.ts 60,155 59,152
import { createTileGrid, readLocs, readTerrain } from "../../src/game/scaperune/format";
import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { loadGameCache } from "./scene-util";

const cache = loadGameCache();
const factory = getCacheLoaderFactory(cache.info, CacheSystem.fromFiles(cache.type, cache.files));
const maps = factory.getMapFileLoader();
const locTypes = factory.getLocTypeLoader();
const where = new Set((process.env.WHERE ?? "").split(",").filter(Boolean).map(Number));

for (const arg of process.argv.slice(2)) {
    const [mapX, mapY] = arg.split(",").map(Number);
    const terrain = maps.getTerrainData(mapX, mapY);
    const locData = maps.getLocData(mapX, mapY, cache.xteas);
    console.log(
        `\n=== square ${mapX},${mapY} (world ${mapX * 64},${mapY * 64}) terrain ${!!terrain} locs ${!!locData}`,
    );
    if (!terrain) continue;
    const grid = createTileGrid(64, 64);
    readTerrain(terrain, mapX, mapY, grid, 0, 0);
    if (locData) readLocs(locData, grid, 0, 0);
    const count = (arr: ArrayLike<number>) => {
        const out: Record<number, number> = {};
        for (let i = 0; i < arr.length; i++) if (arr[i]) out[arr[i]] = (out[arr[i]] ?? 0) + 1;
        return Object.entries(out)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}x${v}`)
            .join(" ");
    };
    for (let level = 0; level < grid.levels.length; level++) {
        const lv = grid.levels[level];
        const locs = new Map<string, { n: number; xs: number[]; ys: number[]; rots: number[] }>();
        for (const loc of grid.locs) {
            if (loc.level !== level) continue;
            const key = `${loc.id}:${loc.type}`;
            const e = locs.get(key) ?? { n: 0, xs: [], ys: [], rots: [] };
            e.n++;
            e.xs.push(loc.x);
            e.ys.push(loc.y);
            e.rots.push(loc.rotation);
            locs.set(key, e);
        }
        const under = count(lv.underlays);
        const over = count(lv.overlays);
        if (!locs.size && !under && !over) continue;
        let hmin = Infinity,
            hmax = -Infinity;
        for (const h of lv.heights) {
            hmin = Math.min(hmin, h);
            hmax = Math.max(hmax, h);
        }
        console.log(
            `-- level ${level}: underlays ${under} | overlays ${over} | heights ${hmin}..${hmax}`,
        );
        for (const [key, e] of [...locs].sort((a, b) => b[1].n - a[1].n)) {
            const [id] = key.split(":").map(Number);
            const def = locTypes.load(id);
            const at =
                e.n <= 6 || where.has(id)
                    ? " at " + e.xs.map((x, i) => `${x},${e.ys[i]}r${e.rots[i]}`).join(" ")
                    : "";
            console.log(
                `${key.padEnd(10)} x${String(e.n).padStart(3)}  ${(def.name ?? "null").padEnd(26)} ${def.sizeX}x${def.sizeY} clip${def.clipType} seq${def.seqId}${at}`,
            );
        }
    }
}
