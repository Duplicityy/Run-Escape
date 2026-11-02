import { BIOMES, BiomeId } from "./biomes";
import { Build, LOC_NORMAL } from "./mapBuild";
import { createRng } from "./noise";
import { RESERVE_PLOT } from "./reservations";
import { PlacedBuilding } from "./settlements";

// Small things stood together against a wall, away from the door. 30% to 58% of a real town's
// props touch a wall, half are in groups, and the groups are kits: barrel with crate, table
// with stools, flowers with bushes. See the design research, section 5.

const VIGNETTE_SEED = 500;

// Tiles a door keeps clear on its own side
const DOOR_CLEAR = 2;

// Things in a group, least and most
const GROUP_LEAST = 3;
const GROUP_MOST = 6;

const GROUPS_A_BUILDING = 1.5;

const STORAGE_KIT = [357, 358, 362, 365];
const JUNGLE_RACK = [357, 358, 362, 395, 396];
const JUNGLE_REST = [1113, 620, 1113];
const JUNGLE_GARDEN = [1184, 1186, 1184, 1402];
const HOSIDIUS_STORE = [42066, 42068, 42072, 42074];
const HOSIDIUS_GARDEN = [42414, 42415, 1393, 42400];
const HOSIDIUS_REST = [42092, 42092, 27340];
const DARK_STORE = [39456, 39242, 39464];
const ELF_STORE = [9083, 6180, 18201];
const ELF_GARDEN = [3904, 3906, 3902, 3905];

// Groups each biome's towns really have, taken from the ground round its prefabs. All a tile
// each, and all stand level, so they stay on the flat ground beside a wall.
export const VIGNETTES: Record<BiomeId, number[][]> = {
    meadow: [
        [5123, 5106, 4641, 5123],
        [1188, 1187, 1393, 1124],
        [7167, 2333, 7168],
    ],
    desert: [STORAGE_KIT, [1158, 6237, 583], [385, 383, 365, 357], [1102, 604, 1102]],
    swamp: [
        [24344, 3508, 24344],
        [5332, 5334, 3508, 5332],
        [24322, 24322, 3508],
    ],
    snow: [
        [4301, 4300, 4275, 304],
        [4298, 4297, 4299, 4301],
        [1095, 4372, 1095],
    ],
    jungle: [JUNGLE_RACK, JUNGLE_GARDEN, JUNGLE_REST],
    tropical: [JUNGLE_RACK, [4794, 396, 395], [4764, 620, 4764]],
    ash: [HOSIDIUS_STORE, HOSIDIUS_GARDEN, HOSIDIUS_REST],
    autumn: [HOSIDIUS_STORE, HOSIDIUS_GARDEN, HOSIDIUS_REST],
    deadlands: [DARK_STORE, [5334, 5332, 3508, 5332]],
    elven: [ELF_STORE, ELF_GARDEN, [8768, 36564, 8768]],
    fairy: [],
    darkwood: [DARK_STORE, [39463, 39464, 39242]],
    astral: [ELF_STORE, ELF_GARDEN, [8768, 36564, 8768]],
};

// The ground beside a building's wall: a line of tiles from x, y, going along stepX, stepY
type WallSide = { x: number; y: number; length: number; stepX: number; stepY: number };

function getWallSides(building: PlacedBuilding): WallSide[] {
    const { x, y, sizeX, sizeY, exit } = building;
    const sides: (WallSide & { outX: number; outY: number })[] = [
        { x, y: y - 1, length: sizeX, stepX: 1, stepY: 0, outX: 0, outY: -1 },
        { x, y: y + sizeY, length: sizeX, stepX: 1, stepY: 0, outX: 0, outY: 1 },
        { x: x - 1, y, length: sizeY, stepX: 0, stepY: 1, outX: -1, outY: 0 },
        { x: x + sizeX, y, length: sizeY, stepX: 0, stepY: 1, outX: 1, outY: 0 },
    ];
    return sides.filter(({ outX, outY }) => !exit || outX !== exit.outX || outY !== exit.outY);
}

// One or two groups a building, each on a wall without its door. They're part of its plot, so they
// stand on that and nowhere else, keep off roads and leave a tile clear on their open side. Returns
// how many locs it placed.
export function placeVignettes(build: Build, buildings: PlacedBuilding[]): number {
    const { ground, settings, biomeNear } = build;
    const { ranks } = ground.claims;
    const roll = createRng(settings.seed + VIGNETTE_SEED);
    const biomeIds = Object.keys(VIGNETTES) as BiomeId[];
    const taken = new Set<number>();
    let placed = 0;
    for (const building of buildings) {
        const { plot } = building;
        // Its own tiles are spoken for by itself, so it's asking for tiles with nothing on them yet
        const isOnPlot = (x: number, y: number) =>
            !!plot &&
            x >= plot.x0 &&
            y >= plot.y0 &&
            x <= plot.x1 &&
            y <= plot.y1 &&
            ranks[ground.tile(x, y)] === RESERVE_PLOT &&
            !ground.footprint[ground.tile(x, y)] &&
            !taken.has(ground.tile(x, y));
        const isOpen = (x: number, y: number) => isOnPlot(x, y) || ground.isClear(x, y, 1, 1);
        const sides = getWallSides(building);
        const count = Math.floor(GROUPS_A_BUILDING + roll());
        for (let group = 0; group < count && sides.length > 0; group++) {
            const side = sides.splice(Math.floor(roll() * sides.length), 1)[0];
            const biome = biomeNear(side.x, side.y, roll());
            const id = biomeIds.find((key) => BIOMES[key] === biome);
            const groups = id ? VIGNETTES[id] : [];
            if (groups.length === 0) {
                continue;
            }
            const kit = groups[Math.floor(roll() * groups.length)];
            const wanted = GROUP_LEAST + Math.floor(roll() * (GROUP_MOST - GROUP_LEAST + 1));
            const start = Math.floor(roll() * Math.max(side.length - wanted, 1));
            for (let along = 0; along < Math.min(wanted, side.length - start); along++) {
                const x = side.x + side.stepX * (start + along);
                const y = side.y + side.stepY * (start + along);
                const { exit } = building;
                const byDoor = exit && Math.hypot(x + 0.5 - exit.x, y + 0.5 - exit.y) < DOOR_CLEAR;
                // Away from the wall, which is one way or the other
                const open =
                    isOnPlot(x, y) &&
                    (isOpen(x + side.stepY, y + side.stepX) ||
                        isOpen(x - side.stepY, y - side.stepX));
                if (open && !byDoor) {
                    const loc = kit[Math.floor(roll() * kit.length)];
                    const rotation = Math.floor(roll() * 4);
                    ground.place({ id: loc, type: LOC_NORMAL, rotation, level: 0, x, y }, 1, 1);
                    taken.add(ground.tile(x, y));
                    placed++;
                }
            }
        }
    }
    return placed;
}
