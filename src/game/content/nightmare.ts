import { NPC_IDLE_SEQ } from "../../mapviewer/webgl/actor/ActorBakeTypes";
import { BossAttackDef, EnemyDef } from "./types";

// The Nightmare of Ashihama, after the real fight (the wiki's Strategies page):
// shield then totems, three times. It's played as a bullet hell, so there are no
// prayers to swap: everything's dodged by moving, and warned on the ground.
//
// Hits are out of the player's 25 base hitpoints, about a quarter of OSRS's.
// Sounds are the wiki's noa_ ones.

// Her animations, picked by eye: the classify script can't tell them apart, as she
// floats in all of them
export const IDLE_SEQ = 8593;
export const WALK_SEQ = 8592;
// Claws out and red, the length of her melee warning
export const MELEE_SEQ = 8597;
// Her petals spin out
export const MAGIC_SEQ = 8595;
// Twisted about, as she contorts
export const RANGED_SEQ = 8596;
// Reaching into the black portal that comes with it
export const CLAWS_SEQ = 8598;
// A ring of petals on the ground
export const CURSE_SEQ = 8599;
export const SUMMON_SEQ = 8600;
export const FLOWERS_SEQ = 8601;
export const SPORES_SEQ = 8605;
// Curled up, as she throws a parasite
export const PARASITE_SEQ = 8606;
// The real absorb (8604, wings out in a burst) and pit rising (8610) are on
// her other form's skeleton (npc 9431), and tear her model apart when played
// on it: she summons as she takes in her sleepwalkers, and gathers herself
// with her reach out before a charge (8594, 1.8s)
export const ABSORB_SEQ = SUMMON_SEQ;
export const SURGE_SEQ = 8594;
// Down into the ground and up out of it, 1.2s each (npc 9432's)
export const SINK_SEQ = 8607;
export const RISE_SEQ = 8609;
export const SPAWN_SEQ = 8611;
export const DEATH_SEQ = 8612;

const NIGHTMARE_HITPOINTS = 12000;

const STANDARD_ATTACKS: BossAttackDef[] = [
    {
        name: "Ranged",
        // Her real shot, and her real petal for the magic below
        spotAnim: 1766,
        windupSound: 4230,
        sound: 4323,
        hitSound: 4219,
        kind: "pattern",
        damage: 2,
        windup: 1.8,
        cooldown: 4,
        range: 40,
        weight: 4,
        seq: RANGED_SEQ,
        pattern: {
            shape: "spread",
            count: 5,
            volleys: 3,
            interval: 0.45,
            speed: 8,
            range: 20,
            radius: 0.4,
            arc: 1.1,
            scale: 2,
            bright: 0.5,
        },
    },
    {
        name: "Magic",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: 2,
        windup: 1.8,
        cooldown: 6,
        range: 40,
        weight: 4,
        seq: MAGIC_SEQ,
        pattern: {
            shape: "spiral",
            count: 5,
            volleys: 30,
            interval: 0.1,
            speed: 5,
            range: 18,
            radius: 0.4,
            turn: 0.2,
            curve: 0.2,
        },
    },
    {
        name: "Melee",
        windupSound: 4318,
        sound: 4249,
        hitSound: 4319,
        kind: "swing",
        damage: 10,
        windup: 1.2,
        cooldown: 3,
        range: 7,
        weight: 5,
        seq: MELEE_SEQ,
        radius: 6,
        cone: 1.7,
        underRadius: 2.5,
    },
    {
        name: "Grasping Claws",
        windupSound: 4274,
        hitSound: 4256,
        kind: "ground",
        damage: 11,
        windup: 1.8,
        cooldown: 9,
        range: 40,
        weight: 3,
        seq: CLAWS_SEQ,
        ground: {
            spots: [
                { shape: "under" },
                { shape: "ring", count: 8, distance: 4.5 },
                { shape: "ring", count: 12, distance: 8 },
            ],
            radius: 1.4,
            spotAnim: 1759,
            middleSpotAnim: 1761,
        },
    },
    {
        name: "Grasping Claws (around you)",
        windupSound: 4274,
        hitSound: 4256,
        kind: "ground",
        damage: 11,
        windup: 1.8,
        cooldown: 12,
        range: 40,
        weight: 2,
        seq: CLAWS_SEQ,
        ground: {
            spots: [{ shape: "grid", size: 5, spacing: 3.5 }],
            radius: 1.3,
            spotAnim: 1759,
            middleSpotAnim: 1761,
        },
    },
];

const PHASE_ONE_ATTACKS: BossAttackDef[] = [
    {
        name: "Husks",
        windupSound: 4341,
        kind: "summon",
        damage: 0,
        windup: 1.2,
        cooldown: 24,
        range: 40,
        weight: 3,
        seq: SUMMON_SEQ,
        phases: [1],
        message: "Husks hold you in place! Kill them!",
        summon: {
            enemyId: "husk_magic",
            count: 1,
            alsoId: "husk_ranged",
            beside: true,
            holds: 6,
        },
    },
    {
        name: "Corpse Flowers",
        windupSound: 4244,
        kind: "quarters",
        damage: 1,
        windup: 3.5,
        cooldown: 26,
        range: 40,
        weight: 3,
        seq: FLOWERS_SEQ,
        phases: [1],
        message: "Flowers split the ground! Get to the white blossoms!",
        quarters: {
            seconds: 9,
            interval: 0.6,
            heal: 0.01,
            offset: 3,
            spacing: 1.5,
            safeLocId: 37745,
            hurtLocId: 37742,
        },
    },
];

const PHASE_TWO_ATTACKS: BossAttackDef[] = [
    {
        name: "Sleepwalkers",
        windupSound: 4248,
        hitSound: 4227,
        kind: "summon",
        damage: 1,
        windup: 1.5,
        cooldown: 0,
        range: 999,
        weight: 0,
        // Only ever her opener
        seq: ABSORB_SEQ,
        phases: [],
        ignoreArmor: true,
        message: "Sleepwalkers! Kill them before they reach her!",
        summon: {
            enemyId: "sleepwalker",
            count: 4,
            walkTo: { distance: 11, perAbsorbed: 4 },
        },
    },
    {
        name: "Curse",
        windupSound: 4255,
        kind: "mark",
        damage: 0,
        windup: 1.2,
        cooldown: 24,
        range: 40,
        weight: 3,
        seq: CURSE_SEQ,
        phases: [2],
        message: "The Nightmare curses you! Your feet won't obey!",
        effect: { kind: "curse", attacks: 5 },
    },
    {
        name: "Parasites",
        spotAnim: 1770,
        windupSound: 4233,
        hitSound: 4265,
        kind: "mark",
        damage: 9,
        windup: 1.2,
        cooldown: 22,
        range: 40,
        weight: 3,
        seq: PARASITE_SEQ,
        phases: [2],
        message: "A parasite takes hold! It's going to burst!",
        parasite: {
            seconds: 10.8,
            enemyId: "nightmare_parasite",
            weakEnemyId: "nightmare_parasite_weak",
        },
    },
    {
        name: "Petal ring",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: 2,
        windup: 1.8,
        cooldown: 8,
        range: 40,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        pattern: {
            shape: "ring",
            count: 18,
            volleys: 3,
            interval: 0.7,
            speed: 5,
            range: 18,
            radius: 0.4,
            turn: 0.13,
        },
    },
];

const PHASE_THREE_ATTACKS: BossAttackDef[] = [
    {
        name: "Sleepwalkers (more)",
        windupSound: 4248,
        hitSound: 4227,
        kind: "summon",
        damage: 1,
        windup: 1.5,
        cooldown: 0,
        range: 999,
        weight: 0,
        seq: ABSORB_SEQ,
        phases: [],
        ignoreArmor: true,
        message: "More sleepwalkers! Kill them before they reach her!",
        summon: {
            enemyId: "sleepwalker",
            count: 6,
            walkTo: { distance: 11, perAbsorbed: 4 },
        },
    },
    {
        name: "Spores",
        impactSpotAnim: 2542,
        windupSound: 4272,
        hitSound: 4273,
        kind: "ground",
        damage: 0,
        windup: 1.4,
        cooldown: 16,
        range: 40,
        weight: 3,
        seq: SPORES_SEQ,
        phases: [3],
        ground: {
            spots: [{ shape: "scatter", count: 12, spread: 10 }],
            radius: 1.5,
            armed: 12,
            locId: 37739,
            fit: 2,
        },
        effect: {
            kind: "drowsy",
            id: "spores",
            name: "Spores: drowsy",
            // Karil's crossbow, like the other drains, until there's a better icon
            iconObjId: 4734,
            moveSpeed: -0.35,
            bossInterval: 0.7,
            seconds: 6,
        },
    },
    {
        name: "Surge",
        windupSound: 4240,
        sound: 4283,
        kind: "surge",
        damage: 14,
        windup: 2.2,
        cooldown: 11,
        range: 999,
        weight: 5,
        seq: SURGE_SEQ,
        phases: [3],
        radius: 2.6,
        speed: 26,
        message: "She's going to charge! Get out of the lane!",
    },
];

// The totems' model has its scroll hanging three-quarters of the way round from
// where its yaw points, so this is added to turn the scroll to the arena's middle
export const TOTEM_SCROLL_YAW = 768;

export const TOTEM = {
    idleSeq: NPC_IDLE_SEQ,
    walkSeq: -1,
    attackSeq: -1,
    deathSeq: -1,
    hp: 1,
    damage: 0,
    speed: 0,
    radius: 0.45,
    xp: 0,
    knockbackResist: 1,
    stationary: true,
    sounds: { attack: -1, hit: -1, death: -1 },
};

export const HUSK = {
    idleSeq: 8562,
    walkSeq: 8563,
    attackSeq: 8564,
    deathSeq: -1,
    hp: 500,
    damage: 1,
    speed: 0,
    radius: 0.45,
    xp: 0,
    knockbackResist: 1,
    stationary: true,
    sounds: { attack: -1, hit: 4278, death: 4252 },
};

export const PARASITE = {
    npcId: 9452,
    idleSeq: 8553,
    walkSeq: 8553,
    attackSeq: 8554,
    deathSeq: -1,
    damage: 1,
    speed: 2,
    radius: 0.4,
    xp: 0,
    knockbackResist: 1,
    sounds: { attack: -1, hit: 4296, death: 4261 },
    heals: { fraction: 0.03, interval: 3, range: 4, targets: ["the_nightmare"], seek: 30 },
    shot: { range: 8, interval: 2.4, speed: 7, spotAnim: 1771, sound: 4335 },
};

export const NIGHTMARE_ENEMIES: EnemyDef[] = [
    {
        id: "the_nightmare",
        name: "The Nightmare",
        npcId: 9425,
        idleSeq: IDLE_SEQ,
        walkSeq: WALK_SEQ,
        attackSeq: MELEE_SEQ,
        deathSeq: DEATH_SEQ,
        hp: NIGHTMARE_HITPOINTS,
        damage: 0,
        speed: 1.5,
        radius: 0.9,
        xp: 4000,
        knockbackResist: 1,
        // Real size is five tiles a side; that's lost at the play camera
        scale: 1.5,
        sounds: { attack: -1, hit: 4281, death: 4295 },
        spawnMessage: "The Nightmare rises!",
        boss: {
            attackInterval: 3.2,
            keepDistance: 6,
            enrage: { message: "The Nightmare is furious!" },
            surgeSeq: MELEE_SEQ,
            leash: { distance: 16, keep: 10 },
            attacks: [
                ...STANDARD_ATTACKS,
                ...PHASE_ONE_ATTACKS,
                ...PHASE_TWO_ATTACKS,
                ...PHASE_THREE_ATTACKS,
            ],
            intro: {
                seconds: 6,
                riseAt: 1.5,
                seq: SPAWN_SEQ,
                darkSound: 4311,
                sound: 4262,
                title: "The Nightmare",
                subtitle: "of Ashihama",
                // Clear of her reach, and in view of a phone's closer camera too
                distance: 7,
                alone: true,
            },
            phases: {
                phases: [
                    { shield: 0.3 },
                    { shield: 0.3, opener: "Sleepwalkers" },
                    { shield: 0.3, opener: "Sleepwalkers (more)" },
                ],
                blastHeal: 0.4,
                totems: {
                    idleId: "nightmare_totem",
                    chargingId: "nightmare_totem_charging",
                    chargedId: "nightmare_totem_charged",
                    yawOffset: TOTEM_SCROLL_YAW,
                    charge: 0.05,
                    margin: 6,
                    blastSpotAnim: 1782,
                    blastSound: 4321,
                    chargedSound: 4254,
                },
                shieldMessage: "Her shield breaks! Charge the four totems!",
                blastMessage: "The totems blast her! Her shield's back!",
            },
        },
    },
    { ...TOTEM, id: "nightmare_totem", name: "Totem", npcId: 9434 },
    { ...TOTEM, id: "nightmare_totem_charging", name: "Totem", npcId: 9435 },
    { ...TOTEM, id: "nightmare_totem_charged", name: "Totem", npcId: 9436, idleSeq: 8589 },
    {
        ...HUSK,
        id: "husk_magic",
        name: "Husk",
        npcId: 9454,
        shot: { range: 8, interval: 2, speed: 7, spotAnim: 1776, sound: 4302 },
    },
    {
        ...HUSK,
        id: "husk_ranged",
        name: "Husk",
        npcId: 9455,
        shot: { range: 8, interval: 2, speed: 9, spotAnim: 1771, sound: 4264 },
    },
    {
        id: "sleepwalker",
        name: "Sleepwalker",
        npcId: 9446,
        idleSeq: 8569,
        walkSeq: 8534,
        attackSeq: -1,
        deathSeq: -1,
        // Any hit does it
        hp: 1,
        damage: 0,
        speed: 1.8,
        radius: 0.4,
        xp: 0,
        knockbackResist: 1,
        sounds: { attack: -1, hit: 4263, death: 4235 },
    },
    { ...PARASITE, id: "nightmare_parasite", name: "Parasite", hp: 800 },
    { ...PARASITE, id: "nightmare_parasite_weak", name: "Parasite", npcId: 9453, hp: 400 },
];
