// What the game and the co-op relay (server/coop-relay.mjs) say to each other,
// as JSON over a WebSocket
import { CoopAction, FrameEvent } from "../../core/lockstep";

// What a player brings to a run from their save, for everyone's copy of it
export type Loadout = {
    metaStats: Record<string, number>;
    unlockedItems: string[];
    armoury: Record<string, number>;
};

// The maps a player has unlocked, and has endless and hard mode for, which
// rooms go by unless the relay takes anyone (MULTIPLAYER_ANY_MAP)
// A relay from before 0.23.0 sends no hard
export type Unlocks = { maps: string[]; endless: string[]; hard?: string[] };

export type MemberView = {
    id: string;
    // Given by the relay (server/name-gen.mjs), not picked
    name: string;
    characterId: string;
    ready: boolean;
    loadout?: Loadout;
    unlocks?: Unlocks;
    // The build their game is (__BUILD_ID__): a room only takes the host's
    build?: string;
    // Where they're playing from, for their flag: ISO 3166's two letters
    // ("FI"). Only a relay that knows it (Cloudflare's, or one behind it)
    // sends it, and not for a player who's hidden it.
    country?: string;
};

// What a player says about themselves: everything but their id, name and
// country, which the relay gives. hideCountry: keep their flag to themselves.
export type Member = Omit<MemberView, "id" | "name" | "country"> & { hideCountry?: boolean };

// What a player's missing to play on a room's map: the map (its endless or
// hard mode too, for a room that's on them), and who, when it's someone else
export type MissingMap = { mapId: string; endless: boolean; hard: boolean; who?: string };

export type RoomView = {
    code: string;
    // Given by the relay when the room's made, like a player's
    name: string;
    // Listed for anyone to join, or invite only (by its code)
    open: boolean;
    hostId: string;
    mapId: string;
    endless: boolean;
    hard: boolean;
    // A run is under way
    started: boolean;
    members: MemberView[];
};

// An open room, as the list of them shows it
export type RoomListing = {
    code: string;
    name: string;
    host: string;
    // The host's, for their flag (see MemberView)
    country?: string;
    players: number;
    max: number;
    mapId: string;
    endless: boolean;
    hard: boolean;
};

// Everything a player's copy of the run needs, from the host, in the order
// the heroes go
export type GameStart = {
    seed: number;
    mapId: string;
    endless: boolean;
    hard: boolean;
    heroes: { id: string; name: string; characterId: string; loadout: Loadout }[];
};

// Whether a start from the host is one every game could play: a modified one
// could send anything
export function isGameStart(value: unknown, maxParty: number): value is GameStart {
    const game = value as GameStart | undefined;
    return (
        !!game &&
        typeof game === "object" &&
        Number.isSafeInteger(game.seed) &&
        typeof game.mapId === "string" &&
        typeof game.endless === "boolean" &&
        typeof game.hard === "boolean" &&
        Array.isArray(game.heroes) &&
        game.heroes.length > 0 &&
        game.heroes.length <= maxParty &&
        game.heroes.every(
            (hero) =>
                !!hero &&
                typeof hero === "object" &&
                typeof hero.id === "string" &&
                typeof hero.name === "string" &&
                hero.name.length <= 64 &&
                typeof hero.characterId === "string",
        ) &&
        new Set(game.heroes.map((hero) => hero.id)).size === game.heroes.length
    );
}

// Why a player is out of a room
// (idle: nothing happened in the room for half an hour)
export type GoneReason = "left" | "kicked" | "disbanded" | "hostLeft" | "idle";

// A guest to the host: a move, something they did, or that their copy of the
// run is ready to go (the map's loaded)
export type UpMessage =
    | { move: [number, number]; moveSeq?: number }
    | { action: CoopAction; actionSeq?: number }
    | { loaded: true }
    // The frames after this one again: some of the host's went missing (a
    // dropped connection)
    | { resend: number };

// The host to everyone: the frames up to `upTo` are out, with what happened
// at them, and now and then a check that everyone's run still agrees
export type DownMessage = {
    // The frames before were in the message before this one, so a guest can
    // tell when one's gone missing
    from?: number;
    upTo: number;
    events: FrameEvent[];
    hash?: [number, number];
};

export type ClientMessage =
    | { t: "ping" }
    // A page of the open rooms (0 for the first), size to a page
    | { t: "list"; page?: number; size?: number }
    | {
          t: "create";
          open: boolean;
          mapId: string;
          endless: boolean;
          hard: boolean;
          me: Partial<Member>;
      }
    | { t: "join"; code: string; me: Partial<Member> }
    | { t: "leave" }
    | ({ t: "me" } & Partial<Member>)
    // A new name, from the relay (not during a run)
    | { t: "rename" }
    | { t: "settings"; open?: boolean; mapId?: string; endless?: boolean; hard?: boolean }
    | { t: "kick"; id: string }
    | { t: "disband" }
    | { t: "start"; game: GameStart }
    | { t: "end" }
    | { t: "up"; d: UpMessage }
    | { t: "down"; d: DownMessage };

export type ServerMessage =
    // name: the one the relay's given this player. anyMap: rooms take players
    // whatever maps they have. country: theirs, as others see it on their
    // flag, if the relay knows it.
    | { t: "welcome"; id: string; name: string; anyMap?: boolean; country?: string }
    // This player's new name, after asking for one
    | { t: "named"; name: string }
    | { t: "pong" }
    // A page of the open rooms, which page it is (the last, if the one asked
    // for has gone), of how many, and how many rooms in all
    | {
          t: "rooms";
          rooms: RoomListing[];
          page: number;
          pages: number;
          total: number;
          // Every room the relay can hold is taken
          full: boolean;
      }
    // token: to come back to the room with, should the connection drop (the
    // Cloudflare relay's; coop/room/<code>?resume=<token>)
    | { t: "room"; room: RoomView; you: string; token?: string }
    // The relay keeps each room on its own connection (the Cloudflare relay,
    // server/cloudflare): make or join it there, at coop/room/<code>, with
    // this ticket. The Node relay never sends it.
    | { t: "goto"; code: string; ticket: string }
    | { t: "gone"; reason: GoneReason }
    | { t: "error"; message: string; need?: MissingMap }
    | { t: "start"; game: GameStart }
    | { t: "left"; id: string }
    | { t: "up"; from: string; d: UpMessage }
    | { t: "down"; d: DownMessage };
