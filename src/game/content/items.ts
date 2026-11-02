import { EquipSlot } from "../../rs/model/player/PlayerModelLoader";
import {
    CasketDef,
    CasketTier,
    GearDef,
    GearSlot,
    ItemDef,
    StatKey,
    Stats,
    UnlockTask,
    UtilityDef,
} from "./types";

// Items found in reward caskets. Gear is worn for the rest of the run (and
// shows on the character); utility items go in the inventory and are used
// when the player wants.
//
// A piece of gear's rarity is its quality: rarer pieces are worth more and
// often add more than one stat. As a rough scale, +5% damage, +0.5 armour, +4%
// weapon speed and +10% max hitpoints are each worth about the same, and a
// Common piece is worth about one Common passive pick.

export const GEAR_SLOTS: { id: GearSlot; name: string; equipSlot?: EquipSlot }[] = [
    { id: "head", name: "Head", equipSlot: EquipSlot.HEAD },
    { id: "cape", name: "Cape", equipSlot: EquipSlot.CAPE },
    { id: "neck", name: "Neck", equipSlot: EquipSlot.AMULET },
    { id: "body", name: "Body", equipSlot: EquipSlot.TORSO },
    { id: "shield", name: "Shield", equipSlot: EquipSlot.SHIELD },
    { id: "legs", name: "Legs", equipSlot: EquipSlot.LEGS },
    { id: "hands", name: "Hands", equipSlot: EquipSlot.HANDS },
    { id: "feet", name: "Feet", equipSlot: EquipSlot.FEET },
    // Rings aren't drawn on players
    { id: "ring", name: "Ring" },
];

export const GEAR_SLOT_BY_ID: Map<GearSlot, (typeof GEAR_SLOTS)[number]> = new Map(
    GEAR_SLOTS.map((s) => [s.id, s]),
);

function gear(
    id: string,
    name: string,
    objId: number,
    slot: GearSlot,
    rarity: GearDef["rarity"],
    stats: Partial<Stats>,
): GearDef {
    return { kind: "gear", id, name, objId, slot, rarity, stats };
}

// A piece of one of the sets in sets.ts. Pieces are a little weaker than
// others of their rarity: the set's bonus makes up for it.
function setPiece(set: string, ...args: Parameters<typeof gear>): GearDef {
    return { ...gear(...args), set };
}

// Nex's own gear (Torva, Virtus and the Zaryte vambraces) comes in once she's
// been beaten: killed in her last form
const NEX_KILL: UnlockTask = { kind: "killBoss", mapId: "god_wars", enemyId: "nex_ice" };
// Crystal armour comes in once Prifddinas has been beaten
const PRIFDDINAS_BEATEN: UnlockTask = { kind: "beatMap", mapId: "prifddinas" };

// The gear that turns up in caskets
export const CASKET_GEAR: GearDef[] = [
    // Head
    gear("rune_full_helm", "Rune full helm", 1163, "head", "common", { armor: 0.5 }),
    gear("coif", "Coif", 1169, "head", "common", { speed: 0.1 }),
    gear("mystic_hat", "Mystic hat", 4089, "head", "uncommon", { cooldown: 0.04, duration: 0.1 }),
    gear("helm_of_neitiznot", "Helm of neitiznot", 10828, "head", "uncommon", {
        might: 0.04,
        armor: 0.5,
    }),
    gear("farseer_helm", "Farseer helm", 3755, "head", "rare", { cooldown: 0.05, area: 0.1 }),
    gear("berserker_helm", "Berserker helm", 3751, "head", "rare", { might: 0.08, armor: 0.5 }),
    gear("armadyl_helmet", "Armadyl helmet", 11826, "head", "rare", {
        might: 0.05,
        speed: 0.15,
        moveSpeed: 0.03,
    }),
    gear("slayer_helmet", "Slayer helmet", 11864, "head", "veryRare", {
        might: 0.1,
        armor: 0.5,
        luck: 0.15,
    }),
    gear("ancestral_hat", "Ancestral hat", 21018, "head", "veryRare", {
        might: 0.08,
        area: 0.12,
        cooldown: 0.03,
    }),
    gear("justiciar_faceguard", "Justiciar faceguard", 22326, "head", "veryRare", {
        armor: 1.5,
        maxHp: 0.1,
    }),
    gear("neitiznot_faceguard", "Neitiznot faceguard", 24271, "head", "veryRare", {
        might: 0.08,
        armor: 1,
        maxHp: 0.05,
    }),

    // Cape
    gear("obsidian_cape", "Obsidian cape", 6568, "cape", "common", { armor: 0.5 }),
    gear("ardougne_cloak", "Ardougne cloak", 13121, "cape", "common", { luck: 0.1 }),
    gear("cape_of_legends", "Cape of legends", 1052, "cape", "common", { maxHp: 0.1 }),
    gear("avas_accumulator", "Ava's accumulator", 10499, "cape", "uncommon", {
        speed: 0.1,
        magnet: 0.3,
    }),
    gear("zamorak_cape", "Zamorak cape", 2414, "cape", "uncommon", { might: 0.05, cooldown: 0.02 }),
    gear("guthix_cape", "Guthix cape", 2413, "cape", "uncommon", { regen: 3, maxHp: 0.05 }),
    gear("saradomin_cape", "Saradomin cape", 2412, "cape", "rare", { area: 0.1, duration: 0.15 }),
    gear("avas_assembler", "Ava's assembler", 22109, "cape", "rare", {
        might: 0.04,
        speed: 0.15,
        magnet: 0.4,
    }),
    gear("fire_cape", "Fire cape", 6570, "cape", "veryRare", { might: 0.1, armor: 1 }),
    gear("infernal_cape", "Infernal cape", 21295, "cape", "veryRare", {
        might: 0.12,
        armor: 1,
        maxHp: 0.05,
    }),

    // Neck
    gear("amulet_of_strength", "Amulet of strength", 1725, "neck", "common", { might: 0.05 }),
    gear("amulet_of_magic", "Amulet of magic", 1727, "neck", "common", { area: 0.08 }),
    gear("amulet_of_defence", "Amulet of defence", 1729, "neck", "common", { armor: 0.5 }),
    gear("amulet_of_power", "Amulet of power", 1731, "neck", "uncommon", {
        might: 0.04,
        cooldown: 0.03,
    }),
    gear("amulet_of_avarice", "Amulet of avarice", 22557, "neck", "uncommon", {
        luck: 0.05,
        greed: 0.3,
    }),
    gear("phoenix_necklace", "Phoenix necklace", 11090, "neck", "uncommon", {
        maxHp: 0.1,
        regen: 2,
    }),
    gear("occult_necklace", "Occult necklace", 12002, "neck", "rare", { might: 0.06, area: 0.12 }),
    gear("amulet_of_fury", "Amulet of fury", 6585, "neck", "rare", {
        might: 0.06,
        armor: 0.5,
        maxHp: 0.1,
    }),
    // A hit has this chance of healing you (see Sim's BLOOD_FURY_HEAL)
    gear("amulet_of_blood_fury", "Amulet of blood fury", 24780, "neck", "rare", {
        might: 0.04,
        healChance: 0.2,
    }),
    gear("amulet_of_torture", "Amulet of torture", 19553, "neck", "veryRare", {
        might: 0.15,
        cooldown: 0.04,
    }),
    gear("necklace_of_anguish", "Necklace of anguish", 19547, "neck", "veryRare", {
        might: 0.1,
        speed: 0.15,
        cooldown: 0.03,
    }),
    gear("amulet_of_rancour", "Amulet of rancour", 29801, "neck", "veryRare", {
        might: 0.1,
        meleeMight: 0.12,
        cooldown: 0.02,
    }),

    // Body
    gear("rune_chainbody", "Rune chainbody", 1113, "body", "common", { maxHp: 0.15 }),
    gear("rune_platebody", "Rune platebody", 1127, "body", "common", { armor: 0.5 }),
    gear("mystic_robe_top", "Mystic robe top", 4091, "body", "uncommon", {
        cooldown: 0.05,
        duration: 0.1,
    }),
    gear("black_dhide_body", "Black d'hide body", 2503, "body", "uncommon", {
        speed: 0.15,
        moveSpeed: 0.05,
    }),
    gear("ahrims_robetop", "Ahrim's robetop", 4712, "body", "uncommon", {
        area: 0.08,
        maxHp: 0.08,
    }),
    gear("fighter_torso", "Fighter torso", 10551, "body", "rare", { might: 0.08, armor: 0.5 }),
    gear("karils_leathertop", "Karil's leathertop", 4736, "body", "rare", {
        might: 0.03,
        speed: 0.15,
        moveSpeed: 0.05,
    }),
    gear("dharoks_platebody", "Dharok's platebody", 4720, "body", "rare", { armor: 1, maxHp: 0.1 }),
    gear("bandos_chestplate", "Bandos chestplate", 11832, "body", "veryRare", {
        might: 0.05,
        armor: 1.5,
        maxHp: 0.15,
    }),
    gear("armadyl_chestplate", "Armadyl chestplate", 11828, "body", "veryRare", {
        might: 0.08,
        speed: 0.2,
        moveSpeed: 0.05,
    }),
    gear("ancestral_robe_top", "Ancestral robe top", 21021, "body", "veryRare", {
        might: 0.08,
        area: 0.15,
        duration: 0.1,
    }),

    // Shield
    gear("rune_kiteshield", "Rune kiteshield", 1201, "shield", "common", { armor: 0.5 }),
    gear("antidragon_shield", "Anti-dragon shield", 1540, "shield", "uncommon", {
        armor: 0.5,
        maxHp: 0.1,
    }),
    gear("book_of_law", "Book of law", 12610, "shield", "uncommon", {
        area: 0.08,
        duration: 0.1,
    }),
    gear("dragon_sq_shield", "Dragon sq shield", 1187, "shield", "uncommon", { armor: 1 }),
    gear("mages_book", "Mage's book", 6889, "shield", "uncommon", { cooldown: 0.04, area: 0.05 }),
    gear("rune_defender", "Rune defender", 8850, "shield", "rare", { might: 0.06, armor: 0.5 }),
    gear("toktz_ket_xil", "Toktz-ket-xil", 6524, "shield", "rare", { armor: 1, thorns: 4 }),
    {
        ...gear("dragonfire_shield", "Dragonfire shield", 11283, "shield", "veryRare", {
            armor: 1.5,
            thorns: 8,
        }),
        unlock: { kind: "killBoss", mapId: "karamja", enemyId: "elvarg" },
    },
    gear("arcane_spirit_shield", "Arcane spirit shield", 12825, "shield", "rare", {
        might: 0.05,
        area: 0.1,
        armor: 0.5,
    }),
    gear("dragon_defender", "Dragon defender", 12954, "shield", "veryRare", {
        might: 0.1,
        armor: 0.5,
        cooldown: 0.03,
    }),
    gear("avernic_defender", "Avernic defender", 22322, "shield", "veryRare", {
        might: 0.12,
        armor: 0.5,
        cooldown: 0.04,
    }),
    gear("elysian_spirit_shield", "Elysian spirit shield", 12817, "shield", "veryRare", {
        armor: 1.5,
        maxHp: 0.15,
    }),
    gear("twisted_buckler", "Twisted buckler", 21000, "shield", "rare", {
        rangedMight: 0.1,
        armor: 0.5,
        speed: 0.1,
    }),

    // Legs
    gear("rune_platelegs", "Rune platelegs", 1079, "legs", "common", { armor: 0.5 }),
    gear("black_dhide_chaps", "Black d'hide chaps", 2497, "legs", "common", { moveSpeed: 0.05 }),
    gear("rune_plateskirt", "Rune plateskirt", 1093, "legs", "common", { maxHp: 0.1 }),
    gear("mystic_robe_bottom", "Mystic robe bottom", 4093, "legs", "uncommon", {
        area: 0.05,
        duration: 0.15,
    }),
    gear("ahrims_robeskirt", "Ahrim's robeskirt", 4714, "legs", "uncommon", {
        area: 0.06,
        cooldown: 0.03,
    }),
    gear("dragon_platelegs", "Dragon platelegs", 4087, "legs", "rare", { might: 0.04, armor: 1 }),
    gear("veracs_plateskirt", "Verac's plateskirt", 4759, "legs", "rare", { armor: 1, regen: 3 }),
    gear("bandos_tassets", "Bandos tassets", 11834, "legs", "veryRare", { might: 0.1, armor: 1 }),
    gear("armadyl_chainskirt", "Armadyl chainskirt", 11830, "legs", "veryRare", {
        might: 0.08,
        speed: 0.15,
        moveSpeed: 0.05,
    }),
    gear("ancestral_robe_bottom", "Ancestral robe bottom", 21024, "legs", "veryRare", {
        might: 0.07,
        area: 0.1,
        cooldown: 0.03,
    }),

    // Hands
    gear("mithril_gloves", "Mithril gloves", 7458, "hands", "common", { might: 0.04 }),
    gear("leather_gloves", "Leather gloves", 1059, "hands", "common", { cooldown: 0.04 }),
    gear("regen_bracelet", "Regen bracelet", 11133, "hands", "uncommon", { regen: 4.5 }),
    gear("rune_gloves", "Rune gloves", 7460, "hands", "uncommon", { might: 0.05, cooldown: 0.02 }),
    gear("dragon_gloves", "Dragon gloves", 7461, "hands", "rare", { might: 0.06, cooldown: 0.03 }),
    gear("infinity_gloves", "Infinity gloves", 6922, "hands", "rare", {
        area: 0.1,
        duration: 0.15,
    }),
    gear("barrows_gloves", "Barrows gloves", 7462, "hands", "veryRare", {
        might: 0.08,
        armor: 0.5,
        cooldown: 0.05,
    }),
    gear("tormented_bracelet", "Tormented bracelet", 19544, "hands", "veryRare", {
        might: 0.08,
        area: 0.1,
        cooldown: 0.04,
    }),
    gear("ferocious_gloves", "Ferocious gloves", 22981, "hands", "veryRare", {
        might: 0.12,
        armor: 0.5,
    }),
    {
        ...gear("zaryte_vambraces", "Zaryte vambraces", 26235, "hands", "veryRare", {
            might: 0.05,
            rangedMight: 0.15,
            speed: 0.1,
        }),
        unlock: NEX_KILL,
    },

    // Feet
    gear("climbing_boots", "Climbing boots", 3105, "feet", "common", { moveSpeed: 0.05 }),
    gear("rune_boots", "Rune boots", 4131, "feet", "common", { armor: 0.5 }),
    gear("boots_of_lightness", "Boots of lightness", 88, "feet", "uncommon", {
        moveSpeed: 0.1,
        magnet: 0.1,
    }),
    gear("infinity_boots", "Infinity boots", 6920, "feet", "uncommon", {
        area: 0.05,
        duration: 0.1,
    }),
    gear("dragon_boots", "Dragon boots", 11840, "feet", "rare", { might: 0.07, armor: 0.5 }),
    gear("ranger_boots", "Ranger boots", 2577, "feet", "rare", {
        cooldown: 0.02,
        speed: 0.15,
        moveSpeed: 0.06,
    }),
    gear("bandos_boots", "Bandos boots", 11836, "feet", "rare", { might: 0.03, armor: 1 }),
    gear("primordial_boots", "Primordial boots", 13239, "feet", "veryRare", {
        might: 0.1,
        armor: 0.5,
        moveSpeed: 0.05,
    }),
    gear("pegasian_boots", "Pegasian boots", 13237, "feet", "veryRare", {
        might: 0.08,
        speed: 0.2,
        moveSpeed: 0.08,
    }),
    gear("eternal_boots", "Eternal boots", 13235, "feet", "veryRare", {
        might: 0.07,
        area: 0.1,
        duration: 0.15,
    }),

    // Ring
    gear("ring_of_recoil", "Ring of recoil", 2550, "ring", "common", { thorns: 4 }),
    gear("explorers_ring", "Explorer's ring", 13125, "ring", "common", {
        regen: 2,
        moveSpeed: 0.03,
    }),
    gear("ring_of_dueling", "Ring of dueling", 2552, "ring", "common", {
        moveSpeed: 0.03,
        magnet: 0.15,
    }),
    gear("seers_ring", "Seers ring", 6731, "ring", "uncommon", { cooldown: 0.05 }),
    gear("warrior_ring", "Warrior ring", 6735, "ring", "uncommon", { might: 0.06 }),
    gear("archers_ring", "Archers ring", 6733, "ring", "uncommon", { cooldown: 0.02, speed: 0.15 }),
    gear("berserker_ring", "Berserker ring", 6737, "ring", "rare", { might: 0.1 }),
    gear("ring_of_the_gods", "Ring of the gods", 12601, "ring", "rare", {
        luck: 0.2,
        growth: 0.05,
    }),
    gear("tyrannical_ring", "Tyrannical ring", 12603, "ring", "rare", { might: 0.06, armor: 0.5 }),
    gear("treasonous_ring", "Treasonous ring", 12605, "ring", "rare", {
        might: 0.03,
        cooldown: 0.06,
    }),
    gear("ring_of_suffering", "Ring of suffering", 19550, "ring", "veryRare", {
        armor: 1,
        maxHp: 0.1,
        thorns: 10,
    }),
    gear("lightbearer", "Lightbearer", 25975, "ring", "veryRare", {
        cooldown: 0.08,
        duration: 0.2,
    }),
    // Desert Treasure II's rings, one for each style (and the Bellator ring
    // for melee's speed)
    gear("ultor_ring", "Ultor ring", 28307, "ring", "veryRare", { might: 0.04, meleeMight: 0.2 }),
    gear("venator_ring", "Venator ring", 28310, "ring", "veryRare", {
        rangedMight: 0.2,
        speed: 0.15,
    }),
    gear("magus_ring", "Magus ring", 28313, "ring", "veryRare", {
        magicMight: 0.2,
        duration: 0.1,
    }),
    gear("bellator_ring", "Bellator ring", 28316, "ring", "veryRare", {
        meleeMight: 0.1,
        cooldown: 0.05,
        armor: 0.5,
    }),

    // Sets (see sets.ts). Pest Control's Void knight equipment.
    setPiece("void_knight", "void_melee_helm", "Void melee helm", 11665, "head", "uncommon", {
        might: 0.03,
        armor: 0.5,
    }),
    setPiece("void_knight", "void_knight_top", "Void knight top", 8839, "body", "uncommon", {
        might: 0.03,
        maxHp: 0.08,
    }),
    setPiece("void_knight", "void_knight_robe", "Void knight robe", 8840, "legs", "uncommon", {
        might: 0.03,
        armor: 0.5,
    }),
    setPiece("void_knight", "void_knight_gloves", "Void knight gloves", 8842, "hands", "uncommon", {
        might: 0.03,
        cooldown: 0.03,
    }),
    // The Nightmare's
    setPiece(
        "inquisitors",
        "inquisitors_great_helm",
        "Inquisitor's great helm",
        24419,
        "head",
        "rare",
        { might: 0.06, armor: 0.5 },
    ),
    setPiece("inquisitors", "inquisitors_hauberk", "Inquisitor's hauberk", 24420, "body", "rare", {
        might: 0.06,
        maxHp: 0.1,
    }),
    setPiece(
        "inquisitors",
        "inquisitors_plateskirt",
        "Inquisitor's plateskirt",
        24421,
        "legs",
        "rare",
        { might: 0.05, armor: 0.5 },
    ),
    // Prifddinas's, brought in by beating it
    {
        ...setPiece("crystal_armour", "crystal_helm", "Crystal helm", 23971, "head", "rare", {
            might: 0.04,
            speed: 0.15,
            cooldown: 0.02,
        }),
        unlock: PRIFDDINAS_BEATEN,
    },
    {
        ...setPiece("crystal_armour", "crystal_body", "Crystal body", 23975, "body", "rare", {
            might: 0.05,
            speed: 0.15,
            moveSpeed: 0.03,
        }),
        unlock: PRIFDDINAS_BEATEN,
    },
    {
        ...setPiece("crystal_armour", "crystal_legs", "Crystal legs", 23979, "legs", "rare", {
            might: 0.04,
            speed: 0.1,
            moveSpeed: 0.04,
        }),
        unlock: PRIFDDINAS_BEATEN,
    },
    // Nex's, brought in by beating her: every piece of a set at once, so the
    // casket that offers a set's missing piece always has one to offer
    {
        ...setPiece("torva", "torva_full_helm", "Torva full helm", 26382, "head", "veryRare", {
            might: 0.05,
            armor: 1,
            maxHp: 0.05,
        }),
        unlock: NEX_KILL,
    },
    {
        ...setPiece("torva", "torva_platebody", "Torva platebody", 26384, "body", "veryRare", {
            armor: 1.5,
            maxHp: 0.1,
        }),
        unlock: NEX_KILL,
    },
    {
        ...setPiece("torva", "torva_platelegs", "Torva platelegs", 26386, "legs", "veryRare", {
            might: 0.05,
            armor: 1,
        }),
        unlock: NEX_KILL,
    },
    {
        ...setPiece("virtus", "virtus_mask", "Virtus mask", 26241, "head", "veryRare", {
            might: 0.07,
            area: 0.1,
            duration: 0.1,
        }),
        unlock: NEX_KILL,
    },
    {
        ...setPiece("virtus", "virtus_robe_top", "Virtus robe top", 26243, "body", "veryRare", {
            might: 0.07,
            area: 0.1,
            cooldown: 0.03,
        }),
        unlock: NEX_KILL,
    },
    {
        ...setPiece(
            "virtus",
            "virtus_robe_bottom",
            "Virtus robe bottom",
            26245,
            "legs",
            "veryRare",
            {
                might: 0.06,
                area: 0.08,
                duration: 0.1,
            },
        ),
        unlock: NEX_KILL,
    },
];

// A variant has this much more of each of its piece's stats (a variant of a
// variant, like Ardougne cloak 3 from cloak 2, that much more again)
export const VARIANT_BONUS = 0.25;

// Upgraded versions of the pieces above, made only in the Armoury (see
// armoury.ts): ornament kits, imbues, the next tier of a diary reward, and
// the fortified Masori and Avernic treads. Same slot and rarity as the piece,
// a new look, and more of its stats. (The Amulet of blood fury has nothing to
// become in OSRS, so it goes up in tiers that keep its look.)
function variants(list: { of: string; id: string; name: string; objId: number }[]): GearDef[] {
    const byId = new Map(CASKET_GEAR.map((g) => [g.id, g]));
    return list.map(({ of, id, name, objId }) => {
        const piece = byId.get(of);
        if (!piece) {
            throw new Error(`Variant ${id} of unknown gear ${of}`);
        }
        const stats: Partial<Stats> = {};
        for (const [key, value] of Object.entries(piece.stats) as [StatKey, number][]) {
            stats[key] = value * (1 + VARIANT_BONUS);
        }
        const variant: GearDef = {
            ...gear(id, name, objId, piece.slot, piece.rarity, stats),
            variantOf: of,
            ...(piece.set !== undefined && { set: piece.set }),
        };
        byId.set(id, variant);
        return variant;
    });
}

const VARIANT_GEAR: GearDef[] = variants([
    // Head
    { of: "armadyl_helmet", id: "masori_mask_f", name: "Masori mask (f)", objId: 27235 },
    {
        of: "ancestral_hat",
        id: "twisted_ancestral_hat",
        name: "Twisted ancestral hat",
        objId: 24664,
    },
    { of: "slayer_helmet", id: "black_slayer_helmet", name: "Black slayer helmet", objId: 19639 },

    // Cape
    { of: "infernal_cape", id: "infernal_max_cape", name: "Infernal max cape", objId: 21285 },
    { of: "ardougne_cloak", id: "ardougne_cloak_2", name: "Ardougne cloak 2", objId: 13122 },
    { of: "ardougne_cloak_2", id: "ardougne_cloak_3", name: "Ardougne cloak 3", objId: 13123 },
    { of: "ardougne_cloak_3", id: "ardougne_cloak_4", name: "Ardougne cloak 4", objId: 13124 },
    { of: "guthix_cape", id: "imbued_guthix_cape", name: "Imbued Guthix cape", objId: 21793 },
    { of: "zamorak_cape", id: "imbued_zamorak_cape", name: "Imbued Zamorak cape", objId: 21795 },
    {
        of: "saradomin_cape",
        id: "imbued_saradomin_cape",
        name: "Imbued Saradomin cape",
        objId: 21791,
    },
    { of: "avas_assembler", id: "masori_assembler", name: "Masori assembler", objId: 27374 },

    // Neck
    {
        of: "amulet_of_torture",
        id: "amulet_of_torture_or",
        name: "Amulet of torture (or)",
        objId: 20366,
    },
    { of: "amulet_of_fury", id: "amulet_of_fury_or", name: "Amulet of fury (or)", objId: 12436 },
    {
        of: "occult_necklace",
        id: "occult_necklace_or",
        name: "Occult necklace (or)",
        objId: 19720,
    },
    {
        of: "necklace_of_anguish",
        id: "necklace_of_anguish_or",
        name: "Necklace of anguish (or)",
        objId: 22249,
    },
    {
        of: "amulet_of_rancour",
        id: "amulet_of_rancour_s",
        name: "Amulet of rancour (s)",
        objId: 29804,
    },
    {
        of: "amulet_of_blood_fury",
        id: "amulet_of_blood_fury_2",
        name: "Amulet of blood fury 2",
        objId: 24780,
    },
    {
        of: "amulet_of_blood_fury_2",
        id: "amulet_of_blood_fury_3",
        name: "Amulet of blood fury 3",
        objId: 24780,
    },
    {
        of: "amulet_of_blood_fury_3",
        id: "amulet_of_blood_fury_4",
        name: "Amulet of blood fury 4",
        objId: 24780,
    },

    // Body
    {
        of: "bandos_chestplate",
        id: "bandos_chestplate_or",
        name: "Bandos chestplate (or)",
        objId: 26718,
    },
    { of: "armadyl_chestplate", id: "masori_body_f", name: "Masori body (f)", objId: 27238 },
    {
        of: "ancestral_robe_top",
        id: "twisted_ancestral_robe_top",
        name: "Twisted ancestral robe top",
        objId: 24666,
    },

    // Shield
    {
        of: "avernic_defender",
        id: "ghommals_avernic_defender",
        name: "Ghommal's avernic defender",
        objId: 27552,
    },
    { of: "arcane_spirit_shield", id: "elidinis_ward_f", name: "Elidinis' ward (f)", objId: 27251 },
    { of: "book_of_law", id: "book_of_law_or", name: "Book of law (or)", objId: 26492 },

    // Legs
    { of: "bandos_tassets", id: "bandos_tassets_or", name: "Bandos tassets (or)", objId: 26719 },
    { of: "armadyl_chainskirt", id: "masori_chaps_f", name: "Masori chaps (f)", objId: 27241 },
    {
        of: "ancestral_robe_bottom",
        id: "twisted_ancestral_robe_bottom",
        name: "Twisted ancestral robe bottom",
        objId: 24668,
    },

    // Hands
    {
        of: "tormented_bracelet",
        id: "tormented_bracelet_or",
        name: "Tormented bracelet (or)",
        objId: 23444,
    },

    // Feet: each boss boot's crystal goes into the Avernic treads
    { of: "primordial_boots", id: "avernic_treads_pr", name: "Avernic treads (pr)", objId: 31091 },
    { of: "pegasian_boots", id: "avernic_treads_pe", name: "Avernic treads (pe)", objId: 31092 },
    { of: "eternal_boots", id: "avernic_treads_et", name: "Avernic treads (et)", objId: 31093 },
    { of: "bandos_boots", id: "bandos_boots_or", name: "Bandos boots (or)", objId: 26720 },

    // Ring
    {
        of: "ring_of_suffering",
        id: "ring_of_suffering_i",
        name: "Ring of suffering (i)",
        objId: 19710,
    },
    { of: "explorers_ring", id: "explorers_ring_2", name: "Explorer's ring 2", objId: 13126 },
    { of: "explorers_ring_2", id: "explorers_ring_3", name: "Explorer's ring 3", objId: 13127 },
    { of: "explorers_ring_3", id: "explorers_ring_4", name: "Explorer's ring 4", objId: 13128 },
    { of: "berserker_ring", id: "berserker_ring_i", name: "Berserker ring (i)", objId: 11773 },
    { of: "seers_ring", id: "seers_ring_i", name: "Seers ring (i)", objId: 11770 },
    { of: "archers_ring", id: "archers_ring_i", name: "Archers ring (i)", objId: 11771 },
    {
        of: "ring_of_the_gods",
        id: "ring_of_the_gods_i",
        name: "Ring of the gods (i)",
        objId: 13202,
    },
    { of: "tyrannical_ring", id: "tyrannical_ring_i", name: "Tyrannical ring (i)", objId: 12691 },
    { of: "treasonous_ring", id: "treasonous_ring_i", name: "Treasonous ring (i)", objId: 12692 },

    // Sets: a variant counts as its piece. Elite void (no elite helm or
    // gloves in OSRS) and the Void ornament kit's, the black and red crystal
    // armour (the cache names it plain "Crystal ..."), Sanguine torva, and
    // Nex's Ancient ceremonial robes for the Virtus.
    { of: "void_knight_top", id: "elite_void_top", name: "Elite void top", objId: 13072 },
    { of: "void_knight_robe", id: "elite_void_robe", name: "Elite void robe", objId: 13073 },
    { of: "elite_void_top", id: "elite_void_top_or", name: "Elite void top (or)", objId: 26469 },
    { of: "elite_void_robe", id: "elite_void_robe_or", name: "Elite void robe (or)", objId: 26471 },
    { of: "void_melee_helm", id: "void_melee_helm_or", name: "Void melee helm (or)", objId: 26477 },
    {
        of: "void_knight_gloves",
        id: "void_knight_gloves_or",
        name: "Void knight gloves (or)",
        objId: 26467,
    },
    {
        of: "crystal_helm",
        id: "corrupted_crystal_helm",
        name: "Corrupted crystal helm",
        objId: 33031,
    },
    {
        of: "crystal_body",
        id: "corrupted_crystal_body",
        name: "Corrupted crystal body",
        objId: 33023,
    },
    {
        of: "crystal_legs",
        id: "corrupted_crystal_legs",
        name: "Corrupted crystal legs",
        objId: 33027,
    },
    {
        of: "torva_full_helm",
        id: "sanguine_torva_full_helm",
        name: "Sanguine torva full helm",
        objId: 28254,
    },
    {
        of: "torva_platebody",
        id: "sanguine_torva_platebody",
        name: "Sanguine torva platebody",
        objId: 28256,
    },
    {
        of: "torva_platelegs",
        id: "sanguine_torva_platelegs",
        name: "Sanguine torva platelegs",
        objId: 28258,
    },
    {
        of: "virtus_mask",
        id: "ancient_ceremonial_mask",
        name: "Ancient ceremonial mask",
        objId: 26225,
    },
    {
        of: "virtus_robe_top",
        id: "ancient_ceremonial_top",
        name: "Ancient ceremonial top",
        objId: 26221,
    },
    {
        of: "virtus_robe_bottom",
        id: "ancient_ceremonial_legs",
        name: "Ancient ceremonial legs",
        objId: 26223,
    },
]);

// Every piece of gear: what caskets give, and what the Armoury makes of it
export const GEAR: GearDef[] = [...CASKET_GEAR, ...VARIANT_GEAR];

// Spell impacts that double as chinchompa explosions (already baked for the
// fire spells)
const FIRE_BLAST_IMPACT = 131;
const FIRE_WAVE_IMPACT = 157;

export const UTILITY: UtilityDef[] = [
    {
        kind: "utility",
        id: "shark",
        name: "Shark",
        objId: 385,
        rarity: "common",
        description: "Heals 10 hitpoints.",
        use: { kind: "heal", amount: 10 },
    },
    {
        kind: "utility",
        id: "stamina_potion",
        name: "Stamina potion",
        objId: 12625,
        rarity: "common",
        description: "+30% movement speed for 40 seconds.",
        use: { kind: "buff", stats: { moveSpeed: 0.3 }, seconds: 40 },
    },
    {
        kind: "utility",
        id: "red_chinchompa",
        name: "Red chinchompa",
        objId: 10034,
        rarity: "common",
        description: "Blows up everything close to you.",
        use: { kind: "blast", damage: 45, radius: 4, spotAnim: FIRE_BLAST_IMPACT },
    },
    {
        kind: "utility",
        id: "antidote_plus_plus",
        name: "Antidote++",
        objId: 5952,
        rarity: "common",
        description: "Cures poison and boss drains and curses, and keeps them off for 30 seconds.",
        use: { kind: "cure", seconds: 30 },
    },
    {
        kind: "utility",
        id: "super_attack",
        name: "Super attack",
        objId: 2436,
        rarity: "common",
        description: "+15% weapon speed for 30 seconds.",
        use: { kind: "buff", stats: { cooldown: 0.15 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "super_defence",
        name: "Super defence",
        objId: 2442,
        rarity: "common",
        description: "+2 armour for 30 seconds.",
        use: { kind: "buff", stats: { armor: 2 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "super_strength",
        name: "Super strength",
        objId: 2440,
        rarity: "uncommon",
        description: "+25% damage for 30 seconds.",
        use: { kind: "buff", stats: { might: 0.25 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "anglerfish",
        name: "Anglerfish",
        objId: 13441,
        rarity: "uncommon",
        description: "Heals 25 hitpoints.",
        use: { kind: "heal", amount: 25 },
    },
    {
        kind: "utility",
        id: "bonecrusher",
        name: "Bonecrusher",
        objId: 13116,
        rarity: "uncommon",
        description: "Gathers every bone on the ground for its experience.",
        use: { kind: "bones" },
    },
    {
        kind: "utility",
        id: "saradomin_brew",
        name: "Saradomin brew",
        objId: 6685,
        rarity: "uncommon",
        description: "Heals 18 hitpoints. +1.5 armour, but -15% damage, for 20 seconds.",
        use: { kind: "heal", amount: 18, stats: { armor: 1.5, might: -0.15 }, seconds: 20 },
    },
    {
        kind: "utility",
        id: "zamorak_brew",
        name: "Zamorak brew",
        objId: 2450,
        rarity: "uncommon",
        description: "+35% damage, but -1 armour, for 30 seconds.",
        use: { kind: "buff", stats: { might: 0.35, armor: -1 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "magic_potion",
        name: "Magic potion",
        objId: 3040,
        rarity: "uncommon",
        description: "+20% area and +20% effect duration for 30 seconds.",
        use: { kind: "buff", stats: { area: 0.2, duration: 0.2 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "sanfew_serum",
        name: "Sanfew serum",
        objId: 10925,
        rarity: "uncommon",
        description:
            "Heals 6 hitpoints, cures poison and boss drains and curses, and keeps them off " +
            "for 60 seconds.",
        use: { kind: "cure", seconds: 60, heal: 6 },
    },
    {
        kind: "utility",
        id: "super_combat_potion",
        name: "Super combat potion",
        objId: 12695,
        rarity: "rare",
        description: "+25% damage, +1 armour and +10% weapon speed for 30 seconds.",
        use: { kind: "buff", stats: { might: 0.25, armor: 1, cooldown: 0.1 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "ranging_potion",
        name: "Ranging potion",
        objId: 2444,
        rarity: "rare",
        description: "+1 projectile and +20% projectile speed for 25 seconds.",
        use: { kind: "buff", stats: { amount: 1, speed: 0.2 }, seconds: 25 },
    },
    {
        kind: "utility",
        id: "bastion_potion",
        name: "Bastion potion",
        objId: 22461,
        rarity: "rare",
        description: "+1 projectile, +20% projectile speed and +1.5 armour for 30 seconds.",
        use: { kind: "buff", stats: { amount: 1, speed: 0.2, armor: 1.5 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "battlemage_potion",
        name: "Battlemage potion",
        objId: 22449,
        rarity: "rare",
        description: "+25% area, +25% effect duration and +1.5 armour for 30 seconds.",
        use: { kind: "buff", stats: { area: 0.25, duration: 0.25, armor: 1.5 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "black_chinchompa",
        name: "Black chinchompa",
        objId: 11959,
        rarity: "rare",
        description: "A huge blast that flattens everything around you.",
        use: { kind: "blast", damage: 160, radius: 6.5, spotAnim: FIRE_WAVE_IMPACT },
    },
    {
        kind: "utility",
        id: "antique_lamp",
        name: "Antique lamp",
        objId: 4447,
        rarity: "rare",
        description: "Rub it for a level's worth of experience.",
        use: { kind: "xp", levels: 1 },
    },
    {
        kind: "utility",
        id: "overload",
        name: "Overload",
        objId: 11730,
        rarity: "veryRare",
        description: "+35% damage, +15% weapon speed and +15% area for 30 seconds.",
        use: { kind: "buff", stats: { might: 0.35, cooldown: 0.15, area: 0.15 }, seconds: 30 },
    },
    {
        kind: "utility",
        id: "divine_super_combat_potion",
        name: "Divine super combat potion",
        objId: 23685,
        rarity: "veryRare",
        description: "+30% damage, +1.5 armour and +12% weapon speed for 60 seconds.",
        use: { kind: "buff", stats: { might: 0.3, armor: 1.5, cooldown: 0.12 }, seconds: 60 },
    },
    {
        kind: "utility",
        id: "prayer_cape",
        name: "Prayer cape",
        objId: 9759,
        rarity: "rare",
        description: "Co-op: a teammate can revive you once more.",
        use: { kind: "revive" },
    },
];

export const ITEMS: ItemDef[] = [...GEAR, ...UTILITY];

export const ITEM_BY_ID: Map<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): ItemDef {
    const item = ITEM_BY_ID.get(id);
    if (!item) {
        throw new Error("Unknown item " + id);
    }
    return item;
}

export function getGear(id: string): GearDef {
    const item = getItem(id);
    if (item.kind !== "gear") {
        throw new Error("Not gear: " + id);
    }
    return item;
}

// What a piece is worth next to others of its rarity: 1, or more for a
// variant (its piece's stats and a quarter more)
export function getVariantScale(item: ItemDef): number {
    let scale = 1;
    for (let piece = item; piece.kind === "gear" && piece.variantOf; ) {
        scale *= 1 + VARIANT_BONUS;
        piece = getItem(piece.variantOf);
    }
    return scale;
}

// Treasure Trail reward caskets, by clue tier
export const CASKETS: Record<CasketTier, CasketDef> = {
    easy: {
        tier: "easy",
        name: "Reward casket (easy)",
        objId: 20546,
        color: "#6ad46a",
        rarityWeights: { common: 70, uncommon: 25, rare: 5, veryRare: 0 },
        coins: [10, 25],
    },
    medium: {
        tier: "medium",
        name: "Reward casket (medium)",
        objId: 20545,
        color: "#4aa8ff",
        rarityWeights: { common: 45, uncommon: 38, rare: 15, veryRare: 2 },
        coins: [20, 40],
    },
    hard: {
        tier: "hard",
        name: "Reward casket (hard)",
        objId: 20544,
        color: "#c066ff",
        rarityWeights: { common: 22, uncommon: 40, rare: 30, veryRare: 8 },
        coins: [30, 60],
    },
    elite: {
        tier: "elite",
        name: "Reward casket (elite)",
        objId: 20543,
        color: "#ffd24a",
        rarityWeights: { common: 8, uncommon: 30, rare: 42, veryRare: 20 },
        coins: [50, 100],
    },
    // Only bosses drop these, and rarely
    master: {
        tier: "master",
        name: "Reward casket (master)",
        objId: 19836,
        color: "#ff5a5a",
        rarityWeights: { common: 0, uncommon: 12, rare: 43, veryRare: 45 },
        coins: [120, 240],
    },
};

export const CASKET_TIERS: CasketTier[] = ["easy", "medium", "hard", "elite", "master"];
