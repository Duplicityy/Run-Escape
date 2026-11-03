import { Rarity } from "../content/rarity";
import { GearSlot } from "../content/types";
import { WeaponStatLine } from "../content/weaponStats";
import { ChestAction } from "../core/Loot";
import { RunResult } from "../core/Sim";
import { NewerSave, SaveData, UnreadableSave } from "../core/save";
import { DisplaySettings } from "./DisplaySettings";
import { AudioSettings } from "./GameAudio";
import { CoopView, OFFLINE } from "./coop/CoopLobby";

export type Screen =
    | "loading"
    | "title"
    | "characters"
    | "shop"
    | "armoury"
    | "quests"
    | "collectionLog"
    // Co-op: finding or making a room, and the room before a run
    | "coop"
    | "run";

export type RunOverlay = "none" | "levelUp" | "chest" | "event" | "paused" | "dead" | "victory";

export type SlotView = {
    id: string;
    name: string;
    level: number;
    maxLevel: number;
    iconObjId: number;
    iconSpriteId?: number;
    // What it adds up to so far: "+18% damage", "+15% damage to this weapon"
    detail: string;
    // Weapons: their stats at this level ("Damage 13", "Attacks 0.74/s")
    stats?: string[];
    // Weapons that evolve: the passive it takes, and what's done of it
    evolution?: { passive: string; maxed: boolean; hasPassive: boolean; ready: boolean };
    // The item's own rarity, for the slot's border
    rarityColor: string;
};

export type ItemView = {
    id: string;
    name: string;
    objId: number;
    rarity: { name: string; color: string };
    // "Head slot", "Utility"
    kindLabel: string;
    // What it does, a line per stat or effect
    lines: string[];
    // A set piece: how the set's coming along ("Void knight 2/4: ..."), and
    // whether its bonus is on
    set?: { text: string; active: boolean };
};

export type GearSlotView = { slot: GearSlot; name: string; item?: ItemView };

export type InventorySlotView = { item: ItemView; count: number } | null;

export type BuffView = {
    id: string;
    name: string;
    objId: number;
    secondsLeft: number;
    // Time left, 1 when just drunk
    fraction: number;
    // A boss attack's drain rather than a potion or power-up
    harmful: boolean;
};

// An opened reward casket, for the opening animation and the decision after
export type ChestView = {
    uid: number;
    casketName: string;
    casketObjId: number;
    tierColor: string;
    // The item's rarity sets how big the reveal is
    rarity: Rarity;
    coins: number;
    item: ItemView;
    // Gear the Armoury has upgraded: the name of the piece it was found as
    upgradedFrom?: string;
    isGear: boolean;
    // Gear: what it replaces (alched when the new piece goes on) and what
    // changes
    replaces?: { item: ItemView; alchCoins: number };
    changes: { text: string; good: boolean }[];
    // Utility: whether it fits in the inventory, and how many are carried
    canStash: boolean;
    carried: number;
    // Taken at once rather than kept (an extra co-op revive)
    instant: boolean;
    alchCoins: number;
    // What Space does: equip/keep, unless that would be a step down
    recommended: ChestAction;
    // Caskets waiting after this one
    queued: number;
    // Whether its item can be banished now (one's left, and it's not worn or
    // carried), and the set that goes with it, for a set's piece
    banish?: { set?: string };
};

// A random event's visitor with something on offer, the run waiting meanwhile
export type EventView = {
    uid: number;
    name: string;
    speech: string;
    leaveLabel: string;
    // A raid's supply chest: prices are in raid points, and this is what the player has
    points?: number;
    options: {
        title: string;
        text?: string;
        iconObjId: number;
        // For sale, and sold already
        price?: number;
        sold?: boolean;
        enabled: boolean;
    }[];
};

// The HUD's slower parts: what the hero has, which changes with a level up, a
// casket or an item used. The numbers that change as the run's played are in
// HudNumbers.
export type HudView = {
    // The run's map
    mapId: string;
    // An endless run's round
    round?: number;
    level: number;
    maxWeapons: number;
    maxPassives: number;
    weapons: SlotView[];
    passives: SlotView[];
    // The player's stats from passives, gear, potions and their adventurer,
    // the ones that aren't zero: "+18% damage", "+2 armour"
    stats: string[];
    gear: GearSlotView[];
    inventory: InventorySlotView[];
    // Left this run, for a level up's rewards or a casket's item
    rerolls: number;
    // Banishes left (Firemaking)
    banishes: number;
    // What skipping the level up's rewards costs, while they can be skipped
    skip?: { cost: number; affordable: boolean };
};

// The HUD's numbers that change as the run's played, 10 times a second. They're
// in a store of their own (GameStore.subscribeNumbers), so only the parts of the
// UI that show them draw again.
export type HudNumbers = {
    // Seconds until this round's final boss, rounded up
    bossIn: number;
    // A raid's room: which of how many, and its boss's name
    // waves: still in its waves, so its boss is on the way (not fought or beaten)
    // portal: the hall's teleporter can be used; first: the player's never beaten it
    raidRoom?: {
        // The hall's colour wash, while its waves are on (RaidRoomDef.hall)
        wash?: string;
        number: number;
        count: number;
        name: string;
        points: number;
        waves: boolean;
        portal: boolean;
        first: boolean;
    };
    hp: number;
    maxHp: number;
    // The hitpoints bar turns green, like the client's orb
    poisoned: boolean;
    // Progress to the next level, 0-1
    xpFraction: number;
    // Whole seconds into the run
    seconds: number;
    kills: number;
    coins: number;
    // Damage a second just now, every source counted
    dps: number;
    // For the damage panel (DamageMeter): each weapon's by its id, damage a
    // second just now and damage this run (since it became what it is, for one
    // that's evolved), and what isn't a weapon's (items, power-ups, recoil)
    weaponDamage: Record<string, { dps: number; damage: number }>;
    otherDps: number;
    buffs: BuffView[];
    // enraged: below half its hitpoints, faster and with its enraged attacks
    boss?: BossView;
    // The quests this run can get on with: this map's, then the ones done all
    // over, leaving out the ones done before it
    quests: QuestTrackView[];
};

// next, keeping each of prev's fields that's the same (by value), so a memoized
// part of the UI showing one sees the same object. prev itself if nothing's
// changed. A list that's changed keeps the items in it that haven't (one quest's
// progress moving leaves the others as they were).
export function shareUnchanged<T extends object>(prev: T | undefined, next: T): T {
    if (!prev) {
        return next;
    }
    let changed = Object.keys(prev).length !== Object.keys(next).length;
    const shared = { ...next };
    for (const key of Object.keys(next) as (keyof T)[]) {
        const value = next[key];
        const old = prev[key];
        if (value === old || JSON.stringify(value) === JSON.stringify(old)) {
            shared[key] = old;
        } else {
            changed = true;
            if (Array.isArray(value) && Array.isArray(old)) {
                shared[key] = value.map((item, i) =>
                    JSON.stringify(item) === JSON.stringify(old[i]) ? old[i] : item,
                ) as T[keyof T];
            }
        }
    }
    return changed ? shared : prev;
}

// One row of the run's damage: what dealt it (a weapon by its last tier),
// with its kills, and damage a second for a weapon (over the time it was had)
export type DamageView = {
    name: string;
    iconObjId?: number;
    iconSpriteId?: number;
    color?: string;
    damage: number;
    kills: number;
    perSecond?: number;
};

// fraction: of its hitpoints, or a fight in phases' shield. fight: how that
// fight's going, and what's on the player (see BossPhasesDef)
export type BossView = {
    name: string;
    fraction: number;
    enraged: boolean;
    fight?: {
        phase: number;
        phases: number;
        // finale: its last stand, and fraction is the time left in it
        stage: "shield" | "totems" | "finale";
        // How charged each totem is, 0 to 1
        totems: number[];
        curseAttacks?: number;
        parasiteSeconds?: number;
    };
};

export type BossKillView = { name: string; seconds: number };

// One player's own numbers for the results screen (a teammate who fell or
// left too)
export type PlayerResultView = {
    name: string;
    characterName: string;
    isLocal: boolean;
    down: boolean;
    left: boolean;
    kills: number;
    damageDealt: number;
    caskets: number;
    highestHit: number;
    damageTaken: number;
    healed: number;
    rerollsUsed: number;
    skips: number;
    damage: DamageView[];
};

// done / of: how far it's got, this run's kills and caskets included;
// finished: this run finished it (it pays once the run is over)
export type QuestTrackView = {
    id: string;
    name: string;
    task: string;
    done: number;
    of: number;
    finished: boolean;
};

export type ChoiceView = {
    title: string;
    text: string;
    iconObjId: number;
    iconSpriteId?: number;
    isNew: boolean;
    isEvolution: boolean;
    // A godsword's hilt to pick
    isHilt: boolean;
    // A hilt pick that's the run's Ancient spell, not a godsword's hilt
    isSpell: boolean;
    // The rolled rarity of this offer, if it has one
    rarity?: { name: string; color: string };
    // Weapons: what this level changes, or a new weapon's stats
    stats?: WeaponStatLine[];
    // What it evolves or evolves with; held when the other half's owned
    evolves?: { text: string; held: boolean };
    // Whether it can be banished now: a new weapon or passive, with a banish
    // left, and not the last reward left to pick
    banishable: boolean;
    // Banished: greyed out, and can't be picked
    banished: boolean;
};

// Co-op: a player in the run besides you, for the party frames
export type TeammateView = {
    name: string;
    characterId: string;
    hp: number;
    maxHp: number;
    // Down with no ring of life left (waiting for a revive, or out for the
    // rest of the run once they've had their last), or gone from the game
    down: boolean;
    left: boolean;
    // Down and a teammate can still bring them back
    revivable: boolean;
    // How far along a revive under way is (0 to 1)
    reviveProgress: number;
    // Just revived, so nothing can hurt them
    immune: boolean;
    // Their player id in the room, for the host to kick them
    id?: string;
};

// Co-op: what the note in the middle of the screen says about a revive:
// you're down and can be revived (with how many revives you have left, and
// who's reviving you, if anyone), or you're reviving a teammate
export type ReviveView = {
    name?: string;
    reviving: boolean;
    progress: number;
    revivesLeft: number;
};

export type Toast = { id: number; text: string; until: number };

// Why nothing's being saved: the game's open in another tab, the save's from
// a newer version of it (which this one would undo), or it couldn't be read
// and there's no room to keep a copy
export type SaveBlock =
    | { kind: "otherTab" }
    | ({ kind: "newerGame" } & NewerSave)
    | { kind: "noRoom" };

export type UiSnapshot = {
    screen: Screen;
    loadingText: string;
    loadingProgress: number;
    save: SaveData;
    // Set while nothing's being saved, and closed to play on without saving
    saveBlock?: SaveBlock;
    saveBlockClosed: boolean;
    // The save couldn't be read when it loaded: where it's kept, for the notice
    unreadableSave?: string;
    // Saves that couldn't be read, kept to be exported
    unreadableSaves: UnreadableSave[];
    characterId: string;
    // The map the next run is on, and whether it's endless and on hard mode
    // (once the map's been beaten)
    mapId: string;
    endless: boolean;
    hard: boolean;
    // A raid's expert mode (solo for now)
    expert: boolean;
    hud?: HudView;
    overlay: RunOverlay;
    // Co-op: the room and its menus, everyone else in the run, and who the
    // run's waiting on to choose (when it isn't you)
    coop: CoopView;
    party: TeammateView[];
    waitingOn: string[];
    // Co-op: a revive you're part of, as the one down or the one reviving
    revive?: ReviveView;
    choices: ChoiceView[];
    chest?: ChestView;
    event?: EventView;
    // unlockedMap: the name of the map this run's win opened up;
    // unlockedCharacters / unlockedItems: the names of the adventurers and
    // items it brought in; endlessRecord: an endless run that went further
    // than any before it on the map; firstHardWin: the first time the map's
    // been beaten on hard mode; newGear: the names of the gear it found for
    // the first time, for the Armoury; quests: the quests it finished, and
    // what they paid
    // players: everyone's own stats; bossKills: the party's boss times
    result?: RunResult & {
        players: PlayerResultView[];
        bossKills: BossKillView[];
        endlessRecord: boolean;
        firstHardWin: boolean;
        unlockedMap?: string;
        unlockedCharacters: string[];
        unlockedItems: string[];
        newGear: string[];
        // The names of the trophies it found for the first time
        newTrophies: string[];
        quests: { name: string; coins: number }[];
        // Co-op: who else played, and why it ended early if it did
        party?: string[];
        endedEarly?: string;
    };
    toasts: Toast[];
    debug: boolean;
    audio: AudioSettings;
    display: DisplaySettings;
};

// The UI's view of the game: an immutable snapshot replaced on every change,
// read by React through useSyncExternalStore.
export class GameStore {
    private snapshot: UiSnapshot;
    private readonly listeners = new Set<() => void>();
    private nextToastId = 1;

    constructor(save: SaveData) {
        this.snapshot = {
            screen: "loading",
            loadingText: "Loading Lumbridge",
            loadingProgress: 0,
            save,
            saveBlockClosed: false,
            unreadableSaves: [],
            characterId: save.unlockedCharacters[0] ?? "warrior",
            mapId: "lumbridge",
            endless: false,
            hard: false,
            expert: false,
            overlay: "none",
            coop: OFFLINE,
            party: [],
            waitingOn: [],
            choices: [],
            toasts: [],
            debug: false,
            audio: { muted: false, volume: 0.6, music: 0.6 },
            display: {
                menuSpin: true,
                pauseOnBlur: true,
                questTracker: true,
                damagePanel: false,
                autoAlch: false,
                movePrediction: true,
                coopFlag: true,
                frameRate: "auto",
            },
        };
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): UiSnapshot => this.snapshot;

    // The HUD's numbers, kept apart from the snapshot (see HudNumbers)
    private numbers?: HudNumbers;
    private readonly numberListeners = new Set<() => void>();

    subscribeNumbers = (listener: () => void): (() => void) => {
        this.numberListeners.add(listener);
        return () => this.numberListeners.delete(listener);
    };

    getNumbers = (): HudNumbers | undefined => this.numbers;

    setNumbers(numbers: HudNumbers | undefined): void {
        this.numbers = numbers;
        for (const listener of this.numberListeners) {
            listener();
        }
    }

    set(changes: Partial<UiSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...changes };
        for (const listener of this.listeners) {
            listener();
        }
    }

    toast(text: string, ms = 3500): void {
        const now = performance.now();
        // The same message twice at once (three Jads turning up together)
        // shows once
        const toasts = this.snapshot.toasts.filter((t) => t.until > now && t.text !== text);
        toasts.push({ id: this.nextToastId++, text, until: now + ms });
        this.set({ toasts: toasts.slice(-4) });
    }

    expireToasts(): void {
        const now = performance.now();
        const toasts = this.snapshot.toasts;
        if (toasts.some((t) => t.until <= now)) {
            this.set({ toasts: toasts.filter((t) => t.until > now) });
        }
    }
}
