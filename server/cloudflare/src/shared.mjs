// What the Cloudflare relay's lobby and rooms share: limits and the checks on
// what players send, as server/coop-relay.mjs has them (copied rather than
// imported, as that file needs Node's http and net)

export const MAX_PARTY = 4;
const MAX_UNLOCKED_MAPS = 200;
export const MAX_ROOMS = 500;
export const MAX_CONNECTIONS_PER_ADDRESS = 16;
export const MAX_ROOMS_PER_ADDRESS = 4;
export const MAX_CREATES_PER_MINUTE = 10;
export const MAX_JOINS_PER_MINUTE = 12;
export const MAX_WRONG_CODES_PER_MINUTE = 20;
export const IDLE_MS = 30 * 60_000;
export const MAX_LOADOUT_BYTES = 16 * 1024;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_FRAMES_PER_SECOND = 400;
export const MAX_BYTES_PER_SECOND = 2 * MAX_MESSAGE_BYTES;
export const MAX_UP_BYTES = 1024;
export const MAX_UPS_PER_SECOND = 60;
export const MAX_ME_BYTES = 40 * 1024;
const MAX_DEPTH = 16;
export const MEMBER_UPDATE_MS = 250;
export const LIST_PAGE_SIZE = 8;
export const MAX_LIST_PAGE_SIZE = 20;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const FULL_TEXT = "All rooms are taken right now. Try again when one opens.";
export const OTHER_BUILD_TEXT =
    "That room's on another version of the game. Reload the page to get the latest.";

export function isAnyMapOn(env) {
    return ["on", "1", "true"].includes((env.MULTIPLAYER_ANY_MAP ?? "").toLowerCase());
}

export function lobbyStub(env) {
    return env.LOBBY.get(env.LOBBY.idFromName("lobby"));
}

function randomIndex(n) {
    return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

export function newCode(taken) {
    for (;;) {
        let code = "";
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_CHARS[randomIndex(CODE_CHARS.length)];
        }
        if (!taken(code)) {
            return code;
        }
    }
}

// Player ids are made by the lobby but used in rooms, which it can't see, so
// they're random rather than counted
export function randomToken(bytes = 16) {
    return [...crypto.getRandomValues(new Uint8Array(bytes))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// An IPv6 address by its /64 (see coop-relay.mjs)
export function addressKey(address) {
    if (!address.includes(":")) {
        return address;
    }
    const groups = (part) => (part ? part.split(":") : []);
    const [head, tail] = address.toLowerCase().split("::");
    const before = groups(head);
    const after = groups(tail);
    const all =
        tail === undefined
            ? before
            : [
                  ...before,
                  ...Array(Math.max(0, 8 - before.length - after.length)).fill("0"),
                  ...after,
              ];
    return `${all
        .slice(0, 4)
        .map((group) => parseInt(group, 16).toString(16))
        .join(":")}::/64`;
}

// A country as ISO 3166's two letters ("FI"), or undefined. Cloudflare says
// XX for one it doesn't know and T1 for Tor.
export function countryCode(text) {
    const code = typeof text === "string" ? text.trim().toUpperCase() : "";
    return /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : undefined;
}

export function guesserKey(address) {
    return address.endsWith("::/64") ? `${address.split(":").slice(0, 3).join(":")}::/48` : address;
}

export function cleanId(id) {
    return typeof id === "string" ? id.replace(/[^a-z0-9_]/g, "").slice(0, 40) : "";
}

export function cleanUnlocks(unlocks) {
    const list = (ids) =>
        Array.isArray(ids) ? ids.slice(0, MAX_UNLOCKED_MAPS).map(cleanId).filter(Boolean) : [];
    return {
        maps: list(unlocks?.maps),
        endless: list(unlocks?.endless),
        hard: list(unlocks?.hard),
    };
}

function hasUnlocked(unlocks, mapId, endless, hard) {
    return (
        unlocks.maps.includes(mapId) &&
        (!endless || unlocks.endless.includes(mapId)) &&
        (!hard || unlocks.hard.includes(mapId))
    );
}

export function clampInt(value, min, max, fallback) {
    const n = Number.isInteger(value) ? value : fallback;
    return Math.max(min, Math.min(max, n));
}

// The first of these players without the map, as an error for whoever's
// asking, or nothing
export function missingMap(anyMap, players, mapId, endless, hard, asking) {
    if (anyMap) {
        return undefined;
    }
    for (const { client, unlocks = client.unlocks } of players) {
        if (!hasUnlocked(unlocks, mapId, endless, hard)) {
            const need = {
                mapId,
                endless,
                hard,
                ...(client !== asking && { who: client.name }),
            };
            const what = `${mapId}${hard ? " (hard)" : ""}${endless ? " (endless)" : ""}`;
            return {
                t: "error",
                message:
                    client === asking
                        ? `You need ${what} unlocked to join this room.`
                        : `${client.name} hasn't got ${what} unlocked.`,
                need,
            };
        }
    }
    return undefined;
}

// Whether JSON nests deeper than the game ever sends (a scan, so it can't run
// out of stack)
export function depthOver(text, max = MAX_DEPTH) {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (inString) {
            if (c === 0x5c) {
                i++;
            } else if (c === 0x22) {
                inString = false;
            }
        } else if (c === 0x22) {
            inString = true;
        } else if (c === 0x7b || c === 0x5b) {
            if (++depth > max) {
                return true;
            }
        } else if (c === 0x7d || c === 0x5d) {
            depth--;
        }
    }
    return false;
}

// A message from a player, or undefined for one to ignore. Text only, an
// object, and nothing nested deeper than a game sends (bar the host's frames,
// which go straight on).
export function parseMessage(data) {
    if (typeof data !== "string" || data.length > MAX_MESSAGE_BYTES) {
        return undefined;
    }
    let message;
    try {
        message = JSON.parse(data);
    } catch {
        return undefined;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
        return undefined;
    }
    if (message.t !== "down" && depthOver(data)) {
        return undefined;
    }
    return message;
}

// Counts a connection's messages and bytes each second; false once it's over
export class RateLimit {
    second = 0;
    frames = 0;
    bytes = 0;

    allow(length) {
        const second = Math.floor(Date.now() / 1000);
        if (second !== this.second) {
            this.second = second;
            this.frames = 0;
            this.bytes = 0;
        }
        this.bytes += length;
        return ++this.frames <= MAX_FRAMES_PER_SECOND && this.bytes <= MAX_BYTES_PER_SECOND;
    }
}

// Whether an address did something fewer than limit times in the last
// minute, noting it if so
export function underLimit(times, address, limit) {
    const now = Date.now();
    const recent = (times.get(address) ?? []).filter((t) => now - t < 60_000);
    const under = recent.length < limit;
    if (under) {
        recent.push(now);
    }
    times.set(address, recent);
    return under;
}
