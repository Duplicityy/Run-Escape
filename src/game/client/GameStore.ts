import { Rarity } from "../content/rarity";
import { GearSlot } from "../content/types";
import { WeaponStatLine } from "../content/weaponStats";
import { ChestAction } from "../core/Loot";
import { RunResult } from "../core/Sim";
import { SaveData } from "../core/save";
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
    alchCoins: number;
    // What Space does: equip/keep, unless that would be a step down
    recommended: ChestAction;
    // Caskets waiting after this one
    queued: number;
};

// A random event's visitor with something on offer, the run waiting meanwhile
export type EventView = {
    uid: number;
    name: string;
    speech: string;
    leaveLabel: string;
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

export type HudView = {
    // The run's map
    mapId: string;
    // An endless run's round
    round?: number;
    // Seconds until this round's final boss
    bossIn: number;
    hp: number;
    maxHp: number;
    // The hitpoints bar turns green, like the client's orb
    poisoned: boolean;
    level: number;
    // Progress to the next level, 0-1
    xpFraction: number;
    seconds: number;
    kills: number;
    coins: number;
    // Damage a second just now, every source counted
    dps: number;
    maxWeapons: number;
    maxPassives: number;
    weapons: SlotView[];
    passives: SlotView[];
    // The player's stats from passives, gear, potions and their adventurer,
    // the ones that aren't zero: "+18% damage", "+2 armour"
    stats: string[];
    gear: GearSlotView[];
    inventory: InventorySlotView[];
    buffs: BuffView[];
    // Left this run, for a level up's rewards or a casket's item
    rerolls: number;
    // What skipping the level up's rewards costs, while they can be skipped
    skip?: { cost: number; affordable: boolean };
    // enraged: below half its hitpoints, faster and with its enraged attacks
    boss?: BossView;
    // The quests this run can get on with: this map's, then the ones done all
    // over, leaving out the ones done before it
    quests: QuestTrackView[];
};

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
        stage: "shield" | "totems";
        // How charged each totem is, 0 to 1
        totems: number[];
        curseAttacks?: number;
        parasiteSeconds?: number;
    };
};

export type BossKillView = { name: string; seconds: number };

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
};

// Co-op: a player in the run besides you, for the party frames
export type TeammateView = {
    name: string;
    characterId: string;
    hp: number;
    maxHp: number;
    // Down with no revives left (out for the rest of the run), or gone from
    // the game
    down: boolean;
    left: boolean;
    // Their player id in the room, for the host to kick them
    id?: string;
};

export type Toast = { id: number; text: string; until: number };

export type UiSnapshot = {
    screen: Screen;
    loadingText: string;
    loadingProgress: number;
    save: SaveData;
    characterId: string;
    // The map the next run is on, and whether it's endless and on hard mode
    // (once the map's been beaten)
    mapId: string;
    endless: boolean;
    hard: boolean;
    hud?: HudView;
    overlay: RunOverlay;
    // Co-op: the room and its menus, everyone else in the run, and who the
    // run's waiting on to choose (when it isn't you)
    coop: CoopView;
    party: TeammateView[];
    waitingOn: string[];
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
    // damage / bossKills: the stats screen's rows
    result?: RunResult & {
        characterName: string;
        damage: DamageView[];
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
            characterId: save.unlockedCharacters[0] ?? "warrior",
            mapId: "lumbridge",
            endless: false,
            hard: false,
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
                autoAlch: false,
                movePrediction: false,
            },
        };
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): UiSnapshot => this.snapshot;

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
