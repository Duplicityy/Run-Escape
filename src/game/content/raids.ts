import { THEATRE_OF_BLOOD, TOB_ROOM_PLACES, TobRoomId } from "../scaperune/maps/theatreOfBlood";
import { getRecipeArena } from "../scaperune/recipe";
import { MapDef, RaidRoomDef, RaidSupplyDef, RandomEventDef, RunEventDef, WaveDef } from "./types";
import { LUMBRIDGE_WAVES } from "./waves";

// Raids (MapDef.raid): a run through rooms one after another, each its waves and then its boss in
// a room of its own, rather than one fifteen minute timeline. Open from the start, outside the
// campaign's chain.

// Raid points, per player, for each room cleared: some for clearing it, more for killing its boss
// fast (all of SPEED_POINTS within FAST_SECONDS of it turning up, none by SLOW_SECONDS) and for
// taking little damage in the room (all of SAFE_POINTS with none taken, none at a whole
// hitpoints bar's worth)
export const CLEAR_POINTS = 50;
export const SPEED_POINTS = 100;
export const FAST_SECONDS = 20;
export const SLOW_SECONDS = 120;
export const SAFE_POINTS = 50;

// Coins for each raid point a room's cleared with (the party's average), and on hard mode this
// many times as many. A clean clear of the Theatre comes to about 22,000, or 33,000 on hard.
export const RAID_COINS_PER_POINT = 20;
export const HARD_RAID_COINS = 1.5;
// Expert mode (hard mode with the Nylocas's colours): twice as many
export const EXPERT_RAID_COINS = 2;

// The chest at the end: a purple's chance is a player's raid points over PURPLE_POINTS (all of
// them, spent or not), held between these; on hard mode, a roll for its own as well
export const PURPLE_POINTS = 2500;
export const PURPLE_CHANCE: [min: number, max: number] = [0.05, 0.65];
export const HARD_UNIQUE_CHANCE = 0.25;

export function getRoomPoints(bossSeconds: number, damageTaken: number, maxHp: number): number {
    const speed = 1 - (bossSeconds - FAST_SECONDS) / (SLOW_SECONDS - FAST_SECONDS);
    const safe = 1 - damageTaken / Math.max(1, maxHp);
    return Math.round(
        CLEAR_POINTS +
            SPEED_POINTS * Math.min(1, Math.max(0, speed)) +
            SAFE_POINTS * Math.min(1, Math.max(0, safe)),
    );
}

// Teleports a raid gives, once it's been beaten: rooms whose waves can be skipped
export const RAID_TELEPORTS = 2;

// The supply chest between rooms
export const RAID_SUPPLIES: RaidSupplyDef[] = [
    {
        id: "shark",
        name: "Shark",
        description: "Heals 30% of your hitpoints.",
        objId: 385,
        price: 30,
        effect: { kind: "heal", fraction: 0.3 },
    },
    {
        id: "saradomin_brew",
        name: "Saradomin brew",
        description: "Heals 60% of your hitpoints.",
        objId: 6685,
        price: 60,
        effect: { kind: "heal", fraction: 0.6 },
    },
    {
        id: "super_restore",
        name: "Super restore",
        description: "Cures poison and drains, and keeps them off for 2 minutes.",
        objId: 3024,
        price: 40,
        effect: { kind: "buff", stats: {}, seconds: 120, cures: true },
    },
    {
        id: "stamina_potion",
        name: "Stamina potion",
        description: "+20% movement speed for 3 minutes.",
        objId: 12625,
        price: 50,
        effect: { kind: "buff", stats: { moveSpeed: 0.2 }, seconds: 180 },
    },
    {
        id: "divine_super_combat",
        name: "Divine super combat potion",
        description: "+25% melee damage for 3 minutes.",
        objId: 23685,
        price: 80,
        effect: { kind: "buff", stats: { meleeMight: 0.25 }, seconds: 180 },
    },
    {
        id: "divine_ranging",
        name: "Divine ranging potion",
        description: "+25% ranged damage for 3 minutes.",
        objId: 23733,
        price: 80,
        effect: { kind: "buff", stats: { rangedMight: 0.25 }, seconds: 180 },
    },
    {
        id: "divine_magic",
        name: "Divine magic potion",
        description: "+25% magic damage for 3 minutes.",
        objId: 23745,
        price: 80,
        effect: { kind: "buff", stats: { magicMight: 0.25 }, seconds: 180 },
    },
];

export function getRaidSupply(id: string): RaidSupplyDef {
    const supply = RAID_SUPPLIES.find((s) => s.id === id);
    if (!supply) {
        throw new Error("Unknown raid supply " + id);
    }
    return supply;
}

// The chest's screen goes the way a visitor's shop does (Sim.openOffer); nobody walks up to it
export const RAID_SUPPLY_CHEST: RandomEventDef = {
    id: "raid_supplies",
    name: "Supply chest",
    weight: 0,
    speech: "Spend your raid points on supplies for the next room.",
    effect: { kind: "shop", leaveLabel: "On to the next room" },
};

// Each room's boss comes at the next of these marks in the run, as the campaign's bosses do: five
// minutes, ten, and so on to Verzik at thirty
const ROOM_MINUTES = 5;
// A room's waves: a new one every WAVE_STEP seconds, WAVES_A_ROOM of them
const WAVE_STEP = 60;
const WAVES_A_ROOM = 5;

// A room's waves keep Lumbridge's pace for how far into the raid it is, over a run twice its
// length (room n starts at Lumbridge's wave 2.5n). Its three lists of who comes are spread over
// its five waves.
function roomWaves(room: number, enemies: WaveDef["enemies"][]): WaveDef[] {
    const first = Math.round(room * 2.5);
    return Array.from({ length: WAVES_A_ROOM }, (_, i) => {
        const pace = LUMBRIDGE_WAVES[Math.min(first + i, LUMBRIDGE_WAVES.length - 1)];
        const who =
            enemies[Math.min(Math.floor((i * enemies.length) / WAVES_A_ROOM), enemies.length - 1)];
        return { ...pace, start: i * WAVE_STEP, enemies: who };
    });
}

// Elites through the room, and a ring of its commonest enemy late on
function roomEvents(elite: string, ring: string, count: number): RunEventDef[] {
    return [
        { at: 60, kind: "elite", enemyId: elite },
        { at: 150, kind: "elite", enemyId: elite },
        { at: 200, kind: "ring", enemyId: ring, count },
        { at: 240, kind: "elite", enemyId: elite },
    ];
}

type TobRoom = Omit<RaidRoomDef, "start" | "arrive" | "bossAt" | "chamber" | "at">;

function tobRoom(id: TobRoomId, room: TobRoom, index: number): RaidRoomDef {
    const place = TOB_ROOM_PLACES.find((p) => p.id === id)!;
    return {
        ...room,
        start: place.start,
        arrive: place.arrive,
        bossAt: place.boss,
        chamber: place.chamber,
        teleporter: place.teleporter,
        at: (index + 1) * ROOM_MINUTES * 60,
    };
}

// The Theatre's rooms in its own order. A raid's meant to be as hard as the Inferno: bosses' hitpoints
// are set so each lasts a minute or more against a build with everything bought (simulate-run's
// bot), lower on the Bloat, who walks his loop, and Sotetseg, whose maze is the danger.
const TOB_ROOMS: RaidRoomDef[] = [
    tobRoom(
        "maiden",
        {
            name: "The Maiden of Sugadinti",
            waves: roomWaves(0, [
                [{ id: "blood_spawn", weight: 3 }],
                [
                    { id: "blood_spawn", weight: 3 },
                    { id: "vampyre_juvenile", weight: 1 },
                ],
                [
                    { id: "blood_spawn", weight: 2 },
                    { id: "nylocas_matomenos", weight: 1 },
                    { id: "vampyre_juvenile", weight: 1 },
                ],
            ]),
            events: roomEvents("nylocas_matomenos", "blood_spawn", 24),
            boss: "maiden_of_sugadinti",
            bossHp: 12000,
        },
        0,
    ),
    tobRoom(
        "bloat",
        {
            name: "The Pestilent Bloat",
            waves: roomWaves(1, [
                [
                    { id: "ghast", weight: 3 },
                    { id: "bloodworm", weight: 1 },
                ],
                [
                    { id: "myre_zombie", weight: 2 },
                    { id: "ghast", weight: 2 },
                ],
                [
                    { id: "myre_zombie", weight: 2 },
                    { id: "feral_vampyre", weight: 2 },
                ],
            ]),
            events: roomEvents("feral_vampyre", "ghast", 30),
            boss: "tob_pestilent_bloat",
            bossHp: 8000,
        },
        1,
    ),
    tobRoom(
        "nylocas",
        {
            name: "Nylocas Vasilias",
            waves: roomWaves(2, [
                [
                    { id: "nylocas_ischyros", weight: 3 },
                    { id: "nylocas_toxobolos", weight: 1 },
                ],
                [
                    { id: "nylocas_ischyros", weight: 2 },
                    { id: "nylocas_toxobolos", weight: 2 },
                    { id: "nylocas_hagios", weight: 2 },
                ],
                [
                    { id: "big_nylocas_ischyros", weight: 1 },
                    { id: "nylocas_toxobolos", weight: 2 },
                    { id: "nylocas_hagios", weight: 2 },
                ],
            ]),
            events: roomEvents("big_nylocas_ischyros", "nylocas_ischyros", 40),
            boss: "nylocas_vasilias",
            bossHp: 20000,
        },
        2,
    ),
    tobRoom(
        "sotetseg",
        {
            name: "Sotetseg",
            waves: roomWaves(3, [
                [
                    { id: "vampyre_juvinate", weight: 2 },
                    { id: "mutated_bloodveld", weight: 1 },
                ],
                [
                    { id: "mutated_bloodveld", weight: 2 },
                    { id: "nail_beast", weight: 2 },
                ],
                [
                    { id: "mutated_bloodveld", weight: 2 },
                    { id: "vampyre_juvinate", weight: 2 },
                    { id: "big_nylocas_toxobolos", weight: 1 },
                ],
            ]),
            events: roomEvents("mutated_bloodveld", "vampyre_juvinate", 36),
            boss: "tob_sotetseg",
            bossHp: 8000,
        },
        3,
    ),
    tobRoom(
        "xarpus",
        {
            name: "Xarpus",
            waves: roomWaves(4, [
                [
                    { id: "vyrewatch", weight: 2 },
                    { id: "nylocas_hagios", weight: 2 },
                ],
                [
                    { id: "vyrewatch", weight: 2 },
                    { id: "big_nylocas_hagios", weight: 1 },
                    { id: "mutated_bloodveld", weight: 1 },
                ],
                [
                    { id: "vyrewatch_sentinel", weight: 2 },
                    { id: "vyrewatch", weight: 2 },
                ],
            ]),
            events: roomEvents("vyrewatch_sentinel", "nylocas_hagios", 50),
            boss: "xarpus",
            bossHp: 24000,
        },
        4,
    ),
    tobRoom(
        "verzik",
        {
            name: "Verzik Vitur",
            waves: roomWaves(5, [
                [
                    { id: "vyrewatch_sentinel", weight: 2 },
                    { id: "big_nylocas_ischyros", weight: 2 },
                ],
                [
                    { id: "vyrewatch_sentinel", weight: 2 },
                    { id: "big_nylocas_toxobolos", weight: 1 },
                    { id: "big_nylocas_hagios", weight: 1 },
                    { id: "vyrewatch", weight: 1 },
                ],
                [
                    { id: "vyrewatch_sentinel", weight: 2 },
                    { id: "big_nylocas_ischyros", weight: 1 },
                    { id: "big_nylocas_toxobolos", weight: 1 },
                    { id: "big_nylocas_hagios", weight: 1 },
                ],
            ]),
            events: roomEvents("vyrewatch_sentinel", "nylocas_ischyros", 60),
            boss: "tob_verzik_vitur",
            // Each of her three forms has this many hitpoints
            bossHp: 16000,
        },
        5,
    ),
];

// Every room's waves and events (and bosses), for what bakes a map's enemies and checks them
function allOf(rooms: RaidRoomDef[]): Pick<MapDef, "waves" | "events"> {
    return {
        waves: rooms.flatMap((room) => room.waves),
        events: rooms.flatMap((room, i): RunEventDef[] => [
            ...room.events,
            {
                at: room.at,
                kind: i === rooms.length - 1 ? "finalBoss" : "boss",
                enemyId: room.boss,
                hp: room.bossHp,
            },
        ]),
    };
}

export const RAID_MAPS: MapDef[] = [
    {
        id: "theatre_of_blood",
        name: "Theatre of Blood",
        description:
            "A raid: six rooms one after another, each with its own waves and then its boss. The " +
            "Maiden of Sugadinti, the Pestilent Bloat, Nylocas Vasilias, Sotetseg, Xarpus, and " +
            "Verzik Vitur at the end. Beat a room's boss to move on to the next. They pray against " +
            "missiles and magic: it's a melee raid. The faster and " +
            "cleaner, the more raid points: they pay coins, buy supplies between rooms, and " +
            "better your chances at a purple in the chest at the end. Beat it once for two " +
            "teleports a raid, in the halls, to skip a room's waves. Beat it on hard for expert " +
            "mode: the Nylocas only take their own style, the Maiden's heal her, Xarpus stares " +
            "and Verzik's ball must be hidden from, for twice the coins and one of Lil' Zik's " +
            "looks each clear.",
        // Lil' Zik
        iconObjId: 22473,
        arena: getRecipeArena(THEATRE_OF_BLOOD),
        spawn: TOB_ROOMS[0].start,
        // As hard as the Inferno, the campaign's hardest map
        difficulty: { hp: 3.75, damage: 2.7 },
        hard: { hp: 1.4, damage: 1.2 },
        ...allOf(TOB_ROOMS),
        raid: { rooms: TOB_ROOMS },
        finalBossWarning: "The Theatre's curtain rises... Verzik Vitur awaits!",
        victoryText: "The Theatre of Blood is complete!",
        music: "Massacre",
        scaperune: true,
        brightness: 0.85,
    },
];
