import { ArmouryUpgrades, getUpgradedGear } from "../content/armoury";
import { getCharacter } from "../content/characters";
import { PLAYER_GONE, PartyScale, getPartyScale } from "../content/coop";
import {
    LATER_ROUND_START,
    LATE_CASKET_CHANCE,
    LATE_CASKET_LIMIT,
    LATE_CASKET_SECONDS,
    ROUND_DAMAGE,
    ROUND_HP,
    ROUND_XP,
    endlessCoinScale,
    getGearStats,
    roundCrowd,
    roundScale,
} from "../content/endless";
import { getEnemy } from "../content/enemies";
import {
    HARD_BOSS_INTERVAL,
    HARD_COINS,
    HARD_CROWD,
    HARD_ELITES,
    HARD_ENRAGE_AT,
    HARD_XP,
    getHardScale,
} from "../content/hard";
import { CASKETS, getGear, getItem } from "../content/items";
import { getMap, hasPoison } from "../content/maps";
import { canLevelPassive, getPassive, getPassiveGain } from "../content/passives";
import {
    POWER_UPS,
    POWER_UP_CHANCE,
    POWER_UP_LIFETIME,
    POWER_UP_MIN_GAP,
    THRALLS,
    getPowerUp,
} from "../content/powerups";
import {
    OLD_MAN_OFFERS,
    OLD_MAN_PRICE_PER_MINUTE,
    RANDOM_EVENTS,
    RANDOM_EVENT_EVERY,
    RANDOM_EVENT_FIRST,
    VISITOR_DISTANCE,
    VISITOR_LIFETIME,
    VISITOR_REACH,
    VISITOR_SHOUT_EVERY,
    VISITOR_SOUND,
    VISITOR_SPOTANIM,
    getQuizGroups,
} from "../content/randomEvents";
import { RARITIES, RARITY_ORDER } from "../content/rarity";
import { getActiveSets, getSet } from "../content/sets";
import { SOUNDS } from "../content/sounds";
import {
    PUMPKIN_CHANCE,
    PUMPKIN_ID,
    PUMPKIN_MAPS,
    PUMPKIN_MIN_GAP,
    PUMPKIN_OUTCOMES,
} from "../content/trickOrTreat";
import { TROPHIES, TrophyDef } from "../content/trophies";
import {
    BoltProcDef,
    BossAttackDef,
    BossPhasesDef,
    CasketTier,
    CombatStyle,
    EnemyBlinksDef,
    EnemyDef,
    EnemyHealsDef,
    EnemyRevivesDef,
    EnemyShotDef,
    EnemySpawnsDef,
    EnemyTag,
    GearSlot,
    MapDef,
    PlayerEffectDef,
    PowerUpDef,
    PowerUpEffect,
    RandomEventDef,
    RandomEventEffect,
    SpecialAttackDef,
    Stats,
    UtilityDef,
    WeaponDef,
    emptyStats,
} from "../content/types";
import { RUN_LENGTH } from "../content/waves";
import { getWeapon, getWeaponStyle } from "../content/weapons";
import { BulletPool, BulletTarget } from "./BulletPool";
import {
    CASKET_DROP_CHANCE,
    ChestAction,
    ChestOffer,
    InventorySlot,
    MAX_INVENTORY,
    findInventorySlot,
    getAlchValue,
    getStartedSet,
    rollBossCasketTier,
    rollCasketItem,
    rollCasketTier,
} from "./Loot";
import { movePlayer, yawFromVector } from "./PlayerMovement";
import { Rng } from "./Rng";
import { SpatialHash } from "./SpatialHash";
import {
    MAX_PASSIVES,
    MAX_WEAPONS,
    UpgradeChoice,
    getOverlevelDamage,
    hiltChoices,
    rollChoices,
} from "./Upgrades";
import {
    ActivePowerUp,
    BossIntro,
    BossPhase,
    BossQuarters,
    BossSurge,
    BossWalkers,
    BossWindup,
    Buff,
    BulletEmitter,
    DamageSource,
    Death,
    Debuff,
    Effect,
    Enemy,
    EnemyAbilities,
    EnemyLeaving,
    EnemyProjectile,
    EventOffer,
    EventOption,
    FairyRing,
    FallingRock,
    Glyph,
    GroundFire,
    GroundHazard,
    GroundPool,
    PassiveState,
    PendingHit,
    Pickup,
    PickupKind,
    Player,
    PlayerCurse,
    PlayerHold,
    PlayerParasite,
    Projectile,
    ProjectileKind,
    Rampage,
    SimEvent,
    SurgeLane,
    Thrall,
    Turret,
    Visitor,
    WeaponState,
    projectileSource,
    quarterOf,
} from "./entities";
import { fm } from "./fmath";
import { ArenaGrid } from "./world/ArenaGrid";
import { Vec2, findFreeSpot, isCircleFree, moveCircle } from "./world/Collision";
import { FlightGrid } from "./world/FlightGrid";
import { FlowField, canWalkStraight } from "./world/FlowField";
import { endlessLevelForXp, endlessXpForLevel, runLevelForXp, runXpForLevel } from "./xp";

export const TICKS_PER_SECOND = 50;

// How far back the HUD's damage meter looks
export const DPS_WINDOW_SECONDS = 8;
const DPS_WINDOW_TICKS = DPS_WINDOW_SECONDS * TICKS_PER_SECOND;

// OSRS run speed: 2 tiles per 600ms tick
export const PLAYER_SPEED = 2 / 0.6 / TICKS_PER_SECOND;
const PLAYER_RADIUS = 0.35;
const PLAYER_BASE_HP = 25;
// A co-op party's others start this many tiles from the spawn
const PARTY_SPREAD = 1.5;
// Rerolls every run has, before the shop's
const BASE_REROLLS = 1;
// Skipping a level up's rewards costs coins from the run, doubling each time:
// 25, 50, 100, 200, 400, so about five a run
export const SKIP_BASE_COST = 25;
const BASE_MAGNET = 2.2;
// Chance a kill drops food (luck makes it likelier), and what it heals
const FOOD_DROP_CHANCE = 0.003;
const FOOD_HEAL = 10;
// After being hit the player can't be hit again for a moment, so a crowd hurts
// more than one enemy but can't melt them instantly
const HIT_INVULNERABLE_TICKS = 12;
// Seconds until a random event that couldn't happen gets another go
const RANDOM_EVENT_RETRY = 5;
const RANDOM_EVENT_SEED = 0x5eed;

// A rampage: how far from the player it starts, how near the player a crowd
// has to be to go for it, how far past it the charge runs (tiles), and how long
// it takes to fade away
const RAMPAGE_START_DISTANCE = 14;
const RAMPAGE_CROWD_RANGE = 14;
const RAMPAGE_OVERSHOOT = 7;
export const RAMPAGE_FADE_TICKS = 25;
// How far off the ring a Drill Demon's runner heads straight for it
const LAP_PULL_TILES = 3;
// A fairy ring looks for what's walked in this often, and shows the warp on
// only so many at a time
const RING_PULSE_TICKS = 5;
const MAX_RING_EFFECTS = 10;
// How many enemies are looked at for the thickest crowd
const MAX_CROWD_CHECKS = 60;
// Ticks a fallen rock lies there before it's gone
const ROCK_LINGER_TICKS = 2 * TICKS_PER_SECOND;
const SPAWN_MIN_DISTANCE = 19;
const SPAWN_MAX_DISTANCE = 24;
// Bosses turn up a little closer, so the fight starts soon
const BOSS_SPAWN_MIN_DISTANCE = 12;
const BOSS_SPAWN_MAX_DISTANCE = 16;
// A boss in disguise (EnemyDef.disguise): how far from the player it lies, how
// close sets it off, and ticks between it opening and its first attack
const DISGUISE_MIN_DISTANCE = 7;
const DISGUISE_MAX_DISTANCE = 11;
const DISGUISE_TOUCH = 1;
const DISGUISE_ATTACK_DELAY = 100;
// Bosses' pools on the ground at once (the oldest dries up)
const MAX_POOLS = 12;
// Enemies left this far behind are brought back near the player
const RELOCATE_DISTANCE = 34;
const FLOW_FIELD_SIZE = 96;
const FLOW_FIELD_INTERVAL = 8;
// A ditch jump, in ticks from its start: the leap is from JUMP_LEAVE to
// JUMP_LAND, then it gets up (timed to the player's ditch jump, animation 6132)
const JUMP_LEAVE = 25;
const JUMP_LAND = 63;
const JUMP_TICKS = 75;

const ENEMY_ATTACK_COOLDOWN = 50;
const DEATH_SINK_TICKS = 25;
const MAX_DEATH_ANIM_TICKS = 60;
const MAX_PICKUPS = 400;
// Every so often bones lying this close to a bigger pile slide over and join
// it, and coins do the same
const PILE_INTERVAL = 25;
const PILE_RADIUS = 2;
const MAX_ENEMIES = 400;
const MAX_EFFECTS = 160;

// Enemies are kept this many ticks after dying for their death animation
const CORPSE_TICKS = MAX_DEATH_ANIM_TICKS + DEATH_SINK_TICKS;

const ELITE_TINT = 0xffd480;

// Bosses are enraged below this fraction of their hitpoints: they attack this
// much more often, move this much faster and glow red
const ENRAGE_AT = 0.5;
const ENRAGED_INTERVAL = 0.7;
const ENRAGED_SPEED = 1.3;
const ENRAGED_TINT = 0xff7a66;

// A boss's entrance: how fast what's left runs for the edge at most, in tiles a
// second, and how long before the end it's all gone. Further off than that
// speed gets it, it just goes.
const LEAVE_MAX_SPEED = 16;
const LEAVE_MIN_SCALE = 2;
const LEAVE_MARGIN_TICKS = 25;
// Ticks an armed spot takes to go off once it's stepped on
const HAZARD_FUSE_TICKS = 15;
const BULLET_GRACE_TICKS = 50;
// Tiles from the player that what holds them turns up
const SUMMON_BESIDE = 1.8;
// Tiles from a boss that what's walking to it is absorbed
const ABSORB_REACH = 2.6;
// A surge's reach along its lane, either side of the boss's middle
const SURGE_BODY = 2.5;
// What a curse does to the controls: quarter turns, a half turn, and mirrors.
// Each is a whole direction turned, so the stick's angles still work.
const CURSE_SHUFFLES = [
    [0, -1, 1, 0],
    [0, 1, -1, 0],
    [-1, 0, 0, -1],
    [-1, 0, 0, 1],
    [1, 0, 0, -1],
    [0, 1, 1, 0],
] as const;

const CANNON_SPOTANIM = 53;
const LEVEL_UP_SPOTANIM = 199;
// Ice Barrage's freeze, on a player frozen by a boss
export const FREEZE_SPOTANIM = 369;
const ENEMY_PROJECTILE_RADIUS = 0.35;
// Rangers and mages (EnemyDef.shot) stop walking up at this fraction of their
// range
const SHOOTER_KEEP = 0.75;
// Fun maps' chat comes from enemies this many tiles from the player or closer
const CHAT_RANGE = 14;
// Utility blasts show their explosion on this many of the enemies they hit
const MAX_BLAST_EFFECTS = 14;
// Slashes' swooshes cover this much either side of where they aim, radians
const SLASH_ARC = 1.1;
// How wide a slash's strip is, in tiles
const SLASH_WIDTH = 1.5;
// Special attacks' glows stay on the player this long
const SPECIAL_SPOTANIM_TICKS = 60;
// Cannonballs and thralls' projectiles, tiles per second
const CANNONBALL_SPEED = 12;
const THRALL_PROJECTILE_SPEED = 14;
// Thralls keep up with the player, stand this far from them, and are brought
// back when left this far behind
const THRALL_SPEED = PLAYER_SPEED * 1.1;
const THRALL_FOLLOW_DISTANCE = 2;
const THRALL_LEASH = 14;
const THRALL_RADIUS = 0.4;
// The bot nuke shows its explosion on this many of the enemies it kills
const MAX_NUKE_EFFECTS = 24;
// Fire Wave's explosion
export const NUKE_SPOTANIM = 157;
// The Amulet of blood fury: a hit has the healChance stat's chance of healing
// the player this much, with the Sanguinesti staff's glow on them. Only one hit
// in so many ticks gets the roll, hit or miss, or weapons hitting thousands of
// times a minute late in a run would heal all the time.
const BLOOD_FURY_HEAL = 2;
const BLOOD_FURY_ROLL_INTERVAL = TICKS_PER_SECOND;
export const BLOOD_FURY_SPOTANIM = 1542;
// The Twisted bow does half its most extra damage to a target with this many
// hitpoints (a late goblin has a few hundred, a boss thousands)
const TOUGH_TARGET_HP = 600;
// Axes are thrown at enemies this close, and bounce on to ones this close to
// what they hit
const AXE_RANGE = 10;
const BOUNCE_RANGE = 5;
// The Toxic blowpipe prefers enemies without venom this close over nearer
// ones that have it, so the venom spreads
const VENOM_SPREAD_RANGE = 7;

// Enemies of different factions that touch hit each other this many times
// harder than they hit the player (they have far more hitpoints than the
// player does), so a scrap is over in a few hits
const FACTION_DAMAGE = 2;
// Each faction's army marches in from its own side, the sides this far apart
// (the golden angle: well spread however many factions there are), and they
// all turn this many radians a second so no side stays quiet for long
const FACTION_SPREAD = Math.PI * (3 - Math.sqrt(5));
const FACTION_TURN = 0.02;
// An enemy of a faction goes for one of another faction this close (tiles),
// rather than the player, unless the player's closer than this to it; it
// looks round for one every so often
const FOE_RANGE = 8;
const FOE_IGNORE_PLAYER = 2.5;
const FOE_LOOK_TICKS = TICKS_PER_SECOND / 2;
// An enemy with no way to the foe it's after for this long, and no hit landed,
// gives up and goes for the player for good
const FOE_GIVE_UP_TICKS = 3 * TICKS_PER_SECOND;
// Revivers bring back what died lately: the last this many deaths, no older
// than this
const MAX_DEATHS = 48;
const REVIVE_MAX_AGE = 20 * TICKS_PER_SECOND;
// Healers look for something to heal this often, and go this far for it when
// their def doesn't say
const HEAL_RETARGET_TICKS = 25;
const HEAL_SEEK = 12;
// A spawner's calls: no more of its own alive than this, this far from it,
// when its def doesn't say
const SPAWNS_MAX = 8;
const SPAWNS_RADIUS = 2;
// A shielded enemy shows a blocked hit at most this often
const BLOCKED_SPLAT_TICKS = 10;
// Multi-hit slashes (the Dragon claws') land this many ticks apart
const FOLLOW_UP_HIT_TICKS = 4;
// Damage a level (CharacterDef bonus levelMight) grows for this many levels,
// to level 41
export const LEVEL_MIGHT_LEVELS = 40;
// Burning ground hurts what's in it this often, and shows this many flames
// across it
const FIRE_INTERVAL = 25;
const FIRE_FLAMES = 7;
// At most this many patches of burning ground at once; a pulse this close to
// one (a share of its radius) keeps it burning rather than lighting another
const MAX_FIRES = 3;
const FIRE_MERGE = 0.5;
// Split arrows look for enemies this close to where the arrow split
const SPLIT_RANGE = 6;
// A fleeing enemy runs straight away from the player, or failing that (a wall
// in the way, a tile ahead) turned this far either way, a bit more each try
const FLEE_TURNS = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4];
const FLEE_LOOKAHEAD = 1;

// The events that are one hero's own, which co-op tags with who: what they
// did, what happened to them, what they picked up
const PERSONAL_EVENTS = new Set<SimEvent["type"]>([
    "weapon",
    "slash",
    "aura",
    "playerHit",
    "playerPoisoned",
    "pickup",
    "revive",
    "chest",
    "equip",
    "stash",
    "alch",
    "itemUsed",
    "evolved",
    "powerUp",
    "powerUpEnded",
    "playerShout",
    "heroDown",
    "heroLeft",
    "playerCursed",
]);

// levelUp and chest wait for the player to choose
export type SimState = "playing" | "levelUp" | "chest" | "event" | "dead" | "victory";

export type SimOptions = {
    grid: ArenaGrid;
    // Lumbridge when unset
    mapId?: string;
    characterId: string;
    // Permanent bonuses from the shop
    metaStats: Stats;
    seed: number;
    // Where the player starts (the nearest free spot to it)
    spawnX: number;
    spawnY: number;
    // The weapons, passives and items brought in by map tasks; everything can
    // turn up when unset
    unlockedItems?: ReadonlySet<string>;
    // Round after round until the player falls, rather than a win at the
    // final boss (see endless.ts)
    endless?: boolean;
    // Everything on the map tougher, for more coins (see hard.ts)
    hard?: boolean;
    // The pieces upgraded in the Armoury, which caskets give as what they've
    // become (none when unset)
    armoury?: ArmouryUpgrades;
    // Co-op: everyone in the run, in the same order on every player's copy
    // (characterId, metaStats, unlockedItems and armoury are then unused), and
    // which of them this copy plays
    party?: HeroOptions[];
    focus?: number;
};

export type RunResult = {
    mapId: string;
    endless: boolean;
    hard: boolean;
    // The round reached (1 outside endless runs)
    round: number;
    victory: boolean;
    seconds: number;
    level: number;
    kills: number;
    coins: number;
    // Enemy ids of the bosses killed, in order
    bossesKilled: string[];
    // The gear that came out of caskets (as found, before the Armoury's
    // upgrades), for the Armoury
    gearFound: string[];
    // The weapons evolved into, for the Collection log
    evolutionsMade: string[];
    // The trophies found, for the Collection log
    trophies: string[];
    // For quests: enemy id -> times killed, and reward caskets opened
    enemyKills: Record<string, number>;
    caskets: number;
    stats: RunStats;
};

// The stats screen's numbers: damage and kills by what dealt them, most
// damage first (seconds: how long a weapon was had, for its damage a second)
export type RunStats = {
    sources: { source: DamageSource; damage: number; kills: number; seconds?: number }[];
    damageTaken: number;
    healed: number;
    highestHit: number;
    rerollsUsed: number;
    skips: number;
    // The bosses killed, with the run second each went down
    bossKills: { enemyId: string; seconds: number }[];
};

// One adventurer in a run: everything that's theirs rather than the party's.
// A run on your own has one; co-op has one for each player, and the run's
// level, XP, coins and kills are shared.
export type Hero = {
    // Where it is in Sim.heroes
    index: number;
    name: string;
    characterId: string;
    // Permanent bonuses from their shop, their map tasks' items, and their
    // Armoury (see SimOptions)
    metaStats: Stats;
    unlockedItems: ReadonlySet<string> | undefined;
    armoury: ArmouryUpgrades | undefined;
    player: Player;
    stats: Stats;
    weapons: WeaponState[];
    passives: PassiveState[];
    // Item id worn in each slot, and how many times it's upgraded (gear from
    // an endless run's later rounds)
    gear: Partial<Record<GearSlot, string>>;
    // The sets whose bonus the worn gear gives
    activeSets: string[];
    gearUpgrades: Partial<Record<GearSlot, number>>;
    // The weapons evolved into this run
    evolutionsMade: string[];
    // Utility items; slots keep their place (they're used with 1-4)
    inventory: (InventorySlot | null)[];
    buffs: Buff[];
    // Stats lowered by boss attacks
    debuffs: Debuff[];
    // Opened caskets waiting for a decision, the first one on screen
    chests: ChestOffer[];
    pendingLevelUps: number;
    choices: UpgradeChoice[];
    // Gear out of caskets this run, rerolled away or not
    gearFound: Set<string>;
    // Sets caskets have stopped bringing the missing pieces of
    declinedSets: Set<string>;
    // Collection log items found (see trophies.ts)
    trophies: Set<string>;
    revivesLeft: number;
    // For a level up's rewards or a casket's item, shared
    rerollsLeft: number;
    // Rerolls the run started with, for how many were used
    rerollsAtStart: number;
    // Level ups skipped this run, which make the next skip dearer
    skips: number;
    // For the run's stats: damage dealt and kills by what did it (a
    // DamageSource), damage taken, hitpoints healed, the biggest hit, and when
    // each weapon was taken up
    damageBySource: Record<string, number>;
    // The same damage by the tick it was dealt, for dps: a ring of the last
    // DPS_WINDOW_TICKS, each tick taking over the slot of the oldest
    recentDamage: Float64Array;
    killsBySource: Record<string, number>;
    damageTaken: number;
    healed: number;
    highestHit: number;
    weaponSince: Record<string, number>;
    // Bumped whenever their look changes (new weapon tier, gear)
    appearanceVersion: number;
    // Enemies after this hero find their way to them with it
    flowField: FlowField;
    // And flying ones, once there are any
    flightField?: FlowField;
    regenAccumulator: number;
    // When a hit next gets the Amulet of blood fury's roll to heal
    bloodFuryRollTick: number;
    // While the sled lasts: how much faster they go, and until when
    sledEndTick: number;
    sledSpeed: number;
    // What a boss has done to them
    curse?: PlayerCurse;
    parasite?: PlayerParasite;
    hold?: PlayerHold;
    drowsyEndTick: number;
    drowsyInterval: number;
    // Bullets pass through them until this tick, so a mistake costs one of
    // them rather than the whole of a volley
    bulletGraceEnd: number;
    // What they're pressing, for the next tick
    moveX: number;
    moveY: number;
    // Co-op: down with no revives left (out of the run, watching the rest),
    // or gone from the game
    down: boolean;
    left: boolean;
};

// A player in a co-op run, as SimOptions.party has them
export type HeroOptions = {
    name: string;
    characterId: string;
    metaStats: Stats;
    unlockedItems?: ReadonlySet<string>;
    armoury?: ArmouryUpgrades;
};

export class Sim {
    readonly grid: ArenaGrid;
    readonly map: MapDef;
    readonly rng: Rng;
    readonly endless: boolean;
    readonly hard: boolean;

    tick = 0;
    // Tick the run ended, -1 while it's going
    endTick = -1;
    state: SimState = "playing";

    // Everyone in the run, one on your own. The fields below that are a
    // hero's (player, stats, weapons...) are the current hero's: the one the
    // sim is working on at the moment, and between ticks the one this client
    // plays (focus), so the UI reads its own player's.
    readonly heroes: Hero[] = [];
    private hero!: Hero;
    // The hero this client plays
    readonly focus: number;
    // A random event's visitor waiting around, and what one's offering while
    // the run waits
    visitor?: Visitor;
    offer?: EventOffer;

    enemies: Enemy[] = [];
    projectiles: Projectile[] = [];
    enemyProjectiles: EnemyProjectile[] = [];
    pickups: Pickup[] = [];
    effects: Effect[] = [];
    turrets: Turret[] = [];
    thralls: Thrall[] = [];
    // Power-ups that last a while, for their timers
    powerUps: ActivePowerUp[] = [];
    rocks: FallingRock[] = [];
    rampages: Rampage[] = [];
    rings: FairyRing[] = [];
    // Bosses' glyphs (BossDef.glyph)
    glyphs: Glyph[] = [];
    // A boss's bullets, what fired each (BulletPool.source), and the volleys to
    // come
    readonly bullets = new BulletPool();
    readonly bulletSources: { attack: BossAttackDef; enemy: Enemy }[] = [];
    private emitters: BulletEmitter[] = [];
    // Where each hero is for the bullets, kept from tick to tick
    private readonly bulletTargets: BulletTarget[] = [];
    // What a boss has marked on the ground, and its corpse flowers
    hazards: GroundHazard[] = [];
    quarters?: BossQuarters;
    // A boss's entrance under way, and a boss it's just the player and
    // (BossIntroDef.alone), for as long as it's up
    intro?: BossIntro;
    private aloneWith?: Enemy;
    // Burning ground left by weapons
    fires: GroundFire[] = [];
    // Pools left by bosses' attacks
    pools: GroundPool[] = [];
    // Hits still to land, a moment after their swing
    private pendingHits: PendingHit[] = [];
    // Enemies that died lately, for revivers (oldest first)
    private deaths: Death[] = [];

    xp = 0;
    level = 1;
    kills = 0;
    // Enemy id -> times killed (a boss that rose again as its second form's)
    enemyKills: Record<string, number> = {};
    bossesKilled: string[] = [];
    // When the next trick or treat pumpkin can drop
    private nextPumpkinTick = 0;
    coins = 0;
    casketsOpened = 0;
    readonly bossKills: { enemyId: string; seconds: number }[] = [];
    // What's dealing damage now, for damageBySource: set before each source
    // gets its turn
    private damageSource: DamageSource = "other";
    // The final boss is up
    bossSpawned = false;
    // Endless runs' round, and the tick it started; killing the final boss
    // starts the next
    round = 1;
    roundStartTick = 0;

    events: SimEvent[] = [];

    // Co-op's bigger, tougher crowds (content/coop.ts), all 1 on your own
    private partyScale: PartyScale;
    // What hard mode multiplies enemies' hitpoints and damage by (1 outside it)
    private readonly hardScale: { hp: number; damage: number };
    // What each bone's worth for the party: its scale's experience, made up
    // for when the crowd's cap leaves no room for all of the party's extra
    private partyXp = 1;
    // What keeps flying enemies out, worked out when the first turns up, as
    // most maps have none. Each hero has their own way round it.
    private flightGrid: FlightGrid | undefined;
    // Enemy id -> the tick the next of its kind can go (EnemyBlinksDef.gap)
    private readonly blinkGapEnd = new Map<string, number>();
    private readonly enemyHash = new SpatialHash<Enemy>(2);
    private readonly pileHash = new SpatialHash<Pickup>(PILE_RADIUS);
    private nextUid = 1;
    private spawnAccumulator = 0;
    private eventIndex = 0;
    // When the last power-up dropped; the longer ago, the likelier the next
    private lastPowerUpTick = 0;
    // What dropped last, which doesn't drop twice in a row
    private lastPowerUpId?: string;
    // Random events roll on their own, so a run only goes differently for
    // what they do and not for them being there
    readonly eventRng: Rng;
    // Run second the next random event is due, and the last one (not twice running)
    private nextRandomEventSeconds: number;
    private lastRandomEventId?: string;
    // Enemies (other than bosses) stand still until then, new ones too
    private freezeEndTick = 0;
    // While a Drill Demon lasts
    private lapsEndTick = 0;
    private laps?: Extract<PowerUpEffect, { kind: "laps" }>;
    // Fun maps: run second the next random boss is due, the last one picked
    // (not picked twice running), and when the next chat lines are due
    private nextFunBossSeconds = Infinity;
    private lastFunBoss?: string;
    // A pool that turns up together (FunMapDef.bosses.together): the ones out
    // now, until the last of them is killed
    private funBossGroup: Enemy[] = [];
    private nextChatTick = 0;
    private nextPlayerChatSeconds = Infinity;
    // The factions seen so far, in order, and where the first one comes from
    // (see factionAngle)
    private readonly factions: string[] = [];
    private factionBaseAngle?: number;
    private readonly temp = { x: 0, y: 0 };

    // ---- The current hero's ----

    get characterId(): string {
        return this.hero.characterId;
    }
    get metaStats(): Stats {
        return this.hero.metaStats;
    }
    get unlockedItems(): ReadonlySet<string> | undefined {
        return this.hero.unlockedItems;
    }
    private get armoury(): ArmouryUpgrades | undefined {
        return this.hero.armoury;
    }
    get player(): Player {
        return this.hero.player;
    }
    get stats(): Stats {
        return this.hero.stats;
    }
    set stats(stats: Stats) {
        this.hero.stats = stats;
    }
    get weapons(): WeaponState[] {
        return this.hero.weapons;
    }
    set weapons(weapons: WeaponState[]) {
        this.hero.weapons = weapons;
    }
    get passives(): PassiveState[] {
        return this.hero.passives;
    }
    set passives(passives: PassiveState[]) {
        this.hero.passives = passives;
    }
    get gear(): Partial<Record<GearSlot, string>> {
        return this.hero.gear;
    }
    set gear(gear: Partial<Record<GearSlot, string>>) {
        this.hero.gear = gear;
    }
    get activeSets(): string[] {
        return this.hero.activeSets;
    }
    set activeSets(sets: string[]) {
        this.hero.activeSets = sets;
    }
    get gearUpgrades(): Partial<Record<GearSlot, number>> {
        return this.hero.gearUpgrades;
    }
    set gearUpgrades(upgrades: Partial<Record<GearSlot, number>>) {
        this.hero.gearUpgrades = upgrades;
    }
    get evolutionsMade(): string[] {
        return this.hero.evolutionsMade;
    }
    get inventory(): (InventorySlot | null)[] {
        return this.hero.inventory;
    }
    set inventory(inventory: (InventorySlot | null)[]) {
        this.hero.inventory = inventory;
    }
    get buffs(): Buff[] {
        return this.hero.buffs;
    }
    set buffs(buffs: Buff[]) {
        this.hero.buffs = buffs;
    }
    get debuffs(): Debuff[] {
        return this.hero.debuffs;
    }
    set debuffs(debuffs: Debuff[]) {
        this.hero.debuffs = debuffs;
    }
    get chests(): ChestOffer[] {
        return this.hero.chests;
    }
    get pendingLevelUps(): number {
        return this.hero.pendingLevelUps;
    }
    set pendingLevelUps(count: number) {
        this.hero.pendingLevelUps = count;
    }
    get choices(): UpgradeChoice[] {
        return this.hero.choices;
    }
    set choices(choices: UpgradeChoice[]) {
        this.hero.choices = choices;
    }
    get gearFound(): Set<string> {
        return this.hero.gearFound;
    }
    get declinedSets(): Set<string> {
        return this.hero.declinedSets;
    }
    get trophies(): Set<string> {
        return this.hero.trophies;
    }
    get revivesLeft(): number {
        return this.hero.revivesLeft;
    }
    set revivesLeft(count: number) {
        this.hero.revivesLeft = count;
    }
    get rerollsLeft(): number {
        return this.hero.rerollsLeft;
    }
    set rerollsLeft(count: number) {
        this.hero.rerollsLeft = count;
    }
    get skips(): number {
        return this.hero.skips;
    }
    set skips(count: number) {
        this.hero.skips = count;
    }
    get damageBySource(): Record<string, number> {
        return this.hero.damageBySource;
    }
    get killsBySource(): Record<string, number> {
        return this.hero.killsBySource;
    }
    get damageTaken(): number {
        return this.hero.damageTaken;
    }
    set damageTaken(amount: number) {
        this.hero.damageTaken = amount;
    }
    get healed(): number {
        return this.hero.healed;
    }
    set healed(amount: number) {
        this.hero.healed = amount;
    }
    get highestHit(): number {
        return this.hero.highestHit;
    }
    set highestHit(amount: number) {
        this.hero.highestHit = amount;
    }
    get weaponSince(): Record<string, number> {
        return this.hero.weaponSince;
    }
    get appearanceVersion(): number {
        return this.hero.appearanceVersion;
    }
    set appearanceVersion(version: number) {
        this.hero.appearanceVersion = version;
    }
    get flowField(): FlowField {
        return this.hero.flowField;
    }
    private get regenAccumulator(): number {
        return this.hero.regenAccumulator;
    }
    private set regenAccumulator(amount: number) {
        this.hero.regenAccumulator = amount;
    }
    private get bloodFuryRollTick(): number {
        return this.hero.bloodFuryRollTick;
    }
    private set bloodFuryRollTick(tick: number) {
        this.hero.bloodFuryRollTick = tick;
    }
    private get sledEndTick(): number {
        return this.hero.sledEndTick;
    }
    private set sledEndTick(tick: number) {
        this.hero.sledEndTick = tick;
    }
    private get sledSpeed(): number {
        return this.hero.sledSpeed;
    }
    private set sledSpeed(speed: number) {
        this.hero.sledSpeed = speed;
    }
    get curse(): PlayerCurse | undefined {
        return this.hero.curse;
    }
    set curse(curse: PlayerCurse | undefined) {
        this.hero.curse = curse;
    }
    get parasite(): PlayerParasite | undefined {
        return this.hero.parasite;
    }
    set parasite(parasite: PlayerParasite | undefined) {
        this.hero.parasite = parasite;
    }
    get hold(): PlayerHold | undefined {
        return this.hero.hold;
    }
    set hold(hold: PlayerHold | undefined) {
        this.hero.hold = hold;
    }
    private get drowsyEndTick(): number {
        return this.hero.drowsyEndTick;
    }
    private set drowsyEndTick(tick: number) {
        this.hero.drowsyEndTick = tick;
    }
    private get drowsyInterval(): number {
        return this.hero.drowsyInterval;
    }
    private set drowsyInterval(interval: number) {
        this.hero.drowsyInterval = interval;
    }
    private get bulletGraceEnd(): number {
        return this.hero.bulletGraceEnd;
    }
    private set bulletGraceEnd(tick: number) {
        this.hero.bulletGraceEnd = tick;
    }

    constructor(options: SimOptions) {
        this.grid = options.grid;
        this.map = getMap(options.mapId ?? "lumbridge");
        this.rng = new Rng(options.seed);
        // Fun maps are endless from the start
        this.endless = (options.endless ?? false) || this.map.fun !== undefined;
        this.hard = options.hard ?? false;
        this.hardScale = this.hard ? getHardScale(this.map) : { hp: 1, damage: 1 };
        const party: HeroOptions[] = options.party ?? [
            {
                name: "",
                characterId: options.characterId,
                metaStats: options.metaStats,
                unlockedItems: options.unlockedItems,
                armoury: options.armoury,
            },
        ];
        this.partyScale = getPartyScale(party.length);
        this.partyXp = this.partyScale.xp;
        this.focus = Math.min(options.focus ?? 0, party.length - 1);
        this.eventRng = new Rng(options.seed ^ RANDOM_EVENT_SEED);
        this.nextRandomEventSeconds = this.eventRng.range(...RANDOM_EVENT_FIRST);
        const fun = this.map.fun;
        if (fun) {
            this.nextFunBossSeconds = fun.bosses.firstAt;
            if (fun.playerChat) {
                this.nextPlayerChatSeconds = this.rng.range(...fun.playerChat.every);
            }
        }
        party.forEach((hero, index) => {
            this.heroes.push(this.createHero(hero, index, options.spawnX, options.spawnY));
        });
        for (const hero of this.heroes) {
            this.use(hero);
            this.addWeapon(getCharacter(hero.characterId).startingWeapon);
            this.updateStats();
            hero.player.hp = hero.player.maxHp;
            hero.revivesLeft = hero.stats.revival;
            hero.rerollsLeft = BASE_REROLLS + hero.stats.reroll;
            hero.rerollsAtStart = hero.rerollsLeft;
            this.updateFlowField();
        }
        this.use(this.heroes[this.focus]);
    }

    // A hero at the spawn, or for a party's others, around it
    private createHero(options: HeroOptions, index: number, spawnX: number, spawnY: number): Hero {
        const angle = (index / 4) * Math.PI * 2;
        const offset = index === 0 ? 0 : PARTY_SPREAD;
        const start = findFreeSpot(
            this.grid,
            spawnX + fm.cos(angle) * offset,
            spawnY + fm.sin(angle) * offset,
            PLAYER_RADIUS,
        );
        const flowField = new FlowField(FLOW_FIELD_SIZE);
        flowField.ditchY = this.map.ditch?.y;
        return {
            index,
            name: options.name,
            characterId: options.characterId,
            metaStats: options.metaStats,
            unlockedItems: options.unlockedItems,
            armoury: options.armoury,
            player: {
                x: start.x,
                y: start.y,
                prevX: start.x,
                prevY: start.y,
                radius: PLAYER_RADIUS,
                facingX: 0,
                facingY: -1,
                yaw: 0,
                moving: false,
                hp: PLAYER_BASE_HP,
                maxHp: PLAYER_BASE_HP,
                attackSeq: -1,
                attackStart: 0,
                deathTick: -1,
                moveStart: 0,
                invulnerable: 0,
                flash: 0,
                frozen: 0,
                poisonDamage: 0,
                poisonEnd: -1,
            },
            stats: emptyStats(),
            weapons: [],
            passives: [],
            gear: {},
            activeSets: [],
            gearUpgrades: {},
            evolutionsMade: [],
            inventory: new Array(MAX_INVENTORY).fill(null),
            buffs: [],
            debuffs: [],
            chests: [],
            pendingLevelUps: 0,
            choices: [],
            gearFound: new Set(),
            declinedSets: new Set(),
            trophies: new Set(),
            revivesLeft: 0,
            rerollsLeft: 0,
            rerollsAtStart: 0,
            skips: 0,
            damageBySource: {},
            recentDamage: new Float64Array(DPS_WINDOW_TICKS),
            killsBySource: {},
            damageTaken: 0,
            healed: 0,
            highestHit: 0,
            weaponSince: {},
            appearanceVersion: 0,
            flowField,
            regenAccumulator: 0,
            bloodFuryRollTick: 0,
            sledEndTick: 0,
            sledSpeed: 1,
            drowsyEndTick: 0,
            drowsyInterval: 1,
            bulletGraceEnd: 0,
            moveX: 0,
            moveY: 0,
            down: false,
            left: false,
        };
    }

    // Makes this the current hero (see heroes)
    private use(hero: Hero): void {
        this.hero = hero;
    }

    // Does something as one of the party (a co-op player's choice, as it came
    // in over the network), then goes back to the focus
    as<T>(heroIndex: number, action: () => T): T {
        const hero = this.heroes[heroIndex];
        if (!hero) {
            return action();
        }
        this.use(hero);
        try {
            return action();
        } finally {
            this.use(this.heroes[this.focus]);
        }
    }

    // Whether a hero is still in the fight: not down, and still in the game
    isUp(hero: Hero): boolean {
        return !hero.down && !hero.left;
    }

    // The hero nearest a spot that's still in the fight, for enemies to go
    // after and pickups to fly to (the current one if nobody is)
    private nearestHero(x: number, y: number): Hero {
        if (this.heroes.length === 1) {
            return this.heroes[0];
        }
        let nearest: Hero | undefined;
        let best = Infinity;
        for (const hero of this.heroes) {
            if (!this.isUp(hero)) {
                continue;
            }
            const dx = hero.player.x - x;
            const dy = hero.player.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq < best) {
                best = distSq;
                nearest = hero;
            }
        }
        return nearest ?? this.hero;
    }

    // Picks one of the heroes still in the fight for a crowd to turn up
    // around, each as likely (the only one, on your own)
    private useSpawnHero(): void {
        if (this.heroes.length === 1) {
            return;
        }
        const up = this.heroes.filter((hero) => this.isUp(hero));
        if (up.length > 0) {
            this.use(up[this.rng.int(up.length)]);
        }
    }

    // Makes the hero something belongs to the current one (what a projectile,
    // thrall or venom does is theirs: their stats, their run's numbers)
    private useHeroAt(index: number | undefined): void {
        const hero = index !== undefined ? this.heroes[index] : undefined;
        if (hero) {
            this.use(hero);
        }
    }

    // Does something as each hero an attack could land on (the one, on your
    // own), then goes back to the hero it was working on
    private forEachHeroInReach(action: () => void): void {
        const current = this.hero;
        for (const hero of this.heroes) {
            if (this.heroes.length > 1 && !this.isUp(hero)) {
                continue;
            }
            this.use(hero);
            action();
        }
        this.use(current);
    }

    // Co-op tags the events that are a hero's own with who (SimEvent.hero)
    private emit(event: SimEvent, personal = PERSONAL_EVENTS.has(event.type)): void {
        if (personal && this.heroes.length > 1) {
            event.hero = this.hero.index;
        }
        this.events.push(event);
    }

    // Enemies find their way to the player's tile, or when they're standing on
    // part of an object's (beside a signpost's post), the nearest open one
    private updateFlowField(): void {
        const player = this.player;
        let tileX = Math.floor(player.x);
        let tileY = Math.floor(player.y);
        if (this.grid.isSolid(tileX, tileY)) {
            let best = Infinity;
            const fromX = tileX;
            const fromY = tileY;
            for (let d = 1; d <= 3 && best === Infinity; d++) {
                for (let y = fromY - d; y <= fromY + d; y++) {
                    for (let x = fromX - d; x <= fromX + d; x++) {
                        if (
                            Math.max(Math.abs(x - fromX), Math.abs(y - fromY)) !== d ||
                            this.grid.isSolid(x, y)
                        ) {
                            continue;
                        }
                        const distance = fm.hypot(x + 0.5 - player.x, y + 0.5 - player.y);
                        if (distance < best) {
                            best = distance;
                            tileX = x;
                            tileY = y;
                        }
                    }
                }
            }
        }
        if (tileX !== this.flowField.targetX || tileY !== this.flowField.targetY) {
            this.flowField.update(this.grid, tileX, tileY);
            if (this.flightGrid) {
                this.hero.flightField?.update(this.flightGrid, tileX, tileY);
            }
        }
    }

    // What keeps flying enemies out, and the current hero's way round it
    private getFlight(): { grid: FlightGrid; field: FlowField } {
        const grid = (this.flightGrid ??= new FlightGrid(this.grid));
        if (!this.hero.flightField) {
            const field = new FlowField(FLOW_FIELD_SIZE);
            field.update(grid, this.flowField.targetX, this.flowField.targetY);
            this.hero.flightField = field;
        }
        return { grid, field: this.hero.flightField };
    }

    private getMoveGrid(def: EnemyDef): ArenaGrid | FlightGrid {
        return def.flies ? (this.flightGrid ??= new FlightGrid(this.grid)) : this.grid;
    }

    // Run time; stops when the run ends, though ticks carry on for animations
    get seconds(): number {
        return (this.endTick >= 0 ? this.endTick : this.tick) / TICKS_PER_SECOND;
    }

    // Where the run is in the map's waves and events: the whole run outside
    // endless runs, and an endless run's later rounds start some way in
    get mapSeconds(): number {
        const start = this.round > 1 ? LATER_ROUND_START : 0;
        return start + this.seconds - this.roundStartTick / TICKS_PER_SECOND;
    }

    get xpForNextLevel(): number {
        return this.xpForLevel(this.level + 1);
    }

    get xpForThisLevel(): number {
        return this.xpForLevel(this.level);
    }

    private xpForLevel(level: number): number {
        return this.endless ? endlessXpForLevel(level) : runXpForLevel(level);
    }

    getResult(): RunResult {
        return {
            mapId: this.map.id,
            endless: this.endless,
            hard: this.hard,
            round: this.round,
            victory: this.state === "victory",
            seconds: this.seconds,
            level: this.level,
            kills: this.kills,
            coins: this.coins,
            bossesKilled: [...this.bossesKilled],
            gearFound: [...this.gearFound],
            evolutionsMade: [...this.evolutionsMade],
            trophies: [...this.trophies],
            enemyKills: { ...this.enemyKills },
            caskets: this.casketsOpened,
            stats: this.getRunStats(),
        };
    }

    // The player's damage a second just now, from every source
    get dps(): number {
        let damage = 0;
        for (const dealt of this.hero.recentDamage) {
            damage += dealt;
        }
        return damage / DPS_WINDOW_SECONDS;
    }

    getRunStats(): RunStats {
        // Every weapon that was had, even one that never landed a hit
        const sources = new Set([
            ...Object.keys(this.damageBySource),
            ...Object.keys(this.killsBySource),
            ...Object.keys(this.weaponSince).map((id) => `weapon:${id}`),
        ]) as Set<DamageSource>;
        const end = this.endTick >= 0 ? this.endTick : this.tick;
        return {
            sources: [...sources]
                .map((source) => {
                    const since = source.startsWith("weapon:")
                        ? this.weaponSince[source.slice("weapon:".length)]
                        : undefined;
                    return {
                        source,
                        damage: this.damageBySource[source] ?? 0,
                        kills: this.killsBySource[source] ?? 0,
                        ...(since !== undefined && {
                            seconds: (end - since) / TICKS_PER_SECOND,
                        }),
                    };
                })
                .sort((a, b) => b.damage - a.damage || b.kills - a.kills),
            damageTaken: this.damageTaken,
            healed: this.healed,
            highestHit: this.highestHit,
            rerollsUsed: Math.max(0, this.hero.rerollsAtStart - this.rerollsLeft),
            skips: this.skips,
            bossKills: [...this.bossKills],
        };
    }

    // ---- Stats and upgrades ----

    updateStats(): void {
        const stats = emptyStats();
        addStats(stats, getCharacter(this.characterId).bonus);
        addStats(stats, this.metaStats);
        for (const passive of this.passives) {
            const def = getPassive(passive.id);
            for (const stat of [def.stat, ...(def.alsoAdds ?? [])]) {
                stats[stat] += passive.value;
            }
        }
        for (const [slot, itemId] of Object.entries(this.gear)) {
            const upgrades = this.gearUpgrades[slot as GearSlot] ?? 0;
            addStats(stats, getGearStats(getGear(itemId), upgrades));
        }
        const sets = getActiveSets(this.gear);
        for (const set of sets) {
            addStats(stats, set.stats ?? {});
            if (!this.activeSets.includes(set.id)) {
                this.emit(
                    {
                        type: "notice",
                        message: `${set.name} set bonus: ${set.bonus}!`,
                    },
                    true,
                );
            }
        }
        this.activeSets = sets.map((set) => set.id);
        for (const buff of this.buffs) {
            addStats(stats, buff.stats);
        }
        for (const debuff of this.debuffs) {
            addStats(stats, debuff.stats);
        }
        // Grows with every level gained (the Gauntlet runner starts weak), up
        // to about where a normal run ends, so it doesn't run away in endless
        stats.might += stats.levelMight * Math.min(this.level - 1, LEVEL_MIGHT_LEVELS);
        this.stats = stats;
        const player = this.player;
        const maxHp = Math.round(PLAYER_BASE_HP * (1 + stats.maxHp));
        if (maxHp !== player.maxHp) {
            // Swapping off max hitpoints never kills
            player.hp = Math.max(Math.min(player.hp, 1), player.hp + maxHp - player.maxHp);
            player.maxHp = maxHp;
        }
    }

    // Weapons and passives carried at once, with the shop's extra slots
    get maxWeapons(): number {
        return MAX_WEAPONS + this.metaStats.weaponSlots;
    }

    get maxPassives(): number {
        return MAX_PASSIVES + this.metaStats.passiveSlots;
    }

    addWeapon(weaponId: string, bonus = 0): void {
        if (this.weapons.length >= this.maxWeapons) {
            return;
        }
        this.weapons.push({
            def: getWeapon(weaponId),
            level: 1,
            cooldown: TICKS_PER_SECOND,
            bonus,
            uses: 0,
        });
        this.weaponSince[weaponId] ??= this.tick;
        this.appearanceVersion++;
    }

    choose(index: number): void {
        if (!this.isChoosing(this.hero)) {
            return;
        }
        const choice = this.choices[index];
        if (choice) {
            this.apply(choice);
        }
        // A godsword's blade or an Ancient burst that just reached its pick
        // level: picking is the rest of this level up
        const weapon =
            choice?.kind === "weaponLevel"
                ? this.weapons.find((w) => w.def.id === choice.weaponId)
                : undefined;
        const hilts = weapon ? hiltChoices(weapon, this.unlockedItems) : [];
        if (hilts.length > 0) {
            this.choices = hilts;
            return;
        }
        this.nextLevelUp();
    }

    // On to the next level up's rewards, or back to the run
    private nextLevelUp(): void {
        this.pendingLevelUps--;
        this.choices = [];
        if (this.pendingLevelUps > 0) {
            this.choices = this.roll();
        } else {
            this.settle();
        }
    }

    // Whether a hero (the current one by default) has a level up's rewards to
    // choose now. Co-op's downed heroes are out of the run, so the run doesn't
    // wait on them.
    isChoosing(hero: Hero = this.hero): boolean {
        return this.state === "levelUp" && hero.pendingLevelUps > 0 && this.isUp(hero);
    }

    // Anyone up with a level up to choose
    private anyoneToChoose(): boolean {
        return this.heroes.some((hero) => hero.pendingLevelUps > 0 && this.isUp(hero));
    }

    // What the run waits on now: anyone's level up, then anyone's casket, or
    // nothing (co-op waits for everyone)
    private settle(): void {
        if (this.offer) {
            this.state = "event";
        } else if (this.anyoneToChoose()) {
            this.state = "levelUp";
        } else if (this.heroes.some((hero) => hero.chests.length > 0)) {
            this.state = "chest";
        } else {
            this.state = "playing";
        }
    }

    // Co-op: the heroes the run is waiting on to choose a level up's rewards
    // or decide on a casket
    get waitingOn(): Hero[] {
        if (this.state === "levelUp") {
            return this.heroes.filter((hero) => this.isChoosing(hero));
        }
        if (this.state === "chest") {
            return this.heroes.filter((hero) => hero.chests.length > 0);
        }
        if (this.state === "event" && this.offer) {
            return [this.heroes[this.offer.hero]];
        }
        return [];
    }

    // What skipping the level up's rewards costs now (coins are worth less in
    // endless runs, so skips cost less too)
    get skipCost(): number {
        return Math.round(SKIP_BASE_COST * 2 ** this.skips * this.coinScale);
    }

    // A level up's rewards can be skipped for coins, but not a godsword's
    // hilt, or the coins and shark offered when there's nothing else
    get canSkip(): boolean {
        return (
            this.state === "levelUp" &&
            !this.choosingHilt &&
            this.choices.some((c) => c.kind !== "coins" && c.kind !== "food")
        );
    }

    // Takes none of the level up's rewards, for skipCost coins. False when it
    // can't be skipped or there aren't the coins.
    skip(): boolean {
        if (!this.canSkip || this.coins < this.skipCost) {
            return false;
        }
        this.coins -= this.skipCost;
        this.skips++;
        this.nextLevelUp();
        return true;
    }

    private roll(): UpgradeChoice[] {
        return rollChoices(
            this.rng,
            this.weapons,
            this.passives,
            this.stats.luck,
            getCharacter(this.characterId).style,
            this.unlockedItems,
            this.endless,
            this.maxWeapons,
            this.maxPassives,
        );
    }

    // Picking a godsword's hilt, which can't be rerolled
    get choosingHilt(): boolean {
        return this.choices.some((c) => c.kind === "hilt");
    }

    // Rolls what's on offer again, for one of the run's rerolls: the level
    // up's rewards, or the open casket's item (another one, its rarity rolled
    // again too). False when there's no reroll left or nothing on offer.
    reroll(): boolean {
        const chest = this.chest;
        if (this.rerollsLeft <= 0 || this.choosingHilt) {
            return false;
        }
        if (this.state === "levelUp" && this.pendingLevelUps > 0) {
            this.choices = this.roll();
        } else if (this.state === "chest" && chest) {
            this.declineSetPiece(chest.itemId);
            const { itemId, upgradedFrom } = this.rollChestItem(chest.tier, chest.itemId);
            chest.itemId = itemId;
            chest.upgradedFrom = upgradedFrom;
            chest.upgrades = this.offeredUpgrades(itemId);
        } else {
            return false;
        }
        this.rerollsLeft--;
        return true;
    }

    apply(choice: UpgradeChoice): void {
        switch (choice.kind) {
            case "newWeapon":
                this.addWeapon(choice.weaponId, RARITIES[choice.quality].weaponBonus);
                break;
            case "weaponLevel": {
                const weapon = this.weapons.find((w) => w.def.id === choice.weaponId);
                if (weapon) {
                    const last = weapon.def.levels.length;
                    // Endless runs level on past the last level, for damage
                    weapon.level = this.endless ? choice.level : Math.min(choice.level, last);
                    if (choice.level > last) {
                        // Multiplies everything the weapon had
                        const more = getOverlevelDamage(choice.quality);
                        weapon.bonus = (1 + weapon.bonus) * (1 + more) - 1;
                    } else {
                        weapon.bonus += RARITIES[choice.quality].weaponBonus;
                    }
                    this.appearanceVersion++;
                }
                break;
            }
            case "evolve": {
                const index = this.weapons.findIndex((w) => w.def.id === choice.weaponId);
                if (index !== -1) {
                    // Bonus damage from rare rolls carries over
                    this.weaponSince[choice.into] ??= this.tick;
                    if (!this.evolutionsMade.includes(choice.into)) {
                        this.evolutionsMade.push(choice.into);
                    }
                    this.emit({ type: "evolved", weaponId: choice.into });
                    this.emit(
                        {
                            type: "notice",
                            message: `Evolved: ${getWeapon(choice.into).name}!`,
                        },
                        true,
                    );
                    this.weapons[index] = {
                        def: getWeapon(choice.into),
                        level: 1,
                        cooldown: 0,
                        bonus: this.weapons[index].bonus,
                        uses: 0,
                    };
                    this.appearanceVersion++;
                }
                break;
            }
            case "hilt": {
                // Everything carries over: level, bonus damage and the count
                // towards the special attack
                const weapon = this.weapons.find((w) => w.def.id === choice.weaponId);
                if (weapon) {
                    weapon.def = getWeapon(choice.into);
                    this.weaponSince[choice.into] ??= this.tick;
                    this.appearanceVersion++;
                }
                break;
            }
            case "newPassive": {
                const def = getPassive(choice.passiveId);
                if (this.passives.length < this.maxPassives) {
                    this.passives.push({
                        id: choice.passiveId,
                        level: 1,
                        value: getPassiveGain(def, choice.quality),
                    });
                }
                this.updateStats();
                this.appearanceVersion++;
                break;
            }
            case "passiveLevel": {
                const passive = this.passives.find((p) => p.id === choice.passiveId);
                if (passive) {
                    const def = getPassive(passive.id);
                    if (canLevelPassive(def, passive.level, this.endless)) {
                        passive.level++;
                        passive.value += getPassiveGain(def, choice.quality);
                    }
                }
                this.updateStats();
                this.appearanceVersion++;
                break;
            }
            case "coins":
                this.coins += choice.amount;
                break;
            case "food":
                this.heal(choice.amount);
                break;
        }
    }

    heal(amount: number): void {
        const hp = this.player.hp;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
        this.healed += Math.max(0, this.player.hp - hp);
    }

    // ---- Caskets and items ----

    get chest(): ChestOffer | undefined {
        return this.chests[0];
    }

    // Whether a utility item would fit in the inventory
    canStash(itemId: string): boolean {
        return findInventorySlot(this.inventory, itemId) !== -1;
    }

    // Does what the player chose with the open casket's item, then carries on
    // (or opens the next casket, or a level up that came in meanwhile)
    resolveChest(action: ChestAction): void {
        if (this.state !== "chest") {
            return;
        }
        const chest = this.chests.shift();
        if (chest) {
            this.applyChest(chest, action);
        }
        // A blast from the casket can end the run (it can hit the boss)
        if (this.runOver || this.heroes.some((hero) => hero.chests.length > 0)) {
            return;
        }
        this.state = "playing";
        this.checkLevelUp();
    }

    private applyChest(chest: ChestOffer, action: ChestAction): void {
        const item = getItem(chest.itemId);
        if (action === "alch") {
            this.declineSetPiece(item.id);
            const coins = this.alchValue(item.id, chest.upgrades);
            this.coins += coins;
            this.emit({ type: "alch", itemId: item.id, coins });
            return;
        }
        if (item.kind === "gear") {
            this.equip(item.id, chest.upgrades);
            return;
        }
        if (action === "take" && this.stash(item.id)) {
            return;
        }
        this.useUtility(item);
    }

    // A piece of a set the player has started, turned down: caskets stop
    // bringing that set's pieces for the rest of the run
    private declineSetPiece(itemId: string): void {
        const set = getStartedSet(this.gear, getItem(itemId));
        if (set) {
            this.declinedSets.add(set.id);
        }
    }

    // Wears a piece of gear (upgraded this many times); whatever was in its
    // slot is alched
    equip(itemId: string, upgrades = 0): void {
        const item = getGear(itemId);
        const replacedId = this.gear[item.slot];
        const replacedUpgrades = this.gearUpgrades[item.slot] ?? 0;
        const coins = replacedId ? this.alchValue(replacedId, replacedUpgrades) : 0;
        this.coins += coins;
        this.gear[item.slot] = item.id;
        this.gearUpgrades[item.slot] = upgrades;
        this.updateStats();
        this.appearanceVersion++;
        this.emit({ type: "equip", itemId, replacedId, coins });
    }

    // Puts a utility item in the inventory; false when there's no room
    stash(itemId: string): boolean {
        const index = findInventorySlot(this.inventory, itemId);
        if (index === -1) {
            return false;
        }
        const slot = this.inventory[index];
        if (slot) {
            slot.count++;
        } else {
            this.inventory[index] = { itemId, count: 1 };
        }
        this.emit({ type: "stash", itemId });
        return true;
    }

    // Uses the utility item in an inventory slot (0-3) while playing
    useItem(index: number): boolean {
        const slot = this.inventory[index];
        if (this.state !== "playing" || !slot || !this.isUp(this.hero)) {
            return false;
        }
        const item = getItem(slot.itemId);
        if (item.kind !== "utility") {
            return false;
        }
        slot.count--;
        if (slot.count <= 0) {
            this.inventory[index] = null;
        }
        this.useUtility(item);
        this.checkLevelUp();
        return true;
    }

    private useUtility(item: UtilityDef): void {
        const player = this.player;
        const use = item.use;
        this.emit({ type: "itemUsed", itemId: item.id, x: player.x, y: player.y });
        this.damageSource = `item:${item.id}`;
        switch (use.kind) {
            case "heal":
                this.heal(use.amount * this.healScale);
                if (use.stats && use.seconds) {
                    this.addBuff(item.id, use.stats, use.seconds, false);
                }
                break;
            case "buff":
                this.addBuff(item.id, use.stats, use.seconds, false);
                break;
            case "cure":
                this.player.poisonEnd = -1;
                this.player.poisonDamage = 0;
                this.debuffs = [];
                this.addBuff(item.id, {}, use.seconds, true);
                this.heal((use.heal ?? 0) * this.healScale);
                break;
            case "bones":
                for (const pickup of this.pickups) {
                    if (pickup.kind === "bones") {
                        pickup.attracted = true;
                        pickup.speed = Math.max(pickup.speed, 0.15);
                    }
                }
                break;
            case "blast": {
                const radius = use.radius * (1 + this.stats.area);
                this.emit({ type: "blast", x: player.x, y: player.y, radius });
                // Not the spatial hash: this can run between ticks, when it's stale
                const hit = this.enemies.filter(
                    (e) => !e.dead && fm.hypot(e.x - player.x, e.y - player.y) <= radius + e.radius,
                );
                hit.forEach((enemy, i) => {
                    if (i < MAX_BLAST_EFFECTS) {
                        this.addEffect(use.spotAnim, enemy.x, enemy.y, 0, 30, enemy.uid);
                    }
                    this.damageEnemy(enemy, use.damage * this.roundHp, 2.5, player.x, player.y);
                });
                break;
            }
            case "xp":
                this.xp += (this.xpForNextLevel - this.xpForThisLevel) * use.levels;
                break;
        }
    }

    // A potion's effect, for seconds stretched by effect duration. Drinking
    // another dose starts the timer again.
    private addBuff(itemId: string, stats: Partial<Stats>, seconds: number, cures: boolean): void {
        const ticks = Math.round(seconds * (1 + this.stats.duration) * TICKS_PER_SECOND);
        this.buffs = this.buffs.filter((b) => b.itemId !== itemId);
        this.buffs.push({
            itemId,
            stats,
            cures,
            startTick: this.tick,
            endTick: this.tick + ticks,
        });
        this.updateStats();
    }

    // What an endless round multiplies enemies' hitpoints and damage by (1 in
    // the first round, and outside endless runs)
    get roundHp(): number {
        return roundScale(ROUND_HP, this.round);
    }

    get roundDamage(): number {
        return roundScale(ROUND_DAMAGE, this.round);
    }

    // What coins found in the run are worth: less in endless runs, and less
    // again in their later rounds (see endless.ts), and more on hard mode
    get coinScale(): number {
        return (this.endless ? endlessCoinScale(this.round) : 1) * (this.hard ? HARD_COINS : 1);
    }

    // Coins for high alching an item, as the run pays them
    alchValue(itemId: string, upgrades = 0): number {
        return Math.round(
            getAlchValue(getItem(itemId), this.stats.greed, upgrades) * this.coinScale,
        );
    }

    // Healing keeps up with how hard enemies hit
    private get healScale(): number {
        return this.roundDamage;
    }

    // An antidote is keeping poison and drains off
    get cured(): boolean {
        return this.buffs.some((b) => b.cures);
    }

    // The item shown in the player's hand: the current tier of their rarest
    // weapon that has one (the first of them on a tie), so a Twisted bow
    // found later is wielded over the starting knives.
    getHeldObjId(): number {
        let held = -1;
        let heldRarity = -1;
        for (const weapon of this.weapons) {
            const level = this.getLevel(weapon);
            const rarity = RARITY_ORDER.indexOf(weapon.def.rarity);
            if (level.objId !== undefined && rarity > heldRarity) {
                held = level.objId;
                heldRarity = rarity;
            }
        }
        return held;
    }

    // ---- Tick ----

    // A tick of the run. On your own, with what's pressed; co-op sets each
    // hero's input (setInput) and leaves these out.
    step(moveX?: number, moveY?: number): void {
        if (moveX !== undefined && moveY !== undefined) {
            this.setInput(this.focus, moveX, moveY);
        }
        // Each part of the tick works on its own heroes. Until one does, the
        // first, so every co-op player's copy starts from the same one.
        this.use(this.heroes[0]);
        this.stepRun();
        this.use(this.heroes[this.focus]);
    }

    // What a hero is pressing, from the next tick on
    setInput(heroIndex: number, moveX: number, moveY: number): void {
        const hero = this.heroes[heroIndex];
        if (hero) {
            hero.moveX = moveX;
            hero.moveY = moveY;
        }
    }

    // Co-op: a player has left the game. Their hero's gone from the run, and
    // anything that was waiting on them goes on without them.
    leave(heroIndex: number): void {
        const hero = this.heroes[heroIndex];
        if (!hero || hero.left) {
            return;
        }
        hero.left = true;
        hero.pendingLevelUps = 0;
        hero.choices = [];
        hero.chests = [];
        if (this.offer?.hero === heroIndex) {
            this.offer = undefined;
        }
        this.as(heroIndex, () => this.emit({ type: "heroLeft" }));
        if (this.runOver) {
            return;
        }
        this.rescaleParty();
        if (!this.heroes.some((other) => this.isUp(other))) {
            this.endRun("dead");
        } else if (this.state !== "playing") {
            this.settle();
            if ((this.state as SimState) === "playing") {
                this.as(this.focus, () => this.checkLevelUp());
            } else {
                // A level up that was waiting behind what's gone with them
                this.as(this.focus, () => this.rollMissingChoices());
            }
        }
    }

    private stepRun(): void {
        if (this.runOver) {
            // Keep the clock going so death animations play out
            this.tick++;
            return;
        }
        if (this.state !== "playing") {
            return;
        }
        this.tick++;
        for (const hero of this.heroes) {
            hero.recentDamage[this.tick % DPS_WINDOW_TICKS] = 0;
            if (!hero.left) {
                this.use(hero);
                this.stepBuffs();
            }
        }
        this.stepPowerUps();
        for (const hero of this.heroes) {
            if (this.isUp(hero)) {
                this.use(hero);
                this.stepPlayer(hero.moveX, hero.moveY);
            }
        }
        if (this.runOver) {
            // Poison finished them
            return;
        }
        // Each hero's on a tick of its own, so a party's don't all come at once
        for (const hero of this.heroes) {
            if ((this.tick + hero.index * 2) % FLOW_FIELD_INTERVAL === 0 && this.isUp(hero)) {
                this.use(hero);
                this.updateFlowField();
            }
        }
        // A fun map's round turns over every fifteen minutes of waves (there's
        // no final boss to kill for it)
        if (this.map.fun && this.mapSeconds >= RUN_LENGTH) {
            this.nextRound();
        }
        this.stepIntro();
        this.stepDirector();
        this.stepChat();
        this.rebuildEnemyHash();
        this.stepEnemies();
        this.stepGlyphs();
        for (const hero of this.heroes) {
            // On your own, weapons still fire in the tick the player falls in
            if (this.isUp(hero) || this.heroes.length === 1) {
                this.use(hero);
                this.stepWeapons();
            }
        }
        this.stepPendingHits();
        this.stepTurrets();
        this.stepThralls();
        this.stepRocks();
        this.stepRampages();
        this.stepRings();
        this.stepProjectiles();
        this.stepFires();
        this.stepPools();
        this.stepEnemyProjectiles();
        this.stepBossFight();
        this.stepPickups();
        this.stepRandomEvents();
        this.cleanUp();
        this.checkLevelUp();
    }

    private stepBuffs(): void {
        const tick = this.tick;
        if (
            this.buffs.some((b) => b.endTick <= tick) ||
            this.debuffs.some((d) => d.endTick <= tick)
        ) {
            this.buffs = this.buffs.filter((b) => b.endTick > tick);
            this.debuffs = this.debuffs.filter((d) => d.endTick > tick);
            this.updateStats();
        }
    }

    private stepPowerUps(): void {
        const tick = this.tick;
        for (const active of this.powerUps) {
            if (active.endTick <= tick) {
                this.useHeroAt(active.hero);
                this.emit({ type: "powerUpEnded", id: active.id });
            }
        }
        this.powerUps = this.powerUps.filter((p) => p.endTick > tick);
    }

    private stepPlayer(moveX: number, moveY: number): void {
        const player = this.player;
        player.prevX = player.x;
        player.prevY = player.y;
        const frozen = player.frozen > 0;
        if (frozen) {
            player.frozen--;
        }
        const moving = movePlayer(this.grid, player, moveX, moveY, {
            radius: player.radius,
            baseSpeed: PLAYER_SPEED,
            moveSpeed: this.stats.moveSpeed,
            tick: this.tick,
            sledEndTick: this.sledEndTick,
            sledSpeed: this.sledSpeed,
            frozen,
            held: !!this.hold,
            curse: this.curse,
            arena:
                this.map.bossArena && this.shownBoss?.def.boss?.phases ? this.bossArena : undefined,
        });
        if (moving !== player.moving) {
            player.moving = moving;
            player.moveStart = this.tick;
        }
        if (player.invulnerable > 0) {
            player.invulnerable--;
        }
        // Held above what a hit gives, or boss hits and poison get through as
        // it runs down (see reviving), and below the > 30 that makes them blink
        if (this.tick < this.sledEndTick || this.intro) {
            player.invulnerable = Math.max(player.invulnerable, HIT_INVULNERABLE_TICKS + 1);
        }
        if (player.flash > 0) {
            player.flash--;
        }
        if (this.stats.regen > 0 && player.hp < player.maxHp) {
            // Regen is hitpoints a minute
            this.regenAccumulator += this.stats.regen / (60 * TICKS_PER_SECOND);
            if (this.regenAccumulator >= 1) {
                const amount = Math.floor(this.regenAccumulator);
                this.regenAccumulator -= amount;
                this.heal(amount);
            }
        }
        this.stepPoison();
    }

    // Poison hits once a second until it wears off; armour doesn't help
    private stepPoison(): void {
        const player = this.player;
        if (player.poisonEnd === -1) {
            return;
        }
        if ((player.poisonEnd - this.tick) % TICKS_PER_SECOND === 0 && !this.reviving) {
            const amount = player.poisonDamage;
            player.hp -= amount;
            this.damageTaken += amount;
            this.emit({ type: "playerPoisoned", amount });
            if (player.hp <= 0) {
                this.playerDied();
            }
        }
        if (this.tick >= player.poisonEnd) {
            player.poisonEnd = -1;
            player.poisonDamage = 0;
        }
    }

    // Just brought back by a ring of life, or on a sled, so nothing can hurt them
    private get reviving(): boolean {
        return this.player.invulnerable > HIT_INVULNERABLE_TICKS;
    }

    // ---- Spawning ----

    private currentWave() {
        const seconds = this.mapSeconds;
        const waves = this.map.waves;
        let wave = waves[0];
        for (const w of waves) {
            if (w.start <= seconds) {
                wave = w;
            }
        }
        return wave;
    }

    private stepDirector(): void {
        if (this.aloneWith?.dead) {
            this.aloneWith = undefined;
        }
        // Nothing else comes while a boss makes its entrance, or fights alone
        if (this.intro || this.aloneWith) {
            return;
        }
        const seconds = this.mapSeconds;
        const events = this.map.events;
        while (this.eventIndex < events.length && events[this.eventIndex].at <= seconds) {
            const event = events[this.eventIndex];
            this.useSpawnHero();
            if (event.kind === "elite") {
                for (let i = 0; i < (this.hard ? HARD_ELITES : 1); i++) {
                    this.spawnEnemy(getEnemy(event.enemyId), "elite");
                }
            } else if (event.kind === "ring") {
                this.spawnRing(getEnemy(event.enemyId), event.count);
            } else if (getEnemy(event.enemyId).boss?.intro) {
                this.startIntro(getEnemy(event.enemyId), event.kind, event.hp);
                this.eventIndex++;
                return;
            } else if (!this.bringOnBoss(getEnemy(event.enemyId), event.kind, event.hp)) {
                // Nowhere to put it this tick; bosses can't be skipped
                break;
            }
            this.eventIndex++;
        }

        const fun = this.map.fun;
        if (fun?.bosses.together && this.seconds >= this.nextFunBossSeconds) {
            // All at once, each on its own spot; the next lot is due once
            // they're all dead
            this.useSpawnHero();
            this.funBossGroup = fun.bosses.pool.flatMap((id) => {
                const boss = this.spawnBoss(getEnemy(id), "boss", undefined);
                return boss ? [boss] : [];
            });
            if (this.funBossGroup.length > 0) {
                this.nextFunBossSeconds = Infinity;
            }
        } else if (fun && this.seconds >= this.nextFunBossSeconds) {
            const pool = fun.bosses.pool;
            const choices = pool.length > 1 ? pool.filter((id) => id !== this.lastFunBoss) : pool;
            const id = choices[this.rng.int(choices.length)];
            this.useSpawnHero();
            if (this.spawnBoss(getEnemy(id), "boss", undefined)) {
                this.lastFunBoss = id;
                this.nextFunBossSeconds = this.seconds + this.rng.range(...fun.bosses.every);
            }
        }

        const wave = this.currentWave();
        // Endless runs' later rounds bring bigger crowds, and so do hard mode
        // and co-op's players
        const soloCrowd = roundCrowd(this.round) * (this.hard ? HARD_CROWD : 1);
        const crowd = soloCrowd * this.partyScale.crowd;
        const alive = this.countAlive();
        const maxAlive = Math.min(Math.round(wave.maxAlive * crowd), MAX_ENEMIES);
        if (this.heroes.length > 1) {
            const alone = Math.min(wave.maxAlive * soloCrowd, MAX_ENEMIES);
            const bigger = Math.min(wave.maxAlive * crowd, MAX_ENEMIES) / alone;
            this.partyXp = (this.partyScale.crowd * this.partyScale.xp) / bigger;
        }
        const minAlive = Math.min(Math.round(wave.minAlive * crowd), maxAlive);
        let toSpawn = 0;
        if (alive < minAlive) {
            toSpawn = Math.min(minAlive - alive, 8);
        }
        this.spawnAccumulator += (wave.spawnRate * crowd) / TICKS_PER_SECOND;
        while (this.spawnAccumulator >= 1) {
            this.spawnAccumulator--;
            toSpawn++;
        }
        const weights = wave.enemies.map((e) => e.weight);
        for (let i = 0; i < toSpawn && alive + i < maxAlive; i++) {
            this.useSpawnHero();
            const pick = wave.enemies[this.rng.weightedIndex(weights)];
            this.spawnEnemy(getEnemy(pick.id), "normal");
        }
    }

    // Fun maps' chat: now and then an enemy near the player says one of its
    // lines (one at a time, so it can be read), and the player answers back
    private stepChat(): void {
        const fun = this.map.fun;
        if (!fun) {
            return;
        }
        if (fun.chatEvery !== undefined && this.tick >= this.nextChatTick) {
            this.nextChatTick =
                this.tick + Math.round(fun.chatEvery * this.rng.range(0.6, 1.4) * TICKS_PER_SECOND);
            this.useSpawnHero();
            const player = this.player;
            let speaker: Enemy | undefined;
            let seen = 0;
            for (const enemy of this.enemies) {
                if (
                    enemy.dead ||
                    !enemy.def.chat ||
                    fm.hypot(enemy.x - player.x, enemy.y - player.y) > CHAT_RANGE
                ) {
                    continue;
                }
                // Any one of them, as likely as the next
                seen++;
                if (this.rng.int(seen) === 0) {
                    speaker = enemy;
                }
            }
            const lines = speaker?.def.chat;
            if (speaker && lines) {
                const text = lines[this.rng.int(lines.length)];
                this.emit({ type: "bossShout", enemyUid: speaker.uid, text });
            }
        }
        if (fun.playerChat && this.seconds >= this.nextPlayerChatSeconds && !this.runOver) {
            const lines = fun.playerChat.lines;
            this.emit({ type: "playerShout", text: lines[this.rng.int(lines.length)] });
            this.nextPlayerChatSeconds = this.seconds + this.rng.range(...fun.playerChat.every);
        }
    }

    private countAlive(): number {
        let alive = 0;
        for (const enemy of this.enemies) {
            if (!enemy.dead) {
                alive++;
            }
        }
        return alive;
    }

    private findSpawnPoint(
        def: EnemyDef,
        minDistance: number,
        maxDistance: number,
        angle?: number,
    ) {
        const player = this.player;
        for (let attempt = 0; attempt < 16; attempt++) {
            const a =
                angle !== undefined && attempt < 4
                    ? angle + this.rng.range(-0.6, 0.6)
                    : this.rng.range(0, Math.PI * 2);
            const distance = this.rng.range(minDistance, maxDistance);
            const x = Math.floor(player.x + fm.cos(a) * distance) + 0.5;
            const y = Math.floor(player.y + fm.sin(a) * distance) + 0.5;
            if (this.canTurnUpAt(def, x, y) && !this.besideATeammate(x, y, minDistance)) {
                return { x, y };
            }
        }
        return undefined;
    }

    // Co-op: whether a spot's closer than this to a player still up
    private besideATeammate(x: number, y: number, distance: number): boolean {
        return (
            this.heroes.length > 1 &&
            this.heroes.some(
                (hero) =>
                    this.isUp(hero) && fm.hypot(hero.player.x - x, hero.player.y - y) < distance,
            )
        );
    }

    // Whether an enemy can turn up here: only where the player could stand and
    // get to from where they are, or it's stuck behind a wall. Ghosts too, so
    // nothing rises out of a mountain. The flow field goes over a ditch
    // (MapDef.ditch), so either side of one will do: enemies jump it.
    private canTurnUpAt(def: EnemyDef, x: number, y: number): boolean {
        const tileX = Math.floor(x);
        const tileY = Math.floor(y);
        return (
            this.grid.contains(tileX, tileY) &&
            this.isWalkableTile(tileX, tileY) &&
            isCircleFree(this.grid, x, y, Math.max(def.radius, PLAYER_RADIUS))
        );
    }

    private spawnBoss(
        def: EnemyDef,
        type: "boss" | "finalBoss",
        hp: number | undefined,
        at?: { x: number; y: number },
    ): Enemy | undefined {
        const boss = this.spawnEnemy(def, type, at, hp);
        if (boss) {
            const finalBoss = type === "finalBoss";
            if (finalBoss) {
                this.bossSpawned = true;
            }
            if (def.spawnSpotAnim !== undefined) {
                this.addEffect(def.spawnSpotAnim, boss.x, boss.y, 0, 60);
            }
            this.emit({
                type: "bossSpawned",
                enemyId: def.id,
                name: def.name,
                message: def.spawnMessage ?? `${def.name} has appeared!`,
                finalBoss,
                x: boss.x,
                y: boss.y,
            });
        }
        return boss;
    }

    // bossHp: a boss's hitpoints when they're not its own times the map's
    spawnEnemy(
        def: EnemyDef,
        type: "normal" | "elite" | "boss" | "finalBoss",
        at?: { x: number; y: number },
        bossHp?: number,
    ): Enemy | undefined {
        const boss = type === "boss" || type === "finalBoss";
        let pos = at;
        if (!pos && def.spawnAt) {
            pos = this.pickSpawnSpot(def);
        } else if (!pos) {
            pos = boss
                ? this.findSpawnPoint(def, BOSS_SPAWN_MIN_DISTANCE, BOSS_SPAWN_MAX_DISTANCE)
                : this.findSpawnPoint(
                      def,
                      SPAWN_MIN_DISTANCE,
                      SPAWN_MAX_DISTANCE,
                      def.faction !== undefined ? this.factionAngle(def.faction) : undefined,
                  );
        }
        if (!pos) {
            return undefined;
        }
        // Enemies start hitting harder after 5 minutes (of the round)
        const minutes = this.mapSeconds / 60;
        const hpScale = this.enemyHpScale();
        const damageScale = 1 + Math.max(0, minutes - 5) * 0.03;
        // Bosses are tuned as they are (or for the map they're on); later maps
        // are tougher all round, and so are endless runs' later rounds and hard
        // mode
        const difficulty = this.map.difficulty;
        const bossDamage = difficulty.damage * this.roundDamage * this.hardScale.damage;
        let hp =
            (boss ? (bossHp ?? def.hp * difficulty.hp) : def.hp * hpScale * difficulty.hp) *
            this.roundHp *
            this.hardScale.hp *
            (boss ? this.partyScale.bossHp : this.partyScale.hp);
        // What its hits are multiplied by: its touch, a boss's attacks, its
        // explosion (and in co-op, harder for each player)
        let hitScale = bossDamage * (boss ? 1 : damageScale) * this.partyScale.damage;
        let scale = def.scale ?? 1;
        let tint = 0xffffff;
        let xp =
            def.xp * roundScale(ROUND_XP, this.round) * this.partyXp * (this.hard ? HARD_XP : 1);
        if (type === "elite") {
            hp *= 8;
            hitScale *= 1.25;
            scale *= 1.6;
            tint = ELITE_TINT;
            xp *= 5;
        }
        const enemy: Enemy = {
            uid: this.nextUid++,
            def,
            variant: def.outfits ? this.rng.int(def.outfits.length) : 0,
            x: pos.x,
            y: pos.y,
            prevX: pos.x,
            prevY: pos.y,
            vx: 0,
            vy: 0,
            hp: Math.round(hp),
            maxHp: Math.round(hp),
            damage: Math.round(def.damage * hitScale),
            speed: (def.speed * (type === "elite" ? 0.85 : 1)) / TICKS_PER_SECOND,
            radius: def.radius,
            scale,
            tint,
            elite: type === "elite",
            boss,
            finalBoss: type === "finalBoss",
            bossState:
                boss && def.boss
                    ? {
                          cooldowns: def.boss.attacks.map(() => 0),
                          stolenCoins: 0,
                          rises: 0,
                          enraged: false,
                          summonsDone: 0,
                          channelEnd: 0,
                      }
                    : undefined,
            damageScale: hitScale,
            yaw: 0,
            anim: "walk",
            animStart: this.tick,
            attackSeq: def.attackSeq,
            // Bosses take a moment before their first attack
            attackCooldown: boss ? TICKS_PER_SECOND : 0,
            // Turning up while time stands still
            frozen: boss ? 0 : Math.max(0, this.freezeEndTick - this.tick),
            drain: 0,
            drainEnd: 0,
            venom: 0,
            venomNext: 0,
            venomEnd: -1,
            flash: 0,
            dead: false,
            deathTick: 0,
            xp,
            shieldEnd: 0,
            risingEnd: 0,
            blockedTick: -BLOCKED_SPLAT_TICKS,
            spawnedBy: 0,
            nextFoeLook: this.tick + (this.nextUid % FOE_LOOK_TICKS),
            foeWait: 0,
            aggro: false,
            noDrops: false,
            bonesOnly: false,
            abilities: getAbilities(def, this.tick, this.rng),
        };
        this.enemies.push(enemy);
        if (def.shield) {
            const ticks = Math.round(def.shield.seconds * TICKS_PER_SECOND);
            enemy.shieldEnd = this.tick + ticks;
            if (def.shield.spotAnim !== undefined) {
                this.addEffect(def.shield.spotAnim, enemy.x, enemy.y, 0, ticks, enemy.uid, true);
            }
        }
        const glyph = boss ? def.boss?.glyph : undefined;
        if (glyph) {
            this.addGlyph(enemy, getEnemy(glyph.lookId));
        }
        if (boss && def.boss?.phases) {
            this.startPhases(enemy, def.boss.phases);
        }
        return enemy;
    }

    // The way a faction's army comes from, around the player: so the armies
    // meet (and fight) around them rather than arriving mixed together
    private factionAngle(faction: string): number {
        if (this.factionBaseAngle === undefined) {
            this.factionBaseAngle = this.rng.range(0, Math.PI * 2);
        }
        let index = this.factions.indexOf(faction);
        if (index === -1) {
            index = this.factions.push(faction) - 1;
        }
        return this.factionBaseAngle + index * FACTION_SPREAD + this.mapSeconds * FACTION_TURN;
    }

    // One of the spots an enemy turns up at (EnemyDef.spawnAt) with room for
    // it, undefined if none has
    private pickSpawnSpot(def: EnemyDef): { x: number; y: number } | undefined {
        const free = def.spawnAt!.filter(({ x, y }) =>
            // What never moves can stand on its own spot, solid or not (a
            // portal's is in the map's collision)
            def.stationary
                ? this.grid.contains(Math.floor(x), Math.floor(y))
                : this.canTurnUpAt(def, x, y),
        );
        return free.length > 0 ? free[this.rng.int(free.length)] : undefined;
    }

    // Enemies get tougher faster as the run (or round) goes on: gently for the
    // first few minutes, then 1.9x hitpoints at 10 minutes and 2.65x at 15
    private enemyHpScale(): number {
        const minutes = this.mapSeconds / 60;
        return 1 + minutes * 0.05 + minutes * minutes * 0.004;
    }

    private spawnRing(def: EnemyDef, count: number): void {
        const player = this.player;
        const radius = 12;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const x = player.x + fm.cos(angle) * radius;
            const y = player.y + fm.sin(angle) * radius;
            if (this.canTurnUpAt(def, x, y)) {
                this.spawnEnemy(def, "normal", { x, y });
            }
        }
    }

    // ---- Enemies ----

    private rebuildEnemyHash(): void {
        this.enemyHash.clear();
        for (const enemy of this.enemies) {
            if (!enemy.dead && !enemy.leaving) {
                this.enemyHash.insert(enemy);
            }
        }
    }

    private stepEnemies(): void {
        let player = this.player;
        const grid = this.grid;
        const step = this.temp;
        for (const enemy of this.enemies) {
            enemy.prevX = enemy.x;
            enemy.prevY = enemy.y;
            if (enemy.flash > 0) {
                enemy.flash--;
            }
            if (enemy.dead) {
                continue;
            }
            if (enemy.leaving) {
                this.stepLeaving(enemy, enemy.leaving);
                continue;
            }
            if (enemy.shieldEnd !== 0 && this.tick >= enemy.shieldEnd) {
                this.dropShield(enemy);
            }
            if (enemy.risingEnd !== 0) {
                if (this.tick < enemy.risingEnd) {
                    continue;
                }
                enemy.risingEnd = 0;
                enemy.vx = enemy.vy = 0;
                enemy.anim = "walk";
                enemy.animStart = this.tick;
            }
            if (enemy.walksTo) {
                this.stepWalker(enemy, enemy.walksTo);
                continue;
            }
            if (enemy.attackCooldown > 0) {
                enemy.attackCooldown--;
            }
            if (enemy.venomEnd >= this.tick && this.tick >= enemy.venomNext) {
                enemy.venomNext += TICKS_PER_SECOND;
                this.useHeroAt(enemy.venomHero);
                this.damageSource = enemy.venomSource ?? "other";
                this.damageEnemy(enemy, enemy.venom, 0, enemy.x, enemy.y, 1, true);
                if (enemy.dead) {
                    continue;
                }
            }
            // It goes for whoever's nearest
            this.use(this.nearestHero(enemy.x, enemy.y));
            player = this.player;

            if (enemy.jump) {
                this.stepJump(enemy);
                continue;
            }

            let dx = player.x - enemy.x;
            let dy = player.y - enemy.y;
            const distance = fm.hypot(dx, dy);
            const flight = enemy.def.flies ? this.getFlight() : undefined;

            // The final boss waits for the player, and what can't move stays
            // put; anything else left behind comes back
            const stationary = enemy.def.stationary ?? false;
            if (distance > RELOCATE_DISTANCE && !enemy.finalBoss && !stationary) {
                this.relocate(enemy);
                continue;
            }

            const abilities = enemy.abilities;
            if (abilities && enemy.frozen === 0 && this.stepAbilities(enemy, abilities, distance)) {
                // It blinked over to the player
                continue;
            }

            // Knockback
            let moveX = enemy.vx;
            let moveY = enemy.vy;
            enemy.vx *= 0.75;
            enemy.vy *= 0.75;

            if (enemy.frozen > 0) {
                enemy.frozen--;
            } else {
                let dirX = 0;
                let dirY = 0;
                const tileX = Math.floor(enemy.x);
                const tileY = Math.floor(enemy.y);
                const jump =
                    enemy.def.ghost || flight ? 0 : this.flowField.jumpFrom(grid, tileX, tileY);
                if (distance < 2.5 && jump !== 0 && Math.sign(dy) === Math.sign(jump)) {
                    // Close, but over the ditch
                    this.startJump(enemy, jump);
                    continue;
                } else if (
                    enemy.def.ghost ||
                    distance < 2.5 ||
                    // A clear flight straight there, and only round terrain if not
                    (flight && canWalkStraight(flight.grid, enemy.x, enemy.y, player.x, player.y))
                ) {
                    if (distance > 0.001) {
                        dirX = dx / distance;
                        dirY = dy / distance;
                    }
                } else if (
                    flight
                        ? flight.field.getStep(flight.grid, tileX, tileY, step)
                        : this.flowField.getStep(grid, tileX, tileY, step)
                ) {
                    if (Math.abs(step.y) > 1) {
                        this.startJump(enemy, step.y);
                        continue;
                    }
                    // Head for the middle of the next tile, which keeps big
                    // enemies off corners
                    const tx = tileX + step.x + 0.5 - enemy.x;
                    const ty = tileY + step.y + 0.5 - enemy.y;
                    const len = fm.hypot(tx, ty);
                    if (len > 0.001) {
                        dirX = tx / len;
                        dirY = ty / len;
                    }
                } else if (distance > 0.001) {
                    dirX = dx / distance;
                    dirY = dy / distance;
                }

                const bossState = enemy.bossState;
                if (bossState) {
                    const keep = enemy.def.boss?.keepDistance;
                    if (bossState.windup || bossState.surge || bossState.walkers) {
                        // Stands still winding up, so a swing can be stepped away from
                        dirX = dirY = 0;
                    } else if (this.tick < bossState.channelEnd) {
                        // And while its volleys go out, so a spiral stays a spiral
                        dirX = dirY = 0;
                    } else if (keep !== undefined && distance < keep) {
                        // Ranged bosses stop once they're in range (and stand their
                        // ground if you come at them)
                        dirX = dirY = 0;
                    }
                } else if (enemy.def.shot && distance < enemy.def.shot.range * SHOOTER_KEEP) {
                    // Rangers and mages hang back to shoot, and close in when
                    // they're out of reach
                    dirX = dirY = 0;
                }
                // Running off with the flag: away from the player when they're
                // close, standing their ground a bit further out, and only
                // coming back when they're far off
                const flees = enemy.def.flees;
                let fleeing = false;
                if (flees && !bossState?.windup) {
                    if (distance < flees.range) {
                        fleeing = this.fleeFrom(enemy, dx, dy, distance, step);
                        dirX = fleeing ? step.x : 0;
                        dirY = fleeing ? step.y : 0;
                    } else if (distance < flees.range * 2) {
                        dirX = dirY = 0;
                    }
                }
                const lapping = this.isLapping(enemy, distance);
                const healTarget = abilities?.healTarget;
                const fighting =
                    stationary || healTarget || fleeing || lapping
                        ? undefined
                        : this.findFoe(enemy, distance);
                if (fighting) {
                    // Off to fight another god's army, stopping once it's in
                    // reach (the hit itself is the touch below)
                    const fx = fighting.x - enemy.x;
                    const fy = fighting.y - enemy.y;
                    const length = fm.hypot(fx, fy);
                    const reach = enemy.radius + fighting.radius + 0.05;
                    dirX = length > reach ? fx / length : 0;
                    dirY = length > reach ? fy / length : 0;
                }
                if (stationary || (abilities && abilities.blinkLand !== -1)) {
                    // Winding up a blink, it stands still
                    dirX = dirY = 0;
                } else if (healTarget) {
                    // Off to heal something instead, stopping once it's in reach
                    const hx = healTarget.x - enemy.x;
                    const hy = healTarget.y - enemy.y;
                    const reach = enemy.def.heals!.range * 0.8 + healTarget.radius;
                    const length = fm.hypot(hx, hy);
                    dirX = dirY = 0;
                    if (length > reach) {
                        dirX = hx / length;
                        dirY = hy / length;
                    }
                }

                if (lapping) {
                    this.lapDirection(enemy, dx, dy, distance, step);
                    dirX = step.x;
                    dirY = step.y;
                }

                // Keep apart from each other, and bump into other factions
                // (bosses and elites don't get dragged into it: they'd lose
                // their caskets; nor does one after the player)
                let sepX = 0;
                let sepY = 0;
                const faction = enemy.boss || enemy.aggro ? undefined : enemy.def.faction;
                let foe: Enemy | undefined;
                this.enemyHash.query(enemy.x, enemy.y, 1, (other) => {
                    if (other === enemy) {
                        return;
                    }
                    const ox = enemy.x - other.x;
                    const oy = enemy.y - other.y;
                    const minDist = enemy.radius + other.radius;
                    const distSq = ox * ox + oy * oy;
                    if (
                        faction !== undefined &&
                        other.def.faction !== undefined &&
                        other.def.faction !== faction &&
                        !other.boss &&
                        !other.elite &&
                        !other.dead &&
                        distSq < (minDist + 0.1) * (minDist + 0.1)
                    ) {
                        foe = other;
                    }
                    if (distSq < minDist * minDist && distSq > 1e-6) {
                        const d = Math.sqrt(distSq);
                        const push = (minDist - d) / d;
                        sepX += ox * push;
                        sepY += oy * push;
                    }
                });

                const touching = distance < enemy.radius + player.radius + 0.1;
                if (lapping) {
                    moveX += dirX * enemy.speed * this.laps!.speed;
                    moveY += dirY * enemy.speed * this.laps!.speed;
                } else if (
                    // On its way to heal something, the player's just in the way
                    (!touching || healTarget) &&
                    !(fighting && dirX === 0 && dirY === 0)
                ) {
                    moveX += dirX * enemy.speed;
                    moveY += dirY * enemy.speed;
                }
                moveX += sepX * 0.25;
                moveY += sepY * 0.25;

                if (fleeing || lapping) {
                    // Looking where it's running, not back at the player
                    enemy.yaw = yawFromVector(dirX, dirY);
                } else if (fighting) {
                    enemy.yaw = yawFromVector(fighting.x - enemy.x, fighting.y - enemy.y);
                } else if (dirX !== 0 || dirY !== 0 || bossState) {
                    enemy.yaw = yawFromVector(dx, dy);
                }

                // Bosses hit with their own attacks instead
                const canHit =
                    enemy.attackCooldown === 0 && !bossState && enemy.damage > 0 && !lapping;
                if (touching && canHit) {
                    this.enemyAttack(enemy);
                } else if (foe && canHit && !enemy.boss) {
                    this.enemyHitsEnemy(enemy, foe);
                } else if (
                    enemy.def.shot &&
                    !bossState &&
                    !lapping &&
                    enemy.attackCooldown === 0 &&
                    distance <= enemy.def.shot.range
                ) {
                    this.enemyShoot(enemy, enemy.def.shot);
                }
            }

            if (stationary) {
                moveX = moveY = 0;
                enemy.vx = enemy.vy = 0;
            }
            if (moveX !== 0 || moveY !== 0) {
                if (enemy.def.ghost) {
                    enemy.x += moveX;
                    enemy.y += moveY;
                } else {
                    moveCircle(flight?.grid ?? grid, enemy, moveX, moveY, enemy.radius);
                }
            }

            // Crowd round the player rather than standing inside them (and
            // the player can't walk into what doesn't move)
            const ox = enemy.x - player.x;
            const oy = enemy.y - player.y;
            const minDist = enemy.radius + player.radius;
            const distSq = ox * ox + oy * oy;
            if (distSq < minDist * minDist && distSq > 1e-6) {
                const d = Math.sqrt(distSq);
                const push = Math.min((minDist - d) / d, 0.5);
                if (stationary) {
                    moveCircle(grid, player, -ox * push, -oy * push, player.radius);
                } else if (enemy.def.ghost) {
                    enemy.x += ox * push;
                    enemy.y += oy * push;
                } else {
                    moveCircle(flight?.grid ?? grid, enemy, ox * push, oy * push, enemy.radius);
                }
            }

            if (enemy.bossState) {
                this.stepBoss(enemy, distance);
            }

            // Back to walking once an attack has played
            if (
                enemy.anim === "attack" &&
                this.tick - enemy.animStart > 30 &&
                !enemy.bossState?.windup &&
                !enemy.bossState?.surge &&
                (enemy.abilities?.blinkLand ?? -1) === -1
            ) {
                enemy.anim = "walk";
                enemy.animStart = this.tick;
            }
        }
    }

    // The way to run from the player (dx, dy away from the enemy): straight
    // away if there's room a tile on, otherwise the nearest way round that
    // has (along a wall, or back past them out of a corner). False if it's
    // boxed in.
    private fleeFrom(
        enemy: Enemy,
        dx: number,
        dy: number,
        distance: number,
        out: { x: number; y: number },
    ): boolean {
        const awayX = distance > 0.001 ? -dx / distance : 1;
        const awayY = distance > 0.001 ? -dy / distance : 0;
        for (const turn of FLEE_TURNS) {
            const cos = fm.cos(turn);
            const sin = fm.sin(turn);
            const x = awayX * cos - awayY * sin;
            const y = awayX * sin + awayY * cos;
            const aheadX = enemy.x + x * FLEE_LOOKAHEAD;
            const aheadY = enemy.y + y * FLEE_LOOKAHEAD;
            if (
                this.grid.contains(Math.floor(aheadX), Math.floor(aheadY)) &&
                (enemy.def.ghost ||
                    isCircleFree(this.getMoveGrid(enemy.def), aheadX, aheadY, enemy.radius))
            ) {
                out.x = x;
                out.y = y;
                return true;
            }
        }
        return false;
    }

    // Over the ditch, this many tiles north or south, landing in the middle
    // of a tile if there isn't room straight across
    private startJump(enemy: Enemy, tiles: number): void {
        const toY = Math.floor(enemy.y) + tiles + 0.5;
        const toX = isCircleFree(this.grid, enemy.x, toY, enemy.radius)
            ? enemy.x
            : Math.floor(enemy.x) + 0.5;
        enemy.jump = { fromX: enemy.x, fromY: enemy.y, toX, toY, start: this.tick };
        enemy.anim = "jump";
        enemy.animStart = this.tick;
        enemy.yaw = yawFromVector(0, tiles);
    }

    private stepJump(enemy: Enemy): void {
        const jump = enemy.jump!;
        const t = this.tick - jump.start;
        const f = Math.min(Math.max((t - JUMP_LEAVE) / (JUMP_LAND - JUMP_LEAVE), 0), 1);
        enemy.x = jump.fromX + (jump.toX - jump.fromX) * f;
        enemy.y = jump.fromY + (jump.toY - jump.fromY) * f;
        if (t >= JUMP_TICKS) {
            enemy.jump = undefined;
            enemy.vx = enemy.vy = 0;
            enemy.anim = "walk";
            enemy.animStart = this.tick;
        }
    }

    // Running a Drill Demon's laps. Bosses, what can't move and flag carriers
    // carry on as they were.
    private isLapping(enemy: Enemy, distance: number): boolean {
        return (
            this.tick < this.lapsEndTick &&
            distance < this.laps!.range &&
            !enemy.boss &&
            !enemy.def.stationary &&
            !enemy.def.flees
        );
    }

    // Round the player, drifting in or out onto the ring. dx, dy: to the player.
    private lapDirection(enemy: Enemy, dx: number, dy: number, distance: number, out: Vec2): void {
        if (distance < 0.01) {
            // Right on top of the player: any way out will do
            out.x = 1;
            out.y = 0;
            return;
        }
        const length = distance;
        const toward = Math.max(-1, Math.min(1, (distance - this.laps!.radius) / LAP_PULL_TILES));
        const x = -dy / length + (dx / length) * toward;
        const y = dx / length + (dy / length) * toward;
        const size = fm.hypot(x, y);
        out.x = x / size;
        out.y = y / size;
    }

    // Ahead of the player if they're moving, so they keep running into things,
    // or behind them
    private relocate(enemy: Enemy, behind = false): void {
        const player = this.player;
        const side = behind ? -1 : 1;
        const angle = player.moving
            ? fm.atan2(player.facingY * side, player.facingX * side)
            : undefined;
        const pos = this.findSpawnPoint(enemy.def, SPAWN_MIN_DISTANCE, SPAWN_MAX_DISTANCE, angle);
        if (pos) {
            enemy.x = enemy.prevX = pos.x;
            enemy.y = enemy.prevY = pos.y;
            enemy.vx = enemy.vy = 0;
            if (enemy.bossState) {
                enemy.bossState.windup = undefined;
            }
        }
    }

    private enemyAttack(enemy: Enemy): void {
        enemy.attackCooldown = ENEMY_ATTACK_COOLDOWN;
        enemy.anim = "attack";
        enemy.animStart = this.tick;
        if (this.player.invulnerable > 0) {
            return;
        }
        this.damagePlayer(enemy.damage, enemy.def.id, enemy.elite);
        this.recoil(enemy);
    }

    // A ranger's or mage's shot: a projectile at where the player is now, for
    // the enemy's own damage
    private enemyShoot(enemy: Enemy, shot: EnemyShotDef): void {
        enemy.attackCooldown = Math.round(shot.interval * TICKS_PER_SECOND);
        enemy.anim = "attack";
        enemy.animStart = this.tick;
        enemy.attackSeq = shot.seq ?? enemy.def.attackSeq;
        if (shot.castSpotAnim !== undefined) {
            this.addEffect(shot.castSpotAnim, enemy.x, enemy.y, 0, 40, enemy.uid);
        }
        this.emit({
            type: "bossAttack",
            enemyId: enemy.def.id,
            sound: shot.sound ?? -1,
            x: enemy.x,
            y: enemy.y,
        });
        this.launchProjectiles(enemy, shotAttack(shot), enemy.damage, true);
    }

    // A hit on the player; armour takes some off (unless it hits through it).
    // Returns what it took.
    private damagePlayer(
        damage: number,
        enemyId: string,
        elite: boolean,
        sound?: number,
        ignoreArmor = false,
    ): number {
        const player = this.player;
        if (this.hero.down && !this.runOver) {
            return 0;
        }
        const armor = ignoreArmor ? 0 : this.stats.armor;
        const amount = Math.max(1, Math.round(damage - armor));
        player.hp -= amount;
        this.damageTaken += amount;
        player.flash = 6;
        player.invulnerable = Math.max(player.invulnerable, HIT_INVULNERABLE_TICKS);
        this.emit({ type: "playerHit", amount, enemyId, elite, sound });
        if (player.hp <= 0) {
            this.playerDied();
        }
        return amount;
    }

    // Ring of recoil: hits hurt whoever lands them
    private recoil(enemy: Enemy | undefined): void {
        if (this.stats.thorns > 0 && enemy && !enemy.dead && !this.runOver) {
            const player = this.player;
            this.damageSource = "recoil";
            this.damageEnemy(enemy, this.stats.thorns, 0.5, player.x, player.y);
        }
    }

    // Another faction's enemy for this one to go and fight instead of the
    // player (EnemyDef.faction): the one it's fighting while it's still up and
    // close, otherwise the nearest it finds when it looks round. None for
    // bosses and elites (they'd lose their caskets), for one the player's hit,
    // or with the player close. Going from one foe that's still up to another
    // keeps the time it's had no way to them, so it can't put off giving up by
    // flipping between ones it can't reach.
    private findFoe(enemy: Enemy, playerDistance: number): Enemy | undefined {
        const faction = enemy.def.faction;
        if (
            faction === undefined ||
            enemy.boss ||
            enemy.elite ||
            enemy.aggro ||
            playerDistance < FOE_IGNORE_PLAYER
        ) {
            enemy.foe = undefined;
            enemy.foeWait = 0;
            return undefined;
        }
        const current = enemy.foe;
        if (
            current &&
            !current.dead &&
            fm.hypot(current.x - enemy.x, current.y - enemy.y) < FOE_RANGE + 1
        ) {
            return this.chaseFoe(enemy, current);
        }
        if (current?.dead) {
            // That fight's over, so the next is a new one
            enemy.foeWait = 0;
        }
        enemy.foe = undefined;
        if (this.tick < enemy.nextFoeLook) {
            return undefined;
        }
        enemy.nextFoeLook = this.tick + FOE_LOOK_TICKS;
        let nearest = FOE_RANGE * FOE_RANGE;
        this.enemyHash.query(enemy.x, enemy.y, FOE_RANGE, (other) => {
            if (
                other.dead ||
                other.boss ||
                other.elite ||
                other.def.faction === undefined ||
                other.def.faction === faction
            ) {
                return;
            }
            const ox = other.x - enemy.x;
            const oy = other.y - enemy.y;
            const distSq = ox * ox + oy * oy;
            if (distSq < nearest) {
                nearest = distSq;
                enemy.foe = other;
            }
        });
        if (!enemy.foe) {
            enemy.foeWait = 0;
            return undefined;
        }
        return this.chaseFoe(enemy, enemy.foe);
    }

    // The foe it's still after, or nothing once it's had too long with no way
    // to it, when it goes for the player as if they'd hit it. Enemies walk
    // straight at a foe, so a wall in the way stops them even if there's a way
    // round. Only walls count: a crowd in the way or a foe a long walk off
    // doesn't, and the time stays as it was until the way's blocked again.
    private chaseFoe(enemy: Enemy, foe: Enemy): Enemy | undefined {
        if (
            enemy.def.ghost ||
            canWalkStraight(this.getMoveGrid(enemy.def), enemy.x, enemy.y, foe.x, foe.y) ||
            ++enemy.foeWait < FOE_GIVE_UP_TICKS
        ) {
            return foe;
        }
        enemy.aggro = true;
        enemy.foe = undefined;
        return undefined;
    }

    // A touch from an enemy of another faction: a hit like the ones it gives
    // the player, only harder, and nobody's kill
    private enemyHitsEnemy(enemy: Enemy, foe: Enemy): void {
        enemy.foeWait = 0;
        enemy.attackCooldown = ENEMY_ATTACK_COOLDOWN;
        enemy.anim = "attack";
        enemy.animStart = this.tick;
        enemy.attackSeq = enemy.def.attackSeq;
        if (foe.shieldEnd > this.tick) {
            this.showBlocked(foe);
            return;
        }
        const amount = Math.max(
            1,
            Math.round(
                enemy.damage *
                    FACTION_DAMAGE *
                    (this.partyScale.hp / this.partyScale.damage) *
                    (this.hardScale.hp / this.hardScale.damage) *
                    this.rng.range(0.85, 1.15),
            ),
        );
        foe.hp -= amount;
        foe.flash = 5;
        // It turns on whatever hit it, unless it's after the player
        if (!foe.aggro) {
            foe.foe ??= enemy;
        }
        this.emit({
            type: "damage",
            x: foe.x,
            y: foe.y,
            amount,
            enemyUid: foe.uid,
            enemyId: foe.def.id,
        });
        if (foe.hp <= 0) {
            this.killEnemy(foe, "enemy");
        }
    }

    // ---- What enemies do besides hitting ----

    // An enemy's spawns, heals, revives and blinks, as their timers come
    // round. True if it blinked (it's done for this tick).
    private stepAbilities(enemy: Enemy, abilities: EnemyAbilities, distance: number): boolean {
        const def = enemy.def;
        const tick = this.tick;
        if (def.spawns && tick >= abilities.nextSpawn) {
            abilities.nextSpawn = tick + secondsToTicks(def.spawns.interval);
            this.callIn(enemy, def.spawns);
        }
        if (def.heals) {
            this.stepHealer(enemy, abilities, def.heals);
        }
        if (def.revives && tick >= abilities.nextRevive) {
            // Nothing to bring back: look again in a moment
            abilities.nextRevive =
                tick +
                (this.revive(enemy, def.revives)
                    ? secondsToTicks(def.revives.interval)
                    : HEAL_RETARGET_TICKS);
        }
        if (def.blinks) {
            return this.stepBlink(enemy, abilities, def.blinks, distance);
        }
        return false;
    }

    // A spawner's call: some of its enemies around it, as long as it hasn't
    // too many of its own about already
    private callIn(enemy: Enemy, spawns: EnemySpawnsDef): void {
        let own = 0;
        for (const other of this.enemies) {
            if (!other.dead && other.spawnedBy === enemy.uid) {
                own++;
            }
        }
        const count = Math.min(spawns.count, (spawns.max ?? SPAWNS_MAX) - own);
        if (count <= 0 || this.countAlive() >= MAX_ENEMIES) {
            return;
        }
        const weights = spawns.enemies.map((e) => e.weight);
        for (let i = 0; i < count; i++) {
            const def = getEnemy(spawns.enemies[this.rng.weightedIndex(weights)].id);
            const spawned = this.spawnNear(enemy, def, spawns.radius ?? SPAWNS_RADIUS, i, count, 3);
            if (spawned) {
                spawned.spawnedBy = enemy.uid;
                spawned.bonesOnly = spawns.bonesOnly ?? false;
                if (spawns.spotAnim !== undefined) {
                    this.addEffect(spawns.spotAnim, spawned.x, spawned.y, 0, 40);
                }
            }
        }
    }

    // One of count enemies turning up in a ring radius tiles around another,
    // trying a few spots before giving up
    private spawnNear(
        enemy: Vec2,
        def: EnemyDef,
        radius: number,
        index: number,
        count: number,
        attempts = 1,
    ): Enemy | undefined {
        for (let attempt = 0; attempt < attempts; attempt++) {
            const angle =
                attempt === 0
                    ? (index / count) * Math.PI * 2 + this.rng.range(0, 0.5)
                    : this.rng.range(0, Math.PI * 2);
            const x = enemy.x + fm.cos(angle) * radius;
            const y = enemy.y + fm.sin(angle) * radius;
            if (this.canTurnUpAt(def, x, y)) {
                return this.spawnEnemy(def, "normal", { x, y });
            }
        }
        return undefined;
    }

    // A healer goes to the most hurt thing it heals nearby, and heals it once
    // it's close enough, every so often
    private stepHealer(enemy: Enemy, abilities: EnemyAbilities, heals: EnemyHealsDef): void {
        const tick = this.tick;
        let target = abilities.healTarget;
        if (target && (hurtFraction(target) >= 1 || !this.canHeal(enemy, heals, target))) {
            target = abilities.healTarget = undefined;
        }
        if (!target && (tick + enemy.uid) % HEAL_RETARGET_TICKS === 0) {
            target = abilities.healTarget = this.findHealTarget(enemy, heals);
        }
        if (!target || tick < abilities.nextHeal) {
            return;
        }
        const reach = heals.range + target.radius;
        if (fm.hypot(target.x - enemy.x, target.y - enemy.y) > reach) {
            return;
        }
        abilities.nextHeal = tick + secondsToTicks(heals.interval);
        const phase = target.bossState?.phase;
        if (phase) {
            // Only its shield can be fed
            phase.shield = Math.min(
                phase.shieldMax,
                phase.shield + Math.max(1, Math.round(phase.shieldMax * heals.fraction)),
            );
        } else {
            target.hp = Math.min(
                target.maxHp,
                target.hp + Math.max(1, Math.round(target.maxHp * heals.fraction)),
            );
        }
        if (heals.spotAnim !== undefined) {
            this.addEffect(heals.spotAnim, target.x, target.y, 0, 40, target.uid);
        }
        enemy.anim = "attack";
        enemy.animStart = tick;
        enemy.attackSeq = enemy.def.attackSeq;
        enemy.yaw = yawFromVector(target.x - enemy.x, target.y - enemy.y);
    }

    // The most hurt enemy a healer heals within its reach
    private findHealTarget(enemy: Enemy, heals: EnemyHealsDef): Enemy | undefined {
        let best: Enemy | undefined;
        let bestFraction = 1;
        for (const other of this.enemies) {
            const fraction = hurtFraction(other);
            if (fraction < bestFraction && this.canHeal(enemy, heals, other)) {
                best = other;
                bestFraction = fraction;
            }
        }
        return best;
    }

    // Whether a healer would go and heal this enemy: one it heals (checked
    // again as it goes, as a boss can get back up as a form it doesn't heal),
    // within its seek, and close enough to the player that the healer isn't
    // brought back to them on the way (RELOCATE_DISTANCE), which would have
    // it going back and forth
    private canHeal(enemy: Enemy, heals: EnemyHealsDef, other: Enemy): boolean {
        if (
            other === enemy ||
            other.dead ||
            !(heals.targets ? heals.targets.includes(other.def.id) : other.boss)
        ) {
            return false;
        }
        const seek = heals.seek ?? HEAL_SEEK;
        const player = this.player;
        return (
            fm.hypot(other.x - enemy.x, other.y - enemy.y) <= seek + other.radius &&
            fm.hypot(other.x - player.x, other.y - player.y) + heals.range < RELOCATE_DISTANCE
        );
    }

    // Brings back the last enemy to die near a reviver, where it fell. False
    // if there's none.
    private revive(enemy: Enemy, revives: EnemyRevivesDef): boolean {
        const rangeSq = revives.range * revives.range;
        for (let i = this.deaths.length - 1; i >= 0; i--) {
            const death = this.deaths[i];
            if (this.tick - death.tick > REVIVE_MAX_AGE) {
                // The rest are older still
                break;
            }
            const dx = death.x - enemy.x;
            const dy = death.y - enemy.y;
            if (dx * dx + dy * dy > rangeSq || !this.canTurnUpAt(death.def, death.x, death.y)) {
                continue;
            }
            this.deaths.splice(i, 1);
            const risen = this.spawnEnemy(death.def, "normal", { x: death.x, y: death.y });
            if (!risen) {
                continue;
            }
            risen.variant = death.variant;
            risen.noDrops = true;
            risen.hp = Math.max(1, Math.round(risen.maxHp * (revives.hp ?? 1)));
            if (revives.spotAnim !== undefined) {
                this.addEffect(revives.spotAnim, risen.x, risen.y, 0, 60);
            }
            enemy.anim = "attack";
            enemy.animStart = this.tick;
            enemy.attackSeq = revives.seq ?? enemy.def.attackSeq;
            enemy.yaw = yawFromVector(dx, dy);
            return true;
        }
        return false;
    }

    // Digging in (or blinking) and coming up by the player: it winds up
    // standing still, then it's there. True on the tick it lands.
    private stepBlink(
        enemy: Enemy,
        abilities: EnemyAbilities,
        blinks: EnemyBlinksDef,
        distance: number,
    ): boolean {
        const tick = this.tick;
        if (abilities.blinkLand === -1) {
            if (
                tick < abilities.nextBlink ||
                distance < blinks.minRange ||
                tick < (this.blinkGapEnd.get(enemy.def.id) ?? 0)
            ) {
                return false;
            }
            if (blinks.gap !== undefined) {
                this.blinkGapEnd.set(enemy.def.id, tick + secondsToTicks(blinks.gap));
            }
            abilities.blinkLand = tick + secondsToTicks(blinks.windup ?? 0);
            enemy.anim = "attack";
            enemy.animStart = tick;
            enemy.attackSeq = blinks.seq ?? enemy.def.attackSeq;
            if (blinks.castSpotAnim !== undefined) {
                this.addEffect(blinks.castSpotAnim, enemy.x, enemy.y, 0, 60);
            }
            if (blinks.sound !== undefined) {
                this.emit({
                    type: "bossAttack",
                    enemyId: enemy.def.id,
                    sound: blinks.sound,
                    x: enemy.x,
                    y: enemy.y,
                });
            }
        }
        if (tick < abilities.blinkLand) {
            return false;
        }
        abilities.blinkLand = -1;
        abilities.nextBlink = tick + secondsToTicks(blinks.interval);
        enemy.anim = "walk";
        enemy.animStart = tick;
        const player = this.player;
        const spot = this.findSpotNear(player.x, player.y, blinks.distance, enemy.radius);
        if (!spot) {
            return false;
        }
        enemy.x = enemy.prevX = spot.x;
        enemy.y = enemy.prevY = spot.y;
        enemy.vx = enemy.vy = 0;
        enemy.yaw = yawFromVector(player.x - spot.x, player.y - spot.y);
        if (blinks.impactSpotAnim !== undefined) {
            this.addEffect(blinks.impactSpotAnim, spot.x, spot.y, 0, 60);
        }
        if (blinks.surface) {
            enemy.risingEnd = tick + secondsToTicks(blinks.surface.seconds);
            enemy.anim = "attack";
            enemy.attackSeq = blinks.surface.seq;
            if (blinks.sound !== undefined) {
                this.events.push({
                    type: "bossAttack",
                    enemyId: enemy.def.id,
                    sound: blinks.sound,
                    x: spot.x,
                    y: spot.y,
                });
            }
        }
        return true;
    }

    // A free spot about distance tiles from (x, y) that the player can get
    // to, undefined if a few tries find none
    private findSpotNear(
        x: number,
        y: number,
        distance: number,
        radius: number,
    ): { x: number; y: number } | undefined {
        for (let attempt = 0; attempt < 12; attempt++) {
            const angle = this.rng.range(0, Math.PI * 2);
            const spotX = x + fm.cos(angle) * distance;
            const spotY = y + fm.sin(angle) * distance;
            const tileX = Math.floor(spotX);
            const tileY = Math.floor(spotY);
            if (
                this.grid.contains(tileX, tileY) &&
                this.flowField.isReachable(tileX, tileY) &&
                isCircleFree(this.grid, spotX, spotY, radius)
            ) {
                return { x: spotX, y: spotY };
            }
        }
        return undefined;
    }

    private dropShield(enemy: Enemy): void {
        enemy.shieldEnd = 0;
        const message = enemy.def.shield?.message;
        if (message) {
            this.emit({ type: "notice", message });
        }
    }

    // A hit a shield took: a blocked hitsplat now and then
    private showBlocked(enemy: Enemy): void {
        if (this.tick - enemy.blockedTick < BLOCKED_SPLAT_TICKS) {
            return;
        }
        enemy.blockedTick = this.tick;
        this.emit({
            type: "damage",
            x: enemy.x,
            y: enemy.y,
            amount: 0,
            enemyUid: enemy.uid,
            enemyId: enemy.def.id,
            blocked: true,
        });
    }

    // ---- Glyphs ----

    private addGlyph(boss: Enemy, look: EnemyDef): void {
        const player = this.player;
        let dirX = player.x - boss.x;
        let dirY = player.y - boss.y;
        const length = fm.hypot(dirX, dirY);
        if (length > 0.001) {
            dirX /= length;
            dirY /= length;
        } else {
            dirX = 0;
            dirY = -1;
        }
        const glyph: Glyph = {
            uid: this.nextUid++,
            bossUid: boss.uid,
            look,
            x: boss.x,
            y: boss.y,
            prevX: boss.x,
            prevY: boss.y,
            dirX,
            dirY,
            acrossX: -dirY,
            acrossY: dirX,
            startTick: this.tick,
        };
        this.placeGlyph(glyph, boss);
        glyph.prevX = glyph.x;
        glyph.prevY = glyph.y;
        this.glyphs.push(glyph);
    }

    // Glyphs slide along their lines, and go with their bosses
    private stepGlyphs(): void {
        if (this.glyphs.length === 0) {
            return;
        }
        this.glyphs = this.glyphs.filter((glyph) => {
            const boss = this.enemies.find((e) => e.uid === glyph.bossUid);
            if (!boss || boss.dead || !boss.def.boss?.glyph) {
                return false;
            }
            glyph.prevX = glyph.x;
            glyph.prevY = glyph.y;
            this.placeGlyph(glyph, boss);
            return true;
        });
    }

    // Back and forth along its line at a steady speed, from the middle
    private placeGlyph(glyph: Glyph, boss: Enemy): void {
        const def = boss.def.boss!.glyph!;
        const travel = ((this.tick - glyph.startTick) / TICKS_PER_SECOND) * def.speed;
        const along = pingPong(travel, def.halfLength);
        glyph.x = boss.x + glyph.dirX * def.distance + glyph.acrossX * along;
        glyph.y = boss.y + glyph.dirY * def.distance + glyph.acrossY * along;
    }

    // Whether a boss's glyph is between it and (x, y)
    glyphBlocks(boss: Enemy, x: number, y: number): boolean {
        const def = boss.def.boss?.glyph;
        const glyph = def && this.glyphs.find((g) => g.bossUid === boss.uid);
        if (!glyph) {
            return false;
        }
        const vx = x - boss.x;
        const vy = y - boss.y;
        const lengthSq = vx * vx + vy * vy;
        if (lengthSq < 1e-6) {
            return false;
        }
        const t = ((glyph.x - boss.x) * vx + (glyph.y - boss.y) * vy) / lengthSq;
        if (t <= 0 || t >= 1) {
            return false;
        }
        return fm.hypot(boss.x + vx * t - glyph.x, boss.y + vy * t - glyph.y) <= def.width;
    }

    // ---- Boss fights: entrances, phases, patterns ----

    // The square a boss's fight goes by: the map's if it names one, or all of it
    get bossArena(): { minX: number; minY: number; maxX: number; maxY: number } {
        const square = this.map.bossArena;
        if (square) {
            return {
                minX: square.baseX,
                minY: square.baseY,
                maxX: square.baseX + square.size,
                maxY: square.baseY + square.size,
            };
        }
        const grid = this.grid;
        return {
            minX: grid.baseX,
            minY: grid.baseY,
            maxX: grid.baseX + grid.sizeX,
            maxY: grid.baseY + grid.sizeY,
        };
    }

    // The player's safe and everything runs for it (BossDef.intro); the boss
    // comes up partway through
    startIntro(def: EnemyDef, type: "boss" | "finalBoss", hp?: number): void {
        const intro = def.boss!.intro!;
        const startTick = this.tick;
        const endTick = startTick + secondsToTicks(intro.seconds);
        this.intro = {
            def,
            type,
            hp,
            startTick,
            riseTick: startTick + secondsToTicks(intro.riseAt),
            endTick,
        };
        for (const enemy of this.enemies) {
            if (!enemy.dead) {
                this.sendOff(enemy, endTick - LEAVE_MARGIN_TICKS);
            }
        }
        this.clearBossAttacks();
        this.enemyProjectiles = [];
        this.funBossGroup = [];
        this.emit({ type: "bossIntro", enemyId: def.id, sound: intro.darkSound ?? -1 });
    }

    // Off to the nearest edge of the map. It can't be hit, and it's gone by
    // lastTick however far that is.
    private sendOff(enemy: Enemy, lastTick: number): void {
        const { x, y } = enemy;
        const grid = this.grid;
        const west = x - grid.baseX;
        const east = grid.baseX + grid.sizeX - x;
        const south = y - grid.baseY;
        const north = grid.baseY + grid.sizeY - y;
        const distance = Math.min(west, east, south, north);
        const stays = enemy.def.stationary ?? false;
        const ticks = Math.max(1, lastTick - this.tick);
        const speed = stays
            ? 0
            : Math.min(
                  LEAVE_MAX_SPEED / TICKS_PER_SECOND,
                  Math.max(distance / ticks, enemy.speed * LEAVE_MIN_SCALE),
              );
        const dirX = distance === west ? -1 : distance === east ? 1 : 0;
        const dirY = dirX !== 0 ? 0 : distance === south ? -1 : 1;
        enemy.leaving = {
            vx: dirX * speed,
            vy: dirY * speed,
            startTick: this.tick,
            endTick: stays ? lastTick : Math.min(lastTick, this.tick + Math.ceil(distance / speed)),
        };
        // Whatever it was doing, it's stopped
        enemy.shieldEnd = Infinity;
        enemy.jump = undefined;
        enemy.frozen = 0;
        enemy.vx = enemy.vy = 0;
        enemy.anim = "walk";
        enemy.animStart = this.tick;
        enemy.yaw = yawFromVector(dirX, dirY);
        if (enemy.bossState) {
            enemy.bossState.windup = undefined;
            enemy.bossState.surge = undefined;
        }
    }

    // Straight there: through whatever's in the way, as nothing's looking
    private stepLeaving(enemy: Enemy, leaving: EnemyLeaving): void {
        enemy.x += leaving.vx;
        enemy.y += leaving.vy;
        if (this.tick >= leaving.endTick) {
            this.vanish(enemy);
        }
    }

    // Gone with no death, no drop and nothing counted
    private vanish(enemy: Enemy): void {
        enemy.dead = true;
        enemy.deathTick = -Infinity;
    }

    private stepIntro(): void {
        const intro = this.intro;
        if (!intro) {
            return;
        }
        if (this.tick >= intro.riseTick && !intro.boss) {
            this.riseBoss(intro);
        }
        if (this.tick >= intro.endTick) {
            this.intro = undefined;
        }
    }

    // Up it comes beside the player, on the arena's side of them, so it's on the
    // screen wherever they are
    private riseBoss(intro: BossIntro): void {
        const def = intro.def;
        const rise = def.boss!.intro!;
        // Co-op: beside one of the party
        this.useSpawnHero();
        const player = this.player;
        const arena = this.bossArena;
        // A fight in a set square starts in the middle of it, under the dark,
        // a party side by side north to south
        if (this.map.bossArena) {
            const up = this.heroes.filter((hero) => this.heroes.length === 1 || this.isUp(hero));
            up.forEach((hero, i) => {
                const one = hero.player;
                one.x = one.prevX = (arena.minX + arena.maxX) / 2;
                one.y = one.prevY = (arena.minY + arena.maxY) / 2 + (i - (up.length - 1) / 2) * 1.5;
            });
        }
        // East or west, as the screen's wider than it's tall and she's tall
        // herself: north of the player, she'd be off the top of it
        const x = player.x + (player.x > (arena.minX + arena.maxX) / 2 ? -1 : 1) * rise.distance;
        const y = player.y;
        const at = this.canTurnUpAt(def, x, y)
            ? { x, y }
            : (this.findSpotNear(player.x, player.y, rise.distance, def.radius) ??
              findFreeSpot(this.grid, x, y, def.radius));
        const boss = this.spawnBoss(def, intro.type, intro.hp, at);
        if (!boss) {
            return;
        }
        intro.boss = boss;
        boss.risingEnd = intro.endTick;
        boss.shieldEnd = intro.endTick;
        boss.anim = "attack";
        boss.attackSeq = rise.seq ?? def.idleSeq;
        boss.animStart = this.tick;
        boss.yaw = yawFromVector(player.x - boss.x, player.y - boss.y);
        boss.attackCooldown = intro.endTick - this.tick + TICKS_PER_SECOND;
        if (rise.spotAnim !== undefined) {
            this.addEffect(rise.spotAnim, boss.x, boss.y, 0, intro.endTick - this.tick);
        }
        if (rise.alone) {
            this.aloneWith = boss;
        }
        this.emit({
            type: "bossRising",
            enemyId: def.id,
            sound: rise.sound ?? -1,
            x: boss.x,
            y: boss.y,
        });
    }

    // Its first shield, and its totems standing idle in the corners
    private startPhases(boss: Enemy, phases: BossPhasesDef): void {
        const shieldMax = Math.round(boss.maxHp * phases.phases[0].shield);
        const totems: Enemy[] = [];
        const arena = this.bossArena;
        const margin = phases.totems.margin;
        const idle = getEnemy(phases.totems.idleId);
        const charge = Math.max(1, Math.round(boss.maxHp * phases.totems.charge));
        for (const x of [arena.minX + margin, arena.maxX - margin]) {
            for (const y of [arena.minY + margin, arena.maxY - margin]) {
                // Where the player can get to, whatever's in that corner
                const spot = findFreeSpot(this.grid, x, y, PLAYER_RADIUS, (tileX, tileY) =>
                    this.isWalkableTile(tileX, tileY),
                );
                const totem = this.spawnEnemy(idle, "normal", spot);
                if (totem) {
                    totem.totemOf = boss;
                    totem.hp = totem.maxHp = charge;
                    totem.xp = 0;
                    totem.noDrops = true;
                    totem.shieldEnd = Infinity;
                    totems.push(totem);
                }
            }
        }
        boss.bossState!.phase = { index: 0, stage: "shield", shield: shieldMax, shieldMax, totems };
    }

    // Down comes the shield: nothing can touch it now, and the totems wake
    private breakShield(boss: Enemy, phase: BossPhase): void {
        const phases = boss.def.boss!.phases!;
        phase.stage = "totems";
        phase.shield = 0;
        boss.shieldEnd = Infinity;
        const charging = getEnemy(phases.totems.chargingId);
        for (const totem of phase.totems) {
            totem.def = charging;
            totem.hp = totem.maxHp;
            totem.shieldEnd = 0;
        }
        this.pushStage(boss, phase, phases.shieldMessage);
    }

    private totemCharged(totem: Enemy, boss: Enemy): void {
        const phase = boss.bossState?.phase;
        const phases = boss.def.boss?.phases;
        if (!phase || !phases) {
            return;
        }
        totem.hp = 0;
        totem.def = getEnemy(phases.totems.chargedId);
        totem.shieldEnd = Infinity;
        this.emit({
            type: "bossAttack",
            enemyId: boss.def.id,
            sound: phases.totems.chargedSound ?? -1,
            x: totem.x,
            y: totem.y,
        });
        if (phase.totems.every((t) => t.hp <= 0)) {
            this.totemsBlast(boss, phase, phases);
        }
    }

    // All four charged: they take a share of its hitpoints, the last of it
    // with the last blast, and otherwise it's on to the next phase
    private totemsBlast(boss: Enemy, phase: BossPhase, phases: BossPhasesDef): void {
        const totemsDef = phases.totems;
        for (const totem of phase.totems) {
            this.emit({
                type: "totemBlast",
                sound: totemsDef.blastSound ?? -1,
                x: totem.x,
                y: totem.y,
                toX: boss.x,
                toY: boss.y,
            });
        }
        if (totemsDef.blastSpotAnim !== undefined) {
            this.addEffect(totemsDef.blastSpotAnim, boss.x, boss.y, 0, 60, boss.uid);
        }
        // There's no food in a fight this long with nothing else in it
        this.forEachHeroInReach(() =>
            this.heal(Math.round(this.player.maxHp * (phases.blastHeal ?? 0))),
        );
        const next = phases.phases[phase.index + 1];
        if (!next) {
            boss.shieldEnd = 0;
            boss.bossState!.windup = undefined;
            this.killEnemy(boss);
            return;
        }
        boss.hp -= Math.round(boss.maxHp / phases.phases.length);
        phase.index++;
        phase.stage = "shield";
        phase.shieldMax = phase.shield = Math.round(boss.maxHp * next.shield);
        phase.opener = next.opener
            ? boss.def.boss!.attacks.find((a) => a.name === next.opener)
            : undefined;
        boss.shieldEnd = 0;
        const idle = getEnemy(totemsDef.idleId);
        for (const totem of phase.totems) {
            totem.def = idle;
            totem.hp = totem.maxHp;
            totem.shieldEnd = Infinity;
        }
        this.quarters = undefined;
        this.pushStage(boss, phase, phases.blastMessage);
    }

    private pushStage(boss: Enemy, phase: BossPhase, message: string): void {
        this.emit({
            type: "bossStage",
            enemyId: boss.def.id,
            phase: phase.index + 1,
            stage: phase.stage,
            message,
            x: boss.x,
            y: boss.y,
        });
    }

    // With the boss gone, so is all it had going
    private endBossFight(boss: Enemy): void {
        const state = boss.bossState;
        if (!state?.phase) {
            return;
        }
        for (const enemy of this.enemies) {
            if (!enemy.dead && (enemy.totemOf === boss || enemy.walksTo === boss)) {
                this.vanish(enemy);
            }
        }
        this.clearBossAttacks();
    }

    // Everything a boss had in the air and on the ground, and on the players
    private clearBossAttacks(): void {
        this.bullets.clear();
        this.emitters = [];
        this.hazards = [];
        this.quarters = undefined;
        const current = this.hero;
        for (const hero of this.heroes) {
            this.use(hero);
            this.parasite = undefined;
            this.hold = undefined;
            if (this.curse) {
                this.curse = undefined;
                this.emit({ type: "playerCursed", cursed: false });
            }
        }
        this.use(current);
    }

    // A fight across a big arena stays on the screen
    private leashBoss(
        enemy: Enemy,
        leash: NonNullable<NonNullable<EnemyDef["boss"]>["leash"]>,
    ): void {
        const player = this.player;
        const spot = this.findSpotNear(player.x, player.y, leash.keep, enemy.radius);
        if (!spot) {
            return;
        }
        if (leash.spotAnim !== undefined) {
            this.addEffect(leash.spotAnim, enemy.x, enemy.y, 0, 40);
            this.addEffect(leash.spotAnim, spot.x, spot.y, 0, 40);
        }
        enemy.x = enemy.prevX = spot.x;
        enemy.y = enemy.prevY = spot.y;
        enemy.vx = enemy.vy = 0;
    }

    // Whether the player's in a cone swing's wedge, or right under the boss
    private inCone(enemy: Enemy, windup: BossWindup, attack: BossAttackDef, cone: number): boolean {
        const player = this.player;
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distance = fm.hypot(dx, dy);
        if (distance <= (attack.underRadius ?? 0) + player.radius) {
            return true;
        }
        if (distance < 0.001) {
            return true;
        }
        const along = (dx * windup.dirX + dy * windup.dirY) / distance;
        return along >= fm.cos(cone / 2);
    }

    // The marks of a ground attack, there from now until they land
    private markGround(enemy: Enemy, attack: BossAttackDef, landTick: number): void {
        const ground = attack.ground;
        if (!ground) {
            return;
        }
        const player = this.player;
        const damage = attack.damage > 0 ? this.getBossDamage(enemy, attack) : 0;
        const armed = ground.armed !== undefined;
        const add = (x: number, y: number) => {
            this.hazards.push({
                uid: this.nextUid++,
                enemyUid: enemy.uid,
                attack,
                x,
                y,
                radius: ground.radius,
                damage,
                startTick: this.tick,
                landTick,
                endTick: armed ? landTick + secondsToTicks(ground.armed!) : landTick,
                armed,
                fuseTick: -1,
            });
        };
        for (const spots of ground.spots) {
            switch (spots.shape) {
                case "under":
                    add(enemy.x, enemy.y);
                    break;
                case "player":
                    add(player.x, player.y);
                    break;
                case "ring":
                    for (let i = 0; i < spots.count; i++) {
                        const angle = (i / spots.count) * Math.PI * 2;
                        add(
                            enemy.x + fm.cos(angle) * spots.distance,
                            enemy.y + fm.sin(angle) * spots.distance,
                        );
                    }
                    break;
                case "grid": {
                    const half = (spots.size - 1) / 2;
                    for (let i = 0; i < spots.size; i++) {
                        for (let j = 0; j < spots.size; j++) {
                            add(
                                player.x + (i - half) * spots.spacing,
                                player.y + (j - half) * spots.spacing,
                            );
                        }
                    }
                    break;
                }
                case "scatter":
                    for (let i = 0; i < spots.count; i++) {
                        const angle = this.rng.range(0, Math.PI * 2);
                        const distance = this.rng.range(1, spots.spread);
                        add(
                            player.x + fm.cos(angle) * distance,
                            player.y + fm.sin(angle) * distance,
                        );
                    }
                    break;
            }
        }
    }

    // The lines cross close enough to the player that the safe quarter's
    // always in reach, wherever in the arena they are
    private growQuarters(enemy: Enemy, attack: BossAttackDef, hurtTick: number): void {
        const quarters = attack.quarters;
        if (!quarters) {
            return;
        }
        const middle = this.partyMiddle();
        const arena = this.bossArena;
        const margin = quarters.offset * 2;
        const offset = () => this.rng.range(-quarters.offset, quarters.offset);
        const clamp = (value: number, min: number, max: number) =>
            Math.min(Math.max(value, min + margin), max - margin);
        const x = clamp(middle.x + offset(), arena.minX, arena.maxX);
        const y = clamp(middle.y + offset(), arena.minY, arena.maxY);
        this.quarters = {
            enemyUid: enemy.uid,
            attack,
            x,
            y,
            safe: this.rng.int(4),
            damage: this.getBossDamage(enemy, attack),
            startTick: this.tick,
            hurtTick,
            endTick: hurtTick + secondsToTicks(quarters.seconds),
            nextHurt: hurtTick,
        };
    }

    // She goes to the edge at once and stands there: the lane's on the ground
    // from now until she's gone by, in line with where the player is, so
    // there's something to step out of
    private pickLane(enemy: Enemy, attack: BossAttackDef): SurgeLane {
        const player = this.player;
        const arena = this.bossArena;
        const margin = enemy.radius + 1;
        const edge = this.rng.int(4);
        const minX = arena.minX + margin;
        const maxX = arena.maxX - margin;
        const minY = arena.minY + margin;
        const maxY = arena.maxY - margin;
        const px = Math.min(Math.max(player.x, minX), maxX);
        const py = Math.min(Math.max(player.y, minY), maxY);
        const lane: SurgeLane = {
            fromX: edge === 0 ? minX : edge === 1 ? maxX : px,
            fromY: edge === 2 ? minY : edge === 3 ? maxY : py,
            toX: edge === 0 ? maxX : edge === 1 ? minX : px,
            toY: edge === 2 ? maxY : edge === 3 ? minY : py,
            halfWidth: attack.radius ?? 2.5,
        };
        if (attack.castSpotAnim !== undefined) {
            this.addEffect(attack.castSpotAnim, enemy.x, enemy.y, 0, 40);
        }
        enemy.x = enemy.prevX = lane.fromX;
        enemy.y = enemy.prevY = lane.fromY;
        enemy.vx = enemy.vy = 0;
        enemy.yaw = yawFromVector(lane.toX - lane.fromX, lane.toY - lane.fromY);
        return lane;
    }

    private startSurge(enemy: Enemy, attack: BossAttackDef, lane: SurgeLane): void {
        const length = fm.hypot(lane.toX - lane.fromX, lane.toY - lane.fromY);
        const speed = attack.speed ?? 24;
        enemy.bossState!.surge = {
            attack,
            lane,
            startTick: this.tick,
            endTick: this.tick + Math.max(1, Math.ceil((length / speed) * TICKS_PER_SECOND)),
            hit: [],
        };
        enemy.anim = "attack";
        enemy.animStart = this.tick;
        enemy.attackSeq = enemy.def.boss?.surgeSeq ?? enemy.attackSeq;
    }

    // Down the lane at a steady speed, through anything
    private stepSurge(enemy: Enemy, surge: BossSurge): void {
        const { lane, attack } = surge;
        const span = surge.endTick - surge.startTick;
        const f = Math.min(1, (this.tick - surge.startTick) / span);
        const dx = lane.toX - lane.fromX;
        const dy = lane.toY - lane.fromY;
        enemy.x = lane.fromX + dx * f;
        enemy.y = lane.fromY + dy * f;
        // Through each of them once
        this.forEachHeroInReach(() => {
            const player = this.player;
            if (surge.hit.includes(this.hero.index) || this.runOver) {
                return;
            }
            const length = Math.max(0.001, fm.hypot(dx, dy));
            const px = player.x - enemy.x;
            const py = player.y - enemy.y;
            const along = (px * dx + py * dy) / length;
            const across = (px * dy - py * dx) / length;
            if (
                Math.abs(across) <= lane.halfWidth + player.radius &&
                Math.abs(along) <= SURGE_BODY + player.radius
            ) {
                surge.hit.push(this.hero.index);
                this.bossHit(enemy.def.id, enemy, attack, this.getBossDamage(enemy, attack));
            }
        });
        if (f >= 1) {
            enemy.bossState!.surge = undefined;
            const spot = findFreeSpot(this.grid, enemy.x, enemy.y, enemy.radius);
            enemy.x = spot.x;
            enemy.y = spot.y;
            enemy.anim = "walk";
            enemy.animStart = this.tick;
        }
    }

    private markPlayer(enemy: Enemy, attack: BossAttackDef): void {
        const parasite = attack.parasite;
        if (parasite) {
            if (!this.parasite) {
                this.parasite = {
                    enemyUid: enemy.uid,
                    attack,
                    damage: this.getBossDamage(enemy, attack),
                    startTick: this.tick,
                    burstTick: this.tick + secondsToTicks(parasite.seconds),
                };
            }
            return;
        }
        if (attack.effect) {
            this.applyPlayerEffect(attack.effect, enemy);
        }
    }

    private startPattern(enemy: Enemy, attack: BossAttackDef, windup: BossWindup): void {
        const pattern = attack.pattern;
        if (!pattern) {
            return;
        }
        let source = this.bulletSources.findIndex((s) => s.attack === attack && s.enemy === enemy);
        if (source === -1) {
            source = this.bulletSources.push({ attack, enemy }) - 1;
        }
        const aimed = pattern.shape === "spread";
        this.emitters.push({
            enemyUid: enemy.uid,
            attack,
            source,
            nextTick: this.tick,
            volleysLeft: pattern.volleys,
            angle: aimed ? fm.atan2(windup.dirY, windup.dirX) : this.rng.range(0, Math.PI * 2),
            damage: this.getBossDamage(enemy, attack),
        });
        enemy.bossState!.channelEnd =
            this.tick + secondsToTicks(pattern.volleys * pattern.interval);
    }

    private fireVolley(emitter: BulletEmitter, boss: Enemy): void {
        const pattern = emitter.attack.pattern!;
        const speed = pattern.speed / TICKS_PER_SECOND;
        const life = Math.ceil(pattern.range / speed);
        const turn = (pattern.curve ?? 0) / TICKS_PER_SECOND;
        const count = pattern.count;
        const spread = pattern.shape === "spread";
        const step = spread ? (pattern.arc ?? 1) / Math.max(1, count - 1) : (Math.PI * 2) / count;
        const first = spread ? emitter.angle - (pattern.arc ?? 1) / 2 : emitter.angle;
        for (let i = 0; i < count; i++) {
            const angle = first + i * step;
            this.bullets.add(
                boss.x,
                boss.y,
                fm.cos(angle) * speed,
                fm.sin(angle) * speed,
                turn,
                pattern.radius,
                emitter.damage,
                life,
                emitter.source,
                this.tick,
            );
        }
        emitter.angle += pattern.turn ?? 0;
    }

    private stepBossFight(): void {
        if (this.runOver) {
            return;
        }
        this.stepHold();
        this.stepEmitters();
        this.stepBullets();
        if (this.runOver) {
            return;
        }
        this.stepHazards();
        if (this.runOver) {
            return;
        }
        this.stepQuarters();
        if (this.runOver) {
            return;
        }
        this.stepParasite();
    }

    private stepHold(): void {
        this.forEachHeroInReach(() => {
            const hold = this.hold;
            if (!hold) {
                return;
            }
            if (this.tick >= hold.endTick || hold.enemies.every((enemy) => enemy.dead)) {
                this.hold = undefined;
                return;
            }
            this.player.frozen = Math.max(this.player.frozen, 2);
        });
    }

    private stepEmitters(): void {
        const emitters = this.emitters;
        if (emitters.length === 0) {
            return;
        }
        let spent = false;
        for (const emitter of emitters) {
            if (this.tick < emitter.nextTick) {
                continue;
            }
            const boss = this.enemies.find((e) => e.uid === emitter.enemyUid);
            if (!boss || boss.dead) {
                emitter.volleysLeft = 0;
                spent = true;
                continue;
            }
            this.fireVolley(emitter, boss);
            emitter.volleysLeft--;
            emitter.nextTick = this.tick + secondsToTicks(emitter.attack.pattern!.interval);
            spent ||= emitter.volleysLeft <= 0;
        }
        if (spent) {
            this.emitters = emitters.filter((emitter) => emitter.volleysLeft > 0);
        }
    }

    private stepBullets(): void {
        const bullets = this.bullets;
        if (bullets.count === 0) {
            return;
        }
        // Each hero by index, one out of reach (down, or gone) spared
        const targets = this.bulletTargets;
        for (const hero of this.heroes) {
            (targets[hero.index] ??= { x: 0, y: 0, radius: 0, spare: true }).spare = true;
        }
        this.forEachHeroInReach(() => {
            const player = this.player;
            const target = targets[this.hero.index];
            target.x = player.x;
            target.y = player.y;
            target.radius = player.radius;
            target.spare = this.tick < this.bulletGraceEnd || this.reviving;
        });
        bullets.step(targets);
        const current = this.hero;
        bullets.hits.forEach((hit, i) => {
            if (hit === -1 || this.runOver) {
                return;
            }
            this.use(this.heroes[i]);
            const { attack, enemy } = this.bulletSources[bullets.source[hit]];
            this.bulletGraceEnd = this.tick + BULLET_GRACE_TICKS;
            this.bossHit(enemy.def.id, enemy, attack, bullets.damage[hit]);
        });
        this.use(current);
    }

    private stepHazards(): void {
        const hazards = this.hazards;
        if (hazards.length === 0) {
            return;
        }
        const tick = this.tick;
        let spent = false;
        // However many land on someone, it's the one hit (by hero)
        const landed: boolean[] = [];
        for (const hazard of hazards) {
            if (hazard.armed && hazard.fuseTick === -1) {
                // Waiting to be walked into, by anyone, until it gives up
                if (tick >= hazard.endTick) {
                    hazard.endTick = -1;
                    spent = true;
                } else if (tick >= hazard.landTick) {
                    let walkedInto = false;
                    this.forEachHeroInReach(() => {
                        const player = this.player;
                        walkedInto ||=
                            fm.hypot(player.x - hazard.x, player.y - hazard.y) <=
                            hazard.radius + player.radius;
                    });
                    if (walkedInto) {
                        hazard.fuseTick = tick + HAZARD_FUSE_TICKS;
                    }
                }
                continue;
            }
            if (tick < (hazard.armed ? hazard.fuseTick : hazard.landTick)) {
                continue;
            }
            hazard.endTick = -1;
            spent = true;
            this.landHazard(hazard, landed);
            if (this.runOver) {
                return;
            }
        }
        if (spent) {
            this.hazards = this.hazards.filter((hazard) => hazard.endTick !== -1);
        }
    }

    // landed: the heroes something's landed on this tick, by index, who it
    // passes by; it adds whoever it hits
    private landHazard(hazard: GroundHazard, landed: boolean[]): void {
        const { attack, x, y, radius } = hazard;
        if (attack.impactSpotAnim !== undefined) {
            this.addEffect(attack.impactSpotAnim, x, y, 0, 40);
        } else if (!attack.ground?.spotAnim) {
            this.emit({ type: "bossSwing", x, y, radius });
        }
        this.forEachHeroInReach(() => {
            const player = this.player;
            const index = this.hero.index;
            if (
                this.runOver ||
                fm.hypot(player.x - x, player.y - y) > radius + player.radius ||
                landed[index]
            ) {
                return;
            }
            landed[index] = true;
            const enemy = this.enemies.find((e) => e.uid === hazard.enemyUid);
            if (hazard.damage > 0) {
                this.bossHit(enemy?.def.id ?? "", enemy, attack, hazard.damage, false);
            } else if (attack.effect && !this.reviving) {
                this.applyPlayerEffect(attack.effect, enemy);
            }
        });
    }

    private stepQuarters(): void {
        const quarters = this.quarters;
        if (!quarters) {
            return;
        }
        const tick = this.tick;
        if (tick >= quarters.endTick) {
            this.quarters = undefined;
            return;
        }
        if (tick < quarters.nextHurt) {
            return;
        }
        const def = quarters.attack.quarters!;
        quarters.nextHurt = tick + secondsToTicks(def.interval);
        // Everyone outside the safe quarter is hit, and her shield's fed
        // once if anyone was
        const enemy = this.enemies.find((e) => e.uid === quarters.enemyUid);
        let fed = false;
        this.forEachHeroInReach(() => {
            const player = this.player;
            if (
                this.runOver ||
                quarterOf(quarters.x, quarters.y, player.x, player.y) === quarters.safe
            ) {
                return;
            }
            this.bossHit(enemy?.def.id ?? "", enemy, quarters.attack, quarters.damage, false);
            fed = true;
        });
        const phase = enemy?.bossState?.phase;
        if (fed && phase?.stage === "shield") {
            phase.shield = Math.min(
                phase.shieldMax,
                phase.shield + Math.round(phase.shieldMax * def.heal),
            );
        }
    }

    // Where the players still up are, on average (the player, on your own)
    private partyMiddle(): { x: number; y: number } {
        if (this.heroes.length === 1) {
            return this.player;
        }
        let x = 0;
        let y = 0;
        let count = 0;
        this.forEachHeroInReach(() => {
            x += this.player.x;
            y += this.player.y;
            count++;
        });
        return count > 0 ? { x: x / count, y: y / count } : this.player;
    }

    // Out it comes for a big hit, and stays to feed the boss. An antidote
    // weakens it first.
    private stepParasite(): void {
        this.forEachHeroInReach(() => {
            const parasite = this.parasite;
            if (!parasite || this.tick < parasite.burstTick || this.runOver) {
                return;
            }
            this.parasite = undefined;
            const def = parasite.attack.parasite!;
            const player = this.player;
            const boss = this.enemies.find((e) => e.uid === parasite.enemyUid);
            const weak = this.cured;
            const damage = parasite.damage * (weak ? 0.5 : 1);
            this.bossHit(boss?.def.id ?? "", boss, parasite.attack, damage);
            if (this.runOver) {
                return;
            }
            const out = this.spawnNear(
                player,
                getEnemy(weak ? def.weakEnemyId : def.enemyId),
                SUMMON_BESIDE,
                0,
                1,
                6,
            );
            if (out) {
                out.noDrops = true;
            }
        });
    }

    // Walking to the boss, through anything in its way
    private stepWalker(enemy: Enemy, boss: Enemy): void {
        if (boss.dead) {
            this.vanish(enemy);
            return;
        }
        if (enemy.frozen > 0) {
            enemy.frozen--;
            return;
        }
        const dx = boss.x - enemy.x;
        const dy = boss.y - enemy.y;
        const distance = fm.hypot(dx, dy);
        if (distance <= ABSORB_REACH) {
            const walkers = boss.bossState?.walkers;
            if (walkers) {
                walkers.absorbed++;
            }
            this.vanish(enemy);
            return;
        }
        enemy.x += (dx / distance) * enemy.speed;
        enemy.y += (dy / distance) * enemy.speed;
        enemy.yaw = yawFromVector(dx, dy);
    }

    // True while there's still some on their way. With the last of them gone
    // the boss lets out what it took in, which can't be dodged.
    private stepWalkers(boss: Enemy, walkers: BossWalkers): boolean {
        if (walkers.enemies.some((enemy) => !enemy.dead)) {
            return true;
        }
        boss.bossState!.walkers = undefined;
        const attack = walkers.attack;
        const damage = (attack.damage + walkers.absorbed * walkers.perAbsorbed) * boss.damageScale;
        this.emit({
            type: "bossAbsorbBlast",
            x: boss.x,
            y: boss.y,
            absorbed: walkers.absorbed,
        });
        // On the whole party
        this.forEachHeroInReach(() => this.bossHit(boss.def.id, boss, attack, damage));
        return false;
    }

    // ---- Bosses ----

    // Picks an attack once the last one is done (among those the player is in
    // range of), winds it up, then lands or fires it
    private stepBoss(enemy: Enemy, distance: number): void {
        const state = enemy.bossState!;
        const def = enemy.def.boss!;
        // A fight in phases gets harder by the phase instead
        const enrageAt = this.hard ? HARD_ENRAGE_AT : ENRAGE_AT;
        if (!def.phases && !state.enraged && enemy.hp <= enemy.maxHp * enrageAt) {
            this.enrage(enemy);
        }
        this.callSummons(enemy, false);
        this.stepStomp(enemy);
        for (let i = 0; i < state.cooldowns.length; i++) {
            if (state.cooldowns[i] > 0) {
                state.cooldowns[i]--;
            }
        }
        if (state.surge) {
            this.stepSurge(enemy, state.surge);
            return;
        }
        if (state.walkers && this.stepWalkers(enemy, state.walkers)) {
            return;
        }
        const windup = state.windup;
        if (windup) {
            if (this.tick >= windup.landTick) {
                state.windup = undefined;
                this.landBossAttack(enemy, windup);
            }
            return;
        }
        if (def.leash && distance > def.leash.distance) {
            this.leashBoss(enemy, def.leash);
        }
        // It holds off while the player can't move, and what's fired can land
        if (enemy.attackCooldown > 0 || this.hold || this.tick < state.channelEnd) {
            return;
        }
        const phase = state.phase;
        const opener = phase?.opener;
        if (opener) {
            phase.opener = undefined;
            this.startBossAttack(enemy, opener);
            return;
        }
        const usable: number[] = [];
        def.attacks.forEach((attack, i) => {
            if (
                state.cooldowns[i] === 0 &&
                distance <= attack.range &&
                distance >= (attack.minRange ?? 0) &&
                (!attack.enraged || state.enraged) &&
                (!attack.phases || !phase || attack.phases.includes(phase.index + 1)) &&
                !(attack.parasite && this.parasite)
            ) {
                usable.push(i);
            }
        });
        if (usable.length === 0) {
            return;
        }
        const index = usable[this.rng.weightedIndex(usable.map((i) => def.attacks[i].weight))];
        const attack = def.attacks[index];
        state.cooldowns[index] = Math.round(attack.cooldown * TICKS_PER_SECOND);
        this.startBossAttack(enemy, attack);
    }

    // Starts winding an attack up. Everything it'll do to the ground is on the
    // ground from now on.
    private startBossAttack(enemy: Enemy, attack: BossAttackDef): void {
        const state = enemy.bossState!;
        const def = enemy.def.boss!;
        const player = this.player;
        const startTick = this.tick;
        const landTick = startTick + Math.max(1, Math.round(attack.windup * TICKS_PER_SECOND));
        const toPlayer = Math.max(0.001, fm.hypot(player.x - enemy.x, player.y - enemy.y));
        const windup: BossWindup = {
            attack,
            startTick,
            landTick,
            targets: attack.kind === "blast" ? this.pickBlastTargets(attack) : [],
            dirX: (player.x - enemy.x) / toPlayer,
            dirY: (player.y - enemy.y) / toPlayer,
        };
        state.windup = windup;
        if (attack.kind === "ground") {
            this.markGround(enemy, attack, landTick);
        } else if (attack.kind === "quarters") {
            this.growQuarters(enemy, attack, landTick);
        } else if (attack.kind === "surge") {
            windup.lane = this.pickLane(enemy, attack);
        }
        const drowsy = this.tick < this.drowsyEndTick ? this.drowsyInterval : 1;
        const interval =
            def.attackInterval *
            (state.enraged ? ENRAGED_INTERVAL : 1) *
            (this.hard ? HARD_BOSS_INTERVAL : 1) *
            drowsy;
        enemy.attackCooldown = Math.round(interval * TICKS_PER_SECOND);
        enemy.anim = "attack";
        enemy.animStart = this.tick;
        enemy.attackSeq = attack.seq ?? enemy.def.attackSeq;
        if (attack.windupSound !== undefined) {
            this.emit({
                type: "bossAttack",
                enemyId: enemy.def.id,
                sound: attack.windupSound,
                x: enemy.x,
                y: enemy.y,
            });
        }
        // Each of its attacks wears a curse down, whoever's it is
        const current = this.hero;
        for (const hero of this.heroes) {
            if (hero.curse && --hero.curse.attacksLeft <= 0) {
                this.use(hero);
                this.curse = undefined;
                this.emit({ type: "playerCursed", cursed: false });
            }
        }
        this.use(current);
        if (attack.shout) {
            this.emit({ type: "bossShout", enemyUid: enemy.uid, text: attack.shout });
        }
        if (attack.message) {
            this.emit({ type: "notice", message: attack.message });
        }
    }

    // Below half its hitpoints a boss attacks and moves faster, and uses its
    // enraged attacks too
    private enrage(enemy: Enemy): void {
        const state = enemy.bossState!;
        const enrage = enemy.def.boss!.enrage;
        state.enraged = true;
        enemy.speed *= ENRAGED_SPEED;
        enemy.tint = ENRAGED_TINT;
        this.emit({
            type: "bossEnraged",
            enemyId: enemy.def.id,
            message: enrage.message,
            x: enemy.x,
            y: enemy.y,
        });
        if (enrage.shout) {
            this.emit({ type: "bossShout", enemyUid: enemy.uid, text: enrage.shout });
        }
    }

    // On the player, and the rest of a blast of several scattered around them
    private pickBlastTargets(attack: BossAttackDef): { x: number; y: number }[] {
        const player = this.player;
        const targets = [{ x: player.x, y: player.y }];
        for (let i = 1; i < (attack.count ?? 1); i++) {
            const angle = this.rng.range(0, Math.PI * 2);
            const distance = this.rng.range(1, Math.max(1, attack.spread ?? 2));
            targets.push({
                x: player.x + fm.cos(angle) * distance,
                y: player.y + fm.sin(angle) * distance,
            });
        }
        return targets;
    }

    // Dharok's hits grow as his hitpoints drop; harder maps hit harder
    private getBossDamage(enemy: Enemy, attack: BossAttackDef): number {
        const wretched = enemy.def.boss?.wretched ?? 0;
        return attack.damage * enemy.damageScale * (1 + wretched * (1 - enemy.hp / enemy.maxHp));
    }

    private landBossAttack(enemy: Enemy, windup: BossWindup): void {
        const attack = windup.attack;
        this.emit({
            type: "bossAttack",
            enemyId: enemy.def.id,
            sound: attack.sound ?? -1,
            x: enemy.x,
            y: enemy.y,
        });
        this.landBlastExtras(enemy, windup);
        if (attack.kind === "swing" || attack.kind === "blast") {
            // A swing hits around the boss, a blast where the player was (and
            // around there); the player is hit once however many land on them
            const spots = attack.kind === "swing" ? [{ x: enemy.x, y: enemy.y }] : windup.targets;
            if (attack.leap) {
                this.leapTo(enemy, spots[0]);
            }
            const radius = attack.radius ?? 2;
            for (const { x, y } of spots) {
                this.emit({ type: "bossSwing", x, y, radius });
                if (attack.kind === "blast" && attack.impactSpotAnim !== undefined) {
                    this.addEffect(attack.impactSpotAnim, x, y, 0, 40);
                }
            }
            // Co-op: on anyone it lands on
            this.forEachHeroInReach(() => {
                const player = this.player;
                let hit = spots.some(
                    ({ x, y }) => fm.hypot(player.x - x, player.y - y) <= radius + player.radius,
                );
                if (hit && attack.cone !== undefined) {
                    hit = this.inCone(enemy, windup, attack, attack.cone);
                }
                if (hit && attack.blockable && this.glyphBlocks(enemy, player.x, player.y)) {
                    // Behind the glyph: it takes the blow
                    hit = false;
                    this.glyphBlocked(enemy, attack);
                }
                if (hit && !this.runOver) {
                    // A blast's impact is already showing where it landed
                    const damage = this.getBossDamage(enemy, attack);
                    this.bossHit(enemy.def.id, enemy, attack, damage, attack.kind !== "blast");
                }
            });
            return;
        }
        if (attack.kind === "teleport") {
            this.teleportBoss(enemy, attack);
            return;
        }
        if (attack.kind === "summon") {
            this.summonAround(enemy, attack);
            return;
        }
        if (attack.castSpotAnim !== undefined) {
            this.addEffect(attack.castSpotAnim, enemy.x, enemy.y, 0, 40, enemy.uid);
        }
        if (attack.kind === "ground" || attack.kind === "quarters") {
            // Their marks land by themselves
            return;
        }
        if (attack.kind === "surge") {
            this.startSurge(enemy, attack, windup.lane!);
            return;
        }
        if (attack.kind === "mark") {
            this.markPlayer(enemy, attack);
            return;
        }
        if (attack.kind === "pattern") {
            this.startPattern(enemy, attack, windup);
            return;
        }
        this.launchProjectiles(enemy, attack, this.getBossDamage(enemy, attack), false);
    }

    // At where the player is now: keep moving and it misses
    private launchProjectiles(
        enemy: Enemy,
        attack: BossAttackDef,
        damage: number,
        crowd: boolean,
    ): void {
        const player = this.player;
        const base = fm.atan2(player.y - enemy.y, player.x - enemy.x);
        const count = attack.count ?? 1;
        const speed = (attack.speed ?? 10) / TICKS_PER_SECOND;
        for (let i = 0; i < count; i++) {
            const angle = base + (i - (count - 1) / 2) * (attack.spread ?? 0);
            const vx = fm.cos(angle) * speed;
            const vy = fm.sin(angle) * speed;
            this.enemyProjectiles.push({
                uid: this.nextUid++,
                enemyUid: enemy.uid,
                enemyId: enemy.def.id,
                attack,
                x: enemy.x,
                y: enemy.y,
                prevX: enemy.x,
                prevY: enemy.y,
                vx,
                vy,
                speed,
                homing: (attack.homing ?? 0) / TICKS_PER_SECOND,
                life: Math.ceil((attack.range + 6) / speed),
                radius: ENEMY_PROJECTILE_RADIUS,
                damage,
                yaw: yawFromVector(vx, vy),
                startTick: this.tick,
                crowd,
            });
        }
    }

    // Calls in the attack's enemies in a ring around the boss
    private summonAround(enemy: Enemy, attack: BossAttackDef): void {
        const summon = attack.summon;
        if (!summon) {
            return;
        }
        const def = getEnemy(summon.enemyId);
        const count = summon.count;
        const around = summon.beside ? this.player : enemy;
        const radius = summon.walkTo?.distance ?? (summon.beside ? SUMMON_BESIDE : 1.5);
        const attempts = summon.beside || summon.walkTo ? 6 : 1;
        const spawned: Enemy[] = [];
        const also = summon.alsoId !== undefined ? getEnemy(summon.alsoId) : undefined;
        const total = count + (also ? 1 : 0);
        for (let i = 0; i < total; i++) {
            const one = this.spawnNear(around, i < count ? def : also!, radius, i, total, attempts);
            if (one) {
                spawned.push(one);
            }
        }
        // What's part of the fight isn't a farm, though Sleepwalkers count for
        // their quest, which noDrops wouldn't
        for (const one of spawned) {
            one.noDrops = summon.beside ?? false;
            one.bonesOnly = summon.walkTo !== undefined;
        }
        if (spawned.length === 0) {
            return;
        }
        if (summon.holds !== undefined) {
            this.hold = { enemies: spawned, endTick: this.tick + secondsToTicks(summon.holds) };
        }
        if (summon.walkTo) {
            for (const one of spawned) {
                one.walksTo = enemy;
            }
            enemy.bossState!.walkers = {
                attack,
                enemies: spawned,
                absorbed: 0,
                perAbsorbed: summon.walkTo.perAbsorbed,
            };
        }
    }

    // A blockable attack's blow landing on the glyph instead of the player
    private glyphBlocked(boss: Enemy, attack: BossAttackDef): void {
        const glyph = this.glyphs.find((g) => g.bossUid === boss.uid);
        if (glyph && attack.impactSpotAnim !== undefined) {
            this.addEffect(attack.impactSpotAnim, glyph.x, glyph.y, 0, 40);
        }
    }

    // A boss that gets back up (Count Draynor, without a stake) does so with
    // part of its hitpoints instead of dying, maybe as its next form
    private riseAgain(enemy: Enemy): boolean {
        const rises = enemy.def.boss?.rises;
        const state = enemy.bossState;
        if (!rises || !state || state.rises >= rises.times) {
            return false;
        }
        state.rises++;
        state.windup = undefined;
        enemy.hp = Math.round(enemy.maxHp * rises.hp);
        if (rises.into) {
            // Anything this form had still to call in comes now (it can go
            // from above a threshold to beaten in one big hit)
            this.callSummons(enemy, true);
            // It fights the new form's way, calm again until it's hurt, and
            // calls in the new form's helpers as it's hurt (BossDef.summonsAt)
            const form = getEnemy(rises.into);
            enemy.scale *= (form.scale ?? 1) / (enemy.def.scale ?? 1);
            enemy.def = form;
            enemy.radius = form.radius;
            enemy.speed = form.speed / TICKS_PER_SECOND;
            enemy.tint = 0xffffff;
            enemy.attackSeq = form.attackSeq;
            enemy.anim = "idle";
            enemy.animStart = this.tick;
            enemy.attackCooldown = TICKS_PER_SECOND;
            state.cooldowns = form.boss?.attacks.map(() => 0) ?? [];
            state.enraged = false;
            state.summonsDone = 0;
        }
        this.emit({
            type: "bossRose",
            enemyId: enemy.def.id,
            message: rises.message,
            x: enemy.x,
            y: enemy.y,
        });
        return true;
    }

    // Calls in a boss's helpers for each fraction of its hitpoints it's down to
    // (BossDef.summonsAt). One with no room around it for any of them waits
    // and tries again next tick. all: every one still to come, whatever its
    // hitpoints (a form beaten before it got to them, as it rises as the next).
    private callSummons(enemy: Enemy, all: boolean): void {
        const state = enemy.bossState!;
        const summonsAt = enemy.def.boss?.summonsAt ?? [];
        while (
            state.summonsDone < summonsAt.length &&
            (all || enemy.hp <= enemy.maxHp * summonsAt[state.summonsDone].hp)
        ) {
            const summon = summonsAt[state.summonsDone];
            const summoned = getEnemy(summon.enemyId);
            let spawned = 0;
            for (let i = 0; i < summon.count; i++) {
                if (this.spawnNear(enemy, summoned, 2, i, summon.count, all ? 8 : 3)) {
                    spawned++;
                }
            }
            if (spawned === 0 && !all) {
                return;
            }
            state.summonsDone++;
            if (summon.message) {
                this.emit({ type: "notice", message: summon.message });
            }
            if (summon.shout) {
                this.emit({ type: "bossShout", enemyUid: enemy.uid, text: summon.shout });
            }
        }
    }

    // Jumps onto a spot, if there's room for it there
    private leapTo(enemy: Enemy, spot: { x: number; y: number }): void {
        const tileX = Math.floor(spot.x);
        const tileY = Math.floor(spot.y);
        if (
            !this.grid.contains(tileX, tileY) ||
            !this.flowField.isReachable(tileX, tileY) ||
            !isCircleFree(this.grid, spot.x, spot.y, enemy.radius)
        ) {
            return;
        }
        enemy.x = enemy.prevX = spot.x;
        enemy.y = enemy.prevY = spot.y;
        enemy.vx = enemy.vy = 0;
    }

    // Blinks to a free spot about attack.radius tiles from the player
    private teleportBoss(enemy: Enemy, attack: BossAttackDef): void {
        const player = this.player;
        const spot = this.findSpotNear(player.x, player.y, attack.radius ?? 7, enemy.radius);
        if (!spot) {
            return;
        }
        if (attack.castSpotAnim !== undefined) {
            this.addEffect(attack.castSpotAnim, enemy.x, enemy.y, 0, 60);
        }
        enemy.x = enemy.prevX = spot.x;
        enemy.y = enemy.prevY = spot.y;
        enemy.vx = enemy.vy = 0;
        if (attack.impactSpotAnim !== undefined) {
            this.addEffect(attack.impactSpotAnim, spot.x, spot.y, 0, 60);
        }
    }

    private stepEnemyProjectiles(): void {
        for (const projectile of this.enemyProjectiles) {
            projectile.prevX = projectile.x;
            projectile.prevY = projectile.y;
            projectile.life--;
            // At whoever's nearest
            this.use(this.nearestHero(projectile.x, projectile.y));
            const player = this.player;
            const dx = player.x - projectile.x;
            const dy = player.y - projectile.y;
            if (projectile.homing > 0) {
                // Turn towards the player, a little each tick
                const heading = fm.atan2(projectile.vy, projectile.vx);
                let turn = fm.atan2(dy, dx) - heading;
                turn = fm.atan2(fm.sin(turn), fm.cos(turn));
                const angle =
                    heading + Math.max(-projectile.homing, Math.min(projectile.homing, turn));
                projectile.vx = fm.cos(angle) * projectile.speed;
                projectile.vy = fm.sin(angle) * projectile.speed;
                projectile.yaw = yawFromVector(projectile.vx, projectile.vy);
            }
            projectile.x += projectile.vx;
            projectile.y += projectile.vy;
            if (projectile.attack.blockable && this.hitsGlyph(projectile)) {
                projectile.life = 0;
                continue;
            }
            const reach = projectile.radius + player.radius;
            if (
                projectile.life > 0 &&
                fm.hypot(player.x - projectile.x, player.y - projectile.y) <= reach
            ) {
                projectile.life = 0;
                // A crowd's shot doesn't land on a player just hit (bosses' do)
                if (projectile.crowd && player.invulnerable > 0) {
                    continue;
                }
                const enemy = this.enemies.find((e) => e.uid === projectile.enemyUid);
                this.bossHit(projectile.enemyId, enemy, projectile.attack, projectile.damage);
                if (this.runOver) {
                    return;
                }
            }
        }
    }

    // Whether a blockable projectile has run into its boss's glyph (which
    // breaks it)
    private hitsGlyph(projectile: EnemyProjectile): boolean {
        const glyph = this.glyphs.find((g) => g.bossUid === projectile.enemyUid);
        const boss = glyph && this.enemies.find((e) => e.uid === glyph.bossUid);
        const width = boss?.def.boss?.glyph?.width;
        if (!glyph || width === undefined) {
            return false;
        }
        if (fm.hypot(projectile.x - glyph.x, projectile.y - glyph.y) > width + projectile.radius) {
            return false;
        }
        const impact = projectile.attack.impactSpotAnim;
        if (impact !== undefined) {
            this.addEffect(impact, projectile.x, projectile.y, 0, 30);
        }
        return true;
    }

    // A boss attack hitting the player. Unlike a crowd's hits these land
    // whenever they connect (a hit a moment ago doesn't stop them), unless
    // the player was just revived.
    private bossHit(
        enemyId: string,
        enemy: Enemy | undefined,
        attack: BossAttackDef,
        damage: number,
        showImpact = true,
    ): void {
        const player = this.player;
        if (this.reviving || (this.hero.down && !this.runOver)) {
            return;
        }
        if (showImpact && attack.impactSpotAnim !== undefined) {
            this.addEffect(attack.impactSpotAnim, player.x, player.y, 0, 30);
        }
        const amount = this.damagePlayer(
            damage,
            enemyId,
            false,
            attack.hitSound,
            attack.ignoreArmor,
        );
        const lifesteal = enemy?.def.boss?.lifesteal ?? 0;
        if (enemy && lifesteal > 0 && !enemy.dead) {
            enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.round(amount * lifesteal));
        }
        if (this.runOver || this.reviving) {
            return;
        }
        if (attack.effect) {
            this.applyPlayerEffect(attack.effect, enemy);
        }
        this.recoil(enemy);
    }

    // enemy: the boss that did it, which keeps any coins it steals
    applyPlayerEffect(effect: PlayerEffectDef, enemy?: Enemy): void {
        const player = this.player;
        if (effect.kind === "steal") {
            const state = enemy?.bossState;
            const up = this.heroes.filter((hero) => this.isUp(hero)).length;
            const amount = Math.floor((this.coins * effect.fraction) / Math.max(1, up));
            if (state && amount > 0 && !enemy.dead) {
                this.coins -= amount;
                state.stolenCoins += amount;
                this.emit({ type: "coinsStolen", enemyId: enemy.def.id, amount });
            }
            return;
        }
        if (effect.kind === "curse") {
            const matrix = CURSE_SHUFFLES[this.rng.int(CURSE_SHUFFLES.length)];
            this.curse = { matrix, attacksLeft: effect.attacks };
            this.emit({ type: "playerCursed", cursed: true });
            return;
        }
        if ((effect.kind === "poison" || effect.kind === "debuff") && this.cured) {
            return;
        }
        const ticks = Math.round(effect.seconds * TICKS_PER_SECOND);
        switch (effect.kind) {
            case "freeze":
                player.frozen = Math.max(player.frozen, ticks);
                this.addEffect(FREEZE_SPOTANIM, player.x, player.y, 0, ticks);
                break;
            case "poison":
                // A new dose starts the clock again, at the stronger damage
                player.poisonDamage = Math.max(player.poisonDamage, effect.damage);
                player.poisonEnd = this.tick + ticks;
                break;
            case "debuff":
                this.debuffs = this.debuffs
                    .filter((d) => d.id !== effect.id)
                    .concat({
                        ...this.stackDebuff(effect),
                        startTick: this.tick,
                        endTick: this.tick + ticks,
                    });
                this.updateStats();
                break;
            case "drowsy":
                this.drowsyEndTick = this.tick + ticks;
                this.drowsyInterval = effect.bossInterval;
                this.debuffs = this.debuffs.filter((d) => d.id !== effect.id);
                this.debuffs.push({
                    id: effect.id,
                    name: effect.name,
                    iconObjId: effect.iconObjId,
                    stats: { moveSpeed: effect.moveSpeed },
                    startTick: this.tick,
                    endTick: this.tick + ticks,
                });
                this.updateStats();
                break;
        }
    }

    // The boss with its bar on screen: the final boss once it's up (one still
    // standing, of the Inferno's three Jads; the last one's empty bar stays on
    // the victory screen), otherwise the latest to turn up that's still alive,
    // or of several that came together (Pest Control's four portals) the
    // nearest
    get shownBoss(): Enemy | undefined {
        let shown: Enemy | undefined;
        let fallen: Enemy | undefined;
        for (const enemy of this.enemies) {
            if (enemy.finalBoss && !enemy.dead) {
                return enemy;
            }
            if (enemy.finalBoss && !this.endless) {
                fallen = enemy;
            }
            if (enemy.boss && !enemy.dead) {
                shown = enemy;
            }
        }
        if (fallen) {
            return fallen;
        }
        if (shown && this.funBossGroup.includes(shown)) {
            const player = this.player;
            let nearest = Infinity;
            for (const boss of this.funBossGroup) {
                const distance = fm.hypot(boss.x - player.x, boss.y - player.y);
                if (!boss.dead && distance < nearest) {
                    nearest = distance;
                    shown = boss;
                }
            }
        }
        return shown;
    }

    // Whether a final boss is still standing (a dead one is marked dead
    // before this is asked)
    private finalBossLeft(): boolean {
        return this.enemies.some((enemy) => enemy.finalBoss && !enemy.dead);
    }

    private playerDied(): void {
        const player = this.player;
        if (this.revivesLeft > 0) {
            this.revivesLeft--;
            player.hp = player.maxHp;
            player.invulnerable = 3 * TICKS_PER_SECOND;
            this.emit({ type: "revive" });
            return;
        }
        player.hp = 0;
        player.deathTick = this.tick;
        this.hero.down = true;
        if (!this.heroes.some((hero) => this.isUp(hero))) {
            this.endRun("dead");
            return;
        }
        // Co-op: they're out for the rest of the run, and the rest fight on
        player.prevX = player.x;
        player.prevY = player.y;
        player.moving = false;
        player.poisonEnd = -1;
        player.poisonDamage = 0;
        this.emit({ type: "heroDown" });
        this.rescaleParty();
    }

    // Co-op: the crowd and its bosses for the players still up, and half of
    // each one who's down or gone
    private rescaleParty(): void {
        const up = this.heroes.filter((hero) => this.isUp(hero)).length;
        this.partyScale = getPartyScale(up + (this.heroes.length - up) * PLAYER_GONE);
    }

    // Returns the damage done (0 if it was already dead). mightScale
    // multiplies the player's damage bonus (Tumeken's shadow triples it; 0
    // leaves out the bonuses to damage, bosses' included); poison is for venom's damage, which shows as a poison splat.
    damageEnemy(
        enemy: Enemy,
        baseDamage: number,
        knockback: number,
        fromX: number,
        fromY: number,
        mightScale = 1,
        poison = false,
    ): number {
        if (enemy.dead) {
            return 0;
        }
        // Hit by the player, it's after the player from now on
        enemy.aggro = true;
        if (enemy.shieldEnd > this.tick) {
            this.showBlocked(enemy);
            return 0;
        }
        const drain = enemy.drainEnd > this.tick ? enemy.drain : 0;
        // Damage that ignores the damage bonus (mightScale 0: the nuke's share
        // of a boss's hitpoints, a ruby bolt's) ignores this one too
        const bossMight = enemy.boss && mightScale > 0 ? this.stats.bossMight : 0;
        const damage = Math.max(
            1,
            Math.round(
                baseDamage *
                    (1 + this.stats.might * mightScale) *
                    (1 + bossMight) *
                    (1 + drain) *
                    this.rng.range(0.85, 1.15),
            ),
        );
        const phase = enemy.bossState?.phase;
        if (phase) {
            // All a hit can get at is its shield
            phase.shield -= damage;
        } else {
            enemy.hp -= damage;
        }
        enemy.flash = 5;
        const source = this.damageSource;
        this.damageBySource[source] = (this.damageBySource[source] ?? 0) + damage;
        this.hero.recentDamage[this.tick % DPS_WINDOW_TICKS] += damage;
        this.highestHit = Math.max(this.highestHit, damage);
        this.emit({
            type: "damage",
            x: enemy.x,
            y: enemy.y,
            amount: damage,
            enemyUid: enemy.uid,
            enemyId: enemy.def.id,
            ...(poison && { poison }),
        });
        const resist = enemy.def.knockbackResist ?? 0;
        if (knockback > 0 && resist < 1 && !enemy.boss && !enemy.def.stationary) {
            const dx = enemy.x - fromX;
            const dy = enemy.y - fromY;
            const len = fm.hypot(dx, dy);
            if (len > 0.001) {
                const k = (knockback * (1 - resist)) / 4;
                enemy.vx += (dx / len) * k;
                enemy.vy += (dy / len) * k;
            }
        }
        if (phase) {
            if (phase.shield <= 0) {
                this.breakShield(enemy, phase);
            }
        } else if (enemy.totemOf) {
            if (enemy.hp <= 0) {
                this.totemCharged(enemy, enemy.totemOf);
            }
        } else if (enemy.hp <= 0 && !this.riseAgain(enemy)) {
            this.killEnemy(enemy);
        }
        return damage;
    }

    // cause: the player's doing (the bot nuke's too, though what it kills
    // doesn't split or blow up), or another faction's enemy (which drops
    // nothing and isn't the player's kill, so luring armies into each other
    // isn't free experience, and the ground doesn't fill with bones far away)
    private killEnemy(enemy: Enemy, cause: "player" | "nuke" | "enemy" = "player"): void {
        enemy.dead = true;
        enemy.hp = 0;
        enemy.deathTick = this.tick;
        enemy.anim = "death";
        enemy.animStart = this.tick;
        enemy.vx = enemy.vy = 0;
        const byEnemy = cause === "enemy";
        // One brought back by a reviver was counted the first time it died
        if (!byEnemy && !enemy.noDrops) {
            this.kills++;
            this.enemyKills[enemy.def.id] = (this.enemyKills[enemy.def.id] ?? 0) + 1;
            const source = this.damageSource;
            this.killsBySource[source] = (this.killsBySource[source] ?? 0) + 1;
        }
        if (enemy.boss) {
            this.bossesKilled.push(enemy.def.id);
            this.bossKills.push({ enemyId: enemy.def.id, seconds: this.seconds });
            // A boss's glyph goes with it, rather than hanging about on the
            // victory screen
            this.glyphs = this.glyphs.filter((glyph) => glyph.bossUid !== enemy.uid);
            this.endBossFight(enemy);
        }
        this.emit({
            type: "kill",
            enemyUid: enemy.uid,
            enemyId: enemy.def.id,
            boss: enemy.boss,
            x: enemy.x,
            y: enemy.y,
            ...(byEnemy && { byEnemy }),
        });

        if (!byEnemy && !enemy.noDrops) {
            this.dropLoot(enemy);
        }
        if (enemy.boss) {
            this.funBossDown(enemy);
        }
        if (!enemy.boss && !enemy.elite && !enemy.noDrops) {
            // For revivers
            this.deaths.push({
                def: enemy.def,
                variant: enemy.variant,
                x: enemy.x,
                y: enemy.y,
                tick: this.tick,
            });
            if (this.deaths.length > MAX_DEATHS) {
                this.deaths.shift();
            }
        }
        if (cause !== "nuke") {
            this.splitUp(enemy);
            this.explode(enemy);
        }

        const stolen = enemy.bossState?.stolenCoins ?? 0;
        if (stolen > 0) {
            this.coins += stolen;
            enemy.bossState!.stolenCoins = 0;
            this.emit({ type: "coinsReturned", enemyId: enemy.def.id, amount: stolen });
        }

        // With the last of the final bosses (the Inferno has three)
        if (enemy.finalBoss && !this.finalBossLeft()) {
            if (this.endless) {
                this.nextRound();
            } else {
                this.endRun("victory");
            }
        }
    }

    // One of a pool that came together is down (FunMapDef.bosses.together):
    // with the last of them, their casket drops and the next lot is due in a
    // few minutes
    private funBossDown(enemy: Enemy): void {
        const together = this.map.fun?.bosses.together;
        if (!together || !this.funBossGroup.includes(enemy)) {
            return;
        }
        if (this.funBossGroup.some((boss) => !boss.dead)) {
            return;
        }
        this.funBossGroup = [];
        this.dropCasketOfTier(together.casket, enemy.x - 0.4, enemy.y + 0.4);
        this.emit({ type: "notice", message: together.message });
        this.nextFunBossSeconds = this.seconds + this.rng.range(...this.map.fun!.bosses.every);
    }

    // Splits into smaller enemies where it died (EnemyDef.splits)
    private splitUp(enemy: Enemy): void {
        const splits = enemy.def.splits;
        if (!splits) {
            return;
        }
        const into = getEnemy(splits.into);
        for (let i = 0; i < splits.count; i++) {
            // Where it was, if there's no room around it
            const part =
                this.spawnNear(enemy, into, 0.7, i, splits.count, 3) ??
                this.spawnEnemy(into, "normal", { x: enemy.x, y: enemy.y });
            if (part) {
                part.noDrops = enemy.noDrops;
            }
        }
        if (splits.spotAnim !== undefined) {
            this.addEffect(splits.spotAnim, enemy.x, enemy.y, 0, 40);
        }
    }

    // Blows up where it died (EnemyDef.explodes), hurting the player if
    // they're in reach. It lands like a boss's attack, a hit a moment ago or
    // not.
    private explode(enemy: Enemy): void {
        const explodes = enemy.def.explodes;
        if (!explodes) {
            return;
        }
        if (explodes.spotAnim !== undefined) {
            this.addEffect(explodes.spotAnim, enemy.x, enemy.y, 0, 40);
        }
        this.emit({ type: "blast", x: enemy.x, y: enemy.y, radius: explodes.radius });
        if (explodes.sound !== undefined) {
            this.emit({
                type: "bossAttack",
                enemyId: enemy.def.id,
                sound: explodes.sound,
                x: enemy.x,
                y: enemy.y,
            });
        }
        this.forEachHeroInReach(() => {
            const player = this.player;
            if (
                !this.runOver &&
                !this.reviving &&
                fm.hypot(player.x - enemy.x, player.y - enemy.y) <= explodes.radius + player.radius
            ) {
                this.damagePlayer(explodes.damage * enemy.damageScale, enemy.def.id, enemy.elite);
            }
        });
    }

    // Bones, and now and then a casket, coins, food or a power-up
    private dropLoot(enemy: Enemy): void {
        this.dropPickup("bones", enemy.x, enemy.y, enemy.xp);
        this.rollBossTrophies(enemy);
        if (enemy.bonesOnly) {
            return;
        }
        const luck = 1 + this.stats.luck;
        const caskets = enemy.def.caskets;
        if (enemy.elite) {
            this.dropCasket(enemy.x + 0.4, enemy.y, true);
        } else if (enemy.boss && !enemy.finalBoss && caskets) {
            // Its own caskets instead of the usual one
            caskets.forEach((tier, i) => {
                this.dropCasketOfTier(tier, enemy.x + 0.4, enemy.y + i * 0.6);
            });
        } else if (enemy.boss && (!enemy.finalBoss || this.endless)) {
            // An endless round's final boss always drops a master casket (the
            // last of them, where there are several)
            const master = enemy.finalBoss && !this.finalBossLeft();
            this.dropCasketOfTier(
                master ? "master" : rollBossCasketTier(this.rng, this.stats.luck),
                enemy.x + 0.4,
                enemy.y,
                master,
            );
        } else if (
            !enemy.boss &&
            this.rng.chance(CASKET_DROP_CHANCE * luck * this.partyScale.caskets)
        ) {
            this.dropCasket(enemy.x + 0.3, enemy.y, false);
        } else if (this.rng.chance(0.03 * luck)) {
            this.dropPickup("coins", enemy.x + 0.3, enemy.y + 0.2, 1 + this.rng.int(5));
        } else if (this.rng.chance(FOOD_DROP_CHANCE * luck)) {
            this.dropPickup("food", enemy.x - 0.3, enemy.y, Math.round(FOOD_HEAL * this.healScale));
        }
        if (!enemy.boss) {
            this.rollPowerUp(enemy.x - 0.3, enemy.y + 0.3);
            this.rollPumpkin(enemy.x + 0.3, enemy.y - 0.3);
        }
    }

    // Endless runs: the final boss is down, so the map comes round again,
    // its waves and bosses from five minutes in and everything tougher
    private nextRound(): void {
        this.round++;
        this.roundStartTick = this.tick;
        const events = this.map.events;
        const first = events.findIndex((e) => e.at >= LATER_ROUND_START);
        this.eventIndex = first === -1 ? events.length : first;
        this.bossSpawned = false;
        this.emit({ type: "roundStarted", round: this.round });
    }

    private endRun(state: "dead" | "victory"): void {
        this.endTick = this.tick;
        this.state = state;
        // Everything stands still from here on; idle rather than walk on the spot
        for (const enemy of this.enemies) {
            enemy.prevX = enemy.x;
            enemy.prevY = enemy.y;
        }
    }

    // ---- Weapons ----

    // Past the last level (endless runs) is the last level, with more damage
    private getLevel(weapon: WeaponState) {
        const levels = weapon.def.levels;
        return levels[Math.min(weapon.level, levels.length) - 1];
    }

    // speed: a bonus of the weapon's own on top of the player's cooldown
    // bonus (a set's), the two together capped like the player's alone
    private cooldownTicks(seconds: number, speed = 0): number {
        const bonus = 1 - (1 - Math.min(this.stats.cooldown, 0.6)) * (1 - speed);
        return Math.max(5, Math.round(seconds * TICKS_PER_SECOND * (1 - Math.min(bonus, 0.6))));
    }

    // A weapon's level with what else changes it folded in: its bonus damage
    // from rare rolls, its style's damage bonus (Rigour's, the rings'), the
    // worn sets' boosts to it, and for auras their own area bonus (the
    // Ancient sceptre's). The sets' speed boost isn't in it (see setBoosts).
    private getEffectiveLevel(weapon: WeaponState): WeaponDef["levels"][number] {
        const level = this.getLevel(weapon);
        const def = weapon.def;
        const boosts = this.setBoosts(def);
        const damage =
            (1 + weapon.bonus) * (1 + this.styleMight(getWeaponStyle(def))) * boosts.damage;
        const area = (def.kind === "aura" ? 1 + this.stats.auraArea : 1) * boosts.area;
        if (damage === 1 && area === 1) {
            return level;
        }
        return { ...level, damage: level.damage * damage, area: level.area * area };
    }

    // What the worn sets do for a weapon: damage and area multipliers, and a
    // speed bonus that cooldownTicks caps along with the player's own
    private setBoosts(def: WeaponDef): { damage: number; area: number; speed: number } {
        let damage = 1;
        let area = 1;
        let slower = 1;
        for (const setId of this.activeSets) {
            const boost = getSet(setId).weapons;
            if (boost && (boost.kinds?.includes(def.kind) || boost.ids?.includes(def.id))) {
                damage *= 1 + (boost.damage ?? 0);
                slower *= 1 - (boost.cooldown ?? 0);
                area *= 1 + (boost.area ?? 0);
            }
        }
        return { damage, area, speed: 1 - slower };
    }

    private styleMight(style: CombatStyle): number {
        switch (style) {
            case "melee":
                return this.stats.meleeMight;
            case "ranged":
                return this.stats.rangedMight;
            case "magic":
                return this.stats.magicMight;
        }
    }

    private stepWeapons(): void {
        for (const weapon of this.weapons) {
            if (weapon.cooldown > 0) {
                weapon.cooldown--;
                continue;
            }
            const level = this.getEffectiveLevel(weapon);
            // A slash or sweep waits for something in reach, like a missile
            // waits for a target, rather than spending its cooldown on air
            if (
                (weapon.def.kind === "slash" || weapon.def.kind === "sweep") &&
                !this.meleeInReach(level)
            ) {
                weapon.cooldown = 10;
                continue;
            }
            const special = this.takeSpecial(weapon, level);
            this.damageSource = `weapon:${weapon.def.id}`;
            const fired = this.fireWeapon(weapon.def, level, special);
            // Nothing to shoot at: try again soon rather than wasting the cooldown
            weapon.cooldown = fired
                ? this.cooldownTicks(level.cooldown, this.setBoosts(weapon.def).speed)
                : 10;
            if (fired) {
                this.emit({
                    type: "weapon",
                    weaponId: weapon.def.id,
                    sound: special?.sound ?? level.sound ?? weapon.def.sound,
                    x: this.player.x,
                    y: this.player.y,
                });
            }
            if (fired && !this.player.moving) {
                this.player.attackSeq = special?.playerSeq ?? weapon.def.playerSeq;
                this.player.attackStart = this.tick;
            }
        }
    }

    // Counts an attack, and returns the weapon's special attack if this one
    // is it. A special that's due waits until something is in reach, so it
    // isn't swung at nothing.
    private takeSpecial(
        weapon: WeaponState,
        level: WeaponDef["levels"][number],
    ): SpecialAttackDef | undefined {
        const special = weapon.def.special;
        if (!special) {
            return undefined;
        }
        if (weapon.uses % special.every !== special.every - 1) {
            weapon.uses++;
            return undefined;
        }
        if (!this.meleeInReach(level)) {
            return undefined;
        }
        weapon.uses++;
        return special;
    }

    // Something a melee weapon at this level would hit
    private meleeInReach(level: WeaponDef["levels"][number]): boolean {
        const reach = level.area * (1 + this.stats.area);
        const player = this.player;
        return this.nearestEnemies(player.x, player.y, reach + 0.5, 1).length > 0;
    }

    private fireWeapon(
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        special?: SpecialAttackDef,
    ): boolean {
        switch (def.kind) {
            case "slash":
                this.fireSlash(def, level, special);
                return true;
            case "sweep":
                this.fireSweep(def, level, special);
                return true;
            case "missile":
                return this.fireMissiles(def, level);
            case "knives":
                this.fireKnives(def, level);
                return true;
            case "axes":
                return this.fireAxes(def, level);
            case "aura":
                this.fireAura(def, level);
                return true;
            case "strike":
                return this.fireStrikes(def, level);
            case "orbit":
                this.fireOrbit(def, level);
                return true;
        }
    }

    // Where a melee attack aims: at the nearest enemy in reach, otherwise the
    // way the player faces (kiting means facing away from what's chasing you)
    private aimMelee(reach: number): { x: number; y: number } {
        const player = this.player;
        const nearest = this.nearestEnemies(player.x, player.y, reach + 1.5, 1)[0];
        if (nearest) {
            const dx = nearest.x - player.x;
            const dy = nearest.y - player.y;
            const len = fm.hypot(dx, dy);
            if (len > 0.001) {
                return { x: dx / len, y: dy / len };
            }
        }
        return { x: player.facingX, y: player.facingY };
    }

    private fireSlash(
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        special?: SpecialAttackDef,
    ): void {
        if (special?.aoe) {
            this.fireAoeSpecial(def, level, special, special.aoe);
            return;
        }
        const player = this.player;
        const reach = level.area * (1 + this.stats.area);
        const width = SLASH_WIDTH * (1 + this.stats.area);
        const sides = Math.min(level.amount, 2);
        const aim = this.aimMelee(reach);
        // Each side hits what's in it, so something right on top of the
        // player can be hit by both
        const hit: Enemy[] = [];
        for (let side = 0; side < sides; side++) {
            const dirX = side === 0 ? aim.x : -aim.x;
            const dirY = side === 0 ? aim.y : -aim.y;
            this.emit({
                type: "slash",
                x: player.x,
                y: player.y,
                dirX,
                dirY,
                reach,
                width,
                arc: SLASH_ARC,
                weaponId: def.id,
            });
            this.enemyHash.query(player.x, player.y, reach + 1, (enemy) => {
                const ox = enemy.x - player.x;
                const oy = enemy.y - player.y;
                const along = ox * dirX + oy * dirY;
                const across = Math.abs(ox * -dirY + oy * dirX);
                if (
                    along >= -0.3 &&
                    along <= reach + enemy.radius &&
                    across <= width / 2 + enemy.radius
                ) {
                    hit.push(enemy);
                }
            });
        }
        this.meleeHits(def, level, hit, special);
    }

    // Everything within reach in an arc either side of where it aims (and
    // behind too with amount 2), each hit once. Bosses and elites take the
    // weapon's extra hits; a special attack hits harder and does its effect.
    private fireSweep(
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        special?: SpecialAttackDef,
    ): void {
        if (special?.aoe) {
            this.fireAoeSpecial(def, level, special, special.aoe);
            return;
        }
        const player = this.player;
        const reach = level.area * (1 + this.stats.area);
        const arc = level.arc ?? SLASH_ARC;
        const sides = Math.min(level.amount, 2);
        const aim = this.aimMelee(reach);
        const hit = new Set<Enemy>();
        for (let side = 0; side < sides; side++) {
            const dirX = side === 0 ? aim.x : -aim.x;
            const dirY = side === 0 ? aim.y : -aim.y;
            this.emit({
                type: "slash",
                x: player.x,
                y: player.y,
                dirX,
                dirY,
                reach,
                width: 0,
                arc,
                weaponId: def.id,
            });
            this.enemyHash.query(player.x, player.y, reach + 1, (enemy) => {
                const ox = enemy.x - player.x;
                const oy = enemy.y - player.y;
                const dist = fm.hypot(ox, oy);
                if (enemy.dead || hit.has(enemy) || dist > reach + enemy.radius) {
                    return;
                }
                // Anything right on top of the player is in the way of the
                // swing, whichever way it goes
                const along = (ox * dirX + oy * dirY) / Math.max(dist, 0.001);
                const angle = fm.acos(Math.max(-1, Math.min(1, along)));
                if (dist > 0.8 && angle > arc + enemy.radius / dist) {
                    return;
                }
                hit.add(enemy);
            });
        }
        this.meleeHits(def, level, hit, special);
    }

    // A special attack that hits everything all round the player (the Thunder
    // khopesh's Thunderclap): a full circle swing, lightning on what it hits
    private fireAoeSpecial(
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        special: SpecialAttackDef,
        aoe: NonNullable<SpecialAttackDef["aoe"]>,
    ): void {
        const player = this.player;
        const radius = aoe.radius * (1 + this.stats.area);
        this.emit({
            type: "slash",
            x: player.x,
            y: player.y,
            dirX: player.facingX,
            dirY: player.facingY,
            reach: radius,
            width: 0,
            arc: Math.PI,
            weaponId: def.id,
        });
        const hit: Enemy[] = [];
        this.enemyHash.query(player.x, player.y, radius + 1, (enemy) => {
            if (
                !enemy.dead &&
                fm.hypot(enemy.x - player.x, enemy.y - player.y) <= radius + enemy.radius
            ) {
                hit.push(enemy);
            }
        });
        if (aoe.impactSpotAnim !== undefined) {
            for (const enemy of hit.slice(0, 10)) {
                this.addEffect(aoe.impactSpotAnim, enemy.x, enemy.y, 0, 60, enemy.uid);
            }
        }
        this.meleeHits(def, level, hit, special);
    }

    // A slash or sweep landing on what it caught. Bosses and elites take the
    // weapon's extra hits; a special attack hits harder and does its effect.
    private meleeHits(
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        hit: Iterable<Enemy>,
        special: SpecialAttackDef | undefined,
    ): void {
        const player = this.player;
        const damage = level.damage * (special?.damage ?? 1);
        if (special) {
            this.addEffect(special.spotAnim, player.x, player.y, 0, SPECIAL_SPOTANIM_TICKS);
        }
        let dealt = 0;
        let effects = 0;
        for (const enemy of hit) {
            const enemyDamage = damage * this.slayerScale(def, enemy);
            const hits = def.hits ?? [1];
            const hitDealt =
                this.damageEnemy(
                    enemy,
                    enemyDamage * hits[0],
                    level.knockback * (1 + this.stats.meleeKnockback),
                    player.x,
                    player.y,
                ) + this.bigHits(def, enemy, enemyDamage, player.x, player.y);
            // The rest of a multi-hit weapon's hits land a moment apart
            hits.slice(1).forEach((fraction, i) => {
                this.pendingHits.push({
                    hero: this.hero.index,
                    enemy,
                    weapon: def,
                    damage: enemyDamage * fraction,
                    knockback: 0,
                    tick: this.tick + (i + 1) * FOLLOW_UP_HIT_TICKS,
                });
            });
            dealt += hitDealt;
            this.stealLife(def, hitDealt);
            const effect = special?.effect;
            if (effect?.kind === "freeze" && !enemy.boss && !enemy.dead) {
                this.freezeEnemy(enemy, effect.seconds);
                if (effects++ < 10) {
                    this.addEffect(FREEZE_SPOTANIM, enemy.x, enemy.y, 0, 60, enemy.uid);
                }
            } else if (effect?.kind === "drain" && !enemy.dead) {
                this.drainEnemy(enemy, effect.amount, effect.seconds);
            } else if (effect?.kind === "burn" && !enemy.dead) {
                this.envenom(
                    enemy,
                    enemyDamage * effect.damage,
                    Math.round(effect.seconds * (1 + this.stats.duration) * TICKS_PER_SECOND),
                );
            }
        }
        if (special?.effect?.kind === "heal" && dealt > 0) {
            this.heal(Math.min(Math.round(dealt * special.effect.fraction), special.effect.max));
        }
        if (def.chain) {
            this.chainHits(def, def.chain, hit, damage);
        }
    }

    // How much harder a weapon hits this enemy for what it is (the Ivandis
    // flail and vampyres)
    private slayerScale(def: WeaponDef, enemy: Enemy): number {
        const slayer = def.slayer;
        return slayer && hasTag(enemy, slayer.tags) ? 1 + slayer.damage : 1;
    }

    // Each enemy of the chain's kind that a swing hit passes it on to more of
    // its kind nearby, up to the chain's count in all (the Blisterwood flail)
    private chainHits(
        def: WeaponDef,
        chain: NonNullable<WeaponDef["chain"]>,
        hit: Iterable<Enemy>,
        damage: number,
    ): void {
        const done = new Set(hit);
        let left = chain.count;
        for (const from of [...done]) {
            if (left <= 0) {
                break;
            }
            if (!hasTag(from, chain.tags)) {
                continue;
            }
            this.enemyHash.query(from.x, from.y, chain.range + 0.5, (enemy) => {
                if (
                    left <= 0 ||
                    enemy.dead ||
                    done.has(enemy) ||
                    !hasTag(enemy, chain.tags) ||
                    fm.hypot(enemy.x - from.x, enemy.y - from.y) > chain.range
                ) {
                    return;
                }
                done.add(enemy);
                left--;
                this.addEffect(chain.spotAnim, enemy.x, enemy.y, 0, 30, enemy.uid);
                const dealt = this.damageEnemy(
                    enemy,
                    damage * chain.damage * this.slayerScale(def, enemy),
                    0,
                    from.x,
                    from.y,
                );
                this.stealLife(def, dealt);
            });
        }
    }

    // Lands the hits that were waiting for their moment
    private stepPendingHits(): void {
        if (this.pendingHits.length === 0) {
            return;
        }
        this.pendingHits = this.pendingHits.filter((hit) => {
            if (hit.tick > this.tick) {
                return true;
            }
            this.useHeroAt(hit.hero);
            const player = this.player;
            this.damageSource = `weapon:${hit.weapon.id}`;
            const dealt = this.damageEnemy(
                hit.enemy,
                hit.damage,
                hit.knockback,
                player.x,
                player.y,
            );
            this.stealLife(hit.weapon, dealt);
            return false;
        });
    }

    // The weapon's extra hits on a boss or an elite (the scythe's), and the
    // damage they dealt
    private bigHits(
        def: WeaponDef,
        enemy: Enemy,
        damage: number,
        fromX: number,
        fromY: number,
    ): number {
        let dealt = 0;
        if (enemy.boss || enemy.elite) {
            for (const fraction of def.bigHits ?? []) {
                dealt += this.damageEnemy(
                    enemy,
                    damage * fraction,
                    0,
                    fromX,
                    fromY,
                    def.mightScale,
                );
            }
        }
        return dealt;
    }

    // Can't move for this many seconds, longer with duration (bosses shrug it
    // off)
    private freezeEnemy(enemy: Enemy, seconds: number): void {
        if (!enemy.boss) {
            const ticks = seconds * (1 + this.stats.duration) * TICKS_PER_SECOND;
            enemy.frozen = Math.max(enemy.frozen, Math.round(ticks));
        }
    }

    // Takes amount more damage from everything for this many seconds, longer
    // with duration (the Bandos godsword's Warstrike)
    private drainEnemy(enemy: Enemy, amount: number, seconds: number): void {
        const ticks = seconds * (1 + this.stats.duration) * TICKS_PER_SECOND;
        enemy.drain = amount;
        enemy.drainEnd = this.tick + Math.round(ticks);
    }

    // Venom damage every second for this many ticks. Topped up rather than
    // started again, so its next hit still comes on time.
    private envenom(enemy: Enemy, venom: number, ticks: number): void {
        if (enemy.venomEnd < this.tick) {
            enemy.venomNext = this.tick + TICKS_PER_SECOND;
            enemy.venom = 0;
        }
        enemy.venom = Math.max(enemy.venom, venom);
        enemy.venomEnd = Math.max(enemy.venomEnd, this.tick + ticks);
        enemy.venomSource = this.damageSource;
        enemy.venomHero = this.hero.index;
    }

    // A hit's chance of healing the player: the weapon's (the Sanguinesti
    // staff's, by part of what it dealt), and the Amulet of blood fury's
    private stealLife(def: WeaponDef, dealt: number): void {
        if (dealt <= 0) {
            return;
        }
        const lifesteal = def.lifesteal;
        if (lifesteal && this.rng.chance(lifesteal.chance)) {
            const amount = Math.min(Math.round(dealt * lifesteal.fraction), lifesteal.max);
            this.lifestealHeal(amount, lifesteal.spotAnim);
        }
        if (
            this.stats.healChance > 0 &&
            this.tick >= this.bloodFuryRollTick &&
            this.player.hp < this.player.maxHp
        ) {
            this.bloodFuryRollTick = this.tick + BLOOD_FURY_ROLL_INTERVAL;
            if (this.rng.chance(this.stats.healChance)) {
                this.lifestealHeal(BLOOD_FURY_HEAL, BLOOD_FURY_SPOTANIM);
            }
        }
    }

    private lifestealHeal(amount: number, spotAnim: number): void {
        if (amount > 0 && this.player.hp < this.player.maxHp) {
            this.heal(amount);
            this.addEffect(spotAnim, this.player.x, this.player.y, 0, 40);
        }
    }

    // What an aura's or a strike's hit does besides its damage: the level's
    // venom and the weapon's drain and lifesteal
    private spellHitEffects(
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        enemy: Enemy,
        dealt: number,
    ): void {
        if (!enemy.dead) {
            if (level.venom) {
                const ticks = level.duration * (1 + this.stats.duration) * TICKS_PER_SECOND;
                this.envenom(enemy, level.venom, Math.round(ticks));
            }
            if (def.drain) {
                this.drainEnemy(enemy, def.drain, level.duration);
            }
        }
        this.stealLife(def, dealt);
    }

    // What the player's weapons go for. Shielded enemies (Pest Control's
    // portals, Verzik's first form) are left out: every hit on them is
    // blocked, so aiming at them would waste shots while pests close in.
    private nearestEnemies(x: number, y: number, range: number, count: number): Enemy[] {
        const found: { enemy: Enemy; distSq: number }[] = [];
        const rangeSq = range * range;
        for (const enemy of this.enemies) {
            if (enemy.dead || enemy.shieldEnd > this.tick) {
                continue;
            }
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= rangeSq) {
                found.push({ enemy, distSq });
            }
        }
        found.sort((a, b) => a.distSq - b.distSq);
        return found.slice(0, count).map((f) => f.enemy);
    }

    // The enemies in range with the most hitpoints (the nearest of them on a
    // tie), for the Twisted bow
    private toughestEnemies(x: number, y: number, range: number, count: number): Enemy[] {
        const near = this.nearestEnemies(x, y, range, MAX_ENEMIES);
        // Sorting is stable, so equally tough ones stay nearest first
        return near.sort((a, b) => b.maxHp - a.maxHp).slice(0, count);
    }

    // The nearest enemies in range, those without venom first, so venom
    // spreads through a crowd (the Toxic blowpipe)
    private unvenomedEnemies(x: number, y: number, range: number, count: number): Enemy[] {
        const near = this.nearestEnemies(x, y, range, MAX_ENEMIES);
        const later = (enemy: Enemy) =>
            enemy.venomEnd >= this.tick || fm.hypot(enemy.x - x, enemy.y - y) > VENOM_SPREAD_RANGE;
        // Sorting is stable, so each half stays nearest first
        return near.sort((a, b) => Number(later(a)) - Number(later(b))).slice(0, count);
    }

    // Spells and arrows
    private fireMissiles(def: WeaponDef, level: WeaponDef["levels"][number]): boolean {
        const player = this.player;
        const amount = level.amount + this.stats.amount;
        const targets = def.toughTargets
            ? this.toughestEnemies(player.x, player.y, 14, amount)
            : level.venom
              ? this.unvenomedEnemies(player.x, player.y, 14, amount)
              : this.nearestEnemies(player.x, player.y, 14, amount);
        if (targets.length === 0) {
            return false;
        }
        if (level.castSpotAnim !== undefined) {
            this.addEffect(level.castSpotAnim, player.x, player.y, 0, 40);
        }
        for (let i = 0; i < amount; i++) {
            const target = targets[i % targets.length];
            this.addProjectile(
                "spell",
                def,
                level,
                target,
                fm.atan2(target.y - player.y, target.x - player.x),
            );
        }
        return true;
    }

    private fireKnives(def: WeaponDef, level: WeaponDef["levels"][number]): void {
        const player = this.player;
        const amount = level.amount + this.stats.amount;
        // At the nearest enemy close by, otherwise the way the player faces
        const nearest = this.nearestEnemies(player.x, player.y, 9, 1)[0];
        const base = nearest
            ? fm.atan2(nearest.y - player.y, nearest.x - player.x)
            : fm.atan2(player.facingY, player.facingX);
        for (let i = 0; i < amount; i++) {
            // Fan out: 0, +1, -1, +2, -2 ... steps of 7 degrees
            const offset = Math.ceil(i / 2) * (i % 2 === 0 ? -1 : 1) * 0.12;
            this.addProjectile("knife", def, level, undefined, base + offset);
        }
    }

    // At the nearest enemies, one each; each axe bounces on from what it hits
    private fireAxes(def: WeaponDef, level: WeaponDef["levels"][number]): boolean {
        const player = this.player;
        const amount = level.amount + this.stats.amount;
        const targets = this.nearestEnemies(player.x, player.y, AXE_RANGE, amount);
        if (targets.length === 0) {
            return false;
        }
        for (let i = 0; i < amount; i++) {
            const target = targets[i % targets.length];
            const angle = fm.atan2(target.y - player.y, target.x - player.x);
            this.addProjectile("axe", def, level, target, angle);
        }
        return true;
    }

    // Sends an axe on from the enemy it just hit to the nearest it hasn't hit
    // yet; false when there's nothing close enough
    private bounce(projectile: Projectile, from: Enemy): boolean {
        let next: Enemy | undefined;
        let best = BOUNCE_RANGE * BOUNCE_RANGE;
        for (const enemy of this.enemies) {
            if (enemy.dead || projectile.hit.has(enemy.uid) || enemy.shieldEnd > this.tick) {
                continue;
            }
            const bx = enemy.x - from.x;
            const by = enemy.y - from.y;
            const distSq = bx * bx + by * by;
            if (distSq <= best) {
                best = distSq;
                next = enemy;
            }
        }
        if (!next) {
            return false;
        }
        projectile.bounces--;
        projectile.targetUid = next.uid;
        projectile.life = Math.ceil((BOUNCE_RANGE * 2) / Math.max(projectile.speed, 0.01));
        return true;
    }

    // Puts the weapon's items circling the player, evenly spaced, in place of
    // any still going round from last time
    private fireOrbit(def: WeaponDef, level: WeaponDef["levels"][number]): void {
        const player = this.player;
        this.projectiles = this.projectiles.filter((p) => !(p.orbit && p.weapon === def));
        const amount = level.amount + this.stats.amount;
        const radius = level.area * (1 + this.stats.area);
        // Speed is how fast they go round, in tiles a second
        const angularSpeed = (level.speed * (1 + this.stats.speed)) / radius / TICKS_PER_SECOND;
        const life = Math.round(level.duration * (1 + this.stats.duration) * TICKS_PER_SECOND);
        // A little less than the time one takes to come round again, so
        // whatever's in the way is hit once a pass
        const rehitTicks = Math.max(5, Math.round(((2 * Math.PI) / angularSpeed) * 0.6));
        const start = fm.atan2(player.facingY, player.facingX);
        const objIds = def.orbitObjIds ?? [];
        for (let i = 0; i < amount; i++) {
            const angle = start + (i / amount) * Math.PI * 2;
            const x = player.x + fm.cos(angle) * radius;
            const y = player.y + fm.sin(angle) * radius;
            this.projectiles.push({
                uid: this.nextUid++,
                hero: this.hero.index,
                kind: "rune",
                weapon: def,
                x,
                y,
                prevX: x,
                prevY: y,
                vx: 0,
                vy: 0,
                speed: 0,
                targetUid: 0,
                damage: level.damage,
                pierce: 0,
                bounces: 0,
                venom: 0,
                venomTicks: 0,
                orbit: { angle, angularSpeed, radius, nextHit: new Map(), rehitTicks },
                life,
                radius: 0.5,
                splash: 0,
                knockback: level.knockback,
                hit: new Set(),
                yaw: yawFromVector(-fm.sin(angle), fm.cos(angle)),
                spotAnim: -1,
                impactSpotAnim: -1,
                hitSound: -1,
                objId: objIds.length > 0 ? objIds[i % objIds.length] : -1,
                startTick: this.tick,
            });
        }
    }

    private addProjectile(
        kind: ProjectileKind,
        def: WeaponDef,
        level: WeaponDef["levels"][number],
        target: Enemy | undefined,
        angle: number,
        fromX = this.player.x,
        fromY = this.player.y,
    ): void {
        const speed = (level.speed * (1 + this.stats.speed)) / TICKS_PER_SECOND;
        const range = kind === "knife" ? 18 : 24;
        this.projectiles.push({
            uid: this.nextUid++,
            hero: this.hero.index,
            kind,
            weapon: def,
            x: fromX,
            y: fromY,
            prevX: fromX,
            prevY: fromY,
            vx: fm.cos(angle) * speed,
            vy: fm.sin(angle) * speed,
            speed,
            targetUid: target?.uid ?? 0,
            damage: level.damage,
            pierce: level.pierce,
            bounces: level.bounce ?? 0,
            venom: level.venom ?? 0,
            venomTicks: Math.round(level.duration * (1 + this.stats.duration) * TICKS_PER_SECOND),
            life: Math.ceil(range / Math.max(speed, 0.01)),
            radius: 0.4,
            splash: level.area > 0 ? level.area * (1 + this.stats.area) : 0,
            knockback: level.knockback,
            hit: new Set(),
            yaw: yawFromVector(fm.cos(angle), fm.sin(angle)),
            spotAnim: level.projectileSpotAnim ?? -1,
            impactSpotAnim: level.impactSpotAnim ?? -1,
            hitSound: level.hitSound ?? def.hitSound,
            objId: kind === "knife" ? (level.projectileObjId ?? level.objId ?? -1) : -1,
            startTick: this.tick,
            ...(def.split && { split: def.split }),
        });
    }

    // A cannonball or a thrall's projectile, steering towards its target
    private shootAt(
        kind: ProjectileKind,
        fromX: number,
        fromY: number,
        target: Enemy,
        damage: number,
        speed: number,
        knockback: number,
        spotAnim: number,
        impactSpotAnim = -1,
    ): void {
        const perTick = (speed * (1 + this.stats.speed)) / TICKS_PER_SECOND;
        const dx = target.x - fromX;
        const dy = target.y - fromY;
        const angle = fm.atan2(dy, dx);
        this.projectiles.push({
            uid: this.nextUid++,
            hero: this.hero.index,
            kind,
            x: fromX,
            y: fromY,
            prevX: fromX,
            prevY: fromY,
            vx: fm.cos(angle) * perTick,
            vy: fm.sin(angle) * perTick,
            speed: perTick,
            targetUid: target.uid,
            damage,
            pierce: 0,
            bounces: 0,
            venom: 0,
            venomTicks: 0,
            life: Math.ceil(24 / Math.max(perTick, 0.01)),
            radius: 0.4,
            splash: 0,
            knockback,
            hit: new Set(),
            yaw: yawFromVector(dx, dy),
            spotAnim,
            impactSpotAnim,
            hitSound: -1,
            objId: -1,
            startTick: this.tick,
        });
    }

    private placeCannon(effect: Extract<PowerUpEffect, { kind: "cannon" }>): void {
        const player = this.player;
        // A free spot next to the player (clear of them: it's drawn over two
        // tiles across), or under them
        let x = player.x;
        let y = player.y;
        const sideX = player.x - player.facingX * 2.2;
        const sideY = player.y - player.facingY * 2.2;
        if (isCircleFree(this.grid, sideX, sideY, 0.6)) {
            x = sideX;
            y = sideY;
        }
        const turret: Turret = {
            uid: this.nextUid++,
            hero: this.hero.index,
            x,
            y,
            yaw: player.yaw,
            startTick: this.tick,
            endTick: this.tick + this.powerUpTicks(effect.seconds),
            nextShot: this.tick + 15,
            damage: effect.damage * this.powerUpDamageScale(),
            range: effect.range * (1 + this.stats.area),
            amount: effect.amount + this.stats.amount,
            interval: this.cooldownTicks(effect.interval),
        };
        this.turrets.push(turret);
        this.emit({ type: "cannonSetup", x, y });
    }

    private stepTurrets(): void {
        for (const turret of this.turrets) {
            if (this.tick < turret.nextShot || this.tick >= turret.endTick) {
                continue;
            }
            this.useHeroAt(turret.hero);
            const targets = this.nearestEnemies(turret.x, turret.y, turret.range, turret.amount);
            if (targets.length === 0) {
                turret.nextShot = this.tick + 5;
                continue;
            }
            turret.nextShot = this.tick + turret.interval;
            turret.yaw = yawFromVector(targets[0].x - turret.x, targets[0].y - turret.y);
            this.emit({ type: "cannonFire", x: turret.x, y: turret.y });
            for (const target of targets) {
                this.shootAt(
                    "cannonball",
                    turret.x,
                    turret.y,
                    target,
                    turret.damage,
                    CANNONBALL_SPEED,
                    0.2,
                    CANNON_SPOTANIM,
                );
            }
        }
        this.turrets = this.turrets.filter((t) => this.tick < t.endTick);
    }

    // Raises a thrall (one of the three at random) beside the player
    private raiseThrall(seconds: number): Thrall {
        const def = THRALLS[this.rng.int(THRALLS.length)];
        const player = this.player;
        const thrall: Thrall = {
            uid: this.nextUid++,
            hero: this.hero.index,
            def,
            x: player.x,
            y: player.y,
            prevX: player.x,
            prevY: player.y,
            yaw: player.yaw,
            moving: false,
            attackStart: -1,
            cooldown: TICKS_PER_SECOND / 2,
            damage: def.damage * this.powerUpDamageScale(),
            startTick: this.tick,
            endTick: this.tick + this.powerUpTicks(seconds),
        };
        this.thralls.push(thrall);
        return thrall;
    }

    private stepThralls(): void {
        this.thralls = this.thralls.filter((t) => this.tick < t.endTick);
        this.thralls.forEach((thrall, index) => {
            this.useHeroAt(thrall.hero);
            const player = this.player;
            const def = thrall.def;
            thrall.prevX = thrall.x;
            thrall.prevY = thrall.y;
            if (thrall.cooldown > 0) {
                thrall.cooldown--;
            }
            // Ranged and magic thralls shoot what's near them; a melee one goes
            // after what's near the player
            const melee = def.style === "melee";
            const target = melee
                ? this.nearestEnemies(player.x, player.y, def.range, 1)[0]
                : this.nearestEnemies(thrall.x, thrall.y, def.range, 1)[0];

            // Up to its target, or behind the player (fanned out to either side)
            let goalX: number;
            let goalY: number;
            let stop: number;
            if (melee && target) {
                goalX = target.x;
                goalY = target.y;
                stop = THRALL_RADIUS + target.radius + 0.1;
            } else {
                const side = index % 2 === 0 ? 1 : -1;
                const angle =
                    fm.atan2(-player.facingY, -player.facingX) +
                    side * (0.7 + Math.floor(index / 2) * 0.5);
                goalX = player.x + fm.cos(angle) * THRALL_FOLLOW_DISTANCE;
                goalY = player.y + fm.sin(angle) * THRALL_FOLLOW_DISTANCE;
                stop = 0.3;
            }
            const dx = goalX - thrall.x;
            const dy = goalY - thrall.y;
            const distance = fm.hypot(dx, dy);
            thrall.moving = distance > stop;
            if (thrall.moving) {
                const move = Math.min(THRALL_SPEED, distance - stop);
                const moveX = (dx / distance) * move;
                const moveY = (dy / distance) * move;
                if (def.ghost) {
                    thrall.x += moveX;
                    thrall.y += moveY;
                } else {
                    moveCircle(this.grid, thrall, moveX, moveY, THRALL_RADIUS);
                }
                thrall.yaw = yawFromVector(dx, dy);
            }
            // Stuck behind a wall: back beside the player
            if (fm.hypot(player.x - thrall.x, player.y - thrall.y) > THRALL_LEASH) {
                thrall.x = thrall.prevX = player.x;
                thrall.y = thrall.prevY = player.y;
            }

            if (!target || thrall.cooldown > 0) {
                return;
            }
            const tx = target.x - thrall.x;
            const ty = target.y - thrall.y;
            const reach = melee ? THRALL_RADIUS + target.radius + 0.4 : def.range;
            if (fm.hypot(tx, ty) > reach) {
                return;
            }
            thrall.cooldown = this.cooldownTicks(def.interval);
            thrall.attackStart = this.tick;
            thrall.yaw = yawFromVector(tx, ty);
            this.emit({ type: "thrallAttack", sound: def.sound, x: thrall.x, y: thrall.y });
            if (melee) {
                this.damageSource = "powerUp:thrall";
                this.damageEnemy(target, thrall.damage, def.knockback, thrall.x, thrall.y);
            } else {
                this.shootAt(
                    "spell",
                    thrall.x,
                    thrall.y,
                    target,
                    thrall.damage,
                    THRALL_PROJECTILE_SPEED,
                    def.knockback,
                    def.projectileSpotAnim ?? -1,
                    def.impactSpotAnim ?? -1,
                );
            }
        });
    }

    private fireAura(def: WeaponDef, level: WeaponDef["levels"][number]): void {
        const player = this.player;
        const radius = level.area * (1 + this.stats.area);
        this.emit({ type: "aura", x: player.x, y: player.y, radius });
        const hit: Enemy[] = [];
        this.enemyHash.query(player.x, player.y, radius + 0.5, (enemy) => {
            if (fm.hypot(enemy.x - player.x, enemy.y - player.y) <= radius + enemy.radius) {
                hit.push(enemy);
            }
        });
        let effects = 0;
        for (const enemy of hit) {
            if (def.freezes) {
                this.freezeEnemy(enemy, level.duration);
            }
            if (level.impactSpotAnim !== undefined && effects < 10) {
                this.addEffect(level.impactSpotAnim, enemy.x, enemy.y, 0, 60, enemy.uid);
                effects++;
            }
            const dealt = this.damageEnemy(
                enemy,
                level.damage,
                level.knockback,
                player.x,
                player.y,
            );
            this.spellHitEffects(def, level, enemy, dealt);
        }
        if (def.burns) {
            this.burnGround(def.burns, level);
        }
    }

    // Leaves the ground around the player burning for the level's duration
    // (Toktz-mej-tal), with flames across it. A pulse where the ground's
    // already burning keeps that fire going instead, and only a few burn at
    // once (the oldest goes out).
    private burnGround(
        burns: NonNullable<WeaponDef["burns"]>,
        level: WeaponDef["levels"][number],
    ): void {
        const { x, y } = this.player;
        const ticks = Math.round(level.duration * (1 + this.stats.duration) * TICKS_PER_SECOND);
        const endTick = this.tick + ticks;
        // A share of the aura's own reach, so it grows with its area bonuses
        const radius = level.area * (1 + this.stats.area) * burns.radius;
        const damage = level.damage * burns.damage;
        const same = this.fires.find(
            (fire) => fm.hypot(fire.x - x, fire.y - y) < fire.radius * FIRE_MERGE,
        );
        if (same) {
            same.endTick = Math.max(same.endTick, endTick);
            same.damage = Math.max(same.damage, damage);
            return;
        }
        if (this.fires.length >= MAX_FIRES) {
            this.fires.shift();
        }
        const flames: Vec2[] = [];
        for (let i = 0; i < FIRE_FLAMES; i++) {
            // One in the middle, the rest around it
            const angle = (i / (FIRE_FLAMES - 1)) * Math.PI * 2;
            const r = i === 0 ? 0 : radius * 0.6;
            flames.push({ x: x + fm.cos(angle) * r, y: y + fm.sin(angle) * r });
        }
        this.fires.push({
            uid: this.nextUid++,
            hero: this.hero.index,
            source: this.damageSource,
            x,
            y,
            radius,
            damage,
            nextTick: this.tick + FIRE_INTERVAL,
            endTick,
            locId: burns.locId,
            flames,
        });
    }

    // Burning ground hurts whatever's standing in it every so often
    private stepFires(): void {
        if (this.fires.length === 0) {
            return;
        }
        this.fires = this.fires.filter((fire) => fire.endTick > this.tick);
        for (const fire of this.fires) {
            if (this.tick < fire.nextTick) {
                continue;
            }
            fire.nextTick += FIRE_INTERVAL;
            this.useHeroAt(fire.hero);
            this.damageSource = fire.source;
            this.enemyHash.query(fire.x, fire.y, fire.radius + 0.5, (enemy) => {
                if (fm.hypot(enemy.x - fire.x, enemy.y - fire.y) <= fire.radius + enemy.radius) {
                    this.damageEnemy(enemy, fire.damage, 0, fire.x, fire.y);
                }
            });
        }
    }

    private fireStrikes(def: WeaponDef, level: WeaponDef["levels"][number]): boolean {
        const player = this.player;
        const candidates = this.nearestEnemies(player.x, player.y, 12, 60);
        if (candidates.length === 0) {
            return false;
        }
        const amount = level.amount + this.stats.amount;
        const radius = level.area * (1 + this.stats.area);
        for (let i = 0; i < amount && candidates.length > 0; i++) {
            const index = this.rng.int(candidates.length);
            const target = candidates[index];
            candidates.splice(index, 1);
            if (level.impactSpotAnim !== undefined) {
                this.addEffect(level.impactSpotAnim, target.x, target.y, 0, 30);
            }
            const tx = target.x;
            const ty = target.y;
            this.enemyHash.query(tx, ty, radius + 0.5, (enemy) => {
                if (
                    enemy === target ||
                    fm.hypot(enemy.x - tx, enemy.y - ty) <= radius + enemy.radius
                ) {
                    if (def.freezes) {
                        this.freezeEnemy(enemy, level.duration);
                    }
                    const dealt =
                        this.damageEnemy(enemy, level.damage, level.knockback, tx, ty) +
                        this.bigHits(def, enemy, level.damage, tx, ty);
                    this.spellHitEffects(def, level, enemy, dealt);
                }
            });
        }
        return true;
    }

    private stepProjectiles(): void {
        const enemiesByUid = new Map<number, Enemy>();
        for (const enemy of this.enemies) {
            if (!enemy.dead) {
                enemiesByUid.set(enemy.uid, enemy);
            }
        }
        for (const projectile of this.projectiles) {
            projectile.prevX = projectile.x;
            projectile.prevY = projectile.y;
            projectile.life--;
            this.useHeroAt(projectile.hero);
            if (projectile.orbit) {
                this.stepOrbit(projectile, projectile.orbit);
                continue;
            }
            // Spells, axes and cannonballs steer towards their target
            const target = projectile.targetUid
                ? enemiesByUid.get(projectile.targetUid)
                : undefined;
            if (target) {
                const dx = target.x - projectile.x;
                const dy = target.y - projectile.y;
                const len = fm.hypot(dx, dy);
                if (len > 0.001) {
                    projectile.vx = (dx / len) * projectile.speed;
                    projectile.vy = (dy / len) * projectile.speed;
                    projectile.yaw = yawFromVector(dx, dy);
                }
            }
            projectile.x += projectile.vx;
            projectile.y += projectile.vy;

            // An axe that has bounced is on its way to the next one
            let bounced = false;
            // Venom darts fly past everything but what they're aimed at, so
            // the venom spreads
            const only = projectile.venom > 0 && target ? target.uid : 0;
            this.enemyHash.query(projectile.x, projectile.y, projectile.radius + 0.5, (enemy) => {
                if (
                    bounced ||
                    projectile.life <= 0 ||
                    enemy.dead ||
                    projectile.hit.has(enemy.uid) ||
                    (only !== 0 && enemy.uid !== only)
                ) {
                    return;
                }
                const reach = projectile.radius + enemy.radius;
                if (fm.hypot(enemy.x - projectile.x, enemy.y - projectile.y) > reach) {
                    return;
                }
                projectile.hit.add(enemy.uid);
                this.projectileHit(projectile, enemy);
                if (projectile.bounces > 0 && this.bounce(projectile, enemy)) {
                    bounced = true;
                } else if (projectile.pierce > 0) {
                    projectile.pierce--;
                    // Pass through, and stop steering at the one already hit
                    if (projectile.targetUid === enemy.uid) {
                        projectile.targetUid = 0;
                    }
                } else {
                    projectile.life = 0;
                }
            });
        }
    }

    // Goes round the player, hitting whatever's in the way (knocked outwards)
    private stepOrbit(projectile: Projectile, orbit: NonNullable<Projectile["orbit"]>): void {
        const player = this.player;
        const angle = orbit.angle + (this.tick - projectile.startTick) * orbit.angularSpeed;
        projectile.x = player.x + fm.cos(angle) * orbit.radius;
        projectile.y = player.y + fm.sin(angle) * orbit.radius;
        projectile.yaw = yawFromVector(-fm.sin(angle), fm.cos(angle));
        this.enemyHash.query(projectile.x, projectile.y, projectile.radius + 0.5, (enemy) => {
            if (enemy.dead || (orbit.nextHit.get(enemy.uid) ?? 0) > this.tick) {
                return;
            }
            const reach = projectile.radius + enemy.radius;
            if (fm.hypot(enemy.x - projectile.x, enemy.y - projectile.y) > reach) {
                return;
            }
            orbit.nextHit.set(enemy.uid, this.tick + orbit.rehitTicks);
            this.damageSource = projectileSource(projectile);
            const dealt = this.damageEnemy(
                enemy,
                projectile.damage,
                projectile.knockback,
                player.x,
                player.y,
            );
            if (projectile.weapon) {
                this.stealLife(projectile.weapon, dealt);
            }
        });
    }

    private projectileHit(projectile: Projectile, enemy: Enemy): void {
        if (projectile.impactSpotAnim !== -1) {
            this.addEffect(projectile.impactSpotAnim, enemy.x, enemy.y, 0, 30, enemy.uid);
        }
        if (projectile.hitSound !== -1) {
            this.emit({
                type: "impact",
                sound: projectile.hitSound,
                x: enemy.x,
                y: enemy.y,
            });
        }
        const weapon = projectile.weapon;
        const mightScale = weapon?.mightScale ?? 1;
        this.damageSource = projectileSource(projectile);
        let damage = projectile.damage;
        if (weapon?.toughTargets) {
            damage *= 1 + (weapon.toughTargets * enemy.maxHp) / (enemy.maxHp + TOUGH_TARGET_HP);
        }
        if (weapon) {
            damage *= this.slayerScale(weapon, enemy);
        }
        // An enchanted bolt's effect, now and then (the Armadyl crossbow)
        const procs = weapon?.boltProcs;
        const proc =
            procs && this.rng.chance(procs.chance)
                ? procs.procs[this.rng.weightedIndex(procs.procs.map((p) => p.weight))]
                : undefined;
        if (proc?.effect.kind === "pierce") {
            damage *= 1 + proc.effect.damage;
            projectile.pierce += proc.effect.pierce;
        }
        const dealt = this.damageEnemy(
            enemy,
            damage,
            projectile.knockback,
            projectile.x - projectile.vx,
            projectile.y - projectile.vy,
            mightScale,
        );
        if (weapon) {
            this.bigHits(weapon, enemy, damage, projectile.x, projectile.y);
        }
        if (projectile.venom > 0 && !enemy.dead) {
            this.envenom(enemy, projectile.venom, projectile.venomTicks);
        }
        if (weapon) {
            this.stealLife(weapon, dealt);
        }
        if (proc) {
            this.boltProc(proc, projectile, enemy);
        }
        if (projectile.split) {
            this.splitProjectile(projectile, projectile.split, enemy);
        }
        if (projectile.splash > 0) {
            const x = enemy.x;
            const y = enemy.y;
            this.enemyHash.query(x, y, projectile.splash + 0.5, (other) => {
                if (other !== enemy && fm.hypot(other.x - x, other.y - y) <= projectile.splash) {
                    this.damageEnemy(
                        other,
                        projectile.damage * 0.5,
                        projectile.knockback,
                        x,
                        y,
                        mightScale,
                    );
                }
            });
        }
    }

    // What an enchanted bolt does besides its hit: a ruby takes a share of
    // what's left of the target's hitpoints (whatever the damage bonus), a
    // dragonstone sets it burning
    private boltProc(proc: BoltProcDef, projectile: Projectile, enemy: Enemy): void {
        this.addEffect(proc.spotAnim, enemy.x, enemy.y, 0, 40, enemy.uid);
        const effect = proc.effect;
        if (enemy.dead) {
            return;
        }
        if (effect.kind === "hpFraction") {
            const damage = Math.min(enemy.hp * effect.fraction, projectile.damage * effect.max);
            this.damageEnemy(enemy, damage, 0, enemy.x, enemy.y, 0);
        } else if (effect.kind === "burn") {
            this.envenom(
                enemy,
                projectile.damage * effect.damage,
                Math.round(effect.seconds * (1 + this.stats.duration) * TICKS_PER_SECOND),
            );
        }
    }

    // Splits a shot where it first hits into more, which fly on to the
    // nearest other enemies, or fan out when there aren't enough (the Crystal
    // bow's arrows)
    private splitProjectile(
        projectile: Projectile,
        split: NonNullable<Projectile["split"]>,
        from: Enemy,
    ): void {
        projectile.split = undefined;
        const targets = this.nearestEnemies(from.x, from.y, SPLIT_RANGE, split.count + 1).filter(
            (e) => e !== from,
        );
        const ahead = fm.atan2(projectile.vy, projectile.vx);
        for (let i = 0; i < split.count; i++) {
            const target = targets[i];
            const angle = target
                ? fm.atan2(target.y - from.y, target.x - from.x)
                : ahead + (i - (split.count - 1) / 2) * 0.6;
            this.projectiles.push({
                ...projectile,
                uid: this.nextUid++,
                x: from.x,
                y: from.y,
                prevX: from.x,
                prevY: from.y,
                vx: fm.cos(angle) * projectile.speed,
                vy: fm.sin(angle) * projectile.speed,
                targetUid: target?.uid ?? 0,
                damage: projectile.damage * split.damage,
                pierce: split.pierce,
                life: Math.ceil((SPLIT_RANGE * 2) / Math.max(projectile.speed, 0.01)),
                hit: new Set([from.uid]),
                yaw: yawFromVector(fm.cos(angle), fm.sin(angle)),
                startTick: this.tick,
                split: undefined,
            });
        }
    }

    addEffect(
        spotAnim: number,
        x: number,
        y: number,
        height: number,
        ticks: number,
        enemyUid = 0,
        loop = false,
    ): Effect | undefined {
        if (this.effects.length >= MAX_EFFECTS) {
            return undefined;
        }
        const effect: Effect = {
            uid: this.nextUid++,
            spotAnim,
            x,
            y,
            height,
            startTick: this.tick,
            endTick: this.tick + ticks,
            enemyUid,
            ...(loop && { loop }),
        };
        this.effects.push(effect);
        return effect;
    }

    // ---- Halloween: disguises, stomps, pools, pumpkins, trophies ----

    // A boss event: the boss, or the casket it's hiding in. False if there's
    // nowhere to put it this tick.
    private bringOnBoss(def: EnemyDef, type: "boss" | "finalBoss", hp?: number): boolean {
        if (def.disguise && type === "boss") {
            return this.layDisguise(def, hp);
        }
        return this.spawnBoss(def, type, hp) !== undefined;
    }

    // Looks like any casket dropping, toast and all, close enough to tempt
    private layDisguise(def: EnemyDef, hp: number | undefined): boolean {
        const disguise = def.disguise!;
        const pos = this.findSpawnPoint(def, DISGUISE_MIN_DISTANCE, DISGUISE_MAX_DISTANCE);
        if (!pos) {
            return false;
        }
        const { x, y } = this.walkableSpot(pos.x, pos.y);
        this.dropPickup("casket", x, y, 1, {
            tier: disguise.casket,
            disguise: {
                enemyId: def.id,
                hp,
                shakeTick: this.tick + Math.round(disguise.seconds * TICKS_PER_SECOND),
                openTick: -1,
            },
        });
        this.emit({ type: "casketDropped", tier: disguise.casket, x, y });
        return true;
    }

    // It stays put (a magnet doesn't move it), shakes when it's walked onto or
    // left too long, and then opens: there's a moment to step away first
    private stepDisguise(pickup: Pickup): void {
        const disguise = pickup.disguise!;
        const def = getEnemy(disguise.enemyId);
        // Anyone walking onto it
        let near = false;
        this.forEachHeroInReach(() => {
            near ||= fm.hypot(this.player.x - pickup.x, this.player.y - pickup.y) < DISGUISE_TOUCH;
        });
        if (disguise.openTick === -1 && (near || this.tick >= disguise.shakeTick)) {
            const ticks = Math.round(def.disguise!.shake * TICKS_PER_SECOND);
            disguise.openTick = this.tick + ticks;
            this.emit({ type: "notice", message: "The casket shudders..." });
            this.showDisguiseWarning(pickup, def, ticks);
        }
        if (disguise.openTick !== -1 && this.tick >= disguise.openTick) {
            this.revealBoss(pickup, def);
        }
    }

    // The ring of what's about to come out, around the shaking casket
    private showDisguiseWarning(pickup: Pickup, def: EnemyDef, ticks: number): void {
        const warning = def.disguise!.warning;
        if (!warning) {
            return;
        }
        const { spotAnims, count, ringRadius } = warning;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const x = pickup.x + fm.cos(angle) * ringRadius;
            const y = pickup.y + fm.sin(angle) * ringRadius;
            this.addEffect(spotAnims[i % spotAnims.length], x, y, 0.3, ticks, 0, true);
        }
    }

    private revealBoss(pickup: Pickup, def: EnemyDef): void {
        const boss = this.spawnEnemy(
            def,
            "boss",
            { x: pickup.x, y: pickup.y },
            pickup.disguise!.hp,
        );
        if (!boss) {
            return;
        }
        pickup.value = -1;
        const seq = def.disguise!.seq;
        if (seq !== undefined) {
            boss.anim = "attack";
            boss.animStart = this.tick;
            boss.attackSeq = seq;
        }
        boss.attackCooldown = DISGUISE_ATTACK_DELAY;
        if (def.spawnSpotAnim !== undefined) {
            this.addEffect(def.spawnSpotAnim, boss.x, boss.y, 0, 60);
        }
        this.emit({
            type: "bossSpawned",
            enemyId: def.id,
            name: def.name,
            message: def.spawnMessage ?? `${def.name} has appeared!`,
            finalBoss: false,
            x: boss.x,
            y: boss.y,
        });
    }

    // Standing under a boss that stomps (BossDef.stomp)
    private stepStomp(enemy: Enemy): void {
        const stomp = enemy.def.boss!.stomp;
        if (!stomp) {
            return;
        }
        const state = enemy.bossState!;
        // Whoever's under it, and of them, who it can hurt now
        const under: Hero[] = [];
        const hurt: Hero[] = [];
        this.forEachHeroInReach(() => {
            const player = this.player;
            if (fm.hypot(player.x - enemy.x, player.y - enemy.y) <= stomp.radius) {
                under.push(this.hero);
                if (!this.reviving && player.invulnerable <= 0) {
                    hurt.push(this.hero);
                }
            }
        });
        if (under.length === 0) {
            state.stomps = 0;
            state.nextStomp = undefined;
            return;
        }
        const interval = Math.round(stomp.interval * TICKS_PER_SECOND);
        state.nextStomp ??= this.tick + interval;
        if (this.tick < state.nextStomp || hurt.length === 0) {
            return;
        }
        state.stomps = (state.stomps ?? 0) + 1;
        state.nextStomp = this.tick + interval;
        const damage = Math.min(stomp.max, stomp.damage * state.stomps) * enemy.damageScale;
        const current = this.hero;
        for (const hero of hurt) {
            if (!this.runOver) {
                this.use(hero);
                this.damagePlayer(damage, enemy.def.id, false, stomp.sound);
            }
        }
        this.use(current);
    }

    // What a blast leaves behind where it lands, besides its hit
    private landBlastExtras(enemy: Enemy, windup: BossWindup): void {
        const attack = windup.attack;
        if (attack.kind !== "blast") {
            return;
        }
        const pool = attack.pool;
        if (pool) {
            for (const { x, y } of windup.targets) {
                this.pools.push({
                    uid: this.nextUid++,
                    enemyId: enemy.def.id,
                    x,
                    y,
                    radius: pool.radius,
                    damage: pool.damage * enemy.damageScale,
                    interval: Math.round(pool.interval * TICKS_PER_SECOND),
                    effect: pool.effect,
                    locId: pool.locId,
                    startTick: this.tick,
                    endTick: this.tick + Math.round(pool.seconds * TICKS_PER_SECOND),
                    nextTick: 0,
                });
            }
            this.pools.splice(0, Math.max(0, this.pools.length - MAX_POOLS));
        }
        attack.impactSpotAnims?.forEach((spotAnim, i) => {
            const spot = windup.targets[i];
            if (spot) {
                this.addEffect(spotAnim, spot.x, spot.y, 0, 40);
            }
        });
        const candies = attack.candies ?? [];
        const first = windup.targets.length - candies.length;
        candies.forEach((id, i) => {
            const spot = windup.targets[first + i];
            if (spot) {
                this.bringMinion(enemy, getEnemy(id), spot);
            }
        });
    }

    // One of a boss's minions, unless it still has that kind up: they come
    // back with the next attack, and there's nothing to farm
    private bringMinion(boss: Enemy, def: EnemyDef, at: { x: number; y: number }): void {
        const up = this.enemies.some((e) => !e.dead && e.def === def && e.spawnedBy === boss.uid);
        if (up) {
            return;
        }
        const spot = this.canTurnUpAt(def, at.x, at.y) ? at : { x: boss.x, y: boss.y };
        const minion = this.spawnEnemy(def, "normal", spot);
        if (minion) {
            minion.spawnedBy = boss.uid;
            minion.noDrops = true;
        }
    }

    // A pool hurts a player standing in it, and not one who's stepped out,
    // however long ago it last hit them
    private stepPools(): void {
        if (this.pools.length === 0) {
            return;
        }
        this.pools = this.pools.filter((pool) => pool.endTick > this.tick);
        for (const pool of this.pools) {
            if (this.tick < pool.nextTick) {
                continue;
            }
            // Each of them standing in it
            this.forEachHeroInReach(() => {
                const player = this.player;
                const inside =
                    fm.hypot(player.x - pool.x, player.y - pool.y) <= pool.radius + player.radius;
                if (!inside || player.invulnerable > 0 || this.reviving || this.runOver) {
                    return;
                }
                pool.nextTick = this.tick + pool.interval;
                this.damagePlayer(pool.damage, pool.enemyId, false);
                if (pool.effect && !this.runOver && !this.reviving) {
                    this.applyPlayerEffect(pool.effect);
                }
            });
        }
    }

    // A debuff as it stands with this dose: a stacking one is its stats times
    // the doses so far
    private stackDebuff(
        effect: Extract<PlayerEffectDef, { kind: "debuff" }>,
    ): Pick<Debuff, "id" | "name" | "iconObjId" | "stats" | "stacks"> {
        const { id, name, iconObjId, stats, stacks: most } = effect;
        if (most === undefined) {
            return { id, name, iconObjId, stats };
        }
        const had = this.debuffs.find((d) => d.id === id)?.stacks ?? 0;
        const stacks = Math.min(most, had + 1);
        const stacked = Object.fromEntries(
            Object.entries(stats).map(([key, value]) => [key, value * stacks]),
        );
        return {
            id,
            name: stacks > 1 ? `${name} x${stacks}` : name,
            iconObjId,
            stats: stacked,
            stacks,
        };
    }

    // Enemies on some maps now and then drop a pumpkin (see trickOrTreat.ts)
    private rollPumpkin(x: number, y: number): void {
        if (!PUMPKIN_MAPS.includes(this.map.id) || this.tick < this.nextPumpkinTick) {
            return;
        }
        if (this.rng.chance(PUMPKIN_CHANCE * (1 + this.stats.luck))) {
            this.nextPumpkinTick = this.tick + PUMPKIN_MIN_GAP * TICKS_PER_SECOND;
            const spot = this.walkableSpot(x, y);
            this.dropPickup("powerUp", spot.x, spot.y, 1, { powerUp: PUMPKIN_ID });
        }
    }

    // Now and then a treat holds a trophy instead; otherwise it's a treat or a
    // trick by weight. What it says as it opens.
    private openPumpkin(): string {
        const trophy = TROPHIES.find(
            ({ from }) => from.kind === "pumpkin" && this.rng.chance(from.chance),
        );
        if (trophy) {
            this.emit({ type: "playerShout", text: "Treat!" });
            return this.findTrophy(trophy);
        }
        const index = this.rng.weightedIndex(PUMPKIN_OUTCOMES.map((o) => o.weight));
        const outcome = PUMPKIN_OUTCOMES[index];
        const player = this.player;
        const does = outcome.does;
        switch (does.kind) {
            case "heal":
                this.heal(player.maxHp * does.fraction);
                break;
            case "coins":
                this.coins += Math.round(does.coins * (1 + this.stats.greed) * this.coinScale);
                break;
            case "buff":
                this.addBuff(does.itemId, does.stats, does.seconds, false);
                break;
            case "enemies": {
                const def = getEnemy(does.enemyId);
                for (let i = 0; i < does.count; i++) {
                    const enemy = this.spawnNear(player, def, 2.5, i, does.count, 3);
                    if (enemy) {
                        enemy.bonesOnly = true;
                    }
                }
                break;
            }
            case "effect":
                this.applyPlayerEffect(does.effect);
                break;
        }
        this.emit({ type: "playerShout", text: outcome.trick ? "Trick!" : "Treat!" });
        return outcome.message;
    }

    // Collection log trophies a boss can drop on its map
    // (each of the party their own)
    private rollBossTrophies(enemy: Enemy): void {
        if (!enemy.boss) {
            return;
        }
        this.forEachHeroInReach(() => {
            for (const trophy of TROPHIES) {
                const { from } = trophy;
                if (
                    from.kind === "boss" &&
                    from.enemyId === enemy.def.id &&
                    from.mapId === this.map.id &&
                    this.rng.chance(from.chance)
                ) {
                    this.emit({ type: "notice", message: this.findTrophy(trophy) }, true);
                }
            }
        });
    }

    private findTrophy(trophy: TrophyDef): string {
        this.trophies.add(trophy.id);
        return `New item added to your collection log: ${trophy.name}`;
    }

    // ---- Pickups ----

    dropCasket(x: number, y: number, elite: boolean): void {
        this.dropCasketOfTier(rollCasketTier(this.rng, this.seconds, elite, this.stats.luck), x, y);
    }

    // guaranteed: past the chance of a late endless casket, though not its limit
    private dropCasketOfTier(tier: CasketTier, x: number, y: number, guaranteed = false): void {
        if (this.endless && this.seconds >= LATE_CASKET_SECONDS) {
            if (!guaranteed && !this.rng.chance(LATE_CASKET_CHANCE)) {
                return;
            }
            const onGround = this.pickups.filter((pickup) => pickup.kind === "casket").length;
            if (onGround >= LATE_CASKET_LIMIT) {
                this.emit({
                    type: "notice",
                    message: "You have a funny feeling there would've been a chest",
                });
                return;
            }
        }
        const spot = this.walkableSpot(x, y);
        this.dropPickup("casket", spot.x, spot.y, 1, { tier });
        this.emit({ type: "casketDropped", tier, x: spot.x, y: spot.y });
    }

    // Where to put something that needs walking over: what dropped it can be
    // somewhere the player can't get to (a portal stands on solid tiles, ghosts
    // go through walls), and its drop can land past a wall
    private walkableSpot(x: number, y: number): Vec2 {
        return findFreeSpot(this.grid, x, y, PLAYER_RADIUS, (tileX, tileY) =>
            this.isWalkableTile(tileX, tileY),
        );
    }

    // Whether there's a way to the player from this tile. Beyond the flow field
    // there's no telling, so it's taken as a yes. It says yes to solid tiles
    // beside open ground too, so check there's room as well.
    private isWalkableTile(tileX: number, tileY: number): boolean {
        const field = this.flowField;
        return !field.contains(tileX, tileY) || field.isReachable(tileX, tileY);
    }

    dropPickup(
        kind: PickupKind,
        x: number,
        y: number,
        value: number,
        extra: Pick<Pickup, "tier" | "powerUp" | "disguise"> = {},
    ): void {
        if (kind === "bones" && this.pickups.length >= MAX_PICKUPS) {
            // Too many lying around: the pile furthest from the player comes
            // here and takes these on too. Piles left behind as the player
            // moves on would otherwise keep what they're worth for good.
            const player = this.player;
            let pile: Pickup | undefined;
            let furthest = -1;
            for (const pickup of this.pickups) {
                // (one already flying to the player, or to another pile, stays
                // where it is)
                if (pickup.kind !== "bones" || pickup.attracted || pickup.pileUid !== 0) {
                    continue;
                }
                const d = Math.abs(pickup.x - player.x) + Math.abs(pickup.y - player.y);
                if (d > furthest) {
                    furthest = d;
                    pile = pickup;
                }
            }
            if (pile) {
                pile.x = pile.prevX = x;
                pile.y = pile.prevY = y;
                pile.value += value;
                return;
            }
        }
        this.pickups.push({
            uid: this.nextUid++,
            kind,
            x,
            y,
            prevX: x,
            prevY: y,
            value,
            attracted: false,
            speed: 0,
            spawnTick: this.tick,
            pileUid: 0,
            ...extra,
        });
    }

    private stepPickups(): void {
        // For bones and coins on their way to a bigger pile
        const pilesByUid = this.pickups.some((p) => p.pileUid !== 0)
            ? new Map(this.pickups.map((p) => [p.uid, p]))
            : undefined;
        for (const pickup of this.pickups) {
            pickup.prevX = pickup.x;
            pickup.prevY = pickup.y;
            if (pickup.disguise) {
                this.stepDisguise(pickup);
                continue;
            }
            if (
                pickup.kind === "powerUp" &&
                !pickup.attracted &&
                this.tick - pickup.spawnTick >= POWER_UP_LIFETIME * TICKS_PER_SECOND
            ) {
                pickup.value = -1;
                continue;
            }
            // Whoever's nearest gets it
            this.use(this.nearestHero(pickup.x, pickup.y));
            const player = this.player;
            const magnet = BASE_MAGNET * (1 + this.stats.magnet);
            const dx = player.x - pickup.x;
            const dy = player.y - pickup.y;
            const distance = fm.hypot(dx, dy);
            // Caskets and power-ups need walking over
            const magnetic = pickup.kind !== "casket" && pickup.kind !== "powerUp";
            if (!pickup.attracted && magnetic && distance < magnet) {
                pickup.attracted = true;
                pickup.speed = 0.05;
            }
            if (pickup.attracted) {
                pickup.pileUid = 0;
                if (distance > 0.001) {
                    pickup.speed = Math.min(pickup.speed + 0.02, 0.6);
                    const move = Math.min(pickup.speed, distance);
                    pickup.x += (dx / distance) * move;
                    pickup.y += (dy / distance) * move;
                }
            } else if (pickup.pileUid !== 0) {
                this.slideIntoPile(pickup, pilesByUid?.get(pickup.pileUid));
                if (pickup.value < 0) {
                    continue;
                }
            }
            if (distance < 0.6) {
                this.collect(pickup);
                pickup.value = -1;
            }
        }
        if (this.tick % PILE_INTERVAL === 0) {
            this.gatherPiles();
        }
        this.pickups = this.pickups.filter((p) => p.value >= 0);
    }

    // Bones lying near a bigger pile go over to join it, so a crowd's bones
    // end up as a few piles worth all of theirs instead of littering the map.
    // Coins do the same. The biggest piles stay where they are, and nothing
    // goes further from the player to join one: bones the player's about to
    // walk over would be dragged away, and the run would level slower.
    private gatherPiles(): void {
        const away = (p: Pickup) => {
            const player = this.nearestHero(p.x, p.y).player;
            return fm.hypot(p.x - player.x, p.y - player.y);
        };
        const loose = this.pickups.filter(
            (p) =>
                (p.kind === "bones" || p.kind === "coins") &&
                p.value >= 0 &&
                !p.attracted &&
                p.pileUid === 0,
        );
        // Biggest first (ties to the oldest: the sort keeps their order)
        loose.sort((a, b) => b.value - a.value);
        const hash = this.pileHash;
        hash.clear();
        for (const pickup of loose) {
            hash.insert(pickup);
        }
        // Piles that have taken others on, or are going to one
        const placed = new Set<Pickup>();
        for (const pile of loose) {
            if (placed.has(pile)) {
                continue;
            }
            placed.add(pile);
            const pileAway = away(pile);
            hash.query(pile.x, pile.y, PILE_RADIUS, (other) => {
                if (
                    other.kind === pile.kind &&
                    !placed.has(other) &&
                    away(other) >= pileAway &&
                    fm.hypot(other.x - pile.x, other.y - pile.y) <= PILE_RADIUS
                ) {
                    other.pileUid = pile.uid;
                    other.speed = 0;
                    placed.add(other);
                }
            });
        }
    }

    // Slides a little pile towards the one it's joining, and adds what it's
    // worth to that one when it gets there
    private slideIntoPile(pickup: Pickup, pile: Pickup | undefined): void {
        if (!pile || pile.value < 0) {
            // That one's been picked up already: this one stays put
            pickup.pileUid = 0;
            return;
        }
        const dx = pile.x - pickup.x;
        const dy = pile.y - pickup.y;
        const distance = fm.hypot(dx, dy);
        pickup.speed = Math.min(pickup.speed + 0.02, 0.3);
        if (distance <= pickup.speed) {
            pile.value += pickup.value;
            pickup.value = -1;
            return;
        }
        pickup.x += (dx / distance) * pickup.speed;
        pickup.y += (dy / distance) * pickup.speed;
    }

    private collect(pickup: Pickup): void {
        this.emit({ type: "pickup", kind: pickup.kind, value: pickup.value });
        switch (pickup.kind) {
            case "bones":
                this.xp += pickup.value * (1 + this.stats.growth);
                break;
            case "coins":
                this.coins += Math.round(pickup.value * (1 + this.stats.greed) * this.coinScale);
                break;
            case "food":
                this.heal(pickup.value);
                break;
            case "casket":
                this.openCasket(pickup.tier ?? "medium");
                break;
            case "powerUp":
                this.usePowerUp(getPowerUp(pickup.powerUp ?? ""));
                break;
        }
    }

    // ---- Power-ups ----

    // A kill is likelier to drop a power-up the longer it's been since the
    // last. A higher rate runs that clock faster, and the cube is what makes
    // them come that much more often: the time between them goes as one over
    // the cube root of the chance.
    private rollPowerUp(x: number, y: number): void {
        const rate = 1 + this.stats.powerUpRate;
        const seconds = (this.tick - this.lastPowerUpTick) / TICKS_PER_SECOND;
        if (seconds * rate < POWER_UP_MIN_GAP) {
            return;
        }
        const minutes = seconds / 60;
        const chance =
            POWER_UP_CHANCE * fm.pow(rate, 3) * minutes * minutes * (1 + this.stats.luck);
        if (this.rng.chance(chance)) {
            this.dropPowerUp(this.rollPowerUpId(), x, y);
        }
    }

    private rollPowerUpId(): string {
        const index = this.rng.weightedIndex(
            POWER_UPS.map((p) => (p.id === this.lastPowerUpId ? 0 : p.weight)),
        );
        return POWER_UPS[index].id;
    }

    dropPowerUp(id: string, x: number, y: number): void {
        this.lastPowerUpTick = this.tick;
        this.lastPowerUpId = id;
        const spot = this.walkableSpot(x, y);
        this.dropPickup("powerUp", spot.x, spot.y, 1, { powerUp: id });
    }

    // Power-ups' damage keeps up with the enemies' hitpoints
    private powerUpDamageScale(): number {
        return (
            this.enemyHpScale() *
            this.map.difficulty.hp *
            this.roundHp *
            this.hardScale.hp *
            this.partyScale.hp
        );
    }

    private powerUpTicks(seconds: number): number {
        return Math.round(seconds * (1 + this.stats.duration) * TICKS_PER_SECOND);
    }

    // Does what a power-up does, there and then
    usePowerUp(def: PowerUpDef): void {
        const player = this.player;
        const effect = def.effect;
        let message: string;
        let endTick = 0;
        switch (effect.kind) {
            case "cannon":
                this.placeCannon(effect);
                endTick = this.turrets[this.turrets.length - 1].endTick;
                message = "You set up a dwarf multicannon!";
                break;
            case "thrall": {
                const thrall = this.raiseThrall(effect.seconds);
                endTick = thrall.endTick;
                message = `A ${thrall.def.name.toLowerCase()} rises to fight for you!`;
                break;
            }
            case "nuke": {
                this.damageSource = `powerUp:${def.id}`;
                const banned = this.nuke(effect.bossDamage);
                message = `Bot nuke! ${banned} ${banned === 1 ? "bot" : "bots"} banned.`;
                break;
            }
            case "magnet":
                for (const pickup of this.pickups) {
                    pickup.attracted = true;
                    pickup.speed = Math.max(pickup.speed, 0.15);
                }
                message =
                    this.heroes.length > 1
                        ? "Everything on the ground flies to whoever's nearest!"
                        : "Everything on the ground flies to you!";
                break;
            case "freeze":
                endTick = Math.max(
                    this.freezeEndTick,
                    this.tick + this.powerUpTicks(effect.seconds),
                );
                this.freezeEndTick = endTick;
                for (const enemy of this.enemies) {
                    if (!enemy.dead && !enemy.boss) {
                        enemy.frozen = Math.max(enemy.frozen, endTick - this.tick);
                    }
                }
                message = "Time stands still!";
                break;
            case "sled":
                endTick = this.tick + effect.seconds * TICKS_PER_SECOND;
                this.sledEndTick = endTick;
                this.sledSpeed = effect.speed;
                // Whatever had them stuck, they're off
                player.frozen = 0;
                this.hold = undefined;
                message = "You jump on the sled!";
                break;
            case "rock":
                this.dropRock(def, effect);
                message = "Something huge is coming down...";
                break;
            case "rampage":
                endTick = this.startRampage(def, effect).endTick;
                message = "Evil Bob has come for his revenge!";
                break;
            case "ring":
                endTick = this.tick + this.powerUpTicks(effect.seconds);
                this.rings.push({
                    uid: this.nextUid++,
                    hero: this.hero.index,
                    x: player.x,
                    y: player.y,
                    startTick: this.tick,
                    endTick,
                    nextPulse: this.tick,
                    radius: effect.radius,
                    locId: effect.locId,
                    spotAnim: effect.spotAnim,
                    scale: effect.scale,
                });
                message = "A fairy ring opens at your feet!";
                break;
            case "pumpkin":
                message = this.openPumpkin();
                break;
            case "laps":
                endTick = this.tick + this.powerUpTicks(effect.seconds);
                this.lapsEndTick = endTick;
                this.laps = effect;
                this.emit({ type: "playerShout", text: effect.shout });
                message = effect.shout;
                break;
        }
        if (endTick > this.tick) {
            this.powerUps.push({
                uid: this.nextUid++,
                hero: this.hero.index,
                id: def.id,
                startTick: this.tick,
                endTick,
            });
        }
        this.emit({ type: "powerUp", id: def.id, message, x: player.x, y: player.y });
    }

    // The middle of the thickest crowd within range of the player, going by
    // who has the most others within radius; a little ahead of the player if
    // there's no one about
    private thickestCrowd(range: number, radius: number): Vec2 {
        const player = this.player;
        this.rebuildEnemyHash();
        let best = { x: player.x + player.facingX * 3, y: player.y + player.facingY * 3 };
        let most = 0;
        for (const enemy of this.nearestEnemies(player.x, player.y, range, MAX_CROWD_CHECKS)) {
            let count = 0;
            this.enemyHash.query(enemy.x, enemy.y, radius, (other) => {
                if (fm.hypot(other.x - enemy.x, other.y - enemy.y) <= radius) {
                    count++;
                }
            });
            if (count > most) {
                most = count;
                best = { x: enemy.x, y: enemy.y };
            }
        }
        return best;
    }

    private dropRock(def: PowerUpDef, effect: Extract<PowerUpEffect, { kind: "rock" }>): void {
        const { x, y } = this.thickestCrowd(effect.range, effect.radius);
        const landTick = this.tick + Math.round(effect.delay * TICKS_PER_SECOND);
        this.rocks.push({
            uid: this.nextUid++,
            hero: this.hero.index,
            powerUpId: def.id,
            x,
            y,
            startTick: this.tick,
            landTick,
            endTick: landTick + ROCK_LINGER_TICKS,
            locId: effect.locId,
            spotAnim: effect.spotAnim,
            radius: effect.radius,
            damage: effect.damage * this.powerUpDamageScale(),
            knockback: effect.knockback,
            bossDamage: effect.bossDamage,
        });
    }

    private stepRocks(): void {
        for (const rock of this.rocks) {
            if (rock.landTick === this.tick) {
                this.useHeroAt(rock.hero);
                this.landRock(rock);
            }
        }
        this.rocks = this.rocks.filter((rock) => rock.endTick > this.tick);
    }

    private landRock(rock: FallingRock): void {
        const { x, y, radius } = rock;
        this.emit({ type: "blast", x, y, radius });
        this.emit({ type: "powerUpHit", id: rock.powerUpId, x, y });
        this.addEffect(rock.spotAnim, x, y, 0, 60);
        const hit: Enemy[] = [];
        this.enemyHash.query(x, y, radius + 1, (enemy) => {
            if (fm.hypot(enemy.x - x, enemy.y - y) <= radius + enemy.radius) {
                hit.push(enemy);
            }
        });
        this.damageSource = `powerUp:${rock.powerUpId}`;
        for (const enemy of hit) {
            if (enemy.boss) {
                // A share of its hitpoints, whatever the damage bonus
                this.damageEnemy(enemy, enemy.maxHp * rock.bossDamage, 0, x, y, 0);
            } else {
                this.damageEnemy(enemy, rock.damage, rock.knockback, x, y);
            }
        }
    }

    // Comes in from behind the player, off the edge of the view
    private startRampage(
        def: PowerUpDef,
        effect: Extract<PowerUpEffect, { kind: "rampage" }>,
    ): Rampage {
        const player = this.player;
        const x = player.x - player.facingX * RAMPAGE_START_DISTANCE;
        const y = player.y - player.facingY * RAMPAGE_START_DISTANCE;
        const rampage: Rampage = {
            uid: this.nextUid++,
            hero: this.hero.index,
            powerUpId: def.id,
            x,
            y,
            prevX: x,
            prevY: y,
            yaw: 0,
            goalX: x,
            goalY: y,
            passesLeft: effect.passes,
            hit: new Set(),
            damage: effect.damage * this.powerUpDamageScale(),
            speed: effect.speed / TICKS_PER_SECOND,
            radius: effect.radius,
            knockback: effect.knockback,
            startTick: this.tick,
            endTick: this.tick + effect.seconds * TICKS_PER_SECOND,
            doneTick: -1,
            walkSeq: effect.walkSeq,
            scale: effect.scale,
        };
        this.nextPass(rampage);
        this.rampages.push(rampage);
        return rampage;
    }

    // Straight at the thickest crowd, or the player with none, and on past it
    private nextPass(rampage: Rampage): void {
        const player = this.player;
        const crowd = this.thickestCrowd(RAMPAGE_CROWD_RANGE, rampage.radius * 2);
        let dx = crowd.x - rampage.x;
        let dy = crowd.y - rampage.y;
        if (fm.hypot(dx, dy) < 1) {
            dx = player.x - rampage.x;
            dy = player.y - rampage.y;
        }
        const length = fm.hypot(dx, dy) || 1;
        rampage.goalX = rampage.x + dx + (dx / length) * RAMPAGE_OVERSHOOT;
        rampage.goalY = rampage.y + dy + (dy / length) * RAMPAGE_OVERSHOOT;
        rampage.yaw = yawFromVector(dx, dy);
        rampage.passesLeft--;
        rampage.hit.clear();
        this.emit({ type: "powerUpHit", id: rampage.powerUpId, x: rampage.x, y: rampage.y });
    }

    private stepRampages(): void {
        for (const rampage of this.rampages) {
            rampage.prevX = rampage.x;
            rampage.prevY = rampage.y;
            if (rampage.doneTick !== -1) {
                continue;
            }
            this.useHeroAt(rampage.hero);
            const dx = rampage.goalX - rampage.x;
            const dy = rampage.goalY - rampage.y;
            const distance = fm.hypot(dx, dy);
            const move = Math.min(rampage.speed, distance);
            if (distance > 0) {
                rampage.x += (dx / distance) * move;
                rampage.y += (dy / distance) * move;
            }
            this.rampageHits(rampage);
            if (this.tick >= rampage.endTick || move >= distance) {
                if (rampage.passesLeft > 0 && this.tick < rampage.endTick) {
                    this.nextPass(rampage);
                } else {
                    this.endRampage(rampage);
                }
            }
        }
        this.rampages = this.rampages.filter(
            (r) => r.doneTick === -1 || this.tick - r.doneTick < RAMPAGE_FADE_TICKS,
        );
    }

    private rampageHits(rampage: Rampage): void {
        const { x, y, radius, hit } = rampage;
        const caught: Enemy[] = [];
        this.enemyHash.query(x, y, radius + 1, (enemy) => {
            if (!hit.has(enemy.uid) && fm.hypot(enemy.x - x, enemy.y - y) <= radius) {
                caught.push(enemy);
            }
        });
        this.damageSource = `powerUp:${rampage.powerUpId}`;
        for (const enemy of caught) {
            hit.add(enemy.uid);
            this.damageEnemy(enemy, rampage.damage, rampage.knockback, x, y);
        }
    }

    // Its timer on screen goes with it, which may be early
    private endRampage(rampage: Rampage): void {
        rampage.doneTick = this.tick;
        const active = this.powerUps.find((p) => p.id === rampage.powerUpId);
        if (active) {
            active.endTick = this.tick + 1;
        }
    }

    private stepRings(): void {
        for (const ring of this.rings) {
            if (this.tick >= ring.nextPulse) {
                this.useHeroAt(ring.hero);
                if (!this.isUp(this.hero)) {
                    this.use(this.nearestHero(ring.x, ring.y));
                }
                ring.nextPulse = this.tick + RING_PULSE_TICKS;
                this.pulseRing(ring);
            }
        }
        this.rings = this.rings.filter((ring) => ring.endTick > this.tick);
    }

    // Behind the player, or they'd land right in their path
    private pulseRing(ring: FairyRing): void {
        const { x, y, radius } = ring;
        const caught: Enemy[] = [];
        this.enemyHash.query(x, y, radius + 1, (enemy) => {
            if (
                !enemy.boss &&
                !enemy.def.stationary &&
                !enemy.jump &&
                fm.hypot(enemy.x - x, enemy.y - y) <= radius + enemy.radius
            ) {
                caught.push(enemy);
            }
        });
        let effects = 0;
        for (const enemy of caught) {
            if (effects < MAX_RING_EFFECTS) {
                this.addEffect(ring.spotAnim, enemy.x, enemy.y, 0, 40);
                effects++;
            }
            this.relocate(enemy, true);
        }
    }

    // Kills everything that isn't a boss; bosses lose a share of their
    // hitpoints. Returns how many it killed.
    private nuke(bossDamage: number): number {
        const player = this.player;
        let killed = 0;
        for (const enemy of [...this.enemies]) {
            if (enemy.dead) {
                continue;
            }
            if (enemy.boss) {
                // A share of its hitpoints, whatever the damage bonus
                this.damageEnemy(enemy, enemy.maxHp * bossDamage, 0, player.x, player.y, 0);
                continue;
            }
            if (enemy.shieldEnd > this.tick || enemy.totemOf) {
                this.showBlocked(enemy);
                continue;
            }
            if (killed < MAX_NUKE_EFFECTS) {
                this.addEffect(NUKE_SPOTANIM, enemy.x, enemy.y, 0, 30);
            }
            this.killEnemy(enemy, "nuke");
            killed++;
        }
        return killed;
    }

    // ---- Random events ----

    private stepRandomEvents(): void {
        const visitor = this.visitor;
        if (this.runOver) {
            return;
        }
        if (visitor) {
            this.stepVisitor(visitor);
        } else if (
            this.seconds >= this.nextRandomEventSeconds &&
            // Nobody drops by in the middle of a phased boss's fight
            !this.intro &&
            !this.shownBoss?.def.boss?.phases
        ) {
            this.useVisitorHero();
            // (none to pick or nowhere to put one: it's due again in a moment)
            this.nextRandomEventSeconds = this.startRandomEvent(this.rollRandomEvent())
                ? this.seconds + this.eventRng.range(...RANDOM_EVENT_EVERY)
                : this.seconds + RANDOM_EVENT_RETRY;
        }
    }

    // Co-op: one of the heroes still up, for a visitor (or an ambush) to turn
    // up by, from the events' own rolls
    private useVisitorHero(): void {
        if (this.heroes.length === 1) {
            return;
        }
        const up = this.heroes.filter((hero) => this.isUp(hero));
        if (up.length > 0) {
            this.use(up[this.eventRng.int(up.length)]);
        }
    }

    private rollRandomEvent(): RandomEventDef | undefined {
        const bossOut = this.enemies.some((enemy) => enemy.boss && !enemy.dead);
        const index = this.eventRng.weightedIndex(
            RANDOM_EVENTS.map((event) =>
                event.id === this.lastRandomEventId ||
                this.seconds < (event.minSeconds ?? 0) ||
                (event.effect.kind === "ambush" && bossOut)
                    ? 0
                    : event.weight,
            ),
        );
        return RANDOM_EVENTS[index];
    }

    // Puts this event in motion; false when it can't be right now
    startRandomEvent(def: RandomEventDef | undefined): boolean {
        if (!def) {
            return false;
        }
        const effect = def.effect;
        if (effect.kind === "ambush") {
            // Enemy hitpoints as of now, unlike a map's bosses, which are placed
            // for when they turn up
            const enemy = getEnemy(effect.enemyId);
            const hp = enemy.hp * this.map.difficulty.hp * this.enemyHpScale();
            if (!this.spawnBoss(enemy, "boss", hp)) {
                return false;
            }
            this.lastRandomEventId = def.id;
            return true;
        }
        const spot = this.findVisitorSpot();
        if (!spot) {
            return false;
        }
        this.lastRandomEventId = def.id;
        this.visitor = {
            uid: this.nextUid++,
            def,
            x: spot.x,
            y: spot.y,
            startTick: this.tick,
            endTick: this.tick + VISITOR_LIFETIME * TICKS_PER_SECOND,
            nextShoutTick: this.tick,
        };
        this.addEffect(VISITOR_SPOTANIM, spot.x, spot.y, 0, 60);
        this.emit({ type: "visitor", message: def.arrive ?? "", sound: VISITOR_SOUND });
        return true;
    }

    // A few tiles off, where the player can get to
    private findVisitorSpot(): Vec2 | undefined {
        const player = this.player;
        for (let attempt = 0; attempt < 16; attempt++) {
            const angle = this.eventRng.range(0, Math.PI * 2);
            const distance = this.eventRng.range(...VISITOR_DISTANCE);
            const x = Math.floor(player.x + fm.cos(angle) * distance) + 0.5;
            const y = Math.floor(player.y + fm.sin(angle) * distance) + 0.5;
            const tileX = Math.floor(x);
            const tileY = Math.floor(y);
            if (
                this.grid.contains(tileX, tileY) &&
                this.isWalkableTile(tileX, tileY) &&
                isCircleFree(this.grid, x, y, PLAYER_RADIUS)
            ) {
                return { x, y };
            }
        }
        return undefined;
    }

    private stepVisitor(visitor: Visitor): void {
        if (this.tick >= visitor.endTick) {
            this.visitorLeft(visitor);
            return;
        }
        const shouts = visitor.def.shouts;
        if (shouts && this.tick >= visitor.nextShoutTick) {
            visitor.nextShoutTick = this.tick + VISITOR_SHOUT_EVERY * TICKS_PER_SECOND;
            this.emit({ type: "visitorShout", text: this.eventRng.pick(shouts) });
        }
        // (a casket opened this tick has the run waiting already)
        if (this.state !== "playing") {
            return;
        }
        const met = this.heroes.find(
            (hero) =>
                this.isUp(hero) &&
                fm.hypot(hero.player.x - visitor.x, hero.player.y - visitor.y) <= VISITOR_REACH,
        );
        if (met) {
            this.use(met);
            this.meetVisitor(visitor);
        }
    }

    // Left waiting too long
    private visitorLeft(visitor: Visitor): void {
        this.nextRandomEventSeconds = this.seconds + this.eventRng.range(...RANDOM_EVENT_EVERY);
        this.visitor = undefined;
        this.addEffect(VISITOR_SPOTANIM, visitor.x, visitor.y, 0, 60);
        this.emit({ type: "visitor", message: visitor.def.leave ?? "", sound: -1 });
        const effect = visitor.def.effect;
        if (effect.kind === "heal" && effect.ignoredHit) {
            // Everyone still in the fight ignored them
            const { ignoredHit, sound } = effect;
            this.forEachHeroInReach(() => {
                if (this.reviving) {
                    return;
                }
                const hit = Math.round(this.player.maxHp * ignoredHit);
                const amount = Math.min(hit, this.player.hp - 1);
                if (amount > 0) {
                    this.damagePlayer(amount, visitor.def.id, false, sound, true);
                }
            });
        }
    }

    // Walked up to at last: they do what they came for
    private meetVisitor(visitor: Visitor): void {
        this.nextRandomEventSeconds = this.seconds + this.eventRng.range(...RANDOM_EVENT_EVERY);
        this.visitor = undefined;
        this.addEffect(VISITOR_SPOTANIM, visitor.x, visitor.y, 0, 60);
        const def = visitor.def;
        const effect = def.effect;
        switch (effect.kind) {
            case "shop":
                this.openOffer(def, this.rollOldManOptions());
                return;
            case "quiz":
                this.openOffer(def, this.rollQuizOptions(effect.options));
                return;
            case "ambush":
                return;
            case "xp":
                this.xp += (this.xpForNextLevel - this.xpForThisLevel) * effect.levels;
                break;
            case "heal":
                this.heal(this.player.maxHp * effect.fraction);
                break;
            case "casket": {
                const tier = rollCasketTier(this.rng, this.seconds, true, this.stats.luck);
                this.dropCasketOfTier(tier, visitor.x, visitor.y, true);
                break;
            }
            case "buff":
                this.addEventBuff(def.id, effect);
                break;
        }
        this.emit({ type: "visitor", message: effect.message, sound: effect.sound }, true);
    }

    private addEventBuff(id: string, effect: Extract<RandomEventEffect, { kind: "buff" }>): void {
        const { name, objId, stats, seconds, cures = false } = effect;
        if (cures) {
            this.player.poisonEnd = -1;
            this.player.poisonDamage = 0;
            this.debuffs = [];
        }
        this.addBuff(id, stats, seconds, cures);
        this.buffs[this.buffs.length - 1].look = { name, objId };
    }

    private openOffer(def: RandomEventDef, options: EventOption[]): void {
        this.offer = { uid: this.nextUid++, def, options, hero: this.hero.index };
        this.state = "event";
    }

    // A few different power-ups, the ones that drop less often being the ones
    // on offer less often too
    private rollOldManOptions(): EventOption[] {
        const left = POWER_UPS.filter((powerUp) => powerUp.weight > 0);
        const options: EventOption[] = [];
        while (options.length < OLD_MAN_OFFERS && left.length > 0) {
            const index = this.eventRng.weightedIndex(left.map((p) => p.weight));
            const [powerUp] = left.splice(index, 1);
            options.push({
                kind: "powerUp",
                powerUpId: powerUp.id,
                price: this.oldManPrice(powerUp),
                sold: false,
            });
        }
        return options;
    }

    private oldManPrice(powerUp: PowerUpDef): number {
        const inflation = 1 + (this.seconds / 60) * OLD_MAN_PRICE_PER_MINUTE;
        return Math.max(1, Math.round(powerUp.price * inflation * this.coinScale));
    }

    // Some of one group of things and the odd one out from another, anywhere
    private rollQuizOptions(count: number): EventOption[] {
        const groups = getQuizGroups();
        const same = groups.splice(this.eventRng.int(groups.length), 1)[0];
        const options: EventOption[] = [];
        const pool = [...same];
        while (options.length < count - 1 && pool.length > 0) {
            const [item] = pool.splice(this.eventRng.int(pool.length), 1);
            options.push({ kind: "answer", itemId: item.id, correct: false });
        }
        const odd = this.eventRng.pick(this.eventRng.pick(groups));
        options.splice(this.eventRng.int(options.length + 1), 0, {
            kind: "answer",
            itemId: odd.id,
            correct: true,
        });
        return options;
    }

    // Takes one of what's on offer. False when there's no such thing or the
    // player can't pay for it.
    chooseEventOption(index: number): boolean {
        const offer = this.offer;
        const option = offer?.options[index];
        if (this.state !== "event" || !offer || !option || offer.hero !== this.hero.index) {
            return false;
        }
        if (option.kind === "powerUp") {
            if (option.sold || this.coins < option.price) {
                return false;
            }
            this.coins -= option.price;
            option.sold = true;
            this.emit({ type: "visitor", message: "", sound: SOUNDS.buy }, true);
            this.usePowerUp(getPowerUp(option.powerUpId));
            // A bought nuke can finish off a final boss
            if (this.runOver || offer.options.every((o) => o.kind === "powerUp" && o.sold)) {
                this.leaveEvent();
            }
            return true;
        }
        const effect = offer.def.effect;
        if (effect.kind === "quiz") {
            this.emit(
                {
                    type: "visitor",
                    message: option.correct ? effect.right : effect.wrong,
                    sound: option.correct ? SOUNDS.levelUp : SOUNDS.denied,
                },
                true,
            );
            if (option.correct) {
                this.usePowerUp(getPowerUp(this.rollPowerUpId()));
            }
        }
        this.leaveEvent();
        return true;
    }

    // Done with what's on offer: on with the run (or a level up or casket that
    // came in meanwhile)
    leaveEvent(): void {
        if (this.offer && this.offer.hero !== this.hero.index) {
            return;
        }
        this.offer = undefined;
        if (this.state !== "event") {
            return;
        }
        this.state = this.heroes.some((hero) => hero.chests.length > 0) ? "chest" : "playing";
        this.checkLevelUp();
    }

    // A casket always has some coins and one item; the run waits while the
    // player decides what to do with the item
    openCasket(tier: CasketTier): void {
        const [min, max] = CASKETS[tier].coins;
        const coins = Math.round(
            (min + this.rng.int(max - min + 1)) * (1 + this.stats.greed) * this.coinScale,
        );
        this.coins += coins;
        this.casketsOpened++;
        const { itemId, upgradedFrom } = this.rollChestItem(tier);
        const upgrades = this.offeredUpgrades(itemId);
        this.chests.push({ uid: this.nextUid++, tier, itemId, upgradedFrom, upgrades, coins });
        this.emit({ type: "chest", tier, itemId, coins });
        if (this.state === "playing") {
            this.state = "chest";
        }
    }

    // A casket's item, gear as the Armoury has upgraded it (and noted as
    // found); a reroll's is never the one it replaces
    private rollChestItem(
        tier: CasketTier,
        replaces?: string,
    ): { itemId: string; upgradedFrom?: string } {
        const found = rollCasketItem(
            this.rng,
            tier,
            this.stats.luck,
            this.gear,
            hasPoison(this.map),
            replaces,
            this.unlockedItems,
            { offered: this.gearUpgradesFound, worn: this.gearUpgrades },
            this.armoury,
            this.declinedSets,
        );
        if (getItem(found).kind !== "gear") {
            return { itemId: found };
        }
        this.gearFound.add(found);
        const itemId = getUpgradedGear(found, this.armoury);
        return { itemId, upgradedFrom: itemId !== found ? found : undefined };
    }

    // Gear in an endless run's casket comes upgraded once for each round
    // after the first
    private get gearUpgradesFound(): number {
        return this.endless ? this.round - 1 : 0;
    }

    private offeredUpgrades(itemId: string): number {
        return getItem(itemId).kind === "gear" ? this.gearUpgradesFound : 0;
    }

    // The run's level is shared: each level up gives every hero a pick
    private checkLevelUp(): void {
        const level = this.endless
            ? endlessLevelForXp(this.xp, this.level)
            : runLevelForXp(this.xp);
        if (level > this.level) {
            const gained = level - this.level;
            this.level = level;
            for (const hero of this.heroes) {
                if (hero.left) {
                    continue;
                }
                this.use(hero);
                hero.pendingLevelUps += gained;
                if (this.stats.levelMight !== 0) {
                    this.updateStats();
                }
                this.addEffect(LEVEL_UP_SPOTANIM, this.player.x, this.player.y, 0, 90);
            }
            this.emit({ type: "levelUp", level });
        }
        if (this.state === "playing" && this.anyoneToChoose()) {
            this.state = "levelUp";
            this.rollMissingChoices();
        }
    }

    // Rewards for everyone choosing a level up who hasn't any yet
    private rollMissingChoices(): void {
        for (const hero of this.heroes) {
            if (this.isChoosing(hero) && hero.choices.length === 0) {
                this.use(hero);
                this.choices = this.roll();
            }
        }
    }

    // ---- Housekeeping ----

    private cleanUp(): void {
        const tick = this.tick;
        this.enemies = this.enemies.filter((e) => !e.dead || tick - e.deathTick < CORPSE_TICKS);
        this.projectiles = this.projectiles.filter((p) => p.life > 0);
        this.enemyProjectiles = this.enemyProjectiles.filter((p) => p.life > 0);
        this.effects = this.effects.filter((e) => tick < e.endTick);
        if (this.effects.some((e) => e.enemyUid !== 0)) {
            const enemiesByUid = new Map<number, Enemy>();
            for (const enemy of this.enemies) {
                enemiesByUid.set(enemy.uid, enemy);
            }
            for (const effect of this.effects) {
                if (effect.enemyUid === 0) {
                    continue;
                }
                const enemy = enemiesByUid.get(effect.enemyUid);
                if (enemy) {
                    effect.x = enemy.x;
                    effect.y = enemy.y;
                }
                if (!enemy || enemy.dead) {
                    effect.enemyUid = 0;
                }
            }
        }
    }

    takeEvents(): SimEvent[] {
        const events = this.events;
        this.events = [];
        return events;
    }

    get runOver(): boolean {
        return this.state === "dead" || this.state === "victory";
    }

    // The power-up whose look the player has on; it's off when the run ends
    get wornPowerUp(): PowerUpDef | undefined {
        if (this.runOver) {
            return undefined;
        }
        return this.powerUps
            .filter((p) => p.hero === this.hero.index)
            .map((p) => getPowerUp(p.id))
            .find((p) => p.look);
    }

    // Until this round's final boss
    get timeLeftForBoss(): number {
        return Math.max(0, RUN_LENGTH - this.mapSeconds);
    }
}

function addStats(stats: Stats, add: Partial<Stats>): void {
    for (const [key, value] of Object.entries(add)) {
        stats[key as keyof Stats] += value ?? 0;
    }
}

// Whether an enemy is any of these (a vampyre, undead)
function hasTag(enemy: Enemy, tags: readonly EnemyTag[]): boolean {
    return enemy.def.tags?.some((tag) => tags.includes(tag)) ?? false;
}

// How far from all there a healer sees it: a fight in phases is in its shield,
// and with that down there's nothing to give back
function hurtFraction(enemy: Enemy): number {
    const phase = enemy.bossState?.phase;
    if (phase) {
        return phase.stage === "shield" ? phase.shield / phase.shieldMax : 1;
    }
    return enemy.hp / enemy.maxHp;
}

function secondsToTicks(seconds: number): number {
    return Math.round(seconds * TICKS_PER_SECOND);
}

// Timers for what an enemy does besides walking up and hitting, undefined if
// its def gives it nothing. The first spawn, heal and revive come one
// interval after it turns up; the first blink somewhere in its first
// interval, so a crowd of them don't all go at once.
function getAbilities(def: EnemyDef, tick: number, rng: Rng): EnemyAbilities | undefined {
    if (!def.spawns && !def.heals && !def.revives && !def.blinks) {
        return undefined;
    }
    return {
        nextSpawn: tick + secondsToTicks(def.spawns?.interval ?? 0),
        nextHeal: tick + secondsToTicks(def.heals?.interval ?? 0),
        nextRevive: tick + secondsToTicks(def.revives?.interval ?? 0),
        nextBlink: def.blinks ? tick + secondsToTicks(def.blinks.interval * rng.range(0.5, 1)) : 0,
        blinkLand: -1,
    };
}

// Back and forth between -half and half at a steady speed, from 0 heading
// up: where it is after going distance
function pingPong(distance: number, half: number): number {
    if (half <= 0) {
        return 0;
    }
    const p = (distance + half) % (half * 4);
    return p < half * 2 ? p - half : half * 3 - p;
}

export { yawFromVector } from "./PlayerMovement";

export { DEATH_SINK_TICKS, MAX_DEATH_ANIM_TICKS };

// A shot as the boss-attack shape enemy projectiles carry (its damage is the
// enemy's own, set when it's fired)
const SHOT_ATTACKS = new WeakMap<EnemyShotDef, BossAttackDef>();
function shotAttack(shot: EnemyShotDef): BossAttackDef {
    let attack = SHOT_ATTACKS.get(shot);
    if (!attack) {
        attack = {
            name: "Shot",
            kind: "projectile",
            damage: 0,
            windup: 0,
            cooldown: 0,
            range: shot.range,
            weight: 1,
            speed: shot.speed,
            spotAnim: shot.spotAnim,
            impactSpotAnim: shot.impactSpotAnim,
            hitSound: shot.hitSound,
        };
        SHOT_ATTACKS.set(shot, attack);
    }
    return attack;
}
