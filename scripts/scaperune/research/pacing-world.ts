// Pacing at the scale of a region: chunks of 8 tiles over a block of map squares, one square
// loaded at a time. Settlements, the gaps between them, how far a road ever goes with nothing
// to look at.
//
//   npx tsx scripts/scaperune/research/pacing-world.ts out.json
import fs from "node:fs";

import { TILE_INSIDE } from "../../../src/game/scaperune/format";
import { openWorld, percentile, round } from "./lib";
import { Locs, prepare } from "./metrics";

const REGIONS: [string, number, number, number, number][] = [
    ["Kourend and Kebos", 19, 54, 29, 60],
    ["Varlamore", 20, 45, 28, 53],
    ["Misthalin and Asgarnia", 45, 49, 52, 54],
];
const CHUNK = 8;
const CHUNKS = 64 / CHUNK;
const out = process.argv[2];
const w = openWorld();
const locs: Locs = w.loc;
const results: Record<string, object> = {};

for (const [name, x0, y0, x1, y1] of REGIONS) {
    const cx = (x1 - x0 + 1) * CHUNKS;
    const cy = (y1 - y0 + 1) * CHUNKS;
    const n = cx * cy;
    const indoor = new Uint16Array(n);
    const icons = new Uint16Array(n);
    const objects = new Uint16Array(n);
    const road = new Uint16Array(n);
    const walk = new Uint16Array(n);
    const bigProps = new Uint16Array(n);
    const iconPoints: { x: number; y: number }[] = [];
    // What's on a screen, 27 by 16 tiles, with at least half of it walkable, anywhere at all
    const screens: number[] = [];
    let decorCount = 0;
    let tileCount = 0;
    for (let mapX = x0; mapX <= x1; mapX++) {
        for (let mapY = y0; mapY <= y1; mapY++) {
            const grid = w.rect(mapX * 64, mapY * 64, 64, 64);
            if (grid.locs.length === 0) continue;
            const p = prepare(grid, locs);
            const chunkAt = (x: number, y: number) =>
                Math.floor(((mapX - x0) * 64 + x) / CHUNK) +
                Math.floor(((mapY - y0) * 64 + y) / CHUNK) * cx;
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const i = x + y * 64;
                    const c = chunkAt(x, y);
                    if (p.level0.flags[i] & TILE_INSIDE) indoor[c]++;
                    if (p.walkable[i]) {
                        walk[c]++;
                        if (p.level0.overlays[i]) road[c]++;
                    }
                }
            }
            const standing = new Uint16Array(64 * 64);
            tileCount += 64 * 64;
            for (const loc of grid.locs) {
                if (loc.level !== 0) continue;
                const m = locs(loc.id);
                const c = chunkAt(loc.x, loc.y);
                if (loc.type === 22) decorCount++;
                else standing[loc.x + loc.y * 64]++;
                if (loc.type !== 22) objects[c]++;
                if (m.mapFunctionId >= 0) {
                    icons[c]++;
                    iconPoints.push({ x: (mapX - x0) * 64 + loc.x, y: (mapY - y0) * 64 + loc.y });
                }
                if (
                    (loc.type === 10 || loc.type === 11) &&
                    Math.max(m.sizeX, m.sizeY) >= 2 &&
                    m.name !== "null"
                )
                    bigProps[c]++;
            }
            for (let sy = 0; sy + 16 <= 64; sy += 8) {
                for (let sx = 0; sx + 27 <= 64; sx += 12) {
                    let open = 0;
                    let count = 0;
                    for (let ty = sy; ty < sy + 16; ty++) {
                        for (let tx = sx; tx < sx + 27; tx++) {
                            open += p.walkable[tx + ty * 64];
                            count += standing[tx + ty * 64];
                        }
                    }
                    if (open >= 216) screens.push(count);
                }
            }
        }
    }
    // Settlements: pieces of chunks with buildings in them, joined across a gap of a chunk
    const label = new Int32Array(n);
    const settlements: { chunks: number; indoor: number; x: number; y: number }[] = [];
    for (let start = 0; start < n; start++) {
        if (label[start] || indoor[start] < 10) continue;
        const id = settlements.length + 1;
        const s = { chunks: 0, indoor: 0, x: 0, y: 0 };
        const queue = [start];
        label[start] = id;
        while (queue.length > 0) {
            const c = queue.pop()!;
            const x = c % cx;
            const y = (c / cx) | 0;
            s.chunks++;
            s.indoor += indoor[c];
            s.x += x;
            s.y += y;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const tx = x + dx;
                    const ty = y + dy;
                    if (tx < 0 || ty < 0 || tx >= cx || ty >= cy) continue;
                    const j = tx + ty * cx;
                    if (!label[j] && indoor[j] >= 10) {
                        label[j] = id;
                        queue.push(j);
                    }
                }
            }
        }
        s.x = ((s.x / s.chunks + 0.5) * CHUNK + x0 * 64) | 0;
        s.y = ((s.y / s.chunks + 0.5) * CHUNK + y0 * 64) | 0;
        settlements.push(s);
    }
    const gaps = settlements
        .map((a) => {
            let best = 1e9;
            for (const b of settlements) {
                if (a !== b) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
            }
            return best;
        })
        .sort((a, b) => a - b);
    const iconGaps = iconPoints
        .map((a) => {
            let best = 1e9;
            for (const b of iconPoints) {
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > 4) best = Math.min(best, d);
            }
            return best;
        })
        .sort((a, b) => a - b);
    // From each chunk with road in it, how far to the nearest chunk with something to see
    const interesting = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
        if (indoor[c] >= 4 || icons[c] > 0 || bigProps[c] >= 2) interesting[c] = 1;
    }
    const dull: number[] = [];
    for (let c = 0; c < n; c++) {
        if (road[c] < 6) continue;
        const x = c % cx;
        const y = (c / cx) | 0;
        let best = 99;
        for (let r = 0; r < 16 && best === 99; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    const tx = x + dx;
                    const ty = y + dy;
                    if (tx < 0 || ty < 0 || tx >= cx || ty >= cy) continue;
                    if (interesting[tx + ty * cx]) best = Math.min(best, r);
                }
            }
        }
        dull.push(best * CHUNK);
    }
    dull.sort((a, b) => a - b);
    let walkChunks = 0;
    let builtChunks = 0;
    let emptyWalk = 0;
    for (let c = 0; c < n; c++) {
        if (walk[c] >= 32) {
            walkChunks++;
            if (indoor[c] >= 4) builtChunks++;
            if (objects[c] < 2) emptyWalk++;
        }
    }
    screens.sort((a, b) => a - b);
    const sizes = settlements.map((s) => s.indoor).sort((a, b) => a - b);
    results[name] = {
        squares: (x1 - x0 + 1) * (y1 - y0 + 1),
        screens: screens.length,
        objectsOnScreen: [
            percentile(screens, 0.1),
            percentile(screens, 0.25),
            percentile(screens, 0.5),
            percentile(screens, 0.9),
        ],
        emptyScreensPct: round(
            (100 * screens.filter((c) => c < 8).length) / Math.max(screens.length, 1),
            1,
        ),
        decorPer100: round((100 * decorCount) / Math.max(tileCount, 1), 1),
        settlements: settlements.length,
        settlementIndoorQ: [
            percentile(sizes, 0.25),
            percentile(sizes, 0.5),
            percentile(sizes, 0.75),
            sizes[sizes.length - 1] ?? 0,
        ],
        settlementGapQ: [
            round(percentile(gaps, 0.25), 0),
            round(percentile(gaps, 0.5), 0),
            round(percentile(gaps, 0.75), 0),
        ],
        list: settlements.filter((s) => s.indoor > 120).map((s) => `${s.x},${s.y}:${s.indoor}`),
        iconCount: iconPoints.length,
        iconGapQ: [
            round(percentile(iconGaps, 0.25), 0),
            round(percentile(iconGaps, 0.5), 0),
            round(percentile(iconGaps, 0.75), 0),
            round(percentile(iconGaps, 0.95), 0),
        ],
        roadChunks: dull.length,
        roadToInterestQ: [
            percentile(dull, 0.5),
            percentile(dull, 0.9),
            percentile(dull, 0.99),
            dull[dull.length - 1] ?? 0,
        ],
        builtChunkPct: round((100 * builtChunks) / Math.max(walkChunks, 1), 1),
        emptyChunkPct: round((100 * emptyWalk) / Math.max(walkChunks, 1), 1),
    };
    console.log(name, JSON.stringify(results[name]));
}
fs.writeFileSync(out, JSON.stringify(results));
