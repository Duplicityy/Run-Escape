import {
    ABSORB_SEQ,
    CLAWS_SEQ,
    CURSE_SEQ,
    DEATH_SEQ,
    FLOWERS_SEQ,
    HUSK,
    IDLE_SEQ,
    MAGIC_SEQ,
    MELEE_SEQ,
    PARASITE,
    PARASITE_SEQ,
    RANGED_SEQ,
    RISE_SEQ,
    SINK_SEQ,
    SPAWN_SEQ,
    SPORES_SEQ,
    SUMMON_SEQ,
    SURGE_SEQ,
    TOTEM,
    TOTEM_SCROLL_YAW,
    WALK_SEQ,
} from "./nightmare";
import { BossAttackDef, EnemyDef } from "./types";

// Phosani's Nightmare: The Nightmare's hard mode, fought on its own on the
// Sisterhood Sanctuary (maps.ts, scaperune/maps/sisterhoodSanctuary.ts). There's no
// run before her: she rises as you arrive, and there are no picks and no
// items, only the Inquisitor's mace (the map's fight settings). Everything's
// hers from nightmare.ts, quicker, and with more of it at once, plus a sweep
// and a claw on your own tile. It's meant to be learnt: every hit is wound up
// and shown first, and nothing heals but the totems.
//
// She looks like The Nightmare (npc 9425, her animations), as Phosani's own
// NPC can't be checked without the cache: see the pull request.

const PHOSANI_HITPOINTS = 12000;

// Tiles south of her the player stands as she rises (BossIntroDef.distance),
// and where the map starts them, so there's no jump when she does
export const PHOSANI_START_DISTANCE = 7;

// What her parasites heal: her, and a totem that's being charged
const PHOSANI_PARASITE_TARGETS = ["phosanis_nightmare", "phosani_totem_charging"];
// Quick on their feet, and each heal a big one: a parasite left alone is a
// good part of her shield back, or of a totem's charge undone, every couple
// of seconds, from wherever it finds them
const PARASITE_SPEED = 3.5;
const PHOSANI_PARASITE_HEALS = {
    ...PARASITE.heals,
    fraction: 0.15,
    interval: 2,
    seek: 999,
    targets: PHOSANI_PARASITE_TARGETS,
};

// Her totems: The Nightmare's, grown to be seen across her square, with a
// wider mark to hit for it
const PHOSANI_TOTEM = { ...TOTEM, scale: 2.5, radius: 0.9 };

// Her claws' hands are the whole of each mark: still as the warning, then
// up out of the ground in full as it lands, for the length of their
// animation, as wide as the mark they hit (about a tile and a half, near
// the real fight's one-tile hands), so what's seen is what's hit
// The hands are under the ground for the first half second of their 2.4s and
// gone again from 1.9s: that's when the mark hurts
const CLAW_GRAB = { seconds: 2.4, fit: 1, up: { from: 0.5, to: 1.9 } };
// Her claws are her punctuation, not the fight: picked a little more often
// than a pattern (those are 3), and not back for a while, since each round's
// hands are up for seconds and there's nothing to do but stand clear of them
const CLAW_WEIGHT = 4;

// What a petal takes, of the Inquisitor's 30 hitpoints: seven of them, with
// barely a third of a second between one landing and the next being able to
// (bulletGrace), so standing in a pattern is what kills
const PETAL = 4;
const PETAL_GRACE = 0.3;

// Her rings and spirals hold her for this long only: the rest of the pattern
// keeps coming while she winds up the next thing through it. Her aimed shots
// (the spreads) hold her for their length, as they go where she faces.
const PETAL_CHANNEL = 0.5;

// Her red shot (spot 1766) is a streak, long the way it flies and thin across,
// so it hits no wider than it's drawn: a sidestep that looks clear is clear
const BALL_HIT = 0.25;

// Her sweeps' needles: thin, and fired in bursts with half a second between,
// so each arm is short solid pieces with holes along them (seven tiles at
// their speed, passing by in half a second) to run through as they come
const NEEDLE_HIT = 0.3;
const NEEDLE_BURST = { count: 6, pause: 0.5 };

// How far off the player can be for her petals, shots and claws: about as far
// as they fly. Further than that she doesn't stand firing at nothing, she
// walks after them, or charges (her charge and her summons reach anywhere),
// and from well off she sinks and comes up by them (the leash)
const REACH = 18;

// Her charge is the answer to a player who keeps away, so it's picked more
// than anything
const SURGE_WEIGHT = 9;

// Her husks: a few bolts each, running as quick as the Inquisitor
// so they're shot down or they arrive, and then a hold that only their death
// ends (the seconds are a long stop)
const PHOSANI_HUSK = {
    ...HUSK,
    hp: 150,
    speed: 4,
    stationary: false,
    holds: 30,
    solid: true,
    healthBar: true,
};

// Every phase
const STANDARD_ATTACKS: BossAttackDef[] = [
    {
        name: "Ranged",
        spotAnim: 1766,
        windupSound: 4230,
        sound: 4323,
        hitSound: 4219,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 4,
        range: REACH,
        weight: 4,
        seq: RANGED_SEQ,
        // A wider fan than hers, closer together, and a volley more
        pattern: {
            shape: "spread",
            count: 7,
            volleys: 4,
            interval: 0.4,
            speed: 9,
            range: 22,
            radius: BALL_HIT,
            arc: 1.25,
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
        damage: PETAL,
        windup: 1.6,
        cooldown: 6,
        range: REACH,
        weight: 4,
        seq: MAGIC_SEQ,
        // Six arms to her five, turning quicker
        pattern: {
            shape: "spiral",
            count: 6,
            volleys: 36,
            interval: 0.1,
            speed: 5.5,
            range: 18,
            radius: 0.4,
            turn: 0.22,
            curve: 0.2,
        },
    },
    {
        // One arm of needles, aimed at you and then swept round widdershins:
        // step the other way and it never reaches you, or run through one of
        // the holes its bursts leave along it
        name: "Sweep",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: 4,
        windup: 1.5,
        cooldown: 12,
        range: REACH,
        weight: 3,
        seq: MAGIC_SEQ,
        message: "She sweeps the field! Step against the turn!",
        pattern: {
            shape: "spread",
            count: 1,
            volleys: 30,
            interval: 0.06,
            speed: 14,
            range: 22,
            radius: NEEDLE_HIT,
            arc: 0,
            turn: 0.08,
            scale: 1.6,
            bright: 0.5,
            burst: NEEDLE_BURST,
        },
    },
    {
        name: "Melee",
        windupSound: 4318,
        sound: 4249,
        hitSound: 4319,
        kind: "swing",
        damage: 12,
        windup: 1.1,
        cooldown: 3,
        range: 7,
        weight: 5,
        seq: MELEE_SEQ,
        radius: 6.5,
        cone: 1.8,
        underRadius: 2.5,
    },
    {
        name: "Grasping Claws",
        windupSound: 4274,
        hitSound: 4256,
        kind: "ground",
        damage: 12,
        windup: 1.6,
        cooldown: 12,
        range: REACH,
        weight: CLAW_WEIGHT,
        seq: CLAWS_SEQ,
        // A ring further out than hers, so there's less room to stand off in;
        // the marks are the size of the hands, so more of them to each ring
        ground: {
            spots: [
                { shape: "under" },
                { shape: "ring", count: 12, distance: 4.5 },
                { shape: "ring", count: 18, distance: 8 },
                { shape: "ring", count: 24, distance: 11.5 },
            ],
            radius: 0.75,
            middleSpotAnim: 1761,
            grab: CLAW_GRAB,
        },
    },
    {
        // Claws at random round the player, three times over with barely a
        // second each: there's always ground between them, but it's never the
        // same ground (two dozen, at the hands' size)
        name: "Grasping Claws (random)",
        windupSound: 4274,
        hitSound: 4256,
        kind: "ground",
        damage: 12,
        windup: 1.1,
        cooldown: 14,
        range: REACH,
        weight: CLAW_WEIGHT,
        seq: CLAWS_SEQ,
        chain: { times: 1, windup: 0.9 },
        ground: {
            spots: [{ shape: "scatter", count: 24, spread: 11 }],
            radius: 0.75,
            middleSpotAnim: 1761,
            grab: CLAW_GRAB,
        },
    },
    {
        // From the first phase, not only her last, and three times over: each
        // lane's picked afresh from where the player is. Often, and from any
        // distance: past her reach it's most of what she has
        name: "Surge",
        windupSound: 4240,
        sound: 4283,
        kind: "surge",
        damage: 15,
        windup: 1.9,
        cooldown: 10,
        range: 999,
        weight: SURGE_WEIGHT,
        seq: SURGE_SEQ,
        radius: 2.8,
        speed: 45,
        chain: { times: 2, windup: 0.8 },
        message: "She's going to charge, again and again! Keep out of the lanes!",
    },
    {
        // A ring with one way through, opening on the player's side and
        // turning on with each volley
        name: "Closing ring",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 9,
        range: REACH,
        weight: 3,
        seq: MAGIC_SEQ,
        pattern: {
            shape: "ring",
            count: 24,
            volleys: 3,
            interval: 0.9,
            speed: 6,
            range: 20,
            radius: 0.4,
            turn: 1.1,
            gap: 1,
            gapAt: "player",
        },
    },
    {
        // A slow, dense spiral with one doorway, opening on the player's side
        // and walking round her: keep walking with it (the bullet hell's
        // negative space)
        name: "Turning wall",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 14,
        range: REACH,
        weight: 3,
        seq: MAGIC_SEQ,
        message: "A wall of petals turns about her! Walk with the gap!",
        pattern: {
            shape: "spiral",
            count: 24,
            volleys: 36,
            interval: 0.15,
            speed: 4.5,
            range: 18,
            radius: 0.4,
            turn: 0.08,
            gap: 1.3,
            gapAt: "player",
        },
    },
    {
        // Slow rings whose petals bend as they fly, so a straight line out
        // walks into them: watch the hooks, not the ring
        name: "Pinwheel",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 10,
        range: REACH,
        weight: 3,
        seq: MAGIC_SEQ,
        pattern: {
            shape: "ring",
            count: 10,
            volleys: 6,
            interval: 0.5,
            speed: 4,
            range: 16,
            radius: 0.4,
            turn: 0.3,
            curve: 0.7,
        },
    },
    {
        // She flings eggs out of herself across the square, each its own way:
        // chase them down and break them before they hatch, or parasites come
        // out to heal her, or undo the charge on a totem
        name: "Eggs",
        windupSound: 4233,
        kind: "summon",
        damage: 0,
        windup: 1.4,
        cooldown: 26,
        range: 40,
        weight: 3,
        seq: MAGIC_SEQ,
        message: "She flings out eggs! Chase them down before they hatch!",
        summon: { enemyId: "phosani_egg", count: 3, distance: 11, thrown: { seconds: 1 } },
    },
];

const PHASE_ONE_ATTACKS: BossAttackDef[] = [
    {
        // Hers run for you from wherever they turn up, and hold you where you
        // stand once they arrive until they're dead: shoot them down on the way
        name: "Husks",
        windupSound: 4341,
        kind: "summon",
        damage: 0,
        windup: 1.2,
        cooldown: 20,
        range: 40,
        weight: 3,
        seq: SUMMON_SEQ,
        message: "Husks run for you! Shoot them down before they hold you!",
        summon: {
            enemyId: "phosani_husk_magic",
            count: 1,
            alsoId: "phosani_husk_ranged",
            scatter: true,
        },
    },
    {
        // She takes the middle of the arena, as in the real fight, and the
        // flowers cross there; while they stand she rains her petals and claws
        name: "Corpse Flowers",
        windupSound: 4244,
        kind: "quarters",
        damage: 2,
        windup: 3,
        // Long: each one is a run to the right quarter, and it shouldn't be
        // the next thing again
        cooldown: 60,
        range: 40,
        weight: 3,
        seq: FLOWERS_SEQ,
        phases: [1, 3],
        toMiddle: true,
        message: "She takes the middle, and flowers split the ground! Get to the white blossoms!",
        quarters: {
            seconds: 9,
            interval: 0.5,
            heal: 0.015,
            offset: 3,
            spacing: 1.5,
            safeLocId: 37745,
            hurtLocId: 37742,
            during: {
                attacks: ["Petal ring", "Magic", "Grasping Claws (random)"],
                interval: 1.5,
            },
        },
    },
];

const PHASE_TWO_ATTACKS: BossAttackDef[] = [
    {
        name: "Sleepwalkers",
        windupSound: 4248,
        hitSound: 4227,
        kind: "summon",
        damage: 2,
        windup: 1.5,
        cooldown: 0,
        range: 999,
        weight: 0,
        seq: ABSORB_SEQ,
        phases: [],
        ignoreArmor: true,
        message: "Sleepwalkers! Kill them before they reach her!",
        summon: {
            enemyId: "phosani_sleepwalker",
            count: 6,
            walkTo: { distance: 11, perAbsorbed: 5 },
        },
    },
    {
        name: "Curse",
        windupSound: 4255,
        kind: "mark",
        damage: 0,
        windup: 1.2,
        cooldown: 20,
        range: 40,
        weight: 3,
        seq: CURSE_SEQ,
        phases: [2, 3],
        message: "Phosani's Nightmare curses you! Your feet won't obey!",
        effect: { kind: "curse", attacks: 3 },
    },
    {
        name: "Parasites",
        spotAnim: 1770,
        windupSound: 4233,
        hitSound: 4265,
        kind: "mark",
        damage: 10,
        windup: 1.2,
        cooldown: 18,
        range: 40,
        weight: 3,
        seq: PARASITE_SEQ,
        phases: [2, 3],
        message: "A parasite takes hold! It's going to burst!",
        parasite: {
            seconds: 9,
            enemyId: "phosani_parasite",
            weakEnemyId: "phosani_parasite_weak",
        },
    },
    {
        name: "Petal ring",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 8,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        pattern: {
            shape: "ring",
            count: 22,
            volleys: 4,
            interval: 0.6,
            speed: 5.5,
            range: 18,
            radius: 0.4,
            turn: 0.14,
        },
    },
    {
        // Rings half a step apart, one after another: a lattice to thread
        name: "Weaving petals",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 10,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        pattern: {
            shape: "ring",
            count: 14,
            volleys: 6,
            interval: 0.75,
            speed: 4.5,
            range: 20,
            radius: 0.4,
            turn: Math.PI / 14,
        },
    },
    {
        // A stream of shots that follows the player: keep stepping across it.
        // Each is aimed where they are as it's fired, so it flies at under
        // twice their pace with a step's worth of time between shots, or
        // there's no stepping out of it
        name: "Barrage",
        spotAnim: 1766,
        windupSound: 4230,
        sound: 4323,
        hitSound: 4219,
        kind: "pattern",
        damage: PETAL,
        windup: 1.4,
        cooldown: 9,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: RANGED_SEQ,
        pattern: {
            shape: "spread",
            count: 1,
            volleys: 10,
            interval: 0.2,
            speed: 7,
            range: 22,
            radius: BALL_HIT,
            arc: 0,
            track: true,
            scale: 2,
            bright: 0.5,
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
        cooldown: 15,
        range: 40,
        weight: 3,
        seq: SPORES_SEQ,
        phases: [2, 3],
        ground: {
            spots: [{ shape: "scatter", count: 14, spread: 10 }],
            radius: 1.5,
            armed: 14,
            locId: 37739,
            fit: 2,
        },
        effect: {
            kind: "drowsy",
            id: "spores",
            name: "Spores: drowsy",
            // Karil's crossbow, like the other drains, until there's a better icon
            iconObjId: 4734,
            moveSpeed: -0.4,
            bossInterval: 0.65,
            seconds: 6,
        },
    },
    {
        // Her sweep with two arms, a bar through her that turns: there's half
        // the room to stay ahead of it in, and the same holes to run through
        name: "Double sweep",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: 4,
        windup: 1.5,
        cooldown: 14,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        message: "She sweeps both ways round! Keep ahead of the arm!",
        pattern: {
            shape: "spread",
            count: 2,
            volleys: 30,
            interval: 0.06,
            speed: 14,
            range: 22,
            radius: NEEDLE_HIT,
            arc: Math.PI,
            turn: 0.06,
            scale: 1.6,
            bright: 0.5,
            burst: NEEDLE_BURST,
        },
    },
    {
        // Her spiral and its mirror image, winding against each other into a
        // lattice that opens and closes
        name: "Counter-spiral",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 10,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        pattern: {
            shape: "spiral",
            count: 3,
            volleys: 36,
            interval: 0.1,
            speed: 5.5,
            range: 18,
            radius: 0.4,
            turn: 0.22,
            mirror: true,
        },
    },
    {
        // A tight ring with its one gap on the player, and the next ring's gap
        // further round: through it, and keep on round
        name: "Sealing ring",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 10,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        message: "A ring seals about you! Through the gap, and keep on round!",
        pattern: {
            shape: "ring",
            count: 30,
            volleys: 3,
            interval: 0.8,
            speed: 5,
            range: 20,
            radius: 0.4,
            turn: 0.6,
            gap: 0.9,
            gapAt: "player",
        },
    },
    {
        // Rings that each fly quicker than the last, so they catch each other
        // up about nine tiles out and pile into one wall there for a moment:
        // stay in close, or get well clear
        name: "Closing petals",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 11,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        message: "Rings that catch each other up! Close in, or get well clear!",
        pattern: {
            shape: "ring",
            count: 16,
            volleys: 5,
            interval: 0.4,
            speed: 3.5,
            range: 18,
            radius: 0.4,
            turn: Math.PI / 16,
            speedUp: 1.4,
        },
    },
    {
        // Slow rings to thread, and then her barrage comes through them after
        // you: the one thing's handled as the other arrives
        name: "Rings, then shots",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 13,
        range: REACH,
        weight: 3,
        phases: [2, 3],
        seq: MAGIC_SEQ,
        message: "Slow rings... and then she takes aim!",
        follow: { attack: "Barrage", delay: 1 },
        pattern: {
            shape: "ring",
            count: 18,
            volleys: 3,
            interval: 0.7,
            speed: 3,
            range: 16,
            radius: 0.4,
        },
    },
];

const PHASE_THREE_ATTACKS: BossAttackDef[] = [
    {
        name: "Sleepwalkers (more)",
        windupSound: 4248,
        hitSound: 4227,
        kind: "summon",
        damage: 2,
        windup: 1.5,
        cooldown: 0,
        range: 999,
        weight: 0,
        seq: ABSORB_SEQ,
        phases: [],
        ignoreArmor: true,
        message: "More sleepwalkers! Kill them before they reach her!",
        summon: {
            enemyId: "phosani_sleepwalker",
            count: 8,
            walkTo: { distance: 11, perAbsorbed: 5 },
        },
    },
    {
        // Shots that turn after the player, though not sharply, and give up
        // after a few seconds: step aside as they close
        name: "Hunting orbs",
        spotAnim: 1766,
        windupSound: 4230,
        sound: 4323,
        hitSound: 4219,
        kind: "projectile",
        damage: 4,
        windup: 1.3,
        cooldown: 9,
        range: REACH,
        weight: 3,
        phases: [3],
        seq: RANGED_SEQ,
        count: 3,
        spread: 0.5,
        speed: 6,
        homing: 0.8,
        radius: BALL_HIT,
    },
    {
        // A claw on the tile you stand on, with a ring of them round you, and
        // barely a second to slip out between them. Her hardest claw, so not
        // as often as the rest: it also follows her parted petals
        name: "Grasping Claws (on you)",
        windupSound: 4274,
        hitSound: 4256,
        kind: "ground",
        damage: 13,
        windup: 1.1,
        cooldown: 12,
        range: REACH,
        weight: 3,
        seq: CLAWS_SEQ,
        phases: [3],
        ground: {
            spots: [
                { shape: "player" },
                { shape: "ring", count: 8, distance: 3, around: "player" },
            ],
            radius: 0.75,
            middleSpotAnim: 1761,
            grab: CLAW_GRAB,
        },
    },
    {
        // Two arms that open from where you stand and sweep round opposite
        // ways: stay ahead of one, get in close where it's slower, or run
        // through a hole
        name: "Scissors",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: 4,
        windup: 1.5,
        cooldown: 13,
        range: REACH,
        weight: 3,
        phases: [3],
        seq: MAGIC_SEQ,
        message: "Two arms open from you and sweep round! Stay ahead of one, or get in close!",
        pattern: {
            shape: "spread",
            count: 1,
            volleys: 30,
            interval: 0.06,
            speed: 14,
            range: 22,
            radius: NEEDLE_HIT,
            arc: 0,
            turn: 0.05,
            mirror: true,
            scale: 1.6,
            bright: 0.5,
            burst: NEEDLE_BURST,
        },
    },
    {
        // An even fan, so you're between two shots and safest standing still,
        // and then her claw on the tile you're standing on
        name: "Parted petals",
        spotAnim: 1766,
        windupSound: 4230,
        sound: 4323,
        hitSound: 4219,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 12,
        range: REACH,
        weight: 3,
        phases: [3],
        seq: RANGED_SEQ,
        message: "Her shots part round you... and her claw comes for your tile!",
        follow: { attack: "Grasping Claws (on you)", delay: 0.3 },
        pattern: {
            shape: "spread",
            count: 6,
            volleys: 3,
            interval: 0.45,
            speed: 9,
            range: 22,
            radius: BALL_HIT,
            arc: 1.5,
            scale: 2,
            bright: 0.5,
        },
    },
    {
        // A ring round the player that flies inwards, with its gap on her side:
        // the way out is towards her
        name: "The dream closes in",
        spotAnim: 1764,
        windupSound: 4293,
        sound: 4297,
        hitSound: 4258,
        kind: "pattern",
        damage: PETAL,
        windup: 1.6,
        cooldown: 12,
        range: REACH,
        weight: 3,
        phases: [3],
        seq: MAGIC_SEQ,
        message: "The dream closes in! Run to her!",
        pattern: {
            shape: "ring",
            count: 22,
            volleys: 3,
            interval: 0.6,
            speed: 5,
            range: 12,
            radius: 0.4,
            gap: 1.1,
            gapAt: "away",
            around: 9,
        },
    },
];

for (const attack of [
    ...STANDARD_ATTACKS,
    ...PHASE_ONE_ATTACKS,
    ...PHASE_TWO_ATTACKS,
    ...PHASE_THREE_ATTACKS,
]) {
    const pattern = attack.pattern;
    if (pattern && pattern.shape !== "spread" && pattern.channel === undefined) {
        pattern.channel = PETAL_CHANNEL;
    }
}

// The dream itself: a pattern each phase that she keeps up under everything
// else, on its own timer (BossPhasesDef ambient), so nothing of hers is ever
// dodged on its own. Each is slow and sparse enough to be walked through with
// care (petals 1.8 tiles apart along an arm, against the 1.5 the Inquisitor
// needs), and runs for half a minute before it's seeded afresh: the floor the
// fight's danced on. Never picked on their own (weight 0, no phases).
const DREAM = {
    spotAnim: 1764,
    kind: "pattern" as const,
    damage: PETAL,
    windup: 0,
    cooldown: 0,
    range: 999,
    weight: 0,
    phases: [],
    seq: MAGIC_SEQ,
};
const DREAM_SECONDS = 30;
const DREAM_ATTACKS: BossAttackDef[] = [
    {
        // Five arms turning slowly, each a line of petals to step between
        ...DREAM,
        name: "The dream's spiral",
        pattern: {
            shape: "spiral",
            count: 5,
            volleys: 50,
            interval: 0.6,
            speed: 3,
            range: 28,
            radius: 0.4,
            turn: 0.12,
        },
    },
    {
        // A slow ring every couple of seconds, each a half-step round from the
        // last, so the rings make a lattice to weave
        ...DREAM,
        name: "The dream's rings",
        pattern: {
            shape: "ring",
            count: 20,
            volleys: 12,
            interval: 2.5,
            speed: 3.5,
            range: 28,
            radius: 0.4,
            turn: Math.PI / 20,
        },
    },
    {
        // Two arms wound against their mirror image: a lattice that opens and
        // closes as it turns
        ...DREAM,
        name: "The dream's lattice",
        pattern: {
            shape: "spiral",
            count: 2,
            volleys: 60,
            interval: 0.5,
            speed: 3.5,
            range: 28,
            radius: 0.4,
            turn: 0.22,
            mirror: true,
        },
    },
];

export const PHOSANI_ENEMIES: EnemyDef[] = [
    {
        id: "phosanis_nightmare",
        name: "Phosani's Nightmare",
        npcId: 9425,
        idleSeq: IDLE_SEQ,
        walkSeq: WALK_SEQ,
        attackSeq: MELEE_SEQ,
        deathSeq: DEATH_SEQ,
        hp: PHOSANI_HITPOINTS,
        damage: 0,
        // Three quarters of the Inquisitor's pace, and quicker by the phase:
        // she runs after them, and only sinks and comes up by them when
        // they've got well away
        speed: 3,
        radius: 0.9,
        xp: 6000,
        knockbackResist: 1,
        scale: 1.6,
        solid: true,
        sounds: { attack: -1, hit: 4281, death: 4295 },
        spawnMessage: "Phosani's Nightmare rises!",
        boss: {
            attackInterval: 2.6,
            keepDistance: 6,
            enrage: { message: "Phosani's Nightmare is furious!" },
            // Floating forward, as she walks: her claws-out melee stretches across the
            // screen at a charge's speed
            surgeSeq: WALK_SEQ,
            // Down into the ground and up out of it, rather than just being there
            leash: {
                distance: 20,
                keep: 8,
                jump: { downSeq: SINK_SEQ, upSeq: RISE_SEQ, seconds: 1.2 },
            },
            attacks: [
                ...STANDARD_ATTACKS,
                ...PHASE_ONE_ATTACKS,
                ...PHASE_TWO_ATTACKS,
                ...PHASE_THREE_ATTACKS,
                ...DREAM_ATTACKS,
            ],
            bulletGrace: PETAL_GRACE,
            // She falls, and the dream goes with her, before the screen says so:
            // her death (seq 8612) is 5.4 seconds long
            fallSeconds: 5.4,
            intro: {
                seconds: 6,
                riseAt: 1.5,
                seq: SPAWN_SEQ,
                darkSound: 4311,
                sound: 4262,
                title: "Phosani's Nightmare",
                subtitle: "The Inquisitor's bane",
                distance: PHOSANI_START_DISTANCE,
                alone: true,
                // She rises at the middle of her square, with the player stood
                // south of her, rooted until she's up
                atMiddle: true,
                holds: true,
            },
            phases: {
                // Each phase a gear up: quicker between attacks and on her
                // petals' windups, quicker on her feet, and the dream under it
                // thicker
                phases: [
                    {
                        shield: 0.3,
                        ambient: { attack: "The dream's spiral", interval: DREAM_SECONDS },
                    },
                    {
                        shield: 0.3,
                        opener: "Sleepwalkers",
                        ambient: { attack: "The dream's rings", interval: DREAM_SECONDS },
                        tempo: 0.8,
                        speed: 1.15,
                    },
                    {
                        shield: 0.3,
                        opener: "Sleepwalkers (more)",
                        ambient: { attack: "The dream's lattice", interval: DREAM_SECONDS },
                        tempo: 0.65,
                        speed: 1.3,
                    },
                ],
                // Her desperation phase, as the real fight has: the last blast
                // leaves her standing a while longer, untouchable, with her
                // sleepwalkers walking in and her claws on the player all the
                // while, and the lattice doubled under it
                finale: {
                    seconds: 12,
                    opener: "Sleepwalkers (more)",
                    attacks: ["Grasping Claws (on you)", "Grasping Claws (random)"],
                    interval: 0.5,
                    ambient: { attack: "The dream's lattice", interval: DREAM_SECONDS / 2 },
                    message: "She's falling! Stay on your feet!",
                },
                // A blast's a breath, not a bar: nothing heals in the dream
                blastHeal: 0.15,
                totems: {
                    idleId: "phosani_totem",
                    chargingId: "phosani_totem_charging",
                    chargedId: "phosani_totem_charged",
                    yawOffset: TOTEM_SCROLL_YAW,
                    charge: 0.06,
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
    { ...PHOSANI_TOTEM, id: "phosani_totem", name: "Totem", npcId: 9434 },
    { ...PHOSANI_TOTEM, id: "phosani_totem_charging", name: "Totem", npcId: 9435 },
    { ...PHOSANI_TOTEM, id: "phosani_totem_charged", name: "Totem", npcId: 9436, idleSeq: 8589 },
    // Up and running, unlike hers, as quick as the Inquisitor, and nothing
    // thrown: they hold on arriving, for as long as they stand
    { ...PHOSANI_HUSK, id: "phosani_husk_magic", name: "Husk", npcId: 9454 },
    { ...PHOSANI_HUSK, id: "phosani_husk_ranged", name: "Husk", npcId: 9455 },
    {
        id: "phosani_sleepwalker",
        name: "Sleepwalker",
        npcId: 9446,
        idleSeq: 8569,
        walkSeq: 8534,
        attackSeq: -1,
        deathSeq: -1,
        hp: 1,
        damage: 0,
        speed: 2.2,
        radius: 0.4,
        xp: 0,
        knockbackResist: 1,
        solid: true,
        sounds: { attack: -1, hit: 4263, death: 4235 },
    },
    // Flung out of her across the square and still until broken: the
    // Parasitic egg, the pet's item, a little bigger than it lies on the
    // ground, as the fight has no egg of its own. Left standing, a parasite
    // comes out of it. Its hitpoints are a few of the crossbow's bolts, so
    // the three can be run down in their time with her still at you, and
    // its bar shows how many are left.
    {
        id: "phosani_egg",
        name: "Parasitic egg",
        npcId: 9452,
        objId: 25838,
        idleSeq: -1,
        walkSeq: -1,
        attackSeq: -1,
        deathSeq: -1,
        hp: 100,
        damage: 0,
        speed: 0,
        radius: 0.5,
        xp: 0,
        knockbackResist: 1,
        scale: 1.5,
        stationary: true,
        healthBar: true,
        hintArrow: true,
        sounds: { attack: -1, hit: 4296, death: 4261 },
        hatches: {
            seconds: 15,
            into: "phosani_parasite_weak",
            count: 1,
            spotAnim: 1770,
            sound: 4265,
        },
    },
    // Her parasites run for her, or for a totem the player is working on, and
    // heal her shield or undo its charge a good deal at a time, as in the real
    // fight: a dozen bolts' worth each, with a bar to watch them go, so they
    // are shot down on the way or they cost the fight dearly
    {
        ...PARASITE,
        id: "phosani_parasite",
        name: "Parasite",
        hp: 400,
        solid: true,
        healthBar: true,
        speed: PARASITE_SPEED,
        heals: PHOSANI_PARASITE_HEALS,
    },
    {
        ...PARASITE,
        id: "phosani_parasite_weak",
        name: "Parasite",
        npcId: 9453,
        hp: 200,
        solid: true,
        healthBar: true,
        speed: PARASITE_SPEED,
        heals: PHOSANI_PARASITE_HEALS,
    },
];
