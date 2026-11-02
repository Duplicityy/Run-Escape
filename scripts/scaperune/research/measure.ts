// Measures the real places in areas.ts and made maps the same way, and saves a summary.
//
//   DEV_MAPS=1 npx tsx scripts/scaperune/research/measure.ts out.json              # all of it
//   npx tsx scripts/scaperune/research/measure.ts out.json real                    # real places
//   DEV_MAPS=1 npx tsx scripts/scaperune/research/measure.ts out.json scaperune_ysmar halloween
import fs from "node:fs";

import { TileGrid } from "../../../src/game/scaperune/format";
import { SCAPERUNE_DEV_MAPS } from "../../../src/game/scaperune/maps/devMaps";
import { SCAPERUNE_MAPS } from "../../../src/game/scaperune/maps/shippedMaps";
import { createBuildContext } from "../../../src/game/scaperune/squares";
import { AREAS } from "./areas";
import { cropGrid, openWorld, round, top } from "./lib";
import {
    addCooccurrence,
    measureAprons,
    measureDecor,
    measureEnclosures,
    measureFaces,
    measureFronts,
    measureGround,
    measureHeight,
    measureObjects,
    measurePacing,
    measurePlazas,
    measureRims,
    measureRings,
    measureShore,
    measureSightLines,
    measureTowns,
    measureUnderlays,
    prepare,
} from "./metrics";

const [out, ...wanted] = process.argv.slice(2);
const w = openWorld();
const results: Record<string, object> = {};
const pairs = new Map<string, number>();
const singles = new Map<string, number>();

// Water's the overlays with a water texture, or water's blue. Ids here are as stored: the
// cache's id plus one.
const waterKinds = new Map<number, boolean>();
const isWater = (id: number): boolean => {
    if (!waterKinds.has(id)) {
        const type = w.overlays.load(id - 1);
        waterKinds.set(id, [1, 24, 25].includes(type.textureId) || [6, 7, 442].includes(id));
    }
    return waterKinds.get(id)!;
};

function measure(name: string, kind: string, grid: TileGrid, cooccur: boolean): void {
    const start = Date.now();
    const p = prepare(grid, w.loc);
    const entry = {
        kind,
        size: [grid.sizeX, grid.sizeY],
        height: measureHeight(p),
        ground: measureGround(p),
        objects: measureObjects(p),
        towns: measureTowns(p),
        pacing: measurePacing(p),
        faces: measureFaces(p),
        enclosures: measureEnclosures(p),
        rings: measureRings(p),
        decor: measureDecor(p),
        underlays: measureUnderlays(p),
        shore: measureShore(p, isWater),
        plazas: measurePlazas(p),
        fronts: measureFronts(p),
        sight: measureSightLines(p),
        aprons: measureAprons(p),
        rims: measureRims(p),
    };
    if (cooccur) {
        addCooccurrence(p, pairs, singles);
    }
    results[name] = entry;
    console.log(`${name}: ${Date.now() - start} ms`);
}

const real = wanted.length === 0 || wanted.includes("real");
if (real) {
    for (const area of AREAS) {
        measure(area.name, area.kind, w.rect(...area.rect), true);
    }
    const total = [...singles.values()].reduce((a, b) => a + b, 0);
    const lifts = [...pairs]
        .filter(([, n]) => n >= 6)
        .map(([key, n]) => {
            const [a, b] = key.split("|");
            const lift = (n * total) / (singles.get(a)! * singles.get(b)!);
            return { a, b, n, lift: round(lift, 1) };
        })
        .sort((x, y) => y.n - x.n);
    results["cooccurrence"] = { total, pairs: lifts.slice(0, 80), singles: top(singles, 60) };
}
const context = createBuildContext(w.maps, w.locTypes);
for (const recipe of [...SCAPERUNE_MAPS, ...SCAPERUNE_DEV_MAPS]) {
    if (wanted.includes(recipe.id) || wanted.length === 0) {
        const grid = recipe.build(context);
        const m = recipe.margin * 64;
        const arena = cropGrid(grid, m, m, grid.sizeX - m * 2, grid.sizeY - m * 2);
        measure(recipe.id, "made", arena, false);
    }
}
fs.writeFileSync(out, JSON.stringify(results));
