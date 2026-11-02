import { forWallTiles } from "./cityWalls";
import { TileRect } from "./collision";
import { PlacedLoc, TILE_BLOCKED } from "./format";
import type { GeneratedMap } from "./generator";
import { OVERLAY_SHAPES } from "./shapes";
import { getGateClear } from "./townWalls";

// Whether a map has kept to the flow: what's on a wall's band or in a gate's clear space, roads on
// buildings and yards, fences across roads and other buildings' plots. A road's checked by what's
// really painted, half side by half side, not by which tile its middle's on. check-maps.ts fails
// on any of these, and the tests hold a generated city to them.

export type Clash = {
    rule: "wall" | "gate" | "road" | "fence" | "plot";
    x: number;
    y: number;
    what: string;
};

type LocSizes = (id: number) => { sizeX: number; sizeY: number };

// Type 22 is ground decoration, which never stands in anything's way
const LOC_DECORATION = 22;

// What's covered of a tile, as half sides, by its overlay's shape and rotation
const SHAPE_SIDES = new Map<number, number>();
for (const [sides, [shape, rotation]] of OVERLAY_SHAPES) {
    SHAPE_SIDES.set(shape * 4 + rotation, sides);
}

// How far either side of a door a road counts as its own, and how far back: a wide road's round end
// reaches past the door, round the corner of a building that has its corners cut
const DOOR_STRIP_SIDE = 4;

const DOOR_STRIP_BEHIND = 3;

// Tiles from a door a road can run up against its building
const DOOR_REACH = 4.5;

function inRect({ x0, y0, x1, y1 }: TileRect, x: number, y: number): boolean {
    return x >= x0 && y >= y0 && x <= x1 && y <= y1;
}

// A road's half sides on a tile, or none
function getRoadSides(map: GeneratedMap, i: number): number {
    const { shapes, rotations } = map.grid.levels[0];
    return map.roadTiles[i] ? (SHAPE_SIDES.get(shapes[i] * 4 + rotations[i]) ?? 255) : 0;
}

// Tiles that anything but its own wall has no business on
function findBandClashes(map: GeneratedMap, locs: LocSizes): Clash[] {
    const { grid, footprint, walled } = map;
    const { sizeX, sizeY } = grid;
    const clashes: Clash[] = [];
    if (!walled || walled.length === 0) {
        return clashes;
    }
    const band = new Uint8Array(sizeX * sizeY);
    const clear = new Uint8Array(sizeX * sizeY);
    const own = new Set<PlacedLoc>();
    for (const town of walled) {
        const { kit, gates } = town;
        // What it found it couldn't stand on is no part of it: water, cliffs, bridges
        forWallTiles(kit, town, (x, y) => {
            band[x + y * sizeX] = town.taken.has(x + y * sizeX) ? 0 : 1;
        });
        for (const gate of gates) {
            for (const rect of getGateClear(kit, town, gate)) {
                for (let y = rect.y0; y <= rect.y1; y++) {
                    for (let x = rect.x0; x <= rect.x1; x++) {
                        // Reeds in the water are in nobody's way
                        const i = x + y * sizeX;
                        clear[i] = grid.levels[0].flags[i] & TILE_BLOCKED ? 0 : 1;
                    }
                }
            }
        }
        town.locs?.forEach((loc) => own.add(loc));
    }
    const check = (x: number, y: number, what: string) => {
        const i = x + y * sizeX;
        if (band[i]) {
            clashes.push({ rule: "wall", x, y, what: `${what} on a wall` });
        } else if (clear[i]) {
            clashes.push({ rule: "gate", x, y, what: `${what} in a gate's clear space` });
        }
    };
    grid.locs.forEach((loc) => {
        const { id, type, x, y, rotation } = loc;
        if (own.has(loc) || type === LOC_DECORATION) {
            return;
        }
        const { sizeX: across, sizeY: deep } = locs(id);
        const wide = rotation & 1 ? deep : across;
        const tall = rotation & 1 ? across : deep;
        for (let ty = y; ty < Math.min(y + tall, sizeY); ty++) {
            for (let tx = x; tx < Math.min(x + wide, sizeX); tx++) {
                check(tx, ty, `loc ${id}`);
            }
        }
    });
    footprint.forEach((tile, i) => {
        if (tile) {
            check(i % sizeX, Math.floor(i / sizeX), "a building");
        }
    });
    return clashes;
}

// Roads on buildings and on what's theirs, but for a building's own way out
function findRoadClashes(map: GeneratedMap): Clash[] {
    const { grid, roadTiles, buildings, clippedRoads } = map;
    const { sizeX } = grid;
    const clashes: Clash[] = [];
    for (const { name, x, y, sizeX: wide, sizeY: deep, exit, plot, yard } of buildings) {
        const isOwnWay = (tx: number, ty: number) => {
            if (!exit) {
                return false;
            }
            const toX = tx + 0.5 - exit.x;
            const toY = ty + 0.5 - exit.y;
            const out = toX * exit.outX + toY * exit.outY;
            const side = Math.abs(toX * exit.outY) + Math.abs(toY * exit.outX);
            return out >= -DOOR_STRIP_BEHIND && side <= DOOR_STRIP_SIDE;
        };
        const nearDoor = (tx: number, ty: number) =>
            exit !== undefined && Math.hypot(tx + 0.5 - exit.x, ty + 0.5 - exit.y) <= DOOR_REACH;
        if (clippedRoads) {
            for (let ty = y; ty < y + deep; ty++) {
                for (let tx = x; tx < x + wide; tx++) {
                    if (clippedRoads[tx + ty * sizeX] && !nearDoor(tx, ty)) {
                        clashes.push({
                            rule: "road",
                            x: tx,
                            y: ty,
                            what: `a road runs into ${name}`,
                        });
                    }
                }
            }
        }
        if (plot) {
            for (let ty = plot.y0; ty <= plot.y1; ty++) {
                for (let tx = plot.x0; tx <= plot.x1; tx++) {
                    if (roadTiles[tx + ty * sizeX] && !isOwnWay(tx, ty)) {
                        const part = yard && inRect(yard, tx, ty) ? "yard" : "plot";
                        clashes.push({
                            rule: "road",
                            x: tx,
                            y: ty,
                            what: `a road on ${name}'s ${part}`,
                        });
                    }
                }
            }
        }
    }
    return clashes;
}

// Which plot each tile's on, as an index into buildings, and any two that overlap
function findPlotClashes(map: GeneratedMap): { owners: Int32Array; clashes: Clash[] } {
    const { grid, buildings } = map;
    const { sizeX, sizeY } = grid;
    const owners = new Int32Array(sizeX * sizeY).fill(-1);
    const clashes: Clash[] = [];
    buildings.forEach(({ name, plot }, at) => {
        for (let y = plot?.y0 ?? 0; plot && y <= plot.y1; y++) {
            for (let x = plot.x0; x <= plot.x1; x++) {
                const i = x + y * sizeX;
                if (owners[i] >= 0) {
                    const other = buildings[owners[i]].name;
                    clashes.push({ rule: "plot", x, y, what: `${name}'s plot on ${other}'s` });
                }
                owners[i] = at;
            }
        }
    });
    return { owners, clashes };
}

// A fence stands on a side of a tile, so a road crosses it if it's painted up to that side from
// both tiles it parts. One running along the outside of a fence doesn't.
function findFenceClashes(map: GeneratedMap, owners: Int32Array): Clash[] {
    const { grid, buildings, fences } = map;
    const { sizeX, sizeY } = grid;
    const clashes: Clash[] = [];
    for (const { x, y, rotation, owner } of fences ?? []) {
        const i = x + y * sizeX;
        const stepX = [-1, 0, 1, 0][rotation];
        const stepY = [0, 1, 0, -1][rotation];
        const nx = x + stepX;
        const ny = y + stepY;
        if (nx >= 0 && ny >= 0 && nx < sizeX && ny < sizeY) {
            const near = (getRoadSides(map, i) >> (rotation * 2)) & 3;
            const far = (getRoadSides(map, nx + ny * sizeX) >> (((rotation + 2) & 3) * 2)) & 3;
            if (near && far) {
                clashes.push({ rule: "fence", x, y, what: "a fence across a road" });
            }
        }
        const other = owners[i] >= 0 ? buildings[owners[i]] : undefined;
        if (other && other.plot !== owner) {
            clashes.push({ rule: "fence", x, y, what: `a fence on ${other.name}'s plot` });
        }
    }
    return clashes;
}

// Everything that breaks the flow, but for what the recipe's said was meant
export function findClashes(map: GeneratedMap, locs: LocSizes): Clash[] {
    const { owners, clashes: plots } = findPlotClashes(map);
    const all = [
        ...findBandClashes(map, locs),
        ...findRoadClashes(map),
        ...plots,
        ...findFenceClashes(map, owners),
    ];
    const designed = map.designed ?? [];
    return all.filter(({ x, y }) => !designed.some((rect) => inRect(rect, x, y)));
}

// A line a kind for a list of clashes: how many, and where the first few are
export function describeClashes(clashes: Clash[]): string[] {
    const byRule = new Map<string, Clash[]>();
    for (const clash of clashes) {
        byRule.set(clash.rule, [...(byRule.get(clash.rule) ?? []), clash]);
    }
    return [...byRule].map(([rule, list]) => {
        const where = list
            .slice(0, 4)
            .map(({ x, y, what }) => `${what} at ${x},${y}`)
            .join("; ");
        return `${list.length} ${rule} clashes: ${where}`;
    });
}
