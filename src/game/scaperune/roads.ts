import { Exit } from "./building";
import { TileRect } from "./collision";
import { PlacedLoc, TILE_BLOCKED, TILE_BRIDGE, TileGrid } from "./format";
import {
    Build,
    LOC_FLOOR_DECORATION,
    createClimb,
    forTilesNear,
    getTouchedTiles,
    hasRelief,
    lerp,
} from "./mapBuild";
import { Noise, createNoise, distanceTo, smoothField } from "./noise";
import { Point, addPathToField, smoothPath } from "./paths";
import { rotatePrefab } from "./prefab";
import {
    BRIDGES,
    BRIDGE_DECK_EAST,
    BRIDGE_DECK_ROW,
    BRIDGE_DECK_WEST,
    BRIDGE_LENGTH,
    loadPrefab,
} from "./prefabs";
import { RESERVE_LANE, RESERVE_PLOT, RESERVE_STREET } from "./reservations";
import { River, getCrossingLine, riverCentre } from "./rivers";
import { RoadLine } from "./roadGrades";
import { getCoveredSides, getOverlayShape } from "./shapes";

// Roads and bridges. How high they run is in roadGrades.ts.

export const BRIDGE_ROAD_HALF_WIDTH = 1.2;

// Tiles along a road from a bridge's width to its own
const ROAD_WIDEN = 6;

// How far past a road's edge its soft underlay runs. The renderer blends underlays over
// 11 tiles, so that's a stain that takes the contrast out of the overlay's edge.
const TRAIL_MARGIN = 0.8;

// How far past a road's edge the square at the spawn reaches
const SPAWN_SQUARE = 1.6;

// Tiles past a road's edge that scatter keeps off
const ROAD_CLEAR_MARGIN = 0.3;

// Tiles past a road's edge, from a tile's middle, that it can paint on. A tile's painted if its
// corner's in, and that's this far from its middle.
const ROAD_PAINT_MARGIN = 0.75;

// The same for a road that bends, which paints a bit past that on its way round
const ROAD_PLOT_MARGIN = 1.25;

// A loc type that fills its tiles: under it they're walls and wall decoration, on a tile's edge
const LOC_DIAGONAL = 9;

// Tiles a road that leads nowhere takes to narrow away
const ROAD_TAPER = 7;

// Tiles past a street's edge that a corner where two streets meet can paint
const JUNCTION_MARGIN = 2.5;

// Tiles a street takes to narrow to the road through its gate
const STREET_NARROWS = 5;

// Tiles past a road's end that another road counts as joining it
const ROAD_JOINS = 2.5;

// Tiles a main road stops short of a wall, for the road to its gate to take over. A road that's
// left to fade out has room to, before it gets there.
const WALL_CLEAR = ROAD_TAPER + 1;

// The tightest a road can turn after a straight stretch, in tiles
const ROAD_TURN_RADIUS = 8;

// How far a road runs dead straight off the end of a bridge's stamp, down the middle
// of the gap between its fences and on, before it can curve
const BRIDGE_ROAD_STRAIGHT = 6;

const DOOR_PATH_HALF = 1;

// Rows kept clear either side of a bridge's road
const BRIDGE_ROAD_CLEAR = 4;

// The steepest a road climbs, in height units a tile, and what going over that costs
const ROAD_GRADE = 5;

const ROAD_CLIMB_COST = 6;

// How steep a road can go at a pinch, to meet something, as a share of what's walkable
export const ROAD_STEEPEST = 0.75;

// What a tile of cliff costs a road, for the cutting
const ROAD_CLIFF_COST = 14;

// Tiles either side of a road that are level with it, past its own half width
export const ROAD_SHOULDER = 1.2;

// Passes to even out the ground pinned to roads
export const ROAD_SMOOTHING = 2;

// Corners past a road's half width that its painted tiles can reach
const ROAD_PIN_REACH = 3;

// Times the ground under a road's eased
const ROAD_EASE_ROUNDS = 4;

// What a tile beside water costs a road: it eats into the shore
const ROAD_SHORE_COST = 10;

// Points along a main road between places it's routed to, over rough ground, and how far
// they can move to find ground to stand on
const MAIN_ROAD_STEP = 24;

const MAIN_ROAD_SNAP = 8;

// The road system. Everything joins it, so it's laid as things are placed: main roads
// and bridges, then each building's, which is why a building can face a road that's
// there. A road never goes on a building: tiles round them are out of bounds, and any
// smoothing that drifts onto one is undone.
export class RoadNetwork {
    // Road, for others to join. The spawn counts, so that there's something to lead to.
    readonly tiles: Uint8Array;
    readonly halfWidth: number;
    // Keeps roads and fords off buildings: on each tile, how many buildings it's too
    // close to, because zones overlap and a spot that's given up on takes its own off
    readonly offLimits: Uint8Array;
    // Tiles a road keeps off for good, even when it's smoothed: where lava's going to be
    readonly avoid: Uint8Array;
    readonly lines: RoadLine[] = [];
    // Tiles a road wanted, and can't have: a building's in the way. check-maps.ts wants to know.
    readonly clipped: Uint8Array;
    // The line the main road means to take, and bridges' ends, for gates to be where they arrive
    plannedLine: Point[] = [];
    readonly arrivalPoints: Point[] = [];
    // The ends of main roads a wall's stopped
    private readonly cuts: Point[][] = [];
    // Towns' squares, as tiles
    readonly squares: TileRect[] = [];
    // Every point of road, to find the nearest. Not the spawn: that's no road.
    private readonly samples: Point[] = [];
    private readonly road: Float32Array;
    private readonly trail: Float32Array;
    // Tiles from water
    private readonly shore: Float32Array;
    private readonly wiggle: Noise;
    private readonly curves: number;
    private readonly climb: (from: number, to: number) => number;

    constructor(
        readonly build: Build,
        readonly water: Uint8Array,
        readonly bridgeZone: Uint8Array,
        // Tiles water's been taken off, for a map that repaints it
        readonly dry?: Uint8Array,
    ) {
        const { ground, corners, settings, spawn } = build;
        this.tiles = new Uint8Array(ground.sizeX * ground.sizeY);
        this.offLimits = new Uint8Array(this.tiles.length);
        this.clipped = new Uint8Array(this.tiles.length);
        this.avoid = new Uint8Array(this.tiles.length);
        this.halfWidth = settings.roadWidth / 2;
        this.road = new Float32Array(corners.x * corners.y).fill(-4);
        this.trail = new Float32Array(corners.x * corners.y).fill(-4);
        this.shore = distanceTo(water, ground.sizeX, ground.sizeY, 2);
        this.wiggle = createNoise(settings.seed + 5, 1);
        this.curves = settings.roadCurviness;
        this.climb = createClimb(build, ROAD_GRADE, ROAD_CLIMB_COST);
        // Everything leads to the spawn, if nothing else
        this.tiles[ground.tile(spawn.x, spawn.y)] = 1;
    }

    // How far from a building a road must keep, past its own edge
    get wallGap(): number {
        return Math.ceil(this.halfWidth) + 1;
    }

    // How far a road runs straight out of a door before it's free to turn
    get doorLead(): number {
        return this.wallGap + 2;
    }

    // The nearest road to a point, or the spawn if there's none yet
    getNearest(x: number, y: number): Point {
        let best = this.build.spawn;
        let bestDistance = Infinity;
        for (const sample of this.samples) {
            const distance = (sample.x - x) ** 2 + (sample.y - y) ** 2;
            if (distance < bestDistance) {
                best = sample;
                bestDistance = distance;
            }
        }
        return best;
    }

    private cost(x: number, y: number): number {
        const { ground } = this.build;
        const i = ground.tile(x, y);
        if (this.tiles[i]) {
            return 0.2;
        }
        if (this.water[i] || this.avoid[i] || ground.reserved[i] || this.offLimits[i]) {
            return Infinity;
        }
        return (
            1 +
            (this.build.cliffs[i] ? ROAD_CLIFF_COST : 0) +
            (this.shore[i] <= 1 ? ROAD_SHORE_COST : 0) +
            this.wiggle(x / lerp(24, 7, this.curves), y / lerp(24, 7, this.curves)) *
                this.curves *
                9
        );
    }

    // Whether a lead can go straight out of something, with nothing in its way that's spoken for.
    // It's the one bit of road that isn't routed round things.
    isLeadClear(lead: Point[]): boolean {
        const { ranks } = this.build.ground.claims;
        let clear = true;
        forTilesNear(this.build, lead, this.halfWidth + ROAD_PAINT_MARGIN, (i) => {
            clear &&= !(ranks[i] !== 0 && ranks[i] <= RESERVE_PLOT && ranks[i] !== RESERVE_STREET);
        });
        return clear;
    }

    // Whether a point of road is on a building, a wall or anything that's theirs, or in water, or
    // by a bridge's road where nothing's to go. A road coming off a bridge starts out next to that,
    // so it's let off (nearBridge).
    private touchesBuilding(point: Point, nearBridge: boolean): boolean {
        const { ground } = this.build;
        const { ranks } = ground.claims;
        let touches = false;
        forTilesNear(this.build, [point], this.halfWidth + 0.5, (i) => {
            const wet = this.water[i] !== 0 || this.avoid[i] !== 0;
            const offBridge = !nearBridge && this.bridgeZone[i] !== 0;
            touches ||= ground.footprint[i] !== 0 || offBridge || wet;
        });
        forTilesNear(this.build, [point], this.halfWidth + ROAD_PLOT_MARGIN, (i) => {
            touches ||= ranks[i] !== 0 && ranks[i] <= RESERVE_PLOT && ranks[i] !== RESERVE_STREET;
        });
        return touches;
    }

    // join says whether others can join it yet: a town's streets wait till it's been joined up
    // itself, so that two towns can't end up on a road of their own
    add(line: RoadLine, width: (point: number) => number, trail: boolean, join = true): void {
        const { ground, corners } = this.build;
        const { claims } = ground;
        const { points } = line;
        addPathToField(this.road, corners.x, corners.y, points, width);
        if (trail) {
            addPathToField(
                this.trail,
                corners.x,
                corners.y,
                points,
                (i) => width(i) + TRAIL_MARGIN,
            );
        }
        this.lines.push(line);
        const clear = this.halfWidth + ROAD_CLEAR_MARGIN;
        forTilesNear(this.build, points, clear, (i) => {
            ground.reserved[i] = 1;
        });
        // What it can paint, which building has to keep off. A street's straight, and paints no
        // further than its width.
        const widest = Math.max(width(0), width(points.length - 1));
        const margin = join ? ROAD_PLOT_MARGIN : ROAD_PAINT_MARGIN;
        forTilesNear(this.build, points, widest + margin, (i) => {
            claims.markTile(i, RESERVE_LANE);
        });
        // A lead's its door's or bridge's alone: others join past it, not against the wall
        if (join) {
            forTilesNear(this.build, points.slice(line.lead), clear, (i) => {
                this.tiles[i] = 1;
            });
        }
        this.samples.push(...points);
    }

    // A road as smooth as it'll go without drifting onto a building: each stretch that
    // does gets less smoothing, down to none
    private smoothRoad(raw: Point[], pinned: number): Point[] {
        const reach = Math.round(lerp(9, 5, this.curves));
        const clean = (points: Point[], fallback: Point[]) =>
            points.map((point, i) => {
                const touches =
                    i >= pinned && this.touchesBuilding(point, i < pinned + ROAD_TURN_RADIUS);
                return touches ? fallback[i] : point;
            });
        const light = clean(smoothPath(raw, 2, 1, pinned), raw);
        const medium = clean(smoothPath(raw, 4, 3, pinned), light);
        return clean(smoothPath(raw, reach, 7, pinned), medium);
    }

    // The way from a road's start to the rest of the roads: its tiles, or nothing
    findRoute(from: Point, lead: Point[]): number[] {
        const { finder } = this.build;
        const isRoad = (i: number) => this.tiles[i] !== 0;
        const free = (x: number, y: number) => this.cost(x, y);
        const inTurn = getTurningCircles(lead);
        const turning = (x: number, y: number) => (inTurn(x, y) ? Infinity : free(x, y));
        // Somewhere too tight for a wide turn makes do with a sharp one
        const wide = finder.find(from, turning, isRoad, this.climb);
        return wide.length > 0 ? wide : finder.find(from, free, isRoad, this.climb);
    }

    // Lays a road out of something along a route, as findRoute found it. With no route
    // it leads nowhere, and narrows away into the ground.
    lay(
        from: Point,
        lead: Point[],
        route: number[],
        leadHalfWidth: number,
        startHeight: number,
    ): void {
        const { ground, sizeX } = this.build;
        this.tiles[ground.tile(from.x, from.y)] = 1;
        // Found from the far end back
        const onward = route
            .map((i) => ({ x: (i % sizeX) + 0.5, y: Math.floor(i / sizeX) + 0.5 }))
            .reverse();

        const points = this.smoothRoad([...lead, ...onward], lead.length);

        const width = (i: number) =>
            i < lead.length
                ? leadHalfWidth
                : lerp(leadHalfWidth, this.halfWidth, Math.min((i - lead.length) / ROAD_WIDEN, 1));
        const start = startHeight;
        const line = {
            points,
            lead: lead.length,
            halfWidth: this.halfWidth,
            start,
            grade: ROAD_GRADE,
        };
        this.add(line, width, true);
        if (onward.length === 0) {
            this.taper(points, leadHalfWidth);
        }
    }

    // A long line that's to go over rough ground: its way between points along it, where
    // it can be walked and climbed. Each run's a stretch that's joined up.
    private routeThrough(line: Point[], skip: Uint8Array): Point[][] {
        const { ground, sizeX, finder, cliffs } = this.build;
        const free = (x: number, y: number) =>
            skip[ground.tile(x, y)] ? Infinity : this.cost(x, y);
        const isFree = (x: number, y: number) =>
            ground.inside(x, y) && free(x, y) !== Infinity && !cliffs[ground.tile(x, y)];
        // The nearest tile that'll do
        const snap = (point: Point): Point | undefined => {
            const x = Math.floor(point.x);
            const y = Math.floor(point.y);
            for (let reach = 0; reach <= MAIN_ROAD_SNAP; reach++) {
                for (let ny = y - reach; ny <= y + reach; ny++) {
                    for (let nx = x - reach; nx <= x + reach; nx++) {
                        if (
                            Math.max(Math.abs(nx - x), Math.abs(ny - y)) === reach &&
                            isFree(nx, ny)
                        ) {
                            return { x: nx, y: ny };
                        }
                    }
                }
            }
            return undefined;
        };
        const runs: Point[][] = [];
        let run: Point[] = [];
        let last: Point | undefined;
        const finish = () => {
            if (run.length > 3) {
                runs.push(this.smoothRoad(run, 1));
            }
            run = [];
            last = undefined;
        };
        for (let at = 0; at < line.length; at += MAIN_ROAD_STEP) {
            const next = snap(line[at]);
            if (!next) {
                finish();
                continue;
            }
            if (last) {
                const end = ground.tile(next.x, next.y);
                const route = finder.find(last, free, (i) => i === end, this.climb);
                if (route.length === 0) {
                    finish();
                } else {
                    for (let i = route.length - 1; i >= 0; i--) {
                        run.push({
                            x: (route[i] % sizeX) + 0.5,
                            y: Math.floor(route[i] / sizeX) + 0.5,
                        });
                    }
                }
            }
            last = next;
        }
        finish();
        return runs;
    }

    // Pins the ground under every tile that'll be painted as road, out to the corners a road's
    // own width doesn't reach, or a road's edge can stand on a slope too steep to walk. Goes once
    // the roads have heights, and what's pinned already stays. passes get the same.
    pinTiles(passes: RoadLine[] = []): void {
        const { corners, sizeX, sizeY, terrain, cliffs } = this.build;
        const count = corners.x * corners.y;
        const nearest = new Float32Array(count).fill(Infinity);
        const heights = new Float32Array(count);
        const lines = [...this.lines, ...passes];
        for (const line of lines) {
            const reach = Math.ceil(line.halfWidth) + ROAD_PIN_REACH;
            line.points.forEach((point, i) => {
                const px = Math.round(point.x);
                const py = Math.round(point.y);
                for (let y = Math.max(py - reach, 0); y <= Math.min(py + reach, sizeY); y++) {
                    for (let x = Math.max(px - reach, 0); x <= Math.min(px + reach, sizeX); x++) {
                        const distance = Math.hypot(x - point.x, y - point.y);
                        if (line.heights && distance < nearest[x + y * corners.x]) {
                            nearest[x + y * corners.x] = distance;
                            heights[x + y * corners.x] = line.heights[i];
                        }
                    }
                }
            });
        }
        const painted = getTouchedTiles(
            smoothField(this.road, corners.x, corners.y, 1),
            sizeX,
            sizeY,
        );
        // And whatever a road's own line is on, painted or not
        for (const { points } of lines) {
            for (const { x, y } of points) {
                painted[Math.floor(x) + Math.floor(y) * sizeX] = 1;
            }
        }
        for (let y = 0; y < sizeY; y++) {
            for (let x = 0; x < sizeX; x++) {
                if (!painted[x + y * sizeX]) {
                    continue;
                }
                // What's built on stops being cliff
                cliffs[x + y * sizeX] = 0;
                for (const [cx, cy] of [
                    [x, y],
                    [x + 1, y],
                    [x, y + 1],
                    [x + 1, y + 1],
                ]) {
                    const distance = nearest[cx + cy * corners.x];
                    if (distance === Infinity) {
                        continue;
                    }
                    this.dryCorner(cx, cy);
                    const height = heights[cx + cy * corners.x];
                    terrain.pin(cx, cy, height, Math.max(distance, 0.01));
                }
            }
        }
    }

    // Eases what's left too steep under the middle of a road, once the heights are done: a door's
    // step beside a road can stand a little over it. What's pinned hard and water stay put.
    easeTiles(passes: RoadLine[] = []): void {
        const { terrain, settings, ground } = this.build;
        const { height } = terrain;
        const limit = settings.walkSlope - 1;
        for (let round = 0; round < ROAD_EASE_ROUNDS; round++) {
            for (const { points, lead } of [...this.lines, ...passes]) {
                for (const point of points.slice(lead)) {
                    const x = Math.floor(point.x);
                    const y = Math.floor(point.y);
                    if (terrain.getSlope(x, y) <= limit) {
                        continue;
                    }
                    const free = [
                        [x, y],
                        [x + 1, y],
                        [x, y + 1],
                        [x + 1, y + 1],
                    ].filter(
                        ([cx, cy]) =>
                            !terrain.isHardPinned(cx, cy) &&
                            !terrain.isLocked(terrain.corner(cx, cy)),
                    );
                    if (free.length > 0) {
                        const heights = free.map(([cx, cy]) => height[terrain.corner(cx, cy)]);
                        const middle = (Math.max(...heights) + Math.min(...heights)) / 2;
                        for (const [cx, cy] of free) {
                            const at = terrain.corner(cx, cy);
                            height[at] += (middle - height[at]) / 2;
                        }
                    }
                }
            }
        }
        terrain.write((x, y, value) => ground.setHeight(x, y, value));
    }

    // Takes water off a corner of a road's tile. Water can't move to meet a road, so where one
    // runs along a shore, the shore gives way: its tiles there go, and the corner's the road's.
    private dryCorner(x: number, y: number): void {
        const { ground, terrain, heldCorners, sizeX } = this.build;
        const at = terrain.corner(x, y);
        if (!terrain.isLocked(at)) {
            return;
        }
        const tile = x + y * sizeX;
        const around = [tile - sizeX - 1, tile - sizeX, tile - 1, tile];
        const bridges = ground.grid.levels[1].flags;
        if (around.some((i) => bridges[i] & TILE_BRIDGE)) {
            return;
        }
        for (const i of around) {
            if (this.water[i]) {
                this.water[i] = 0;
                ground.clearOverlay(i);
                if (this.dry) {
                    this.dry[i] = 1;
                }
            }
        }
        heldCorners[at] = 0;
        terrain.unlock(at);
    }

    // Lays a road exactly along a line that's already smooth, for a map that's drawn its own
    addRun(run: Point[]): void {
        const { ground } = this.build;
        this.add(
            { points: run, lead: 0, halfWidth: this.halfWidth, grade: ROAD_GRADE },
            () => this.halfWidth,
            true,
        );
        for (const point of run) {
            this.tiles[ground.tile(Math.floor(point.x), Math.floor(point.y))] = 1;
        }
    }

    // Lays a road along a line, leaving out where it can't go, for others to join
    addMainRoad(line: Point[], skip: Uint8Array): void {
        const { ground, settings } = this.build;
        const lay = (run: Point[]) => {
            this.addRun(run);
            this.cuts.push(run.slice(0, 2).reverse(), run.slice(-2));
        };
        if (hasRelief(settings)) {
            this.routeThrough(line, skip).forEach(lay);
            return;
        }
        let run: Point[] = [];
        const finish = () => {
            if (run.length > 3) {
                lay(run);
            }
            run = [];
        };
        for (const point of line) {
            const x = Math.floor(point.x);
            const y = Math.floor(point.y);
            if (ground.inside(x, y) && !skip[ground.tile(x, y)]) {
                run.push(point);
            } else {
                finish();
            }
        }
        finish();
    }

    // The ends of main roads a wall stopped that nothing came to join fade out, rather than stop
    // dead
    finishCuts(): void {
        const { towns } = this.build;
        const reach = WALL_CLEAR + 2;
        for (const end of this.cuts) {
            const [before, last] = end;
            const atWall = towns?.some(
                ({ wall }) =>
                    wall &&
                    last.x > wall.x0 - reach &&
                    last.x < wall.x1 + reach &&
                    last.y > wall.y0 - reach &&
                    last.y < wall.y1 + reach,
            );
            const joined = this.lines.some(
                ({ points }) =>
                    points[points.length - 1] !== last &&
                    points[0] !== last &&
                    points.some(({ x, y }) => Math.hypot(x - last.x, y - last.y) < ROAD_JOINS),
            );
            if (atWall && !joined && Math.hypot(last.x - before.x, last.y - before.y) > 0) {
                this.taper(end, this.halfWidth);
            }
        }
    }

    // Runs a road that leads nowhere on past its end, narrowing away to nothing, so that
    // it fades into the ground instead of stopping square
    private taper(line: Point[], halfWidth: number): void {
        const { corners } = this.build;
        const end = line[line.length - 1];
        const before = line[line.length - 2];
        const length = Math.hypot(end.x - before.x, end.y - before.y);
        const wayX = (end.x - before.x) / length;
        const wayY = (end.y - before.y) / length;
        const { ground } = this.build;
        for (let step = 0; step < ROAD_TAPER; step++) {
            const narrow = halfWidth * (1 - (step + 1) / ROAD_TAPER);
            const from = { x: end.x + wayX * step, y: end.y + wayY * step };
            const to = { x: from.x + wayX, y: from.y + wayY };
            const ahead = ground.claims.ranks[ground.tile(Math.floor(to.x), Math.floor(to.y))];
            if (ahead !== 0 && ahead <= RESERVE_PLOT && ahead !== RESERVE_STREET) {
                return;
            }
            addPathToField(this.road, corners.x, corners.y, [from, to], narrow);
            addPathToField(this.trail, corners.x, corners.y, [from, to], narrow + TRAIL_MARGIN);
        }
    }

    // A town's street, straight and as wide as it wants, narrowing at its far end to a gate if it
    // ends at one. Others can join it once its tiles are opened (openTiles).
    addStreet(
        points: Point[],
        halfWidth: number,
        height: number,
        held: number[],
        gateHalfWidth = halfWidth,
    ): void {
        const { ground } = this.build;
        const { claims } = ground;
        const line = { points, lead: 0, halfWidth, start: height, grade: ROAD_GRADE };
        const last = points.length - 1;
        const width = (i: number) =>
            lerp(gateHalfWidth, halfWidth, Math.min((last - i) / STREET_NARROWS, 1));
        this.add(line, width, true, false);
        forTilesNear(this.build, points, halfWidth + ROAD_CLEAR_MARGIN, (i) => {
            claims.takeTile(i, RESERVE_STREET);
            held.push(i);
        });
    }

    // Where one street meets another its edges round off, a little past either's width
    markJunction(point: Point, halfWidth: number): void {
        const { claims } = this.build.ground;
        forTilesNear(this.build, [point], halfWidth + JUNCTION_MARGIN, (i) => {
            claims.markTile(i, RESERVE_LANE);
        });
    }

    // How many steps straight out of a door there's a road, with nothing spoken for on the way, or
    // 0 if there isn't one within most
    getStepsToRoad(exit: Exit, most: number): number {
        const { ground } = this.build;
        const { ranks } = ground.claims;
        for (let step = 1; step <= most; step++) {
            const x = Math.floor(exit.x + exit.outX * step);
            const y = Math.floor(exit.y + exit.outY * step);
            if (!ground.inside(x, y)) {
                return 0;
            }
            const i = ground.tile(x, y);
            if (this.tiles[i]) {
                return step;
            }
            let free = ranks[i] === 0;
            forTilesNear(this.build, [{ x, y }], DOOR_PATH_HALF + ROAD_PLOT_MARGIN, (near) => {
                free &&= ranks[near] === 0 || ranks[near] > RESERVE_PLOT;
                free ||= ranks[near] === RESERVE_STREET;
            });
            if (!free) {
                return 0;
            }
        }
        return 0;
    }

    // Lets other roads join tiles
    openTiles(tiles: number[]): void {
        for (const i of tiles) {
            this.tiles[i] = 1;
        }
    }

    // A door on a street: a step or two of road, to the street's edge
    addDoorPath(exit: Exit, height: number, steps: number): void {
        const points = Array.from({ length: steps }, (_, step) => ({
            x: exit.x + exit.outX * step,
            y: exit.y + exit.outY * step,
        }));
        const line = {
            points,
            lead: points.length,
            halfWidth: DOOR_PATH_HALF,
            start: height,
            grade: ROAD_GRADE,
        };
        this.add(line, () => DOOR_PATH_HALF, false);
    }

    // Whether a tile will be painted as road, streets and squares included
    isRoad(x: number, y: number): boolean {
        const { corners, ground } = this.build;
        if (this.tiles[ground.tile(x, y)]) {
            return true;
        }
        const at = x + y * corners.x;
        const near = [at, at + 1, at + corners.x, at + corners.x + 1];
        return near.some((corner) => this.road[corner] > 0);
    }

    // A rectangle of road, between tile corners, for a town's square
    addRect(x0: number, y0: number, x1: number, y1: number, held: number[]): void {
        const { ground, corners } = this.build;
        this.squares.push({ x0, y0, x1: x1 - 1, y1: y1 - 1 });
        for (let y = y0 - 2; y <= y1 + 2; y++) {
            for (let x = x0 - 2; x <= x1 + 2; x++) {
                const inside = Math.min(x - x0, x1 - x, y - y0, y1 - y) + 0.5;
                const at = x + y * corners.x;
                this.road[at] = Math.max(this.road[at], inside);
                this.trail[at] = Math.max(this.trail[at], inside + TRAIL_MARGIN);
            }
        }
        // It paints half a tile past its edge
        ground.claims.take(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, RESERVE_STREET);
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                held.push(ground.tile(x, y));
            }
        }
    }

    // A round of road, for a town's square
    addSquare(x: number, y: number, radius: number): void {
        const { corners } = this.build;
        const middle = [
            { x, y },
            { x: x + 0.01, y },
        ];
        addPathToField(this.road, corners.x, corners.y, middle, radius);
        addPathToField(this.trail, corners.x, corners.y, middle, radius + TRAIL_MARGIN);
    }

    // The tiles a loc stands on, if it's something solid that fills them
    private forSolidTiles(loc: PlacedLoc, visit: (i: number) => void): void {
        const { ground, context } = this.build;
        const { id, type, level, x, y, rotation } = loc;
        const { clipType, sizeX, sizeY } = context.locs(id);
        const solid = type === LOC_FLOOR_DECORATION ? clipType === 1 : type >= LOC_DIAGONAL;
        if (level !== 0 || clipType === 0 || !solid) {
            return;
        }
        const [wide, deep] = rotation & 1 ? [sizeY, sizeX] : [sizeX, sizeY];
        for (let ty = y; ty < y + deep; ty++) {
            for (let tx = x; tx < x + wide; tx++) {
                if (ground.inside(tx, ty)) {
                    visit(ground.tile(tx, ty));
                }
            }
        }
    }

    private getSolidTiles(): Uint8Array {
        const { ground } = this.build;
        const solid = new Uint8Array(ground.sizeX * ground.sizeY);
        for (const loc of ground.grid.locs) {
            this.forSolidTiles(loc, (i) => {
                solid[i] = 1;
            });
        }
        return solid;
    }

    // Takes anything solid off a road, last of all: what's scattered goes by a list's size for a
    // loc, and a big one reaches further. keep says what's meant to be there, as a town's gate or
    // what shuts a road. roadTiles are the tiles paint gave back.
    clearLocs(roadTiles: Uint8Array, keep?: (x: number, y: number) => boolean): void {
        const { ground } = this.build;
        const bridges = ground.grid.levels[1].flags;
        const road = Uint8Array.from(roadTiles);
        for (const { points, lead } of this.lines) {
            for (const point of points.slice(lead)) {
                const x = Math.floor(point.x);
                const y = Math.floor(point.y);
                if (ground.inside(x, y)) {
                    road[ground.tile(x, y)] = 1;
                }
            }
        }
        const isRoad = (i: number) => {
            const x = i % ground.sizeX;
            const y = Math.floor(i / ground.sizeX);
            const inside = ground.footprint[i] !== 0 || (bridges[i] & TILE_BRIDGE) !== 0;
            return road[i] !== 0 && !inside && !keep?.(x, y);
        };
        ground.grid.locs = ground.grid.locs.filter((loc) => {
            let onRoad = false;
            this.forSolidTiles(loc, (i) => {
                onRoad ||= isRoad(i);
            });
            return !onRoad;
        });
    }

    // paving says which overlay a tile gets, if it isn't the biome's own road
    paint(paving?: (x: number, y: number) => number | undefined): Uint8Array {
        const { ground, sizeX, sizeY, corners, biomeAt } = this.build;
        // A road's only painted on what can be walked: a tile at its edge that's too steep, or
        // has something on it, stops being road, and takes the colour of what it is
        const skip = this.getSolidTiles();
        for (let i = 0; i < skip.length; i++) {
            skip[i] |= this.water[i] | ground.footprint[i];
            skip[i] |= ground.level0.flags[i] & TILE_BLOCKED;
        }
        // Roads end in points, so where they meet at the spawn is a little square
        const { spawn } = this.build;
        const reach = this.halfWidth + SPAWN_SQUARE;
        let room = true;
        forTilesNear(this.build, [spawn], reach + 2, (i) => {
            room &&= this.bridgeZone[i] === 0;
        });
        if (this.lines.length > 0 && room) {
            this.addSquare(spawn.x, spawn.y, reach);
        }
        const band = getTouchedTiles(this.trail, sizeX, sizeY);
        for (let y = 0; y < sizeY; y++) {
            for (let x = 0; x < sizeX; x++) {
                const i = ground.tile(x, y);
                if (band[i] && !skip[i]) {
                    ground.level0.underlays[i] = biomeAt(x, y).trail;
                }
            }
        }
        const field = smoothField(this.road, corners.x, corners.y, 1);
        const overlay = (x: number, y: number) => paving?.(x, y) ?? biomeAt(x, y).road;
        this.findClipped(field);
        return ground.paintField(field, overlay, false, skip);
    }

    // The tiles of buildings a road would have painted, which only looks all right because
    // painting stops at a wall
    private findClipped(field: Float32Array): void {
        const { ground, sizeX, sizeY, corners } = this.build;
        for (let y = 0; y < sizeY; y++) {
            for (let x = 0; x < sizeX; x++) {
                const i = ground.tile(x, y);
                if (ground.footprint[i]) {
                    const at = x + y * corners.x;
                    const sw = field[at];
                    const se = field[at + 1];
                    const ne = field[at + corners.x + 1];
                    const nw = field[at + corners.x];
                    const sides = getCoveredSides(sw, se, ne, nw);
                    this.clipped[i] = getOverlayShape(sides, sw + se + ne + nw) ? 1 : 0;
                }
            }
        }
    }
}

// The tiles a road can't use just past a straight stretch: a circle either side of its
// end, so that it can only swing away in a wide arc. Left to itself, a road whose way
// lies back past the stretch doubles back on it in a sharp point.
function getTurningCircles(lead: Point[]): (x: number, y: number) => boolean {
    const end = lead[lead.length - 1];
    const before = lead[lead.length - 2];
    const length = Math.hypot(end.x - before.x, end.y - before.y);
    const sideX = (before.y - end.y) / length;
    const sideY = (end.x - before.x) / length;
    const radius = Math.min(lead.length, ROAD_TURN_RADIUS);
    const centres = [1, -1].map((side) => ({
        x: end.x + sideX * side * radius,
        y: end.y + sideY * side * radius,
    }));
    return (x, y) =>
        centres.some((centre) => Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y) < radius - 0.7);
}

// The tiles that only hide the ground under the bridge's ends, which is the one
// floor it needs at ground level: the rest is ours, river and road
const BRIDGE_HIDDEN_FLOOR = 61;

// How a road leaves something: dead straight along these points, in tile corners, to
// where it's free to find its way from (from, a tile)
export type RoadStart = { from: Point; lead: Point[]; height: number };

// Bridges where rivers can take one. Returns a road start for each end of each, and
// marks where main roads must keep off them.
export function placeBridges(
    build: Build,
    rivers: River[],
    water: Uint8Array,
    zone: Uint8Array,
    dry?: Uint8Array,
    avoid?: Uint8Array,
): RoadStart[] {
    const { context, ground, arena, terrain, biomeAt } = build;
    const starts: RoadStart[] = [];
    const middle = BRIDGE_LENGTH >> 1;
    const straight = middle + BRIDGE_ROAD_STRAIGHT;
    for (const river of rivers) {
        for (const crossing of river.crossings) {
            // Tile corners along the bridge's middle line, by distance from the river's
            // middle. Turning a prefab mirrors it along its length.
            const line = getCrossingLine(river, crossing);
            const across = (distance: number): Point =>
                river.vertical
                    ? { x: line + distance, y: crossing }
                    : { x: crossing, y: line + distance };
            const deckNear = river.vertical ? BRIDGE_DECK_WEST - middle : middle - BRIDGE_DECK_EAST;
            const deckFar = river.vertical ? BRIDGE_DECK_EAST - middle : middle - BRIDGE_DECK_WEST;

            // The straight runs must be on land in the arena, both rows of them
            const inArena = (p: Point) =>
                p.x >= arena.x0 && p.y >= arena.y0 && p.x <= arena.x1 && p.y <= arena.y1;
            const onLand = (distance: number) => {
                const p = across(distance);
                const q = river.vertical ? { x: p.x, y: p.y - 1 } : { x: p.x - 1, y: p.y };
                const free = (t: Point) => {
                    const i = ground.tile(t.x, t.y);
                    return !water[i] && !zone[i] && !avoid?.[i];
                };
                return inArena(p) && inArena(q) && free(p) && free(q);
            };
            let fits = true;
            for (let distance = deckFar; distance <= straight + 1; distance++) {
                fits &&= onLand(distance);
            }
            for (let distance = deckNear - 1; distance >= -straight - 2; distance--) {
                fits &&= onLand(distance);
            }
            const crossesOther = rivers.some(
                (other) => other !== river && Math.abs(crossing - riverCentre(other, line)) < 26,
            );
            if (!fits || crossesOther) {
                continue;
            }
            // Each biome has its own, where one fits, and banks stand as far over the water
            // as they do where they're from
            const middleTile = river.vertical ? biomeAt(line, crossing) : biomeAt(crossing, line);
            const def = BRIDGES[middleTile.bridge];
            const eastWest = rotatePrefab(loadPrefab(context, def), def.turns, context.locs);
            const height = river.levels[crossing] + def.bankHeight;
            const options = {
                floor: (overlay: number) => overlay === BRIDGE_HIDDEN_FLOOR,
                feather: 0,
                flatten: false,
                height,
                anchor: def.bankHeight,
                keepUnderlays: true,
                keepHeights: true,
            };
            const stampAt = crossing - BRIDGE_DECK_ROW;
            const bridge = river.vertical ? eastWest : rotatePrefab(eastWest, 1, context.locs);
            const stampX = river.vertical ? line - middle : stampAt;
            const stampY = river.vertical ? stampAt : line - middle;
            ground.stamp(bridge, stampX, stampY, options);
            // A deck comes down on its banks, so water that gets as far as its ends goes
            for (const end of [line + deckNear, line + deckFar]) {
                const [x, y] = river.vertical ? [end, stampY] : [stampX, end];
                const [sizeX, sizeY] = river.vertical ? [0, bridge.sizeY] : [bridge.sizeX, 0];
                clearWater(build, water, x, y, sizeX, sizeY, dry);
            }
            seatBridge(build, bridge, stampX, stampY, river.levels[crossing], height);
            for (let y = stampY; y < stampY + bridge.sizeY; y++) {
                for (let x = stampX; x < stampX + bridge.sizeX; x++) {
                    zone[ground.tile(x, y)] = 1;
                }
            }
            // Nothing goes on the road's rows or close by, all the way along: no buildings
            // or trees, nor roads doubling back beside it
            for (let distance = -straight; distance <= straight; distance++) {
                const p = across(distance);
                for (let row = -BRIDGE_ROAD_CLEAR - 1; row <= BRIDGE_ROAD_CLEAR; row++) {
                    const x = river.vertical ? p.x : p.x + row;
                    const y = river.vertical ? p.y + row : p.y;
                    ground.reserved[ground.tile(x, y)] = 1;
                    zone[ground.tile(x, y)] = 1;
                }
            }
            for (const [deck, end, way] of [
                [deckNear, -straight, -1],
                [deckFar, straight, 1],
            ]) {
                const lead: Point[] = [];
                for (let distance = deck; distance !== end + way; distance += way) {
                    lead.push(across(distance));
                }
                starts.push({ from: across(end + way), lead, height });
            }
        }
    }
    return starts;
}

// Takes water off the tiles round a line of corners, from x, y on for sizeX or sizeY more: its
// tiles either side. They're marked in dry, if there is one, so that it doesn't come back.
function clearWater(
    build: Build,
    water: Uint8Array,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
    dry?: Uint8Array,
): void {
    const { ground, terrain, heldCorners, corners } = build;
    const tiles = new Uint8Array(water.length);
    for (let ty = y - (sizeX > 0 ? 1 : 0); ty < y + Math.max(sizeY, 1); ty++) {
        for (let tx = x - (sizeY > 0 ? 1 : 0); tx < x + Math.max(sizeX, 1); tx++) {
            tiles[ground.tile(tx, ty)] = water[ground.tile(tx, ty)];
            water[ground.tile(tx, ty)] = 0;
            if (dry) {
                dry[ground.tile(tx, ty)] = 1;
            }
        }
    }
    ground.clearOverlay(tiles);
    const isWater = (tx: number, ty: number) => water[ground.tile(tx, ty)] !== 0;
    for (let cy = y - 1; cy <= y + Math.max(sizeY, 1); cy++) {
        for (let cx = x - 1; cx <= x + Math.max(sizeX, 1); cx++) {
            const near = [
                [cx - 1, cy - 1],
                [cx, cy - 1],
                [cx - 1, cy],
                [cx, cy],
            ];
            if (!near.some(([tx, ty]) => isWater(tx, ty))) {
                const at = cx + cy * corners.x;
                heldCorners[at] = 0;
                terrain.unlock(at);
            }
        }
    }
}

// The ground under a bridge. Its banks are level, for a road to run off, and water stays as it
// is: nothing tilts it. The deck's stored over the ground under it, so it's stored again over
// ours, and stands where it stood whatever's under it now.
function seatBridge(
    build: Build,
    bridge: TileGrid,
    stampX: number,
    stampY: number,
    water: number,
    bank: number,
): void {
    const { ground, terrain, corners } = build;
    const stampCorners = bridge.sizeX + 1;
    const deck = ground.grid.levels[1].heights;
    for (let cy = 0; cy <= bridge.sizeY; cy++) {
        for (let cx = 0; cx <= bridge.sizeX; cx++) {
            const x = stampX + cx;
            const y = stampY + cy;
            const at = x + y * corners.x;
            const own = bridge.levels[0].heights[cx + cy * stampCorners];
            const wet = terrain.isLocked(at);
            terrain.pin(x, y, bank);
            // Over the prefab's own river, at the height of ours
            deck[at] = Math.max(deck[at] + water + own - (wet ? water : bank), 0);
        }
    }
}

// The line the ring road or spine means to take. Nothing's laid yet: towns are planned first, so
// that a wall's gates can go where it arrives.
export function getMainRoadLine(build: Build): Point[] {
    const { settings, arena, spawn, sizeX, sizeY } = build;
    const line: Point[] = [];
    if (settings.roads <= 0 || settings.roadStyle === "branching") {
        return line;
    }
    const wiggle = createNoise(settings.seed + 8, 1);
    if (settings.roadStyle === "ring") {
        const middleX = (arena.x0 + arena.x1) / 2;
        const middleY = (arena.y0 + arena.y1) / 2;
        const radiusX = (arena.x1 - arena.x0) * 0.32;
        const radiusY = (arena.y1 - arena.y0) * 0.32;
        const steps = Math.ceil((radiusX + radiusY) * 4);
        for (let step = 0; step <= steps; step++) {
            const angle = (step / steps) * Math.PI * 2;
            const out =
                1 +
                (wiggle(Math.cos(angle) * 2 + 3, Math.sin(angle) * 2 + 3) - 0.5) *
                    settings.roadCurviness *
                    0.8;
            line.push({
                x: middleX + Math.cos(angle) * radiusX * out,
                y: middleY + Math.sin(angle) * radiusY * out,
            });
        }
    } else {
        // Off both sides of the map, through the spawn, the long way
        const eastWest = sizeX >= sizeY;
        const length = eastWest ? sizeX : sizeY;
        const middle = eastWest ? spawn.y : spawn.x;
        const swing = 8 + settings.roadCurviness * 50;
        for (let along = 0; along < length; along++) {
            const across = middle + (wiggle(along / 50, 7.5) - 0.5) * 2 * swing;
            line.push(eastWest ? { x: along, y: across } : { x: across, y: along });
        }
    }
    return line;
}

// The ring road or spine, for the others to join, stopping short of a town's wall or its square.
// The roads out of its gates pick it up from there.
export function layMainRoads(build: Build, roads: RoadNetwork, bridgeZone: Uint8Array): void {
    const { ground, towns } = build;
    if (roads.plannedLine.length === 0) {
        return;
    }
    const skip = new Uint8Array(roads.water.length);
    for (let i = 0; i < skip.length; i++) {
        skip[i] = roads.water[i] | bridgeZone[i];
    }
    const mark = (x0: number, y0: number, x1: number, y1: number) => {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (ground.inside(x, y)) {
                    skip[ground.tile(x, y)] = 1;
                }
            }
        }
    };
    for (const { x0, y0, x1, y1, wall } of towns ?? []) {
        mark(x0, y0, x1, y1);
        if (wall) {
            const far = WALL_CLEAR;
            mark(wall.x0 - far, wall.y0 - far, wall.x1 + far, wall.y1 + far);
        }
    }
    const { ranks } = ground.claims;
    for (let i = 0; i < skip.length; i++) {
        skip[i] |= ranks[i] !== 0 && ranks[i] < RESERVE_STREET ? 1 : 0;
    }
    roads.addMainRoad(roads.plannedLine, skip);
}
