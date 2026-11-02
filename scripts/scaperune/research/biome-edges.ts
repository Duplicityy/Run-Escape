// How one kind of ground gives way to another. Underlays go into broad colour classes; each
// tile's local class is the commonest in 15 by 15 tiles round it. Then: what's along the lines
// between classes, and how far from a line a tile's own colour stops matching its side's.
//
//   npx tsx scripts/scaperune/research/biome-edges.ts out.json
import fs from "node:fs";

import { TILE_BLOCKED, TILE_INSIDE } from "../../../src/game/scaperune/format";
import { getTileSlope } from "../../../src/game/scaperune/terrain";
import { openWorld, round } from "./lib";

const REGIONS: [string, number, number, number, number][] = [
    ["Kourend and Kebos", 1216, 3456, 704, 448],
    ["Varlamore", 1344, 2912, 448, 512],
];
const w = openWorld();
const classOf = new Map<number, number>();
const CLASSES = ["green", "yellow", "brown", "red", "grey", "white", "blue"];
function colourClass(id: number): number {
    if (!classOf.has(id)) {
        const rgb = (w.underlays.load(id - 1) as unknown as { rgbColor: number }).rgbColor;
        const r = (rgb >> 16) & 255;
        const g = (rgb >> 8) & 255;
        const b = rgb & 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const light = (max + min) / 2;
        const sat = max === 0 ? 0 : (max - min) / max;
        let hue = 0;
        if (max !== min) {
            if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
            else if (max === g) hue = (b - r) / (max - min) + 2;
            else hue = (r - g) / (max - min) + 4;
        }
        hue *= 60;
        let c: number;
        if (light > 200 && sat < 0.2) c = 5;
        else if (sat < 0.15) c = 4;
        else if (hue >= 200 && hue < 280) c = 6;
        else if (hue >= 75 && hue < 200) c = 0;
        else if (hue >= 45) c = 1;
        else if (hue >= 15) c = 2;
        else c = 3;
        classOf.set(id, c);
    }
    return classOf.get(id)!;
}
const out: Record<string, object> = {};
for (const [name, x0, y0, sizeX, sizeY] of REGIONS) {
    const grid = w.rect(x0, y0, sizeX, sizeY);
    const level = grid.levels[0];
    const n = sizeX * sizeY;
    const own = new Int8Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
        if (level.underlays[i]) own[i] = colourClass(level.underlays[i]);
    }
    // Local class, by running counts over rows of a summed table
    const R = 7;
    const local = new Int8Array(n).fill(-1);
    for (let y = R; y < sizeY - R; y += 1) {
        const counts = new Int32Array(CLASSES.length);
        for (let x = 0; x < sizeX; x++) {
            for (let dy = -R; dy <= R; dy++) {
                const a = own[x + R + (y + dy) * sizeX];
                if (x + R < sizeX && a >= 0) counts[a]++;
                const b = own[x - R - 1 + (y + dy) * sizeX];
                if (x - R - 1 >= 0 && b >= 0) counts[b]--;
            }
            if (x >= R && x < sizeX - R) {
                let best = -1;
                let most = 0;
                for (let c = 0; c < counts.length; c++) {
                    if (counts[c] > most) {
                        most = counts[c];
                        best = c;
                    }
                }
                local[x + y * sizeX] = best;
            }
        }
    }
    // Things that can carry an edge
    const feature = new Uint8Array(n);
    const cornersX = sizeX + 1;
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            if (
                level.overlays[i] ||
                level.flags[i] & (TILE_BLOCKED | TILE_INSIDE) ||
                getTileSlope(level.heights, cornersX, x, y) >= 12
            ) {
                feature[i] = 1;
            }
        }
    }
    const pairs = new Map<string, number>();
    const lines: number[] = [];
    for (let y = R; y < sizeY - R - 1; y++) {
        for (let x = R; x < sizeX - R - 1; x++) {
            const i = x + y * sizeX;
            const a = local[i];
            const b = local[i + 1];
            const c = local[i + sizeX];
            if (a < 0) continue;
            if ((b >= 0 && b !== a) || (c >= 0 && c !== a)) {
                lines.push(i);
                const other = b !== a ? b : c;
                const key = [CLASSES[Math.min(a, other)], CLASSES[Math.max(a, other)]].join("-");
                pairs.set(key, (pairs.get(key) ?? 0) + 1);
            }
        }
    }
    // Distance from a line, chessboard, capped
    const CAP = 16;
    const dist = new Uint8Array(n).fill(CAP);
    for (const i of lines) dist[i] = 0;
    for (let pass = 0; pass < CAP; pass++) {
        for (let y = 1; y < sizeY - 1; y++) {
            for (let x = 1; x < sizeX - 1; x++) {
                const i = x + y * sizeX;
                dist[i] = Math.min(
                    dist[i],
                    dist[i - 1] + 1,
                    dist[i + 1] + 1,
                    dist[i - sizeX] + 1,
                    dist[i + sizeX] + 1,
                );
            }
        }
    }
    const match = new Array(CAP + 1).fill(0);
    const total = new Array(CAP + 1).fill(0);
    for (let i = 0; i < n; i++) {
        if (own[i] >= 0 && local[i] >= 0) {
            total[dist[i]]++;
            if (own[i] === local[i]) match[dist[i]]++;
        }
    }
    // How much of a line has a feature within 2 tiles
    let carried = 0;
    for (const i of lines) {
        const x = i % sizeX;
        const y = (i / sizeX) | 0;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) {
            for (let dx = -2; dx <= 2 && !near; dx++) {
                if (feature[x + dx + (y + dy) * sizeX]) near = true;
            }
        }
        if (near) carried++;
    }
    let featureTiles = 0;
    for (let i = 0; i < n; i++) featureTiles += feature[i];
    out[name] = {
        lineTiles: lines.length,
        linesPer1000Tiles: round((1000 * lines.length) / n, 1),
        carriedByFeaturePct: round((100 * carried) / Math.max(lines.length, 1), 0),
        featureSharePct: round((100 * featureTiles) / n, 0),
        ownMatchesLocalPctByDistance: match.map((m, d) =>
            round((100 * m) / Math.max(total[d], 1), 0),
        ),
        pairs: [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
    console.log(name, JSON.stringify(out[name]));
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
