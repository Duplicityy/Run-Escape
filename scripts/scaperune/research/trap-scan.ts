// Goes through what a map is made of and flags locs that read wrong anywhere but where they
// were built for. The classes are the draft of a catalogue check: see the research doc.
//
//   DEV_MAPS=1 npx tsx scripts/scaperune/research/trap-scan.ts world.json out.json map map ...
import fs from "node:fs";

import { SCAPERUNE_DEV_MAPS } from "../../../src/game/scaperune/maps/devMaps";
import { SCAPERUNE_MAPS } from "../../../src/game/scaperune/maps/shippedMaps";
import { createBuildContext } from "../../../src/game/scaperune/squares";
import { bump, locLabel, openWorld, round } from "./lib";

type Square = { x: number; y: number; locs: Record<string, number> };
const [worldFile, out, ...wanted] = process.argv.slice(2);
const world = JSON.parse(fs.readFileSync(worldFile, "utf8")) as { squares: Square[] };
const w = openWorld();
const models = w.factory.getModelLoader();

// How a loc's used in the world, whatever the type
const surface = new Map<number, number>();
const elsewhere = new Map<number, number>();
const typed = new Map<string, number>();
for (const square of world.squares) {
    for (const [key, count] of Object.entries(square.locs)) {
        const id = Number(key.split(":")[0]);
        bump(square.y < 64 ? surface : elsewhere, id, count);
        bump(typed, key, count);
    }
}

type Shape = { sink: number; top: number; reach: number; tris: number };
const shapes = new Map<string, Shape>();
function shapeOf(id: number, locType: number): Shape {
    const key = `${id}:${locType}`;
    let shape = shapes.get(key);
    if (shape) return shape;
    const type = w.locTypes.load(id);
    shape = { sink: 0, top: 0, reach: 0, tris: 0 };
    const sets = type.models ?? [];
    let list = sets.flat();
    if (type.types && sets.length > 0) {
        const at = type.types.indexOf(locType);
        // A type with no model of its own draws nothing
        list = at >= 0 ? sets[at] : [];
    }
    const scaleX = type.modelSizeX / 128;
    const scaleY = type.modelSizeHeight / 128;
    const scaleZ = type.modelSizeY / 128;
    for (const modelId of list) {
        const model = models.getModel(modelId);
        if (!model) continue;
        shape.tris += model.faceCount;
        for (let v = 0; v < model.verticesCount; v++) {
            const up = -model.verticesY[v] * scaleY;
            shape.top = Math.max(shape.top, up / 128);
            shape.sink = Math.max(shape.sink, -up / 128);
            const halfX = (type.sizeX * 128) / 2;
            const halfZ = (type.sizeY * 128) / 2;
            shape.reach = Math.max(
                shape.reach,
                (Math.abs(model.verticesX[v] * scaleX) - halfX) / 128,
                (Math.abs(model.verticesZ[v] * scaleZ) - halfZ) / 128,
            );
        }
    }
    shapes.set(key, shape);
    return shape;
}

const context = createBuildContext(w.maps, w.locTypes);
const results: Record<string, object> = {};
for (const id of wanted) {
    const recipe = [...SCAPERUNE_MAPS, ...SCAPERUNE_DEV_MAPS].find((map) => map.id === id);
    if (!recipe) continue;
    const grid = recipe.build(context);
    const m = recipe.margin * 64;
    const classes = new Map<string, Map<string, number>>();
    const add = (name: string, label: string) => {
        if (!classes.has(name)) classes.set(name, new Map());
        bump(classes.get(name)!, label);
    };
    let tris = 0;
    let arenaLocs = 0;
    for (const loc of grid.locs) {
        if (
            loc.level !== 0 ||
            loc.x < m ||
            loc.y < m ||
            loc.x >= grid.sizeX - m ||
            loc.y >= grid.sizeY - m
        )
            continue;
        arenaLocs++;
        const meta = w.loc(loc.id);
        const shape = shapeOf(loc.id, loc.type);
        tris += shape.tris;
        const label = `${loc.id} ${locLabel(meta)} t${loc.type}`;
        const onSurface = surface.get(loc.id) ?? 0;
        const off = elsewhere.get(loc.id) ?? 0;
        if (onSurface + off === 0) add("never placed in any map file", label);
        else if (onSurface === 0) add("no surface use at all", label);
        else if (onSurface / (onSurface + off) < 0.1 && onSurface + off < 100)
            add("nearly all off the surface", label);
        if (
            loc.type !== 22 &&
            loc.type > 11 === false &&
            !typed.get(`${loc.id}:${loc.type}`) &&
            onSurface + off > 0
        )
            add("placed as a type it never is", label);
        if (shape.sink > 1) add("sinks over a tile below its origin", label);
        if (shape.reach > 1) add("reaches over a tile past its footprint", label);
        // Wall decoration shares a model between its types, and a diagonal has its own rules
        if (shape.tris === 0 && [0, 1, 2, 3, 10, 22].includes(loc.type)) {
            add(meta.clipType === 0 ? "draws nothing" : "draws nothing but blocks", label);
        }
        if (shape.tris >= 500 && Math.max(meta.sizeX, meta.sizeY) <= 2)
            add("500+ triangles on 2 tiles or less", label);
        if (meta.seqId >= 0) add("animated", label);
        if (
            meta.contoured < 0 &&
            (loc.type === 10 || loc.type === 22) &&
            Math.max(meta.sizeX, meta.sizeY) >= 3
        )
            add("big and not contoured", label);
    }
    results[id] = {
        arenaLocs,
        tris,
        classes: Object.fromEntries(
            [...classes].map(([name, labels]) => [
                name,
                {
                    locs: [...labels.values()].reduce((a, b) => a + b, 0),
                    top: [...labels].sort((a, b) => b[1] - a[1]).slice(0, 10),
                },
            ]),
        ),
    };
    console.log(id, arenaLocs, "locs", round(tris / 1000, 0), "k tris");
    for (const [name, labels] of classes) {
        console.log(
            `  ${name}: ${[...labels.values()].reduce((a, b) => a + b, 0)}: ${[...labels]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([l, c]) => `${l} x${c}`)
                .join("; ")}`,
        );
    }
}
fs.writeFileSync(out, JSON.stringify(results));
