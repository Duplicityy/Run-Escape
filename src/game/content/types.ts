import { Rarity } from "./rarity";

// Content is plain data: what an enemy, weapon or passive is, with cache ids
// for how it looks. The simulation reads the numbers; the client reads the ids.

// Every multiplier and bonus a run's stats are made of (VS "power ups")
export type StatKey =
    | "might" // damage multiplier bonus (0.1 = +10%)
    | "armor" // flat damage taken reduction
    | "maxHp" // max hitpoints multiplier bonus
    | "regen" // hitpoints a minute
    | "cooldown" // weapon cooldown reduction (0.1 = 10% faster)
    | "area" // weapon area multiplier bonus
    | "speed" // projectile speed multiplier bonus
    | "duration" // effect duration multiplier bonus
    | "amount" // extra projectiles
    | "moveSpeed" // movement speed multiplier bonus
    | "magnet" // pickup range multiplier bonus
    | "luck" // luck bonus (more choices, better drops)
    | "growth" // xp multiplier bonus
    | "greed" // coin multiplier bonus
    | "revival" // extra lives
    | "reroll" // extra rerolls of a level up's rewards or a casket's item
    | "banish" // weapons, passives or items that can be kept out of the run
    | "thorns" // damage dealt back to whatever hits you
    | "healChance" // chance a hit heals the player (blood fury)
    // Damage multiplier bonuses for one combat style's weapons only (see
    // WeaponDef.damageStyle), on top of might
    | "meleeMight"
    | "rangedMight"
    | "magicMight"
    | "auraArea" // auras' radius multiplier bonus, on top of area
    // Damage multiplier bonus against bosses only, on top of might
    | "bossMight"
    // Damage multiplier bonus for each level gained in the run (so it grows
    // as the run goes on), on top of might
    | "levelMight"
    // Melee weapons' knockback multiplier bonus
    | "meleeKnockback"
    // Slots on top of the usual ones, bought in the shop
    | "weaponSlots"
    | "passiveSlots"
    // How much more often power-ups drop
    | "powerUpRate";

export type Stats = Record<StatKey, number>;

export function emptyStats(): Stats {
    return {
        might: 0,
        armor: 0,
        maxHp: 0,
        regen: 0,
        cooldown: 0,
        area: 0,
        speed: 0,
        duration: 0,
        amount: 0,
        moveSpeed: 0,
        magnet: 0,
        luck: 0,
        growth: 0,
        greed: 0,
        revival: 0,
        reroll: 0,
        banish: 0,
        thorns: 0,
        healChance: 0,
        meleeMight: 0,
        rangedMight: 0,
        magicMight: 0,
        auraArea: 0,
        bossMight: 0,
        levelMight: 0,
        meleeKnockback: 0,
        weaponSlots: 0,
        passiveSlots: 0,
        powerUpRate: 0,
    };
}

// What some weapons hit harder (the Ivandis flail and undead, vampyres)
export type EnemyTag = "undead" | "vampyre";

export type EnemyDef = {
    id: string;
    name: string;
    npcId: number;
    idleSeq: number;
    walkSeq: number;
    // -1 when the NPC has none we know of
    attackSeq: number;
    // -1: sink into the ground instead
    deathSeq: number;
    // Played jumping a ditch (MapDef.ditch); without one it just goes over
    jumpSeq?: number;
    hp: number;
    // Damage per hit when touching the player
    damage: number;
    // Tiles per second
    speed: number;
    // Collision radius in tiles (kept under half a tile so everything fits
    // through doors)
    radius: number;
    // XP of the bones it drops
    xp: number;
    // 0 = full knockback, 1 = immune
    knockbackResist?: number;
    // Render scale on top of the NPC's own
    scale?: number;
    // Walks through walls and water (though it turns up where the rest do)
    ghost?: boolean;
    // Flies over fences, buildings' walls, trees and water, as the walkers can't,
    // and has to go round terrain walls as they do (FlightGrid)
    flies?: boolean;
    // Cache sound effect ids
    sounds: { attack: number; hit: number; death: number };
    // Bosses: the toast when they turn up, and a spot animation and sound
    // where they do (the Wise Old Man teleports in)
    spawnMessage?: string;
    spawnSpotAnim?: number;
    spawnSound?: number;
    // Bosses that fight with attacks of their own (instead of hitting
    // whatever they touch)
    boss?: BossDef;
    // Drawn as a player in one of these outfits (picked at random as each one
    // turns up) instead of as the NPC: the fun maps' scammers, pkers and
    // noobs. npcId is unused then.
    outfits?: EnemyOutfit[];
    // Shoots at the player from a distance as well as hitting what it touches
    // (the fun maps' rangers and mages): a weak shot, for the enemy's own
    // damage, that only hits when a crowd's hit could
    shot?: EnemyShotDef;
    // Lines it says now and then, over its head (the fun maps' chat)
    chat?: string[];
    // Never moves, and can't be knocked back or left behind (Pest Control's
    // portals, Zulrah); the player can't walk through it either
    stationary?: boolean;
    // Prays against these styles: weapons' hits of them do this share of their
    // damage (the Theatre of Blood's bosses, in a raid that's melee's)
    protects?: { styles: CombatStyle[]; damage: number };
    // On a raid's expert mode, only this style's weapons hurt it (the Nylocas:
    // grey melee, green ranged, blue magic). Everything else still does.
    onlyStyle?: CombatStyle;
    // On a raid's expert mode, it turns up as this enemy instead (the Maiden's
    // Nylocas Matomenos, as ones that heal her)
    expertAs?: string;
    // Turns up at one of these spots (world tiles, picked at random) rather
    // than somewhere near the player (the portals stand where they do in the
    // game)
    spawnAt?: { x: number; y: number }[];
    // Calls in enemies around itself now and then (a portal's pests)
    spawns?: EnemySpawnsDef;
    // Takes no damage for a while after it turns up (a portal's shield): hits
    // show as blocked, it's tinted, and the spot animation loops on it.
    // message: the notice when it drops. look: an NPC it's drawn as while
    // shielded instead, as the game has a shielded version of it (Pest
    // Control's portals).
    shield?: {
        seconds: number;
        spotAnim?: number;
        message?: string;
        look?: { npcId: number; idleSeq: number };
    };
    // Heals hurt bosses or other enemies near it (Pest Control's spinners heal
    // the portals, Jad's healers heal Jad)
    heals?: EnemyHealsDef;
    // Brings a dead enemy back where it fell now and then (the Inferno's
    // Jal-Zek)
    revives?: EnemyRevivesDef;
    // Splits into smaller enemies when it dies (the Inferno's Jal-Ak)
    splits?: { into: string; count: number; spotAnim?: number };
    // Blows up when it dies, hurting the player if they're close (Pest
    // Control's splatters). damage is like EnemyDef.damage (the map's
    // difficulty and the run's time scale it the same way).
    explodes?: { damage: number; radius: number; spotAnim?: number; sound?: number };
    // Drawn as this item's model, never animated, instead of as the NPC
    // (Phosani's eggs are the Parasitic egg): npcId goes unused
    objId?: number;
    // Still alive this many seconds after it turns up, it's gone, and count of
    // into come out where it stood, dropping nothing (Phosani's eggs hatch
    // parasites unless they're broken first)
    hatches?: { seconds: number; into: string; count: number; spotAnim?: number; sound?: number };
    // Its health bar's over it for as long as it's alive, full or not, so what
    // it's got left can be read at a glance (Phosani's eggs, against their time)
    healthBar?: boolean;
    // The player can't push it: walking into it, they're the one that gives,
    // as with what can't move (Phosani's Nightmare and everything of hers)
    solid?: boolean;
    // The game's hint arrow bobs over it while it's alive, and points the way
    // from the screen's edge when it's off it (Phosani's eggs, to be found)
    hintArrow?: boolean;
    // Now and then digs in or blinks and comes up right by the player
    // (Jal-ImKot burrows, Pest Control's shifters teleport)
    blinks?: EnemyBlinksDef;
    // Enemies of different factions hurt each other when they touch (the God
    // Wars Dungeon's armies), while still coming for the player; each
    // faction's come from their own side, so the armies meet
    faction?: string;
    // What it is, for the weapons that hit some things harder
    tags?: EnemyTag[];
    // Runs from the player when they're within range tiles instead of coming
    // at them, and doesn't come closer than twice that (Castle Wars' flag
    // carrier, off home with the flag)
    flees?: { range: number };
    // Holds the player where they stand for this many seconds once it reaches
    // them, or until it's dead (Phosani's husks): the boss holds off meanwhile,
    // as it does for a summon that holds
    holds?: number;
    // Bosses: turns up as a reward casket of this tier instead, lying near the
    // player with its beam like any other (the Mimic). Walking onto it, or
    // leaving it for seconds, sets it shaking, and shake seconds later it opens
    // and the boss comes out, playing seq. warning: spot animations spinning in
    // a ring ringRadius tiles round it while it shakes, for stepping back from
    // (the Mimic's sweets).
    disguise?: {
        casket: CasketTier;
        seconds: number;
        shake: number;
        seq?: number;
        warning?: { spotAnims: number[]; count: number; ringRadius: number };
    };
    // Bosses: the caskets it drops, in place of the usual one (elite, now and
    // then master). The flag carrier's flag is worth a second; a Pest Control
    // portal's is smaller, as there are four of them.
    caskets?: CasketTier[];
};

export type EnemySpawnsDef = {
    // What comes, picked by weight like a wave's enemies
    enemies: { id: string; weight: number }[];
    // Seconds between calls (the first a call's time after it turns up), and
    // how many come each time
    interval: number;
    count: number;
    // No more than this many of its own alive at once (8 when unset)
    max?: number;
    // Tiles from it they turn up (2 when unset), and a spot animation where
    // each one does
    radius?: number;
    spotAnim?: number;
    // What it calls in drops its bones and nothing else (no caskets, coins,
    // food or power-ups), so a portal left standing isn't a casket farm
    bonesOnly?: boolean;
};

export type EnemyHealsDef = {
    // Heals this fraction of a target's hitpoints every interval seconds, the
    // most hurt one within range tiles
    fraction: number;
    interval: number;
    range: number;
    // Enemy ids it heals; any boss when unset
    targets?: string[];
    // Walks over to a hurt target this many tiles away or closer (12 when
    // unset), instead of coming for the player. Keep it under the distance at
    // which enemies left behind are brought back to the player (34 tiles).
    seek?: number;
    // Shown on what it heals
    spotAnim?: number;
};

export type EnemyRevivesDef = {
    // Every interval seconds, the last enemy to die within range tiles of it
    // (not a boss or an elite, and not one that's been brought back already)
    // gets back up where it fell, with this fraction of its hitpoints (all
    // when unset). Brought back, it drops nothing the second time.
    interval: number;
    range: number;
    hp?: number;
    // Shown where it gets up, and the reviver's animation (its attackSeq when
    // unset)
    spotAnim?: number;
    seq?: number;
};

export type EnemyBlinksDef = {
    // Every interval seconds, when it's further than minRange tiles from the
    // player, it stands still for windup seconds (playing seq, with
    // castSpotAnim where it is) and comes up distance tiles from the player
    // (with impactSpotAnim there)
    interval: number;
    minRange: number;
    distance: number;
    windup?: number;
    seq?: number;
    castSpotAnim?: number;
    impactSpotAnim?: number;
    sound?: number;
    // Comes up slowly, playing seq for seconds (and sound again, for the warning):
    // it can be hit, but doesn't move or hit anything until it's up
    surface?: { seq: number; seconds: number };
    // Seconds before another of its kind can go after one does, so a crowd left
    // behind don't all land on the player at once
    gap?: number;
};

// A player look for an enemy: worn items by equipment slot, and optionally
// body colours (hair, torso, legs, feet, skin) and the female body
export type EnemyOutfit = {
    equipment: Partial<Record<number, number>>;
    colors?: number[];
    female?: boolean;
};

export type EnemyShotDef = {
    // Shoots when the player is this many tiles away or closer, and stops
    // walking up at about three quarters of it
    range: number;
    // Seconds between shots
    interval: number;
    // Tiles per second
    speed: number;
    // In flight, on the shooter as it fires, and where it hits
    spotAnim: number;
    castSpotAnim?: number;
    impactSpotAnim?: number;
    // The shooter's animation as it fires (its attackSeq when unset)
    seq?: number;
    // Cache sound effects when it fires and when it hits
    sound?: number;
    hitSound?: number;
};

// Something a boss attack does to the player besides its damage
export type PlayerEffectDef =
    // Can't move for a moment (the King Black Dragon's ice breath)
    | { kind: "freeze"; seconds: number }
    // Damage every second for a while (poison breath)
    | { kind: "poison"; damage: number; seconds: number }
    // Stats lowered for a while (Karil's tainted shot, Ahrim's curses).
    // stacks: another dose adds to it, up to this many at once, and starts the
    // clock again (Slash Bash's disease); it replaces it when unset
    | {
          kind: "debuff";
          id: string;
          name: string;
          iconObjId: number;
          stats: Partial<Stats>;
          seconds: number;
          stacks?: number;
      }
    // Takes this fraction of the run's coins (the Wise Old Man's Telekinetic
    // Grab); they come back when the boss dies
    | { kind: "steal"; fraction: number }
    // Shuffles which way the player's controls go until the boss has made this
    // many more attacks (The Nightmare's Curse, with no prayers here to swap)
    | { kind: "curse"; attacks: number }
    // Slows the player, and has the boss attacking faster, for a while
    // (The Nightmare's spores)
    | {
          kind: "drowsy";
          id: string;
          name: string;
          iconObjId: number;
          moveSpeed: number;
          bossInterval: number;
          seconds: number;
      };

// What a boss's "pattern" attack fires, as a bullet hell does
export type BulletPatternDef = {
    // ring: evenly spaced all round; spiral: a ring that turns between volleys;
    // spread: a fan aimed at the player; wall: a line across, coming at the
    // player, with a gap somewhere new each volley (Sotetseg's maze); closing: a
    // ring round the player, distance tiles out, closing in, with a gap
    shape: "ring" | "spiral" | "spread" | "wall" | "closing";
    // Bullets a volley, how many volleys, and seconds between them
    count: number;
    volleys: number;
    interval: number;
    // Tiles per second, and how far they go
    speed: number;
    range: number;
    // Tiles
    radius: number;
    // Radians a volley turns by (a spiral's arms)
    turn?: number;
    // Radians from one side of a spread to the other
    arc?: number;
    // Radians a second each bullet curves by as it flies
    curve?: number;
    // Rings and spirals: radians left empty in each volley, from the ring's own
    // angle, so there's a way through that moves round with turn. A wall or a
    // closing ring: its bullets left out, side by side, for the way through
    gap?: number;
    // Rings and spirals: the gap's put on the side of the player it's aimed at
    // ("player") or the far side of the boss from them ("away", so the way
    // out is round behind her), instead of at random
    gapAt?: "player" | "away";
    // Spreads: aimed afresh at the nearest player with every volley, as a
    // stream that follows them (keep stepping across it)
    track?: boolean;
    // Each volley's fired twice, the second mirrored about the aim, so the
    // two turn opposite ways: a sweep's arms open like scissors, a spiral
    // winds against itself
    mirror?: boolean;
    // Tiles a second added to each volley's speed after the first, so later
    // volleys catch the earlier ones up and the lattice closes as it arrives
    speedUp?: number;
    // Rings and spirals: fired from a circle this many tiles round the nearest
    // player, flying inwards, rather than out from the boss (the ring closes
    // in on them, and the gap's the way out)
    around?: number;
    // A wall's tiles between bullets; a closing ring's tiles out
    spacing?: number;
    distance?: number;
    // Tiles out from the boss's middle a ring, spiral or spread starts, and a wall in front of it:
    // a pocket by the boss the volley never crosses, for whoever fights up close
    from?: number;
    // Model scale, when its hit size would leave it too thin to dodge, and how
    // much it's lit up against dark ground (0 to 1)
    scale?: number;
    bright?: number;
    // Seconds the boss stands still firing before it can begin its next attack,
    // instead of until the last volley's out: a slow ring keeps coming while
    // she aims the next thing through it (Phosani's)
    channel?: number;
    // Fired in bursts: count volleys at interval, then pause seconds before
    // the next burst, so a sweep's arm has holes along it to run through
    burst?: { count: number; pause: number };
};

// Where a boss's "ground" attack marks the ground, each spot radius tiles
// across. Everything's on the ground for the attack's windup before it lands.
export type GroundPatternDef = {
    // under: on the boss; player: on the player; ring: around the boss (or
    // the player, with around), distance tiles out; grid: a lattice around
    // the player, spacing tiles apart; scatter: at random within spread tiles
    // of the player, none on another
    spots: (
        | { shape: "under" | "player" }
        | { shape: "ring"; count: number; distance: number; around?: "player" }
        | { shape: "grid"; size: number; spacing: number }
        // awayFrom: no closer to the boss than this, and on ground the player can get to
        | { shape: "scatter"; count: number; spread: number; awayFrom?: number }
    )[];
    radius: number;
    // Set: it stays armed this many seconds after the windup, going off under
    // whoever comes within radius rather than landing all at once (spores)
    armed?: number;
    // Marks somewhere safe rather than somewhere to keep off: it does no damage, and
    // its attack's projectile does nothing to whoever's standing in it (Verzik's
    // green ball, on expert). The attack lays it as it's cast.
    safe?: boolean;
    // It stays on the ground this many seconds once it's landed, hurting whoever
    // stands in it every interval seconds for this share of its damage (the
    // Maiden's blood, Xarpus's acid)
    lingers?: { seconds: number; interval: number; damage: number };
    // What's drawn at each spot, scaled to radius: scenery, or a spot animation.
    // It's all that marks the spot, so it has to be there from the start. fit: how
    // much bigger than that, for a model with more around it than it looks.
    locId?: number;
    spotAnim?: number;
    fit?: number;
    // Drawn in the middle of the spot, faintly, as the warning; and with grab
    // set, played out there in full as the spot lands, for seconds, scaled so
    // it fits the spot's radius times fit (Grasping Claws' hands coming up
    // out of the ground). up is when in that animation, in seconds from
    // landing, what comes up is in sight: the warning (a frame from then,
    // held) stays until up.from, and the spot only hurts from up.from to
    // up.to, so nothing's hit by what can't be seen. Without grab it's drawn
    // as it is, for what can't be scaled up.
    middleSpotAnim?: number;
    grab?: { seconds: number; fit: number; up: { from: number; to: number } };
};

// A boss's corpse flowers: lines cross near the player, and the quarters but
// one hurt them every interval seconds for seconds, healing the boss
export type QuartersDef = {
    seconds: number;
    interval: number;
    // While the flowers stand the boss stays put and uses only these of its
    // attacks (by name, cooldowns or not), one every interval seconds
    during?: { attacks: string[]; interval: number };
    // How much of its shield the boss gets back for each hit
    heal: number;
    // Tiles from the player the lines cross at most, and how far apart the
    // flowers along them stand
    offset: number;
    spacing: number;
    // Scenery for the flowers: on the lines of the safe quarter, and elsewhere
    safeLocId: number;
    hurtLocId: number;
};

export type BossAttackDef = {
    name: string;
    // Only on a raid's expert mode
    expert?: boolean;
    // swing: hits around the boss once the windup is done (step away to dodge);
    // projectile: fired where the player stands, so moving dodges it;
    // blast: lands on the spot the player stood on when it was cast;
    // teleport: the boss blinks away to somewhere else near the player;
    // summon: calls in enemies around the boss;
    // pattern: fires BulletPatternDef's volleys;
    // ground: marks the ground, GroundPatternDef;
    // quarters: QuartersDef's flowers split the arena;
    // surge: goes to the arena's edge in line with the player, then charges
    // right across it, hitting what's in its lane;
    // mark: lands effect or parasite on the player, however far they run
    kind:
        | "swing"
        | "projectile"
        | "blast"
        | "teleport"
        | "summon"
        | "pattern"
        | "ground"
        | "quarters"
        | "surge"
        | "mark";
    // Out of the player's 25 base hitpoints; the biggest hits take about half
    damage: number;
    // Seconds the boss stands winding up (and animating) before it lands
    windup: number;
    // Seconds before this attack can be used again, on top of the boss's
    // attack interval
    cooldown: number;
    // Used when the player is between minRange and range tiles away
    range: number;
    minRange?: number;
    // Relative chance of picking this attack among the ones in range
    weight: number;
    // Swings and blasts: tiles around the boss (or the spot) they hit.
    // Teleports: how far from the player the boss lands.
    // Surges: tiles either side of the lane's middle.
    // Projectiles: each one's hit radius (0.35 tiles unless set).
    radius?: number;
    // Swings: hits only a wedge this many radians across, in the way the boss
    // faced as it began, and under the boss (around it, underRadius tiles)
    cone?: number;
    underRadius?: number;
    // Projectiles: tiles per second, how many (fanned out by spread radians),
    // and how fast they turn towards the player (radians per second).
    // Blasts: how many land (the first on the player, the rest scattered up
    // to spread tiles around them).
    speed?: number;
    count?: number;
    spread?: number;
    homing?: number;
    // Shown on the boss as it's used (where it leaves, for a teleport), in
    // flight, and where it hits (where it arrives)
    castSpotAnim?: number;
    spotAnim?: number;
    impactSpotAnim?: number;
    // Summons: what comes, and how many.
    // beside: they turn up by the player rather than the boss.
    // holds: the player can't move until they're dead or this many seconds
    // have gone, and the boss holds off whatever they couldn't step out of.
    // walkTo: they turn up around the boss, distance tiles out, and walk to
    // it. Those that get there are absorbed: when the last is dead or
    // absorbed, a blast no one can dodge hits for damage, plus perAbsorbed
    // for each one. (The Nightmare's Sleepwalkers.)
    // scatter: they turn up at random, as far off as a wave's enemies do, and
    // come for the player (Phosani's husks, which hold once they arrive).
    // distance: tiles from the boss (or the player, with beside) they turn up,
    // in a ring, instead of right by them (Phosani's rooted husks).
    // thrown: they fly out of the boss to spots about distance tiles off in
    // random directions, over seconds, and can't be hit until they land; what
    // hatches counts its time from landing (Phosani's eggs, to be chased down).
    summon?: {
        enemyId: string;
        count: number;
        // Comes with them, one of it (a Husk of each kind)
        alsoId?: string;
        beside?: boolean;
        scatter?: boolean;
        distance?: number;
        thrown?: { seconds: number };
        holds?: number;
        walkTo?: { distance: number; perAbsorbed: number };
    };
    // A mark on the player, bursting after seconds for damage (and the attack's
    // hit damage does nothing), leaving enemyId behind. An antidote keeping
    // poison off halves the hit, and leaves weakEnemyId instead. (The
    // Nightmare's parasites.)
    parasite?: { seconds: number; enemyId: string; weakEnemyId: string };
    pattern?: BulletPatternDef;
    ground?: GroundPatternDef;
    quarters?: QuartersDef;
    // Boss animation while winding it up (the boss's attackSeq when unset)
    seq?: number;
    // Cache sound effects as it starts winding up, when it's used and when it
    // hits
    windupSound?: number;
    sound?: number;
    hitSound?: number;
    effect?: PlayerEffectDef;
    // Armour doesn't soak any of it (Verac's flail hits through defences)
    ignoreArmor?: boolean;
    // Blasts: the boss jumps onto the spot the player stood on, landing as it
    // hits (one of several, the first)
    leap?: boolean;
    // Used again this many more times straight after, each wound up for
    // windup seconds, before the boss's usual interval: dashes back to back,
    // claws again and again. A surge's lane and a ground attack's spots are
    // picked afresh each time.
    chain?: { times: number; windup: number };
    // Another of the boss's attacks, by name, begins delay seconds after this
    // one's fired, before anything else and whatever's still in the air: slow
    // rings and then an aimed barrage, a fan that parts round the player and
    // then a claw where they stand
    follow?: { attack: string; delay: number };
    // The boss leaps to the middle of the arena as it begins (castSpotAnim
    // where it left), and a quarters attack's lines cross there
    toMiddle?: boolean;
    // Only used once the boss is enraged
    enraged?: boolean;
    // Only used in these of the boss's phases (BossDef.phases), counting from 1
    phases?: number[];
    // Said over the boss's head when it's used, like OSRS overhead chat
    shout?: string;
    // A message on screen when it's used, for attacks the player has to do
    // something about
    message?: string;
    // Blasts: each one leaves a pool that lasts seconds, hurting a player
    // standing in it every interval seconds, with effect if it's set (Slash
    // Bash's bile). radius is the pool's; damage is like the attack's.
    pool?: {
        seconds: number;
        radius: number;
        damage: number;
        interval: number;
        effect?: PlayerEffectDef;
        // Scenery it's drawn as, spread to its radius
        locId: number;
    };
    // Blasts: the last of the spots each bring one of these enemies, unless
    // the boss still has that kind up; they drop nothing (the Mimic's red,
    // green and blue candies bring its Third Age minions)
    candies?: string[];
    // Blasts: the spot animation of each spot in turn in place of
    // impactSpotAnim (each candy's colour)
    impactSpotAnims?: number[];
    // Stopped by the boss's glyph (BossDef.glyph): a swing or blast lands
    // on the player only if the glyph isn't between them and the boss, and
    // projectiles break on it, so the player can hide behind it.
    blockable?: boolean;
};

// A big entrance: the player can't be hit, the screen goes dark, and everything
// else stops attacking and runs for the nearest edge of the map and is gone.
// The boss rises partway through, and the fight starts when it's over.
export type BossIntroDef = {
    // How long it all takes, and how far in the boss rises
    seconds: number;
    riseAt: number;
    // Its animation as it rises (its idle when unset), and shown where it does
    seq?: number;
    spotAnim?: number;
    sound?: number;
    // On the screen as it rises
    title: string;
    subtitle?: string;
    // Played as the screen goes dark
    darkSound?: number;
    // Tiles from the player it rises, towards the arena's middle
    distance: number;
    // No waves or events until it's dead: it's the two of them
    alone?: boolean;
    // It rises at the middle of the map's bossArena, with the player brought
    // to distance tiles south of it (a party side by side), rather than beside
    // wherever they are (Phosani's Nightmare, in her square)
    atMiddle?: boolean;
    // The player can't move until it's over: they stand and watch it rise
    holds?: boolean;
};

// A pattern a boss keeps up by itself (BossPhasesDef ambient): the attack,
// by name, and seconds between one beginning and the next
export type BossAmbientDef = { attack: string; interval: number };

// A boss fought in phases: a shield to break, then totems in the arena's
// corners to charge with hits, whose blast takes away a share of its
// hitpoints, which nothing else can touch. The last blast ends it.
export type BossPhasesDef = {
    // One a phase. shield: of its hitpoints. opener: the attack (by name) it
    // begins with, before anything else. ambient: an attack of its (a
    // pattern, by name) it keeps up the whole phase on its own timer, begun
    // again every interval seconds under whatever else it's doing, through
    // holds and cooldowns: the floor the fight's dodged on. tempo multiplies
    // its interval between attacks and its patterns' windups (not the big
    // hits'), and speed its walk, so each phase is a gear up on the last.
    phases: {
        shield: number;
        opener?: string;
        ambient?: BossAmbientDef;
        tempo?: number;
        speed?: number;
    }[];
    // After the last blast it stands for seconds more before it falls, using
    // only these attacks (by name) interval seconds apart, opener first, with
    // ambient under them, and can't be hurt meanwhile: a last stand to live
    // through (Phosani's desperation phase). Without it the last blast kills.
    finale?: {
        seconds: number;
        attacks: string[];
        interval: number;
        opener?: string;
        ambient?: BossAmbientDef;
        message: string;
    };
    totems: {
        // The enemies: stands idle, can be charged, and is charged
        idleId: string;
        chargingId: string;
        chargedId: string;
        // Each stands turned to the arena's middle: this is added to that yaw
        // for a model whose mark isn't on its front (The Nightmare's totems'
        // scroll hangs three-quarters of the way round)
        yawOffset?: number;
        // Charge each needs, of the boss's hitpoints
        charge: number;
        // Tiles in from the arena's corners
        margin: number;
        // Shown on the boss, and played, as they fire; played as one's charged
        blastSpotAnim?: number;
        blastSound?: number;
        chargedSound?: number;
    };
    shieldMessage: string;
    blastMessage: string;
    // Of the player's hitpoints, given back by each blast
    blastHeal?: number;
};

// How a boss fights, after the real fight in OSRS
export type BossDef = {
    // Seconds between attacks
    attackInterval: number;
    attacks: BossAttackDef[];
    // Ranged bosses stop this many tiles away, and big ones far enough off not
    // to stand over you; other melee ones walk up
    keepDistance?: number;
    // Standing under it hurts every interval seconds for damage, then a
    // damage more each time, up to max; stepping out starts it over (the
    // Mimic's stomp)
    stomp?: { radius: number; interval: number; damage: number; max: number; sound?: number };
    // Dharok's set effect: hits get stronger as he loses hitpoints, up to
    // this much more at none left (1 = double)
    wretched?: number;
    // Vampyres heal this many hitpoints for each one they hit the player for
    lifesteal?: number;
    // Gets back up this many times, with this fraction of its hitpoints (a
    // vampyre doesn't stay down without a stake). into: the enemy it gets up
    // as, looks and attacks and all (the Kalphite Queen's second form).
    rises?: { times: number; hp: number; message: string; into?: string };
    // Every boss is enraged at half its hitpoints: it attacks and moves
    // faster, and uses its enraged attacks too. What it says when it is.
    enrage: { message: string; shout?: string };
    // Calls in enemies around itself as its hitpoints drop to each fraction
    // (Kree'arra's bodyguards); a form it gets up as (rises.into)
    // calls in its own as it's hurt in turn (Nex's bodyguards)
    summonsAt?: {
        hp: number;
        enemyId: string;
        count: number;
        message?: string;
        shout?: string;
    }[];
    // A shield that slides back and forth between the boss and the player,
    // which its blockable attacks can't get through (like TzKal-Zuk's
    // ancestral glyph in OSRS). Its line is distance tiles from the boss towards where the
    // player was when the boss turned up, across that way, halfLength tiles
    // either side; it moves along it at speed tiles a second, and blocks
    // width tiles either side of its middle.
    glyph?: {
        // The enemy it looks like (an NPC that's never spawned)
        lookId: string;
        distance: number;
        halfLength: number;
        speed: number;
        width: number;
    };
    intro?: BossIntroDef;
    phases?: BossPhasesDef;
    // Seconds after one of its bullets hits a player before another can (a
    // second when unset): what a bullet hell's worth of petals can do to
    // someone stood in them
    bulletGrace?: number;
    // A final boss: the run goes on this many seconds after it falls, for its
    // death animation to play before the victory screen, with nothing
    // landing on the players meanwhile (the run's time is to the fall)
    fallSeconds?: number;
    // On a raid's expert mode, once enraged, it stares one way every `every` seconds, a quarter
    // turn at a time: a weapon's hit from within arc radians of that way does nothing to it and
    // hurts its wielder for damage instead, a hit every half second at most (Xarpus)
    stare?: { every: number; arc: number; damage: number; message: string };
    // On a raid's expert mode, it changes into the next of these forms every `every` seconds,
    // keeping its hitpoints (Nylocas Vasilias's colours: each takes one style, EnemyDef.onlyStyle)
    colours?: { every: number; forms: string[] };
    // Walks with its guard up, taking awakeDamage of every hit, and every `every` seconds goes
    // down for `seconds`, standing still and taking all of it, then gets up with its `wake` attack
    // (the Pestilent Bloat). seq: its animation while it's down.
    naps?: {
        every: number;
        seconds: number;
        awakeDamage: number;
        wake: string;
        seq: number;
        message: string;
        wakeMessage: string;
    };
    // Further than this from the player, it blinks back to about keep tiles
    // from them (a fight across a big arena stays on the screen). With jump,
    // it plays downSeq for seconds where it is, then upSeq for seconds where
    // it lands, instead of just being there (The Nightmare into the ground
    // and up out of it)
    leash?: {
        distance: number;
        keep: number;
        spotAnim?: number;
        jump?: { downSeq: number; upSeq: number; seconds: number };
    };
    // Its animation as it charges (BossAttackDef surge), and as it stands
    // winding one up
    surgeSeq?: number;
};

// How a character fights, for the weapons only their class can find
export type CombatStyle = "melee" | "ranged" | "magic";

// sweep: hits everything in an arc in front (a scythe or a two-handed sword);
// axes: thrown at the nearest enemies, bouncing on from each to the next;
// orbit: circles the player for a while, hitting what it passes
export type WeaponKind =
    | "slash"
    | "sweep"
    | "missile"
    | "knives"
    | "axes"
    | "aura"
    | "strike"
    | "orbit";

export type WeaponLevel = {
    damage: number;
    // Seconds between uses
    cooldown: number;
    // Projectiles / targets / directions per use
    amount: number;
    // Tiles: slash or sweep reach, aura radius, strike or blast radius, how
    // far from the player an orbit circles
    area: number;
    // Sweeps: half the angle they cover, radians
    arc?: number;
    // Enemies a projectile passes through
    pierce: number;
    // Thrown axes: enemies an axe bounces on to after the first it hits
    bounce?: number;
    // Projectile speed, tiles per second (around the circle, for an orbit)
    speed: number;
    // Seconds: freeze length, how long venom lasts, how long an orbit circles
    duration: number;
    // Damage a second that its hits poison for, for duration seconds (the
    // Toxic blowpipe's venom; projectiles and auras)
    venom?: number;
    // Tiles pushed back per hit
    knockback: number;
    // What this level adds, for the level up screen
    description: string;
    // Item shown in the player's hand at this level
    objId?: number;
    // Knives: the item that flies when it isn't the one held (the atlatl's
    // darts)
    projectileObjId?: number;
    // Sounds at this level, overriding the weapon's (spells sound different
    // as they upgrade)
    sound?: number;
    hitSound?: number;
    // Spot animations at this level (spells change look as they upgrade)
    projectileSpotAnim?: number;
    impactSpotAnim?: number;
    castSpotAnim?: number;
    name?: string;
};

export type WeaponDef = {
    id: string;
    name: string;
    kind: WeaponKind;
    description: string;
    // Item for the icon and, for thrown weapons, the projectile
    iconObjId: number;
    // Player animation when used (played while standing still)
    playerSeq: number;
    // Cache sound effect when used, and when it hits (-1 for none)
    sound: number;
    hitSound: number;
    levels: WeaponLevel[];
    // How often it's offered on level ups
    rarity: Rarity;
    // Replaces this weapon once it's at max level and the passive is owned
    evolution?: { into: string; requiresPassive: string };
    // Evolved weapons only come from evolution
    evolved?: boolean;
    // Class weapons: only offered to characters who fight this way
    style?: CombatStyle;
    // Weapons of a family (the godswords) share one weapon's chance of being
    // offered, and only one of them is carried
    family?: string;
    // Only comes from a pick (hilts) or an adventurer's start, never a level up's offer
    pickOnly?: boolean;
    // Used in place of every so many attacks (sweeps and slashes)
    special?: SpecialAttackDef;
    // Bosses and elites are hit again for these fractions of the damage (the
    // scythe hits big things three times; sweeps, slashes, projectiles and
    // strikes)
    bigHits?: number[];
    // Auras and strikes: what they hit can't move for the level's duration
    // (bosses shrug it off)
    freezes?: boolean;
    // Strikes: each impact's spot animation is scaled to this many times the
    // strike's radius and played out in full, rather than drawn as it is for
    // a moment (the Nightmare's hands coming up out of the ground)
    impactFit?: number;
    // Auras and strikes: what they hit takes this much more damage from
    // everything for the level's duration (0.2 = +20%; Shadow Burst)
    drain?: number;
    // Multiplies the damage bonus (might) for this weapon's hits (Tumeken's
    // shadow triples it)
    mightScale?: number;
    // Aims at the toughest enemy in range rather than the nearest, and hits
    // harder the more hitpoints the target has, up to this much more (1.5 =
    // +150%) against the toughest (the Twisted bow; missiles only)
    toughTargets?: number;
    // A hit has this chance of healing the player by a fraction of its
    // damage, up to max, with this spot animation on them (the Sanguinesti
    // staff; projectiles, auras and strikes)
    lifesteal?: { chance: number; fraction: number; max: number; spotAnim: number };
    // Orbits: the items circling the player, one for each in turn
    orbitObjIds?: number[];
    // Brought in by a task on a map, like an adventurer; in from the start
    // when unset
    unlock?: UnlockTask;
    // The style its hits count as for style damage bonuses (Rigour, Augury,
    // the rings): its class when it has one, otherwise slashes and sweeps are
    // melee, what's shot or thrown is ranged, and auras, strikes and orbits are
    // magic. Set for the exceptions (the fire spells fly, but they're magic).
    damageStyle?: CombatStyle;
    // Hits enemies with any of these tags this much harder (0.5 = +50%; the
    // Ivandis flail against vampyres and the undead)
    slayer?: { tags: EnemyTag[]; damage: number };
    // Slashes and sweeps: each enemy caught takes these hits, a fraction of
    // the damage each, a moment apart (the Dragon claws' four)
    hits?: number[];
    // Slashes and sweeps: what it hits with one of these tags passes the hit
    // on to up to count more of them within range tiles, for this fraction of
    // its damage, with spotAnim on each (the Blisterwood flail)
    chain?: { tags: EnemyTag[]; count: number; range: number; damage: number; spotAnim: number };
    // Missiles: each shot's first hit splits it into count more, which fly on
    // to the nearest other enemies for this fraction of its damage, passing
    // through pierce more (the Crystal bow)
    split?: { count: number; damage: number; pierce: number };
    // Missiles: each hit has this chance of an enchanted bolt's effect, one
    // picked by weight (the Armadyl crossbow)
    boltProcs?: { chance: number; procs: BoltProcDef[] };
    // Auras: each pulse leaves the ground around the player burning for the
    // level's duration, hurting what stands in it every half second for this
    // fraction of the level's damage (Toktz-mej-tal's obsidian), with flames
    // of locId (scenery, on its own animation) on it. radius: a fraction of
    // the aura's radius.
    burns?: { damage: number; radius: number; locId: number };
    // At this level the player picks one of these weapons to become, at the
    // same level (the godsword's blade takes a hilt): the level up's next
    // choice is the pick, each shown as its hilt
    hilts?: { level: number; into: { weaponId: string; hiltObjId: number }[] };
};

// An enchanted bolt's effect, when the Armadyl crossbow's bolt procs one
export type BoltProcDef = {
    name: string;
    weight: number;
    // Shown on what it hits
    spotAnim: number;
    effect: // Takes this fraction of the target's hitpoints too, up to max
        // times the bolt's damage (ruby bolts' Blood Forfeit)
        | { kind: "hpFraction"; fraction: number; max: number }
        // Hits this much harder and goes on through this many more (diamond
        // bolts' Armour Piercing)
        | { kind: "pierce"; damage: number; pierce: number }
        // Sets it burning: this fraction of the bolt's damage every second for
        // seconds (dragonstone bolts' Dragon's Breath)
        | { kind: "burn"; damage: number; seconds: number };
};

// A godsword's special attack
export type SpecialAttackDef = {
    name: string;
    // Every this many attacks (held back until something is in reach)
    every: number;
    // Multiplies the attack's damage
    damage: number;
    // Player animation, and the spot animation on the player
    playerSeq: number;
    spotAnim: number;
    // Cache sound effect, the weapon's when unset
    sound?: number;
    // Hits everything within this many tiles all round the player (more with
    // area), not just what the swing reaches, with impactSpotAnim on each
    aoe?: { radius: number; impactSpotAnim?: number };
    effect?: // What it hits can't move for a while (bosses shrug it off)
        | { kind: "freeze"; seconds: number }
        // Heals the player by this fraction of the damage dealt, up to max
        | { kind: "heal"; fraction: number; max: number }
        // What it hits takes this much more damage from everything for a while
        // (0.25 = +25%)
        | { kind: "drain"; amount: number; seconds: number }
        // Sets what it hits burning: this fraction of the hit's damage every
        // second for seconds
        | { kind: "burn"; damage: number; seconds: number };
};

export type PassiveDef = {
    id: string;
    name: string;
    description: string;
    stat: StatKey;
    // What a Common pick adds to the stat; rarer picks add more
    perLevel: number;
    // How the stat reads on the level up screen: "+12% damage", "+1.5 armour"
    effect: string;
    unit: "percent" | "flat";
    // Adds exactly perLevel a pick, whatever its rarity (one more projectile)
    whole?: boolean;
    maxLevel: number;
    // How often it's offered on level ups
    rarity: Rarity;
    iconObjId: number;
    // An interface sprite shown for it instead of iconObjId's item (Piety's
    // prayer icon)
    iconSpriteId?: number;
    // Visible gear: the item worn at each level (index = level - 1)
    equipment?: { slot: number; objIds: number[] }[];
    // Stats it adds the same amount to as well (the Ring of wealth's coins,
    // Augury's effect duration)
    alsoAdds?: StatKey[];
    unlock?: UnlockTask;
};

// What brings an adventurer (or a weapon, passive or item) in: beating a map,
// or a task done in a run there
export type UnlockTask =
    // hard: on hard mode (a raid's challenge mode)
    | { kind: "beatMap"; mapId: string; hard?: boolean }
    // Kill this boss in a run on the map
    | { kind: "killBoss"; mapId: string; enemyId: string }
    // Last this many seconds in a run on the map
    | { kind: "survive"; mapId: string; seconds: number };

// What a quest asks for, counted over every run since quests came in
export type QuestObjective =
    // This many kills of these enemies between them; what: what they're
    // called ("chickens", "the Crazy archaeologist"), needed for more than one
    | { kind: "kill"; enemyIds: string[]; count: number; what?: string }
    // At least one kill of each of these
    | { kind: "killEach"; enemyIds: string[]; what?: string }
    // This many reward caskets opened
    | { kind: "caskets"; count: number }
    // The map beaten (not endless)
    | { kind: "beatMap"; mapId: string };

export type QuestDef = {
    id: string;
    // An OSRS quest's
    name: string;
    // The map it's done on, for the quest list; none for ones done all over
    mapId?: string;
    objective: QuestObjective;
    // Paid out once, when the run that finishes it ends
    coins: number;
};

export type CharacterDef = {
    id: string;
    name: string;
    description: string;
    // Sets which class weapons they can find
    style: CombatStyle;
    startingWeapon: string;
    // Worn items by equipment slot
    equipment: Partial<Record<number, number>>;
    // Identity kits (hair, jaw, torso, arms, hands, legs, feet) and body
    // colours (hair, torso, legs, feet, skin), when they're not the default
    // look (Durial321's long white hair)
    kits?: number[];
    colors?: number[];
    bonus: Partial<Stats>;
    // Always available when unset
    unlock?: UnlockTask;
    // Played on this map alone (a boss fight's, MapDef.fight.character), and
    // nowhere else: never in the roster, never unlocked, never counted (the
    // Inquisitor, Phosani's)
    only?: string;
};

export type ShopUpgradeDef = {
    id: string;
    // The OSRS skill (or item) the upgrade is themed as
    name: string;
    description: string;
    stat: StatKey;
    perRank: number;
    maxRank: number;
    baseCost: number;
};

export type WaveDef = {
    // Second of the run the wave starts
    start: number;
    enemies: { id: string; weight: number }[];
    // Enemies spawned per second while under maxAlive
    spawnRate: number;
    // Spawned at once to stay above this many alive
    minAlive: number;
    maxAlive: number;
};

export type RunEventDef =
    | { at: number; kind: "elite"; enemyId: string }
    | { at: number; kind: "ring"; enemyId: string; count: number }
    // Mid-run bosses, which drop an elite (or the odd master) casket, and the
    // final boss: killing it wins the run. hp: the boss's hitpoints on this
    // map, when they're not its own.
    | { at: number; kind: "boss" | "finalBoss"; enemyId: string; hp?: number };

// A place to play: the part of the world a run happens in, what comes at you
// there, and which map it opens up when it's beaten
export type MapDef = {
    id: string;
    name: string;
    description: string;
    // Shown on its card
    iconObjId: number;
    // World tiles: the rectangle collision is built for
    arena: { baseX: number; baseY: number; sizeX: number; sizeY: number };
    // The open square a boss with a fight of its own uses (BossDef.phases: its
    // totems' corners, its surges' lanes), in world tiles; all of the arena
    // when unset
    bossArena?: { baseX: number; baseY: number; size: number };
    // The plane (level) the arena is on: 0, the ground floor, when unset. Some
    // dungeons are higher up (the God Wars Dungeon's main cave is on plane 2);
    // only this plane is drawn, so the ones under it don't show through.
    plane?: number;
    // Where the player starts (moved to the nearest free spot if it's blocked)
    spawn: { x: number; y: number };
    // A ditch two tiles deep, its south row at y, across the arena (the
    // Wilderness Ditch): the player can't cross it, enemies jump it
    ditch?: { y: number };
    // Enemies' hitpoints and damage (bosses' attacks too) on top of their own
    difficulty: { hp: number; damage: number };
    // What hard mode multiplies those by here (see hard.ts for when it's unset).
    // More on the early maps, which a player with everything bought walks
    // through, and less on the late ones, which are hard enough already.
    hard?: { hp: number; damage: number };
    waves: WaveDef[];
    events: RunEventDef[];
    // The countdown before the final boss, and the victory title
    finalBossWarning: string;
    victoryText: string;
    // The OSRS music track that loops quietly through a run here, by name:
    // its recording goes in src/media/music, named as GameClient's musicFor
    // says, and until it's there the map plays nothing
    music?: string;
    // Fun maps: endless from the start and outside the unlock chain (see
    // FunMapDef). Campaign maps leave it unset.
    fun?: FunMapDef;
    // For development: a run here leaves the save alone
    dev?: boolean;
    // Ground of our own, from the ScapeRune recipe with this id: the game draws it softer
    // and leaves the world past the arena showing (scaperune/CLAUDE.md)
    scaperune?: boolean;
    // A seasonal event: open from the start, outside the campaign's chain
    seasonal?: boolean;
    // One boss fight and nothing else (Phosani's Nightmare): no waves, no
    // picks and no items, and its final boss rises as the run begins. Outside
    // the campaign's chain like a seasonal map, and open once requires (a map
    // id) has been beaten; it can't be endless. Everyone plays character there,
    // an adventurer made for the fight, whose starting weapon begins at
    // weaponLevel: that's the whole kit, and the fight's balanced to it.
    fight?: { requires: string; character: string; weaponLevel: number };
    // How the map's drawn, 1 as the game is and lower darker
    brightness?: number;
    // A raid: the run's a series of rooms rather than one timeline (see RaidDef). waves and
    // events are then every room's, for what bakes and checks a map's enemies.
    raid?: RaidDef;
};

// A raid's rooms, one after another. Each has its waves for a while, then the party's taken into
// its boss's room, which nobody leaves while the boss is up. Killing it takes them on to the next
// room, and the last room's boss is the final boss.
export type RaidDef = {
    rooms: RaidRoomDef[];
    // Seconds of waves a room has at the least, however long the last boss took (60 when unset)
    minWaveSeconds?: number;
};

// What a raid's supply chest sells between rooms, for raid points (like the Theatre of Blood's
// supplies): hitpoints back, or a boost for a while
export type RaidSupplyDef = {
    id: string;
    name: string;
    description: string;
    objId: number;
    price: number;
    effect:
        | { kind: "heal"; fraction: number }
        | { kind: "buff"; stats: Partial<Stats>; seconds: number; cures?: boolean };
};

export type RaidRoomDef = {
    name: string;
    // World tiles: where the party starts the room, where they're brought for the boss, and where
    // the boss turns up
    start: { x: number; y: number };
    arrive: { x: number; y: number };
    bossAt: { x: number; y: number };
    // The boss's room, in world tiles
    chamber: { minX: number; minY: number; maxX: number; maxY: number };
    // Where the hall's teleporter stands, in world tiles: walking up to it offers to skip the
    // rest of the room's waves (Sim's raidTeleports)
    teleporter?: { x: number; y: number };
    // The run's second the boss comes, as a campaign map's do (or minWaveSeconds into the room,
    // if that's later). The waves' starts and the events' times are from the room's start.
    at: number;
    waves: WaveDef[];
    events: RunEventDef[];
    boss: string;
    bossHp?: number;
    // How its hall looks while its waves are on: drawn this bright (as MapDef.brightness, lower
    // darker), and the screen washed with this colour (multiplied over it, so white is no change)
    hall?: { brightness?: number; wash?: string };
};

// A fun map runs endless from the start: there's no final boss, and a new
// round (everything tougher, see endless.ts) starts every fifteen minutes of
// waves. Bosses turn up at random from a pool instead of on a schedule.
export type FunMapDef = {
    // Bosses picked at random, the first at firstAt seconds into the run and
    // each after it every few minutes (between every[0] and every[1] seconds)
    bosses: {
        pool: string[];
        firstAt: number;
        every: [number, number];
        // The whole pool turns up at once instead (Pest Control's portals),
        // and the next lot comes a few minutes (every) after the last of them
        // is killed rather than on the clock. Killing them all drops this
        // casket where the last one fell, with the message.
        together?: { casket: CasketTier; message: string };
    };
    // Everyone plays this adventurer here, unlocked or not (Durial321 in
    // Falador)
    character?: string;
    // Seconds between chat lines from the enemies near the player (they say
    // their EnemyDef.chat lines)
    chatEvery?: number;
    // Lines the player says now and then, every few seconds (between every[0]
    // and every[1])
    playerChat?: { lines: string[]; every: [number, number] };
};

// Where a piece of gear is worn. The client's equipment slots, plus the ring
// (which no one sees).
export type GearSlot =
    | "head"
    | "cape"
    | "neck"
    | "body"
    | "shield"
    | "legs"
    | "hands"
    | "feet"
    | "ring";

// Worn for the rest of the run once equipped; one per slot
export type GearDef = {
    kind: "gear";
    id: string;
    name: string;
    objId: number;
    rarity: Rarity;
    slot: GearSlot;
    stats: Partial<Stats>;
    unlock?: UnlockTask;
    // Only made in the Armoury, by upgrading this piece (an ornament kit, an
    // imbue, a fortified version): never in a casket by itself. Its stats are
    // that piece's and a bit more.
    variantOf?: string;
    // The set it's part of (see sets.ts); a variant is part of its piece's
    set?: string;
};

// Pieces of gear that do more together: wearing enough of them gives a bonus
// on top of their own stats
export type SetDef = {
    id: string;
    name: string;
    // Pieces worn it takes for the bonus (of those with this set in items.ts)
    needed: number;
    // The bonus, for the UI: "+10% damage"
    bonus: string;
    stats?: Partial<Stats>;
    // A boost to the weapons of these kinds, or these weapons: more damage
    // (0.15 = +15%), faster (0.1 = 10% shorter cooldown), and more area
    weapons?: {
        kinds?: WeaponKind[];
        ids?: string[];
        damage?: number;
        cooldown?: number;
        area?: number;
    };
};

// What a utility item does when it's used
export type ItemUse =
    // Heals, and can change some stats for a while too (a Saradomin brew)
    | { kind: "heal"; amount: number; stats?: Partial<Stats>; seconds?: number }
    // A timed boost to some stats (stretched by effect duration)
    | { kind: "buff"; stats: Partial<Stats>; seconds: number }
    // Cures poison and boss drains and curses, keeps them off for a while
    // (stretched by effect duration), and can heal too
    | { kind: "cure"; seconds: number; heal?: number }
    // Pulls every bone on the ground to the player
    | { kind: "bones" }
    // Hurts everything around the player
    | { kind: "blast"; damage: number; radius: number; spotAnim: number }
    // Experience worth this many levels at the current level
    | { kind: "xp"; levels: number }
    // Co-op: a teammate can revive the player once more. Taken from the
    // casket at once, never kept, and only found in co-op.
    | { kind: "revive" };

// Carried in the inventory and used when the player wants (1-4); copies of
// the same item stack in one slot
export type UtilityDef = {
    kind: "utility";
    id: string;
    name: string;
    objId: number;
    rarity: Rarity;
    description: string;
    use: ItemUse;
    unlock?: UnlockTask;
};

export type ItemDef = GearDef | UtilityDef;

// Clue scroll reward caskets: the tier sets how rare the item inside is likely
// to be, and how many coins come with it
export type CasketTier = "easy" | "medium" | "hard" | "elite" | "master";

export type CasketDef = {
    tier: CasketTier;
    name: string;
    objId: number;
    color: string;
    // Relative chances of the item's rarity, before luck
    rarityWeights: Record<Rarity, number>;
    coins: [min: number, max: number];
};

// What a power-up does when it's picked up. Damage is at the start of a run;
// it grows as the enemies' hitpoints do.
export type PowerUpEffect =
    // Sets up a cannon by the player that shoots the nearest enemies in range,
    // amount at a time every interval seconds
    | {
          kind: "cannon";
          damage: number;
          interval: number;
          amount: number;
          range: number;
          seconds: number;
      }
    // Raises one of the thralls to fight beside the player
    | { kind: "thrall"; seconds: number }
    // Kills everything that isn't a boss; bosses lose this fraction of their
    // hitpoints
    | { kind: "nuke"; bossDamage: number }
    // Pulls every drop on the ground to the player
    | { kind: "magnet" }
    // Everything that isn't a boss stands still, and so does whatever turns up
    // meanwhile
    | { kind: "freeze"; seconds: number }
    // Rides off at this many times the speed with nothing able to hurt them,
    // for a set time: Effect duration doesn't stretch it
    | { kind: "sled"; seconds: number; speed: number }
    // A rock (locId) falls on the thickest crowd within range of the player,
    // delay seconds later, hitting everything within radius and throwing what
    // lives back this many tiles. Bosses lose bossDamage of their hitpoints.
    | {
          kind: "rock";
          delay: number;
          range: number;
          radius: number;
          damage: number;
          knockback: number;
          bossDamage: number;
          locId: number;
          spotAnim: number;
      }
    // A giant NPC charges through the crowd this many times, ignoring walls.
    // Each pass it hits everything within radius once, for damage, and throws
    // it this many tiles aside. Drawn at scale, playing walkSeq.
    | {
          kind: "rampage";
          seconds: number;
          passes: number;
          speed: number;
          radius: number;
          damage: number;
          knockback: number;
          npcId: number;
          walkSeq: number;
          scale: number;
      }
    // A ring (locId, drawn at scale) opens at the player's feet and warps
    // whatever walks within radius far away, showing spotAnim where it was
    | {
          kind: "ring";
          seconds: number;
          radius: number;
          locId: number;
          spotAnim: number;
          scale: number;
      }
    // Opens as a treat or a trick (see trickOrTreat.ts)
    | { kind: "pumpkin" }
    // Everything within range runs laps around the player at this many times
    // its speed, radius tiles out, and can't attack; a line for the player to
    // shout
    | {
          kind: "laps";
          seconds: number;
          range: number;
          radius: number;
          speed: number;
          shout: string;
      };

// What the player has in hand and how they stand while a power-up lasts. Baked
// with the player (GameAssets.getPowerUpLookRequests), so it's on at once.
export type PowerUpLook = { objId: number; idleSeq: number; moveSeq: number };

// Dropped now and then by enemies, picked up by walking over it and used there
// and then
export type PowerUpDef = {
    id: string;
    name: string;
    description: string;
    // Item for the icon, and on the ground unless locId is set
    objId: number;
    // Scenery drawn on the ground instead (the set-up cannon)
    locId?: number;
    // Relative chance of being the one that drops (0: it drops some other way)
    weight: number;
    // Its loot beam and minimap dot, when it isn't POWER_UP_COLOR
    color?: string;
    // Coins the Mysterious Old Man wants for it, at the start of a run
    price: number;
    // Flashes the screen this colour ("#rrggbb") when it's used
    flash?: string;
    // Cache sound effect when it's picked up (-1 for none)
    sound: number;
    // Cache sound effect when it wears off
    endSound?: number;
    // Cache sound effect each time it lands a blow
    hitSound?: number;
    // Worn while it lasts
    look?: PowerUpLook;
    effect: PowerUpEffect;
};

// What walking up to a random event's visitor does
export type RandomEventEffect =
    // Sells power-ups for the run's coins (the Mysterious Old Man)
    | { kind: "shop"; leaveLabel: string }
    // An odd one out to spot, for a free power-up
    | { kind: "quiz"; options: number; right: string; wrong: string; leaveLabel: string }
    // Experience, as a share of a level
    | { kind: "xp"; levels: number; message: string; sound: number }
    // Hitpoints, as a share of the maximum. ignoredHit: a share of the maximum
    // taken when they're left waiting, which never kills.
    | { kind: "heal"; fraction: number; ignoredHit?: number; message: string; sound: number }
    // A casket on the ground, as good as an elite's
    | { kind: "casket"; message: string; sound: number }
    // A boost for a while; name and objId are for its timer
    | {
          kind: "buff";
          name: string;
          objId: number;
          stats: Partial<Stats>;
          seconds: number;
          // Keeps poison and drains off, like an antidote
          cures?: boolean;
          message: string;
          sound: number;
      }
    // No one to walk up to: this boss comes straight for the player, with
    // hitpoints that keep up with the run. Not while another boss is out.
    | { kind: "ambush"; enemyId: string };

// Someone from OSRS's random events, turning up now and then during a run
export type RandomEventDef = {
    id: string;
    name: string;
    // Relative chance of being the one that turns up
    weight: number;
    // Not before this many seconds into the run
    minSeconds?: number;
    // Standing around to be walked up to; an ambush has none of these
    npcId?: number;
    idleSeq?: number;
    // On screen when they turn up, and when they're left waiting too long
    arrive?: string;
    leave?: string;
    // Said over their head while they wait
    shouts?: string[];
    // What they say on the screen they open (shop and quiz)
    speech?: string;
    effect: RandomEventEffect;
};

// An Arceuus thrall: follows the player and attacks what's near. Ranged and
// magic thralls shoot from beside the player; melee ones go after things.
export type ThrallDef = {
    id: string;
    name: string;
    npcId: number;
    idleSeq: number;
    walkSeq: number;
    attackSeq: number;
    style: CombatStyle;
    // Floats through walls
    ghost?: boolean;
    damage: number;
    // Seconds between attacks
    interval: number;
    // Tiles it shoots from, or how far from the player a melee one goes
    range: number;
    knockback: number;
    // Ranged and magic: the projectile, and where it hits
    projectileSpotAnim?: number;
    impactSpotAnim?: number;
    // Cache sound effect when it attacks
    sound: number;
};
