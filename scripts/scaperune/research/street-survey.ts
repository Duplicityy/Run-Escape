// How a town's streets, blocks and buildings are laid out, real or made, by the same measures.
//
//   npx tsx scripts/scaperune/research/street-survey.ts 3176 3383 56 90        # world tiles
//   DEV_MAPS=1 npx tsx scripts/scaperune/research/street-survey.ts map=scaperune_city
//   npx tsx scripts/scaperune/research/street-survey.ts preset="Walled city" seed=1 sideStreets=1
//
// A made map's measured inside its first wall, or all over its arena if it has none. Paths are
// any overlay you can walk on outside. Streets are straight runs of open ground between
// buildings, and a block's buildings that stand 3 tiles or less apart.
import {
    DEFAULT_SETTINGS,
    SETTING_PRESETS,
    generateMapDetail,
    getGeneratedArena,
} from "../../../src/game/scaperune/generator";
import type { GeneratorSettings } from "../../../src/game/scaperune/generator";
import { DEV_MAP_SETTINGS } from "../../../src/game/scaperune/maps/devMaps";
import { createBuildContext } from "../../../src/game/scaperune/squares";
import { cropGrid, openWorld, percentile } from "./lib";
import { prepare } from "./metrics";

// Tiles between two buildings of one block, and the longest row of paths that counts as a street
const BLOCK_GAP = 3;
const LEAST_STREET = 14;
const ALLEY = 4;
const STREET = 10;
const MOST_RUN = 32;
// Tiles out of a wall a path counts as fronting it
const FRONT = 3;

const args = process.argv.slice(2);
const named = new Map(
    args.filter((a) => a.includes("=")).map((a) => a.split("=") as [string, string]),
);
const world = openWorld();
function getGrid() {
    if (!named.size) {
        const [x, y, sizeX, sizeY] = args.map(Number);
        return world.rect(x, y, sizeX, sizeY);
    }
    const context = createBuildContext(world.maps, world.locTypes);
    const map = named.get("map");
    const preset = named.get("preset");
    const base = map ? DEV_MAP_SETTINGS[map] : SETTING_PRESETS[preset ?? ""];
    const over: Record<string, number> = {};
    for (const [key, value] of named) {
        if (key !== "map" && key !== "preset") {
            over[key] = Number(value);
        }
    }
    const settings = { seed: 1, ...DEFAULT_SETTINGS, ...base, ...over } as GeneratorSettings;
    const detail = generateMapDetail(settings, context);
    const box = detail.walled?.[0] ?? getGeneratedArena(settings);
    const wanted = Math.round(settings.buildings * settings.squaresX * settings.squaresY * 3);
    console.log(`made: ${detail.buildings.length} of ${wanted} buildings`);
    return cropGrid(detail.grid, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
}

const grid = getGrid();
const p = prepare(grid, world.loc);
const { sizeX, sizeY, n, inside, level0, walkable } = p;
const path = new Uint8Array(n);
for (let i = 0; i < n; i++) {
    path[i] = level0.overlays[i] && walkable[i] && !inside[i] ? 1 : 0;
}

type Building = { area: number; x0: number; y0: number; x1: number; y1: number; block: number };
const seen = new Uint8Array(n);
const found: Building[] = [];
for (let start = 0; start < n; start++) {
    if (!inside[start] || seen[start]) {
        continue;
    }
    const b: Building = { area: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1, block: -1 };
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
        const i = queue.pop()!;
        const x = i % sizeX;
        const y = Math.floor(i / sizeX);
        b.area++;
        b.x0 = Math.min(b.x0, x);
        b.y0 = Math.min(b.y0, y);
        b.x1 = Math.max(b.x1, x);
        b.y1 = Math.max(b.y1, y);
        for (const j of [i - 1, i + 1, i - sizeX, i + sizeX]) {
            if (j >= 0 && j < n && Math.abs((j % sizeX) - x) <= 1 && inside[j] && !seen[j]) {
                seen[j] = 1;
                queue.push(j);
            }
        }
    }
    found.push(b);
}
const buildings = found.filter((b) => b.area >= 6);

const q = (list: number[], ...at: number[]) => {
    const sorted = [...list].sort((a, b) => a - b);
    return at.map((share) => percentile(sorted, share));
};
const gapOf = (a: Building, b: Building) =>
    Math.max(Math.max(b.x0 - a.x1, a.x0 - b.x1, 0), Math.max(b.y0 - a.y1, a.y0 - b.y1, 0));

// Blocks: buildings joined by gaps of 3 tiles or less
let blocks = 0;
for (const start of buildings) {
    if (start.block >= 0) {
        continue;
    }
    start.block = blocks;
    const queue = [start];
    while (queue.length > 0) {
        const b = queue.pop()!;
        for (const other of buildings) {
            if (other.block < 0 && gapOf(b, other) - 1 <= BLOCK_GAP) {
                other.block = blocks;
                queue.push(other);
            }
        }
    }
    blocks++;
}
const inBlock = Array.from({ length: blocks }, (_, block) =>
    buildings.filter((b) => b.block === block),
);
const blockSpan = inBlock.map((list) => {
    const x = Math.max(...list.map((b) => b.x1)) - Math.min(...list.map((b) => b.x0)) + 1;
    const y = Math.max(...list.map((b) => b.y1)) - Math.min(...list.map((b) => b.y0)) + 1;
    return { long: Math.max(x, y), short: Math.min(x, y) };
});

// Gaps, wall to wall: 1 is a wall they share
const nearest = buildings.map((b) =>
    Math.min(99, ...buildings.filter((o) => o !== b).map((o) => gapOf(b, o) - 1)),
);

// Open runs between two buildings, along rows and columns, by how many tiles they take up
const runs = { alley: 0, street: 0, wide: 0 };
const widths: number[] = [];
const scan = (lines: number, along: number, at: (line: number, a: number) => number) => {
    for (let line = 0; line < lines; line++) {
        let last = -1;
        for (let a = 0; a < along; a++) {
            if (inside[at(line, a)]) {
                const run = a - last - 1;
                if (last >= 0 && run > 0 && run <= MOST_RUN) {
                    widths.push(run);
                    runs[run <= ALLEY ? "alley" : run <= STREET ? "street" : "wide"] += run;
                }
                last = a;
            }
        }
    }
};
scan(sizeY, sizeX, (y, x) => x + y * sizeX);
scan(sizeX, sizeY, (x, y) => x + y * sizeX);
const runTotal = runs.alley + runs.street + runs.wide;

// Long straight streets, each way, and how far apart they run
const axes = (lines: number, along: number, at: (line: number, a: number) => number) => {
    const lit: number[] = [];
    for (let line = 0; line < lines; line++) {
        let best = 0;
        let run = 0;
        for (let a = 0; a < along; a++) {
            run = path[at(line, a)] ? run + 1 : 0;
            best = Math.max(best, run);
        }
        if (best >= LEAST_STREET) {
            lit.push(line);
        }
    }
    const groups: { from: number; to: number }[] = [];
    for (const line of lit) {
        const last = groups[groups.length - 1];
        if (last && line - last.to <= 1) {
            last.to = line;
        } else {
            groups.push({ from: line, to: line });
        }
    }
    return groups;
};
const rows = axes(sizeY, sizeX, (y, x) => x + y * sizeX);
const columns = axes(sizeX, sizeY, (x, y) => x + y * sizeX);
const spacing = [rows, columns].flatMap((groups) =>
    groups.slice(1).map((g, i) => g.from - groups[i].to - 1),
);
const widthsOf = [...rows, ...columns].map((g) => g.to - g.from + 1);

// How much of a building's outside has a path close by, and of each side, the one that's nearest
const fronted: number[] = [];
const sidesOnPath: number[] = [];
for (const b of buildings) {
    let edge = 0;
    let onPath = 0;
    const sides = [0, 0, 0, 0];
    const check = (x: number, y: number, wayX: number, wayY: number, side: number) => {
        edge++;
        for (let out = 1; out <= FRONT + 1; out++) {
            const tx = x + wayX * out;
            const ty = y + wayY * out;
            if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && path[tx + ty * sizeX]) {
                onPath++;
                sides[side]++;
                return;
            }
        }
    };
    for (let x = b.x0; x <= b.x1; x++) {
        check(x, b.y0, 0, -1, 0);
        check(x, b.y1, 0, 1, 1);
    }
    for (let y = b.y0; y <= b.y1; y++) {
        check(b.x0, y, -1, 0, 2);
        check(b.x1, y, 1, 0, 3);
    }
    fronted.push(Math.round((100 * onPath) / edge));
    sidesOnPath.push(sides.filter((count) => count >= 3).length);
}

// A street's edge, and how much of it has a building stood along it
let streetEdge = 0;
let builtEdge = 0;
for (let y = 1; y < sizeY - 1; y++) {
    for (let x = 1; x < sizeX - 1; x++) {
        const i = x + y * sizeX;
        if (!path[i]) {
            continue;
        }
        for (const [wayX, wayY] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ]) {
            if (!path[i + wayX + wayY * sizeX]) {
                streetEdge++;
                for (let out = 1; out <= FRONT + 1; out++) {
                    const tx = x + wayX * out;
                    const ty = y + wayY * out;
                    if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && inside[tx + ty * sizeX]) {
                        builtEdge++;
                        break;
                    }
                }
            }
        }
    }
}

// What's between buildings: tiles out to 4 from a wall that aren't path
let ring = 0;
let ringPath = 0;
let ringBlocked = 0;
let ringFree = 0;
for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
        const i = x + y * sizeX;
        if (inside[i]) {
            continue;
        }
        let near = false;
        for (let dy = -4; dy <= 4 && !near; dy++) {
            for (let dx = -4; dx <= 4 && !near; dx++) {
                const tx = x + dx;
                const ty = y + dy;
                near = tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && !!inside[tx + ty * sizeX];
            }
        }
        if (near) {
            ring++;
            ringPath += path[i];
            ringBlocked += walkable[i] ? 0 : 1;
            ringFree += walkable[i] && !path[i] ? 1 : 0;
        }
    }
}

// How much of the ground's each thing, and fences
let indoor = 0;
let paths = 0;
let open = 0;
for (let i = 0; i < n; i++) {
    indoor += inside[i];
    paths += path[i];
    open += walkable[i];
}
let fences = 0;
for (const loc of grid.locs) {
    fences += loc.level === 0 && loc.type === 0 && !inside[loc.x + loc.y * sizeX] ? 1 : 0;
}

// LIST=1 prints each building's rectangle, walls included, for PREFABS
if (process.env.LIST) {
    const [originX, originY] = named.size ? [0, 0] : args.map(Number);
    for (const b of buildings) {
        console.log(
            `${b.x0 - 1 + originX},${b.y0 - 1 + originY} ${b.x1 - b.x0 + 3}x${b.y1 - b.y0 + 3} area ${b.area}`,
        );
    }
}

const pct = (part: number, whole: number) => Math.round((100 * part) / Math.max(whole, 1));
console.log(
    JSON.stringify(
        {
            size: `${sizeX}x${sizeY}`,
            buildings: buildings.length,
            per1000Tiles: Math.round((10000 * buildings.length) / n) / 10,
            indoorPct: pct(indoor, n),
            pathPct: pct(paths, n),
            walkablePct: pct(open, n),
            areaQ: q(
                buildings.map((b) => b.area),
                0.25,
                0.5,
                0.75,
            ),
            nearestGapQ: q(nearest, 0.25, 0.5, 0.75),
            sharedWallPct: pct(nearest.filter((gap) => gap === 0).length, buildings.length),
            gapUnder3Pct: pct(nearest.filter((gap) => gap <= 2).length, buildings.length),
            blocks,
            buildingsInBlockQ: q(
                inBlock.map((list) => list.length),
                0.5,
                0.9,
            ),
            blockLongQ: q(
                blockSpan.map((b) => b.long),
                0.5,
                0.9,
            ),
            blockShortQ: q(
                blockSpan.map((b) => b.short),
                0.5,
                0.9,
            ),
            runsPct: {
                alley: pct(runs.alley, runTotal),
                street: pct(runs.street, runTotal),
                wide: pct(runs.wide, runTotal),
            },
            runWidthQ: q(widths, 0.25, 0.5, 0.75, 0.9),
            straightStreets: rows.length + columns.length,
            streetWidthQ: q(widthsOf, 0.25, 0.5, 0.75),
            streetSpacingQ: q(spacing, 0.25, 0.5, 0.75),
            frontedPctQ: q(fronted, 0.25, 0.5, 0.75),
            sidesOnPathQ: q(sidesOnPath, 0.25, 0.5, 0.75),
            builtStreetEdgePct: pct(builtEdge, streetEdge),
            betweenPathPct: pct(ringPath, ring),
            betweenBlockedPct: pct(ringBlocked, ring),
            betweenFreePct: pct(ringFree, ring),
            freeWallsPer100: Math.round((1000 * fences) / n) / 10,
        },
        null,
        0,
    ),
);
