import { BIOMES, BiomeId } from "./biomes";
import { CITY_WALL_IDS, CityWallId } from "./cityWalls";
import type { Rng } from "./noise";

// Everything the generator can be told, in one place: the map generator's screen,
// the checks and the error messages are all built from SETTINGS.

export type BoundaryStyle = "sea" | "forest" | "hills" | "fence" | "mountains";
export type RoadStyle = "branching" | "ring" | "spine";
export type WaveSet =
    | "lumbridge"
    | "barrows"
    | "wilderness"
    | "desert"
    | "fremennik"
    | "karamja"
    | "kourend"
    | "varlamore"
    | "morytania";

export type GeneratorSettings = {
    seed: number;

    // World. Arena size in map squares (64 tiles).
    squaresX: number;
    squaresY: number;
    biome: BiomeId;
    // Another biome sharing the map, biomeMix of it
    secondBiome: BiomeId | "none";
    biomeMix: number;
    // What stops you at the arena's edge. Only "sea" is an island.
    boundary: BoundaryStyle;
    // With a sea: 0 is land to the arena's edge, 1 a small island
    island: number;
    // Tiles the boundary comes into the arena
    boundaryDepth: number;
    shoreRoughness: number;

    // Terrain
    // 0 is flat; 1 is big rolling hills
    hills: number;
    // Tiles from one hill to the next
    hillScale: number;
    // Floods the low ground: 0 is none, 1 drowns most of the map
    waterLevel: number;
    groundPatches: number;

    // Mountains
    // Share of the map that's mountain: 0 is none, 1 is most of it
    mountains: number;
    // How high the tallest of them gets, in height units: 255 is all there is
    peakHeight: number;
    // Tiles from one ridge to the next
    ridgeScale: number;
    // 0 is smooth domes; 1 is sharp crests with lots of small ridges
    ruggedness: number;
    // 0 is straight ranges; 1 is ranges and ridges bent about
    warp: number;
    // 0 is an even climb; 1 is ledges with cliffs between
    terraces: number;
    // How much of open ground lies flat on levels, with the height in short ramps between them
    flatness: number;
    // How tall a ledge's cliff is, in height units
    terraceHeight: number;
    // The steepest ground you can walk on, in height units a tile. 16 is 45 degrees.
    walkSlope: number;
    // How much of the rock on cliffs gets heaps and facets
    rockFaces: number;
    // Rock lying about on the mountains
    rubble: number;
    // Where snow starts: 0 is none, 1 is only the very tops, below that lower down
    snow: number;
    // Tiles across a pass between pieces of ground cut off from each other
    passWidth: number;
    // A height for the arena from an image, in place of hills and ranges: a square of bytes
    // as base64, as encodeHeightmap makes it. Empty for none.
    heightmap: string;
    plateaus: number;
    mesas: number;
    canyons: number;
    // Tiles across a canyon's floor
    canyonWidth: number;
    volcanoes: number;
    // Cave mouths in cliffs that face you, for looks
    caves: number;

    // Water
    rivers: number;
    riverWidth: number;
    // 0 is a sheer gorge; 1 is a wide valley
    riverValley: number;
    // How much of rivers' fall comes down in waterfalls
    waterfalls: number;
    // Waterfalls off cliffs that face you, into pools
    cliffFalls: number;
    lakes: number;
    ponds: number;

    // Scenery. 0 to 1, from none to crowded.
    trees: number;
    // 0 is spread evenly; 1 is thick woods with clearings
    treeClumping: number;
    // 0 is small trees only; 1 is big trees only
    treeMix: number;
    rocks: number;
    rockMix: number;
    grass: number;
    // How much of the small things real ground has on it, by floor, on all the land
    dressing: number;
    flowers: number;
    // Big things that stand about: a biome's own boulders, plants and bones
    props: number;

    // Roads
    // 0 is none; 1 is a road to every building and bridge
    roads: number;
    roadStyle: RoadStyle;
    roadWidth: number;
    roadCurviness: number;

    // Settlements
    buildings: number;
    // How many places buildings gather; 0 spreads them all over
    // How much a map gathers into places about 50 tiles apart, with quiet land between
    sites: number;
    towns: number;
    // Tiles from a town's middle to its edge
    townSize: number;
    // How close together a town's side streets run: 0 has none, and past 0.6 they've lanes too
    sideStreets: number;
    houses: boolean;
    shops: boolean;
    churches: boolean;
    // Buildings from any biome, not only this one's
    anyBuildings: boolean;
    // Fenced yards round buildings
    gardens: number;
    ruins: number;
    // A biome's set pieces: stone circles, wrecks, giant mushrooms
    landmarks: number;
    // Share of towns with a wall round them
    townWalls: number;
    // Which real city's wall they have. On auto, one that suits a town's buildings or biome.
    wallKit: "auto" | CityWallId;
    // Old stones along the roads: 1 is one every 16 tiles
    waymarkers: number;

    // Play
    // Where you start, across and up the arena, 0 to 1
    spawnX: number;
    spawnY: number;
    waveSet: WaveSet;
    enemyDensity: number;
    // 1 is as the game is; lower is darker
    brightness: number;
};

export type SettingKey = Exclude<keyof GeneratorSettings, "seed">;

type Shown = { when?: (settings: GeneratorSettings) => boolean };
export type NumberSettingDef = Shown & {
    kind: "number";
    label: string;
    min: number;
    max: number;
    step: number;
};
export type ChoiceSettingDef = Shown & { kind: "choice"; label: string; options: string[] };
export type FlagSettingDef = Shown & { kind: "flag"; label: string };
export type HeightmapSettingDef = Shown & { kind: "heightmap"; label: string };
export type SettingDef = NumberSettingDef | ChoiceSettingDef | FlagSettingDef | HeightmapSettingDef;

function number(label: string, min: number, max: number, step: number, more?: Shown) {
    return { kind: "number", label, min, max, step, ...more } as const;
}

function share(label: string, more?: Shown) {
    return number(label, 0, 1, 0.05, more);
}

function choice(label: string, options: string[], more?: Shown) {
    return { kind: "choice", label, options, ...more } as const;
}

function flag(label: string, more?: Shown) {
    return { kind: "flag", label, ...more } as const;
}

// The biggest arena: with a square of scenery each side, that's map squares x 70 to 99,
// and nothing past x 100 loads (MapManager). Bigger than SLOW takes a while to build.
export const MAX_ARENA_SQUARES = 28;
export const SLOW_ARENA_SQUARES = 16;

// A heightmap's a square of this many bytes a side
export const HEIGHTMAP_SIZE = 129;

const hasBuildings = (settings: GeneratorSettings) => settings.buildings > 0;
const hasRoads = (settings: GeneratorSettings) => settings.roads > 0;
const notSea = (settings: GeneratorSettings) => settings.boundary !== "sea";
const hasMountains = (settings: GeneratorSettings) =>
    settings.mountains > 0 || settings.boundary === "mountains";
const hasRock = (settings: GeneratorSettings) =>
    hasMountains(settings) ||
    settings.heightmap !== "" ||
    settings.plateaus > 0 ||
    settings.mesas > 0 ||
    settings.canyons > 0 ||
    settings.volcanoes > 0;

const BIOME_IDS = Object.keys(BIOMES);

export const SETTINGS: Record<SettingKey, SettingDef> = {
    squaresX: number("Width (map squares)", 1, MAX_ARENA_SQUARES, 1),
    squaresY: number("Height (map squares)", 1, MAX_ARENA_SQUARES, 1),
    biome: choice("Biome", BIOME_IDS),
    secondBiome: choice("Second biome", ["none", ...BIOME_IDS]),
    biomeMix: share("Second biome's share", { when: (s) => s.secondBiome !== "none" }),
    boundary: choice("Boundary", ["sea", "forest", "hills", "fence", "mountains"]),
    island: share("Sea coming in", { when: (s) => s.boundary === "sea" }),
    boundaryDepth: number("Boundary depth", 2, 32, 1, { when: notSea }),
    shoreRoughness: share("Shore roughness"),

    flatness: share("Flat land"),
    hills: share("Hills"),
    hillScale: number("Hill spacing", 10, 80, 2),
    waterLevel: share("Water level"),
    groundPatches: number("Ground patch size", 5, 40, 1),

    mountains: share("Mountains"),
    peakHeight: number("Peak height", 60, 255, 5, { when: hasMountains }),
    ridgeScale: number("Ridge spacing", 20, 120, 2, { when: hasMountains }),
    ruggedness: share("Ruggedness", { when: hasMountains }),
    warp: share("Bend in the ranges", { when: hasMountains }),
    terraces: share("Terraces", { when: hasMountains }),
    terraceHeight: number("Ledge height", 12, 60, 2, {
        when: (s) => hasMountains(s) && s.terraces > 0,
    }),
    walkSlope: number("Steepest walkable slope", 8, 16, 1),
    rockFaces: share("Rock on cliffs", { when: hasRock }),
    rubble: share("Rubble", { when: hasRock }),
    snow: share("Snow", { when: hasRock }),
    passWidth: number("Pass width", 3, 12, 1, { when: hasRock }),
    heightmap: { kind: "heightmap", label: "Heightmap image" },
    plateaus: number("Plateaus", 0, 6, 1),
    mesas: number("Mesas", 0, 12, 1),
    canyons: number("Canyons", 0, 3, 1),
    canyonWidth: number("Canyon width", 3, 16, 1, { when: (s) => s.canyons > 0 }),
    volcanoes: number("Volcanoes", 0, 2, 1),
    caves: share("Caves", { when: hasRock }),

    rivers: number("Rivers", 0, 4, 1),
    riverWidth: number("River width", 4, 20, 1, { when: (s) => s.rivers > 0 }),
    riverValley: share("River valleys", { when: (s) => s.rivers > 0 }),
    waterfalls: share("Waterfalls", { when: (s) => s.rivers > 0 && hasRock(s) }),
    cliffFalls: share("Cliff waterfalls", { when: hasRock }),
    lakes: number("Lakes", 0, 8, 1),
    ponds: number("Ponds", 0, 16, 1),

    trees: share("Trees"),
    treeClumping: share("Tree clumping", { when: (s) => s.trees > 0 }),
    treeMix: share("Tree size", { when: (s) => s.trees > 0 }),
    rocks: share("Rocks"),
    rockMix: share("Rock size", { when: (s) => s.rocks > 0 }),
    grass: share("Grass"),
    dressing: share("Ground dressing"),
    flowers: share("Flowers"),
    props: share("Big scenery"),

    roads: share("Roads"),
    roadStyle: choice("Road network", ["branching", "ring", "spine"], { when: hasRoads }),
    roadWidth: number("Road width", 2, 6, 0.2, { when: hasRoads }),
    roadCurviness: share("Road curviness", { when: hasRoads }),

    buildings: share("Buildings"),
    sites: share("Gathered places"),
    towns: number("Towns", 0, 8, 1, { when: hasBuildings }),
    townSize: number("Town size", 10, 60, 2, { when: (s) => s.buildings > 0 && s.towns > 0 }),
    houses: flag("Houses", { when: hasBuildings }),
    shops: flag("Shops", { when: hasBuildings }),
    churches: flag("Churches", { when: hasBuildings }),
    anyBuildings: flag("Buildings from any biome", { when: hasBuildings }),
    gardens: share("Fenced yards", { when: hasBuildings }),
    ruins: share("Ruins"),
    landmarks: share("Landmarks"),
    townWalls: share("Town walls", { when: (s) => s.towns > 0 && s.buildings > 0 }),
    waymarkers: share("Waymarkers", { when: hasRoads }),

    spawnX: share("Start, west to east"),
    spawnY: share("Start, south to north"),
    waveSet: choice("Waves from", [
        "lumbridge",
        "barrows",
        "wilderness",
        "desert",
        "fremennik",
        "karamja",
        "kourend",
        "varlamore",
        "morytania",
    ]),
    enemyDensity: number("Enemy density", 0.25, 3, 0.25),
    brightness: number("Brightness", 0.5, 1.2, 0.05),
    // Last, so that Randomize's rolls for the rest stay as they were. The screen goes by SECTIONS.
    wallKit: choice("Wall from", ["auto", ...CITY_WALL_IDS], {
        when: (s) => s.towns > 0 && s.buildings > 0 && s.townWalls > 0,
    }),
    sideStreets: share("Side streets", { when: (s) => s.towns > 0 && s.roads > 0 }),
};

// In the order the screen shows them
export const SETTING_SECTIONS: { name: string; keys: SettingKey[] }[] = [
    {
        name: "World",
        keys: [
            "squaresX",
            "squaresY",
            "biome",
            "secondBiome",
            "biomeMix",
            "boundary",
            "island",
            "boundaryDepth",
            "shoreRoughness",
        ],
    },
    {
        name: "Terrain",
        keys: ["hills", "hillScale", "flatness", "waterLevel", "groundPatches", "walkSlope"],
    },
    {
        name: "Mountains",
        keys: [
            "mountains",
            "peakHeight",
            "ridgeScale",
            "ruggedness",
            "warp",
            "terraces",
            "terraceHeight",
            "rockFaces",
            "rubble",
            "snow",
            "passWidth",
            "heightmap",
            "plateaus",
            "mesas",
            "canyons",
            "canyonWidth",
            "volcanoes",
            "caves",
        ],
    },
    {
        name: "Water",
        keys: ["rivers", "riverWidth", "riverValley", "waterfalls", "cliffFalls", "lakes", "ponds"],
    },
    {
        name: "Scenery",
        keys: [
            "trees",
            "treeClumping",
            "treeMix",
            "rocks",
            "rockMix",
            "grass",
            "dressing",
            "flowers",
            "props",
        ],
    },
    { name: "Roads", keys: ["roads", "roadStyle", "roadWidth", "roadCurviness"] },
    {
        name: "Settlements",
        keys: [
            "buildings",
            "sites",
            "towns",
            "townSize",
            "sideStreets",
            "houses",
            "shops",
            "churches",
            "anyBuildings",
            "gardens",
            "ruins",
            "landmarks",
            "townWalls",
            "wallKit",
            "waymarkers",
        ],
    },
    { name: "Play", keys: ["spawnX", "spawnY", "waveSet", "enemyDensity", "brightness"] },
];

export const DEFAULT_SETTINGS: Omit<GeneratorSettings, "seed"> = {
    squaresX: 2,
    squaresY: 2,
    biome: "meadow",
    secondBiome: "none",
    biomeMix: 0.4,
    boundary: "sea",
    island: 0.3,
    boundaryDepth: 10,
    shoreRoughness: 0.4,

    hills: 0.5,
    hillScale: 28,
    waterLevel: 0,
    groundPatches: 14,

    mountains: 0,
    peakHeight: 200,
    ridgeScale: 44,
    ruggedness: 0.5,
    warp: 0.5,
    terraces: 0.75,
    flatness: 0.75,
    terraceHeight: 30,
    walkSlope: 12,
    rockFaces: 1,
    rubble: 0.5,
    snow: 0,
    passWidth: 6,
    heightmap: "",
    plateaus: 0,
    mesas: 0,
    canyons: 0,
    canyonWidth: 8,
    volcanoes: 0,
    caves: 0.3,

    rivers: 0,
    riverWidth: 9,
    riverValley: 0.6,
    waterfalls: 0.5,
    cliffFalls: 0.4,
    lakes: 0,
    ponds: 1,

    trees: 0.5,
    treeClumping: 0.6,
    treeMix: 0.5,
    rocks: 0.4,
    rockMix: 0.5,
    grass: 0.5,
    dressing: 1,
    flowers: 0.2,
    props: 0.4,

    roads: 0.8,
    roadStyle: "branching",
    roadWidth: 2.4,
    roadCurviness: 0.4,

    buildings: 0.5,
    sites: 1,
    towns: 0,
    townSize: 30,
    sideStreets: 0.5,
    houses: true,
    shops: true,
    churches: true,
    anyBuildings: false,
    gardens: 0,
    ruins: 0,
    landmarks: 0.3,
    townWalls: 0,
    wallKit: "auto",
    waymarkers: 0,

    spawnX: 0.5,
    spawnY: 0.5,
    waveSet: "lumbridge",
    enemyDensity: 1,
    brightness: 1,
};

// Starting points, laid over the defaults: the seed stays what it was
export const SETTING_PRESETS: Record<string, Partial<GeneratorSettings>> = {
    Forest: {
        squaresX: 3,
        squaresY: 3,
        boundary: "forest",
        trees: 1,
        treeClumping: 0.8,
        treeMix: 0.7,
        buildings: 0.2,
        roads: 0.5,
        roadCurviness: 0.8,
        hills: 0.4,
        ponds: 3,
        brightness: 0.85,
    },
    Archipelago: {
        squaresX: 4,
        squaresY: 4,
        boundary: "sea",
        island: 0.1,
        waterLevel: 0.55,
        hills: 0.7,
        hillScale: 44,
        shoreRoughness: 0.7,
        trees: 0.5,
        buildings: 0.3,
        ponds: 0,
    },
    Mountains: {
        squaresX: 3,
        squaresY: 3,
        biome: "snow",
        boundary: "mountains",
        boundaryDepth: 10,
        mountains: 0.6,
        snow: 0.6,
        rocks: 0.6,
        trees: 0.4,
        buildings: 0.15,
        rivers: 1,
    },
    Alpine: {
        squaresX: 4,
        squaresY: 4,
        boundary: "mountains",
        boundaryDepth: 8,
        mountains: 0.75,
        peakHeight: 245,
        ridgeScale: 46,
        ruggedness: 0.7,
        snow: 0.55,
        rivers: 1,
        riverValley: 0.7,
        trees: 0.6,
        roads: 1,
        buildings: 0.25,
        towns: 1,
        townSize: 24,
    },
    Highlands: {
        squaresX: 4,
        squaresY: 4,
        boundary: "forest",
        mountains: 0.45,
        peakHeight: 170,
        ruggedness: 0.35,
        terraces: 0.9,
        terraceHeight: 24,
        rivers: 2,
        riverValley: 0.9,
        lakes: 1,
        trees: 0.7,
        roads: 1,
        buildings: 0.3,
    },
    Canyon: {
        squaresX: 4,
        squaresY: 4,
        biome: "desert",
        boundary: "mountains",
        boundaryDepth: 6,
        hills: 0.15,
        peakHeight: 150,
        canyons: 3,
        canyonWidth: 10,
        mesas: 8,
        plateaus: 2,
        trees: 0.1,
        rocks: 0.6,
        rubble: 0.8,
        ponds: 0,
        roads: 0.6,
        buildings: 0.2,
    },
    Volcano: {
        squaresX: 3,
        squaresY: 3,
        biome: "swamp",
        island: 0.2,
        volcanoes: 1,
        mountains: 0.2,
        peakHeight: 130,
        rubble: 1,
        trees: 0.5,
        ponds: 0,
        buildings: 0.2,
    },
    Valley: {
        squaresX: 3,
        squaresY: 3,
        boundary: "mountains",
        boundaryDepth: 16,
        lakes: 1,
        ponds: 0,
        rivers: 1,
        hills: 0.3,
        buildings: 0.5,
        towns: 1,
        roads: 1,
        trees: 0.5,
    },
    Town: {
        squaresX: 3,
        squaresY: 3,
        boundary: "fence",
        buildings: 1,
        towns: 2,
        townSize: 34,
        sideStreets: 0.8,
        townWalls: 1,
        waymarkers: 0.6,
        roads: 1,
        roadStyle: "ring",
        gardens: 0.6,
        hills: 0.15,
        trees: 0.25,
        flowers: 0.6,
    },
    "Walled city": {
        squaresX: 4,
        squaresY: 4,
        boundary: "forest",
        hills: 0.15,
        towns: 1,
        townSize: 52,
        townWalls: 1,
        wallKit: "falador",
        sideStreets: 0.8,
        buildings: 0.8,
        roads: 1,
        waymarkers: 0.5,
        gardens: 0.25,
        trees: 0.4,
        landmarks: 0.1,
        ponds: 0,
    },
    Jungle: {
        waveSet: "karamja",
        squaresX: 3,
        squaresY: 3,
        biome: "jungle",
        boundary: "forest",
        trees: 0.9,
        treeClumping: 0.5,
        treeMix: 0.6,
        hills: 0.35,
        rivers: 1,
        grass: 0.9,
        flowers: 0.6,
        props: 0.8,
        buildings: 0.25,
        towns: 1,
        townSize: 20,
        roads: 0.7,
    },
    "Tropical islands": {
        waveSet: "karamja",
        squaresX: 4,
        squaresY: 4,
        biome: "tropical",
        island: 0.1,
        waterLevel: 0.5,
        hills: 0.6,
        hillScale: 44,
        shoreRoughness: 0.7,
        trees: 0.35,
        treeClumping: 0.3,
        ponds: 0,
        buildings: 0.2,
        props: 0.6,
    },
    Ashlands: {
        waveSet: "wilderness",
        squaresX: 3,
        squaresY: 3,
        biome: "ash",
        boundary: "mountains",
        boundaryDepth: 8,
        volcanoes: 1,
        peakHeight: 140,
        hills: 0.4,
        rivers: 2,
        lakes: 2,
        ponds: 2,
        trees: 0.25,
        rocks: 0.7,
        rubble: 1,
        props: 0.7,
        buildings: 0.15,
    },
    Autumn: {
        waveSet: "kourend",
        squaresX: 3,
        squaresY: 3,
        biome: "autumn",
        boundary: "forest",
        trees: 0.8,
        treeClumping: 0.7,
        hills: 0.5,
        rivers: 1,
        ponds: 2,
        flowers: 0.5,
        buildings: 0.4,
        towns: 1,
        townSize: 24,
    },
    "Dead lands": {
        waveSet: "morytania",
        squaresX: 3,
        squaresY: 3,
        biome: "deadlands",
        boundary: "hills",
        hills: 0.4,
        ponds: 4,
        trees: 0.5,
        buildings: 0.3,
        ruins: 0.6,
        props: 0.7,
    },
    Elven: {
        waveSet: "varlamore",
        squaresX: 3,
        squaresY: 3,
        biome: "elven",
        boundary: "forest",
        trees: 0.55,
        treeClumping: 0.45,
        treeMix: 0.6,
        lakes: 1,
        rivers: 1,
        flowers: 0.5,
        buildings: 0.4,
        towns: 1,
        townSize: 22,
        roads: 1,
    },
    Fairy: {
        squaresX: 3,
        squaresY: 3,
        biome: "fairy",
        trees: 0.5,
        flowers: 1,
        grass: 0.8,
        props: 0.8,
        buildings: 0,
        ruins: 0.4,
    },
    "Sky islands": {
        waveSet: "fremennik",
        squaresX: 3,
        squaresY: 3,
        biome: "astral",
        island: 0.3,
        shoreRoughness: 1,
        hills: 0.3,
        ponds: 0,
        trees: 0.35,
        flowers: 0.5,
        landmarks: 0.6,
        buildings: 0.3,
    },
    Darkwood: {
        waveSet: "barrows",
        squaresX: 3,
        squaresY: 3,
        biome: "darkwood",
        boundary: "forest",
        trees: 1,
        treeClumping: 0.7,
        treeMix: 0.6,
        ponds: 2,
        ruins: 0.4,
        buildings: 0.1,
        props: 0.8,
    },
};

// What Randomize leaves as it is: the map's size, which is what makes one slow to build, an
// uploaded image, and how a run plays rather than how the map looks
const KEPT_BY_RANDOM: readonly SettingKey[] = [
    "squaresX",
    "dressing",
    "flatness",
    "sites",
    "sideStreets",
    "squaresY",
    "heightmap",
    "spawnX",
    "spawnY",
    "waveSet",
    "enemyDensity",
    "brightness",
];

// What Randomize leaves out half the time, or every map would be the same crowded mix of them
const SOMETIMES_NONE: readonly SettingKey[] = [
    "secondBiome",
    "waterLevel",
    "mountains",
    "plateaus",
    "mesas",
    "canyons",
    "volcanoes",
    "rivers",
    "lakes",
    "towns",
];

// The most Randomize picks where the full range mostly leaves too little ground to play on
const RANDOM_MOST: Partial<Record<SettingKey, number>> = {
    waterLevel: 0.4,
    island: 0.6,
    boundaryDepth: 16,
    plateaus: 3,
    mesas: 6,
    volcanoes: 1,
    rivers: 3,
    lakes: 4,
};

// Every setting rolled within its limits, so a new setting joins in by being in the table
export function randomSettings(settings: GeneratorSettings, roll: Rng): GeneratorSettings {
    const next: Record<string, unknown> = { ...settings };
    for (const [key, def] of Object.entries(SETTINGS) as [SettingKey, SettingDef][]) {
        if (KEPT_BY_RANDOM.includes(key) || def.kind === "heightmap") {
            continue;
        }
        const none = SOMETIMES_NONE.includes(key) && roll() < 0.5;
        if (def.kind === "flag") {
            next[key] = roll() < 0.5;
        } else if (def.kind === "choice") {
            next[key] = none ? "none" : def.options[Math.floor(roll() * def.options.length)];
        } else {
            const most = RANDOM_MOST[key] ?? def.max;
            const steps = Math.floor(roll() * (Math.round((most - def.min) / def.step) + 1));
            next[key] = none ? 0 : Number((def.min + steps * def.step).toFixed(2));
        }
    }
    return next as GeneratorSettings;
}

// A heightmap as a setting: bytes, a row at a time, HEIGHTMAP_SIZE a side
export function encodeHeightmap(heights: Uint8Array): string {
    return btoa(String.fromCharCode(...heights));
}

// A heightmap's bytes, or undefined if it isn't one
export function decodeHeightmap(text: string): Uint8Array | undefined {
    try {
        const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
        return bytes.length === HEIGHTMAP_SIZE * HEIGHTMAP_SIZE ? bytes : undefined;
    } catch {
        return undefined;
    }
}

// What's wrong with some settings, or undefined
export function getSettingsError(settings: GeneratorSettings): string | undefined {
    if (!Number.isInteger(settings.seed) || settings.seed < 0) {
        return "The seed must be a whole number, 0 or more.";
    }
    for (const [key, def] of Object.entries(SETTINGS)) {
        const value = settings[key as SettingKey];
        if (def.kind === "flag") {
            if (typeof value !== "boolean") {
                return `${def.label} must be on or off.`;
            }
        } else if (def.kind === "choice") {
            if (!def.options.includes(String(value))) {
                return `${def.label} can't be ${String(value)}.`;
            }
        } else if (def.kind === "heightmap") {
            if (typeof value !== "string" || (value !== "" && !decodeHeightmap(value))) {
                return `${def.label} isn't a heightmap.`;
            }
        } else {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return `${def.label} must be a number.`;
            }
            if (value < def.min || value > def.max) {
                return `${def.label} must be from ${def.min} to ${def.max}.`;
            }
            if (def.step === 1 && !Number.isInteger(value)) {
                return `${def.label} must be a whole number.`;
            }
        }
    }
    return undefined;
}

// Settings as text, to save and share a map
export function formatSettings(settings: GeneratorSettings): string {
    return JSON.stringify(settings);
}

// Settings from text: anything left out is the default. Throws, with something to
// show, if they're not settings.
export function parseSettings(text: string): GeneratorSettings {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("That isn't valid JSON.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Those aren't map settings.");
    }
    for (const key of Object.keys(parsed)) {
        if (key !== "seed" && !(key in SETTINGS)) {
            throw new Error(`There's no setting called ${key}.`);
        }
    }
    const settings = { seed: 1, ...DEFAULT_SETTINGS, ...parsed } as GeneratorSettings;
    const error = getSettingsError(settings);
    if (error) {
        throw new Error(error);
    }
    return settings;
}
