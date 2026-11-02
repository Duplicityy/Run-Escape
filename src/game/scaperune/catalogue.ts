import { PlacedLoc, TileGrid } from "./format";

// Locs that read wrong outside what they were built for. See the design research, section 8.
// A curated list, not a rule about where a loc comes from: plenty of good outdoor locs are
// never placed on the surface.
export const BANNED_LOCS: { ids: [from: number, to: number]; why: string; inWater?: true }[] = [
    { ids: [45872, 45915], why: "the Tombs of Amascut's arena floor and its pillars" },
    { ids: [48328, 48333], why: "collapsed roof from a sunken city" },
    { ids: [48972, 48973], why: "instance debris" },
    { ids: [60436, 60444], why: "sea rocks: they sink 3.5 tiles", inWater: true },
    { ids: [14416, 14416], why: "lines a hole in the ground" },
    { ids: [14427, 14427], why: "a quad under the ground" },
];

// Overlays that are water, as the map files store them. Lava counts: rocks stand in it too.
export const WATER_OVERLAYS = new Set([6, 7, 19, 442, 547, 568]);

// What grows in a field, by name, as the cache spells it: check-maps.ts finds fields by these
export const CROP_NAME = /^(cabbage|corn|flax|onion|potato|pumpkin|wheat)s?$/i;

// Only has a model for wall decoration, so as ground decoration it draws nothing
export const BLOOD_WALL_ONLY = 13312;

export type BannedLoc = { loc: PlacedLoc; why: string };

// What's on the wrong ground
export function findBannedLocs(grid: TileGrid): BannedLoc[] {
    const { overlays } = grid.levels[0];
    const banned: BannedLoc[] = [];
    for (const loc of grid.locs) {
        const rule = BANNED_LOCS.find(({ ids: [from, to] }) => loc.id >= from && loc.id <= to);
        if (!rule) {
            continue;
        }
        const wet = WATER_OVERLAYS.has(overlays[loc.x + loc.y * grid.sizeX]);
        if (!rule.inWater || !wet) {
            banned.push({ loc, why: rule.why });
        }
    }
    return banned;
}
