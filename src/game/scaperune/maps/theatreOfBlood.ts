import { Ground } from "../Ground";
import { blockTile, findReachable, getCollisionFlags } from "../collision";
import { MAP_SQUARE_SIZE, TILE_BLOCKED, TileGrid, createTileGrid } from "../format";
import { createRng } from "../noise";
import { cutPrefab, rotatePrefab } from "../prefab";
import { isDoor } from "../prefabs";
import { BuildContext, MapRecipe } from "../recipe";

// The Theatre of Blood, as a raid (MapDef.raid): six rooms, one for each of its bosses, walled off
// from each other in the dark, so the only way between them is the sim's teleport. Each room is a
// hall to fight its waves in, and above it the real boss room from the cache, cut out and stood on
// a pad of its own: the party's brought in there for the boss, and it's too small for a crowd.
//
// The halls are the way there, cut from the real world: the woods outside Canifis, Burgh de Rott,
// Meiyerditch, Darkmeyer, and Vampyrium's wilds and town, the vampyres' own, where Verzik waits.
//
// Rooms are cells of CELL_X by CELL_Y tiles, three across and two up. A cell's hall is its lower
// part and its boss room the upper. Everything that isn't a hall or a boss room is blocked, and
// has no floor, so it draws as the Theatre's void.

const MAP_X = 78;
const MAP_Y = 66;
const MARGIN = 1;
const COLUMNS = 3;
const ROWS = 2;
const CELL_X = 128;
const CELL_Y = 160;
const SQUARES_X = (COLUMNS * CELL_X) / MAP_SQUARE_SIZE + MARGIN * 2;
const SQUARES_Y = (ROWS * CELL_Y) / MAP_SQUARE_SIZE + MARGIN * 2;
const SIZE_X = SQUARES_X * MAP_SQUARE_SIZE;
const SIZE_Y = SQUARES_Y * MAP_SQUARE_SIZE;
const ARENA_MIN = MARGIN * MAP_SQUARE_SIZE;

// A hall, inside its cell: tiles in from the cell's sides, and how big
const HALL_INSET = 4;
const HALL_X = CELL_X - HALL_INSET * 2;
const HALL_Y = 100;
// Where the boss room's pad starts, above the hall, and how tall it is
const PAD_Y = 108;
const PAD_HEIGHT = 48;

const FLOOR_HEIGHT = 24;

// A hall: a rectangle of the real world, HALL_X by HALL_Y once it's turned (a quarter turn
// clockwise for each of `turns`, so a cut that's taller than it's wide goes in on its side), and
// where in it the party starts and the teleporter stands, in tiles from its south-west corner as
// it lies in the hall. Each start's in the biggest piece of ground that can be walked round, with
// room about it. Doors come off, so the ways through houses are open; in a `clear` hall (a town's
// streets) so do the one-tile things that block, lamps, stools and counters, which otherwise cut
// the streets into pieces too small for waves.
type HallCut = {
    x: number;
    y: number;
    turns: number;
    clear?: boolean;
    // The share of its open floor with blood on it (Bloodsplatter, BLOOD)
    blood?: number;
    start: [x: number, y: number];
    portal: [x: number, y: number];
};

// The teleporter (RaidRoomDef.teleporter) is 2 by 2, drawn by the game (RAID_PORTAL_LOC) only once
// there are teleports to use, so it isn't in the map.
const HALLS: Record<TobRoomId, HallCut> = {
    // The swamp woods between Canifis and Port Phasmatys, where the vampyres hunt
    maiden: { x: 3525, y: 3430, turns: 0, blood: 0.07, start: [56, 50], portal: [58, 46] },
    // Burgh de Rott, and the open ground east of it
    bloat: { x: 3468, y: 3172, turns: 0, start: [63, 48], portal: [68, 45] },
    // Meiyerditch's slums, on their side, as they run north to south
    nylocas: { x: 3572, y: 3230, turns: 1, clear: true, start: [62, 50], portal: [64, 45] },
    // Darkmeyer's streets
    sotetseg: { x: 3570, y: 3310, turns: 0, clear: true, start: [59, 53], portal: [52, 52] },
    // Slepe, the last village before the vampyres' own land
    xarpus: { x: 3660, y: 3260, turns: 0, start: [55, 51], portal: [56, 55] },
    // Vampyrium, east of its castle (whose floor's the cache's hidden overlay, and draws nothing)
    verzik: { x: 2543, y: 7790, turns: 0, clear: true, start: [57, 48], portal: [52, 47] },
};

// A boss room: a rectangle of the real world, in world tiles, with its plane (Xarpus is upstairs),
// and where in it the party's brought to and the boss turns up, in tiles from its south-west corner
type RoomCut = {
    x: number;
    y: number;
    sizeX: number;
    sizeY: number;
    plane: number;
    arrive: [x: number, y: number];
    boss: [x: number, y: number];
};

export type TobRoomId = "maiden" | "bloat" | "nylocas" | "sotetseg" | "xarpus" | "verzik";

// In the Theatre's order. Cells go along the bottom row west to east, then back along the top.
// The rectangles are each room's floor with two tiles round it, for its walls.
const ROOMS: { id: TobRoomId; cut: RoomCut }[] = [
    // She's chained to the west wall, so she's beside her platform
    {
        id: "maiden",
        cut: { x: 3158, y: 4433, sizeX: 32, sizeY: 28, plane: 0, arrive: [13, 11], boss: [13, 14] },
    },
    // A loop round a solid middle: in on the west side, the Bloat at the top
    {
        id: "bloat",
        cut: { x: 3283, y: 4436, sizeX: 26, sizeY: 24, plane: 0, arrive: [5, 13], boss: [11, 17] },
    },
    {
        id: "nylocas",
        cut: { x: 3288, y: 4241, sizeX: 16, sizeY: 19, plane: 0, arrive: [7, 4], boss: [7, 10] },
    },
    {
        id: "sotetseg",
        cut: { x: 3270, y: 4303, sizeX: 20, sizeY: 33, plane: 0, arrive: [9, 14], boss: [9, 21] },
    },
    {
        id: "xarpus",
        cut: { x: 3161, y: 4373, sizeX: 19, sizeY: 29, plane: 1, arrive: [9, 11], boss: [9, 15] },
    },
    {
        id: "verzik",
        cut: { x: 3152, y: 4300, sizeX: 33, sizeY: 25, plane: 0, arrive: [16, 14], boss: [16, 17] },
    },
];

const CELLS: [column: number, row: number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [0, 1],
];

type Rect = { x0: number; y0: number; x1: number; y1: number };

// Where each room's parts are, in grid tiles
type RoomPlace = {
    id: TobRoomId;
    hall: Rect;
    // The boss room, as stamped
    chamber: Rect;
    // Where the party starts in the hall, where they're brought to in the boss room, and where
    // the boss turns up
    start: { x: number; y: number };
    arrive: { x: number; y: number };
    boss: { x: number; y: number };
    // The teleporter's south-west tile
    portal: { x: number; y: number };
};

function placeRooms(): RoomPlace[] {
    return ROOMS.map(({ id, cut }, i) => {
        const [column, row] = CELLS[i];
        const cellX = ARENA_MIN + column * CELL_X;
        const cellY = ARENA_MIN + row * CELL_Y;
        const hall = {
            x0: cellX + HALL_INSET,
            y0: cellY + HALL_INSET,
            x1: cellX + HALL_INSET + HALL_X - 1,
            y1: cellY + HALL_INSET + HALL_Y - 1,
        };
        const chamberX = cellX + Math.floor((CELL_X - cut.sizeX) / 2);
        const chamberY = cellY + PAD_Y + Math.floor((PAD_HEIGHT - cut.sizeY) / 2);
        const chamber = {
            x0: chamberX,
            y0: chamberY,
            x1: chamberX + cut.sizeX - 1,
            y1: chamberY + cut.sizeY - 1,
        };
        return {
            id,
            hall,
            chamber,
            start: { x: hall.x0 + HALLS[id].start[0], y: hall.y0 + HALLS[id].start[1] },
            arrive: { x: chamberX + cut.arrive[0], y: chamberY + cut.arrive[1] },
            portal: { x: hall.x0 + HALLS[id].portal[0], y: hall.y0 + HALLS[id].portal[1] },
            boss: { x: chamberX + cut.boss[0], y: chamberY + cut.boss[1] },
        };
    });
}

const PLACES = placeRooms();

const worldTile = (x: number, y: number) => ({
    x: MAP_X * MAP_SQUARE_SIZE + x + 0.5,
    y: MAP_Y * MAP_SQUARE_SIZE + y + 0.5,
});

// Each room's parts in world tiles, for the raid's MapDef
export const TOB_ROOM_PLACES = PLACES.map((place) => ({
    id: place.id,
    start: worldTile(place.start.x, place.start.y),
    arrive: worldTile(place.arrive.x, place.arrive.y),
    boss: worldTile(place.boss.x, place.boss.y),
    // The middle of its 2 by 2
    teleporter: {
        x: MAP_X * MAP_SQUARE_SIZE + place.portal.x + 1,
        y: MAP_Y * MAP_SQUARE_SIZE + place.portal.y + 1,
    },
    chamber: {
        minX: MAP_X * MAP_SQUARE_SIZE + place.chamber.x0,
        minY: MAP_Y * MAP_SQUARE_SIZE + place.chamber.y0,
        maxX: MAP_X * MAP_SQUARE_SIZE + place.chamber.x1 + 1,
        maxY: MAP_Y * MAP_SQUARE_SIZE + place.chamber.y1 + 1,
    },
}));

// A cut of the real world with the plane it's on brought down to the ground floor, as the game
// only draws one
function bringDown(grid: TileGrid, plane: number): TileGrid {
    if (plane === 0) {
        return grid;
    }
    const out = createTileGrid(grid.sizeX, grid.sizeY);
    for (let level = plane; level < grid.levels.length; level++) {
        out.levels[level - plane] = grid.levels[level];
    }
    out.locs = grid.locs
        .filter((loc) => loc.level >= plane)
        .map((loc) => ({ ...loc, level: loc.level - plane }));
    return out;
}

function inRect(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x0 && y >= rect.y0 && x <= rect.x1 && y <= rect.y1;
}

// Bloodsplatter as ground decoration (type 22): 13312 only has a wall's model
const BLOOD = [652, 653, 654];

// Blood over a hall's open floor: on tiles that aren't blocked (water, rock) and have nothing
// already on the ground level, as a tile holds one ground decoration
function spillBlood(ground: Ground, place: RoomPlace, share: number, seed: number): void {
    const { hall } = place;
    const taken = new Set<number>();
    for (const loc of ground.grid.locs) {
        if (loc.level === 0 && inRect(hall, loc.x, loc.y)) {
            taken.add(ground.tile(loc.x, loc.y));
        }
    }
    const rng = createRng(seed);
    for (let y = hall.y0; y <= hall.y1; y++) {
        for (let x = hall.x0; x <= hall.x1; x++) {
            const i = ground.tile(x, y);
            if (rng() >= share || taken.has(i) || ground.level0.flags[i] & TILE_BLOCKED) {
                continue;
            }
            const id = BLOOD[Math.floor(rng() * BLOOD.length)];
            ground.place({ id, type: 22, rotation: Math.floor(rng() * 4), level: 0, x, y }, 1, 1);
        }
    }
}

// A hall's real ground, turned to lie across it, as the world has it: its own heights, stood so
// that its lowest corner's at the floor's height, with what's on it. What can't be walked to from
// the start is blocked later.
function stampHall(ground: Ground, context: BuildContext, place: RoomPlace): void {
    const cut = HALLS[place.id];
    const [sizeX, sizeY] = cut.turns & 1 ? [HALL_Y, HALL_X] : [HALL_X, HALL_Y];
    const hall = rotatePrefab(
        cutPrefab(context.maps, cut.x, cut.y, sizeX, sizeY),
        cut.turns,
        context.locs,
    );
    ground.stamp(hall, place.hall.x0, place.hall.y0, {
        skipLoc: (loc) => {
            if (isDoor(context, loc)) {
                return true;
            }
            const info = context.locs(loc.id);
            return (
                cut.clear === true &&
                loc.type >= 10 &&
                info.sizeX * info.sizeY === 1 &&
                info.clipType > 0
            );
        },
        floor: "all",
        feather: 0,
        flatten: false,
        height: FLOOR_HEIGHT,
        anchor: Math.min(...hall.levels[0].heights),
    });
}

function build(context: BuildContext): TileGrid {
    const ground = new Ground(SIZE_X, SIZE_Y);
    for (let y = 0; y <= SIZE_Y; y++) {
        for (let x = 0; x <= SIZE_X; x++) {
            ground.setHeight(x, y, FLOOR_HEIGHT);
        }
    }
    PLACES.forEach((place, i) => {
        stampHall(ground, context, place);
        const blood = HALLS[place.id].blood;
        if (blood) {
            spillBlood(ground, place, blood, 7200 + i);
        }
        const { cut } = ROOMS[i];
        const room = bringDown(
            cutPrefab(context.maps, cut.x, cut.y, cut.sizeX, cut.sizeY),
            cut.plane,
        );
        ground.stamp(room, place.chamber.x0, place.chamber.y0, {
            floor: "all",
            feather: 0,
            flatten: true,
            height: FLOOR_HEIGHT,
        });
    });

    // Only a hall, or what can be walked to in a boss room from where the party's brought in, is
    // open: the rest is blocked, the boss rooms' doorways and corridors included
    const collision = getCollisionFlags(ground.grid, context.locs);
    const open = new Uint8Array(SIZE_X * SIZE_Y);
    for (const place of PLACES) {
        for (const [rect, from] of [
            [place.hall, place.start],
            [place.chamber, place.arrive],
        ] as const) {
            const reached = findReachable(collision, SIZE_X, SIZE_Y, rect, from.x, from.y);
            let count = 0;
            for (let i = 0; i < reached.length; i++) {
                if (reached[i]) {
                    open[i] = 1;
                    count++;
                }
            }
            if (count < 100) {
                throw new Error(
                    `Theatre of Blood: ${place.id} has ${count} open tiles at ${from.x},${from.y}`,
                );
            }
            if (rect === place.chamber && !reached[ground.tile(place.boss.x, place.boss.y)]) {
                throw new Error(`Theatre of Blood: ${place.id}'s boss can't be reached`);
            }
        }
    }
    for (let y = 0; y < SIZE_Y; y++) {
        for (let x = 0; x < SIZE_X; x++) {
            const i = ground.tile(x, y);
            if (!open[i]) {
                blockTile(ground.grid, i);
                // Nothing to see outside the halls and the boss rooms
                if (
                    !PLACES.some((place) => inRect(place.hall, x, y) || inRect(place.chamber, x, y))
                ) {
                    ground.level0.underlays[i] = 0;
                    ground.level0.overlays[i] = 0;
                }
            }
        }
    }
    // Keep the halls' edges solid even where nothing stands on them
    for (const place of PLACES) {
        const { hall } = place;
        for (let x = hall.x0 - 1; x <= hall.x1 + 1; x++) {
            ground.level0.flags[ground.tile(x, hall.y0 - 1)] |= TILE_BLOCKED;
            ground.level0.flags[ground.tile(x, hall.y1 + 1)] |= TILE_BLOCKED;
        }
        for (let y = hall.y0 - 1; y <= hall.y1 + 1; y++) {
            ground.level0.flags[ground.tile(hall.x0 - 1, y)] |= TILE_BLOCKED;
            ground.level0.flags[ground.tile(hall.x1 + 1, y)] |= TILE_BLOCKED;
        }
    }
    return ground.grid;
}

export const THEATRE_OF_BLOOD: MapRecipe = {
    id: "theatre_of_blood",
    mapX: MAP_X,
    mapY: MAP_Y,
    squaresX: SQUARES_X,
    squaresY: SQUARES_Y,
    margin: MARGIN,
    // The Maiden's hall
    spawn: PLACES[0].start,
    build,
};
