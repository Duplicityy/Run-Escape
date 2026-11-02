// Where a loc really stands: every place in the given map squares, with the ground under it
// and what's round it.
//
//   npx tsx scripts/scaperune/research/where.ts mapX,mapY id id id ...
import { bump, locLabel, openWorld, top } from "./lib";

const [square, ...ids] = process.argv.slice(2);
const [mapX, mapY] = square.split(",").map(Number);
const w = openWorld();
const wanted = new Set(ids.map(Number));
const m = 32;
const grid = w.rect(mapX * 64 - m, mapY * 64 - m, 64 + m * 2, 64 + m * 2);
const corners = grid.sizeX + 1;
for (const loc of grid.locs) {
    if (!wanted.has(loc.id)) continue;
    const meta = w.loc(loc.id);
    const around = new Map<string, number>();
    for (const other of grid.locs) {
        if (other !== loc && Math.max(Math.abs(other.x - loc.x), Math.abs(other.y - loc.y)) <= 9) {
            bump(around, `${locLabel(w.loc(other.id))}:${other.id}:t${other.type}`);
        }
    }
    const i = loc.x + loc.y * grid.sizeX;
    console.log(
        `${loc.id} ${meta.name} t${loc.type} r${loc.rotation} level ${loc.level} at ${mapX * 64 - m + loc.x},${mapY * 64 - m + loc.y}` +
            ` h ${grid.levels[0].heights[loc.x + loc.y * corners]} overlay ${grid.levels[0].overlays[i]} flag ${grid.levels[0].flags[i]}`,
    );
    console.log("   round it:", JSON.stringify(top(around, 12)));
}
