// Which locs each benchmark map uses, and how the real world uses each: how often, as which
// type, where. Finds what reads wrong: locs from instances, locs put down as the wrong type,
// locs with no surface use at all.
//
//   DEV_MAPS=1 npx tsx scripts/scaperune/research/audit-locs.ts world.json [maps]
import fs from "node:fs";

import { SCAPERUNE_DEV_MAPS } from "../../../src/game/scaperune/maps/devMaps";
import { SCAPERUNE_MAPS } from "../../../src/game/scaperune/maps/shippedMaps";
import { createBuildContext } from "../../../src/game/scaperune/squares";
import { locLabel, openWorld, round } from "./lib";

type Square = { x: number; y: number; locs: Record<string, number> };
const world = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as { squares: Square[] };
const wanted = (process.argv[3] ?? "scaperune_vardhelm,scaperune_kalua,scaperune_ysmar").split(",");

// The surface is map squares under y 64. Everything else (dungeons, instances, raids) is
// up in the high squares
const SURFACE_Y = 64;
const uses = new Map<number, { byType: Map<number, number>; squares: Map<string, number> }>();
for (const square of world.squares) {
    for (const [key, count] of Object.entries(square.locs)) {
        const [id, type] = key.split(":").map(Number);
        let use = uses.get(id);
        if (!use) {
            use = { byType: new Map(), squares: new Map() };
            uses.set(id, use);
        }
        use.byType.set(type, (use.byType.get(type) ?? 0) + count);
        const name = `${square.x},${square.y}`;
        use.squares.set(name, (use.squares.get(name) ?? 0) + count);
    }
}

const w = openWorld();
const context = createBuildContext(w.maps, w.locTypes);
const out: Record<string, object> = {};
for (const id of wanted) {
    const recipe = [...SCAPERUNE_MAPS, ...SCAPERUNE_DEV_MAPS].find((map) => map.id === id);
    if (!recipe) {
        console.log(`no map ${id}`);
        continue;
    }
    const grid = recipe.build(context);
    const counts = new Map<string, number>();
    for (const loc of grid.locs) {
        if (loc.level === 0) {
            const key = `${loc.id}:${loc.type}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    const rows = [];
    for (const [key, count] of counts) {
        const [locId, type] = key.split(":").map(Number);
        const use = uses.get(locId);
        const meta = w.loc(locId);
        const total = use ? [...use.squares.values()].reduce((a, b) => a + b, 0) : 0;
        let surface = 0;
        if (use) {
            for (const [name, n] of use.squares) {
                if (Number(name.split(",")[1]) < SURFACE_Y) {
                    surface += n;
                }
            }
        }
        const typedAs = use?.byType.get(type) ?? 0;
        const realTypes = use ? [...use.byType].sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
        const where = use ? [...use.squares].sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
        rows.push({
            id: locId,
            name: locLabel(meta),
            type,
            count,
            size: `${meta.sizeX}x${meta.sizeY}`,
            clip: meta.clipType,
            seq: meta.seqId,
            contour: meta.contoured,
            actions: meta.actions.join("|"),
            worldTotal: total,
            surfaceShare: total ? round(surface / total) : 0,
            sameTypeShare: total ? round(typedAs / total) : 0,
            realTypes,
            where,
        });
    }
    rows.sort((a, b) => a.surfaceShare - b.surfaceShare || b.count - a.count);
    const suspect = rows.filter(
        (r) =>
            r.worldTotal === 0 ||
            r.surfaceShare < 0.5 ||
            r.sameTypeShare < 0.1 ||
            r.seq !== -1 ||
            r.actions !== "",
    );
    out[id] = { kinds: rows.length, locs: grid.locs.length, suspect };
    console.log(`${id}: ${rows.length} kinds, ${grid.locs.length} locs, ${suspect.length} suspect`);
    for (const r of suspect.slice(0, 80)) {
        console.log(
            `  ${String(r.id).padStart(6)} ${r.name.slice(0, 24).padEnd(24)} t${r.type} x${r.count}` +
                ` ${r.size} clip${r.clip} seq${r.seq} world ${r.worldTotal} surf ${r.surfaceShare}` +
                ` sameType ${r.sameTypeShare} real ${JSON.stringify(r.realTypes)} at ${JSON.stringify(r.where)} ${r.actions}`,
        );
    }
}
fs.writeFileSync(process.argv[4] ?? "/dev/null", JSON.stringify(out));
