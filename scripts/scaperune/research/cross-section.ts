// Text picture of a rectangle of the world: each tile's slope, floor and what stands on it, so
// a cliff's make-up can be read without a browser. Plus a column of heights down its middle.
//
//   npx tsx scripts/scaperune/research/cross-section.ts x y sizeX sizeY
//   npx tsx scripts/scaperune/research/cross-section.ts id@mapX,mapY sizeX sizeY    # the part of
//                                                       a square with the most of that loc
import { openWorld } from "./lib";

const w = openWorld();
const args = process.argv.slice(2);
let x0: number, y0: number, sizeX: number, sizeY: number;
if (args[0].includes("@")) {
    const [id, square] = args[0].split("@");
    const [mapX, mapY] = square.split(",").map(Number);
    sizeX = Number(args[1]);
    sizeY = Number(args[2]);
    const all = w.rect(mapX * 64, mapY * 64, 64, 64);
    const spots = all.locs.filter((l) => l.id === Number(id));
    let best = -1;
    x0 = mapX * 64;
    y0 = mapY * 64;
    for (const s of spots) {
        const n = spots.filter(
            (o) =>
                o.x >= s.x - 8 && o.x < s.x - 8 + sizeX && o.y >= s.y - 5 && o.y < s.y - 5 + sizeY,
        ).length;
        if (n > best) {
            best = n;
            x0 = mapX * 64 + s.x - 8;
            y0 = mapY * 64 + s.y - 5;
        }
    }
} else {
    [x0, y0, sizeX, sizeY] = args.map(Number);
}
const grid = w.rect(x0, y0, sizeX, sizeY);
const level = grid.levels[0];
const corners = sizeX + 1;
const cell = new Map<number, string>();
const legend = new Map<string, number>();
for (const loc of grid.locs) {
    if (loc.level !== 0) continue;
    const i = loc.x + loc.y * sizeX;
    const m = w.loc(loc.id);
    const mark =
        loc.type <= 3
            ? "W"
            : loc.type === 9
              ? "/"
              : loc.type === 10 || loc.type === 11
                ? m.sizeX > 1
                    ? "B"
                    : "R"
                : loc.type === 22
                  ? "."
                  : "d";
    const old = cell.get(i);
    if (!old || mark !== ".") cell.set(i, mark);
    const key = `${mark} ${loc.id} t${loc.type} ${m.name} ${m.sizeX}x${m.sizeY} clip${m.clipType} c${m.contoured}`;
    legend.set(key, (legend.get(key) ?? 0) + 1);
}
for (let y = sizeY - 1; y >= 0; y--) {
    let line = String(y0 + y).padStart(5) + " ";
    for (let x = 0; x < sizeX; x++) {
        const i = x + y * sizeX;
        const a = level.heights[x + y * corners];
        const b = level.heights[x + 1 + y * corners];
        const c = level.heights[x + (y + 1) * corners];
        const slope = Math.max(Math.abs(a - b), Math.abs(a - c));
        const blocked = level.flags[i] & 1 ? "#" : " ";
        line += `${String(a).padStart(3)}${slope >= 24 ? "!" : slope >= 12 ? "^" : " "}${blocked}${cell.get(i) ?? " "}`;
    }
    console.log(line);
}
console.log(
    "      " +
        Array.from(
            { length: sizeX },
            (_, i) =>
                String(x0 + i)
                    .slice(-3)
                    .padStart(3) + "   ",
        ).join(""),
);
console.log("overlay/underlay rows:");
for (let y = sizeY - 1; y >= 0; y -= 2) {
    let line = String(y0 + y).padStart(5) + " ";
    for (let x = 0; x < sizeX; x++) {
        const i = x + y * sizeX;
        line += `${String(level.overlays[i] || "-").padStart(3)}/${String(level.shapes[i]).padEnd(2)}`;
    }
    console.log(line);
}
for (const [k, n] of [...legend].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(n, k);
