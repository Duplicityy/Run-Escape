import {
    DEFAULT_SETTINGS,
    GeneratorSettings,
    SETTING_PRESETS,
    generatedRecipe,
} from "../generator";
import { PALETTE_RECIPE } from "../palette";
import { MapRecipe } from "../recipe";
import { CLIFF_GALLERY } from "./cliffGallery";
import { KALUAS_WAKE } from "./kaluasWake";
import { PREFAB_GALLERY } from "./prefabGallery";
import { ROCK_SHEET } from "./rockSheet";
import { SHATTERED_REALM } from "./shatteredRealm";
import { TERRAIN_TEST } from "./terrainTest";
import { VARDHELM } from "./vardhelm";
import { WALL_SHEET } from "./wallSheet";

// Maps for development, shown on the dev server only (content/maps.ts). Each
// needs its own squares: nothing in the cache lives at x 70-99, y 66-199, and the
// map generator's screen has x 70-99 from y 134 on.
type GeneratedLine = [
    id: string,
    mapX: number,
    settings: Partial<GeneratorSettings>,
    mapY?: number,
];

const GENERATED: GeneratedLine[] = [
    ["scaperune_meadow", 71, { seed: 1, biome: "meadow", island: 0.35, rivers: 1, ponds: 2 }],
    [
        "scaperune_desert",
        76,
        {
            seed: 2,
            biome: "desert",
            boundary: "hills",
            ponds: 1,
            hills: 0.3,
            trees: 0.25,
            rocks: 0.6,
        },
    ],
    [
        "scaperune_swamp",
        81,
        {
            seed: 3,
            biome: "swamp",
            island: 0.15,
            rivers: 2,
            ponds: 6,
            hills: 0.1,
            trees: 0.7,
            buildings: 0.3,
        },
    ],
    [
        "scaperune_snow",
        86,
        {
            seed: 4,
            biome: "snow",
            squaresX: 3,
            squaresY: 3,
            island: 0.5,
            rivers: 1,
            ponds: 1,
            hills: 0.8,
        },
    ],
    [
        "scaperune_alpine",
        71,
        {
            seed: 3,
            squaresX: 3,
            squaresY: 3,
            mountains: 0.7,
            peakHeight: 240,
            boundary: "mountains",
            boundaryDepth: 8,
            rivers: 1,
            snow: 0.5,
            roads: 1,
            buildings: 0.3,
            trees: 0.7,
        },
        110,
    ],
    ["scaperune_canyon", 76, { seed: 5, ...SETTING_PRESETS.Canyon, squaresX: 3, squaresY: 3 }, 110],
    ["scaperune_volcano", 81, { seed: 6, ...SETTING_PRESETS.Volcano }, 110],
    ["scaperune_town", 93, { seed: 3, ...SETTING_PRESETS.Town, wallKit: "varrock" }, 180],
    ["scaperune_city", 72, { seed: 2, ...SETTING_PRESETS["Walled city"] }, 190],
    // A map of each newer biome, 2 squares a side
    ...(
        [
            ["jungle", "Jungle", 71, 124],
            ["tropical", "Tropical islands", 75, 124],
            ["ash", "Ashlands", 79, 124],
            ["autumn", "Autumn", 83, 124],
            ["deadlands", "Dead lands", 71, 128],
            ["elven", "Elven", 75, 128],
            ["fairy", "Fairy", 79, 128],
            ["darkwood", "Darkwood", 83, 128],
            ["astral", "Sky islands", 87, 124],
        ] as const
    ).map(
        ([id, preset, mapX, mapY], i): GeneratedLine => [
            `scaperune_${id}`,
            mapX,
            { seed: 30 + i, ...SETTING_PRESETS[preset], squaresX: 2, squaresY: 2 },
            mapY,
        ],
    ),
];

export const DEV_MAP_SETTINGS: Record<string, GeneratorSettings> = Object.fromEntries(
    GENERATED.map(([id, , settings]) => [
        id,
        { seed: 1, ...DEFAULT_SETTINGS, ...settings } as GeneratorSettings,
    ]),
);

export const SCAPERUNE_DEV_MAPS: MapRecipe[] = [
    TERRAIN_TEST,
    ...GENERATED.map(([id, mapX, , mapY]) =>
        generatedRecipe(id, mapX, mapY ?? 104, DEV_MAP_SETTINGS[id]),
    ),
    PALETTE_RECIPE,
    PREFAB_GALLERY,
    CLIFF_GALLERY,
    ROCK_SHEET,
    WALL_SHEET,
    VARDHELM,
    KALUAS_WAKE,
    SHATTERED_REALM,
];
