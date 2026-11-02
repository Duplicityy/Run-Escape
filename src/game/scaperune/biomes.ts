// What each kind of ground is made of, taken from the real squares that kind of
// ground is on (see CLAUDE.md for how to survey one). Floor ids are as the map
// files store them: the cache's id plus one.

export type BiomeId =
    | "meadow"
    | "desert"
    | "swamp"
    | "snow"
    | "jungle"
    | "tropical"
    | "ash"
    | "autumn"
    | "deadlands"
    | "elven"
    | "fairy"
    | "darkwood"
    | "astral";

// What mountains are made of. See CLAUDE.md for how these were picked.
export type RockDef = {
    // Underlay on the mountains, and overlay on what's too steep to walk
    ground: number;
    overlay: number;
    // Small stones on rock's own tiles (loc type 22)
    pebbles: number[];
    // A full tile of contoured rock, turned at random, as a carpet over what's near a face.
    // Only on a dark overlay of their own: on anything else they read as shards.
    facets?: number[];
    // Low heaps of rock, [loc id, tiles a side], that block
    rubble: [number, number][];
    // Stones on the ground (loc type 22)
    stones: number[];
    // Underlay above the snow line, where cliffs have no overlay: none of them is as white
    snowGround: number;
    // What fills a volcano's crater, blocked
    lava: number;
    // A cave's mouth, 3 by 2 tiles, turned to face south at rotation 0
    cave: number;
};

export type BiomeDef = {
    // Underlays, picked in patches
    ground: number[];
    // Underlay by the sea and on fords
    shore: number;
    // Underlay where the ground rises into boundary hills
    hillGround: number;
    // Underlay under a road, which the renderer blends softly into the ground. Real
    // roads have one under them too.
    trail: number;
    // Overlays
    road: number;
    // Overlay for a town's paving, if it's not the usual
    paving?: number;
    water: number;
    // [loc id, tiles a side], smallest first
    trees: [number, number][];
    rocks: [number, number][];
    // Small floor decorations (loc type 22)
    decor: number[];
    // Small things in a splash of colour (loc type 10)
    flowers: number[];
    // Big things that stand about now and then, [loc id, tiles a side]
    props: [number, number][];
    // Keys of PREFABS
    buildings: string[];
    // Keys of PREFABS that lie in ruins here. buildings if there's none.
    ruins?: string[];
    // Keys of SET_PIECES (structures.ts)
    landmarks: string[];
    // Keys of BRIDGES
    bridge: string;
    // Walls (loc type 0): round yards and the map, round towns, and a stone by the road
    fence: number;
    wall: number;
    marker: number;
    rock: RockDef;
    // Its water's lava, or anything else that doesn't fall in foam
    molten?: boolean;
    // Its sea's a drop: the land stops at a cliff rather than a beach
    chasm?: boolean;
};

// Foam at the foot of a waterfall, 3 tiles wide with rotation 0 running east to west
export const WATERFALL = 26499;
// Waterfalls 3 tiles wide, foam and all, 65 and 33 units tall on flat ground. See falls.ts.
export const CLIFF_FALL = 51484;
export const LOW_FALL = 44632;
// Lava, as in Karamja's volcano
const LAVA = 19;
// Snow on any mountain, from Ice Mountain and Trollweiss
const SNOW = 58;

// Hosidius's grey, for towns where warm stone would look wrong
const DARK_PAVING = 10;

// What's on cliffs above the snow line, whatever the biome
export const SNOW_ROCK: Pick<RockDef, "pebbles" | "rubble"> = {
    pebbles: [559, 560, 561],
    rubble: [
        [11922, 2],
        [11434, 2],
    ],
};

function rock(def: Omit<RockDef, "snowGround" | "lava">): RockDef {
    return { ...def, snowGround: SNOW, lava: LAVA };
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
    // Around Lumbridge
    meadow: {
        ground: [48, 50, 49],
        shore: 62,
        hillGround: 64,
        trail: 63,
        road: 22,
        water: 6,
        trees: [
            [1276, 2],
            [1278, 2],
            [10820, 3],
        ],
        rocks: [
            [5605, 1],
            [10790, 2],
        ],
        decor: [4735, 4736, 4737, 4738],
        flowers: [1187, 1188, 1189],
        props: [
            [10790, 2],
            [11434, 2],
            [42407, 2],
            [3718, 2],
        ],
        buildings: ["lumbridge_house", "lumbridge_church", "varrock_shop"],
        // Trollheim's ground, with stone that takes the light
        landmarks: [
            "stone_circle",
            "farm",
            "market",
            "orchard",
            "shrine",
            "great_boulder",
            "redwoods",
            "hedge_maze",
            "fort",
            "shipwreck",
            "drowned_town",
        ],
        bridge: "stone",
        fence: 980,
        wall: 1902,
        marker: 34781,
        rock: rock({
            ground: 92,
            overlay: 83,
            pebbles: [3709, 3703, 3706, 3702],
            rubble: [
                [11434, 2],
                [11435, 2],
                [3718, 2],
            ],
            stones: [3614, 11439],
            cave: 2123,
        }),
    },
    // The Kharidian Desert
    desert: {
        ground: [62, 61],
        shore: 129,
        hillGround: 68,
        trail: 68,
        road: 25,
        water: 442,
        trees: [
            [1405, 2],
            [1406, 2],
            [2670, 1],
            [1123, 2],
        ],
        rocks: [
            [18895, 2],
            [18893, 2],
        ],
        decor: [729, 730, 341, 342],
        flowers: [2670, 44069, 44070, 44071],
        props: [
            [11100, 2],
            [11099, 2],
            [11101, 2],
            [6578, 2],
        ],
        buildings: [
            "al_kharid_house",
            "al_kharid_shop",
            "pollnivneach_house",
            "pollnivneach_inn",
            "pollnivneach_shop",
            "sophanem_fort",
        ],
        // The cliffs round the Bandit Camp
        landmarks: [
            "desert_circle",
            "market",
            "shrine",
            "great_skeleton",
            "beached_wreck",
            "fort",
            "shipwreck",
        ],
        bridge: "stone",
        fence: 1415,
        wall: 1415,
        marker: 10019,
        rock: rock({
            ground: 68,
            overlay: 26,
            pebbles: [330, 729, 10845, 331],
            rubble: [
                [18894, 2],
                [18893, 2],
                [51792, 2],
            ],
            stones: [321, 3171],
            cave: 30180,
        }),
    },
    // Lumbridge Swamp's ground: Mort Myre's is too dark to see enemies on. The
    // water and trees are Morytania's.
    swamp: {
        ground: [54, 64, 49],
        shore: 64,
        hillGround: 72,
        trail: 63,
        road: 81,
        water: 7,
        trees: [
            [12896, 1],
            [1365, 1],
            [1301, 2],
            [1304, 2],
        ],
        rocks: [
            [5605, 1],
            [10790, 2],
        ],
        decor: [5335, 5336, 5337, 5338, 3549],
        flowers: [1299, 1300, 4055, 4056, 4057],
        props: [
            [4057, 1],
            [10830, 2],
            [5331, 2],
        ],
        buildings: ["canifis_house", "burgh_house", "burgh_inn"],
        landmarks: ["toadstools", "mushroom_grove", "graveyard", "great_tree", "drowned_town"],
        bridge: "stone",
        fence: 9025,
        wall: 1855,
        marker: 34796,
        rock: rock({
            ground: 94,
            overlay: 102,
            pebbles: [5328, 5204, 5327, 5205],
            rubble: [
                [3718, 2],
                [4605, 2],
                [11933, 2],
            ],
            stones: [185, 3703],
            cave: 17209,
        }),
    },
    // Trollweiss
    snow: {
        ground: [58, 218, 59],
        shore: 59,
        hillGround: 55,
        // The snow itself: any tint in it shows as a coloured halo round the road
        trail: 58,
        road: 82,
        water: 547,
        trees: [
            [1330, 3],
            [1331, 3],
            [1332, 3],
        ],
        rocks: [
            [5039, 1],
            [19686, 2],
        ],
        decor: [561, 560, 559],
        // Blue ice showing through, in patches
        flowers: [60397, 60399, 60398, 60400, 60394, 60395, 60396, 60393, 60391, 60408],
        props: [
            [60404, 2],
            [60405, 2],
            [33178, 2],
            [33220, 2],
            [33215, 2],
            [19686, 2],
            [60406, 1],
        ],
        buildings: ["rellekka_hut", "rellekka_house"],
        landmarks: ["longship", "great_boulder", "stone_circle", "shrine", "fort"],
        bridge: "stone",
        fence: 4246,
        wall: 4246,
        marker: 34780,
        rock: rock({
            // Near the snow's own, as a dark rock bleeds a long way into white
            ground: 16,
            overlay: 3,
            pebbles: [11439, 336, 11438, 559],
            rubble: [
                [11922, 2],
                [11434, 2],
            ],
            stones: [11439, 3614],
            cave: 2123,
        }),
    },
    // Karamja's jungle, with the stumps from Varlamore's
    jungle: {
        ground: [48, 99, 100],
        shore: 62,
        hillGround: 64,
        trail: 63,
        road: 80,
        water: 442,
        trees: [
            [1326, 1],
            [4818, 1],
            [1304, 2],
            [13703, 2],
            [53188, 2],
            [51762, 2],
            [57511, 3],
            [57513, 3],
        ],
        rocks: [
            [3718, 2],
            [11434, 2],
        ],
        decor: [1241, 1242, 1228, 1243, 1226, 1225, 1224, 1229],
        flowers: [1184, 1186, 57805, 57812, 57813, 57541],
        props: [
            [1402, 2],
            [1400, 2],
            [1314, 3],
            [57544, 2],
        ],
        buildings: ["taibwo_hut", "taibwo_house", "taibwo_hall"],
        landmarks: ["great_stump", "idol", "market", "shipwreck", "drowned_town"],
        bridge: "timber",
        fence: 9025,
        wall: 1855,
        marker: 2975,
        rock: rock({
            ground: 97,
            overlay: 83,
            pebbles: [4340, 3709, 16823, 4341],
            rubble: [
                [3718, 2],
                [11434, 2],
            ],
            stones: [315, 320],
            cave: 2123,
        }),
    },
    // The islands Sailing went to
    tropical: {
        ground: [68, 52, 68],
        shore: 62,
        hillGround: 223,
        trail: 26,
        road: 227,
        water: 442,
        trees: [
            [58541, 1],
            [58542, 1],
            [58543, 1],
            [57792, 2],
            [57793, 2],
        ],
        rocks: [
            [51790, 2],
            [51791, 2],
        ],
        decor: [51810, 51811, 51812, 51813, 51815, 51814, 729],
        flowers: [57805, 57808, 42400],
        props: [
            [60454, 3],
            [60452, 2],
            [51792, 2],
            [57798, 2],
        ],
        buildings: ["ape_hut", "taibwo_hut", "taibwo_house"],
        landmarks: [
            "great_skeleton",
            "beached_wreck",
            "great_boulder",
            "shipwreck",
            "longship",
            "drowned_town",
        ],
        bridge: "timber",
        fence: 9025,
        wall: 1855,
        marker: 10019,
        rock: rock({
            ground: 223,
            overlay: 26,
            pebbles: [51814, 729, 51815],
            rubble: [
                [51790, 2],
                [51792, 2],
            ],
            stones: [729, 3171],
            cave: 30180,
        }),
    },
    // Fossil Island's ash and the Wilderness's ground, running with lava
    ash: {
        ground: [56, 145, 146],
        shore: 147,
        hillGround: 146,
        trail: 148,
        road: 99,
        paving: DARK_PAVING,
        water: LAVA,
        molten: true,
        trees: [
            [1289, 1],
            [40951, 1],
            [1282, 2],
            [40950, 2],
        ],
        rocks: [
            [14461, 2],
            [14462, 2],
        ],
        decor: [14460, 14457, 14483, 14501, 14502],
        flowers: [14438, 11967, 11851],
        props: [
            [14463, 2],
            [14461, 2],
            [11933, 2],
            [5952, 2],
        ],
        buildings: ["lovakengj_house", "lovakengj_hall", "shayzien_house"],
        landmarks: ["crater", "crater_field", "black_crystal", "shrine", "great_boulder"],
        bridge: "stone",
        fence: 39202,
        wall: 39400,
        marker: 34797,
        rock: rock({
            ground: 148,
            overlay: 115,
            pebbles: [34413, 34414, 34416, 20743],
            facets: [34384, 34385, 34387, 34391, 34392],
            rubble: [
                [14461, 2],
                [11933, 2],
            ],
            stones: [14502, 185],
            cave: 17209,
        }),
    },
    // Maples, with the ground gone over to gold
    autumn: {
        ground: [50, 49, 64],
        shore: 64,
        hillGround: 65,
        trail: 67,
        road: 81,
        water: 6,
        trees: [
            [10832, 2],
            [40754, 2],
            [1276, 2],
            [40754, 2],
        ],
        rocks: [
            [5605, 1],
            [55130, 2],
        ],
        decor: [51811, 51813, 51815, 51814, 325],
        flowers: [42400, 42401, 51086, 51822],
        props: [
            [42399, 2],
            [42407, 2],
            [55129, 2],
        ],
        buildings: ["hosidius_barn", "shayzien_house", "shayzien_shop"],
        landmarks: [
            "redwoods",
            "stone_circle",
            "farm",
            "orchard",
            "market",
            "great_boulder",
            "hedge_maze",
            "fort",
        ],
        bridge: "timber",
        fence: 980,
        wall: 17088,
        marker: 34781,
        rock: rock({
            ground: 92,
            overlay: 14,
            pebbles: [339, 338, 31777, 31778],
            rubble: [
                [55129, 2],
                [55130, 2],
            ],
            stones: [3614, 11439],
            cave: 2123,
        }),
    },
    // Morytania past the Salve: gone grey, with Darkmeyer standing on it
    deadlands: {
        ground: [97, 96, 92],
        shore: 96,
        hillGround: 98,
        trail: 97,
        road: 110,
        paving: DARK_PAVING,
        water: 7,
        trees: [
            [1289, 1],
            [14514, 1],
            [1282, 2],
            [1283, 2],
            [14513, 2],
        ],
        rocks: [
            [4605, 2],
            [11933, 2],
        ],
        decor: [3549, 3548, 3547, 12931, 5335],
        flowers: [4053, 1383, 404, 405, 401],
        props: [
            [4054, 3],
            [14533, 2],
            [4605, 2],
            [34796, 1],
        ],
        buildings: ["darkmeyer_house", "darkmeyer_hall", "darkmeyer_shop", "burgh_house"],
        ruins: ["burgh_house", "burgh_inn", "darkmeyer_house"],
        landmarks: ["graveyard", "blisterwood", "dark_crystal", "fort", "drowned_town"],
        bridge: "stone",
        fence: 39202,
        wall: 39400,
        marker: 404,
        rock: rock({
            ground: 94,
            overlay: 99,
            pebbles: [336, 14483, 14482, 14486],
            facets: [42352, 42353],
            rubble: [
                [11933, 2],
                [4605, 2],
            ],
            stones: [185, 3703],
            cave: 17209,
        }),
    },
    // Tirannwn, with Prifddinas's crystal growing through it
    elven: {
        ground: [48, 50, 49],
        shore: 64,
        hillGround: 93,
        trail: 67,
        road: 106,
        water: 442,
        trees: [
            [36672, 2],
            [36677, 2],
            [36674, 3],
            [36679, 3],
            [3879, 3],
        ],
        rocks: [
            [3897, 1],
            [3896, 1],
            [3894, 2],
            [3895, 2],
        ],
        decor: [3549, 3548, 3547, 60420, 60419, 60418, 60423],
        flowers: [36549, 36550, 36551, 36492, 3904, 1196],
        props: [
            [1392, 2],
            [1394, 2],
        ],
        buildings: ["prif_house", "prif_shop", "prif_hut", "prif_hall"],
        landmarks: ["crystal", "crystal_field", "shrine", "drowned_town"],
        bridge: "elven",
        fence: 36255,
        wall: 36247,
        marker: 36492,
        rock: rock({
            ground: 92,
            overlay: 3,
            pebbles: [11439, 336, 11438],
            rubble: [
                [3894, 2],
                [3895, 2],
            ],
            stones: [3614, 11439],
            cave: 2123,
        }),
    },
    // Zanaris: toadstools and blue grass, with nothing built
    fairy: {
        ground: [143, 144, 143],
        shore: 144,
        hillGround: 144,
        trail: 144,
        road: 83,
        water: 6,
        trees: [
            [3886, 1],
            [3883, 2],
            [12077, 1],
            [3879, 3],
        ],
        rocks: [
            [3897, 1],
            [3894, 2],
        ],
        decor: [12052, 12055, 12053, 12054, 15506, 15507, 15508],
        flowers: [12005, 12006, 12056, 12057, 12058, 12059],
        props: [
            [12006, 1],
            [12005, 1],
            [3885, 3],
        ],
        buildings: [],
        ruins: ["prif_hut", "prif_house"],
        landmarks: ["giant_mushroom", "mushroom_grove", "fairy_ring"],
        bridge: "elven",
        fence: 9025,
        wall: 36247,
        marker: 12006,
        rock: rock({
            ground: 144,
            overlay: 83,
            pebbles: [3709, 3703],
            rubble: [
                [3894, 2],
                [3895, 2],
            ],
            stones: [3614, 11439],
            cave: 2123,
        }),
    },
    // The Darkwood's red ground and black trees
    darkwood: {
        ground: [235, 234, 239],
        shore: 240,
        hillGround: 240,
        trail: 240,
        road: 72,
        paving: DARK_PAVING,
        water: 7,
        trees: [
            [40788, 2],
            [40789, 2],
            [40790, 2],
            [40797, 2],
            [40793, 3],
            [40796, 3],
        ],
        rocks: [
            [60918, 2],
            [60927, 2],
            [60928, 2],
        ],
        decor: [40837, 40836, 40838, 40843, 40842, 61097, 61098, 61100],
        flowers: [60876, 60877, 60878, 60868, 60866],
        props: [
            [60880, 2],
            [60881, 2],
            [60935, 2],
            [60936, 2],
        ],
        buildings: ["darkmeyer_house", "darkmeyer_shop"],
        landmarks: ["dark_crystal", "great_tree", "black_trees", "black_crystal"],
        bridge: "stone",
        fence: 39202,
        wall: 39400,
        marker: 34796,
        rock: rock({
            ground: 241,
            overlay: 99,
            pebbles: [61098, 61100],
            facets: [42352, 42353],
            rubble: [
                [60918, 2],
                [60927, 2],
            ],
            stones: [61098, 61100],
            cave: 17209,
        }),
    },
    // Nothing like it in the game: bright land broken off in pieces over the stars, the sky a
    // floor from the Cosmic Plane
    astral: {
        ground: [99, 51, 48],
        shore: 55,
        hillGround: 93,
        trail: 67,
        road: 12,
        water: 39,
        molten: true,
        chasm: true,
        trees: [
            [10834, 2],
            [36672, 2],
            [36674, 3],
        ],
        rocks: [
            [3897, 1],
            [3894, 2],
        ],
        decor: [3549, 3548, 3547, 60420, 60419, 60418],
        flowers: [36549, 36550, 36551, 36492, 3904],
        props: [
            [27886, 2],
            [27882, 3],
            [3895, 2],
        ],
        buildings: ["prif_house", "prif_hut", "prif_shop"],
        landmarks: ["crystal", "crystal_field", "stone_circle", "shrine", "hedge_maze"],
        bridge: "elven",
        fence: 36255,
        wall: 36247,
        marker: 36492,
        rock: rock({
            ground: 55,
            overlay: 2,
            pebbles: [336, 14483, 14482],
            rubble: [
                [3894, 2],
                [3895, 2],
            ],
            stones: [3614, 11439],
            cave: 2123,
        }),
    },
};
