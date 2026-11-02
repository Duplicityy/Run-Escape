import { Ground } from "../Ground";
import { CITY_WALLS, CITY_WALL_IDS, placeCityWall } from "../cityWalls";
import { TileGrid } from "../format";
import { MapRecipe } from "../recipe";

// Every city wall twice, to look them over: on the flat to the west, and to the east on a slope
// that climbs eastward, each with a gate north and south and the same in a smaller wall.
const CELL_X = 58;
const CELL_Y = 34;
const WALL_X = 40;
const WALL_Y = 20;
const SQUARES = 7;
const SIZE = SQUARES * 64;

// Where the slope starts, how far it runs, and how much it climbs a tile
const SLOPE_FROM = 64 + 8 + CELL_X;
const SLOPE_RUN = CELL_X - 8;
const SLOPE = 3;

export const WALL_SHEET_START = { x: 64 + 8, y: 64 + 8 };

function build(): TileGrid {
    const ground = new Ground(SIZE, SIZE);
    ground.level0.underlays.fill(48);
    for (let y = 0; y <= SIZE; y++) {
        for (let x = 0; x <= SIZE; x++) {
            const up = Math.min(Math.max(x - SLOPE_FROM, 0), SLOPE_RUN);
            ground.setHeight(x, y, 40 + up * SLOPE);
        }
    }
    CITY_WALL_IDS.forEach((id, row) => {
        const y0 = WALL_SHEET_START.y + row * CELL_Y;
        for (let column = 0; column < 2; column++) {
            const x0 = WALL_SHEET_START.x + column * CELL_X;
            const middle = x0 + (WALL_X >> 1);
            placeCityWall(ground, CITY_WALLS[id], { x0, y0, x1: x0 + WALL_X, y1: y0 + WALL_Y }, [
                { side: "south", at: middle },
                { side: "north", at: middle },
            ]);
        }
    });
    return ground.grid;
}

export const WALL_SHEET: MapRecipe = {
    id: "scaperune_walls",
    mapX: 92,
    mapY: 94,
    squaresX: SQUARES,
    squaresY: SQUARES,
    margin: 1,
    spawn: { x: 66, y: 66 },
    build,
};
