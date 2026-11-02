// Adds the ground's height to a list of spots, for rs-look.mjs.
//
//   npx tsx scripts/scaperune/research/stops.ts out.json name:x:y[:dist[:pitch[:yaw]]] ...
import fs from "node:fs";

import { openWorld } from "./lib";

const [out, ...specs] = process.argv.slice(2);
const w = openWorld();
const stops = specs.map((spec) => {
    const [name, x, y, dist, pitch, yaw] = spec.split(":");
    const grid = w.rect(Number(x), Number(y), 1, 1);
    return {
        name,
        x: Number(x),
        y: Number(y),
        h: grid.levels[0].heights[0],
        dist: dist ? Number(dist) : 18,
        pitch: pitch ? Number(pitch) : 400,
        yaw: yaw ? Number(yaw) : 0,
    };
});
fs.writeFileSync(out, JSON.stringify(stops));
console.log(stops.map((s) => `${s.name} ${s.h}`).join(", "));
