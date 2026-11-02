import { Exit } from "./building";
import { TileRect } from "./collision";
import {
    Build,
    LOC_WALL,
    SETTLE_SLOPE,
    SPAWN_CLEAR,
    WALL_EAST,
    WALL_NORTH,
    WALL_SOUTH,
    WALL_WEST,
    hasRelief,
    lerp,
    pick,
    refreshTileHeights,
} from "./mapBuild";
import { createRng, distanceTo } from "./noise";
import { Point } from "./paths";
import { BuildingKind, PREFABS, getBuildingKind, isBuildingKind } from "./prefabs";
import { RESERVE_PIECE, RESERVE_PLOT } from "./reservations";
import { ROAD_STEEPEST, RoadNetwork } from "./roads";
import { CLOSE_STREETS, LEVEL_FADE, PlannedTown, fillTown, getPlot, layOutTown } from "./townPlan";
import { WalledTown, getWallInside, isInsideWall } from "./townWalls";

// Where buildings go, and the ground they stand on.

// The most the ground can rise over a building's plot for it to go there
const MAX_PLOT_RISE = 18;

// Tiles round a building's walls that are flat with it
const PLOT_MARGIN = 1;

// Tiles out of a door that are level with it
const DOOR_STEP = 3;

// A door step gives way to another building's plot
const DOOR_STEP_PIN = 0.005;

// Tiles between a building and anything else, and between it and water
const BUILDING_CLEAR = 3;

const WATER_CLEAR = 6;

// Spots tried for a town, and how it's judged: points round it, and how far they can be
// off its height
const TOWN_TRIES = 12;

const TOWN_SAMPLES = 8;

const TOWN_RISE = 24;

// What a city's quarters are given over to, going round it
const DISTRICTS: BuildingKind[] = ["house", "shop", "church"];

// A fenced yard stands this far off a building's walls, with a gap at its door that takes a road
const YARD_GAP = 2;

const YARD_DOOR_GAP = 2.5;

// A town needs this many buildings to have a wall
const MIN_WALLED_BUILDINGS = 2;

// A real town's walls come from one kit, and its fences with them: 5 to 12 ids do 90% of a new
// town. So a town keeps to one family of prefabs, by the start of their names, and gives up
// after this many spots that wouldn't take one
const KIT_PATIENCE = 30;

const TOWN_KIT_SEED = 400;

const SITE_SEED = 420;

// Places to a map square, with the setting at 1, tiles between them and in from the edge, and
// buildings to a hamlet
const SITES_A_SQUARE = 1.2;

const SITE_SPACING = 50;

const SITE_INSET = 16;

const SITE_TRIES = 40;

const SITE_BUILDINGS = 3;

// Buildings a family has for a town in blocks, past what its biome lists: towns get them, and
// nothing else does. West Varrock's, cut for this: see the guide.
const BLOCK_FAMILIES: Record<string, string[]> = {
    varrock: [
        "varrock_cottage",
        "varrock_house",
        "varrock_terrace",
        "varrock_store",
        "varrock_corner",
    ],
};

// Where a family has a fence of its own. Anywhere else it's the biome's.
export const KIT_FENCES: Record<string, number> = {
    lumbridge: 980,
    varrock: 23849,
    hosidius: 7456,
    shayzien: 42113,
    lovakengj: 23753,
};

// A building: its way out, if it has one, and whether a road ends there
export type PlacedBuilding = {
    name: string;
    x: number;
    y: number;
    sizeX: number;
    sizeY: number;
    exit?: Exit;
    hasRoad: boolean;
    // Which town it's in, if it's in one
    town?: number;
    // Its plot, as tiles, its yard and fence and a tile round its walls: nothing else goes on
    // that but its own way out. Only the generator's buildings have one.
    plot?: TileRect;
    yard?: TileRect;
};

// A length of fence, on a side of a tile, and the plot or piece it belongs to
export type PlacedFence = { x: number; y: number; rotation: number; owner: TileRect };

// Where towns are and what's been laid out of them, for the steps that come later
export type TownPlans = {
    middles: Point[];
    kits: TownKit[];
    // By which town it is: towns inside another's wall are that one
    byTown: (PlannedTown | undefined)[];
    plans: PlannedTown[];
    wanted: number;
};

type Candidate = {
    name: string;
    centreX: number;
    centreY: number;
    town?: number;
    // The wall its town has, if it has one, which it has to be inside
    wall?: WalledTown;
};

// A town's family of prefabs, and how many spots it's missed
type TownKit = { family?: string; misses: number };

export function kitOf(name: string): string {
    return name.split("_")[0];
}

// The buildings that can go somewhere, by the settings
function getBuildingNames(build: Build, x: number, y: number): string[] {
    const { settings, biomeAt } = build;
    const names = settings.anyBuildings ? Object.keys(PREFABS) : biomeAt(x, y).buildings;
    return names.filter((name) => isBuildingKind(name, settings));
}

// Middles for towns: somewhere with ground to build on, if there's anywhere
function getTownCentres(build: Build): Point[] {
    const { settings, arena, rng, cliffs, mainland, ground, terrain } = build;
    const centres: Point[] = [];
    const inset = Math.min(20, (arena.x1 - arena.x0) >> 2);
    const score = (x: number, y: number) => {
        // How much of a ring round it you could build on
        let good = 0;
        const reach = settings.townSize * 0.6;
        const middle = terrain.getHeight(x, y);
        for (let a = 0; a < TOWN_SAMPLES; a++) {
            const angle = (a / TOWN_SAMPLES) * Math.PI * 2;
            const sx = Math.floor(x + Math.cos(angle) * reach);
            const sy = Math.floor(y + Math.sin(angle) * reach);
            const i = ground.tile(sx, sy);
            const level = Math.abs(terrain.getHeight(sx, sy) - middle) < TOWN_RISE;
            good += ground.inside(sx, sy) && !cliffs[i] && mainland[i] && level ? 1 : 0;
        }
        return good;
    };
    for (let i = 0; i < settings.towns; i++) {
        let best: Point | undefined;
        let bestScore = -1;
        for (let attempt = 0; attempt < TOWN_TRIES; attempt++) {
            const spot = {
                x: lerp(arena.x0 + inset, arena.x1 - inset, rng()),
                y: lerp(arena.y0 + inset, arena.y1 - inset, rng()),
            };
            const spotScore = score(spot.x, spot.y);
            if (spotScore > bestScore) {
                best = spot;
                bestScore = spotScore;
            }
            if (!hasRelief(settings)) {
                break;
            }
        }
        centres.push(best!);
    }
    return centres;
}

// The buildings of a town's own family, which it picks the first time it's asked
function keepToKit(build: Build, kit: TownKit, town: number, names: string[]): string[] {
    if (kit.misses >= KIT_PATIENCE || names.length === 0) {
        return names;
    }
    if (kit.family === undefined) {
        const roll = createRng(build.settings.seed + TOWN_KIT_SEED + town);
        const rolled = kitOf(names[Math.floor(roll() * names.length)]);
        // A town built in blocks wants a family that's got the buildings for it
        const blocks = names.map(kitOf).find((family) => BLOCK_FAMILIES[family]);
        kit.family = build.settings.sideStreets > CLOSE_STREETS && blocks ? blocks : rolled;
    }
    const own = names.filter((name) => kitOf(name) === kit.family);
    const more = (BLOCK_FAMILIES[kit.family] ?? []).filter((name) =>
        isBuildingKind(name, build.settings),
    );
    return own.length > 0 ? [...own, ...more] : names;
}

function pickSpot(build: Build, plans: TownPlans): Candidate | undefined {
    const { settings, arena, rng } = build;
    const { middles: towns, kits, byTown } = plans;
    let x: number;
    let y: number;
    let town: number | undefined;
    let wall: WalledTown | undefined;
    if (towns.length > 0) {
        town = Math.floor(rng() * towns.length);
        const angle = rng() * Math.PI * 2;
        const distance = Math.sqrt(rng()) * settings.townSize;
        x = towns[town].x + Math.cos(angle) * distance;
        y = towns[town].y + Math.sin(angle) * distance;
        wall = byTown[town]?.wall;
        if (wall) {
            // All the city, not just what's near its middle
            const inside = getWallInside(wall.kit, wall);
            x = lerp(inside.x0, inside.x1, rng());
            y = lerp(inside.y0, inside.y1, rng());
        }
    } else {
        x = lerp(arena.x0, arena.x1, rng());
        y = lerp(arena.y0, arena.y1, rng());
    }
    let names = getBuildingNames(build, Math.floor(x), Math.floor(y));
    if (town !== undefined) {
        names = keepToKit(build, kits[town], town, names);
    }
    // A town with walls is a city, in districts, each a wedge of it
    if (town !== undefined && settings.townWalls > 0) {
        const angle = Math.atan2(y - towns[town].y, x - towns[town].x) / (Math.PI * 2) + 0.5;
        const kind = DISTRICTS[Math.floor((angle + town * 0.37) * DISTRICTS.length) % 3];
        const inDistrict = names.filter((name) => getBuildingKind(name) === kind);
        names = inDistrict.length > 0 ? inDistrict : names;
    }
    return names.length > 0
        ? { name: pick(rng, names), centreX: x, centreY: y, town, wall }
        : undefined;
}

// Whether a rectangle has room for a building, with space round it
export function fitsBuilding(
    build: Build,
    water: Uint8Array,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
): boolean {
    const { settings, ground, spawn, toEdge, terrain, cliffs, mainland, plots } = build;
    const inset = settings.boundary === "sea" ? 3 : settings.boundaryDepth + 3;
    if (Math.min(toEdge(x, y), toEdge(x + sizeX, y + sizeY)) < inset) {
        return false;
    }
    for (let ty = y - BUILDING_CLEAR; ty < y + sizeY + BUILDING_CLEAR; ty++) {
        for (let tx = x - BUILDING_CLEAR; tx < x + sizeX + BUILDING_CLEAR; tx++) {
            const i = ground.tile(tx, ty);
            if (
                !ground.inside(tx, ty) ||
                water[i] ||
                cliffs[i] ||
                !mainland[i] ||
                ground.reserved[i] ||
                Math.hypot(tx - spawn.x, ty - spawn.y) <= SPAWN_CLEAR
            ) {
                return false;
            }
        }
    }
    // Round buildings have corners of their plot that nothing's standing on
    const gap = BUILDING_CLEAR + PLOT_MARGIN * 2;
    for (const plot of plots) {
        if (
            x < plot.x + plot.sizeX + gap &&
            plot.x < x + sizeX + gap &&
            y < plot.y + plot.sizeY + gap &&
            plot.y < y + sizeY + gap
        ) {
            return false;
        }
    }
    const { min, max } = terrain.getRange(
        x - PLOT_MARGIN,
        y - PLOT_MARGIN,
        sizeX + PLOT_MARGIN * 2,
        sizeY + PLOT_MARGIN * 2,
    );
    if (max - min > MAX_PLOT_RISE) {
        return false;
    }
    // The ground has to get from the plot down to any water, at a walkable slope. Water
    // doesn't move for it.
    const reach = WATER_CLEAR;
    for (let ty = y - reach; ty < y + sizeY + reach; ty++) {
        for (let tx = x - reach; tx < x + sizeX + reach; tx++) {
            if (ground.inside(tx, ty) && water[ground.tile(tx, ty)]) {
                return false;
            }
        }
    }
    return true;
}

// How high a building's plot goes: the middle of its ground, as near what it's joining as
// that ground will let it, and within walking distance of any plot beside it. Undefined
// if that's not near its own ground.
export function getPlotHeight(
    build: Build,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
    joining?: number,
): number | undefined {
    const { terrain, plots, settings } = build;
    const margin = PLOT_MARGIN;
    const { min, max } = terrain.getRange(
        x - margin,
        y - margin,
        sizeX + margin * 2,
        sizeY + margin * 2,
    );
    const middle = (min + max) / 2;
    let height = joining === undefined ? middle : Math.min(Math.max(joining, min), max);
    const slope = settings.walkSlope * SETTLE_SLOPE;
    for (const plot of plots) {
        const gapX = Math.max(plot.x - (x + sizeX), x - (plot.x + plot.sizeX), 0);
        const gapY = Math.max(plot.y - (y + sizeY), y - (plot.y + plot.sizeY), 0);
        const gap = Math.max(Math.hypot(gapX, gapY) - margin * 2, 1) * slope;
        height = Math.min(Math.max(height, plot.height - gap), plot.height + gap);
    }
    return height < min - MAX_PLOT_RISE || height > max + MAX_PLOT_RISE
        ? undefined
        : Math.round(height);
}

// Makes a building's plot flat at a height, and the ground out of its door
export function pinPlot(
    build: Build,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
    height: number,
    exit?: Exit,
): void {
    const { terrain, plots } = build;
    const margin = PLOT_MARGIN;
    terrain.pinRect(x - margin, y - margin, sizeX + margin * 2, sizeY + margin * 2, height);
    plots.push({ x, y, sizeX, sizeY, height });
    if (exit) {
        for (let out = 1; out <= DOOR_STEP; out++) {
            const stepX = Math.round(exit.x + exit.outX * out);
            const stepY = Math.round(exit.y + exit.outY * out);
            terrain.pinRect(stepX - 1, stepY - 1, 2, 2, height, DOOR_STEP_PIN);
        }
    }
}

// A length of fence, on record so that check-maps.ts can hold it to the rules
export function putFence(
    build: Build,
    id: number,
    x: number,
    y: number,
    rotation: number,
    owner: TileRect,
): void {
    build.ground.grid.locs.push({ id, type: LOC_WALL, rotation, level: 0, x, y });
    (build.fences ??= []).push({ x, y, rotation, owner });
}

// A fence round a building a little way off, with a gap at its door, on a plot that's its own
function placeYard(
    build: Build,
    roads: RoadNetwork,
    plot: PlacedBuilding,
    yard: TileRect,
    family?: string,
): void {
    const { biomeAt } = build;
    const { exit } = plot;
    const { x0, y0, x1, y1 } = yard;
    const gap = Math.max(YARD_DOOR_GAP, roads.halfWidth + 0.5);
    const post = (x: number, y: number, rotation: number) => {
        // The gap at the door, on the fence's own line
        const inGap =
            exit !== undefined &&
            ((exit.outX !== 0 &&
                Math.abs(y + 0.5 - exit.y) < gap &&
                (exit.outX > 0 ? x === x1 : x === x0) &&
                (rotation === WALL_EAST || rotation === WALL_WEST)) ||
                (exit.outY !== 0 &&
                    Math.abs(x + 0.5 - exit.x) < gap &&
                    (exit.outY > 0 ? y === y1 : y === y0) &&
                    (rotation === WALL_NORTH || rotation === WALL_SOUTH)));
        if (!inGap) {
            const id = (family && KIT_FENCES[family]) || biomeAt(x, y).fence;
            putFence(build, id, x, y, rotation, yard);
        }
    };
    for (let x = x0; x <= x1; x++) {
        post(x, y0, WALL_SOUTH);
        post(x, y1, WALL_NORTH);
    }
    for (let y = y0; y <= y1; y++) {
        post(x0, y, WALL_WEST);
        post(x1, y, WALL_EAST);
    }
}

// A building in a rotation at a spot, if it fits, with its way out that best faces the
// nearest road, and how squarely it does
type Placing = { turns: number; x: number; y: number; exit: Exit; facing: number };

function getPlacings(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    spot: Candidate,
): Placing[] {
    const { kit, rng } = build;
    const placings: Placing[] = [];
    for (let turns = 0; turns < 4; turns++) {
        const { prefab, exits } = kit.get(spot.name, turns);
        const x = Math.round(spot.centreX - prefab.sizeX / 2);
        const y = Math.round(spot.centreY - prefab.sizeY / 2);
        if (!fitsBuilding(build, water, x, y, prefab.sizeX, prefab.sizeY)) {
            continue;
        }
        const { wall } = spot;
        const lot = { x0: x, y0: y, x1: x + prefab.sizeX - 1, y1: y + prefab.sizeY - 1 };
        if (wall && !isInsideWall(wall, lot)) {
            continue;
        }
        for (const local of exits) {
            const exit = { ...local, x: local.x + x, y: local.y + y };
            const road = roads.getNearest(exit.x, exit.y);
            const length = Math.hypot(road.x - exit.x, road.y - exit.y) || 1;
            const facing = (exit.outX * (road.x - exit.x) + exit.outY * (road.y - exit.y)) / length;
            // Nothing that turns its back on the road
            if (facing > 0) {
                placings.push({ turns, x, y, exit, facing: facing + rng() * 0.01 });
            }
        }
    }
    return placings.sort((a, b) => b.facing - a.facing);
}

export function markOffLimits(
    build: Build,
    roads: RoadNetwork,
    x: number,
    y: number,
    sizeX: number,
    sizeY: number,
    change: 1 | -1,
): void {
    const { ground } = build;
    const gap = roads.wallGap;
    for (let ty = y - gap; ty < y + sizeY + gap; ty++) {
        for (let tx = x - gap; tx < x + sizeX + gap; tx++) {
            if (ground.inside(tx, ty)) {
                roads.offLimits[ground.tile(tx, ty)] += change;
            }
        }
    }
}

// A building's plot with a yard round it, as far out as its fence
function getYard(x: number, y: number, sizeX: number, sizeY: number): TileRect {
    return {
        x0: x - YARD_GAP,
        y0: y - YARD_GAP,
        x1: x + sizeX + YARD_GAP - 1,
        y1: y + sizeY + YARD_GAP - 1,
    };
}

// Places a building at a spot if one fits, turned so that a way out faces the nearest
// road. One that wants a road only goes where its road can join the others, ending at
// that door. One on its own faces the nearest road anyway, or the spawn if there are none.
function placeBuilding(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    spot: Candidate,
    wantsRoad: boolean,
): PlacedBuilding | undefined {
    const { settings, ground, kit, rng } = build;
    const { name } = spot;
    for (const { turns, x, y, exit } of getPlacings(build, roads, water, spot)) {
        const { prefab } = kit.get(name, turns);
        // A yard's part of its plot, and roads keep off where it'll be, whether or not it gets one
        const room = getYard(x, y, prefab.sizeX, prefab.sizeY);
        const roomX = room.x1 - room.x0 + 1;
        const roomY = room.y1 - room.y0 + 1;
        const plot: PlacedBuilding = {
            name,
            x,
            y,
            sizeX: prefab.sizeX,
            sizeY: prefab.sizeY,
            exit,
            hasRoad: wantsRoad,
            town: spot.town,
        };
        // Straight out of the door, so that's how the road arrives
        const lead: Point[] = [];
        for (let step = 0; step <= roads.doorLead; step++) {
            lead.push({ x: exit.x + exit.outX * step, y: exit.y + exit.outY * step });
        }
        if (wantsRoad && !roads.isLeadClear(lead)) {
            continue;
        }
        const end = lead[lead.length - 1];
        const from = { x: Math.floor(end.x), y: Math.floor(end.y) };
        markOffLimits(build, roads, room.x0, room.y0, roomX, roomY, 1);
        const route = wantsRoad && ground.inside(from.x, from.y) ? roads.findRoute(from, lead) : [];
        if (wantsRoad && route.length === 0) {
            markOffLimits(build, roads, room.x0, room.y0, roomX, roomY, -1);
            continue;
        }
        // Its road has to be able to get from its door to where it joins
        const joining = route.length > 0 ? build.tileHeights[route[0]] : undefined;
        const height = getPlotHeight(build, x, y, prefab.sizeX, prefab.sizeY, joining);
        const steepest = settings.walkSlope * ROAD_STEEPEST * route.length;
        const tooFar = joining !== undefined && Math.abs(joining - (height ?? 0)) > steepest;
        if (height === undefined || tooFar) {
            markOffLimits(build, roads, room.x0, room.y0, roomX, roomY, -1);
            continue;
        }
        kit.stamp(ground, name, turns, x, y, true);
        pinPlot(build, x, y, prefab.sizeX, prefab.sizeY, height, exit);
        plot.yard = rng() < settings.gardens ? room : undefined;
        plot.plot = plot.yard ?? getPlot(x, y, prefab.sizeX, prefab.sizeY);
        const { x0, y0, x1, y1 } = plot.plot;
        ground.claims.take(x0, y0, x1 - x0 + 1, y1 - y0 + 1, RESERVE_PLOT);
        if (plot.yard) {
            const family = spot.town === undefined ? undefined : kitOf(name);
            placeYard(build, roads, plot, plot.yard, family);
        }
        if (wantsRoad) {
            roads.lay(from, lead, route, roads.halfWidth, height);
        }
        return plot;
    }
    return undefined;
}

// Places about 50 tiles apart, on ground that can take them, away from the spawn: where a map's
// hamlets and landmarks go, with quieter land between. Real settlements are 49 to 56 apart.
function getSites(build: Build, water: Uint8Array, taken: Point[]): Point[] {
    const { settings, arena, spawn, ground, cliffs, mainland, toEdge } = build;
    const roll = createRng(settings.seed + SITE_SEED);
    const wanted = Math.round(
        settings.sites * settings.squaresX * settings.squaresY * SITES_A_SQUARE,
    );
    const sites: Point[] = [];
    for (let attempt = 0; attempt < wanted * SITE_TRIES && sites.length < wanted; attempt++) {
        const x = Math.floor(lerp(arena.x0, arena.x1, roll()));
        const y = Math.floor(lerp(arena.y0, arena.y1, roll()));
        const i = ground.tile(x, y);
        const spaced = [...taken, ...sites].every(
            (other) => Math.hypot(other.x - x, other.y - y) >= SITE_SPACING,
        );
        if (
            spaced &&
            toEdge(x, y) >= SITE_INSET &&
            Math.hypot(x - spawn.x, y - spawn.y) >= SITE_SPACING / 2 &&
            !water[i] &&
            !cliffs[i] &&
            mainland[i]
        ) {
            sites.push({ x, y });
        }
    }
    return sites;
}

// The first steps of a place, for every town and hamlet on the map: where it is, its wall and
// gates, and its square and main streets. Nothing else has been laid but bridges. A town that
// lands inside a wall that's already up is part of that city.
export function planTowns(build: Build, roads: RoadNetwork, water: Uint8Array): TownPlans {
    const { settings, rng } = build;
    const wanted = Math.round(settings.buildings * settings.squaresX * settings.squaresY * 3);
    const named = getTownCentres(build);
    build.sites = settings.sites > 0 ? getSites(build, water, named) : [];
    // With no towns asked for, what there is to build gathers in hamlets at the first sites
    const hamlets =
        named.length > 0 || settings.roads <= 0 ? 0 : Math.ceil(wanted / SITE_BUILDINGS);
    const middles = [...named, ...build.sites.slice(0, hamlets)];
    const kits = middles.map((): TownKit => ({ misses: 0 }));
    const plans: PlannedTown[] = [];
    const byTown = middles.map((): PlannedTown | undefined => undefined);
    if (wanted === 0) {
        return { middles, kits, byTown, plans, wanted };
    }
    const rough = new Uint8Array(water.length);
    rough.forEach((_, i) => {
        rough[i] = water[i] | build.cliffs[i];
    });
    const toRough = distanceTo(rough, build.sizeX, build.sizeY, LEVEL_FADE);
    const share = Math.ceil(wanted / middles.length);
    middles.forEach((middle, town) => {
        const city = plans.find(
            ({ wall }) =>
                wall &&
                middle.x >= wall.x0 &&
                middle.x <= wall.x1 &&
                middle.y >= wall.y0 &&
                middle.y <= wall.y1,
        );
        if (city) {
            city.parts.wanted += share;
            byTown[town] = city;
            kits[town] = kits[city.town];
            return;
        }
        const all = getBuildingNames(build, Math.floor(middle.x), Math.floor(middle.y));
        const names = keepToKit(build, kits[town], town, all);
        const wantsWall =
            town < named.length &&
            settings.townWalls > 0 &&
            rng() < settings.townWalls &&
            share >= MIN_WALLED_BUILDINGS;
        if (names.length > 0) {
            const parts = {
                names,
                wanted: share,
                town,
                family: kits[town].family ?? kitOf(names[0]),
            };
            const plan = layOutTown(build, roads, water, middle, parts, wantsWall, toRough);
            if (plan) {
                plans.push(plan);
                byTown[town] = plan;
            }
        }
    });
    refreshTileHeights(build);
    return { middles, kits, byTown, plans, wanted };
}

// Buildings, once their towns' streets and the roads between are down: on the streets first, and
// what doesn't fit there, and towns with no roads to have streets, on the loose ground round them
// with lanes of their own
export function placeBuildings(
    build: Build,
    roads: RoadNetwork,
    water: Uint8Array,
    plans: TownPlans,
): PlacedBuilding[] {
    const { settings } = build;
    const { wanted, kits } = plans;
    const plots: PlacedBuilding[] = [];
    for (const plan of settings.roads > 0 ? plans.plans : []) {
        plots.push(...fillTown(build, roads, water, plan));
    }
    // Those with roads first, so that the rest can face all the roads there'll be
    const roadCount = Math.round(wanted * settings.roads);
    for (const [count, wantsRoad] of [
        [roadCount, true],
        [wanted, false],
    ] as const) {
        for (let attempt = 0; attempt < wanted * 40 && plots.length < count; attempt++) {
            const spot = pickSpot(build, plans);
            const plot = spot && placeBuilding(build, roads, water, spot, wantsRoad);
            if (plot) {
                plots.push(plot);
            } else if (spot?.town !== undefined) {
                kits[spot.town].misses++;
            }
        }
    }
    return plots;
}

// Ruined buildings: some of their walls, none of their furniture, and no road
export function placeRuins(build: Build, roads: RoadNetwork, water: Uint8Array): void {
    const { settings, ground, kit, rng, biomeAt } = build;
    const wanted = Math.round(settings.ruins * settings.squaresX * settings.squaresY * 2);
    let placed = 0;
    for (let attempt = 0; attempt < wanted * 30 && placed < wanted; attempt++) {
        const x0 = lerp(build.arena.x0, build.arena.x1, rng());
        const y0 = lerp(build.arena.y0, build.arena.y1, rng());
        const biome = biomeAt(Math.floor(x0), Math.floor(y0));
        const names = settings.anyBuildings
            ? Object.keys(PREFABS)
            : (biome.ruins ?? biome.buildings);
        const name = pick(rng, names);
        const turns = Math.floor(rng() * 4);
        const { prefab } = kit.get(name, turns);
        const x = Math.round(x0);
        const y = Math.round(y0);
        if (fitsBuilding(build, water, x, y, prefab.sizeX, prefab.sizeY)) {
            const height = getPlotHeight(build, x, y, prefab.sizeX, prefab.sizeY);
            if (height === undefined) {
                continue;
            }
            ground.claims.take(x, y, prefab.sizeX, prefab.sizeY, RESERVE_PIECE);
            kit.stampRuin(ground, name, turns, x, y, rng, true);
            pinPlot(build, x, y, prefab.sizeX, prefab.sizeY, height);
            markOffLimits(build, roads, x, y, prefab.sizeX, prefab.sizeY, 1);
            placed++;
        }
    }
}
