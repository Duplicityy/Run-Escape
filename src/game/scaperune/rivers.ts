import { WATERFALL } from "./biomes";
import { TileRect } from "./collision";
import {
    Build,
    LOC_NORMAL,
    SPAWN_CLEAR,
    getCornerDistance,
    getTouchedTiles,
    hasRelief,
    lerp,
} from "./mapBuild";
import { Noise, createNoise, createRng, smoothField } from "./noise";
import { spreadNearest } from "./terrain";

// Rivers, lakes and the sea: where they go, and how high they stand.

// The width of a river at a bridge, and a half width of 1 to 1.3 on a line of tile
// corners fills exactly the 2 rows beside it, the gap in a bridge's fences
const BRIDGE_RIVER_HALF_WIDTH = 4.5;

// Crossings are at most this far apart, so that wherever you are one's inside
// the flow field's window (48 tiles each way)
const CROSSING_SPACING = 60;

export const SEA_BED = 6;
// Tiles the ground takes to come down to the sea, or down into a chasm
const SHORE_REACH = 8;

const CHASM_EDGE = 2;

// The lowest fresh water can be
export const RIVER_BED = 8;

// How far under the ground round it water lies
const WATER_DROP = 18;

// Tiles a shore takes to come down to the water, at the least. Tall ground takes longer.
const MIN_BANK = 6;

export const MAX_BANK = 24;

// How steep the sides of a river's valley are, from a gorge to a wide valley
const GORGE_SLOPE = 34;

const VALLEY_SLOPE = 7;

// Tiles either side of a crossing a river can't fall in
const LEVEL_AT_CROSSING = 13;

// How far a river has to fall for it to come down as a waterfall, and tiles it keeps clear
// of a crossing
const WATERFALL_DROP = 16;

// Two levels of water closer than this are one level: there's no fall to see
const LEAST_DROP = 4;

// Tiles past a river's edge that a drop parts, for a bank that wanders
const DROP_REACH = 2;

const WATERFALL_RUN = 6;

const WATERFALL_SPACING = 30;

// A river can't lay this much fall by for later, however close its last drop was
const WATERFALL_TALL = 56;

const WATERFALL_WIDTH = 3;

// How much of the land's height a river's course minds, against a straight line
const VALLEY_SEEK = 1;

export type River = {
    // Runs north to south, or west to east
    vertical: boolean;
    // Its column or row at the crossings
    line: number;
    crossings: number[];
    wiggle: Noise;
    amount: number;
    halfWidth: number;
    // Its column or row along its length, where the land gives it a valley to run in
    valley?: Float32Array;
    // How high the water is along its length: flat reaches, with drops between them
    levels: Float32Array;
    // Where it falls, for waterfalls: the corners its lower reach starts at, and the row of
    // tiles that drops
    drops: RiverDrop[];
};

export type RiverDrop = { along: number; level: number; row: number };

// A lake or pond: where it is, and how high its water stands. A river runs out of a source and
// never falls into it.
export type Pool = { x: number; y: number; radius: number; level: number; source?: boolean };

function riverStraightness(river: River, along: number): number {
    let away = Infinity;
    for (const crossing of river.crossings) {
        away = Math.min(away, Math.abs(along - crossing));
    }
    return Math.min(Math.max(away - 10, 0) / 12, 1);
}

// The line a river would follow if it didn't wander
function riverLine(river: River, along: number): number {
    const { valley, line } = river;
    if (!valley) {
        return line;
    }
    return valley[Math.min(Math.max(Math.round(along), 0), valley.length - 1)];
}

function getNearestCrossing(river: River, along: number): number {
    let best = along;
    let bestDistance = Infinity;
    for (const crossing of river.crossings) {
        const distance = Math.abs(along - crossing);
        if (distance < bestDistance) {
            best = crossing;
            bestDistance = distance;
        }
    }
    return best;
}

export function riverCentre(river: River, along: number): number {
    const straight = riverStraightness(river, along);
    const line = lerp(
        riverLine(river, getNearestCrossing(river, along)),
        riverLine(river, along),
        straight,
    );
    return line + (river.wiggle(along / 30, 3.5) - 0.5) * 2 * river.amount * straight;
}

// Rivers narrow to a bridge's span where one can cross them
export function riverHalfWidth(river: River, along: number): number {
    return lerp(BRIDGE_RIVER_HALF_WIDTH, river.halfWidth, riverStraightness(river, along));
}

// How far in from the arena's edge the sea comes
function getCoastDepth(build: Build): number {
    const { settings, arena } = build;
    if (settings.boundary !== "sea") {
        return 0;
    }
    const half = Math.min(arena.x1 - arena.x0, arena.y1 - arena.y0) / 2;
    return 3 + settings.island * half * 0.5;
}

export function createRivers(build: Build): River[] {
    const { settings, arena, rng } = build;
    const coast = getCoastDepth(build);
    const rivers: River[] = [];
    const firstVertical = rng() < 0.5;
    for (let i = 0; i < settings.rivers; i++) {
        const vertical = i % 2 === 0 ? firstVertical : !firstVertical;
        const [alongMin, alongMax, acrossMin, acrossMax] = vertical
            ? [arena.y0, arena.y1, arena.x0, arena.x1]
            : [arena.x0, arena.x1, arena.y0, arena.y1];
        // Across the land, not out in the sea
        const half = (alongMax - alongMin) / 2 - coast;
        const middle = (alongMin + alongMax) / 2;
        const count = Math.max(Math.round((half * 2) / CROSSING_SPACING), 1);
        const crossings: number[] = [];
        for (let c = 0; c < count; c++) {
            const at = middle - half + ((c + 0.5) / count) * half * 2;
            crossings.push(Math.round(at + (rng() - 0.5) * 10));
        }
        const side = rng() < 0.5 ? -1 : 1;
        const acrossHalf = (acrossMax - acrossMin) / 2 - coast;
        rivers.push({
            vertical,
            line: Math.round(
                (acrossMin + acrossMax) / 2 + side * Math.max(acrossHalf * (0.3 + rng() * 0.4), 13),
            ),
            crossings,
            wiggle: createNoise(settings.seed + 100 + i, 1),
            amount: Math.max(half * 0.2, 10),
            halfWidth: settings.riverWidth / 2,
            levels: new Float32Array((vertical ? build.corners.y : build.corners.x) + 1),
            drops: [],
        });
        const river = rivers[rivers.length - 1];
        if (hasRelief(settings)) {
            river.valley = findValley(build, river);
            river.amount *= 0.3;
        }
    }
    return rivers;
}

// The low ground along a river: for each step along, the column that climbs least, each
// a column at most from the last (seam carving). It keeps to its side of the arena, so that
// two rivers don't end up in one valley.
function findValley(build: Build, river: River): Float32Array {
    const { arena, corners, terrain, settings } = build;
    const [alongCount, acrossCount] = river.vertical
        ? [corners.y, corners.x]
        : [corners.x, corners.y];
    const [low, high] = river.vertical ? [arena.x0, arena.x1] : [arena.y0, arena.y1];
    const width = high - low + 1;
    const span = Math.max(width * 0.3, 16);
    const heightAt = (along: number, across: number) =>
        terrain.height[river.vertical ? across + along * corners.x : along + across * corners.x];
    const totals = new Float32Array(alongCount * width);
    const from = new Int8Array(alongCount * width);
    for (let along = 0; along < alongCount; along++) {
        for (let at = 0; at < width; at++) {
            const across = low + at;
            const offset = Math.abs(across - river.line);
            const cost =
                (heightAt(along, across) * VALLEY_SEEK) / 16 + Math.max(offset - span, 0) * 2;
            let best = 0;
            let way = 0;
            if (along > 0) {
                best = Infinity;
                for (let step = -1; step <= 1; step++) {
                    const next = at + step;
                    if (next >= 0 && next < width) {
                        const total = totals[next + (along - 1) * width];
                        if (total < best) {
                            best = total;
                            way = step;
                        }
                    }
                }
            }
            totals[at + along * width] = best + cost;
            from[at + along * width] = way;
        }
    }
    let end = 0;
    for (let at = 1; at < width; at++) {
        if (totals[at + (alongCount - 1) * width] < totals[end + (alongCount - 1) * width]) {
            end = at;
        }
    }
    const valley = new Float32Array(alongCount);
    for (let along = alongCount - 1, at = end; along >= 0; along--) {
        valley[along] = low + at;
        at += from[at + along * width];
    }
    // Smooth it out, with a wider reach the more it can wander
    const reach = Math.max(Math.round(settings.ridgeScale / 4), 6);
    return smoothLine(valley, reach);
}

function smoothLine(line: Float32Array, reach: number): Float32Array {
    const out = new Float32Array(line.length);
    for (let i = 0; i < line.length; i++) {
        const span = Math.min(reach, i, line.length - 1 - i);
        let sum = 0;
        for (let j = i - span; j <= i + span; j++) {
            sum += line[j];
        }
        out[i] = sum / (span * 2 + 1);
    }
    return out;
}

// The arena's edge with its corners rounded off: tiles in from it, negative outside
function toRoundedEdge(build: Build, x: number, y: number): number {
    const { arena } = build;
    const halfX = (arena.x1 + 1 - arena.x0) / 2;
    const halfY = (arena.y1 + 1 - arena.y0) / 2;
    const radius = Math.min(halfX, halfY) * 0.6;
    const dx = Math.abs(x - (arena.x0 + halfX));
    const dy = Math.abs(y - (arena.y0 + halfY));
    const cornerX = dx - (halfX - radius);
    const cornerY = dy - (halfY - radius);
    if (cornerX > 0 && cornerY > 0) {
        return radius - Math.hypot(cornerX, cornerY);
    }
    return Math.min(halfX - dx, halfY - dy);
}

// Where the water goes, as fields per tile corner: above 0 is water. Fields rather
// than tiles so that its edges can be smooth lines.
export function createWaterFields(build: Build, rivers: River[], hills: Noise) {
    const { settings, arena, rng, corners, spawn } = build;
    const pools: Pool[] = [];
    const rough = settings.shoreRoughness;
    const coast = createNoise(settings.seed + 1, rough > 0.7 ? 3 : 2);
    const shape = createNoise(settings.seed + 2, 1);
    const count = corners.x * corners.y;
    const sea = new Float32Array(count).fill(-100);
    const fresh = new Float32Array(count).fill(-100);
    // Low ground flooded, which stands at the lowest level there is
    const flood = new Uint8Array(count);

    if (settings.boundary === "sea") {
        const depth = getCoastDepth(build);
        const span = lerp(40, 14, rough);
        const amount = 4 + rough * 30;
        for (let y = 0; y < corners.y; y++) {
            for (let x = 0; x < corners.x; x++) {
                const wobble = (coast(x / span, y / span) - 0.5) * amount;
                sea[x + y * corners.x] = depth - toRoundedEdge(build, x, y) - wobble;
            }
        }
    }

    // Low ground floods
    if (settings.waterLevel > 0) {
        const line = 0.28 + settings.waterLevel * 0.42;
        for (let y = 0; y < corners.y; y++) {
            for (let x = 0; x < corners.x; x++) {
                const low = line - hills(x / settings.hillScale, y / settings.hillScale);
                fresh[x + y * corners.x] = low * 80;
                flood[x + y * corners.x] = low > -0.1 ? 1 : 0;
            }
        }
    }

    for (const river of rivers) {
        const [alongCount, acrossCount] = river.vertical
            ? [corners.y, corners.x]
            : [corners.x, corners.y];
        for (let along = 0; along < alongCount; along++) {
            const centre = riverCentre(river, along);
            const half = riverHalfWidth(river, along);
            const reach = half + 8;
            const first = Math.max(Math.floor(centre - reach), 0);
            const last = Math.min(Math.ceil(centre + reach), acrossCount - 1);
            for (let across = first; across <= last; across++) {
                const i = river.vertical ? across + along * corners.x : along + across * corners.x;
                fresh[i] = Math.max(fresh[i], half - Math.abs(across - centre));
            }
        }
    }

    const addPool = (radius: number) => {
        // Anywhere in the arena, clear of the spawn
        const x = lerp(arena.x0, arena.x1, rng());
        const y = lerp(arena.y0, arena.y1, rng());
        pools.push({ x, y, radius, level: 0 });
        const reach = radius * 1.5 + 8;
        const x0 = Math.max(Math.floor(x - reach), 0);
        const x1 = Math.min(Math.ceil(x + reach), corners.x - 1);
        const y0 = Math.max(Math.floor(y - reach), 0);
        const y1 = Math.min(Math.ceil(y + reach), corners.y - 1);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const wobble = (shape(cx / 14, cy / 14) - 0.5) * radius * (0.6 + rough);
                const edge = radius + wobble - Math.hypot(cx - x, cy - y);
                const i = cx + cy * corners.x;
                fresh[i] = Math.max(fresh[i], edge);
            }
        }
    };
    for (let i = 0; i < settings.lakes; i++) {
        addPool(14 + rng() * 14);
    }
    for (let i = 0; i < settings.ponds; i++) {
        addPool(4 + rng() * 6);
    }

    const smooth = (field: Float32Array) => {
        const out = smoothField(field, corners.x, corners.y, 3);
        // Nothing round the spawn
        for (let y = 0; y < corners.y; y++) {
            for (let x = 0; x < corners.x; x++) {
                const away = Math.hypot(x - spawn.x, y - spawn.y) - SPAWN_CLEAR;
                out[x + y * corners.x] = Math.min(out[x + y * corners.x], away);
            }
        }
        return out;
    };
    return { sea: smooth(sea), fresh: smooth(fresh), flood, pools };
}

// Takes the land down to the sea, over a few tiles
export function sinkSea(build: Build, toSea: Float32Array): void {
    const { terrain, corners, biomeAt, sizeX, sizeY } = build;
    const { height } = terrain;
    for (let y = 0; y < corners.y; y++) {
        for (let x = 0; x < corners.x; x++) {
            const at = terrain.corner(x, y);
            const biome = biomeAt(Math.min(x, sizeX - 1), Math.min(y, sizeY - 1));
            const reach = biome.chasm ? CHASM_EDGE : SHORE_REACH;
            const share = Math.min(getCornerDistance(build, toSea, x, y) / reach, 1);
            height[at] = SEA_BED + (height[at] - SEA_BED) * share;
        }
    }
}

// How high a river's water stands along its length: under the ground, in flat reaches. Water
// doesn't slope: a river only changes level at a drop, and with none it's one level end to end.
// One with the sea at both ends runs down to each from its highest point.
function setRiverLevels(build: Build, river: River): void {
    const { terrain, corners } = build;
    const count = river.vertical ? corners.y : corners.x;
    const { levels } = river;
    const heightAt = (along: number) => {
        const across = riverCentre(river, along);
        return river.vertical ? terrain.getHeight(across, along) : terrain.getHeight(along, across);
    };
    let high = 0;
    for (let along = 0; along < count; along++) {
        levels[along] = Math.max(heightAt(along) - WATER_DROP, RIVER_BED);
        if (levels[along] > levels[high]) {
            high = along;
        }
    }
    const first = levels[0];
    const last = levels[count - 1];
    const fall = (start: number, end: number) => {
        const way = Math.sign(end - start);
        for (let along = start + way; along !== end + way; along += way) {
            levels[along] = Math.min(levels[along], levels[along - way]);
        }
    };
    let peak = high;
    if (first < RIVER_BED + 2 && last < RIVER_BED + 2) {
        fall(high, 0);
        fall(high, count - 1);
    } else if (first > last) {
        fall(0, count - 1);
        peak = 0;
    } else {
        fall(count - 1, 0);
        peak = count - 1;
    }
    stepRiver(build, river, peak, count);
}

// Gathers a river's fall into drops, away from crossings, and lays each reach flat at the lowest
// it comes to, so that water never stands above its own banks. Its count levels fall away from
// peak.
function stepRiver(build: Build, river: River, peak: number, count: number): void {
    const { settings } = build;
    const { levels } = river;
    const roll = createRng(settings.seed + 300 + river.line);
    const clear = (along: number) =>
        river.crossings.every(
            (crossing) => Math.abs(along - crossing) > LEVEL_AT_CROSSING + WATERFALL_RUN,
        );
    const drops: RiverDrop[] = [];
    if (settings.waterfalls > 0) {
        for (const way of [-1, 1]) {
            let held = levels[peak];
            let last = -Infinity;
            for (let along = peak + way; along >= 0 && along < count; along += way) {
                const drop = held - levels[along];
                const due =
                    Math.abs(along - last) >= WATERFALL_SPACING && roll() < settings.waterfalls;
                const tall = drop >= WATERFALL_TALL;
                if (drop >= WATERFALL_DROP && (due || tall) && clear(along)) {
                    drops.push({ along, level: levels[along], row: way > 0 ? along - 1 : along });
                    held = levels[along];
                    last = along;
                }
            }
        }
    }
    // Reaches: from one drop to the next along the river
    const edges = [...drops.map(({ row }) => row + 1), 0, count].sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
        const reach = levels.subarray(edges[i], edges[i + 1]);
        reach.fill(Math.round(Math.min(...reach)));
    }
    river.drops = drops;
}

// Tiles of water in pieces that touch, at a side or just a corner: they share corners, so each
// has to be one level. Tiles in cut aren't in any: that's how a drop parts two reaches.
export function findWaterPieces(build: Build, tiles: Uint8Array, cut: Uint8Array): Int32Array {
    const { sizeX, sizeY } = build;
    const pieces = new Int32Array(tiles.length).fill(-1);
    let next = 0;
    const stack: number[] = [];
    for (let start = 0; start < tiles.length; start++) {
        if (!tiles[start] || cut[start] || pieces[start] >= 0) {
            continue;
        }
        pieces[start] = next;
        stack.push(start);
        while (stack.length > 0) {
            const i = stack.pop()!;
            const x = i % sizeX;
            const y = (i - x) / sizeX;
            for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, sizeY - 1); ny++) {
                for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, sizeX - 1); nx++) {
                    const j = nx + ny * sizeX;
                    if (tiles[j] && !cut[j] && pieces[j] < 0) {
                        pieces[j] = next;
                        stack.push(j);
                    }
                }
            }
        }
        next++;
    }
    return pieces;
}

// The tiles of a river's row that a drop takes in: bank to bank, whatever's touching them
function getDropTiles(build: Build, river: River, { row }: RiverDrop): TileRect {
    const centre = riverCentre(river, row);
    const reach = riverHalfWidth(river, row) + DROP_REACH;
    const [low, high] = [Math.floor(centre - reach), Math.ceil(centre + reach)];
    return river.vertical
        ? { x0: low, y0: row, x1: high, y1: row }
        : { x0: row, y0: low, x1: row, y1: high };
}

// Every tile that drops at a fall on these rivers. Nothing else in the water can tilt.
export function getWaterDrops(build: Build, rivers: River[]): TileRect[] {
    return rivers.flatMap((river) => river.drops.map((drop) => getDropTiles(build, river, drop)));
}

// How high the fresh water stands at each corner, and everywhere else the height of the
// nearest water. Water's one level to a piece: wherever two levels meet, the lower wins, and
// only a river's drops part them. That's the rule, so it's worked out on what's really touching
// after everything's been asked for. sea is the tiles of sea, which everything joining it meets.
export function createWaterLevels(
    build: Build,
    rivers: River[],
    pools: Pool[],
    fresh: Float32Array,
    flood: Uint8Array,
    sea?: Uint8Array,
): Float32Array {
    const { terrain, corners, sizeX, sizeY } = build;
    const asked = new Float32Array(fresh.length).fill(Infinity);
    for (const river of rivers) {
        setRiverLevels(build, river);
        const [alongCount, acrossCount] = river.vertical
            ? [corners.y, corners.x]
            : [corners.x, corners.y];
        for (let along = 0; along < alongCount; along++) {
            const centre = riverCentre(river, along);
            const reach = riverHalfWidth(river, along) + 8;
            const first = Math.max(Math.floor(centre - reach), 0);
            const last = Math.min(Math.ceil(centre + reach), acrossCount - 1);
            for (let across = first; across <= last; across++) {
                const i = river.vertical ? across + along * corners.x : along + across * corners.x;
                asked[i] = Math.min(asked[i], river.levels[along]);
            }
        }
    }
    // A pool's as high as its lowest shore
    for (const pool of pools) {
        pool.level = Infinity;
        const reach = pool.radius * 1.5 + 8;
        for (let a = 0; a < 24; a++) {
            const angle = (a / 24) * Math.PI * 2;
            const x = pool.x + Math.cos(angle) * reach;
            const y = pool.y + Math.sin(angle) * reach;
            pool.level = Math.min(pool.level, terrain.getHeight(x, y) - WATER_DROP);
        }
        pool.level = Math.round(Math.max(pool.level, RIVER_BED));
    }
    const tiles = getTouchedTiles(fresh, sizeX, sizeY);
    const cut = new Uint8Array(tiles.length);
    const cutDrop = (river: River, drop: RiverDrop, value: number) => {
        const { x0, y0, x1, y1 } = getDropTiles(build, river, drop);
        for (let y = Math.max(y0, 0); y <= Math.min(y1, sizeY - 1); y++) {
            for (let x = Math.max(x0, 0); x <= Math.min(x1, sizeX - 1); x++) {
                cut[x + y * sizeX] = value;
            }
        }
    };
    rivers.forEach((river) => river.drops.forEach((drop) => cutDrop(river, drop, 1)));

    const forCorners = (i: number, visit: (at: number) => void) => {
        const at = (i % sizeX) + Math.floor(i / sizeX) * corners.x;
        visit(at);
        visit(at + 1);
        visit(at + corners.x);
        visit(at + corners.x + 1);
    };
    // The level a piece of water gets: the least that anything in it asks for
    const solve = () => {
        const pieces = findWaterPieces(build, tiles, cut);
        const wanted = new Map<number, number>();
        const sources = new Set<number>();
        const ask = (piece: number, level: number) => {
            wanted.set(piece, Math.min(wanted.get(piece) ?? Infinity, level));
        };
        const lowest = new Map<number, number>();
        for (let i = 0; i < tiles.length; i++) {
            const piece = pieces[i];
            if (piece < 0) {
                continue;
            }
            forCorners(i, (at) => {
                ask(piece, flood[at] ? RIVER_BED : asked[at]);
                lowest.set(piece, Math.min(lowest.get(piece) ?? Infinity, terrain.height[at]));
            });
            const x = i % sizeX;
            const y = (i - x) / sizeX;
            for (const pool of pools) {
                if (Math.hypot(x + 0.5 - pool.x, y + 0.5 - pool.y) <= pool.radius) {
                    ask(piece, pool.level);
                    if (pool.source) {
                        sources.add(piece);
                    }
                }
            }
            for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, sizeY - 1); ny++) {
                for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, sizeX - 1); nx++) {
                    if (sea?.[nx + ny * sizeX]) {
                        ask(piece, SEA_BED);
                    }
                }
            }
        }
        for (const [piece, level] of wanted) {
            if (level === Infinity) {
                wanted.set(piece, Math.max(lowest.get(piece)! - WATER_DROP, RIVER_BED));
            }
        }
        return { pieces, wanted, sources };
    };
    // What stands on one side of a drop: the row of tiles next to it, in the river
    const pieceBy = (river: River, row: number, { pieces }: ReturnType<typeof solve>) => {
        const across = Math.floor(riverCentre(river, row));
        const inside = across >= 0 && row >= 0 && row < (river.vertical ? sizeY : sizeX);
        return inside ? pieces[river.vertical ? across + row * sizeX : row + across * sizeX] : -1;
    };
    // Levels can come down to meet a pool until a drop isn't one any more: it goes, and its
    // two reaches are one, until nothing changes
    let solved = solve();
    for (let changed = true; changed; ) {
        changed = false;
        for (const river of rivers) {
            for (const drop of river.drops) {
                const [before, after] = [drop.row - 1, drop.row + 1].map((row) =>
                    pieceBy(river, row, solved),
                );
                const [lower, upper] = drop.along === drop.row ? [before, after] : [after, before];
                const gone = lower < 0 || upper < 0 || solved.sources.has(lower);
                const fall = solved.wanted.get(upper)! - solved.wanted.get(lower)!;
                if (gone || fall < LEAST_DROP) {
                    river.drops = river.drops.filter((other) => other !== drop);
                    cutDrop(river, drop, 0);
                    changed = true;
                    break;
                }
            }
        }
        // Cuts can overlap, so put back those still standing
        rivers.forEach((river) => river.drops.forEach((drop) => cutDrop(river, drop, 1)));
        if (changed) {
            solved = solve();
        }
    }

    const levels = new Float32Array(fresh.length).fill(Infinity);
    for (let i = 0; i < tiles.length; i++) {
        const piece = solved.pieces[i];
        if (piece >= 0) {
            const level = solved.wanted.get(piece)!;
            forCorners(i, (at) => {
                levels[at] = Math.min(levels[at], level);
            });
        }
    }
    // What's left of a drop's row, whose corners are its reaches', and what bridges read
    for (const river of rivers) {
        const count = river.levels.length;
        for (let along = 0; along < count; along++) {
            const centre = Math.round(riverCentre(river, along));
            const at = river.vertical ? centre + along * corners.x : along + centre * corners.x;
            if (at >= 0 && at < levels.length && levels[at] !== Infinity) {
                river.levels[along] = levels[at];
            }
        }
    }
    spreadNearest(levels, corners.x, corners.y);
    return levels;
}

// Takes the land down to the fresh water. Tall ground needs a wider valley to get down in,
// as wide as the setting says. toSea leaves the sea's own corners alone.
export function sinkFresh(
    build: Build,
    toFresh: Float32Array,
    levels: Float32Array,
    toSea?: Float32Array,
): void {
    const { terrain, corners, settings } = build;
    const { height } = terrain;
    const slope = lerp(GORGE_SLOPE, VALLEY_SLOPE, settings.riverValley);
    for (let y = 0; y < corners.y; y++) {
        for (let x = 0; x < corners.x; x++) {
            const at = terrain.corner(x, y);
            const level = levels[at];
            if (level === Infinity || (toSea && getCornerDistance(build, toSea, x, y) === 0)) {
                continue;
            }
            const bank = Math.max((height[at] - level) / slope, MIN_BANK);
            const share = Math.min(getCornerDistance(build, toFresh, x, y) / bank, 1);
            height[at] = level + (height[at] - level) * share;
        }
    }
}

// The corners of water tiles: nothing moves them from here on, and nothing can pin them. The
// ground meets the water, never the other way round: a corner of water that moves tilts its tile.
export function holdWater(build: Build, tiles: Uint8Array): void {
    const { sizeX, sizeY, corners, heldCorners, terrain } = build;
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            if (tiles[x + y * sizeX]) {
                const at = x + y * corners.x;
                for (const corner of [at, at + 1, at + corners.x, at + corners.x + 1]) {
                    heldCorners[corner] = 1;
                    terrain.lock(corner);
                }
            }
        }
    }
}

// Foam along the foot of a river's drops
export function placeWaterfalls(build: Build, rivers: River[]): void {
    const { ground, biomeAt } = build;
    for (const river of rivers) {
        for (const { along } of river.drops) {
            const centre = riverCentre(river, along);
            const half = riverHalfWidth(river, along);
            const middle = Math.round(centre);
            if ((river.vertical ? biomeAt(middle, along) : biomeAt(along, middle)).molten) {
                continue;
            }
            for (let at = -half; at + WATERFALL_WIDTH <= half; at += WATERFALL_WIDTH) {
                const across = Math.round(centre + at);
                ground.grid.locs.push({
                    id: WATERFALL,
                    type: LOC_NORMAL,
                    rotation: river.vertical ? 0 : 1,
                    level: 0,
                    x: river.vertical ? across : along,
                    y: river.vertical ? along : across,
                });
            }
        }
    }
}

// A river's line at a crossing: bridges stand on whole tiles
export function getCrossingLine(river: River, crossing: number): number {
    return Math.round(riverLine(river, crossing));
}
