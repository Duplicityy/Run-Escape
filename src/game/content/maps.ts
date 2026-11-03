import { SCAPERUNE_DEV_MAPS } from "../scaperune/maps/devMaps";
import { HALLOWED_BOSS_ARENA, HALLOWED_NIGHT } from "../scaperune/maps/hallowedNight";
import { SANCTUARY_BOSS_ARENA, SISTERHOOD_SANCTUARY } from "../scaperune/maps/sisterhoodSanctuary";
import { MapRecipe, getRecipeArena, getRecipeWorldTile } from "../scaperune/recipe";
import { ENEMY_BY_ID, getEnemy } from "./enemies";
import { FUN_MAPS } from "./fun/maps";
import { PHOSANI_START_DISTANCE } from "./phosani";
import { RANDOM_EVENTS } from "./randomEvents";
import { EnemyDef, MapDef } from "./types";
import {
    BARROWS_EVENTS,
    BARROWS_WAVES,
    DESERT_EVENTS,
    DESERT_WAVES,
    FREMENNIK_EVENTS,
    FREMENNIK_WAVES,
    GOD_WARS_EVENTS,
    GOD_WARS_WAVES,
    HALLOWEEN_EVENTS,
    HALLOWEEN_WAVES,
    INFERNO_EVENTS,
    INFERNO_WAVES,
    KARAMJA_EVENTS,
    KARAMJA_WAVES,
    KOUREND_EVENTS,
    KOUREND_WAVES,
    LUMBRIDGE_EVENTS,
    LUMBRIDGE_WAVES,
    MORYTANIA_EVENTS,
    MORYTANIA_WAVES,
    PRIFDDINAS_EVENTS,
    PRIFDDINAS_WAVES,
    VARLAMORE_EVENTS,
    VARLAMORE_WAVES,
    WILDERNESS_EVENTS,
    WILDERNESS_WAVES,
} from "./waves";

// The maps, in the order they open up: beating one unlocks the next. Arenas
// are whole map squares (64 tiles), in world tiles. Seasonal maps go last: they're
// open from the start, and nothing waits on them.
export const MAPS: MapDef[] = [
    {
        id: "lumbridge",
        name: "Lumbridge",
        description:
            "Farm animals, goblins and the undead of Draynor Manor. Count Draynor wakes " +
            "halfway, and the Wise Old Man comes at the end.",
        // Bronze axe
        iconObjId: 1351,
        // Lumbridge, the swamp, Draynor Village and Draynor Manor (map squares
        // 48-50 x 49-52)
        arena: { baseX: 48 * 64, baseY: 49 * 64, sizeX: 3 * 64, sizeY: 4 * 64 },
        // The castle courtyard
        spawn: { x: 3222.5, y: 3218.5 },
        difficulty: { hp: 1, damage: 1 },
        hard: { hp: 2.2, damage: 1.7 },
        waves: LUMBRIDGE_WAVES,
        events: LUMBRIDGE_EVENTS,
        finalBossWarning: "The Wise Old Man is on his way...",
        victoryText: "The Wise Old Man is defeated!",
    },
    {
        id: "barrows",
        name: "Barrows",
        description:
            "Crypt rats, spiders and bloodworms, ghouls, Mort'ton's afflicted and shades, " +
            "and feral vampyres. The six Barrows brothers climb out of their crypts one by " +
            "one, every two and a half minutes. Dharok comes last.",
        // Dharok's helm
        iconObjId: 4716,
        // The Barrows and the swamp around it (map squares 54-56 x 50-52)
        arena: { baseX: 54 * 64, baseY: 50 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // Among the six mounds
        spawn: { x: 3565.5, y: 3287.5 },
        difficulty: { hp: 1.25, damage: 1.15 },
        hard: { hp: 1.75, damage: 1.45 },
        waves: BARROWS_WAVES,
        events: BARROWS_EVENTS,
        finalBossWarning: "The last brother stirs in his crypt...",
        victoryText: "The Barrows brothers are laid to rest!",
    },
    {
        id: "wilderness",
        name: "Wilderness",
        description:
            "Revenants, bandits, dark warriors and chaos druids, the undead of the Graveyard " +
            "of Shadows, hill giants and the Ankou. The Crazy archaeologist and the Chaos " +
            "Fanatic, and the King Black Dragon at the end.",
        // Dragon bones
        iconObjId: 536,
        // Around the Bone Yard, level 27 Wilderness (map squares 49-51 x 57-59)
        arena: { baseX: 49 * 64, baseY: 57 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        spawn: { x: 3237.5, y: 3742.5 },
        difficulty: { hp: 1.5, damage: 1.3 },
        hard: { hp: 1.6, damage: 1.35 },
        waves: WILDERNESS_WAVES,
        events: WILDERNESS_EVENTS,
        finalBossWarning: "Something huge stirs beneath the Lava Maze...",
        victoryText: "The King Black Dragon is slain!",
    },
    {
        id: "desert",
        name: "Kharidian Desert",
        description:
            "Lizards, scorpions and jackals, desert bandits, kalphites out of their hive, " +
            "crocodiles, mummies and locust riders. Desert Treasure's Fareed, Dessous and " +
            "Damis come one by one, and the Kalphite Queen at the end.",
        // The Kalphite Queen's head
        iconObjId: 7981,
        // The Bandit Camp, the Bedabin Camp and the Jaldraocht pyramid (map
        // squares 49-51 x 45-47)
        arena: { baseX: 49 * 64, baseY: 45 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // Open sand by the Bandit Camp
        spawn: { x: 3200.5, y: 2985.5 },
        difficulty: { hp: 1.75, damage: 1.45 },
        hard: { hp: 1.75, damage: 1.4 },
        waves: DESERT_WAVES,
        events: DESERT_EVENTS,
        finalBossWarning: "The sand trembles beneath your feet...",
        victoryText: "The Kalphite Queen is slain!",
    },
    {
        id: "fremennik",
        name: "Fremennik Province",
        description:
            "Rock crabs and wolves, cockatrices and yaks, trolls, basilisks and jellies, " +
            "dagannoths and wallasalki, kurasks and rock lobsters. The three Dagannoth Kings " +
            "come one by one, and Vorkath at the end.",
        // Vorkath's head
        iconObjId: 21907,
        // Rellekka, the rock crab beaches, the Slayer Dungeon's entrance and
        // the Mountain Camp (map squares 41-43 x 56-58)
        arena: { baseX: 41 * 64, baseY: 56 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // Outside Rellekka's gate
        spawn: { x: 2670.5, y: 3640.5 },
        difficulty: { hp: 2, damage: 1.6 },
        hard: { hp: 1.6, damage: 1.35 },
        waves: FREMENNIK_WAVES,
        events: FREMENNIK_EVENTS,
        finalBossWarning: "Something stirs in the ice of Ungael...",
        victoryText: "Vorkath is slain!",
    },
    {
        id: "karamja",
        name: "Karamja",
        description:
            "Monkeys, snakes and jungle spiders, tribesmen, jogres and moss giants, lesser " +
            "demons, and the TzHaar up out of the volcano. Elvarg, Nezikchened and Ket-Zek " +
            "come one by one, and TzTok-Jad at the end.",
        // Tokkul
        iconObjId: 6529,
        // Brimhaven, the volcano, Musa Point and the jungle down to Tai Bwo
        // Wannai (map squares 43-45 x 47-49)
        arena: { baseX: 43 * 64, baseY: 47 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // In Tai Bwo Wannai
        spawn: { x: 2790.5, y: 3070.5 },
        difficulty: { hp: 2.25, damage: 1.75 },
        hard: { hp: 1.45, damage: 1.25 },
        waves: KARAMJA_WAVES,
        events: KARAMJA_EVENTS,
        finalBossWarning: "The volcano rumbles... TzTok-Jad is coming!",
        victoryText: "TzTok-Jad is slain!",
    },
    {
        id: "kourend",
        name: "Kourend",
        description:
            "Guanic bats, swamp crabs and lizards, lizardmen and their brutes, bloodvelds, " +
            "Xeric's deathly rangers, mages and skeletal mystics, and hydras. The Lizardman " +
            "shaman, Sarachnis and Skotizo come one by one, and the Alchemical Hydra at the end.",
        // The Alchemical Hydra's heads
        iconObjId: 23077,
        // Shayzien and the Lizardman Canyon (map squares 22-24 x 55-57)
        arena: { baseX: 22 * 64, baseY: 55 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // Outside Shayzien
        spawn: { x: 1500.5, y: 3600.5 },
        difficulty: { hp: 2.5, damage: 1.9 },
        hard: { hp: 1.45, damage: 1.25 },
        waves: KOUREND_WAVES,
        events: KOUREND_EVENTS,
        finalBossWarning: "Something stirs beneath Mount Karuulm...",
        victoryText: "The Alchemical Hydra is slain!",
    },
    {
        id: "varlamore",
        name: "Varlamore",
        description:
            "Jerboas, pyre foxes and antelopes, blood jaguars, serpent shamans and jaguar " +
            "warriors, naguas, the Fremennik warband, gryphons and minotaurs. The Manticore and " +
            "the Shockwave and Javelin Colossi come one by one, and Sol Heredit at the end.",
        // Sunfire splinters
        iconObjId: 28924,
        // Civitas illa Fortis and the grounds of the Fortis Colosseum (map
        // squares 26-28 x 47-49)
        arena: { baseX: 26 * 64, baseY: 47 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // In the city's streets
        spawn: { x: 1700.5, y: 3100.5 },
        difficulty: { hp: 2.75, damage: 2.05 },
        hard: { hp: 1.5, damage: 1.3 },
        waves: VARLAMORE_WAVES,
        events: VARLAMORE_EVENTS,
        finalBossWarning: "The crowd roars... Sol Heredit enters the arena!",
        victoryText: "Sol Heredit is defeated!",
    },
    {
        id: "morytania",
        name: "Morytania",
        description:
            "Ghasts, shades and zombies out of Mort Myre, vampyre juveniles and juvinates, " +
            "werewolves, nail beasts and mutated bloodvelds, the Theatre of Blood's Nylocas and " +
            "Darkmeyer's vyrewatch. Vanstrom Klause, the Pestilent Bloat and Sotetseg come one " +
            "by one, and Verzik Vitur at the end.",
        // Lil' Zik
        iconObjId: 22473,
        // Slepe and the swamp under Darkmeyer's walls (map squares 56-58 x
        // 51-53). Darkmeyer and Meiyerditch themselves are walled in and too
        // cramped to fight in, so they stand at the arena's edge.
        arena: { baseX: 56 * 64, baseY: 51 * 64, sizeX: 3 * 64, sizeY: 3 * 64 },
        // In Slepe
        spawn: { x: 3720.5, y: 3310.5 },
        difficulty: { hp: 3, damage: 2.2 },
        hard: { hp: 1.5, damage: 1.3 },
        waves: MORYTANIA_WAVES,
        events: MORYTANIA_EVENTS,
        finalBossWarning: "The Theatre's curtain rises... Verzik Vitur awaits!",
        victoryText: "Verzik Vitur is defeated!",
        // The client has no Theatre or Darkmeyer track yet; this one fits a
        // theatre of blood
        music: "Massacre",
    },
    {
        id: "god_wars",
        name: "God Wars Dungeon",
        description:
            "The armies of Bandos, Armadyl, Saradomin and Zamorak, at war with each other as " +
            "much as with you: goblins, orks and cyclopes, aviansies, knights and priests, imps, " +
            "hellhounds and bloodvelds, and the gods' spiritual warriors. Commander Zilyana, " +
            "Kree'arra and K'ril Tsutsaroth come one by one, General Graardor leads a charge, " +
            "and Nex comes at the end.",
        // An Armadyl hilt
        iconObjId: 11810,
        // The dungeon's main cave, up on plane 2 (map squares 44-45 x 82-83).
        // The generals' rooms and Saradomin's encampment are behind doors and
        // ropes, so the fighting is in the middle of the cave where the
        // armies meet.
        arena: { baseX: 44 * 64, baseY: 82 * 64, sizeX: 2 * 64, sizeY: 2 * 64 },
        plane: 2,
        // In the middle of the cave
        spawn: { x: 2866.5, y: 5311.5 },
        // Its enemies hit softer than Morytania's: with the armies closing in
        // from every side of the cave at once, at the usual step (2.35) it
        // was as hard as the Inferno by simulate-run's count. Lowered again
        // (from 2.1) when its bosses grew to full size and anything the
        // player hits stopped fighting the other armies
        difficulty: { hp: 3.25, damage: 1.95 },
        hard: { hp: 1.4, damage: 1.25 },
        waves: GOD_WARS_WAVES,
        events: GOD_WARS_EVENTS,
        finalBossWarning: "The frozen door cracks... Nex is breaking free!",
        victoryText: "Nex is defeated!",
    },
    {
        id: "prifddinas",
        name: "Prifddinas",
        description:
            "The Gauntlet's crystalline rats, bats, spiders, scorpions, wolves, bears and dark " +
            "beasts, the city's guards, the Iorwerth's warriors and archers and Zulrah's " +
            "snakelings, and the corrupted ones late on. Zulrah, Zalcano and the Crystalline " +
            "Hunllef come one by one, and the Corrupted Hunllef at the end.",
        // An enhanced crystal weapon seed, the Gauntlet's reward
        iconObjId: 25859,
        // The city of Prifddinas, inside its walls (map squares 50-51 x
        // 94-95: the walls fill them, and outside is out of reach)
        arena: { baseX: 50 * 64, baseY: 94 * 64, sizeX: 2 * 64, sizeY: 2 * 64 },
        // By the Tower of Voices
        spawn: { x: 3264.5, y: 6060.5 },
        difficulty: { hp: 3.5, damage: 2.5 },
        hard: { hp: 1.35, damage: 1.2 },
        waves: PRIFDDINAS_WAVES,
        events: PRIFDDINAS_EVENTS,
        finalBossWarning: "The crystal singing turns sour... the Corrupted Hunllef is coming!",
        victoryText: "The Corrupted Hunllef is slain!",
    },
    {
        id: "inferno",
        name: "The Inferno",
        description:
            "Mor Ul Rek's TzHaar and the Inferno's creatures: nibblers, Jal-MejRah bats, Jal-Ak " +
            "blobs that split, Jal-ImKot that dig up near you, Jal-Xil, and Jal-Zek that " +
            "raise the dead. JalTok-Jad, a Jal-Zek champion and a TzHaar-Ket champion come one " +
            "by one, and three JalTok-Jads at once at the end.",
        // An infernal cape
        iconObjId: 21295,
        // Mor Ul Rek, the TzHaar city under the volcano, above the Inferno
        // (map squares 38-39 x 79-80). The Inferno itself is a room too small
        // to fight a crowd in.
        arena: { baseX: 38 * 64, baseY: 79 * 64, sizeX: 2 * 64, sizeY: 2 * 64 },
        // In the square south of the city's middle
        spawn: { x: 2497.5, y: 5097.5 },
        difficulty: { hp: 3.75, damage: 2.7 },
        hard: { hp: 1.4, damage: 1.2 },
        waves: INFERNO_WAVES,
        events: INFERNO_EVENTS,
        finalBossWarning: "The lava churns... three JalTok-Jads are rising!",
        victoryText: "The JalTok-Jads are slain! You are the champion of the Inferno!",
    },
    {
        id: "halloween",
        name: "Hallowed Night",
        description:
            "A graveyard hamlet in a pumpkin patch, on the one night its dead won't lie still. " +
            "Slash Bash and The Mimic come one by one, and The Nightmare rises at the end.",
        // A pumpkin
        iconObjId: 1959,
        arena: getRecipeArena(HALLOWED_NIGHT),
        // South of the ritual circle
        spawn: getRecipeWorldTile(HALLOWED_NIGHT, HALLOWED_NIGHT.spawn.x, HALLOWED_NIGHT.spawn.y),
        difficulty: { hp: 1.25, damage: 1.15 },
        hard: { hp: 1.5, damage: 1.3 },
        waves: HALLOWEEN_WAVES,
        events: HALLOWEEN_EVENTS,
        finalBossWarning: "The pumpkins go dark... The Nightmare is waking!",
        victoryText: "The Nightmare is laid to rest!",
        // The ritual circle: all 192 tiles would put her totems a minute's walk apart
        bossArena: HALLOWED_BOSS_ARENA,
        scaperune: true,
        seasonal: true,
        brightness: 0.8,
    },
    {
        id: "phosani",
        name: "Phosani's Nightmare",
        description:
            "The Nightmare's hard mode, on its own: her dream, walled round in the stone of the " +
            "Sisterhood Sanctuary beneath Slepe. No waves, no picks and no items: " +
            "the Armadyl crossbow, and her. She rises as you arrive, quicker than before and " +
            "with more at once, and every hit of hers is shown before it lands. Her totems' " +
            "blasts are the only rest, and each heals you.",
        // The Inquisitor's great helm
        iconObjId: 24419,
        arena: getRecipeArena(SISTERHOOD_SANCTUARY),
        // South of the arena's middle, where her entrance stands the player
        // anyway: she rises at the middle itself
        spawn: {
            x: SANCTUARY_BOSS_ARENA.baseX + SANCTUARY_BOSS_ARENA.size / 2,
            y: SANCTUARY_BOSS_ARENA.baseY + SANCTUARY_BOSS_ARENA.size / 2 - PHOSANI_START_DISTANCE,
        },
        // Her hitpoints come from the event: a run here has the Inquisitor's
        // crossbow and nothing more, not fifteen minutes of levels. Her hits are
        // tuned to the Inquisitor's hitpoints too: a big one takes about half,
        // as hers do on Hallowed Night with a whole run's behind you
        difficulty: { hp: 1, damage: 1 },
        hard: { hp: 1.3, damage: 1.3 },
        waves: [],
        events: [{ at: 0, kind: "finalBoss", enemyId: "phosanis_nightmare", hp: 6000 }],
        finalBossWarning: "",
        victoryText: "Phosani's Nightmare is laid to rest!",
        bossArena: SANCTUARY_BOSS_ARENA,
        scaperune: true,
        fight: { requires: "halloween", character: "inquisitor", weaponLevel: 3 },
        brightness: 0.75,
        // Her own track; the recording goes in src/media/music (see GameClient)
        music: "The Bane of Ashihama",
    },
];

// The maps that open one after another
export const CAMPAIGN_MAPS: MapDef[] = MAPS.filter((map) => !map.seasonal && !map.fight);

// Open from the start, between the campaign and the fun maps
export const SEASONAL_MAPS: MapDef[] = MAPS.filter((map) => map.seasonal);

// Boss fights on their own, each open once its map has been beaten
export const FIGHT_MAPS: MapDef[] = MAPS.filter((map) => map.fight);

// The fun maps (fun/maps.ts): open from the start and endless, outside the
// campaign's chain
export { FUN_MAPS };

// Dev server only (or DEV_MAPS=1 in a script): ScapeRune's maps, ground of our
// own rather than a slice of the real world (scaperune/CLAUDE.md)
const showDevMaps =
    (import.meta.env?.DEV && import.meta.env?.MODE !== "test") ||
    (typeof process !== "undefined" && process.env?.DEV_MAPS === "1");
function createDevMap(recipe: MapRecipe): MapDef {
    const play = recipe.play;
    const source = play && MAPS.find((map) => map.id === play.waveSet);
    const density = play?.enemyDensity ?? 1;
    return {
        id: recipe.id,
        name: recipe.id,
        description: "ScapeRune test map, for development.",
        iconObjId: 1351,
        arena: getRecipeArena(recipe),
        spawn: getRecipeWorldTile(recipe, recipe.spawn.x, recipe.spawn.y),
        difficulty: source?.difficulty ?? { hp: 1, damage: 1 },
        waves: (source?.waves ?? LUMBRIDGE_WAVES).map((wave) => ({
            ...wave,
            spawnRate: wave.spawnRate * density,
            minAlive: Math.round(wave.minAlive * density),
            maxAlive: Math.round(wave.maxAlive * density),
        })),
        brightness: play?.brightness,
        events: [],
        finalBossWarning: "",
        victoryText: "",
        fun: { bosses: { pool: ["giant_rat"], firstAt: 3600, every: [3600, 3600] } },
        dev: true,
        scaperune: true,
        ...recipe.mapDef,
    };
}

export const DEV_MAPS: MapDef[] = showDevMaps ? SCAPERUNE_DEV_MAPS.map(createDevMap) : [];

// Every map, the campaign's and the fun ones
export const ALL_MAPS: MapDef[] = [...MAPS, ...FUN_MAPS, ...DEV_MAPS];

export const MAP_BY_ID: Map<string, MapDef> = new Map(ALL_MAPS.map((m) => [m.id, m]));

// The map generator's latest map (scaperune/MapGeneratorScreen.tsx). A new object
// each time, which is how the minimap knows it's another map.
export function setGeneratedMap(recipe: MapRecipe): void {
    MAP_BY_ID.set(recipe.id, createDevMap(recipe));
}

export function isDevMap(mapId: string): boolean {
    return MAP_BY_ID.get(mapId)?.dev === true;
}

export function isFunMap(mapId: string): boolean {
    return MAP_BY_ID.get(mapId)?.fun !== undefined;
}

export function isSeasonalMap(mapId: string): boolean {
    return MAP_BY_ID.get(mapId)?.seasonal === true;
}

export function isFightMap(mapId: string): boolean {
    return MAP_BY_ID.get(mapId)?.fight !== undefined;
}

// The adventurer everyone plays on a map, if it has one (Durial321 in
// Falador, the Inquisitor against Phosani's Nightmare)
export function getMapCharacter(map: MapDef): string | undefined {
    return map.fun?.character ?? map.fight?.character;
}

export function getMap(id: string): MapDef {
    const map = MAP_BY_ID.get(id);
    if (!map) {
        throw new Error("Unknown map " + id);
    }
    return map;
}

// The part of the world a map's collision, heights and scenery come from: its
// arena, on its plane
export function getArenaRegion(map: MapDef): {
    baseX: number;
    baseY: number;
    sizeX: number;
    sizeY: number;
    plane: number;
} {
    return { ...map.arena, plane: map.plane ?? 0 };
}

// Whether anything on the map poisons you (the King Black Dragon's breath) or
// gives you what stacks up (Slash Bash's disease). Antipoisons are only found
// where something does.
export function hasPoison(map: MapDef): boolean {
    const enemyIds = [
        ...map.waves.flatMap((wave) => wave.enemies.map((e) => e.id)),
        ...map.events.map((event) => event.enemyId),
    ];
    return enemyIds.some((id) =>
        getEnemy(id).boss?.attacks.some(({ effect }) =>
            effect?.kind === "debuff" ? effect.stacks !== undefined : effect?.kind === "poison",
        ),
    );
}

// Whether anything that flies can turn up on the map. It goes by every enemy
// id anywhere in the map's data and the random events', and in theirs in turn
// (summons, splits, risen forms), so it doesn't need to know where ids are kept.
// Sim builds the flight grid with the map when this says so, rather than on
// the tick the first flier turns up.
export function hasFliers(map: MapDef): boolean {
    const seen = new Set<object>();
    const enemies: EnemyDef[] = [];
    const visit = (value: unknown): void => {
        if (typeof value === "string") {
            const enemy = ENEMY_BY_ID.get(value);
            if (enemy && !seen.has(enemy)) {
                enemies.push(enemy);
                visit(enemy);
            }
        } else if (
            typeof value === "object" &&
            value !== null &&
            !ArrayBuffer.isView(value) &&
            !seen.has(value)
        ) {
            seen.add(value);
            for (const item of Object.values(value)) {
                visit(item);
            }
        }
    };
    visit(map);
    visit(RANDOM_EVENTS);
    return enemies.some((enemy) => enemy.flies);
}
