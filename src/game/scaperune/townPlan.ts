import { Exit } from "./building";
import { CityWallKit, WallRect } from "./cityWalls";
import { TileRect } from "./collision";
import {
    Build,
    LOC_NORMAL,
    SPAWN_CLEAR,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    lerp,
    smoothstep,
} from "./mapBuild";
import { createRng } from "./noise";
import { Point } from "./paths";
import { getBuildingKind } from "./prefabs";
import { RESERVE_PLOT, RESERVE_STREET } from "./reservations";
import { RoadNetwork } from "./roads";
import { KIT_FENCES, PlacedBuilding, markOffLimits, pinPlot, putFence } from "./settlements";
import { FOUNTAIN } from "./structures";
import {
    GATE_CLEAR_IN,
    GATE_CLEAR_OUT,
    WalledTown,
    cutWallCorners,
    fitWall,
    getArrivals,
    getGateAt,
    getGateCount,
    getGateLine,
    getGateRange,
    getWallInside,
    isInsideWall,
    pickWallKit,
    reserveWall,
} from "./townWalls";

// Towns laid out in steps, as a whole: first the site, then a wall and its gates if it has one,
// then a paved square with something in it and main streets from there to the gates. Outside roads
// are laid next (generator.ts), and only then buildings, a few tiles apart along the streets with
// the biggest on the square. Past the paving it goes organic: settlements.ts's scatter fills in with
// lanes of its own, and trees take over from buildings over a ring of ground. A hamlet's the same in
// small, with no wall. See "The flow" in the guide, and the design research, section 6.

export type TownKind = "market" | "axis" | "hamlet";

type KindDef = {
    // The square, tiles across, and how many sides have a street
    squareX: number;
    squareY: number;
    streets: number;
    streetHalf: number;
    paved: boolean;
};

const KINDS: Record<TownKind, KindDef> = {
    // Hosidius: a square with a well and stalls, and a street out of each side
    market: { squareX: 19, squareY: 15, streets: 4, streetHalf: 3.5, paved: true },
    // Shayzien: one long paved way, with a small square on it
    axis: { squareX: 11, squareY: 9, streets: 2, streetHalf: 3.5, paved: true },
    // Most places: a green with a well, and a lane
    hamlet: { squareX: 9, squareY: 9, streets: 2, streetHalf: 2, paved: false },
};

export type PlannedTown = {
    kind: TownKind;
    // Which of the map's towns it is
    town: number;
    // The square, as tile corners
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    height: number;
    // How far out from its middle streets run
    reach: number;
    streets: Street[];
    // Lesser ones, off those
    sideStreets: Street[];
    // Square and street tiles, which other roads can join once it's joined up itself
    held: number[];
    parts: TownParts;
    wall?: WalledTown;
};

// How many buildings make a market, and an axis
const MARKET_BUILDINGS = 10;
const AXIS_BUILDINGS = 5;

const TOWN_PLAN_SEED = 410;

const TOWN_FILL_SEED = 1410;

// Tiles from the centre of a town spots are looked for its square
const SQUARE_SEARCH = 20;
const SQUARE_SEARCH_STEP = 3;

// How far the ground under a town can be off its height
const TOWN_RISE = 20;

const SHORTEST_STREET = 10;

// Tiles from a street's edge to the walls along it, past its half width: its plot starts past what
// the street paints, so doors end up a tile or two from a road
const WALL_OFF_STREET = 1.5;

// And from a square's edge. It paints half a tile further, and a plot has a tile round its walls.
const WALL_OFF_SQUARE = 2;

// Gaps between buildings along a street: alleys, and a bit more. Side streets close them up by
// a tile: 44% of West Varrock's buildings have one within 2 tiles.
const LEAST_GAP = 3;
const MOST_GAP = 5;
const CLOSER_GAP = 1;

// Tiles round a building's walls that are its plot, for what's stood against them
const PLOT_MARGIN = 1;

// Tiles between one plot and the next, so that two fences never share a line
const PLOT_GAP = 1;

// Tiles past a building's wall that have to be land
const WALL_CLEAR = 2;

// How far a town's middle can be off the middle of its wall, as a share of that, so that a city
// isn't always a target
const MIDDLE_OFF = 0.12;

// The most a gate's street can be off ground its town's height, which is more than a building
const STREET_RISE = 40;

// Tiles past the inside of a wall that its street runs up to
const STREET_PAST_WALL = 2;

// Tiles a square keeps off a bridge's road, which needs them to swing away
const BRIDGE_ROOM = 10;

// Tiles past a street's half width that it stops short of what stopped it
const STREET_SHORT = 2;

// Tiles past the outer edge of a gate's clear space that a road runs straight
const GATE_STRAIGHT = 2;

// Tiles over which a town's level ground gets back to the land's, past its edge and from water and
// cliffs, which stay as they are
export const LEVEL_FADE = 6;

// A side street's half width, and tiles along a main street to the first and between them, with
// the setting at its least and most. West Varrock's blocks are 6 to 17 by 9 to 26, and a plot and
// what two streets paint comes to 18: 20 is a row of buildings each way, and 34 is two with yards.
// Streets run to the wall.
const SIDE_STREET_HALF = 2;

const SIDE_STREET_FIRST = 18;

const SIDE_STREET_APART = 34;

// Tiles short of a main street's end that the last one leaves it, which is to say a gate's clear
// space, as rows that close to a wall have no room for a plot
const SIDE_STREET_LAST = 12;

const SIDE_STREET_CLOSE = 20;

const SIDE_STREET_JITTER = 6;

// Past this much of the setting, lanes off side streets, about as wide as a real alley, and
// buildings stand a tile closer on plots of their own width
export const CLOSE_STREETS = 0.6;

const LANE_HALF = 1.5;

// West Varrock's blocks run to 26 long, with two or three buildings to one: a lane to every block
// any shorter would only take their room
const LANE_APART = 30;

const SHORTEST_JOIN = 4;

// How far apart spots are tried in what's left of a block, and how far a door can be from a street
// there, in steps of road. Doors are a tile or two from a path, and in a real town's back rows more.
const BLOCK_STEP = 2;

const DOOR_MOST_STEPS = 5;

// A door on a street's line
const DOOR_STEPS = 3;

// Tiles between a plot and water, so that the ground can get down to it
const WATER_CLEAR = 6;

const MAX_PLOT_RISE = 18;

// A town's paved core, as a share of its reach
const CORE_SHARE = 0.65;

// Tiles past a town's streets over which trees come back, in a town and in a hamlet, and how
// many ground a yard takes
const FADE_TILES = 32;
const HAMLET_FADE_TILES = 8;
const YARD_DEEP = 5;
const YARD_GATE = 2;
const LEAST_YARDS = 0.4;

// How far a line of buildings on a square can run past its corner
const OVER_CORNER = 5;

const PER_CHURCH = 12;

// How much is scattered near a site and between them, and how far that takes
const BUSY_PACE = 2.6;
const QUIET_PACE = 0.6;
const SITE_NEAR = 14;
const SITE_FADE = 16;

// Cells of 32 tiles, as a shift
const REACH_CELL = 5;

const WELL = 884;
const STALLS = [634, 11729, 11730, 634];

// What a square has in it, for the palette
export const SQUARE_LOCS = [WELL, ...STALLS];

// A line that buildings stand along: walls on the line, going out from it
type Frontage = {
    x: number;
    y: number;
    stepX: number;
    stepY: number;
    length: number;
    outX: number;
    outY: number;
    along: number;
    onSquare: boolean;
    done: boolean;
};

export type Street = {
    points: Point[];
    end: Point;
    length: number;
    wayX: number;
    wayY: number;
    halfWidth: number;
};

// Whether a band of tiles across a street's way can be built on
function canPave(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    x: number,
    y: number,
    height: number,
    rise = TOWN_RISE,
): boolean {
    const { ground, cliffs, mainland, terrain, arena } = build;
    const inset = 3;
    if (
        x < arena.x0 + inset ||
        y < arena.y0 + inset ||
        x > arena.x1 - inset ||
        y > arena.y1 - inset
    ) {
        return false;
    }
    const i = ground.tile(x, y);
    return (
        !water[i] &&
        !cliffs[i] &&
        mainland[i] !== 0 &&
        !roads.bridgeZone[i] &&
        !roads.avoid[i] &&
        !ground.footprint[i] &&
        !ground.reserved[i] &&
        Math.abs(terrain.getHeight(x, y) - height) <= rise
    );
}

type TownSquare = { x0: number; y0: number; x1: number; y1: number; height: number };

// Whether a square leaves a bridge's road room to swing away, past the straight it's kept clear for
function isClearOfBridges(
    roads: RoadNetwork,
    { ground }: Build,
    x0: number,
    y0: number,
    { squareX, squareY }: KindDef,
): boolean {
    for (let y = y0 - BRIDGE_ROOM; y <= y0 + squareY + BRIDGE_ROOM; y++) {
        for (let x = x0 - BRIDGE_ROOM; x <= x0 + squareX + BRIDGE_ROOM; x++) {
            if (ground.inside(x, y) && roads.bridgeZone[ground.tile(x, y)]) {
                return false;
            }
        }
    }
    return true;
}

function findSquare(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    middle: Point,
    def: KindDef,
    inside?: TileRect,
): TownSquare | undefined {
    const { terrain, ground, spawn } = build;
    const fits = (x0: number, y0: number) => {
        const { min, max } = terrain.getRange(x0, y0, def.squareX, def.squareY);
        const height = Math.round((min + max) / 2);
        if (max - min > TOWN_RISE) {
            return undefined;
        }
        for (let y = y0 - 1; y <= y0 + def.squareY; y++) {
            for (let x = x0 - 1; x <= x0 + def.squareX; x++) {
                if (
                    !canPave(build, roads, water, x, y, height) ||
                    ground.reserved[ground.tile(x, y)] ||
                    Math.hypot(x - spawn.x, y - spawn.y) <= SPAWN_CLEAR
                ) {
                    return undefined;
                }
            }
        }
        return height;
    };
    for (let reach = 0; reach <= SQUARE_SEARCH; reach += SQUARE_SEARCH_STEP) {
        for (let turn = 0; turn < (reach === 0 ? 1 : 8); turn++) {
            const angle = (turn / 8) * Math.PI * 2;
            const x0 = Math.round(middle.x + Math.cos(angle) * reach - def.squareX / 2);
            const y0 = Math.round(middle.y + Math.sin(angle) * reach - def.squareY / 2);
            const within =
                !inside ||
                (x0 >= inside.x0 &&
                    y0 >= inside.y0 &&
                    x0 + def.squareX <= inside.x1 &&
                    y0 + def.squareY <= inside.y1);
            const height =
                within && isClearOfBridges(roads, build, x0, y0, def) ? fits(x0, y0) : undefined;
            if (height !== undefined) {
                return { x0, y0, x1: x0 + def.squareX, y1: y0 + def.squareY, height };
            }
        }
    }
    return undefined;
}

// A street out of the middle of a side of a square, for as far as the ground lets it
function walkStreet(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    from: Point,
    wayX: number,
    wayY: number,
    longest: number,
    def: KindDef,
    height: number,
    rise = TOWN_RISE,
    toWall = false,
): Street {
    const across = Math.ceil(def.streetHalf + WALL_OFF_STREET);
    // Its end's round, so it stops short of what's in its way. One to a gate's meant to get there.
    const ahead = toWall ? 0 : Math.ceil(def.streetHalf) + STREET_SHORT;
    let length = longest;
    for (let step = 1; step <= longest + ahead; step++) {
        const x = from.x + wayX * step;
        const y = from.y + wayY * step;
        let free = true;
        for (let side = -across; side <= across; side++) {
            free &&= canPave(build, roads, water, x + wayY * side, y + wayX * side, height, rise);
        }
        if (!free) {
            length = Math.min(Math.max(step - 1 - ahead, 0), longest);
            break;
        }
    }
    const points: Point[] = [];
    for (let step = 0; step <= length; step++) {
        points.push({ x: from.x + wayX * step, y: from.y + wayY * step });
    }
    const end = points[points.length - 1];
    return { points, end, length, wayX, wayY, halfWidth: def.streetHalf };
}

// A street that's run into another goes on to meet it, rather than stop short. Tiles to where it
// does, or 0 if what's ahead isn't a street.
function findJoin(build: Build, street: Street, reach: number): number {
    const { ground } = build;
    const { end, wayX, wayY } = street;
    for (let step = 1; step <= reach; step++) {
        const x = end.x + wayX * step;
        const y = end.y + wayY * step;
        if (!ground.inside(x, y)) {
            return 0;
        }
        const i = ground.tile(x, y);
        if (ground.claims.ranks[i] === RESERVE_STREET) {
            return step + 1;
        }
        if (ground.reserved[i]) {
            return 0;
        }
    }
    return 0;
}

// Streets off a street, turning off both sides of it, for the buildings that the main streets
// leave no room for. A formal middle has looser ground round it, so where each falls is by a roll.
// They run till something stops them: if that's a street they join it, and past the setting's
// middle a side street has lanes of its own, which is what makes blocks of what would be rows.
function planSideStreets(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    main: Street,
    def: KindDef,
    height: number,
    held: number[],
    roll: () => number,
    level = 0,
): Street[] {
    const { sideStreets } = build.settings;
    if (sideStreets <= 0) {
        return [];
    }
    const half = level === 0 ? SIDE_STREET_HALF : LANE_HALF;
    const side: KindDef = { ...def, streetHalf: half };
    const streets: Street[] = [];
    const spacing =
        level > 0 ? LANE_APART : lerp(SIDE_STREET_APART, SIDE_STREET_CLOSE, sideStreets);
    const last = main.length - (level === 0 ? SIDE_STREET_LAST : SHORTEST_STREET);
    const offset = Math.ceil(main.halfWidth);
    for (const turn of [-1, 1]) {
        const first = level > 0 ? LANE_APART : SIDE_STREET_FIRST;
        // A short street still gets one, as far along as it can
        let along = first + Math.floor(roll() * SIDE_STREET_JITTER);
        along = level > 0 ? along : Math.min(along, last - 1);
        for (
            along = Math.max(along, offset + 1);
            along < last;
            along += Math.round(spacing + roll() * SIDE_STREET_JITTER)
        ) {
            const wayX = main.wayY * turn;
            const wayY = main.wayX * turn;
            const at = main.points[along];
            // From clear of the main street's own tiles, and joined back on to it after
            const from = { x: at.x + wayX * (offset + 2), y: at.y + wayY * (offset + 2) };
            const walked = walkStreet(build, roads, water, from, wayX, wayY, 99, side, height);
            const join = findJoin(build, walked, Math.ceil(half) * 2 + STREET_SHORT + 2);
            // A short one's only worth having if it gets somewhere
            if (walked.length + join < (join > 0 ? SHORTEST_JOIN : SHORTEST_STREET)) {
                continue;
            }
            const back = [0, 1].map((step) => ({
                x: at.x + wayX * (offset + step),
                y: at.y + wayY * (offset + step),
            }));
            const on = Array.from({ length: join }, (_, step) => ({
                x: walked.end.x + wayX * (step + 1),
                y: walked.end.y + wayY * (step + 1),
            }));
            const points = [...back, ...walked.points, ...on];
            const length = points.length - 1;
            const street = { ...walked, points, length, end: points[length] };
            roads.addStreet(points, half, height, held);
            roads.markJunction(at, Math.max(main.halfWidth, half));
            if (join > 0) {
                roads.markJunction(points[length], half + 1);
            }
            streets.push(street);
            if (level === 0 && sideStreets > CLOSE_STREETS) {
                streets.push(
                    ...planSideStreets(build, roads, water, street, def, height, held, roll, 1),
                );
            }
        }
    }
    return streets;
}

// Levels the ground under a town, so that its buildings all stand at about one height and its wall
// doesn't fight the land. Real towns are 76% to 89% dead flat. toRough is each tile's distance from
// water and cliffs, up to LEVEL_FADE.
function levelSite(build: Build, toRough: Float32Array, rect: TileRect, height: number): void {
    const { terrain, heldCorners, ground, corners } = build;
    for (let y = rect.y0 - LEVEL_FADE; y <= rect.y1 + LEVEL_FADE; y++) {
        for (let x = rect.x0 - LEVEL_FADE; x <= rect.x1 + LEVEL_FADE; x++) {
            if (x < 0 || y < 0 || x >= corners.x || y >= corners.y) {
                continue;
            }
            const at = terrain.corner(x, y);
            const past = Math.max(rect.x0 - x, x - rect.x1, rect.y0 - y, y - rect.y1, 0);
            const rough = ground.inside(x, y) ? toRough[ground.tile(x, y)] : 0;
            const share = smoothstep(1 - past / LEVEL_FADE) * smoothstep(rough / LEVEL_FADE);
            if (!heldCorners[at] && !terrain.isLocked(at)) {
                terrain.height[at] = lerp(terrain.height[at], height, share);
            }
        }
    }
}

// A wall's gates, each with its street to the square: as near as can be to where a road's arriving,
// on a column of the square so that its street runs dead straight, with ground all the way
function planGates(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    kit: CityWallKit,
    rect: WallRect,
    square: TownSquare,
    def: KindDef,
): { gates: WalledTown["gates"]; streets: Street[] } {
    const arrivals = getArrivals(build, roads, rect);
    const wanted = getGateCount(rect, arrivals);
    const gates: WalledTown["gates"] = [];
    const streets: Street[] = [];
    // Where a road really arrives first
    const turns = [0, 1, 2, 3].sort(
        (a, b) => Number(arrivals[b].real) - Number(arrivals[a].real) || a - b,
    );
    const edge = Math.ceil(def.streetHalf);
    for (const turn of turns) {
        if (gates.length >= wanted) {
            break;
        }
        const [first, last] = getGateRange(kit, rect, turn);
        const options: number[] = [];
        for (let along = first; along <= last; along++) {
            options.push(along);
        }
        options.sort(
            (a, b) => Math.abs(a - arrivals[turn].along) - Math.abs(b - arrivals[turn].along),
        );
        for (const along of options) {
            const gate = getGateAt(rect, turn, along);
            const line = getGateLine(kit, rect, gate);
            const inner = line(kit.width + STREET_PAST_WALL);
            const fromSquare =
                turn & 1
                    ? inner.y >= square.y0 + edge && inner.y <= square.y1 - edge
                    : inner.x >= square.x0 + edge && inner.x <= square.x1 - edge;
            if (!fromSquare) {
                continue;
            }
            const wayX = [0, -1, 0, 1][turn];
            const wayY = [-1, 0, 1, 0][turn];
            const from = {
                x: turn & 1 ? (wayX < 0 ? square.x0 : square.x1) : inner.x,
                y: turn & 1 ? inner.y : wayY < 0 ? square.y0 : square.y1,
            };
            const length = Math.floor(Math.abs(inner.x - from.x) + Math.abs(inner.y - from.y));
            const street = walkStreet(
                build,
                roads,
                water,
                from,
                wayX,
                wayY,
                length,
                def,
                square.height,
                STREET_RISE,
                true,
            );
            // The way out has to have ground too
            let open = street.length === length;
            for (let out = 2; open && out <= GATE_CLEAR_OUT + GATE_STRAIGHT; out++) {
                const { x, y } = line(-out);
                const i = build.ground.tile(Math.floor(x), Math.floor(y));
                open = !water[i] && !build.cliffs[i] && !build.ground.reserved[i];
            }
            if (open) {
                gates.push(gate);
                streets.push(street);
                break;
            }
        }
    }
    return { gates, streets };
}

export type TownParts = {
    // The names a town's buildings can be, its family's first
    names: string[];
    wanted: number;
    town: number;
    family: string;
};

// Sites a town and takes the ground for its wall, gates, square and streets, in that order. Nothing
// else has been laid yet but bridges, so these go where they want, and everything after them keeps
// off: see reservations.ts. Undefined if there's no room. A town with a wall goes without if the
// ground won't have one, and with roads at 0 only a walled town's planned at all.
export function layOutTown(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    middle: Point,
    parts: TownParts,
    wantsWall: boolean,
    toRough: Float32Array,
): PlannedTown | undefined {
    const { settings, ground } = build;
    const { names, wanted, town, family } = parts;
    const hasRoads = settings.roads > 0;
    if (!hasRoads && !wantsWall) {
        return undefined;
    }
    const roll = createRng(settings.seed + TOWN_PLAN_SEED + town);
    const byKind: TownKind[] =
        wanted >= MARKET_BUILDINGS
            ? [roll() < 0.6 ? "market" : "axis", "axis", "hamlet"]
            : wanted >= AXIS_BUILDINGS
              ? ["axis", "hamlet"]
              : ["hamlet"];
    const kitOfWall = wantsWall ? pickWallKit(build, town, family, middle) : undefined;
    let rect = kitOfWall && fitWall(build, roads, kitOfWall, middle, wanted, roll);
    let centre = middle;
    if (rect) {
        cutWallCorners(build, roads, kitOfWall!, rect, roll);
        const off = (min: number, max: number) =>
            (min + max) / 2 + (roll() - 0.5) * 2 * MIDDLE_OFF * (max - min);
        centre = { x: off(rect.x0, rect.x1), y: off(rect.y0, rect.y1) };
    }
    // A square stays out of its gates' clear space
    const fromWall = kitOfWall ? kitOfWall.width + 2 + GATE_CLEAR_IN : 0;
    const inside = rect && {
        x0: rect.x0 + fromWall,
        y0: rect.y0 + fromWall,
        x1: rect.x1 - fromWall,
        y1: rect.y1 - fromWall,
    };
    let kind: TownKind = "hamlet";
    let square: TownSquare | undefined;
    let planned: ReturnType<typeof planGates> | undefined;
    for (const next of byKind) {
        kind = next;
        square = findSquare(build, roads, water, centre, KINDS[next], inside);
        planned =
            rect && square
                ? planGates(build, roads, water, kitOfWall!, rect, square, KINDS[next])
                : undefined;
        if (square && (!rect || planned!.gates.length >= 2)) {
            break;
        }
        square = undefined;
    }
    if (!square && rect) {
        // A wall with no way in isn't a wall. It goes, and the town's laid out as any other.
        rect = undefined;
        for (const next of byKind) {
            kind = next;
            square = findSquare(build, roads, water, middle, KINDS[next]);
            if (square) {
                break;
            }
        }
    }
    if (!square || (!rect && !hasRoads)) {
        return undefined;
    }
    const def = KINDS[kind];
    const { x0, y0, x1, y1, height } = square;
    const cx = (x0 + x1) >> 1;
    const cy = (y0 + y1) >> 1;
    let kept: Street[];
    let wall: WalledTown | undefined;
    if (rect) {
        wall = { ...rect, kit: kitOfWall!, gates: planned!.gates, taken: new Set() };
        reserveWall(build, roads, wall, height);
        kept = planned!.streets;
    } else {
        const longest = Math.round(Math.min(settings.townSize * 0.9, kind === "hamlet" ? 18 : 99));
        // Every way a street could go, then the ones with the most ground
        const ways = [
            { from: { x: cx, y: y1 }, wayX: 0, wayY: 1 },
            { from: { x: cx, y: y0 }, wayX: 0, wayY: -1 },
            { from: { x: x1, y: cy }, wayX: 1, wayY: 0 },
            { from: { x: x0, y: cy }, wayX: -1, wayY: 0 },
        ];
        const streets = ways
            .map(({ from, wayX, wayY }) =>
                walkStreet(build, roads, water, from, wayX, wayY, longest, def, height),
            )
            .filter((street) => street.length >= SHORTEST_STREET);
        streets.sort((a, b) => b.length - a.length);
        kept = streets.slice(0, def.streets);
        // An axis is one line
        if (kind !== "market" && kept.length > 1) {
            const first = kept[0];
            const opposite = streets.find(
                (street) => street.wayX === -first.wayX && street.wayY === -first.wayY,
            );
            kept = opposite ? [first, opposite] : [first];
        }
    }

    // The ground, the square and the streets
    pinPlot(build, x0, y0, x1 - x0, y1 - y0, height);
    const held: number[] = [];
    if (hasRoads) {
        roads.addRect(x0, y0, x1, y1, held);
        for (const street of kept) {
            const narrow = wall ? getGateHalfWidth(roads, wall.kit) : def.streetHalf;
            roads.addStreet(street.points, def.streetHalf, height, held, narrow);
        }
    } else {
        ground.claims.take(x0, y0, x1 - x0, y1 - y0, RESERVE_STREET);
        for (const { points } of kept) {
            const across = Math.ceil(def.streetHalf);
            for (const { x, y } of points) {
                ground.claims.take(x - across, y - across, across * 2, across * 2, RESERVE_STREET);
            }
        }
    }

    const sideStreets: Street[] = [];
    if (hasRoads && kind !== "hamlet") {
        // Ribs off the long way through the town, as West Varrock's run off its main road. From
        // both ways they'd cut each other into blocks with room for one building each.
        const eastWest = kept.filter(({ wayX }) => wayX !== 0);
        const northSouth = kept.filter(({ wayY }) => wayY !== 0);
        const span = (list: Street[]) => list.reduce((sum, { length }) => sum + length, 0);
        for (const street of span(eastWest) > span(northSouth) ? eastWest : northSouth) {
            sideStreets.push(
                ...planSideStreets(build, roads, water, street, def, height, held, roll),
            );
        }
    }

    // What's in the middle
    const placeAt = (id: number, x: number, y: number, rotation = 0) =>
        ground.place({ id, type: LOC_NORMAL, rotation, level: 0, x, y }, 2, 2);
    placeAt(wall ? FOUNTAIN : WELL, cx - 1, cy - 1);
    if (kind === "market") {
        placeAt(STALLS[0], cx - 7, cy - 1);
        placeAt(STALLS[1], cx + 5, cy - 1, 2);
        placeAt(STALLS[2], cx - 1, cy - 6, 1);
        placeAt(STALLS[3], cx - 1, cy + 4, 3);
    }
    const site = wall ?? getStreetBounds(square, kept);
    levelSite(build, toRough, site, height);
    const reach = Math.max(...kept.map((street) => street.length), 0) + (x1 - x0) / 2;
    const plan: PlannedTown = {
        kind,
        town,
        x0,
        y0,
        x1,
        y1,
        height,
        reach,
        streets: kept,
        sideStreets,
        held,
        parts,
        wall,
    };
    (build.towns ??= []).push(plan);
    return plan;
}

// What a town without a wall covers: its square and its streets, and a row of buildings each side
function getStreetBounds(square: TileRect, streets: Street[]): TileRect {
    const ends = streets.map(({ end }) => end);
    const rows = SHORTEST_STREET;
    return {
        x0: Math.min(square.x0, ...ends.map(({ x }) => x)) - rows,
        y0: Math.min(square.y0, ...ends.map(({ y }) => y)) - rows,
        x1: Math.max(square.x1, ...ends.map(({ x }) => x)) + rows,
        y1: Math.max(square.y1, ...ends.map(({ y }) => y)) + rows,
    };
}

// How wide the road through a gate is
function getGateHalfWidth(roads: RoadNetwork, kit: CityWallKit): number {
    return Math.min(roads.halfWidth + 0.5, kit.gateSize / 2 - 1);
}

// Joins a town to the outside: a road out of each gate, straight out past what's kept clear of it
// and on to the nearest road, or from the end of a street if it has no wall. Its streets are open
// to other roads after that, and not before, so that everything ends up joined to everything else.
export function connectTown(build: Build, roads: RoadNetwork, plan: PlannedTown): void {
    const { settings, ground, spawn } = build;
    const { wall, streets, height, held } = plan;
    if (settings.roads <= 0) {
        return;
    }
    if (wall) {
        const { kit, gates } = wall;
        for (const gate of gates) {
            const line = getGateLine(kit, wall, gate);
            const lead: Point[] = [];
            const out = GATE_CLEAR_OUT + GATE_STRAIGHT;
            for (let across = kit.width + STREET_PAST_WALL + 1; across >= -out; across--) {
                lead.push(line(across));
            }
            const end = lead[lead.length - 1];
            const from = { x: Math.floor(end.x), y: Math.floor(end.y) };
            const route = ground.inside(from.x, from.y) ? roads.findRoute(from, lead) : [];
            roads.lay(from, lead, route, getGateHalfWidth(roads, kit), height);
        }
    } else {
        // The way in, from the end of the street nearest the rest of the roads. It starts past the
        // street's end, since its own tiles aren't open to it.
        const near = [...streets].sort(
            (a, b) =>
                Math.hypot(a.end.x - spawn.x, a.end.y - spawn.y) -
                Math.hypot(b.end.x - spawn.x, b.end.y - spawn.y),
        );
        for (const { points, end, wayX, wayY, halfWidth } of near) {
            const past = Math.ceil(halfWidth) + STREET_SHORT;
            const onward = Array.from({ length: past }, (_, step) => ({
                x: end.x + wayX * (step + 1),
                y: end.y + wayY * (step + 1),
            }));
            const lead = [...points.slice(-3), ...onward];
            const last = lead[lead.length - 1];
            const from = { x: Math.floor(last.x), y: Math.floor(last.y) };
            const route = ground.inside(from.x, from.y) ? roads.findRoute(from, lead) : [];
            if (route.length > 0) {
                roads.lay(from, lead, route, roads.halfWidth, height);
                break;
            }
        }
    }
    roads.openTiles(held);
}

// Whether a plot can be had: all its tiles free, inside any wall, and not hard up against another
function isPlotFree(build: Build, plot: TileRect, wall?: WalledTown): boolean {
    const { claims } = build.ground;
    const sizeX = plot.x1 - plot.x0 + 1;
    const sizeY = plot.y1 - plot.y0 + 1;
    return (
        (!wall || isInsideWall(wall, plot)) &&
        claims.isFree(plot.x0, plot.y0, sizeX, sizeY) &&
        !claims.hasNear(plot.x0, plot.y0, sizeX, sizeY, PLOT_GAP, RESERVE_PLOT)
    );
}

// Whether a building's rectangle can stand beside a street, with its plot, whose tiles all have to
// be free. Nothing's said for its neighbours' walls but that they're a gap off.
function fitsPlot(
    build: Build,
    water: Uint8Array,
    plot: TileRect,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
    height: number,
    wall?: WalledTown,
    closer = 0,
): boolean {
    const { settings, ground, cliffs, mainland, terrain, spawn, toEdge } = build;
    const inset = settings.boundary === "sea" ? 3 : settings.boundaryDepth + 3;
    if (Math.min(toEdge(x, y), toEdge(x + sizeX, y + sizeY)) < inset) {
        return false;
    }
    if (!isPlotFree(build, plot, wall)) {
        return false;
    }
    const gap = LEAST_GAP - PLOT_MARGIN - closer;
    if (ground.claims.hasNear(x, y, sizeX, sizeY, gap, RESERVE_PLOT)) {
        return false;
    }
    const clear = WALL_CLEAR - closer;
    for (let ty = y - clear; ty < y + sizeY + clear; ty++) {
        for (let tx = x - clear; tx < x + sizeX + clear; tx++) {
            if (!ground.inside(tx, ty)) {
                return false;
            }
            const i = ground.tile(tx, ty);
            if (
                ground.footprint[i] ||
                water[i] ||
                cliffs[i] ||
                !mainland[i] ||
                Math.hypot(tx - spawn.x, ty - spawn.y) <= SPAWN_CLEAR
            ) {
                return false;
            }
        }
    }
    const { min, max } = terrain.getRange(x - 1, y - 1, sizeX + 2, sizeY + 2);
    if (Math.max(max - height, height - min) > MAX_PLOT_RISE) {
        return false;
    }
    for (let ty = y - WATER_CLEAR; ty < y + sizeY + WATER_CLEAR; ty++) {
        for (let tx = x - WATER_CLEAR; tx < x + sizeX + WATER_CLEAR; tx++) {
            if (ground.inside(tx, ty) && water[ground.tile(tx, ty)]) {
                return false;
            }
        }
    }
    return true;
}

// The ground of a fenced yard behind a building, off the wall that faces away from the street, if
// it's to be had as part of its plot
function getBackYard(
    build: Build,
    { x, y, sizeX, sizeY }: Pick<PlacedBuilding, "x" | "y" | "sizeX" | "sizeY">,
    out: Frontage,
    wall?: WalledTown,
): TileRect | undefined {
    const x0 = out.outX > 0 ? x + sizeX : out.outX < 0 ? x - YARD_DEEP : x;
    const y0 = out.outY > 0 ? y + sizeY : out.outY < 0 ? y - YARD_DEEP : y;
    const x1 = (out.outX !== 0 ? x0 + YARD_DEEP : x + sizeX) - 1;
    const y1 = (out.outY !== 0 ? y0 + YARD_DEEP : y + sizeY) - 1;
    const yard = { x0, y0, x1, y1 };
    const { spawn } = build;
    const toSpawn = Math.hypot(
        Math.max(x0 - spawn.x, spawn.x - x1, 0),
        Math.max(y0 - spawn.y, spawn.y - y1, 0),
    );
    return toSpawn > SPAWN_CLEAR && isPlotFree(build, yard, wall) ? yard : undefined;
}

// A yard's fence, open at a gate in its far side. A real farm town has 5 to 8.5 tiles of fence per
// 100 tiles of ground, in yards, pens and fields.
function placeBackYard(
    build: Build,
    { x0, y0, x1, y1 }: TileRect,
    owner: TileRect,
    out: Frontage,
    family: string,
): void {
    const { biomeAt } = build;
    const middleX = (x0 + x1) >> 1;
    const middleY = (y0 + y1) >> 1;
    const id = KIT_FENCES[family] || biomeAt(middleX, middleY).fence;
    const post = (tx: number, ty: number, rotation: number) =>
        putFence(build, id, tx, ty, rotation, owner);
    const gate = (at: number, middle: number) => Math.abs(at - middle) < YARD_GATE;
    for (let tx = x0; tx <= x1; tx++) {
        if (out.outY >= 0 && !(out.outY > 0 && gate(tx, middleX))) {
            post(tx, y1, WALL_NORTH);
        }
        if (out.outY <= 0 && !(out.outY < 0 && gate(tx, middleX))) {
            post(tx, y0, WALL_SOUTH);
        }
    }
    for (let ty = y0; ty <= y1; ty++) {
        if (out.outX >= 0 && !(out.outX > 0 && gate(ty, middleY))) {
            post(x1, ty, WALL_EAST);
        }
        if (out.outX <= 0 && !(out.outX < 0 && gate(ty, middleY))) {
            post(x0, ty, WALL_WEST);
        }
    }
}

// Fills a laid-out town with buildings facing its streets, each on a plot of its own, and returns
// them. A building's left out if it doesn't fit, and a yard if it's the yard that doesn't.
export function fillTown(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    plan: PlannedTown,
): PlacedBuilding[] {
    const { settings, ground, kit } = build;
    const { streets: kept, sideStreets, x0, y0, x1, y1, height, kind, wall, parts } = plan;
    const { names, wanted, town, family } = parts;
    const def = KINDS[kind];
    const roll = createRng(settings.seed + TOWN_FILL_SEED + town);

    // Lines to build along: round the square, then down both sides of each street
    const setBack = Math.ceil(def.streetHalf + WALL_OFF_STREET);
    const streetOut = (outX: number, outY: number) =>
        kept.find((street) => street.wayX === outX && street.wayY === outY);
    const line = (
        x: number,
        y: number,
        stepX: number,
        stepY: number,
        length: number,
        outX: number,
        outY: number,
        onSquare: boolean,
    ): Frontage => ({
        x,
        y,
        stepX,
        stepY,
        length,
        outX,
        outY,
        along: Math.floor(roll() * 3),
        onSquare,
        done: false,
    });
    const sides: Frontage[] = [];
    const squareSide = (
        x: number,
        y: number,
        stepX: number,
        stepY: number,
        length: number,
        outX: number,
        outY: number,
    ) => {
        // Set back from the square, and in two lengths if a street leaves from it, running past
        // the square's corners so that a building's room to face it
        const atX = x + outX * WALL_OFF_SQUARE;
        const atY = y + outY * WALL_OFF_SQUARE;
        const street = streetOut(outX, outY);
        if (street) {
            const at = stepX ? street.points[0].x - x : street.points[0].y - y;
            const over = OVER_CORNER;
            const near = at - setBack;
            const far = at + setBack;
            sides.push(
                line(
                    atX - stepX * over,
                    atY - stepY * over,
                    stepX,
                    stepY,
                    near + over,
                    outX,
                    outY,
                    true,
                ),
                line(
                    atX + stepX * far,
                    atY + stepY * far,
                    stepX,
                    stepY,
                    length - far + over,
                    outX,
                    outY,
                    true,
                ),
            );
        } else {
            sides.push(line(atX, atY, stepX, stepY, length, outX, outY, true));
        }
    };
    squareSide(x0, y1, 1, 0, x1 - x0, 0, 1);
    squareSide(x0, y0, 1, 0, x1 - x0, 0, -1);
    squareSide(x1, y0, 0, 1, y1 - y0, 1, 0);
    squareSide(x0, y0, 0, 1, y1 - y0, -1, 0);
    const front: Frontage[] = [];
    for (const street of [...kept, ...sideStreets]) {
        const { points, length, wayX, wayY, halfWidth } = street;
        const start = points[0];
        const back = Math.ceil(halfWidth + WALL_OFF_STREET);
        for (const side of [-1, 1]) {
            const outX = wayY * side;
            const outY = wayX * side;
            // Lines run east or north, so one that goes out west or south starts at its far end
            const x = start.x + outX * back + (wayX < 0 ? -length : 0);
            const y = start.y + outY * back + (wayY < 0 ? -length : 0);
            front.push(line(x, y, Math.abs(wayX), Math.abs(wayY), length, outX, outY, false));
        }
    }

    // Buildings: the biggest on the square, then outward in turn along each line
    const placed: PlacedBuilding[] = [];
    const biggest = [...names].sort((a, b) => {
        const area = (name: string) => {
            const { sizeX, sizeY } = kit.get(name, 0).prefab;
            return sizeX * sizeY;
        };
        return area(b) - area(a);
    });
    const yards = Math.max(settings.gardens, LEAST_YARDS);
    const houses = names.some((name) => getBuildingKind(name) !== "church");
    let churches = 0;
    const closer = settings.sideStreets > CLOSE_STREETS ? CLOSER_GAP : 0;
    // Takes a plot, and puts a building on it
    const stand = (
        name: string,
        turns: number,
        x: number,
        y: number,
        exit: Exit,
        plotRect: TileRect,
        yard: TileRect | undefined,
        steps: number,
    ) => {
        const { sizeX, sizeY } = kit.get(name, turns).prefab;
        const lotX = plotRect.x1 - plotRect.x0 + 1;
        const lotY = plotRect.y1 - plotRect.y0 + 1;
        ground.claims.take(plotRect.x0, plotRect.y0, lotX, lotY, RESERVE_PLOT);
        kit.stamp(ground, name, turns, x, y, true);
        pinPlot(build, x, y, sizeX, sizeY, height, exit);
        markOffLimits(build, roads, plotRect.x0, plotRect.y0, lotX, lotY, 1);
        roads.addDoorPath(exit, height, steps);
        churches += getBuildingKind(name) === "church" ? 1 : 0;
        placed.push({ name, x, y, sizeX, sizeY, exit, hasRoad: true, town, plot: plotRect, yard });
    };
    const placeNext = (frontage: Frontage) => {
        // Any order but the same every time: a sort by chance would differ between browsers
        const first = Math.floor(roll() * names.length);
        const choices =
            frontage.onSquare && placed.length === 0
                ? biggest
                : names.map((_, i) => names[(first + i) % names.length]);
        for (const name of choices) {
            // A town has one church to every so many buildings, if the kit has anything else
            const church = getBuildingKind(name) === "church";
            if (church && churches * PER_CHURCH > placed.length && houses) {
                continue;
            }
            for (let turns = 0; turns < 4; turns++) {
                const { prefab, exits } = kit.get(name, turns);
                const door = exits.find(
                    (exit) => exit.outX === -frontage.outX && exit.outY === -frontage.outY,
                );
                const wide = frontage.stepX ? prefab.sizeX : prefab.sizeY;
                if (!door || frontage.along + wide > frontage.length) {
                    continue;
                }
                const atX = frontage.x + frontage.stepX * frontage.along;
                const atY = frontage.y + frontage.stepY * frontage.along;
                const x = frontage.outX < 0 ? atX - prefab.sizeX : atX;
                const y = frontage.outY < 0 ? atY - prefab.sizeY : atY;
                const { sizeX, sizeY } = prefab;
                // Neighbours along a street can stand as close as a gap, with no tile each
                const whole = getPlot(x, y, sizeX, sizeY);
                const sides = closer > 0 ? PLOT_MARGIN : 0;
                const walls = {
                    x0: whole.x0 + frontage.stepX * sides,
                    y0: whole.y0 + frontage.stepY * sides,
                    x1: whole.x1 - frontage.stepX * sides,
                    y1: whole.y1 - frontage.stepY * sides,
                };
                if (!fitsPlot(build, water, walls, x, y, sizeX, sizeY, height, wall, closer)) {
                    continue;
                }
                const exit: Exit = { ...door, x: door.x + x, y: door.y + y };
                const wantsYard = !frontage.onSquare && roll() < yards;
                const yard = wantsYard
                    ? getBackYard(build, { x, y, sizeX, sizeY }, frontage, wall)
                    : undefined;
                const plotRect = joinRects(walls, yard);
                stand(name, turns, x, y, exit, plotRect, yard, DOOR_STEPS);
                if (yard) {
                    placeBackYard(build, yard, plotRect, frontage, family);
                }
                const gap = LEAST_GAP + Math.floor(roll() * (MOST_GAP - LEAST_GAP + 1)) - closer;
                frontage.along += wide + gap;
                return;
            }
        }
        frontage.along += LEAST_GAP;
        frontage.done = frontage.along >= frontage.length;
    };
    const all = [...sides, ...front];
    while (placed.length < wanted && all.some((frontage) => !frontage.done)) {
        for (const frontage of all) {
            if (!frontage.done && placed.length < wanted) {
                placeNext(frontage);
            }
        }
    }

    // What's left of a block once the lines have had their turn: anywhere a building fits with its
    // door a few tiles from a street, the nearest the middle first. It's what fills a block.
    const area = wall ? getWallInside(wall.kit, wall) : getStreetBounds(plan, kept);
    const spots: Point[] = [];
    for (let y = area.y0; y <= area.y1 && kind !== "hamlet"; y += BLOCK_STEP) {
        for (let x = area.x0; x <= area.x1; x += BLOCK_STEP) {
            spots.push({ x, y });
        }
    }
    const smallest = [...biggest].reverse();
    const toMiddle = ({ x, y }: Point) => Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2);
    spots.sort((a, b) => toMiddle(a) - toMiddle(b));
    const fillSpot = ({ x, y }: Point) => {
        for (const name of smallest) {
            if (getBuildingKind(name) === "church" && houses) {
                continue;
            }
            for (let turns = 0; turns < 4; turns++) {
                const { prefab, exits } = kit.get(name, turns);
                const { sizeX, sizeY } = prefab;
                // Close up, a building's plot is what it stands on
                const walls = getPlot(
                    x + closer,
                    y + closer,
                    sizeX - closer * 2,
                    sizeY - closer * 2,
                );
                if (!fitsPlot(build, water, walls, x, y, sizeX, sizeY, height, wall, closer)) {
                    continue;
                }
                for (const door of exits) {
                    const exit: Exit = { ...door, x: door.x + x, y: door.y + y };
                    const steps = roads.getStepsToRoad(exit, DOOR_MOST_STEPS);
                    if (steps > 0) {
                        stand(name, turns, x, y, exit, walls, undefined, steps + 1);
                        return;
                    }
                }
            }
        }
    };
    for (const spot of spots) {
        if (placed.length >= wanted) {
            break;
        }
        fillSpot(spot);
    }
    return placed;
}

// A building's plot before any yard: its walls and a tile round them
export function getPlot(x: number, y: number, sizeX: number, sizeY: number): TileRect {
    return {
        x0: x - PLOT_MARGIN,
        y0: y - PLOT_MARGIN,
        x1: x + sizeX - 1 + PLOT_MARGIN,
        y1: y + sizeY - 1 + PLOT_MARGIN,
    };
}

function joinRects(a: TileRect, b?: TileRect): TileRect {
    return b
        ? {
              x0: Math.min(a.x0, b.x0),
              y0: Math.min(a.y0, b.y0),
              x1: Math.max(a.x1, b.x1),
              y1: Math.max(a.y1, b.y1),
          }
        : a;
}

// How far along a paved core a tile is, for paving: inside it or not
export function getTownPaving(build: Build, x: number, y: number): boolean {
    for (const { kind, x0, y0, x1, y1, reach } of build.towns ?? []) {
        const core = reach * CORE_SHARE;
        const middleX = (x0 + x1) / 2;
        const middleY = (y0 + y1) / 2;
        if (KINDS[kind].paved && Math.hypot(x - middleX, y - middleY) <= core) {
            return true;
        }
    }
    return false;
}

// Which of a list of things reach each 32 tile cell of the map, so that what's worked out for
// every tile only looks at those. A big map has hundreds of sites and towns.
function createReachIndex<T>(
    build: Build,
    items: T[],
    getReach: (item: T) => { x: number; y: number; reach: number },
): (x: number, y: number) => T[] {
    const across = (build.sizeX >> REACH_CELL) + 1;
    const down = (build.sizeY >> REACH_CELL) + 1;
    const cells: T[][] = Array.from({ length: across * down }, () => []);
    for (const item of items) {
        const { x, y, reach } = getReach(item);
        const x0 = Math.max(Math.floor(x - reach - 1) >> REACH_CELL, 0);
        const y0 = Math.max(Math.floor(y - reach - 1) >> REACH_CELL, 0);
        const x1 = Math.min(Math.ceil(x + reach + 1) >> REACH_CELL, across - 1);
        const y1 = Math.min(Math.ceil(y + reach + 1) >> REACH_CELL, down - 1);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                cells[cx + cy * across].push(item);
            }
        }
    }
    return (x, y) => cells[(x >> REACH_CELL) + (y >> REACH_CELL) * across];
}

// How much of a tile's trees and scenery a town leaves: none in its middle, all past its fade.
// Trees take over from buildings over about 32 tiles, and the ground stays as busy.
export function createTownFade(build: Build): (x: number, y: number) => number {
    const towns = (build.towns ?? []).map(({ kind, x0, y0, x1, y1, reach }) => ({
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        core: reach * CORE_SHARE,
        tiles: kind === "hamlet" ? HAMLET_FADE_TILES : FADE_TILES,
    }));
    const near = createReachIndex(build, towns, ({ x, y, core, tiles }) => ({
        x,
        y,
        reach: core + tiles,
    }));
    return (x, y) => {
        let fade = 1;
        for (const town of near(x, y)) {
            const distance = Math.hypot(x - town.x, y - town.y);
            fade = Math.min(fade, smoothstep((distance - town.core) / town.tiles));
        }
        return fade;
    };
}

// How much is scattered on a tile, against a map with no sites: more near one, and less on the
// land between. Real screens run from nothing to 130 or more, and a map where they're all
// alike has nowhere to arrive at.
export function createPace(build: Build): (x: number, y: number) => number {
    const { sites } = build;
    if (!sites || sites.length === 0) {
        return () => 1;
    }
    const near = createReachIndex(build, sites, ({ x, y }) => ({
        x,
        y,
        reach: SITE_NEAR + SITE_FADE,
    }));
    return (x, y) => {
        let nearest = Infinity;
        for (const site of near(x, y)) {
            nearest = Math.min(nearest, Math.hypot(x - site.x, y - site.y));
        }
        return lerp(BUSY_PACE, QUIET_PACE, smoothstep((nearest - SITE_NEAR) / SITE_FADE));
    };
}
