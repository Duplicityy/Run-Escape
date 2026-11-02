// Locs that draw nothing, by type, and how much of the surface uses them. The real world seals
// edges with these: they're walls with an empty model.
//
//   npx tsx scripts/scaperune/research/invisible.ts world.json
import fs from "node:fs";

import { openWorld } from "./lib";

type Square = { x: number; y: number; locs: Record<string, number> };
const world = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as { squares: Square[] };
const w = openWorld();
const models = w.factory.getModelLoader();
const counts = new Map<string, { n: number; top: Map<string, number> }>();
const empty = new Map<string, boolean>();
const isEmpty = (id: number, locType: number) => {
    const key = `${id}:${locType}`;
    if (!empty.has(key)) {
        const type = w.locTypes.load(id);
        let result = false;
        if (type.types && type.models) {
            const at = type.types.indexOf(locType);
            if (at >= 0) {
                result = type.models[at].every((m) => (models.getModel(m)?.faceCount ?? 0) === 0);
            }
        }
        empty.set(key, result);
    }
    return empty.get(key)!;
};
let totalWalls = 0;
let invisibleWalls = 0;
for (const square of world.squares) {
    if (square.y >= 64 || square.x < 17) continue;
    for (const [key, count] of Object.entries(square.locs)) {
        const [id, type] = key.split(":").map(Number);
        if (type > 3 && type !== 9) continue;
        totalWalls += count;
        if (isEmpty(id, type)) {
            invisibleWalls += count;
            const c = counts.get(key) ?? { n: 0, top: new Map() };
            c.n += count;
            const name = `${square.x},${square.y}`;
            c.top.set(name, (c.top.get(name) ?? 0) + count);
            counts.set(key, c);
        }
    }
}
console.log(`walls ${totalWalls}, drawing nothing ${invisibleWalls}`);
for (const [key, c] of [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, 24)) {
    const clip = w.loc(Number(key.split(":")[0])).clipType;
    console.log(
        key,
        "clip",
        clip,
        c.n,
        [...c.top]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .join(" "),
    );
}
