import { Ground } from "./Ground";
import { BIOMES, CLIFF_FALL, LOW_FALL, SNOW_ROCK, WATERFALL } from "./biomes";
import { CITY_WALLS, placeCityWall } from "./cityWalls";
import { REEDS } from "./dress";
import { FLOOR_KITS } from "./floorKits";
import { TileGrid } from "./format";
import { rotatePrefab } from "./prefab";
import { BRIDGES, PREFABS, loadPrefab } from "./prefabs";
import { BuildContext, MapRecipe } from "./recipe";
import { KIT_FENCES } from "./settlements";
import { FOUNTAIN, PAVING, SET_PIECES, getPieceLocs } from "./structures";
import { SQUARE_LOCS } from "./townPlan";
import { VIGNETTES } from "./vignettes";

// Everything the generator can ask the cache for, on one map: each biome's
// floors and locs, and every prefab. The slim cache only keeps what a map reads,
// and a generated map's reads change with the seed, so shipping seeds means
// loading this map too (CLAUDE.md, scripts/scaperune/check-palette.ts).

const SQUARES = 5;
const SIZE = SQUARES * 64;
const PLOT = 20;
const PIECE_ROW = 10;
const WALL_PIECE = 24;

function build(context: BuildContext): TileGrid {
    const ground = new Ground(SIZE, SIZE);
    ground.level0.underlays.fill(BIOMES.meadow.ground[0]);
    ground.level0.heights.fill(40);
    const put1 = (id: number, x: number, y: number) =>
        ground.place({ id, type: 10, rotation: 0, level: 0, x, y }, 1, 1);

    // A plot each for the prefabs and bridge, then a strip per biome
    const defs = [...Object.values(PREFABS), ...Object.values(BRIDGES)];
    defs.forEach((def, i) => {
        const prefab = rotatePrefab(loadPrefab(context, def), 0, context.locs);
        ground.stamp(prefab, 1 + (i % 8) * (PLOT + 2), 1 + Math.floor(i / 8) * PLOT, {
            // Everything in the rectangle: the generator takes some of it for bridges
            // and some for buildings, and this has to cover both
            floor: "all",
            feather: 0,
            flatten: true,
        });
    });

    const rows = Math.ceil(defs.length / 8);
    ground.place({ id: WATERFALL, type: 10, rotation: 0, level: 0, x: 2, y: PLOT * rows }, 3, 2);
    ground.place({ id: CLIFF_FALL, type: 10, rotation: 0, level: 0, x: 8, y: PLOT * rows }, 3, 3);
    ground.place({ id: LOW_FALL, type: 10, rotation: 0, level: 0, x: 12, y: PLOT * rows }, 3, 3);
    SNOW_ROCK.pebbles.forEach((id, i) => {
        ground.place({ id, type: 22, rotation: 0, level: 0, x: 24 + i, y: PLOT * rows }, 1, 1);
    });
    SNOW_ROCK.rubble.forEach(([id, size], i) => {
        const x = 30 + i * (size + 1);
        ground.place({ id, type: 10, rotation: 0, level: 0, x, y: PLOT * rows }, size, size);
    });
    let y = PLOT * rows + 4;
    for (const biome of Object.values(BIOMES)) {
        let x = 2;
        const put = (id: number, size: number, type: number) => {
            ground.place({ id, type, rotation: 0, level: 0, x, y }, size, size);
            x += size + 1;
        };
        for (const [id, size] of [
            ...biome.trees,
            ...biome.rocks,
            ...biome.rock.rubble,
            ...biome.props,
            [biome.rock.cave, 3] as [number, number],
        ]) {
            put(id, size, 10);
        }
        for (const id of [...(biome.rock.facets ?? []), biome.marker]) {
            put(id, 1, 10);
        }
        for (const id of [biome.fence, biome.wall]) {
            put(id, 1, 0);
        }
        for (const id of [...biome.decor, ...biome.rock.stones, ...biome.rock.pebbles]) {
            put(id, 1, 22);
        }
        for (const id of biome.flowers) {
            put(id, 1, 10);
        }
        const { rock } = biome;
        for (const underlay of [
            ...biome.ground,
            biome.shore,
            biome.trail,
            biome.hillGround,
            rock.ground,
            rock.snowGround,
        ]) {
            ground.level0.underlays[ground.tile(x, y)] = underlay;
            x += 2;
        }
        // Blocks, because paintOverlay's smoothing takes off anything a tile across
        for (const [overlay, blocked] of [
            [biome.water, true],
            [biome.road, false],
            [rock.overlay, true],
            [rock.lava, true],
        ] as const) {
            const block = new Uint8Array(SIZE * SIZE);
            for (let dy = 0; dy < 4; dy++) {
                for (let dx = 0; dx < 4; dx++) {
                    block[ground.tile(x + dx, y + dy)] = 1;
                }
            }
            ground.paintOverlay(block, overlay, blocked);
            x += 6;
        }
        y += 6;
    }
    const paved = new Uint8Array(SIZE * SIZE);
    for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
            paved[ground.tile(14 + dx, PLOT * rows + dy)] = 1;
        }
    }
    ground.paintOverlay(paved, PAVING, false);
    for (const biome of Object.values(BIOMES)) {
        ground.level0.overlays[ground.tile(19, PLOT * rows + 5)] = biome.paving ?? PAVING;
    }
    ground.place({ id: FOUNTAIN, type: 10, rotation: 0, level: 0, x: 20, y: PLOT * rows }, 2, 2);
    // What dressing puts on each floor, in rows
    const dressing = [...new Set(Object.values(FLOOR_KITS).flatMap(({ ids }) => ids))];
    dressing.forEach((id, i) => {
        const at = { x: 2 + (i % 100) * 2, y: y + Math.floor(i / 100) * 2 };
        ground.grid.locs.push({ id, type: 22, rotation: 0, level: 0, ...at });
    });
    y += (Math.ceil(dressing.length / 100) + 1) * 2;
    REEDS.forEach((id, i) => put1(id, 2 + i * 2, y));
    SQUARE_LOCS.forEach((id, i) => {
        ground.place({ id, type: 10, rotation: 0, level: 0, x: 40 + i * 3, y }, 2, 2);
    });
    const vignettes = [...new Set(Object.values(VIGNETTES).flat(2))];
    vignettes.forEach((id, i) => {
        put1(id, 2 + (i % 100) * 2, y + 2 + Math.floor(i / 100) * 2);
    });
    Object.values(KIT_FENCES).forEach((id, i) => {
        ground.grid.locs.push({ id, type: 0, rotation: 0, level: 0, x: 20 + i * 2, y });
    });
    y += (Math.ceil(vignettes.length / 100) + 1) * 2;
    // Set pieces, each on a row of its own: they're big
    let x = 2;
    for (const piece of Object.values(SET_PIECES)) {
        for (const [id, sizeX, sizeY] of getPieceLocs(piece)) {
            if (x + sizeX + 1 >= SIZE) {
                x = 2;
                y += PIECE_ROW;
            }
            ground.place({ id, type: 10, rotation: 0, level: 0, x, y }, sizeX, sizeY);
            x += sizeX + 1;
        }
    }
    // City walls, all there is of each
    y += PIECE_ROW + WALL_PIECE;
    x = WALL_PIECE;
    for (const kit of Object.values(CITY_WALLS)) {
        const at = x + (WALL_PIECE >> 1);
        placeCityWall(ground, kit, { x0: x, y0: y, x1: x + WALL_PIECE, y1: y + WALL_PIECE }, [
            { side: "south", at },
        ]);
        x += WALL_PIECE * 2;
        if (x + WALL_PIECE * 2 >= SIZE) {
            x = WALL_PIECE;
            y += WALL_PIECE * 2;
        }
    }
    return ground.grid;
}

export const PALETTE_RECIPE: MapRecipe = {
    id: "scaperune_palette",
    mapX: 92,
    mapY: 104,
    squaresX: SQUARES,
    squaresY: SQUARES,
    margin: 0,
    spawn: { x: SIZE - 20, y: SIZE - 20 },
    build,
};
