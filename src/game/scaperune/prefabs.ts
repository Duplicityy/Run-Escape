import type { Ground } from "./Ground";
import { Exit, findExits } from "./building";
import type { PlacedLoc, TileGrid } from "./format";
import { cutPrefab, rotatePrefab } from "./prefab";
import type { BuildContext } from "./recipe";

// A rectangle of the real world, in world tiles: its south-west corner and size, and any locs
// that are there but aren't wanted
export type PrefabDef = {
    worldX: number;
    worldY: number;
    sizeX: number;
    sizeY: number;
    leaveOut?: number[];
};

// Rectangles that hold a whole building, every wall, and nothing else. Find more with
// scripts/scaperune/find-prefabs.ts, and check them with check-prefabs.ts.
export const PREFABS: Record<string, PrefabDef> = {
    lumbridge_house: { worldX: 3243, worldY: 3244, sizeX: 6, sizeY: 5 },
    lumbridge_church: { worldX: 3238, worldY: 3204, sizeX: 11, sizeY: 13 },
    varrock_shop: { worldX: 3245, worldY: 3402, sizeX: 8, sizeY: 10 },
    // West Varrock's, from the street-survey
    varrock_cottage: { worldX: 3200, worldY: 3430, sizeX: 6, sizeY: 9 },
    varrock_house: { worldX: 3191, worldY: 3401, sizeX: 9, sizeY: 7 },
    varrock_terrace: { worldX: 3184, worldY: 3404, sizeX: 7, sizeY: 12 },
    varrock_store: { worldX: 3184, worldY: 3419, sizeX: 8, sizeY: 10 },
    varrock_corner: { worldX: 3217, worldY: 3383, sizeX: 9, sizeY: 7 },
    al_kharid_house: { worldX: 3311, worldY: 3172, sizeX: 9, sizeY: 16 },
    al_kharid_shop: { worldX: 3317, worldY: 3190, sizeX: 8, sizeY: 9 },
    canifis_house: { worldX: 3473, worldY: 3490, sizeX: 9, sizeY: 12 },
    rellekka_hut: { worldX: 2665, worldY: 3699, sizeX: 8, sizeY: 7 },
    rellekka_house: { worldX: 2677, worldY: 3686, sizeX: 9, sizeY: 9 },
    // Bamboo and thatch: Tai Bwo Wannai, and a stone hut on Ape Atoll
    taibwo_hut: { worldX: 2787, worldY: 3051, sizeX: 7, sizeY: 7 },
    taibwo_house: { worldX: 2794, worldY: 3052, sizeX: 10, sizeY: 9 },
    taibwo_hall: { worldX: 2831, worldY: 2979, sizeX: 10, sizeY: 16 },
    ape_hut: { worldX: 2765, worldY: 2747, sizeX: 7, sizeY: 7 },
    // Whitewashed Pollnivneach, and sandstone Sophanem
    pollnivneach_house: { worldX: 3356, worldY: 2990, sizeX: 7, sizeY: 7 },
    pollnivneach_inn: { worldX: 3355, worldY: 2998, sizeX: 6, sizeY: 8 },
    pollnivneach_shop: { worldX: 3362, worldY: 2998, sizeX: 5, sizeY: 7 },
    sophanem_fort: { worldX: 3259, worldY: 2776, sizeX: 10, sizeY: 9 },
    // Darkmeyer's stone and Burgh de Rott's rot
    darkmeyer_house: { worldX: 3639, worldY: 3375, sizeX: 10, sizeY: 7 },
    // It has a black tower at each end, far too tall without what stood round them
    darkmeyer_hall: {
        worldX: 3660,
        worldY: 3375,
        sizeX: 9,
        sizeY: 8,
        leaveOut: [39177, 39180],
    },
    darkmeyer_shop: { worldX: 3639, worldY: 3383, sizeX: 10, sizeY: 8 },
    burgh_house: { worldX: 3529, worldY: 3310, sizeX: 7, sizeY: 7 },
    burgh_inn: { worldX: 3530, worldY: 3318, sizeX: 10, sizeY: 9 },
    // Prifddinas's eight-sided houses
    prif_house: { worldX: 3269, worldY: 6034, sizeX: 7, sizeY: 7 },
    prif_shop: { worldX: 3234, worldY: 6037, sizeX: 7, sizeY: 7 },
    prif_hut: { worldX: 3253, worldY: 6037, sizeX: 7, sizeY: 7 },
    prif_hall: { worldX: 3305, worldY: 6052, sizeX: 7, sizeY: 7 },
    // Hosidius, and Shayzien's dark halls
    hosidius_barn: { worldX: 1783, worldY: 3519, sizeX: 9, sizeY: 12 },
    shayzien_house: { worldX: 1537, worldY: 3540, sizeX: 8, sizeY: 11 },
    shayzien_shop: { worldX: 1537, worldY: 3553, sizeX: 8, sizeY: 7 },
    // Lovakengj's iron
    lovakengj_house: { worldX: 1538, worldY: 3778, sizeX: 12, sizeY: 7 },
    lovakengj_hall: { worldX: 1551, worldY: 3778, sizeX: 11, sizeY: 12 },
};

// A bridge, turned as turns says to run east to west: 18 tiles long and 6 wide, with its deck on
// level 1 across a river 9 tiles wide (from x 5 to 13) running north to south. The deck and the
// gap between the fences at each end are the 2 rows either side of y = 3. Only these fit
// that as they are, so they're swapped for each other: others have their own banks and heights.
export type BridgeDef = PrefabDef & {
    turns: number;
    // How high its own banks are, to set it on ours. The river bed under it is at 0.
    bankHeight: number;
};

export const BRIDGES: Record<string, BridgeDef> = {
    // Over the River Lum
    stone: { worldX: 3236, worldY: 3223, sizeX: 18, sizeY: 6, turns: 0, bankHeight: 30 },
    // The same bridge, in Tirannwn: pale, with elven lamps
    elven: {
        worldX: 2238,
        worldY: 3229,
        sizeX: 6,
        sizeY: 18,
        turns: 1,
        bankHeight: 30,
        leaveOut: [3886, 3897],
    },
    // Red timber, from Varlamore, level all the way over
    timber: { worldX: 1506, worldY: 3200, sizeX: 6, sizeY: 18, turns: 1, bankHeight: 35 },
};
export const BRIDGE_LENGTH = 18;
export const BRIDGE_DECK_ROW = 3;
// Tile edges where the deck starts and stops, in x
export const BRIDGE_DECK_WEST = 4;
export const BRIDGE_DECK_EAST = 15;

const DOOR_NAME = /\b(door|gate|curtain)\b/i;
// Over this many tiles the ground eases back to its own heights round a building
const BUILDING_FEATHER = 4;

export function loadPrefab(context: BuildContext, def: PrefabDef): TileGrid {
    const prefab = cutPrefab(context.maps, def.worldX, def.worldY, def.sizeX, def.sizeY);
    const { leaveOut } = def;
    if (leaveOut) {
        prefab.locs = prefab.locs.filter((loc) => !leaveOut.includes(loc.id));
    }
    return prefab;
}

export function isDoor(context: Pick<BuildContext, "locs">, loc: PlacedLoc): boolean {
    return loc.type <= 3 && DOOR_NAME.test(context.locs(loc.id).name);
}

// What a building is, for the settings that turn them on and off
const BUILDING_KINDS: Record<string, BuildingKind> = {
    lumbridge_house: "house",
    lumbridge_church: "church",
    varrock_shop: "shop",
    varrock_cottage: "house",
    varrock_house: "house",
    varrock_terrace: "house",
    varrock_store: "shop",
    varrock_corner: "house",
    al_kharid_house: "house",
    al_kharid_shop: "shop",
    canifis_house: "shop",
    rellekka_hut: "house",
    rellekka_house: "house",
    taibwo_hut: "house",
    taibwo_house: "house",
    taibwo_hall: "shop",
    ape_hut: "house",
    pollnivneach_house: "house",
    pollnivneach_inn: "shop",
    pollnivneach_shop: "shop",
    sophanem_fort: "church",
    darkmeyer_house: "house",
    darkmeyer_hall: "church",
    darkmeyer_shop: "shop",
    burgh_house: "house",
    burgh_inn: "shop",
    prif_house: "house",
    prif_shop: "shop",
    prif_hut: "house",
    prif_hall: "church",
    hosidius_barn: "shop",
    shayzien_house: "house",
    shayzien_shop: "shop",
    lovakengj_house: "house",
    lovakengj_hall: "church",
};

export type BuildingKind = "house" | "shop" | "church";

export function getBuildingKind(name: string): BuildingKind {
    return BUILDING_KINDS[name];
}

export function isBuildingKind(
    name: string,
    allowed: { houses: boolean; shops: boolean; churches: boolean },
): boolean {
    const kind = BUILDING_KINDS[name];
    return kind === "house" ? allowed.houses : kind === "shop" ? allowed.shops : allowed.churches;
}

// Of a ruin's walls, this share still stands
const RUIN_WALLS = 0.45;

// Prefabs in each rotation, cut once: a big map has hundreds of buildings
export class PrefabKit {
    private readonly turned = new Map<string, { prefab: TileGrid; exits: Exit[] }>();

    // A map can bring prefabs of its own, which the generator won't then pick
    constructor(
        readonly context: BuildContext,
        private readonly defs: Record<string, PrefabDef> = PREFABS,
    ) {}

    get(name: string, turns: number): { prefab: TileGrid; exits: Exit[] } {
        const key = `${name}:${turns}`;
        let entry = this.turned.get(key);
        if (!entry) {
            const prefab = rotatePrefab(
                loadPrefab(this.context, this.defs[name]),
                turns,
                this.context.locs,
            );
            const exits = findExits(prefab, (loc) => isDoor(this.context, loc));
            entry = { prefab, exits };
            this.turned.set(key, entry);
        }
        return entry;
    }

    // Stands a building on the ground, with its doors off so that you can walk in.
    // keepHeights is for a map that pins its ground for itself.
    stamp(
        ground: Ground,
        name: string,
        turns: number,
        x: number,
        y: number,
        keepHeights = false,
    ): void {
        ground.stamp(this.get(name, turns).prefab, x, y, {
            floor: "footprint",
            feather: BUILDING_FEATHER,
            flatten: true,
            keepHeights,
            keepUnderlays: true,
            skipLoc: (loc) => isDoor(this.context, loc),
        });
    }

    // The same with most of it gone: no furniture, some of its walls and none of its floor,
    // which would only show as a slab with nothing round it
    stampRuin(
        ground: Ground,
        name: string,
        turns: number,
        x: number,
        y: number,
        roll: () => number,
        keepHeights = false,
    ): void {
        ground.stamp(this.get(name, turns).prefab, x, y, {
            floor: () => false,
            feather: BUILDING_FEATHER,
            flatten: true,
            keepHeights,
            keepUnderlays: true,
            skipLoc: (loc) => isDoor(this.context, loc) || loc.type > 3 || roll() > RUIN_WALLS,
        });
    }
}
