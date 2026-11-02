import { BIOMES, BiomeId } from "./biomes";
import {
    CITY_WALLS,
    CITY_WALL_IDS,
    CityGate,
    CityWallKit,
    WALL_SIDES,
    WallRect,
    canCutCorners,
    forWallTiles,
    getGateColumns,
    getSideInsets,
    getTowerSpan,
    getWallSide,
    placeCityWall,
} from "./cityWalls";
import { TileRect } from "./collision";
import { PlacedLoc } from "./format";
import { Build, SPAWN_CLEAR, pick } from "./mapBuild";
import { createRng } from "./noise";
import { Point } from "./paths";
import { RESERVE_GATE, RESERVE_WALL } from "./reservations";
import { RoadNetwork } from "./roads";
import { pinPlot } from "./settlements";
import { PAVING } from "./structures";

// A town's wall comes first, and the town's fitted to it: the wall's shape from the ground, its
// gates from where roads arrive, and only then its streets and buildings.

// What's kept clear of a gate, in tiles: how far in behind it and how far out in front, and how
// many past its sides. Nothing but its road goes there, so that a gate always opens on to a street
// you can see down. 12 is about three quarters of a screen's height.
export const GATE_CLEAR_IN = 12;

export const GATE_CLEAR_OUT = 8;

const GATE_CLEAR_SIDE = 2;

// Tiles of open ground kept along the inside of a wall, for a crowd to get round
const WALL_FOOT = 2;

// Tiles roads keep off a wall
const WALL_ROAD_GAP = 3;

// How far from the corner of a wall a gate's middle can be, past the wall's chamfer
const GATE_CORNER = 5;

// A wall's rectangle, and how much of its band can be lost to water and cliffs before the ground's
// no place for one. Under the smallest size there's no room for a gate's street and buildings.
const LEAST_WALL_HALF = 30;

const MOST_LOST_BAND = 0.2;

// Tiles of town to a building, for how big a wall has to be: about a sixth of it is indoors,
// which is in the middle of the real 10% to 25%
const TILES_A_BUILDING = 360;

// How far a side can come in to get on to good ground, as a share of the wall's half
const MOST_PULL_IN = 0.4;

// How much a wall's rectangle differs from a square each way, at most
const WALL_STRETCH = 0.2;

// Tiles from a town's chosen middle a wall can move to find ground, and in steps of what
const WALL_SEARCH = 48;

const WALL_SEARCH_STEP = 8;

// The most the ground can rise inside a wall: past this its plateau is too much of a cutting
const WALL_RISE = 80;

// A side this long can take a gate with its town's streets, whether or not a road's arriving
const GATE_EVERY_SIDE = 56;

// Tiles from water that a wall's ground stays as it is, so that the bank can get down to it
const WALL_WATER_CLEAR = 4;

// How far a corner of a wall can be cut, as a share of its shorter side. It's what stops a city
// being a box, and it goes further where the ground's bad, as far as the most.
const LEAST_CORNER_CUT = 0.04;

const MOST_CORNER_CUT = 0.3;

// A seed of its own, so that it moves no other roll, for which wall a town gets
const WALL_KIT_SEED = 2417;

// A town with a wall round it: the rectangle its walkway runs round, what it's built of and where
// its gates are, and which of its tiles it can't stand on. locs are its own, once it's up.
export type WalledTown = WallRect & {
    kit: CityWallKit;
    gates: CityGate[];
    taken: Set<number>;
    locs?: PlacedLoc[];
};

// Where a road means to get to a side of a wall, along it, if it does
export type Arrival = { along: number; real: boolean };

// Which wall a town gets: the setting's, or one that suits its buildings, or else its biome
export function pickWallKit(
    build: Build,
    town: number,
    family: string,
    middle: Point,
): CityWallKit {
    const { settings, biomeAt } = build;
    if (settings.wallKit !== "auto") {
        return CITY_WALLS[settings.wallKit];
    }
    const roll = createRng(settings.seed + WALL_KIT_SEED + town);
    const here = biomeAt(Math.floor(middle.x), Math.floor(middle.y));
    const biome = Object.keys(BIOMES).find((id) => BIOMES[id as BiomeId] === here) ?? "";
    const byFamily = CITY_WALL_IDS.filter((id) => CITY_WALLS[id].families.includes(family));
    const byBiome = CITY_WALL_IDS.filter((id) => CITY_WALLS[id].biomes.includes(biome));
    return CITY_WALLS[pick(roll, byFamily.length > 0 ? byFamily : byBiome)];
}

// Whether a wall can stand on a tile
function isWallGround(build: Build, roads: RoadNetwork, x: number, y: number): boolean {
    const { ground, cliffs, mainland, spawn } = build;
    if (!ground.inside(x, y)) {
        return false;
    }
    const i = ground.tile(x, y);
    return (
        !roads.water[i] &&
        !cliffs[i] &&
        mainland[i] !== 0 &&
        !roads.bridgeZone[i] &&
        !roads.avoid[i] &&
        !ground.reserved[i] &&
        !ground.claims.ranks[i] &&
        Math.hypot(x - spawn.x, y - spawn.y) > SPAWN_CLEAR
    );
}

// How many tiles of a wall's band won't take it, down a side
function countBadTiles(
    build: Build,
    roads: RoadNetwork,
    kit: CityWallKit,
    rect: WallRect,
    turn: number,
): number {
    const side = getWallSide(rect, turn);
    let bad = 0;
    for (let along = -1; along <= side.length + 1; along++) {
        for (let across = -1; across <= kit.width; across++) {
            bad += isWallGround(build, roads, side.x(along, across), side.y(along, across)) ? 0 : 1;
        }
    }
    return bad;
}

// The shape of a town's wall: as big as its buildings need, up to its town size, round a spot as
// near its middle as the ground lets it, with each side brought in till it stands on ground that
// can take it. Undefined if there's nowhere: a town doesn't get a wall that the ground fights.
export function fitWall(
    build: Build,
    roads: RoadNetwork,
    kit: CityWallKit,
    middle: Point,
    wanted: number,
    roll: () => number,
): WallRect | undefined {
    const { settings, arena, terrain, towns } = build;
    const past = kit.tower ? getTowerSpan(kit).back : 1;
    const edge = settings.boundary === "sea" ? 3 : settings.boundaryDepth + 3;
    // Any side's to be able to take a gate, with what's kept clear in front of it
    const inset = edge + past + GATE_CLEAR_OUT;
    const half = Math.min(Math.sqrt(wanted * TILES_A_BUILDING) / 2, settings.townSize);
    const stretch = 1 + (roll() * 2 - 1) * WALL_STRETCH;
    const halfX = Math.max(Math.round(half * stretch), LEAST_WALL_HALF);
    const halfY = Math.max(Math.round(half / stretch), LEAST_WALL_HALF);
    const smallest = LEAST_WALL_HALF * 2;
    let best: WallRect | undefined;
    let bestBad = Infinity;
    for (let reach = 0; reach <= WALL_SEARCH; reach += WALL_SEARCH_STEP) {
        for (let turn = 0; turn < (reach === 0 ? 1 : 8); turn++) {
            const angle = (turn / 8) * Math.PI * 2;
            const x = Math.round(middle.x + Math.cos(angle) * reach);
            const y = Math.round(middle.y + Math.sin(angle) * reach);
            const rect = {
                x0: Math.max(x - halfX, arena.x0 + inset),
                y0: Math.max(y - halfY, arena.y0 + inset),
                x1: Math.min(x + halfX, arena.x1 - inset),
                y1: Math.min(y + halfY, arena.y1 - inset),
            };
            const keys = ["y0", "x0", "y1", "x1"] as const;
            let bad = 0;
            keys.forEach((key, side) => {
                const way = side < 2 ? 1 : -1;
                const start = rect[key];
                const most = Math.round(((side & 1 ? halfX : halfY) * MOST_PULL_IN) | 0);
                let fewest = Infinity;
                let at = start;
                for (let pull = 0; pull <= most && fewest > 0; pull++) {
                    rect[key] = start + pull * way;
                    const count = countBadTiles(build, roads, kit, rect, side);
                    if (count < fewest) {
                        fewest = count;
                        at = rect[key];
                    }
                }
                rect[key] = at;
                bad += fewest;
            });
            const sizeX = rect.x1 - rect.x0;
            const sizeY = rect.y1 - rect.y0;
            const clearOfWalls = !(towns ?? []).some(
                ({ wall }) =>
                    wall &&
                    rect.x0 < wall.x1 + GATE_CLEAR_OUT &&
                    wall.x0 < rect.x1 + GATE_CLEAR_OUT &&
                    rect.y0 < wall.y1 + GATE_CLEAR_OUT &&
                    wall.y0 < rect.y1 + GATE_CLEAR_OUT,
            );
            if (sizeX < smallest || sizeY < smallest || !clearOfWalls) {
                continue;
            }
            const band = (sizeX + sizeY) * 2 * (kit.width + 2);
            const { min, max } = terrain.getRange(rect.x0, rect.y0, sizeX, sizeY);
            if (bad < bestBad && bad <= band * MOST_LOST_BAND && max - min <= WALL_RISE) {
                best = rect;
                bestBad = bad;
            }
        }
        if (bestBad === 0) {
            break;
        }
    }
    return best;
}

// Cuts a wall's corners, each by a roll and on past ground that won't take it, so that the shape
// comes from the land. It leaves room on each side for a gate.
export function cutWallCorners(
    build: Build,
    roads: RoadNetwork,
    kit: CityWallKit,
    rect: WallRect,
    roll: () => number,
): void {
    if (!canCutCorners(kit)) {
        return;
    }
    const shorter = Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0);
    const most = Math.round(shorter * MOST_CORNER_CUT);
    const cuts = [0, 1, 2, 3].map(() => {
        const share = LEAST_CORNER_CUT + roll() * (MOST_CORNER_CUT - LEAST_CORNER_CUT);
        return Math.max(Math.round(shorter * share), kit.chamfer);
    });
    cuts.forEach((_, turn) => {
        const side = getWallSide(rect, turn);
        const isBad = (cut: number) => {
            for (let along = 0; along < cut; along++) {
                const across = cut - 1 - along;
                if (!isWallGround(build, roads, side.x(along, across), side.y(along, across))) {
                    return true;
                }
            }
            return false;
        };
        while (cuts[turn] < most && isBad(cuts[turn])) {
            cuts[turn]++;
        }
    });
    rect.cuts = cuts;
}

// What's inside a wall, past the foot of it, that a building's plot can stand on
export function getWallInside(kit: CityWallKit, rect: WallRect): TileRect {
    const inset = kit.width + 1 + WALL_FOOT;
    return {
        x0: rect.x0 + inset,
        y0: rect.y0 + inset,
        x1: rect.x1 - inset,
        y1: rect.y1 - inset,
    };
}

// Whether a rectangle of tiles is all on what a wall leaves to build on, cut corners included
export function isInsideWall(wall: WalledTown, { x0, y0, x1, y1 }: TileRect): boolean {
    const inside = getWallInside(wall.kit, wall);
    if (x0 < inside.x0 || y0 < inside.y0 || x1 > inside.x1 || y1 > inside.y1) {
        return false;
    }
    const clear = wall.kit.width + 1 + WALL_FOOT;
    const corners = [
        [wall.x0, wall.y0, x0, y0],
        [wall.x0, wall.y1, x0, y1],
        [wall.x1, wall.y1, x1, y1],
        [wall.x1, wall.y0, x1, y0],
    ];
    return corners.every(([cornerX, cornerY, x, y], turn) => {
        const [cut] = getSideInsets(wall.kit, wall, turn);
        return Math.abs(x - cornerX) + Math.abs(y - cornerY) >= cut + clear * 1.5;
    });
}

// How far along a side a point is, in the side's own frame
function getAlong(rect: WallRect, turn: number, point: Point): number {
    return [point.x - rect.x0, rect.y1 - point.y, rect.x1 - point.x, point.y - rect.y0][turn];
}

// Where outside roads will arrive at each side of a wall: where the main road's line crosses it,
// or else the side nearest to what a road would come from, across from where that is. The rest
// have no road coming, and go by their middles.
export function getArrivals(build: Build, roads: RoadNetwork, rect: WallRect): Arrival[] {
    const { spawn, towns } = build;
    const arrivals: Arrival[] = WALL_SIDES.map((_, turn) => ({
        along: getWallSide(rect, turn).length >> 1,
        real: false,
    }));
    const isInside = ({ x, y }: Point) =>
        x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    const faces = ({ x, y }: Point) => {
        const away = [rect.y0 - y, rect.x0 - x, y - rect.y1, x - rect.x1];
        return away.indexOf(Math.max(...away));
    };
    const line = roads.plannedLine;
    for (let i = 1; i < line.length; i++) {
        if (isInside(line[i]) !== isInside(line[i - 1])) {
            const outside = isInside(line[i]) ? line[i - 1] : line[i];
            const turn = faces(outside);
            if (!arrivals[turn].real) {
                arrivals[turn] = { along: getAlong(rect, turn, outside), real: true };
            }
        }
    }
    const others = (towns ?? []).map(({ x0, y0, x1, y1 }) => ({
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
    }));
    for (const place of [spawn, ...others, ...roads.arrivalPoints]) {
        const turn = faces(place);
        if (!isInside(place) && !arrivals[turn].real) {
            arrivals[turn] = { along: getAlong(rect, turn, place), real: true };
        }
    }
    return arrivals;
}

// How many gates a wall wants: one wherever a road's arriving and at least two, and on every side
// of a big one, which is what stops a wall being a choke
export function getGateCount(rect: WallRect, arrivals: Arrival[]): number {
    const big = Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) >= GATE_EVERY_SIDE;
    return big ? 4 : Math.max(arrivals.filter((arrival) => arrival.real).length, 2);
}

// The columns along a side a gate's middle can be at
export function getGateRange(kit: CityWallKit, rect: WallRect, turn: number): [number, number] {
    const [first, last] = getSideInsets(kit, rect, turn);
    return [first + GATE_CORNER, getWallSide(rect, turn).length - last - GATE_CORNER];
}

// A gate at a column of a side
export function getGateAt(rect: WallRect, turn: number, along: number): CityGate {
    const side = getWallSide(rect, turn);
    return { side: WALL_SIDES[turn], at: turn & 1 ? side.y(along, 0) : side.x(along, 0) };
}

// A point on the line through the middle of a gate, by how far in from the wall's outer edge. It's
// on tile corners, as a street is.
export function getGateLine(
    kit: CityWallKit,
    rect: WallRect,
    gate: CityGate,
): (across: number) => Point {
    const { side, start } = getGateColumns(kit, rect, gate);
    const middle = start + (kit.gateSize - 1) / 2;
    return (across) => ({ x: side.x(middle, across) + 0.5, y: side.y(middle, across) + 0.5 });
}

// A gate's kept-clear space, inside and outside the wall, as rectangles of tiles
export function getGateClear(kit: CityWallKit, rect: WallRect, gate: CityGate): TileRect[] {
    const { side, start } = getGateColumns(kit, rect, gate);
    const from = start - GATE_CLEAR_SIDE;
    const to = start + kit.gateSize - 1 + GATE_CLEAR_SIDE;
    const box = (near: number, far: number): TileRect => {
        const xs = [side.x(from, near), side.x(to, far)];
        const ys = [side.y(from, near), side.y(to, far)];
        return {
            x0: Math.min(...xs),
            y0: Math.min(...ys),
            x1: Math.max(...xs),
            y1: Math.max(...ys),
        };
    };
    return [box(kit.width + 1, kit.width + GATE_CLEAR_IN), box(-2, -1 - GATE_CLEAR_OUT)];
}

// The gate's own ground, from one side of the wall to the other
function getGatePlot(kit: CityWallKit, rect: WallRect, gate: CityGate): TileRect {
    const { side, start } = getGateColumns(kit, rect, gate);
    const end = start + kit.gateSize - 1;
    const xs = [side.x(start, -2), side.x(end, kit.width + 1)];
    const ys = [side.y(start, -2), side.y(end, kit.width + 1)];
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Whether a tile's near water, which a wall's ground then leaves alone
function isNearWater(build: Build, water: Uint8Array, x: number, y: number): boolean {
    const { ground } = build;
    for (let ty = y - WALL_WATER_CLEAR; ty <= y + WALL_WATER_CLEAR; ty++) {
        for (let tx = x - WALL_WATER_CLEAR; tx <= x + WALL_WATER_CLEAR; tx++) {
            if (ground.inside(tx, ty) && water[ground.tile(tx, ty)]) {
                return true;
            }
        }
    }
    return false;
}

// Takes a wall's band and its gates' clear spaces for good, and levels its ground, which is what
// makes it a site: nothing after this can stand there. Fords keep off too.
export function reserveWall(
    build: Build,
    roads: RoadNetwork,
    wall: WalledTown,
    height: number,
): void {
    const { ground, terrain, cliffs, mainland, heldCorners, plots } = build;
    const { claims } = ground;
    const { kit, gates, taken } = wall;
    const seen = new Set<number>();
    const near = new Set<number>();
    forWallTiles(kit, wall, (x, y) => {
        const i = ground.tile(x, y);
        if (seen.has(i)) {
            return;
        }
        seen.add(i);
        if (roads.water[i] || cliffs[i] || !mainland[i] || roads.bridgeZone[i]) {
            taken.add(i);
        } else if (!isNearWater(build, roads.water, x, y) && !heldCorners[terrain.corner(x, y)]) {
            terrain.pinRect(x, y, 1, 1, height);
        }
        claims.takeTile(i, RESERVE_WALL);
        // Roads and fords keep their distance: what's pinned here doesn't bend for them
        for (let ty = y - WALL_ROAD_GAP; ty <= y + WALL_ROAD_GAP; ty++) {
            for (let tx = x - WALL_ROAD_GAP; tx <= x + WALL_ROAD_GAP; tx++) {
                near.add(ground.tile(tx, ty));
            }
        }
    });
    for (const i of near) {
        roads.offLimits[i]++;
    }
    // Plots for its sides, so that a road going by comes up to it, and anything else keeps its
    // distance. What's pinned that isn't a plot, a road knows nothing about.
    const { x0, y0, x1, y1 } = wall;
    const band = kit.width + 2;
    plots.push(
        { x: x0 - 1, y: y0 - 1, sizeX: x1 - x0 + band, sizeY: band, height },
        { x: x0 - 1, y: y1 - kit.width, sizeX: x1 - x0 + band, sizeY: band, height },
        { x: x0 - 1, y: y0 - 1, sizeX: band, sizeY: y1 - y0 + band, height },
        { x: x1 - kit.width, y: y0 - 1, sizeX: band, sizeY: y1 - y0 + band, height },
    );
    for (const gate of gates) {
        for (const rect of getGateClear(kit, wall, gate)) {
            claims.take(
                rect.x0,
                rect.y0,
                rect.x1 - rect.x0 + 1,
                rect.y1 - rect.y0 + 1,
                RESERVE_GATE,
            );
        }
        const plot = getGatePlot(kit, wall, gate);
        pinPlot(build, plot.x0, plot.y0, plot.x1 - plot.x0 + 1, plot.y1 - plot.y0 + 1, height);
    }
}

// Inside a wall a road's paved
export function getPaving(walled: WalledTown[], x: number, y: number): number | undefined {
    return walled.some((town) => isWithinWall(town, x, y)) ? PAVING : undefined;
}

// Whether a tile's inside a wall's line
function isWithinWall(town: WalledTown, x: number, y: number): boolean {
    const { x0, y0, x1, y1, kit } = town;
    if (x <= x0 || x >= x1 || y <= y0 || y >= y1) {
        return false;
    }
    const corners = [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
    ];
    return corners.every(([cornerX, cornerY], turn) => {
        const [cut] = getSideInsets(kit, town, turn);
        return Math.abs(x - cornerX) + Math.abs(y - cornerY) > cut;
    });
}

// The walls round towns, on what's left of the ground once the land's finished
export function placeTownWalls(build: Build, walled: WalledTown[]): void {
    const { ground } = build;
    for (const town of walled) {
        const { kit, gates, taken } = town;
        const from = ground.grid.locs.length;
        placeCityWall(
            ground,
            kit,
            town,
            gates,
            (x, y) => taken.has(ground.tile(x, y)) || ground.isWaterTile(x, y),
        );
        town.locs = ground.grid.locs.slice(from);
    }
}
