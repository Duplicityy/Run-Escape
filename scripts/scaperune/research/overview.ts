// A rectangle of the world (or a made map) from above, cheaply: a pixel or more a tile, floor
// colour with light from the slope, walls black, scenery dark, water as it is. For finding
// places and reading a layout, not for looks.
//
//   npx tsx scripts/scaperune/research/overview.ts out.png x y sizeX sizeY [pixelsPerTile]
//   DEV_MAPS=1 npx tsx scripts/scaperune/research/overview.ts out.png map=scaperune_ysmar [ppt]
import fs from "node:fs";

import { SCAPERUNE_DEV_MAPS } from "../../../src/game/scaperune/maps/devMaps";
import { SCAPERUNE_MAPS } from "../../../src/game/scaperune/maps/shippedMaps";
import { createBuildContext } from "../../../src/game/scaperune/squares";
import { encodePng } from "../png";
import { openWorld } from "./lib";

const [out, a, b, c, d, e] = process.argv.slice(2);
const w = openWorld();
let grid;
let ppt: number;
if (a.startsWith("map=")) {
    const recipe = [...SCAPERUNE_MAPS, ...SCAPERUNE_DEV_MAPS].find((m) => m.id === a.slice(4))!;
    grid = recipe.build(createBuildContext(w.maps, w.locTypes));
    ppt = Number(b ?? 2);
} else {
    grid = w.rect(Number(a), Number(b), Number(c), Number(d));
    ppt = Number(e ?? 2);
}
const { sizeX, sizeY } = grid;
const level = grid.levels[0];
const corners = sizeX + 1;
const colour = new Map<string, number>();
const rgbOf = (kind: "u" | "o", id: number): number => {
    const key = kind + id;
    if (!colour.has(key)) {
        let rgb = 0x808080;
        if (kind === "u") {
            rgb = (w.underlays.load(id - 1) as unknown as { rgbColor: number }).rgbColor;
        } else {
            const type = w.overlays.load(id - 1);
            rgb =
                type.textureId >= 0
                    ? type.textureId === 1
                        ? 0x2a4f8f
                        : 0x7f7468
                    : type.primaryRgb;
        }
        colour.set(key, rgb);
    }
    return colour.get(key)!;
};
const W = sizeX * ppt;
const H = sizeY * ppt;
const rgb = new Uint8Array(W * H * 3);
const put = (x: number, y: number, c: number, mix = 1) => {
    const i = (x + (H - 1 - y) * W) * 3;
    rgb[i] = rgb[i] * (1 - mix) + ((c >> 16) & 255) * mix;
    rgb[i + 1] = rgb[i + 1] * (1 - mix) + ((c >> 8) & 255) * mix;
    rgb[i + 2] = rgb[i + 2] * (1 - mix) + (c & 255) * mix;
};
for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
        const i = x + y * sizeX;
        const c = level.overlays[i]
            ? rgbOf("o", level.overlays[i])
            : level.underlays[i]
              ? rgbOf("u", level.underlays[i])
              : 0;
        const sw = level.heights[x + y * corners];
        const light = Math.max(
            0.35,
            Math.min(
                1.5,
                1 +
                    (level.heights[x + 1 + y * corners] -
                        sw +
                        level.heights[x + (y + 1) * corners] -
                        sw) /
                        40,
            ),
        );
        const lit =
            (Math.min(255, ((c >> 16) & 255) * light) << 16) |
            (Math.min(255, ((c >> 8) & 255) * light) << 8) |
            Math.min(255, (c & 255) * light);
        for (let py = 0; py < ppt; py++) {
            for (let px = 0; px < ppt; px++) {
                put(x * ppt + px, y * ppt + py, lit);
            }
        }
    }
}
for (const loc of grid.locs) {
    if (loc.level !== 0) continue;
    const meta = w.loc(loc.id);
    if (loc.type <= 3 || loc.type === 9) {
        for (let k = 0; k < ppt; k++) {
            put(
                loc.x * ppt + k,
                loc.y * ppt + (ppt > 1 && loc.rotation === 1 ? ppt - 1 : 0),
                0x000000,
            );
        }
    } else if (loc.type === 10 || loc.type === 11) {
        const sx = loc.rotation & 1 ? meta.sizeY : meta.sizeX;
        const sy = loc.rotation & 1 ? meta.sizeX : meta.sizeY;
        for (let tx = 0; tx < sx * ppt; tx++) {
            for (let ty = 0; ty < sy * ppt; ty++) {
                if (loc.x * ppt + tx < W && loc.y * ppt + ty < H) {
                    put(loc.x * ppt + tx, loc.y * ppt + ty, 0x10200f, 0.6);
                }
            }
        }
    }
}
fs.writeFileSync(out, encodePng(W, H, rgb));
console.log(`${W}x${H}`);
