import { Ground } from "../Ground";
import { BIOMES } from "../biomes";
import { dressRock, paintRockFloor } from "../dress";
import { TILE_BLOCKED } from "../format";
import { BuildContext, MapRecipe } from "../recipe";

// Each biome's rock as the generator dresses it, a screen each, to look at from the play
// camera: a cliff facing south with ground at its foot and on top. Row by row from the
// south-west, in the order of BIOMES.
const CELL_X = 30;
const CELL_Y = 18;
const COLS = 4;
const SIZE = 5 * 64;
const MARGIN = 64;
const LOW = 40;
// A tile's rise on the face, and how deep the face is in tiles
const FACE_SLOPE = 24;
const FACE_TILES = 4;
const FACE_START = 8;

const BIOME_LIST = Object.values(BIOMES);

function build(_context: BuildContext) {
    const ground = new Ground(SIZE, SIZE);
    const { underlays, flags } = ground.level0;
    const rock = new Uint8Array(SIZE * SIZE);
    const inCell = (x: number, y: number) => {
        const lx = x - MARGIN;
        const ly = y - MARGIN;
        const index = Math.floor(ly / CELL_Y) * COLS + Math.floor(lx / CELL_X);
        const inside = lx >= 0 && ly >= 0 && lx < COLS * CELL_X && index < BIOME_LIST.length;
        return inside
            ? { biome: BIOME_LIST[index], up: ly - Math.floor(ly / CELL_Y) * CELL_Y }
            : null;
    };
    for (let y = 0; y <= SIZE; y++) {
        for (let x = 0; x <= SIZE; x++) {
            const up = inCell(x, y)?.up ?? 0;
            const rise = Math.min(Math.max(up - FACE_START, 0), FACE_TILES) * FACE_SLOPE;
            ground.setHeight(x, y, LOW + rise);
        }
    }
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const i = ground.tile(x, y);
            const cell = inCell(x, y);
            const face = cell && cell.up >= FACE_START && cell.up < FACE_START + FACE_TILES;
            underlays[i] = cell ? (face ? cell.biome.rock.ground : cell.biome.ground[0]) : 48;
            if (face) {
                rock[i] = 1;
                flags[i] |= TILE_BLOCKED;
            }
        }
    }
    const biomeAt = (x: number, y: number) => inCell(x, y)?.biome ?? BIOMES.meadow;
    paintRockFloor(ground, rock, (x, y) => biomeAt(x, y).rock.overlay);
    dressRock(ground, rock, { kitAt: (x, y) => biomeAt(x, y).rock, seed: 1, share: 1 });
    return ground.grid;
}

export const ROCK_SHEET: MapRecipe = {
    id: "scaperune_rocksheet",
    mapX: 93,
    mapY: 188,
    squaresX: 5,
    squaresY: 5,
    margin: 1,
    spawn: { x: MARGIN + 2, y: MARGIN + 2 },
    build,
};
