import { getEnemy } from "./enemies";
import { getMapEnemyIds } from "./mapEnemies";
import { getMap } from "./maps";
import { MapDef, QuestDef, QuestObjective } from "./types";

// Quests: goals that take as many runs as they take, each paying coins once
// when the run that finishes it ends. Named for the OSRS quest they're
// closest to. In map order, with the ones done all over last.
export const QUESTS: QuestDef[] = [
    {
        id: "ernest_the_chicken",
        name: "Ernest the Chicken",
        mapId: "lumbridge",
        objective: { kind: "kill", enemyIds: ["chicken"], count: 75, what: "chickens" },
        coins: 100,
    },
    {
        id: "goblin_diplomacy",
        name: "Goblin Diplomacy",
        mapId: "lumbridge",
        objective: { kind: "kill", enemyIds: ["goblin"], count: 300, what: "goblins" },
        coins: 150,
    },
    {
        id: "imp_catcher",
        name: "Imp Catcher",
        mapId: "lumbridge",
        objective: { kind: "kill", enemyIds: ["imp"], count: 200, what: "imps" },
        coins: 150,
    },
    {
        id: "the_restless_ghost",
        name: "The Restless Ghost",
        mapId: "lumbridge",
        objective: { kind: "kill", enemyIds: ["ghost"], count: 500, what: "ghosts" },
        coins: 200,
    },
    {
        id: "vampyre_slayer",
        name: "Vampyre Slayer",
        mapId: "lumbridge",
        objective: { kind: "kill", enemyIds: ["count_draynor"], count: 1 },
        coins: 300,
    },
    {
        id: "shades_of_mortton",
        name: "Shades of Mort'ton",
        mapId: "barrows",
        objective: { kind: "kill", enemyIds: ["shade"], count: 1000, what: "Loar Shades" },
        coins: 400,
    },
    {
        id: "sins_of_the_father",
        name: "Sins of the Father",
        mapId: "barrows",
        objective: {
            kind: "kill",
            enemyIds: ["feral_vampyre"],
            count: 1000,
            what: "Feral Vampyres",
        },
        coins: 400,
    },
    {
        id: "the_dig_site",
        name: "The Dig Site",
        mapId: "wilderness",
        objective: {
            kind: "kill",
            enemyIds: ["crazy_archaeologist"],
            count: 1,
            what: "the Crazy archaeologist",
        },
        coins: 400,
    },
    {
        id: "desert_treasure",
        name: "Desert Treasure I",
        mapId: "desert",
        objective: { kind: "killEach", enemyIds: ["fareed", "dessous", "damis_risen"] },
        coins: 1000,
    },
    {
        id: "contact",
        name: "Contact!",
        mapId: "desert",
        objective: {
            kind: "kill",
            enemyIds: ["scarab_swarm"],
            count: 50,
            what: "scarab swarms",
        },
        coins: 400,
    },
    {
        id: "horror_from_the_deep",
        name: "Horror from the Deep",
        mapId: "fremennik",
        objective: { kind: "kill", enemyIds: ["dagannoth"], count: 1000, what: "dagannoths" },
        coins: 500,
    },
    {
        id: "troll_stronghold",
        name: "Troll Stronghold",
        mapId: "fremennik",
        objective: {
            kind: "kill",
            enemyIds: ["mountain_troll", "ice_troll"],
            count: 1000,
            what: "trolls",
        },
        coins: 500,
    },
    {
        id: "royal_trouble",
        name: "Royal Trouble",
        mapId: "fremennik",
        objective: {
            kind: "killEach",
            enemyIds: ["dagannoth_rex", "dagannoth_supreme", "dagannoth_prime"],
            what: "each of the Dagannoth Kings",
        },
        coins: 1000,
    },
    {
        id: "dragon_slayer_ii",
        name: "Dragon Slayer II",
        mapId: "fremennik",
        objective: { kind: "kill", enemyIds: ["vorkath"], count: 1 },
        coins: 1500,
    },
    {
        id: "monkey_madness",
        name: "Monkey Madness I",
        mapId: "karamja",
        objective: { kind: "kill", enemyIds: ["monkey"], count: 300, what: "monkeys" },
        coins: 500,
    },
    {
        id: "dragon_slayer",
        name: "Dragon Slayer I",
        mapId: "karamja",
        objective: { kind: "kill", enemyIds: ["elvarg"], count: 1 },
        coins: 1000,
    },
    {
        id: "legends_quest",
        name: "Legends' Quest",
        mapId: "karamja",
        objective: { kind: "kill", enemyIds: ["nezikchened"], count: 1 },
        coins: 1000,
    },
    {
        id: "a_kingdom_divided",
        name: "A Kingdom Divided",
        mapId: "kourend",
        objective: {
            kind: "kill",
            enemyIds: ["lizardman", "lizardman_brute"],
            count: 1000,
            what: "lizardmen",
        },
        coins: 600,
    },
    {
        id: "perilous_moons",
        name: "Perilous Moons",
        mapId: "varlamore",
        objective: {
            kind: "kill",
            enemyIds: ["sulphur_nagua", "frost_nagua"],
            count: 1000,
            what: "naguas",
        },
        coins: 700,
    },
    {
        id: "nature_spirit",
        name: "Nature Spirit",
        mapId: "morytania",
        objective: { kind: "kill", enemyIds: ["ghast"], count: 500, what: "ghasts" },
        coins: 700,
    },
    {
        id: "darkness_of_hallowvale",
        name: "Darkness of Hallowvale",
        mapId: "morytania",
        objective: {
            kind: "kill",
            enemyIds: ["vampyre_juvenile", "vampyre_juvinate", "vyrewatch", "vyrewatch_sentinel"],
            count: 1000,
            what: "vampyres",
        },
        coins: 800,
    },
    {
        id: "a_night_at_the_theatre",
        name: "A Night at the Theatre",
        mapId: "morytania",
        // Her last form, the spider: she isn't beaten until it is
        objective: { kind: "kill", enemyIds: ["verzik_vitur_spider"], count: 1 },
        coins: 2000,
    },
    {
        id: "temple_of_ikov",
        name: "Temple of Ikov",
        mapId: "god_wars",
        objective: {
            kind: "kill",
            enemyIds: ["aviansie", "aviansie_veteran"],
            count: 1000,
            what: "aviansies",
        },
        coins: 800,
    },
    {
        id: "the_frozen_door",
        name: "The Frozen Door",
        mapId: "god_wars",
        objective: {
            kind: "killEach",
            enemyIds: ["commander_zilyana", "kreearra", "kril_tsutsaroth", "general_graardor"],
            what: "each of the four generals",
        },
        coins: 1500,
    },
    {
        id: "secrets_of_the_north",
        name: "Secrets of the North",
        mapId: "god_wars",
        // Her last form, ice
        objective: { kind: "kill", enemyIds: ["nex_ice"], count: 1 },
        coins: 2000,
    },
    {
        id: "roving_elves",
        name: "Roving Elves",
        mapId: "prifddinas",
        objective: {
            kind: "kill",
            enemyIds: ["elf_guard", "iorwerth_warrior", "iorwerth_archer"],
            count: 1000,
            what: "elves",
        },
        coins: 900,
    },
    {
        id: "regicide",
        name: "Regicide",
        mapId: "prifddinas",
        // Its last form, the blue one
        objective: { kind: "kill", enemyIds: ["zulrah_tanzanite"], count: 1 },
        coins: 1200,
    },
    {
        id: "song_of_the_elves",
        name: "Song of the Elves",
        mapId: "prifddinas",
        objective: { kind: "kill", enemyIds: ["corrupted_hunllef"], count: 1 },
        coins: 2000,
    },
    // No OSRS quest goes into Mor Ul Rek, so these are named for the Inferno's
    // combat achievements and the Inferno itself
    {
        id: "nibblers_begone",
        name: "Nibblers, Begone!",
        mapId: "inferno",
        objective: { kind: "kill", enemyIds: ["jal_nib"], count: 1000, what: "nibblers" },
        coins: 900,
    },
    {
        id: "jad_what_are_you_doing_here",
        name: "Jad? What Are You Doing Here?",
        mapId: "inferno",
        objective: { kind: "kill", enemyIds: ["jaltok_jad"], count: 1 },
        coins: 1200,
    },
    {
        id: "the_inferno",
        name: "The Inferno",
        mapId: "inferno",
        objective: { kind: "beatMap", mapId: "inferno" },
        coins: 2500,
    },
    {
        id: "zogre_flesh_eaters",
        name: "Zogre Flesh Eaters",
        mapId: "halloween",
        objective: { kind: "kill", enemyIds: ["slash_bash"], count: 1 },
        coins: 1000,
    },
    // No OSRS quest has the Mimic in it: this one's named for the night
    {
        id: "trick_or_treat",
        name: "Trick or Treat",
        mapId: "halloween",
        objective: { kind: "kill", enemyIds: ["the_mimic"], count: 1 },
        coins: 1200,
    },
    {
        id: "sleeping_giants",
        name: "Sleeping Giants",
        mapId: "halloween",
        objective: { kind: "kill", enemyIds: ["sleepwalker"], count: 30, what: "sleepwalkers" },
        coins: 1000,
    },
    {
        id: "dream_mentor",
        name: "Dream Mentor",
        mapId: "halloween",
        objective: { kind: "kill", enemyIds: ["the_nightmare"], count: 1 },
        coins: 2500,
    },
    {
        id: "a_souls_bane",
        name: "A Soul's Bane",
        mapId: "phosani",
        objective: { kind: "kill", enemyIds: ["phosanis_nightmare"], count: 1 },
        coins: 4000,
    },
    {
        id: "ratcatchers",
        name: "Ratcatchers",
        objective: {
            kind: "kill",
            enemyIds: ["rat", "giant_rat", "crypt_rat", "giant_crypt_rat", "crystalline_rat"],
            count: 1000,
            what: "rats",
        },
        coins: 400,
    },
    {
        id: "demon_slayer",
        name: "Demon Slayer",
        objective: {
            kind: "kill",
            enemyIds: ["revenant_demon", "lesser_demon", "reanimated_demon"],
            count: 300,
            what: "demons",
        },
        coins: 600,
    },
    {
        id: "pirates_treasure",
        name: "Pirate's Treasure",
        objective: { kind: "caskets", count: 30 },
        coins: 500,
    },
];

export const QUEST_BY_ID: Map<string, QuestDef> = new Map(QUESTS.map((q) => [q.id, q]));

// Whether a run on this map gets a quest anywhere: the map's own, and the ones
// done all over if what they're after turns up here (there are no rats in the
// Inferno). Caskets come on every map.
export function canDoQuestOn(quest: QuestDef, map: MapDef): boolean {
    if (quest.mapId !== undefined) {
        return quest.mapId === map.id;
    }
    const objective = quest.objective;
    if (objective.kind !== "kill" && objective.kind !== "killEach") {
        return true;
    }
    const here = getMapEnemyIds(map);
    return objective.kind === "kill"
        ? objective.enemyIds.some((id) => here.has(id))
        : objective.enemyIds.every((id) => here.has(id));
}

// "Kill 75 chickens", "Kill Count Draynor", "Kill Fareed, Dessous and Damis",
// "Open 30 reward caskets", "Beat The Inferno"
export function describeQuest(objective: QuestObjective): string {
    switch (objective.kind) {
        case "kill":
            return objective.count === 1
                ? `Kill ${objective.what ?? getEnemy(objective.enemyIds[0]).name}`
                : `Kill ${objective.count.toLocaleString()} ${objective.what}`;
        case "killEach":
            return `Kill ${objective.what ?? joinNames(objective.enemyIds.map((id) => getEnemy(id).name))}`;
        case "caskets":
            return `Open ${objective.count} reward caskets`;
        case "beatMap":
            return `Beat ${getMap(objective.mapId).name}`;
    }
}

function joinNames(names: string[]): string {
    return names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : names[0];
}
