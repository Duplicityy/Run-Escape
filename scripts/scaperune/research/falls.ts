// How real waterfalls attach to what's round them: each model's sheet, band by band, and each
// placement's ground, floors and neighbours, turned so that the fall always comes down facing
// south. The numbers behind the rules on falls in CLAUDE.md.
//
//   npx tsx scripts/scaperune/research/falls.ts world.json
//   npx tsx scripts/scaperune/research/falls.ts world.json 51484 45398    # just these locs
import fs from "node:fs";

import { WATER_OVERLAYS } from "../../../src/game/scaperune/catalogue";
import { TILE_BLOCKED } from "../../../src/game/scaperune/format";
import { locLabel, openWorld } from "./lib";

const FALLS = [51484, 45398, 44632, 16302, 26498, 25277, 25276];
const REACH = 8;

const [indexPath, ...picked] = process.argv.slice(2);
const wanted = new Set(picked.length > 0 ? picked.map(Number) : FALLS);
const world = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
    squares: { x: number; y: number; locs: Record<string, number> }[];
};
const w = openWorld();
const models = w.factory.getModelLoader();

// A model's sheet in bands from south to north, in tiles and height units: where the water is
function printModel(id: number): void {
    const type = w.locTypes.load(id);
    const bands = new Map<number, { low: number; high: number; xs: number[] }>();
    for (const modelId of type.models?.flat() ?? []) {
        const model = models.getModel(modelId);
        for (let v = 0; model && v < model.verticesCount; v++) {
            const band = Math.round(model.verticesZ[v] / 32) / 4;
            const up = -model.verticesY[v] / 8;
            const slot = bands.get(band) ?? { low: Infinity, high: -Infinity, xs: [] };
            slot.low = Math.min(slot.low, up);
            slot.high = Math.max(slot.high, up);
            slot.xs.push(model.verticesX[v] / 128);
            bands.set(band, slot);
        }
    }
    console.log(
        `${id} ${type.name} ${type.sizeX}x${type.sizeY} contour type ${type.contourGroundType}`,
    );
    for (const [band, { low, high, xs }] of [...bands].sort((a, b) => a[0] - b[0])) {
        const across = `${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}`;
        console.log(`  z ${band}: height ${low.toFixed(0)}..${high.toFixed(0)}, x ${across}`);
    }
}

for (const id of wanted) {
    printModel(id);
}

for (const square of world.squares) {
    const here = Object.keys(square.locs).filter((key) => wanted.has(Number(key.split(":")[0])));
    if (here.length === 0) {
        continue;
    }
    const x0 = square.x * 64 - REACH * 2;
    const y0 = square.y * 64 - REACH * 2;
    const size = 64 + REACH * 4;
    const grid = w.rect(x0, y0, size, size);
    const corners = size + 1;
    const { heights, overlays, flags } = grid.levels[0];
    for (const loc of grid.locs.filter((l) => wanted.has(l.id) && l.level === 0)) {
        const { sizeX, sizeY } = w.locTypes.load(loc.id);
        const [wide, deep] = loc.rotation & 1 ? [sizeY, sizeX] : [sizeX, sizeY];
        const middleX = loc.x + wide / 2;
        const middleY = loc.y + deep / 2;
        if (Math.max(Math.abs(middleX - 32 - REACH * 2), Math.abs(middleY - 32 - REACH * 2)) > 32) {
            continue;
        }
        console.log(
            `\n${loc.id} at ${x0 + loc.x},${y0 + loc.y} rotation ${loc.rotation}, ${wide}x${deep}`,
        );
        // Looking from where the water lands: rows run away from the camera, up the face
        const turn = (across: number, away: number): [number, number] => {
            switch (loc.rotation) {
                case 0:
                    return [middleX + across, middleY + away];
                case 1:
                    return [middleX + away, middleY - across];
                case 2:
                    return [middleX - across, middleY - away];
                default:
                    return [middleX - away, middleY + across];
            }
        };
        const base = heights[Math.floor(middleX) + Math.floor(middleY) * corners];
        for (let away = REACH; away >= -REACH; away--) {
            let line = `${String(away).padStart(3)} `;
            for (let across = -REACH; across <= REACH; across++) {
                const [cx, cy] = turn(across, away).map(Math.round);
                const [tx, ty] = turn(across + 0.5, away + 0.5).map(Math.floor);
                const inside = cx >= 0 && cy >= 0 && cx < size && cy < size;
                const i = tx + ty * size;
                const mark = !inside
                    ? " "
                    : WATER_OVERLAYS.has(overlays[i])
                      ? "~"
                      : flags[i] & TILE_BLOCKED
                        ? "#"
                        : " ";
                line += `${inside ? String(heights[cx + cy * corners] - base).padStart(4) : "    "}${mark}`;
            }
            console.log(line);
        }
        const near = new Map<string, number>();
        for (const other of grid.locs) {
            const dx = other.x - middleX;
            const dy = other.y - middleY;
            if (other !== loc && other.type !== 22 && Math.max(Math.abs(dx), Math.abs(dy)) <= 5) {
                const key = `${locLabel(w.loc(other.id))}:${other.id}:t${other.type}`;
                near.set(key, (near.get(key) ?? 0) + 1);
            }
        }
        console.log("  round it:", [...near].map(([key, n]) => `${key} x${n}`).join(", "));
    }
}
