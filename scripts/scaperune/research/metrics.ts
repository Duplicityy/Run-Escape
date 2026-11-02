// One set of measurements for any TileGrid, real or made, so the two can be compared. Each
// returns a small summary, not raw tiles.
import { SOLID_FLAGS } from "../../../src/game/core/world/ArenaGrid";
import { canStep } from "../../../src/game/core/world/FlowField";
import { getCollisionFlags, getStepGrid } from "../../../src/game/scaperune/collision";
import {
    TILE_BLOCKED,
    TILE_BRIDGE,
    TILE_INSIDE,
    TileGrid,
} from "../../../src/game/scaperune/format";
import { getTileSlope } from "../../../src/game/scaperune/terrain";
import { LocMeta, bump, locLabel, percentile, round, top } from "./lib";

export type Locs = (id: number) => LocMeta;

export const SLOPE_BANDS = [0, 1, 3, 5, 9, 13, 17, 25, 33, 45, 65, 256];
const bandName = (i: number) => `${SLOPE_BANDS[i]}-${SLOPE_BANDS[i + 1] - 1}`;

const WALL_TYPES = new Set([0, 1, 2, 3]);
const WALL_DECO = new Set([4, 5, 6, 7, 8]);
const isRoof = (type: number) => type >= 12 && type <= 21;
const TREE = /tree|oak|willow|maple|yew|magic|mahogany|teak|redwood|palm|pine|dead/i;

export function locGroup(type: number): string {
    if (WALL_TYPES.has(type)) return "wall";
    if (WALL_DECO.has(type)) return "wallDeco";
    if (type === 9) return "diagonal";
    if (type === 10 || type === 11) return "scenery";
    if (isRoof(type)) return "roof";
    return "ground";
}

// Everything the measures share about a grid
export type Prepared = ReturnType<typeof prepare>;

export function prepare(grid: TileGrid, locs: Locs) {
    const { sizeX, sizeY } = grid;
    const n = sizeX * sizeY;
    const cornersX = sizeX + 1;
    const level0 = grid.levels[0];
    const collision = getCollisionFlags(grid, (id) => {
        const m = locs(id);
        return {
            name: m.name,
            sizeX: m.sizeX,
            sizeY: m.sizeY,
            clipType: m.clipType,
            blocksProjectile: m.blocksProjectile,
            drawn: m.hasModel,
        };
    });
    const rect = { x0: 0, y0: 0, x1: sizeX - 1, y1: sizeY - 1 };
    const step = getStepGrid(collision, sizeX, rect);
    // The biggest piece of ground you can walk round
    const piece = new Int32Array(n);
    let best = 0;
    let bestSize = 0;
    let next = 0;
    const DX = [0, 1, 0, -1, 1, 1, -1, -1];
    const DY = [1, 0, -1, 0, 1, -1, -1, 1];
    for (let start = 0; start < n; start++) {
        const sx = start % sizeX;
        const sy = (start / sizeX) | 0;
        if (piece[start] || step.isSolid(sx, sy)) {
            continue;
        }
        next++;
        piece[start] = next;
        const queue = [start];
        let size = 0;
        while (queue.length > 0) {
            const i = queue.pop()!;
            size++;
            const x = i % sizeX;
            const y = (i / sizeX) | 0;
            for (let d = 0; d < 8; d++) {
                const tx = x + DX[d];
                const ty = y + DY[d];
                if (tx < 0 || ty < 0 || tx >= sizeX || ty >= sizeY) continue;
                const j = tx + ty * sizeX;
                if (!piece[j] && !step.isSolid(tx, ty) && canStep(step, x, y, DX[d], DY[d])) {
                    piece[j] = next;
                    queue.push(j);
                }
            }
        }
        if (size > bestSize) {
            bestSize = size;
            best = next;
        }
    }
    const walkable = new Uint8Array(n);
    const open = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        walkable[i] = piece[i] === best ? 1 : 0;
        open[i] = piece[i] ? 1 : 0;
    }
    const slope = new Uint8Array(n);
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            slope[x + y * sizeX] = getTileSlope(level0.heights, cornersX, x, y);
        }
    }
    // Which sides of a tile have a wall on them: 1 west, 2 north, 4 east, 8 south
    const wallSides = new Uint8Array(n);
    for (const loc of grid.locs) {
        if (loc.level !== 0 || !WALL_TYPES.has(loc.type) || locs(loc.id).clipType === 0) continue;
        const i = loc.x + loc.y * sizeX;
        const side = 1 << loc.rotation;
        if (loc.type === 0) wallSides[i] |= side;
        if (loc.type === 2) wallSides[i] |= side | (1 << ((loc.rotation + 1) & 3));
    }
    const inside = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        inside[i] = level0.flags[i] & TILE_INSIDE ? 1 : 0;
    }
    return {
        grid,
        locs,
        sizeX,
        sizeY,
        n,
        level0,
        collision,
        walkable,
        open,
        slope,
        wallSides,
        inside,
    };
}

export function measureHeight(p: Prepared) {
    const { n, slope, walkable, level0, sizeX } = p;
    const bands = new Array(SLOPE_BANDS.length - 1).fill(0);
    const walkBands = new Array(SLOPE_BANDS.length - 1).fill(0);
    const walkSlopes: number[] = [];
    const allSlopes: number[] = [];
    for (let i = 0; i < n; i++) {
        const s = slope[i];
        const band = SLOPE_BANDS.findIndex((v, b) => s >= v && s < SLOPE_BANDS[b + 1]);
        bands[band]++;
        allSlopes.push(s);
        if (walkable[i]) {
            walkBands[band]++;
            walkSlopes.push(s);
        }
    }
    walkSlopes.sort((a, b) => a - b);
    allSlopes.sort((a, b) => a - b);
    let min = 255;
    let max = 0;
    for (const h of level0.heights) {
        min = Math.min(min, h);
        max = Math.max(max, h);
    }
    const share = (a: number[], total: number) =>
        Object.fromEntries(
            a.map((v, i) => [bandName(i), round((100 * v) / Math.max(total, 1), 1)]),
        );
    return {
        heightRange: [min, max],
        walkableShare: round(walkSlopes.length / n),
        slopeSharePct: share(bands, n),
        walkSlopeSharePct: share(walkBands, walkSlopes.length),
        walkSlope: {
            p50: percentile(walkSlopes, 0.5),
            p90: percentile(walkSlopes, 0.9),
            p99: percentile(walkSlopes, 0.99),
            p999: percentile(walkSlopes, 0.999),
            max: walkSlopes[walkSlopes.length - 1] ?? 0,
        },
        steepest: allSlopes[allSlopes.length - 1] ?? 0,
        sizeX,
    };
}

export function measureGround(p: Prepared) {
    const { n, sizeX, sizeY, level0, walkable, inside } = p;
    const underlays = new Map<number, number>();
    const overlays = new Map<number, number>();
    const shapes = new Map<number, number>();
    let overlaid = 0;
    let blocked = 0;
    for (let i = 0; i < n; i++) {
        if (level0.underlays[i]) bump(underlays, level0.underlays[i]);
        if (level0.overlays[i]) {
            bump(overlays, level0.overlays[i]);
            bump(shapes, level0.shapes[i]);
            overlaid++;
        }
        if (level0.flags[i] & TILE_BLOCKED) blocked++;
    }
    // Paths: an overlay you walk on, outdoors, with enough of it to matter. Width's the
    // shorter of the runs of that overlay across a tile, taken along the two axes
    const roadStats = [];
    for (const [id, count] of top(overlays, 12)) {
        const tiles: number[] = [];
        const widths: number[] = [];
        let edge = 0;
        let shapedEdge = 0;
        for (let i = 0; i < n; i++) {
            if (level0.overlays[i] !== id || !walkable[i] || inside[i]) continue;
            tiles.push(i);
            const x = i % sizeX;
            const y = (i / sizeX) | 0;
            const same = (tx: number, ty: number) =>
                tx >= 0 &&
                ty >= 0 &&
                tx < sizeX &&
                ty < sizeY &&
                level0.overlays[tx + ty * sizeX] === id;
            let a = 1;
            for (let t = x - 1; same(t, y); t--) a++;
            for (let t = x + 1; same(t, y); t++) a++;
            let b = 1;
            for (let t = y - 1; same(x, t); t--) b++;
            for (let t = y + 1; same(x, t); t++) b++;
            widths.push(Math.min(a, b));
            const isEdge = !same(x - 1, y) || !same(x + 1, y) || !same(x, y - 1) || !same(x, y + 1);
            if (isEdge) {
                edge++;
                if (level0.shapes[i] !== 0) shapedEdge++;
            }
        }
        if (tiles.length < 30) continue;
        widths.sort((u, v) => u - v);
        roadStats.push({
            overlay: id,
            walkTiles: tiles.length,
            sharePct: round((100 * count) / n, 1),
            width: {
                p25: percentile(widths, 0.25),
                p50: percentile(widths, 0.5),
                p75: percentile(widths, 0.75),
                p95: percentile(widths, 0.95),
            },
            shapedEdgePct: round((100 * shapedEdge) / Math.max(edge, 1)),
        });
    }
    const shapeTotal = [...shapes.values()].reduce((a, b) => a + b, 0);
    return {
        underlayKinds: underlays.size,
        topUnderlays: top(underlays, 8),
        overlayKinds: overlays.size,
        overlaySharePct: round((100 * overlaid) / n, 1),
        topOverlays: top(overlays, 10),
        shapeSharePct: Object.fromEntries(
            [...shapes]
                .sort((a, b) => a[0] - b[0])
                .map(([k, v]) => [k, round((100 * v) / shapeTotal, 1)]),
        ),
        blockedSharePct: round((100 * blocked) / n, 1),
        paths: roadStats,
    };
}

export function measureObjects(p: Prepared) {
    const { grid, locs, sizeX, sizeY, n, wallSides, walkable, inside } = p;
    const per100 = (v: number) => round((100 * v) / n, 2);
    const groups = new Map<string, number>();
    const types = new Map<number, number>();
    const byGroup = new Map<string, Map<string, number>>();
    const rotations = new Map<string, number[]>();
    const sizes = new Map<number, number>();
    const scenery: { x: number; y: number; id: number; tree: boolean; big: number }[] = [];
    let solid = 0;
    let soft = 0;
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const meta = locs(loc.id);
        const group = locGroup(loc.type);
        if (group === "scenery") {
            if (meta.clipType === 0) soft++;
            else solid++;
        }
        bump(groups, group);
        bump(types, loc.type);
        if (!byGroup.has(group)) byGroup.set(group, new Map());
        bump(byGroup.get(group)!, `${locLabel(meta)}:${loc.id}`);
        if (!rotations.has(group)) rotations.set(group, [0, 0, 0, 0]);
        rotations.get(group)![loc.rotation]++;
        if (group === "scenery") {
            bump(sizes, Math.max(meta.sizeX, meta.sizeY));
            scenery.push({
                x: loc.x,
                y: loc.y,
                id: loc.id,
                tree: TREE.test(meta.name ?? ""),
                big: Math.max(meta.sizeX, meta.sizeY),
            });
        }
    }
    // Scenery against a wall: on a tile with a wall on it, or next to one
    let against = 0;
    let indoors = 0;
    const props = scenery.filter((s) => !s.tree);
    for (const s of props) {
        const i = s.x + s.y * sizeX;
        if (inside[i]) indoors++;
        let hit = wallSides[i] !== 0;
        for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ]) {
            const tx = s.x + dx;
            const ty = s.y + dy;
            if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && wallSides[tx + ty * sizeX])
                hit = true;
        }
        if (hit) against++;
    }
    // Clusters of props, 2 tiles apart at most
    const parent = props.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const buckets = new Map<number, number[]>();
    const key = (x: number, y: number) => (x >> 3) + (y >> 3) * 1024;
    props.forEach((s, i) => {
        const k = key(s.x, s.y);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(i);
    });
    props.forEach((s, i) => {
        for (let bx = -1; bx <= 1; bx++) {
            for (let by = -1; by <= 1; by++) {
                for (const j of buckets.get(key(s.x + bx * 8, s.y + by * 8)) ?? []) {
                    const o = props[j];
                    if (j > i && Math.max(Math.abs(o.x - s.x), Math.abs(o.y - s.y)) <= 2) {
                        parent[find(i)] = find(j);
                    }
                }
            }
        }
    });
    const clusterSizes = new Map<number, number>();
    props.forEach((_, i) => bump(clusterSizes, find(i)));
    const sizesSorted = [...clusterSizes.values()].sort((a, b) => a - b);
    // Trees: how they're clumped, by distance to the nearest tree
    const trees = scenery.filter((s) => s.tree);
    const nearest: number[] = [];
    const treeBuckets = new Map<number, typeof trees>();
    for (const t of trees) {
        const k = key(t.x, t.y);
        if (!treeBuckets.has(k)) treeBuckets.set(k, []);
        treeBuckets.get(k)!.push(t);
    }
    for (const t of trees) {
        let best = 99;
        for (let bx = -2; bx <= 2; bx++) {
            for (let by = -2; by <= 2; by++) {
                for (const o of treeBuckets.get(key(t.x + bx * 8, t.y + by * 8)) ?? []) {
                    if (o !== t) best = Math.min(best, Math.hypot(o.x - t.x, o.y - t.y));
                }
            }
        }
        nearest.push(best);
    }
    nearest.sort((a, b) => a - b);
    let walk = 0;
    for (let i = 0; i < n; i++) walk += walkable[i];
    return {
        locsPer100Tiles: per100([...groups.values()].reduce((a, b) => a + b, 0)),
        groupPer100: Object.fromEntries([...groups].map(([k, v]) => [k, per100(v)])),
        typeCounts: Object.fromEntries([...types].sort((a, b) => a[0] - b[0])),
        rotationSharePct: Object.fromEntries(
            [...rotations].map(([k, r]) => {
                const t = r.reduce((a, b) => a + b, 0);
                return [k, r.map((v) => round((100 * v) / t, 0))];
            }),
        ),
        solidSceneryPer100: per100(solid),
        softSceneryPer100: per100(soft),
        scenerySize: Object.fromEntries([...sizes].sort((a, b) => a[0] - b[0])),
        kinds: Object.fromEntries([...byGroup].map(([k, v]) => [k, v.size])),
        topByGroup: Object.fromEntries([...byGroup].map(([k, v]) => [k, top(v, 8)])),
        props: {
            count: props.length,
            per100: per100(props.length),
            againstWallPct: round((100 * against) / Math.max(props.length, 1), 0),
            indoorsPct: round((100 * indoors) / Math.max(props.length, 1), 0),
            clusterP50: percentile(sizesSorted, 0.5),
            clusterP90: percentile(sizesSorted, 0.9),
            clusterMax: sizesSorted[sizesSorted.length - 1] ?? 0,
            singletonsPct: round(
                (100 * sizesSorted.filter((v) => v === 1).length) / Math.max(sizesSorted.length, 1),
                0,
            ),
        },
        trees: {
            count: trees.length,
            per100: per100(trees.length),
            nearestP25: round(percentile(nearest, 0.25), 1),
            nearestP50: round(percentile(nearest, 0.5), 1),
            nearestP75: round(percentile(nearest, 0.75), 1),
        },
        walkableTiles: walk,
        sizeY,
    };
}

export function measureTowns(p: Prepared) {
    const { grid, locs, sizeX, sizeY, n, inside, level0, wallSides } = p;
    // Buildings: pieces of indoor tiles
    const labels = new Int32Array(n);
    type B = { area: number; x0: number; y0: number; x1: number; y1: number };
    const buildings: B[] = [];
    for (let start = 0; start < n; start++) {
        if (!inside[start] || labels[start]) continue;
        const label = buildings.length + 1;
        const b: B = { area: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
        const queue = [start];
        labels[start] = label;
        while (queue.length > 0) {
            const i = queue.pop()!;
            const x = i % sizeX;
            const y = (i / sizeX) | 0;
            b.area++;
            b.x0 = Math.min(b.x0, x);
            b.y0 = Math.min(b.y0, y);
            b.x1 = Math.max(b.x1, x);
            b.y1 = Math.max(b.y1, y);
            for (const j of [i - 1, i + 1, i - sizeX, i + sizeX]) {
                if (j >= 0 && j < n && Math.abs((j % sizeX) - x) <= 1 && inside[j] && !labels[j]) {
                    labels[j] = label;
                    queue.push(j);
                }
            }
        }
        buildings.push(b);
    }
    const real = buildings.filter((b) => b.area >= 6);
    const areas = real.map((b) => b.area).sort((a, b) => a - b);
    const longSides = real.map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1).sort((a, b) => a - b);
    const shortSides = real
        .map((b) => Math.min(b.x1 - b.x0, b.y1 - b.y0) + 1)
        .sort((a, b) => a - b);
    const fill = real
        .map((b) => b.area / ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)))
        .sort((a, b) => a - b);
    // The gap to the nearest other building, side to side
    const gaps: number[] = [];
    for (const b of real) {
        let best = 99;
        for (const o of real) {
            if (o === b) continue;
            const dx = Math.max(o.x0 - b.x1, b.x0 - o.x1, 0);
            const dy = Math.max(o.y0 - b.y1, b.y0 - o.y1, 0);
            best = Math.min(best, Math.max(dx, dy));
        }
        gaps.push(best);
    }
    gaps.sort((a, b) => a - b);
    // Streets: the open runs between two buildings along a row or a column
    const streets: number[] = [];
    const scan = (lines: number, along: number, at: (l: number, a: number) => number) => {
        for (let l = 0; l < lines; l++) {
            let last = -1;
            for (let a = 0; a < along; a++) {
                if (inside[at(l, a)]) {
                    if (last >= 0 && a - last > 1 && a - last <= 32) streets.push(a - last - 1);
                    last = a;
                }
            }
        }
    };
    scan(sizeY, sizeX, (l, a) => a + l * sizeX);
    scan(sizeX, sizeY, (l, a) => l + a * sizeX);
    streets.sort((a, b) => a - b);
    // Wall kits: what the walls of buildings are made of. A wall on or next to an indoor tile
    const kit = new Map<string, number>();
    const floors = new Map<number, number>();
    const furniture = new Map<string, number>();
    let indoor = 0;
    let furnished = 0;
    let wallLocs = 0;
    let diagonalWalls = 0;
    for (let i = 0; i < n; i++) {
        if (inside[i]) {
            indoor++;
            bump(floors, level0.overlays[i]);
        }
    }
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const i = loc.x + loc.y * sizeX;
        const near =
            inside[i] ||
            (loc.x > 0 && inside[i - 1]) ||
            (loc.x < sizeX - 1 && inside[i + 1]) ||
            (loc.y > 0 && inside[i - sizeX]) ||
            (loc.y < sizeY - 1 && inside[i + sizeX]);
        if ((WALL_TYPES.has(loc.type) || loc.type === 9) && near) {
            wallLocs++;
            if (loc.type === 9) diagonalWalls++;
            bump(kit, `${loc.id}`);
        } else if ((loc.type === 10 || loc.type === 11 || loc.type === 22) && inside[i]) {
            furnished++;
            bump(furniture, locLabel(locs(loc.id)));
        }
    }
    const kitSorted = [...kit.values()].sort((a, b) => b - a);
    let covered = 0;
    let kitsFor90 = 0;
    for (const v of kitSorted) {
        if (covered >= 0.9 * wallLocs) break;
        covered += v;
        kitsFor90++;
    }
    // Upper levels and roofs
    const upper = [0, 0, 0, 0];
    const roofs = new Map<string, number>();
    for (let level = 1; level < 4; level++) {
        for (let i = 0; i < n; i++) {
            if (
                grid.levels[level].flags[i] & TILE_INSIDE &&
                !(grid.levels[level].flags[i] & TILE_BRIDGE)
            )
                upper[level]++;
        }
    }
    let roofLocs = 0;
    for (const loc of grid.locs) {
        if (isRoof(loc.type)) {
            roofLocs++;
            bump(roofs, `${loc.id}`);
        }
    }
    const pct = (a: number[], q: number) => round(percentile(a, q), 1);
    const q3 = (a: number[]) => [pct(a, 0.25), pct(a, 0.5), pct(a, 0.75), pct(a, 0.95)];
    return {
        buildings: real.length,
        smallIndoorBits: buildings.length - real.length,
        indoorSharePct: round((100 * indoor) / n, 1),
        areaQ: q3(areas),
        longSideQ: q3(longSides),
        shortSideQ: q3(shortSides),
        fillQ: q3(fill),
        gapQ: q3(gaps),
        streetQ: q3(streets),
        wallLocs,
        wallKinds: kit.size,
        wallKindsFor90Pct: kitsFor90,
        diagonalWallPct: round((100 * diagonalWalls) / Math.max(wallLocs, 1), 1),
        topWalls: top(kit, 6).map(([id, v]) => [`${locLabel(locs(Number(id)))}:${id}`, v]),
        indoorFloors: top(floors, 5),
        furniturePer100Indoor: round((100 * furnished) / Math.max(indoor, 1), 1),
        topFurniture: top(furniture, 10),
        upperIndoorTiles: upper.slice(1),
        roofLocs,
        roofKinds: roofs.size,
        wallSidesUnused: wallSides.length === 0,
        sizeY,
    };
}

// What the player sees: the screen at the default zoom is about 27 by 16 tiles
export function measurePacing(p: Prepared) {
    const { grid, locs, sizeX, sizeY, n, walkable, slope, inside } = p;
    const screenX = 27;
    const screenY = 16;
    const objects = new Uint16Array(n);
    const kindsAt: number[][] = Array.from({ length: n }, () => []);
    const landmark: { x: number; y: number; size: number; name: string }[] = [];
    const icons: { x: number; y: number; name: string; fn: number }[] = [];
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const meta = locs(loc.id);
        const i = loc.x + loc.y * sizeX;
        if (loc.type !== 22) {
            objects[i]++;
            kindsAt[i].push(loc.id);
        }
        if ((loc.type === 10 || loc.type === 11) && Math.max(meta.sizeX, meta.sizeY) >= 3) {
            landmark.push({
                x: loc.x,
                y: loc.y,
                size: Math.max(meta.sizeX, meta.sizeY),
                name: locLabel(meta),
            });
        }
        if (meta.mapFunctionId >= 0) {
            icons.push({ x: loc.x, y: loc.y, name: locLabel(meta), fn: meta.mapFunctionId });
        }
    }
    // Screens over walkable ground: how much is in each
    const counts: number[] = [];
    const kinds: number[] = [];
    for (let y = 0; y + screenY <= sizeY; y += 5) {
        for (let x = 0; x + screenX <= sizeX; x += 9) {
            let walk = 0;
            let count = 0;
            const seen = new Set<number>();
            for (let ty = y; ty < y + screenY; ty++) {
                for (let tx = x; tx < x + screenX; tx++) {
                    const i = tx + ty * sizeX;
                    walk += walkable[i];
                    count += objects[i];
                    for (const id of kindsAt[i]) seen.add(id);
                }
            }
            if (walk >= (screenX * screenY) / 2) {
                counts.push(count);
                kinds.push(seen.size);
            }
        }
    }
    counts.sort((a, b) => a - b);
    kinds.sort((a, b) => a - b);
    // How far each walkable tile is from anything standing, chessboard distance, in two passes
    const far = new Float32Array(n).fill(1e6);
    for (let i = 0; i < n; i++) {
        if (objects[i] || !p.open[i]) far[i] = 0;
    }
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const i = x + y * sizeX;
            if (x > 0) far[i] = Math.min(far[i], far[i - 1] + 1);
            if (y > 0) far[i] = Math.min(far[i], far[i - sizeX] + 1);
            if (x > 0 && y > 0) far[i] = Math.min(far[i], far[i - 1 - sizeX] + 1);
            if (x < sizeX - 1 && y > 0) far[i] = Math.min(far[i], far[i + 1 - sizeX] + 1);
        }
    }
    for (let y = sizeY - 1; y >= 0; y--) {
        for (let x = sizeX - 1; x >= 0; x--) {
            const i = x + y * sizeX;
            if (x < sizeX - 1) far[i] = Math.min(far[i], far[i + 1] + 1);
            if (y < sizeY - 1) far[i] = Math.min(far[i], far[i + sizeX] + 1);
            if (x < sizeX - 1 && y < sizeY - 1) far[i] = Math.min(far[i], far[i + 1 + sizeX] + 1);
            if (x > 0 && y < sizeY - 1) far[i] = Math.min(far[i], far[i - 1 + sizeX] + 1);
        }
    }
    const distances: number[] = [];
    let flatOpen = 0;
    let walk = 0;
    for (let i = 0; i < n; i++) {
        if (walkable[i]) {
            walk++;
            distances.push(far[i]);
            if (far[i] >= 8) flatOpen++;
        }
    }
    distances.sort((a, b) => a - b);
    // The gap between neighbouring icons, then landmarks
    const nearestGap = (points: { x: number; y: number }[]) => {
        const out: number[] = [];
        for (const a of points) {
            let best = 1e9;
            for (const b of points) {
                if (a !== b) {
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (d > 2) best = Math.min(best, d);
                }
            }
            if (best < 1e9) out.push(best);
        }
        return out.sort((u, v) => u - v);
    };
    const iconGaps = nearestGap(icons);
    const landmarkGaps = nearestGap(landmark);
    const iconNames = new Map<string, number>();
    for (const icon of icons) bump(iconNames, icon.name);
    let indoor = 0;
    for (let i = 0; i < n; i++) indoor += inside[i];
    return {
        screens: counts.length,
        objectsOnScreen: {
            p10: percentile(counts, 0.1),
            p50: percentile(counts, 0.5),
            p90: percentile(counts, 0.9),
        },
        kindsOnScreen: {
            p10: percentile(kinds, 0.1),
            p50: percentile(kinds, 0.5),
            p90: percentile(kinds, 0.9),
        },
        emptyScreensPct: round(
            (100 * counts.filter((c) => c < 8).length) / Math.max(counts.length, 1),
            1,
        ),
        tilesFromAnything: {
            p50: percentile(distances, 0.5),
            p90: percentile(distances, 0.9),
            max: distances[distances.length - 1] ?? 0,
        },
        openGroundPct: round((100 * flatOpen) / Math.max(walk, 1), 1),
        iconsPer10k: round((10000 * icons.length) / n, 1),
        iconGapP50: round(percentile(iconGaps, 0.5), 1),
        topIcons: top(iconNames, 8),
        landmarksPer10k: round((10000 * landmark.length) / n, 1),
        landmarkGapP50: round(percentile(landmarkGaps, 0.5), 1),
        topLandmarks: top(
            new Map(landmark.reduce((m, l) => (bump(m, l.name), m), new Map<string, number>())),
            8,
        ),
        slopeUnused: slope.length === 0,
        sizeX,
        sizeY,
        indoor,
    };
}

// Pairs of props standing within 2 tiles of each other. Adds to counts kept across areas
export function addCooccurrence(
    p: Prepared,
    pairs: Map<string, number>,
    singles: Map<string, number>,
): void {
    const { grid, locs } = p;
    const items: { x: number; y: number; name: string }[] = [];
    for (const loc of grid.locs) {
        if (loc.level !== 0 || (loc.type !== 10 && loc.type !== 11)) continue;
        const name = locs(loc.id).name;
        if (!name || name === "null" || TREE.test(name)) continue;
        items.push({ x: loc.x, y: loc.y, name });
    }
    const buckets = new Map<number, typeof items>();
    const key = (x: number, y: number) => (x >> 3) + (y >> 3) * 1024;
    for (const item of items) {
        const k = key(item.x, item.y);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(item);
        bump(singles, item.name);
    }
    for (const a of items) {
        for (let bx = -1; bx <= 1; bx++) {
            for (let by = -1; by <= 1; by++) {
                for (const b of buckets.get(key(a.x + bx * 8, a.y + by * 8)) ?? []) {
                    if (
                        a.name < b.name &&
                        Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 2
                    ) {
                        bump(pairs, `${a.name}|${b.name}`);
                    }
                }
            }
        }
    }
}

// Faces: runs along a row or column where the ground keeps falling by at least minStep a
// tile. A face's drop, how many tiles it takes, and what's at its foot and on it
export function measureFaces(p: Prepared, minStep = 8) {
    const { grid, sizeX, sizeY, level0, walkable, locs } = p;
    const cornersX = sizeX + 1;
    const h = (x: number, y: number) => level0.heights[x + y * cornersX];
    type Run = { drop: number; length: number; blocked: number; ends: number };
    const runs: Run[] = [];
    const scan = (dx: number, dy: number) => {
        const lines = dx ? sizeY : sizeX;
        const along = dx ? sizeX : sizeY;
        for (let l = 0; l < lines; l++) {
            let start = -1;
            let sign = 0;
            const close = (end: number) => {
                if (start >= 0 && end > start) {
                    const a = dx ? h(start, l) : h(l, start);
                    const b = dx ? h(end, l) : h(l, end);
                    let blocked = 0;
                    for (let t = start; t < end; t++) {
                        const i = dx ? t + l * sizeX : l + t * sizeX;
                        if (!walkable[i]) blocked++;
                    }
                    // How flat the ground is just past each end of it
                    const at = (t: number) => (dx ? h(t, l) : h(l, t));
                    const top = start > 0 ? Math.abs(at(start) - at(start - 1)) : 0;
                    const foot = end < along ? Math.abs(at(end) - at(end + 1)) : 0;
                    runs.push({
                        drop: Math.abs(a - b),
                        length: end - start,
                        blocked,
                        ends: Math.max(top, foot),
                    });
                }
                start = -1;
                sign = 0;
            };
            for (let t = 0; t < along; t++) {
                const a = dx ? h(t, l) : h(l, t);
                const b = dx ? h(t + 1, l) : h(l, t + 1);
                const d = b - a;
                const s = Math.abs(d) >= minStep ? Math.sign(d) : 0;
                if (s === 0 || (sign !== 0 && s !== sign)) {
                    close(t);
                }
                if (s !== 0 && start < 0) {
                    start = t;
                    sign = s;
                }
            }
            close(along);
        }
    };
    scan(1, 0);
    scan(0, 1);
    const big = runs.filter((r) => r.drop >= 24);
    const drops = big.map((r) => r.drop).sort((a, b) => a - b);
    const lengths = big.map((r) => r.length).sort((a, b) => a - b);
    const steep = big.map((r) => r.drop / r.length).sort((a, b) => a - b);
    const ends = big.map((r) => r.ends).sort((a, b) => a - b);
    const flatEnds = big.filter((r) => r.ends <= 2).length;
    const blockedShare =
        big.reduce((s, r) => s + r.blocked / r.length, 0) / Math.max(big.length, 1);
    // What stands on steep tiles
    const onSteep = new Map<string, number>();
    const steepThreshold = 16;
    const steepTile = new Uint8Array(p.n);
    let steepCount = 0;
    for (let i = 0; i < p.n; i++) {
        if (p.slope[i] >= steepThreshold) {
            steepTile[i] = 1;
            steepCount++;
        }
    }
    const covered = new Uint8Array(p.n);
    const rotations = new Map<string, number[]>();
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const i = loc.x + loc.y * sizeX;
        if (!steepTile[i]) continue;
        covered[i] = 1;
        const meta = locs(loc.id);
        const k = `${locLabel(meta)}:${loc.id}:t${loc.type}:s${meta.sizeX}x${meta.sizeY}:c${meta.contoured}`;
        bump(onSteep, k);
        if (!rotations.has(k)) rotations.set(k, [0, 0, 0, 0]);
        rotations.get(k)![loc.rotation]++;
    }
    let coveredCount = 0;
    let steepOverlaid = 0;
    let steepBlockedFlag = 0;
    const steepOverlays = new Map<number, number>();
    for (let i = 0; i < p.n; i++) {
        coveredCount += covered[i];
        if (steepTile[i]) {
            if (level0.overlays[i]) {
                steepOverlaid++;
                bump(steepOverlays, level0.overlays[i]);
            }
            if (level0.flags[i] & TILE_BLOCKED) steepBlockedFlag++;
        }
    }
    return {
        faces24up: big.length,
        dropQ: [
            percentile(drops, 0.5),
            percentile(drops, 0.9),
            percentile(drops, 0.99),
            drops[drops.length - 1] ?? 0,
        ],
        lengthQ: [
            percentile(lengths, 0.5),
            percentile(lengths, 0.9),
            lengths[lengths.length - 1] ?? 0,
        ],
        perTileQ: [
            round(percentile(steep, 0.1), 1),
            round(percentile(steep, 0.5), 1),
            round(percentile(steep, 0.9), 1),
        ],
        blockedPct: round(100 * blockedShare, 0),
        endStepQ: [percentile(ends, 0.5), percentile(ends, 0.9)],
        flatEndsPct: round((100 * flatEnds) / Math.max(big.length, 1), 0),
        steepTiles: steepCount,
        steepWithLocPct: round((100 * coveredCount) / Math.max(steepCount, 1), 0),
        steepOverlaidPct: round((100 * steepOverlaid) / Math.max(steepCount, 1), 0),
        steepBlockedFlagPct: round((100 * steepBlockedFlag) / Math.max(steepCount, 1), 0),
        steepOverlays: top(steepOverlays, 5),
        onSteep: top(onSteep, 14).map(([k, v]) => [k, v, rotations.get(k)]),
    };
}

const DOOR = /\b(door|gate)\b/i;

// Yards, fields and pens: outdoor ground closed in by walls, however big, up to a cap
export function measureEnclosures(p: Prepared, cap = 900) {
    const { sizeX, sizeY, n, wallSides, inside, grid, locs } = p;
    const seen = new Uint8Array(n);
    const areas: number[] = [];
    const blockedBetween = (x: number, y: number, side: number) => {
        // side: 0 west, 1 north, 2 east, 3 south
        const i = x + y * sizeX;
        if (wallSides[i] & (1 << side)) return true;
        const j = side === 0 ? i - 1 : side === 2 ? i + 1 : side === 1 ? i + sizeX : i - sizeX;
        return (wallSides[j] & (1 << ((side + 2) & 3))) !== 0;
    };
    for (let start = 0; start < n; start++) {
        if (seen[start] || inside[start]) continue;
        const queue = [start];
        const tiles = [start];
        seen[start] = 1;
        let touchesEdge = false;
        while (queue.length > 0) {
            const i = queue.pop()!;
            const x = i % sizeX;
            const y = (i / sizeX) | 0;
            for (let side = 0; side < 4; side++) {
                const tx = x + (side === 0 ? -1 : side === 2 ? 1 : 0);
                const ty = y + (side === 1 ? 1 : side === 3 ? -1 : 0);
                if (tx < 0 || ty < 0 || tx >= sizeX || ty >= sizeY) {
                    touchesEdge = true;
                    continue;
                }
                const j = tx + ty * sizeX;
                if (seen[j] || inside[j] || blockedBetween(x, y, side)) continue;
                seen[j] = 1;
                queue.push(j);
                tiles.push(j);
            }
        }
        if (!touchesEdge && tiles.length >= 6 && tiles.length <= cap) areas.push(tiles.length);
    }
    areas.sort((a, b) => a - b);
    // Walls that don't touch a building: fences and yard walls
    let free = 0;
    let all = 0;
    const kinds = new Map<string, number>();
    for (const loc of grid.locs) {
        if (loc.level !== 0 || !WALL_TYPES.has(loc.type)) continue;
        all++;
        const i = loc.x + loc.y * sizeX;
        const near =
            inside[i] ||
            (loc.x > 0 && inside[i - 1]) ||
            (loc.x < sizeX - 1 && inside[i + 1]) ||
            (loc.y > 0 && inside[i - sizeX]) ||
            (loc.y < sizeY - 1 && inside[i + sizeX]);
        if (!near) {
            free++;
            bump(kinds, `${locLabel(locs(loc.id))}:${loc.id}`);
        }
    }
    return {
        enclosures: areas.length,
        areaQ: [
            percentile(areas, 0.25),
            percentile(areas, 0.5),
            percentile(areas, 0.75),
            percentile(areas, 0.95),
        ],
        freeWallSharePct: round((100 * free) / Math.max(all, 1), 0),
        freeWallsPer100: round((100 * free) / n, 2),
        topFreeWalls: top(kinds, 6),
        sizeY,
    };
}

// How density falls off round the middle of the buildings: rings 16 tiles wide
export function measureRings(p: Prepared) {
    const { grid, sizeX, sizeY, inside, n, locs } = p;
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
        if (inside[i]) {
            cx += i % sizeX;
            cy += (i / sizeX) | 0;
            count++;
        }
    }
    if (count === 0) return { rings: [] };
    cx /= count;
    cy /= count;
    const rings = Array.from({ length: 6 }, () => ({
        tiles: 0,
        indoor: 0,
        walls: 0,
        props: 0,
        trees: 0,
        decor: 0,
    }));
    const ringOf = (x: number, y: number) =>
        Math.floor(Math.max(Math.abs(x - cx), Math.abs(y - cy)) / 16);
    for (let i = 0; i < n; i++) {
        const r = ringOf(i % sizeX, (i / sizeX) | 0);
        if (r < 6) {
            rings[r].tiles++;
            rings[r].indoor += inside[i];
        }
    }
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const r = ringOf(loc.x, loc.y);
        if (r >= 6) continue;
        if (WALL_TYPES.has(loc.type)) rings[r].walls++;
        else if (loc.type === 22) rings[r].decor++;
        else if (loc.type === 10 || loc.type === 11) {
            if (TREE.test(locs(loc.id).name ?? "")) rings[r].trees++;
            else rings[r].props++;
        }
    }
    return {
        centre: [Math.round(cx), Math.round(cy)],
        rings: rings
            .filter((r) => r.tiles > 300)
            .map((r) => ({
                tiles: r.tiles,
                indoorPct: round((100 * r.indoor) / r.tiles, 0),
                wallsPer100: round((100 * r.walls) / r.tiles, 1),
                propsPer100: round((100 * r.props) / r.tiles, 1),
                treesPer100: round((100 * r.trees) / r.tiles, 1),
                decorPer100: round((100 * r.decor) / r.tiles, 1),
            })),
    };
}

// Ground decoration against paths: density by distance from a walkable overlay tile
export function measureDecor(p: Prepared) {
    const { grid, sizeX, sizeY, n, level0, inside, walkable, locs } = p;
    const path = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (level0.overlays[i] && walkable[i] && !inside[i]) path[i] = 1;
    }
    // Chessboard distance to a path, capped
    const far = new Uint8Array(n).fill(9);
    for (let i = 0; i < n; i++) {
        if (path[i]) far[i] = 0;
    }
    for (let pass = 0; pass < 8; pass++) {
        for (let y = 1; y < sizeY - 1; y++) {
            for (let x = 1; x < sizeX - 1; x++) {
                const i = x + y * sizeX;
                far[i] = Math.min(
                    far[i],
                    far[i - 1] + 1,
                    far[i + 1] + 1,
                    far[i - sizeX] + 1,
                    far[i + sizeX] + 1,
                );
            }
        }
    }
    const pathSlopes: number[] = [];
    for (let i = 0; i < n; i++) {
        if (path[i]) pathSlopes.push(p.slope[i]);
    }
    pathSlopes.sort((a, b) => a - b);
    const tiles = new Array(10).fill(0);
    const decor = new Array(10).fill(0);
    const props = new Array(10).fill(0);
    for (let i = 0; i < n; i++) {
        if (!inside[i] && walkable[i]) tiles[far[i]]++;
    }
    const kinds = new Map<string, number>();
    let contoured = 0;
    let total = 0;
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const i = loc.x + loc.y * sizeX;
        if (inside[i]) continue;
        const m = locs(loc.id);
        if (loc.type === 22) {
            total++;
            if (m.contoured >= 0) contoured++;
            decor[far[i]]++;
            bump(kinds, `${loc.id}`);
        } else if (loc.type === 10 || loc.type === 11) {
            props[far[i]]++;
        }
    }
    const per = (a: number[]) => a.map((v, i) => round((100 * v) / Math.max(tiles[i], 1), 0));
    return {
        pathSlopeQ: [
            percentile(pathSlopes, 0.5),
            percentile(pathSlopes, 0.9),
            percentile(pathSlopes, 0.99),
            pathSlopes[pathSlopes.length - 1] ?? 0,
        ],
        decorKinds: kinds.size,
        decorContouredPct: round((100 * contoured) / Math.max(total, 1), 0),
        decorByPathDistance: per(decor).slice(0, 7),
        propsByPathDistance: per(props).slice(0, 7),
        tilesByPathDistance: tiles.slice(0, 7),
    };
}

// How the ground's colour is laid: pieces of one underlay, and kinds in a 16 tile window
export function measureUnderlays(p: Prepared) {
    const { sizeX, sizeY, n, level0 } = p;
    const seen = new Uint8Array(n);
    const areas: number[] = [];
    let boundary = 0;
    for (let start = 0; start < n; start++) {
        if (seen[start] || !level0.underlays[start]) continue;
        const id = level0.underlays[start];
        const queue = [start];
        seen[start] = 1;
        let area = 0;
        while (queue.length > 0) {
            const i = queue.pop()!;
            area++;
            const x = i % sizeX;
            for (const j of [
                x > 0 ? i - 1 : -1,
                x < sizeX - 1 ? i + 1 : -1,
                i - sizeX,
                i + sizeX,
            ]) {
                if (j < 0 || j >= n) continue;
                if (level0.underlays[j] !== id) {
                    boundary++;
                } else if (!seen[j]) {
                    seen[j] = 1;
                    queue.push(j);
                }
            }
        }
        areas.push(area);
    }
    areas.sort((a, b) => a - b);
    const kinds: number[] = [];
    for (let y = 0; y + 16 <= sizeY; y += 8) {
        for (let x = 0; x + 16 <= sizeX; x += 8) {
            const set = new Set<number>();
            for (let ty = y; ty < y + 16; ty++) {
                for (let tx = x; tx < x + 16; tx++) {
                    const id = level0.underlays[tx + ty * sizeX];
                    if (id) set.add(id);
                }
            }
            kinds.push(set.size);
        }
    }
    kinds.sort((a, b) => a - b);
    return {
        pieces: areas.length,
        areaP50: percentile(areas, 0.5),
        areaP90: percentile(areas, 0.9),
        boundaryPer100: round((100 * boundary) / n, 0),
        kindsIn16: [percentile(kinds, 0.1), percentile(kinds, 0.5), percentile(kinds, 0.9)],
    };
}

// Shores: blocked water tiles, what their edges are like, and how the ground meets them
export function measureShore(p: Prepared, waterIds: (id: number) => boolean) {
    const { grid, sizeX, sizeY, n, level0, locs } = p;
    const cornersX = sizeX + 1;
    const water = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (level0.overlays[i] && waterIds(level0.overlays[i])) water[i] = 1;
    }
    let edge = 0;
    let shaped = 0;
    const bank: number[] = [];
    const near = new Uint8Array(n);
    for (let y = 1; y < sizeY - 1; y++) {
        for (let x = 1; x < sizeX - 1; x++) {
            const i = x + y * sizeX;
            if (!water[i]) continue;
            if (!water[i - 1] || !water[i + 1] || !water[i - sizeX] || !water[i + sizeX]) {
                edge++;
                if (level0.shapes[i] !== 0) shaped++;
                near[i] = 1;
            }
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                const j = i + dx + dy * sizeX;
                if (!water[j]) {
                    // Rise from the water's edge to three tiles inland
                    const fx = Math.min(Math.max(x + dx * 4, 0), sizeX);
                    const fy = Math.min(Math.max(y + dy * 4, 0), sizeY);
                    bank.push(
                        Math.abs(
                            level0.heights[fx + fy * cornersX] - level0.heights[x + y * cornersX],
                        ),
                    );
                    near[j] = 1;
                }
            }
        }
    }
    bank.sort((a, b) => a - b);
    const onShore = new Map<string, number>();
    for (const loc of grid.locs) {
        if (loc.level === 0 && near[loc.x + loc.y * sizeX])
            bump(onShore, `${locLabel(locs(loc.id))}:t${loc.type}`);
    }
    let waterTiles = 0;
    for (let i = 0; i < n; i++) waterTiles += water[i];
    return {
        waterSharePct: round((100 * waterTiles) / n, 1),
        edgeTiles: edge,
        shapedEdgePct: round((100 * shaped) / Math.max(edge, 1), 0),
        bankRiseQ: [percentile(bank, 0.5), percentile(bank, 0.9), percentile(bank, 0.99)],
        onShorePer100Edge: round(
            (100 * [...onShore.values()].reduce((a, b) => a + b, 0)) / Math.max(edge, 1),
            0,
        ),
        topOnShore: top(onShore, 8),
    };
}

// Squares: paved walkable ground wide enough to be a place, and what stands in the middle
export function measurePlazas(p: Prepared) {
    const { grid, sizeX, sizeY, n, level0, walkable, inside, locs } = p;
    const paved = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (level0.overlays[i] && !inside[i] && walkable[i]) paved[i] = 1;
    }
    const radius = new Int16Array(n);
    for (let i = 0; i < n; i++) radius[i] = paved[i] ? 1000 : 0;
    for (let y = 1; y < sizeY; y++) {
        for (let x = 1; x < sizeX - 1; x++) {
            const i = x + y * sizeX;
            radius[i] = Math.min(
                radius[i],
                radius[i - 1] + 1,
                radius[i - sizeX] + 1,
                radius[i - sizeX - 1] + 1,
                radius[i - sizeX + 1] + 1,
            );
        }
    }
    for (let y = sizeY - 2; y >= 0; y--) {
        for (let x = sizeX - 2; x >= 1; x--) {
            const i = x + y * sizeX;
            radius[i] = Math.min(
                radius[i],
                radius[i + 1] + 1,
                radius[i + sizeX] + 1,
                radius[i + sizeX + 1] + 1,
                radius[i + sizeX - 1] + 1,
            );
        }
    }
    type Plaza = { x: number; y: number; r: number; centre: string[] };
    const found: Plaza[] = [];
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            const r = radius[x + y * sizeX];
            if (r >= 4 && r < 1000) found.push({ x, y, r, centre: [] });
        }
    }
    found.sort((a, b) => b.r - a.r);
    const kept: Plaza[] = [];
    for (const f of found) {
        if (!kept.some((k) => Math.hypot(k.x - f.x, k.y - f.y) < k.r + f.r)) kept.push(f);
    }
    for (const f of kept) {
        for (const loc of grid.locs) {
            if (
                loc.level === 0 &&
                (loc.type === 10 || loc.type === 11) &&
                Math.hypot(loc.x - f.x, loc.y - f.y) <= f.r + 4
            ) {
                f.centre.push(locLabel(locs(loc.id)));
            }
        }
        f.centre = f.centre.slice(0, 6);
    }
    return kept.slice(0, 6).map((k) => ({ r: k.r, around: k.centre }));
}

// Doors, and how far they are from a path; walls a building is made of
export function measureFronts(p: Prepared) {
    const { grid, sizeX, sizeY, n, level0, walkable, inside, locs } = p;
    const path = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (level0.overlays[i] && walkable[i] && !inside[i]) path[i] = 1;
    }
    const rotations = [0, 0, 0, 0];
    const distances: number[] = [];
    for (const loc of grid.locs) {
        if (loc.level !== 0 || loc.type !== 0 || !DOOR.test(locs(loc.id).name ?? "")) continue;
        rotations[loc.rotation]++;
        let best = 99;
        for (let dy = -10; dy <= 10; dy++) {
            for (let dx = -10; dx <= 10; dx++) {
                const tx = loc.x + dx;
                const ty = loc.y + dy;
                if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && path[tx + ty * sizeX]) {
                    best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
                }
            }
        }
        distances.push(best);
    }
    distances.sort((a, b) => a - b);
    return {
        doors: distances.length,
        doorRotations: rotations,
        doorToPathQ: [
            percentile(distances, 0.25),
            percentile(distances, 0.5),
            percentile(distances, 0.75),
        ],
    };
}

// Long clear views: how far you can look along eight directions before something stands in
// the way, from walkable tiles, capped at 32
export function measureSightLines(p: Prepared) {
    const { grid, sizeX, sizeY, n, walkable, locs } = p;
    const tall = new Uint8Array(n);
    for (const loc of grid.locs) {
        if (loc.level !== 0 || loc.type === 22) continue;
        if (locs(loc.id).clipType !== 0) tall[loc.x + loc.y * sizeX] = 1;
    }
    const views: number[] = [];
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ];
    for (let y = 0; y < sizeY; y += 4) {
        for (let x = 0; x < sizeX; x += 4) {
            if (!walkable[x + y * sizeX]) continue;
            for (const [dx, dy] of dirs) {
                let d = 1;
                for (; d <= 32; d++) {
                    const tx = x + dx * d;
                    const ty = y + dy * d;
                    if (tx < 0 || ty < 0 || tx >= sizeX || ty >= sizeY) break;
                    const i = tx + ty * sizeX;
                    if (tall[i] || !p.open[i]) break;
                }
                views.push(d);
            }
        }
    }
    views.sort((a, b) => a - b);
    return {
        viewQ: [
            percentile(views, 0.25),
            percentile(views, 0.5),
            percentile(views, 0.75),
            percentile(views, 0.95),
        ],
    };
}

// Round a building: the ring just outside its walls, and its floors
export function measureAprons(p: Prepared) {
    const { sizeX, sizeY, n, inside, level0, grid, locs } = p;
    const ring = new Uint8Array(n);
    for (let y = 1; y < sizeY - 1; y++) {
        for (let x = 1; x < sizeX - 1; x++) {
            const i = x + y * sizeX;
            if (inside[i]) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const tx = x + dx;
                    const ty = y + dy;
                    if (tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && inside[tx + ty * sizeX]) {
                        ring[i] = 1;
                    }
                }
            }
        }
    }
    let tiles = 0;
    let overlaid = 0;
    const floors = new Map<number, number>();
    let indoor = 0;
    let indoorOverlaid = 0;
    const indoorFloors = new Map<number, number>();
    for (let i = 0; i < n; i++) {
        if (ring[i]) {
            tiles++;
            if (level0.overlays[i]) {
                overlaid++;
                bump(floors, level0.overlays[i]);
            }
        }
        if (inside[i]) {
            indoor++;
            if (level0.overlays[i]) {
                indoorOverlaid++;
                bump(indoorFloors, level0.overlays[i]);
            }
        }
    }
    let decor = 0;
    let props = 0;
    for (const loc of grid.locs) {
        if (loc.level !== 0 || !ring[loc.x + loc.y * sizeX]) continue;
        if (loc.type === 22) decor++;
        else if ((loc.type === 10 || loc.type === 11) && !TREE.test(locs(loc.id).name ?? ""))
            props++;
    }
    return {
        ringTiles: tiles,
        ringOverlayPct: round((100 * overlaid) / Math.max(tiles, 1), 0),
        ringTopOverlays: top(floors, 4),
        ringDecorPer100: round((100 * decor) / Math.max(tiles, 1), 0),
        ringPropsPer100: round((100 * props) / Math.max(tiles, 1), 1),
        indoorOverlayPct: round((100 * indoorOverlaid) / Math.max(indoor, 1), 0),
        indoorTopOverlays: top(indoorFloors, 4),
    };
}

// The walkable tiles along a face: those above it and those at its foot, and what's on them
// The walkable tiles that touch a steep blocked tile: 1 at its foot, 2 on top of it
export function findRims(p: Prepared): Uint8Array {
    const { sizeX, sizeY, n, slope, walkable, level0 } = p;
    const cornersX = sizeX + 1;
    const mean = (x: number, y: number) =>
        (level0.heights[x + y * cornersX] +
            level0.heights[x + 1 + y * cornersX] +
            level0.heights[x + (y + 1) * cornersX] +
            level0.heights[x + 1 + (y + 1) * cornersX]) /
        4;
    const rim = new Uint8Array(n);
    for (let y = 1; y < sizeY - 1; y++) {
        for (let x = 1; x < sizeX - 1; x++) {
            const i = x + y * sizeX;
            if (!walkable[i] || slope[i] >= 16) continue;
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                const j = x + dx + (y + dy) * sizeX;
                if (slope[j] >= 16 && !walkable[j]) {
                    rim[i] = mean(x + dx, y + dy) > mean(x, y) ? 1 : 2;
                }
            }
        }
    }
    return rim;
}

export function measureRims(p: Prepared) {
    const { grid, sizeX, n, slope, level0, locs } = p;
    const rim = findRims(p);
    const tiles = [0, 0, 0];
    const flat = [0, 0, 0];
    const overlaid = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        const r = rim[i];
        if (r) {
            tiles[r]++;
            if (slope[i] <= 2) flat[r]++;
            if (level0.overlays[i]) overlaid[r]++;
        }
    }
    const decor = [0, 0, 0];
    const props = [0, 0, 0];
    const walls = [0, 0, 0];
    const kinds = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
    for (const loc of grid.locs) {
        if (loc.level !== 0) continue;
        const r = rim[loc.x + loc.y * sizeX];
        if (!r) continue;
        if (loc.type === 22) decor[r]++;
        else if (loc.type === 10 || loc.type === 11) {
            props[r]++;
            bump(kinds[r], locLabel(locs(loc.id)));
        } else if (WALL_TYPES.has(loc.type)) walls[r]++;
    }
    const side = (r: number) => ({
        tiles: tiles[r],
        flatPct: round((100 * flat[r]) / Math.max(tiles[r], 1), 0),
        overlayPct: round((100 * overlaid[r]) / Math.max(tiles[r], 1), 0),
        decorPer100: round((100 * decor[r]) / Math.max(tiles[r], 1), 0),
        propsPer100: round((100 * props[r]) / Math.max(tiles[r], 1), 0),
        wallsPer100: round((100 * walls[r]) / Math.max(tiles[r], 1), 0),
        topProps: top(kinds[r], 4),
    });
    return { foot: side(1), top: side(2) };
}
