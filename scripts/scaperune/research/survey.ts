// Every surface map square, one at a time: how steep the world is, how much of its height is
// the client's own noise, and which locs stand on steep ground, so a region's rock kit can be
// read off. Saves a summary.
//
//   npx tsx scripts/scaperune/research/survey.ts out.json
import fs from "node:fs";

import { BIOMES } from "../../../src/game/scaperune/biomes";
import { ByteBuffer } from "../../../src/rs/io/ByteBuffer";
import { bump, locLabel, openWorld, round, top } from "./lib";
import { Locs, prepare } from "./metrics";

const out = process.argv[2];
const w = openWorld();
const locs: Locs = w.loc;

// How many level 0 tiles keep a height of their own, as against the client's noise
function explicitHeights(data: Int8Array): number {
    const buffer = new ByteBuffer(data);
    let stored = 0;
    for (let level = 0; level < 4; level++) {
        for (let i = 0; i < 64 * 64; i++) {
            for (;;) {
                const v = buffer.readUnsignedShort();
                if (v === 0) break;
                if (v === 1) {
                    buffer.readUnsignedByte();
                    if (level === 0) stored++;
                    break;
                }
                if (v <= 49) buffer.readUnsignedShort();
            }
        }
    }
    return stored;
}

type Kind = {
    count: number;
    steep: number;
    blockedFloor: number;
    rotations: number[];
    squares: Map<string, number>;
    overlays: Map<number, number>;
};
const kinds = new Map<string, Kind>();
// Ground decoration by the floor it's on: what goes with what
const decorOnOverlay = new Map<number, Map<number, number>>();
const decorOnUnderlay = new Map<number, Map<number, number>>();
const tilesOnOverlay = new Map<number, number>();
const tilesOnUnderlay = new Map<number, number>();
const slopeHist = new Array(256).fill(0);
const walkHist = new Array(256).fill(0);
const squareRows: object[] = [];
let totalTiles = 0;
let storedHeights = 0;

for (let mapX = 17; mapX < 64; mapX++) {
    for (let mapY = 40; mapY < 64; mapY++) {
        const terrain = w.maps.getTerrainData(mapX, mapY);
        if (!terrain) continue;
        const stored = explicitHeights(terrain);
        const grid = w.rect(mapX * 64, mapY * 64, 64, 64);
        if (grid.locs.length < 20) continue;
        const p = prepare(grid, locs);
        let steepest = 0;
        let walkSteepest = 0;
        for (let i = 0; i < p.n; i++) {
            slopeHist[p.slope[i]]++;
            steepest = Math.max(steepest, p.slope[i]);
            if (p.walkable[i]) {
                walkHist[p.slope[i]]++;
                walkSteepest = Math.max(walkSteepest, p.slope[i]);
            }
        }
        totalTiles += p.n;
        storedHeights += stored;
        let range = [255, 0];
        for (const h of p.level0.heights) range = [Math.min(range[0], h), Math.max(range[1], h)];
        squareRows.push({
            x: mapX,
            y: mapY,
            stored,
            steepest,
            walkSteepest,
            range,
            locs: grid.locs.length,
        });
        for (let i = 0; i < p.n; i++) {
            if (p.level0.overlays[i]) bump(tilesOnOverlay, p.level0.overlays[i]);
            else if (p.level0.underlays[i]) bump(tilesOnUnderlay, p.level0.underlays[i]);
        }
        for (const loc of grid.locs) {
            if (loc.level !== 0) continue;
            if (loc.type === 22) {
                const at = loc.x + loc.y * p.sizeX;
                const floor = p.level0.overlays[at];
                const table = floor ? decorOnOverlay : decorOnUnderlay;
                const key = floor || p.level0.underlays[at];
                if (!table.has(key)) table.set(key, new Map());
                bump(table.get(key)!, loc.id);
            }
            const key = `${loc.id}:${loc.type}`;
            let kind = kinds.get(key);
            if (!kind) {
                kind = {
                    count: 0,
                    steep: 0,
                    blockedFloor: 0,
                    rotations: [0, 0, 0, 0],
                    squares: new Map(),
                    overlays: new Map(),
                };
                kinds.set(key, kind);
            }
            const i = loc.x + loc.y * p.sizeX;
            kind.count++;
            kind.rotations[loc.rotation]++;
            if (p.slope[i] >= 16) kind.steep++;
            if (p.level0.flags[i] & 1) kind.blockedFloor++;
            bump(kind.squares, `${mapX},${mapY}`);
            if (p.level0.overlays[i]) bump(kind.overlays, p.level0.overlays[i]);
        }
    }
}

const rock = [...kinds]
    .filter(([, k]) => k.steep >= 40 && k.steep / k.count >= 0.1)
    .sort((a, b) => b[1].steep - a[1].steep)
    .slice(0, 120)
    .map(([key, k]) => {
        const [id, type] = key.split(":").map(Number);
        const m = w.loc(id);
        return {
            key,
            name: locLabel(m),
            size: `${m.sizeX}x${m.sizeY}`,
            clip: m.clipType,
            contour: m.contoured,
            count: k.count,
            steep: k.steep,
            steepShare: round(k.steep / k.count),
            blockedFloorShare: round(k.blockedFloor / k.count),
            rotations: k.rotations,
            squares: top(k.squares, 3),
            overlays: top(k.overlays, 3),
            type,
        };
    });

const decorTable = (table: Map<number, Map<number, number>>, tiles: Map<number, number>) =>
    [...table]
        .map(([floor, ids]) => {
            const total = [...ids.values()].reduce((a, b) => a + b, 0);
            return {
                floor,
                tiles: tiles.get(floor) ?? 0,
                per100: round((100 * total) / Math.max(tiles.get(floor) ?? 1, 1), 0),
                top: top(ids, 6),
            };
        })
        .filter((row) => row.tiles >= 2000)
        .sort((a, b) => b.tiles - a.tiles)
        .slice(0, 40);

// Decoration a generator can use on a floor: contoured, not blocking, not animated
const kitFor = (
    table: Map<number, Map<number, number>>,
    tiles: Map<number, number>,
    floor: number,
) => {
    const ids = table.get(floor);
    const total = tiles.get(floor) ?? 0;
    if (!ids || total === 0) return { floor, tiles: total, per100: 0, kit: [] as number[] };
    const all = [...ids.values()].reduce((a, b) => a + b, 0);
    const kit = top(ids, 30)
        .filter(([id]) => {
            const m = w.loc(id);
            return m.contoured >= 0 && m.clipType !== 1 && m.seqId < 0 && m.hasModel;
        })
        .slice(0, 8)
        .map(([id]) => id);
    return { floor, tiles: total, per100: round((100 * all) / total, 0), kit };
};
const biomeKits = Object.fromEntries(
    Object.entries(BIOMES).map(([name, biome]) => [
        name,
        {
            ground: biome.ground.map((id) => kitFor(decorOnUnderlay, tilesOnUnderlay, id)),
            trail: kitFor(decorOnUnderlay, tilesOnUnderlay, biome.trail),
            shore: kitFor(decorOnUnderlay, tilesOnUnderlay, biome.shore),
            road: kitFor(decorOnOverlay, tilesOnOverlay, biome.road),
            rockGround: kitFor(decorOnUnderlay, tilesOnUnderlay, biome.rock.ground),
        },
    ]),
);
const rockOverlays = [83, 85, 2, 3, 99, 115, 132, 82, 102, 26, 106, 185, 14, 11].map((id) =>
    kitFor(decorOnOverlay, tilesOnOverlay, id),
);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const cumulative = (h: number[], limits: number[]) => {
    const total = sum(h);
    return Object.fromEntries(
        limits.map((l) => [l, round((100 * sum(h.slice(0, l + 1))) / total, 2)]),
    );
};
const steepestSquares = [...squareRows]
    .sort((a: any, b: any) => b.steepest - a.steepest)
    .slice(0, 12);
const walkSteepSquares = [...squareRows]
    .sort((a: any, b: any) => b.walkSteepest - a.walkSteepest)
    .slice(0, 12);
fs.writeFileSync(
    out,
    JSON.stringify({
        squares: squareRows.length,
        totalTiles,
        storedHeightsPct: round((100 * storedHeights) / totalTiles, 1),
        slopeCumulativePct: cumulative(
            slopeHist,
            [0, 2, 4, 8, 12, 16, 24, 32, 44, 64, 80, 100, 127],
        ),
        walkCumulativePct: cumulative(walkHist, [0, 2, 4, 8, 12, 16, 24, 32, 44, 64, 80, 100, 127]),
        slopeHist,
        walkHist,
        steepestSquares,
        walkSteepSquares,
        rock,
        biomeKits,
        rockOverlays,
        decorOnOverlay: decorTable(decorOnOverlay, tilesOnOverlay),
        decorOnUnderlay: decorTable(decorOnUnderlay, tilesOnUnderlay),
        allSquares: squareRows,
    }),
);
console.log(`${squareRows.length} squares`);
