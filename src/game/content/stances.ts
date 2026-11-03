// How the player stands and runs with an item in hand. An item not listed here
// uses the plain human stance, PLAYER_SEQS: swords, scimitars, maces, claws,
// bows, knives and thrownaxes all do.
//
// The cache can't tell us these: this revision has no render animation config,
// and no item param points at a stance. The ids come from what the live game
// plays (the Weapon Animation Replacer plugin's pose data) and from Jagex's seq
// names (RuneLite's gameval AnimationID). The player only ever runs, so walk
// seqs aren't listed.
export type PlayerStance = { idle: number; run: number };

const STANCES: (PlayerStance & { objIds: number[] })[] = [
    // 2h swords
    { idle: 2561, run: 2563, objIds: [1307, 1309, 1311, 1313, 1315, 1317, 1319, 7158] },
    // Godswords
    { idle: 7053, run: 7043, objIds: [11802, 11804, 11806, 11808, 26233] },
    // Colossal blade
    { idle: 9460, run: 9459, objIds: [27021] },
    // Elder maul
    { idle: 7518, run: 7519, objIds: [21003] },
    // Tzhaar-ket-om
    { idle: 2065, run: 824, objIds: [6528] },
    // Dinh's bulwarks
    { idle: 7508, run: 7509, objIds: [21015, 28682] },
    // Scythes
    { idle: 8057, run: 824, objIds: [22325, 25739] },
    // Ivandis and Blisterwood flails
    { idle: 8009, run: 8016, objIds: [22398, 24699] },
    // Abyssal whip
    { idle: 808, run: 1661, objIds: [4151] },
    // Osmumten's fang
    { idle: 809, run: 824, objIds: [26219] },
    // Thunder khopesh, by name (LEAGUE_5_KHOPESH_*)
    { idle: 11935, run: 11937, objIds: [30388] },
    // Blue moon spear, by name (HUMAN_SPELLSPEAR_*)
    { idle: 11120, run: 11118, objIds: [28988] },
    // Staves, wands, sceptres, Toktz-mej-tal, the blowpipe and the atlatl. The
    // ancient sceptres and the Crystal staff are staves by item category.
    {
        idle: 813,
        run: 1210,
        objIds: [
            1387, 6526, 12926, 21006, 22323, 23898, 23899, 23900, 25489, 25491, 25492, 25731, 29000,
        ],
    },
    // Nightmare staves
    { idle: 4504, run: 1210, objIds: [24422, 24423, 24424, 24425] },
    // Tumeken's shadows
    { idle: 9494, run: 1707, objIds: [27275, 28547] },
    // Crossbows
    { idle: 4591, run: 4228, objIds: [11785, 21012] },
];

const STANCE_BY_OBJ = new Map(
    STANCES.flatMap((stance) => stance.objIds.map((objId) => [objId, stance] as const)),
);

export function getPlayerStance(objId: number): PlayerStance | undefined {
    return STANCE_BY_OBJ.get(objId);
}

// Every seq a stance can play, for the slim cache
export function getPlayerStanceSeqs(): number[] {
    return [...new Set(STANCES.flatMap((stance) => [stance.idle, stance.run]))];
}

// The items with a stance of their own, for checking the table
export function getPlayerStanceObjIds(): number[] {
    return STANCES.flatMap((stance) => stance.objIds);
}
