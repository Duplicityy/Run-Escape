import { EquipSlot } from "../../rs/model/player/PlayerModelLoader";
import { DURIAL_COLORS, DURIAL_EQUIPMENT, DURIAL_KITS, FUN_ITEMS } from "./fun/enemies";
import { CharacterDef } from "./types";

// The first three are there from the start. Each map brings two more: one for
// beating it, one for a task done there.
export const CHARACTERS: CharacterDef[] = [
    {
        id: "warrior",
        name: "Warrior",
        description: "Starts with a bronze scimitar. Takes 1 less damage.",
        style: "melee",
        startingWeapon: "scimitar",
        equipment: {
            [EquipSlot.HEAD]: 1153,
            [EquipSlot.TORSO]: 1115,
            [EquipSlot.LEGS]: 1067,
        },
        bonus: { armor: 1 },
    },
    {
        id: "wizard",
        name: "Wizard",
        description: "Starts with Fire Strike. Weapons are 5% faster.",
        style: "magic",
        startingWeapon: "fire_spells",
        equipment: {
            [EquipSlot.HEAD]: 1017,
            [EquipSlot.TORSO]: 577,
            [EquipSlot.LEGS]: 1011,
            [EquipSlot.CAPE]: 1021,
        },
        bonus: { cooldown: 0.05 },
    },
    {
        id: "ranger",
        name: "Ranger",
        description: "Starts with bronze throwing knives. Moves 10% faster.",
        style: "ranged",
        startingWeapon: "throwing_knives",
        equipment: {
            [EquipSlot.HEAD]: 1169,
            [EquipSlot.TORSO]: 1129,
            [EquipSlot.LEGS]: 1095,
            [EquipSlot.HANDS]: 1063,
        },
        bonus: { moveSpeed: 0.1 },
    },
    {
        id: "monk",
        name: "Monk",
        description: "Starts with Saradomin Strike. Weapons are 15% faster.",
        style: "magic",
        startingWeapon: "saradomin_strike",
        // Monk's robes and a holy symbol
        equipment: {
            [EquipSlot.TORSO]: 544,
            [EquipSlot.LEGS]: 542,
            [EquipSlot.AMULET]: 1718,
        },
        // Strikes land anywhere around, so they come a little more often. It
        // was 25%, which hit the weapon speed cap (60%) early and made every
        // weapon the Monk picked up far faster than anyone else's.
        bonus: { cooldown: 0.15 },
        // The Vampyre Slayer quest's vampyre, in his manor
        unlock: { kind: "killBoss", mapId: "lumbridge", enemyId: "count_draynor" },
    },
    {
        id: "barbarian",
        name: "Barbarian",
        description: "Starts with a bronze 2h sword. 20% more hitpoints.",
        style: "melee",
        startingWeapon: "two_handed_sword",
        // Fremennik gear and a berserker helm
        equipment: {
            [EquipSlot.HEAD]: 3751,
            [EquipSlot.TORSO]: 3767,
            [EquipSlot.LEGS]: 23246,
            [EquipSlot.FEET]: 3791,
        },
        bonus: { maxHp: 0.2 },
        unlock: { kind: "beatMap", mapId: "lumbridge" },
    },
    {
        id: "ancient_mage",
        name: "Ancient mage",
        description: "Starts with Ice Burst. Weapons cover 15% more area.",
        style: "magic",
        startingWeapon: "ice_burst",
        // Zaros's robes, from treasure trails
        equipment: {
            [EquipSlot.HEAD]: 12203,
            [EquipSlot.TORSO]: 12193,
            [EquipSlot.LEGS]: 12195,
            [EquipSlot.CAPE]: 12197,
            [EquipSlot.AMULET]: 12201,
        },
        bonus: { area: 0.15 },
        unlock: { kind: "killBoss", mapId: "barrows", enemyId: "ahrim" },
    },
    {
        id: "hunter",
        name: "Hunter",
        description: "Starts with a shortbow. Picks things up from 50% further away.",
        style: "ranged",
        startingWeapon: "shortbow",
        // Larupia hunter gear
        equipment: {
            [EquipSlot.HEAD]: 10045,
            [EquipSlot.TORSO]: 10043,
            [EquipSlot.LEGS]: 10041,
        },
        bonus: { magnet: 0.5 },
        unlock: { kind: "beatMap", mapId: "barrows" },
    },
    {
        id: "rogue",
        name: "Rogue",
        description: "Starts with bronze throwing knives. Finds 25% more coins and is luckier.",
        style: "ranged",
        startingWeapon: "throwing_knives",
        // The Rogues' Den outfit
        equipment: {
            [EquipSlot.HEAD]: 5554,
            [EquipSlot.TORSO]: 5553,
            [EquipSlot.LEGS]: 5555,
            [EquipSlot.HANDS]: 5556,
            [EquipSlot.FEET]: 5557,
        },
        bonus: { greed: 0.25, luck: 0.1 },
        unlock: { kind: "survive", mapId: "wilderness", seconds: 600 },
    },
    {
        id: "dragon_slayer",
        name: "Dragon slayer",
        description: "Starts with a bronze scimitar. Hits 15% harder.",
        style: "melee",
        startingWeapon: "scimitar",
        // Rune, and the anti-dragon shield from the Dragon Slayer quest
        equipment: {
            [EquipSlot.HEAD]: 1149,
            [EquipSlot.TORSO]: 1127,
            [EquipSlot.LEGS]: 1079,
            [EquipSlot.SHIELD]: 1540,
        },
        bonus: { might: 0.15 },
        unlock: { kind: "beatMap", mapId: "wilderness" },
    },
    {
        id: "nomad",
        name: "Nomad",
        description: "Starts with bronze throwing axes. Moves 5% faster and hits 10% harder.",
        style: "ranged",
        startingWeapon: "throwing_axes",
        // Desert robes
        equipment: {
            [EquipSlot.TORSO]: 1833,
            [EquipSlot.LEGS]: 1835,
            [EquipSlot.FEET]: 1837,
        },
        bonus: { moveSpeed: 0.05, might: 0.1 },
        unlock: { kind: "beatMap", mapId: "desert" },
    },
    {
        id: "menaphite",
        name: "Menaphite",
        description: "Starts with Smoke Burst. Gains 15% more experience.",
        style: "magic",
        startingWeapon: "smoke_burst",
        // Menaphite robes
        equipment: {
            [EquipSlot.HEAD]: 6392,
            [EquipSlot.TORSO]: 6394,
            [EquipSlot.LEGS]: 6396,
        },
        bonus: { growth: 0.15 },
        unlock: { kind: "killBoss", mapId: "desert", enemyId: "damis_risen" },
    },
    {
        id: "seer",
        name: "Seer",
        description: "Starts with elemental runes. Effects last 25% longer.",
        style: "magic",
        startingWeapon: "elemental_runes",
        // A farseer helm and skeletal robes
        equipment: {
            [EquipSlot.HEAD]: 3755,
            [EquipSlot.TORSO]: 6139,
            [EquipSlot.LEGS]: 6141,
        },
        bonus: { duration: 0.25 },
        unlock: { kind: "beatMap", mapId: "fremennik" },
    },
    {
        id: "berserker",
        name: "Berserker",
        description: "Starts with a bronze 2h sword. Takes 0.5 less damage and hits back for 3.",
        style: "melee",
        startingWeapon: "two_handed_sword",
        // A helm of neitiznot, yak-hide armour and Fremennik boots
        equipment: {
            [EquipSlot.HEAD]: 10828,
            [EquipSlot.TORSO]: 10822,
            [EquipSlot.LEGS]: 10824,
            [EquipSlot.FEET]: 3791,
        },
        bonus: { armor: 0.5, thorns: 3 },
        unlock: { kind: "killBoss", mapId: "fremennik", enemyId: "dagannoth_rex" },
    },
    {
        id: "obby_mauler",
        name: "Obby mauler",
        description: "Starts with a Tzhaar-ket-om. Hits 10% harder and has 10% more hitpoints.",
        style: "melee",
        startingWeapon: "tzhaar_ket_om",
        // Obsidian armour and a fire cape
        equipment: {
            [EquipSlot.HEAD]: 21298,
            [EquipSlot.TORSO]: 21301,
            [EquipSlot.LEGS]: 21304,
            [EquipSlot.CAPE]: 6570,
        },
        bonus: { might: 0.1, maxHp: 0.1 },
        unlock: { kind: "beatMap", mapId: "karamja" },
    },
    {
        id: "pirate",
        name: "Pirate",
        description: "Starts with bronze throwing knives. One more reroll a run, and 5% luckier.",
        style: "ranged",
        startingWeapon: "throwing_knives",
        // A pirate's bandana, stripy shirt, leggings and boots
        equipment: {
            [EquipSlot.HEAD]: 7112,
            [EquipSlot.TORSO]: 7110,
            [EquipSlot.LEGS]: 7116,
            [EquipSlot.FEET]: 7114,
        },
        bonus: { reroll: 1, luck: 0.05 },
        unlock: { kind: "survive", mapId: "karamja", seconds: 780 },
    },
    {
        id: "pyromancer",
        name: "Pyromancer",
        description: "Starts with Fire Strike. Comes back to life once a run, like a phoenix.",
        style: "magic",
        startingWeapon: "fire_spells",
        // The Wintertodt's pyromancer outfit
        equipment: {
            [EquipSlot.HEAD]: 20708,
            [EquipSlot.TORSO]: 20704,
            [EquipSlot.LEGS]: 20706,
            [EquipSlot.FEET]: 20710,
        },
        bonus: { revival: 1 },
        unlock: { kind: "beatMap", mapId: "kourend" },
    },
    {
        id: "shayzien_soldier",
        name: "Shayzien soldier",
        description:
            "Starts with a bronze scimitar. Takes 0.5 less damage and heals 3 hitpoints a minute.",
        style: "melee",
        startingWeapon: "scimitar",
        // Shayzien armour
        equipment: {
            [EquipSlot.HEAD]: 13379,
            [EquipSlot.TORSO]: 13381,
            [EquipSlot.LEGS]: 13380,
            [EquipSlot.HANDS]: 13377,
            [EquipSlot.FEET]: 13378,
        },
        bonus: { armor: 0.5, regen: 3 },
        unlock: { kind: "killBoss", mapId: "kourend", enemyId: "sarachnis" },
    },
    {
        id: "gladiator",
        name: "Gladiator",
        description: "Starts with a dual macuahuitl. Weapons are 10% faster and hit 5% harder.",
        style: "melee",
        startingWeapon: "dual_macuahuitl",
        // Sunfire fanatic armour
        equipment: {
            [EquipSlot.HEAD]: 28933,
            [EquipSlot.TORSO]: 28936,
            [EquipSlot.LEGS]: 28939,
        },
        bonus: { cooldown: 0.1, might: 0.05 },
        unlock: { kind: "beatMap", mapId: "varlamore" },
    },
    {
        id: "javelineer",
        name: "Javelineer",
        description:
            "Starts with an eclipse atlatl. Projectiles fly 20% faster, and areas are 10% bigger.",
        style: "ranged",
        startingWeapon: "eclipse_atlatl",
        // Eclipse moon armour
        equipment: {
            [EquipSlot.HEAD]: 29010,
            [EquipSlot.TORSO]: 29004,
            [EquipSlot.LEGS]: 29007,
        },
        bonus: { speed: 0.2, area: 0.1 },
        unlock: { kind: "killBoss", mapId: "varlamore", enemyId: "javelin_colossus" },
    },
    {
        id: "vampyre_hunter",
        name: "Vampyre hunter",
        description: "Starts with the Ivandis flail. Hits bosses 25% harder.",
        style: "melee",
        startingWeapon: "ivandis_flail",
        // The vyrewatch disguise the Myreque wear in Darkmeyer, and a salve
        // amulet against the undead
        equipment: {
            [EquipSlot.TORSO]: 9634,
            [EquipSlot.LEGS]: 9636,
            [EquipSlot.FEET]: 9638,
            [EquipSlot.AMULET]: 10588,
        },
        bonus: { bossMight: 0.25 },
        unlock: { kind: "beatMap", mapId: "morytania" },
    },
    {
        id: "werewolf",
        name: "Werewolf",
        description:
            "Starts with dragon claws. Heals off its hits now and then, and moves 5% faster.",
        style: "melee",
        startingWeapon: "dragon_claws",
        // A wolf mask and cloak
        equipment: {
            [EquipSlot.HEAD]: 23407,
            [EquipSlot.CAPE]: 23410,
        },
        // The Amulet of blood fury's chance to heal on a hit
        bonus: { healChance: 0.2, moveSpeed: 0.05 },
        unlock: { kind: "killBoss", mapId: "morytania", enemyId: "pestilent_bloat" },
    },
    {
        id: "godsword_knight",
        name: "Godsword knight",
        description:
            "Starts with a godsword, and picks its hilt. Takes 1 less damage, but weapons are 5% slower.",
        style: "melee",
        startingWeapon: "godsword",
        // Bandos armour, from the general's own army
        equipment: {
            [EquipSlot.TORSO]: 11832,
            [EquipSlot.LEGS]: 11834,
            [EquipSlot.FEET]: 11836,
        },
        bonus: { armor: 1, cooldown: -0.05 },
        unlock: { kind: "beatMap", mapId: "god_wars" },
    },
    {
        id: "armadyl_ranger",
        name: "Armadyl ranger",
        description:
            "Starts with an Armadyl crossbow. Ranged weapons hit 10% harder, and projectiles fly 15% faster.",
        style: "ranged",
        startingWeapon: "armadyl_crossbow",
        // Armadyl armour
        equipment: {
            [EquipSlot.HEAD]: 11826,
            [EquipSlot.TORSO]: 11828,
            [EquipSlot.LEGS]: 11830,
        },
        bonus: { rangedMight: 0.1, speed: 0.15 },
        unlock: { kind: "killBoss", mapId: "god_wars", enemyId: "kreearra" },
    },
    {
        id: "elf_archer",
        name: "Elf archer",
        description:
            "Starts with a crystal bow. Moves 10% faster, and ranged weapons hit 5% harder.",
        style: "ranged",
        startingWeapon: "crystal_bow",
        // Elven clothes
        equipment: {
            [EquipSlot.TORSO]: 24021,
            [EquipSlot.LEGS]: 24024,
            [EquipSlot.FEET]: 24003,
        },
        bonus: { moveSpeed: 0.1, rangedMight: 0.05 },
        unlock: { kind: "beatMap", mapId: "prifddinas" },
    },
    {
        id: "gauntlet_runner",
        name: "Gauntlet runner",
        description:
            "Starts with a crystal staff, and 30% weaker, but hits 2% harder with every level, up to 50% harder at level 41.",
        style: "magic",
        startingWeapon: "crystal_staff",
        // Perfected corrupted armour from the Corrupted Gauntlet, and its cape
        equipment: {
            [EquipSlot.HEAD]: 23842,
            [EquipSlot.TORSO]: 23845,
            [EquipSlot.LEGS]: 23848,
            [EquipSlot.CAPE]: 23859,
        },
        bonus: { might: -0.3, levelMight: 0.02 },
        unlock: { kind: "survive", mapId: "prifddinas", seconds: 10 * 60 },
    },
    {
        id: "infernal_champion",
        name: "Infernal champion",
        description:
            "Starts with a toxic blowpipe, the Inferno's favourite. Has 20% more hitpoints.",
        style: "ranged",
        startingWeapon: "toxic_blowpipe",
        // The infernal cape, black d'hide, pegasian boots and a necklace of
        // anguish: what the Inferno is done in
        equipment: {
            [EquipSlot.CAPE]: 21295,
            [EquipSlot.TORSO]: 2503,
            [EquipSlot.LEGS]: 2497,
            [EquipSlot.FEET]: 13237,
            [EquipSlot.AMULET]: 19547,
        },
        bonus: { maxHp: 0.2 },
        unlock: { kind: "beatMap", mapId: "inferno" },
    },
    {
        id: "tzhaar_hur",
        name: "TzHaar-Hur",
        description: "Starts with a Toktz-mej-tal, the obsidian staff. Areas are 15% bigger.",
        style: "magic",
        startingWeapon: "toktz_mej_tal",
        // Dark mystic robes and an obsidian cape
        equipment: {
            [EquipSlot.HEAD]: 4099,
            [EquipSlot.TORSO]: 4101,
            [EquipSlot.LEGS]: 4103,
            [EquipSlot.CAPE]: 6568,
        },
        bonus: { area: 0.15 },
        unlock: { kind: "killBoss", mapId: "inferno", enemyId: "jaltok_jad" },
    },
    // The fun maps' adventurers, one for a task on each
    {
        id: "scammer",
        name: "Scammer",
        description: "Starts with bronze throwing knives. 50% more coins, and luckier. Trust them.",
        style: "ranged",
        startingWeapon: "throwing_knives",
        // A partyhat and gilded armour, to look trustworthy
        equipment: {
            [EquipSlot.HEAD]: FUN_ITEMS.partyhats[0],
            [EquipSlot.TORSO]: FUN_ITEMS.gildedPlatebody,
            [EquipSlot.LEGS]: FUN_ITEMS.gildedPlatelegs,
            [EquipSlot.AMULET]: FUN_ITEMS.amuletOfGlory,
        },
        bonus: { greed: 0.5, luck: 0.1 },
        unlock: { kind: "survive", mapId: "grand_exchange", seconds: 10 * 60 },
    },
    {
        id: "f2p_pker",
        name: "F2P pker",
        description: "Starts with a bronze 2h sword. Hits 10% harder and moves 5% faster.",
        style: "melee",
        startingWeapon: "two_handed_sword",
        // Rune, green d'hide and a team cape: nothing members get
        equipment: {
            [EquipSlot.HEAD]: FUN_ITEMS.runeFullHelm,
            [EquipSlot.TORSO]: FUN_ITEMS.greenDhideBody,
            [EquipSlot.LEGS]: FUN_ITEMS.runePlatelegs,
            [EquipSlot.AMULET]: FUN_ITEMS.amuletOfStrength,
            [EquipSlot.CAPE]: FUN_ITEMS.teamCapes[0],
        },
        bonus: { might: 0.1, moveSpeed: 0.05 },
        unlock: { kind: "killBoss", mapId: "east_varrock", enemyId: "clan_leader" },
    },
    {
        id: "durial321",
        name: "Durial321",
        description:
            "Starts with the Abyssal whip, but has 30% less hitpoints. Everyone plays him in Falador.",
        style: "melee",
        startingWeapon: "abyssal_whip",
        equipment: DURIAL_EQUIPMENT,
        kits: DURIAL_KITS,
        colors: DURIAL_COLORS,
        bonus: { maxHp: -0.3 },
        // Six minutes and six seconds, for 6/6/06
        unlock: { kind: "survive", mapId: "falador", seconds: 6 * 60 + 6 },
    },
    {
        id: "lms_sweat",
        name: "LMS sweat",
        description: "Starts with Ice Burst. Weapons are 10% faster, and areas are 10% bigger.",
        style: "magic",
        startingWeapon: "ice_burst",
        // The Last Man Standing mage loadout
        equipment: {
            [EquipSlot.HEAD]: FUN_ITEMS.helmOfNeitiznot,
            [EquipSlot.CAPE]: FUN_ITEMS.imbuedGuthixCape,
            [EquipSlot.AMULET]: FUN_ITEMS.amuletOfGlory,
            [EquipSlot.TORSO]: FUN_ITEMS.mysticRobeTop,
            [EquipSlot.LEGS]: FUN_ITEMS.mysticRobeBottom,
            [EquipSlot.HANDS]: FUN_ITEMS.barrowsGloves,
            [EquipSlot.FEET]: FUN_ITEMS.climbingBoots,
            [EquipSlot.SHIELD]: FUN_ITEMS.unholyBook,
        },
        bonus: { cooldown: 0.1, area: 0.1 },
        unlock: { kind: "killBoss", mapId: "last_man_standing", enemyId: "ags_specer" },
    },
    {
        id: "castle_wars_veteran",
        name: "Castle Wars veteran",
        description:
            "Starts with a bronze 2h sword. Bandages heal 3 hitpoints a minute, and has 10% more hitpoints.",
        style: "melee",
        startingWeapon: "two_handed_sword",
        // Gold decorative armour, a thousand games' worth of tickets, and the
        // Saradomin team's hood and cloak
        equipment: {
            [EquipSlot.HEAD]: FUN_ITEMS.saradominHood,
            [EquipSlot.CAPE]: FUN_ITEMS.saradominCloak,
            [EquipSlot.TORSO]: FUN_ITEMS.goldDecorativeArmourTop,
            [EquipSlot.LEGS]: FUN_ITEMS.goldDecorativeArmourLegs,
            [EquipSlot.SHIELD]: FUN_ITEMS.goldDecorativeShield,
        },
        bonus: { regen: 3, maxHp: 0.1 },
        unlock: { kind: "killBoss", mapId: "castle_wars", enemyId: "flag_carrier" },
    },
    {
        id: "void_knight",
        name: "Void knight",
        description:
            "Starts with a bronze scimitar, in the Void knight's equipment. Hits 10% harder.",
        style: "melee",
        startingWeapon: "scimitar",
        // The Void knight set, which is where the bonus comes from in OSRS
        equipment: {
            [EquipSlot.HEAD]: 11665,
            [EquipSlot.TORSO]: 8839,
            [EquipSlot.LEGS]: 8840,
            [EquipSlot.HANDS]: 8842,
        },
        bonus: { might: 0.1 },
        unlock: { kind: "killBoss", mapId: "pest_control", enemyId: "purple_portal" },
    },
    {
        id: "inquisitor",
        name: "Inquisitor",
        description:
            "Made for Phosani's Nightmare, and everyone plays them there, and nowhere else: " +
            "starts with the Armadyl crossbow, moves 20% faster and has 20% more hitpoints.",
        style: "ranged",
        startingWeapon: "armadyl_crossbow",
        // The Inquisitor's armour, her own drop, with Barrows gloves and climbing boots
        equipment: {
            [EquipSlot.HEAD]: 24419,
            [EquipSlot.TORSO]: 24420,
            [EquipSlot.LEGS]: 24421,
            [EquipSlot.HANDS]: FUN_ITEMS.barrowsGloves,
            [EquipSlot.FEET]: FUN_ITEMS.climbingBoots,
        },
        // A fight that's all dodging and one boss: feet, and hitpoints to learn
        // her on. The damage is the crossbow's alone, at the level the map says.
        bonus: { moveSpeed: 0.2, maxHp: 0.2 },
        // Hers alone: never in the roster, and no reward for beating her
        only: "phosani",
    },
];

export const CHARACTER_BY_ID: Map<string, CharacterDef> = new Map(CHARACTERS.map((c) => [c.id, c]));

export function getCharacter(id: string): CharacterDef {
    const character = CHARACTER_BY_ID.get(id);
    if (!character) {
        throw new Error("Unknown character " + id);
    }
    return character;
}
