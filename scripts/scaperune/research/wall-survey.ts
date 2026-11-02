// What a real place's outer wall is made of: the wall and big scenery locs in a rectangle by
// level, ranked, and a compact map of one level. A city wall shows as a few ids with long runs.
//
//   npx tsx scripts/scaperune/research/wall-survey.ts x y sizeX sizeY [level] [map]
import { openWorld } from "./lib";

const [x0, y0, sizeX, sizeY, mapLevel] = process.argv.slice(2).map(Number);
const showMap = process.argv[7] === "map";
const w = openWorld();
const grid = w.rect(x0, y0, sizeX, sizeY);
const corners = sizeX + 1;
const models = w.factory.getModelLoader();

// How tall a loc's model is, in tiles
function modelHeight(id: number): string {
    const type = w.locTypes.load(id);
    const ids = type.models?.flat() ?? [];
    let top = 0;
    let bottom = 0;
    for (const modelId of ids) {
        const model = models.getModel(modelId);
        if (!model) continue;
        for (let v = 0; v < model.verticesCount; v++) {
            top = Math.max(top, -model.verticesY[v]);
            bottom = Math.min(bottom, -model.verticesY[v]);
        }
    }
    const scale = type.modelSizeHeight / 128;
    return `${((top * scale) / 128).toFixed(1)}/${((bottom * scale) / 128).toFixed(1)}`;
}

for (let level = 0; level < 4; level++) {
    const counts = new Map<string, number>();
    for (const loc of grid.locs) {
        if (loc.level !== level || loc.type === 22 || (loc.type >= 4 && loc.type <= 8)) continue;
        const m = w.loc(loc.id);
        if (loc.type >= 10 && m.sizeX < 2 && m.sizeY < 2 && level === 0) continue;
        const key = `${loc.id} t${loc.type}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1]).slice(0, level === 0 ? 45 : 25);
    console.log(`--- level ${level}: ${counts.size} kinds`);
    for (const [key, count] of ranked) {
        const id = Number(key.split(" ")[0]);
        const m = w.loc(id);
        console.log(
            `${String(count).padStart(5)} ${key.padEnd(10)} ${m.name.padEnd(18)} ${m.sizeX}x${m.sizeY} clip${m.clipType} c${m.contoured} ` +
                `h ${modelHeight(id)} ${m.actions.join("|")}`,
        );
    }
}

if (showMap) {
    const cell = new Map<number, string>();
    const marks = (type: number, rotation: number) => {
        if (type === 0) return "|-|-"[rotation];
        if (type === 1 || type === 3) return "+";
        if (type === 2) return "L";
        if (type === 9) return "/";
        return "#";
    };
    for (const loc of grid.locs) {
        if (loc.level !== mapLevel) continue;
        if (loc.type === 22 || (loc.type >= 4 && loc.type <= 8)) continue;
        const m = w.loc(loc.id);
        if (loc.type >= 10) {
            for (let ty = 0; ty < m.sizeY; ty++) {
                for (let tx = 0; tx < m.sizeX; tx++) {
                    const i = loc.x + tx + (loc.y + ty) * sizeX;
                    if (loc.x + tx < sizeX) cell.set(i, m.sizeX > 1 ? "#" : "o");
                }
            }
        } else {
            cell.set(loc.x + loc.y * sizeX, marks(loc.type, loc.rotation));
        }
    }
    for (let y = sizeY - 1; y >= 0; y--) {
        let line = String(y0 + y).padStart(5) + " ";
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            const flag = grid.levels[0].flags[i] & 1;
            line += cell.get(i) ?? (flag ? "~" : grid.levels[0].overlays[i] ? "," : " ");
        }
        console.log(line);
    }
    console.log(`heights at y ${y0 + (sizeY >> 1)}:`);
    const row = sizeY >> 1;
    console.log(
        Array.from({ length: sizeX }, (_, x) => grid.levels[0].heights[x + row * corners]).join(
            " ",
        ),
    );
}

// With "dump" as the sixth argument, every wall and solid loc in the rectangle, tile by tile, on
// all levels, with the floor and height of each level.
if (process.argv[7] === "dump") {
    const lines = new Map<number, string[]>();
    for (const loc of grid.locs) {
        if (loc.type === 22) continue;
        const i = loc.x + loc.y * sizeX;
        lines.set(i, [
            ...(lines.get(i) ?? []),
            `L${loc.level} ${loc.id} t${loc.type} r${loc.rotation}`,
        ]);
    }
    for (let y = sizeY - 1; y >= 0; y--) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            const floors = grid.levels
                .slice(0, 3)
                .map(
                    (level) =>
                        `${level.heights[x + y * corners]}/${level.overlays[i]}/${level.flags[i]}`,
                )
                .join(" ");
            console.log(`${x0 + x},${y0 + y} [${floors}] ${(lines.get(i) ?? []).join(" ; ")}`);
        }
    }
}

// With "runs" as the sixth argument and ids after it: each id's longest straight run, and what's
// across the wall at its middle, tile by tile, so a wall's section can be read at a glance.
if (process.argv[7] === "runs") {
    for (const id of process.argv.slice(8).map(Number)) {
        const walls = grid.locs.filter((l) => l.id === id && l.type === 0 && l.level === 0);
        const at = new Set(walls.map((l) => `${l.x},${l.y},${l.rotation}`));
        let best = { length: 0, x: 0, y: 0, rotation: 0 };
        for (const { x, y, rotation } of walls) {
            const [dx, dy] = rotation & 1 ? [1, 0] : [0, 1];
            if (at.has(`${x - dx},${y - dy},${rotation}`)) continue;
            let length = 1;
            while (at.has(`${x + dx * length},${y + dy * length},${rotation}`)) length++;
            if (length > best.length) best = { length, x, y, rotation };
        }
        const { length, x, y, rotation } = best;
        const [dx, dy] = rotation & 1 ? [1, 0] : [0, 1];
        const midX = x + dx * (length >> 1);
        const midY = y + dy * (length >> 1);
        console.log(`# ${id}: run ${length} from ${x0 + x},${y0 + y} rotation ${rotation}`);
        for (let across = -4; across <= 4; across++) {
            const tx = midX + (rotation & 1 ? 0 : across);
            const ty = midY + (rotation & 1 ? across : 0);
            const here = grid.locs
                .filter((l) => l.x === tx && l.y === ty && l.type !== 22)
                .map((l) => `L${l.level} ${l.id} t${l.type} r${l.rotation}`)
                .join(" ; ");
            const i = tx + ty * sizeX;
            const floor = grid.levels
                .slice(0, 2)
                .map(
                    (level) =>
                        `${level.heights[tx + ty * corners]}/${level.overlays[i]}/${level.flags[i]}`,
                )
                .join(" ");
            console.log(`   ${String(across).padStart(2)} [${floor}] ${here}`);
        }
    }
}
