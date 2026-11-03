// The lobby: one for the whole relay. Every player's first connection comes
// here, for their name, the open rooms list, and making or joining a room.
// It doesn't hold rooms: each room is its own Durable Object (room.mjs),
// started near whoever made it. To make or join one, the lobby checks the
// limits and hands the player a ticket ("goto"), which they take to the
// room's own connection.
//
// It hibernates between messages (WebSocket hibernation), so it costs next to
// nothing while players sit in menus. What it must not forget, the rooms
// list, is in its storage; the per-minute limits are fine to lose.
import { DurableObject } from "cloudflare:workers";

import { playerName, roomName } from "../../name-gen.mjs";
import {
    FULL_TEXT,
    LIST_PAGE_SIZE,
    MAX_CONNECTIONS_PER_ADDRESS,
    MAX_CREATES_PER_MINUTE,
    MAX_JOINS_PER_MINUTE,
    MAX_LIST_PAGE_SIZE,
    MAX_PARTY,
    MAX_ROOMS,
    MAX_ROOMS_PER_ADDRESS,
    MAX_WRONG_CODES_PER_MINUTE,
    RateLimit,
    clampInt,
    cleanId,
    cleanUnlocks,
    countryCode,
    guesserKey,
    isAnyMapOn,
    missingMap,
    newCode,
    parseMessage,
    randomToken,
    underLimit,
} from "./shared.mjs";

// A room that hasn't said it's there for this long is gone (it says so every
// ROOM_HEARTBEAT_MS, in room.mjs)
const ROOM_STALE_MS = 90_000;
// A ticket's only good for a moment: the player goes straight to the room
const TICKET_MS = 30_000;

export class Lobby extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.anyMap = isAnyMapOn(env);
        // code -> what the list shows, and who hosts it
        this.rooms = new Map();
        // ticket -> who it's for and where
        this.tickets = new Map();
        this.createdFrom = new Map();
        this.joinedFrom = new Map();
        this.wrongCodesFrom = new Map();
        this.limits = new WeakMap();
        this.openRooms = undefined;
        // The client's keep-alive, answered without waking the lobby
        ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'),
        );
        ctx.blockConcurrencyWhile(async () => {
            const now = Date.now();
            for (const [, entry] of await ctx.storage.list({ prefix: "room:" })) {
                // Just woken: give each room time to say it's still there
                this.rooms.set(entry.code, { ...entry, lastSeen: now });
            }
        });
    }

    // ---- Players' connections ----

    async fetch(request) {
        const address = request.headers.get("x-address") ?? "unknown";
        const sockets = this.ctx.getWebSockets();
        const fromHere = sockets.filter((ws) => ws.deserializeAttachment()?.address === address);
        if (fromHere.length >= MAX_CONNECTIONS_PER_ADDRESS) {
            return new Response(null, { status: 429 });
        }
        const [client, server] = Object.values(new WebSocketPair());
        const player = {
            id: `p${randomToken(6)}`,
            name: this.newPlayerName(),
            address,
        };
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(player);
        // country: for their own flag, as others see it (rooms find it for
        // themselves, from their own connection)
        server.send(
            JSON.stringify({
                t: "welcome",
                id: player.id,
                name: player.name,
                anyMap: this.anyMap,
                country: countryCode(request.headers.get("x-country")),
            }),
        );
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, data) {
        let limit = this.limits.get(ws);
        if (!limit) {
            limit = new RateLimit();
            this.limits.set(ws, limit);
        }
        if (!limit.allow(typeof data === "string" ? data.length : data.byteLength)) {
            ws.close(1008, "Too much");
            return;
        }
        const message = parseMessage(data);
        if (!message) {
            return;
        }
        const player = ws.deserializeAttachment();
        const send = (m) => ws.send(JSON.stringify(m));
        const error = (text) => send({ t: "error", message: text });
        switch (message.t) {
            case "ping":
                send({ t: "pong" });
                return;
            case "list":
                send(this.list(message));
                return;
            case "rename": {
                player.name = this.newPlayerName();
                ws.serializeAttachment(player);
                send({ t: "named", name: player.name });
                return;
            }
            case "create": {
                const live = this.liveRooms();
                if (live.length >= MAX_ROOMS) {
                    error(FULL_TEXT);
                    return;
                }
                const hosted = live.filter((room) => room.hostAddress === player.address).length;
                if (hosted >= MAX_ROOMS_PER_ADDRESS) {
                    error("There are too many rooms from your connection already.");
                    return;
                }
                const hostMissing = missingMap(
                    this.anyMap,
                    [{ client: player, unlocks: cleanUnlocks(message.me?.unlocks) }],
                    cleanId(message.mapId) || "lumbridge",
                    message.endless === true,
                    message.hard === true,
                    player,
                );
                if (hostMissing) {
                    send(hostMissing);
                    return;
                }
                if (!underLimit(this.createdFrom, player.address, MAX_CREATES_PER_MINUTE)) {
                    error("That's a lot of rooms. Wait a minute before making another.");
                    return;
                }
                const code = newCode((c) => this.rooms.has(c));
                const taken = new Set(live.map((room) => room.name));
                const name = roomName((n) => taken.has(n));
                // Held until the room says it's there (or goes stale)
                await this.putRoom({
                    code,
                    name,
                    pending: true,
                    hostAddress: player.address,
                    order: Date.now(),
                });
                send({ t: "goto", code, ticket: this.ticket(player, code, "create", name) });
                return;
            }
            case "join": {
                const guesser = guesserKey(player.address);
                const recentWrong = (this.wrongCodesFrom.get(guesser) ?? []).filter(
                    (t) => Date.now() - t < 60_000,
                );
                if (recentWrong.length >= MAX_WRONG_CODES_PER_MINUTE) {
                    error("That's a lot of wrong codes. Wait a minute and try again.");
                    return;
                }
                const code =
                    typeof message.code === "string" ? message.code.toUpperCase().slice(0, 16) : "";
                const room = this.liveRoom(code);
                if (!room || room.pending) {
                    underLimit(this.wrongCodesFrom, guesser, Infinity);
                    error(`There's no room ${code || "with that code"}.`);
                    return;
                }
                if (room.started) {
                    error("That room's run has already started.");
                    return;
                }
                if (room.players >= MAX_PARTY) {
                    error("That room is full.");
                    return;
                }
                if (!underLimit(this.joinedFrom, player.address, MAX_JOINS_PER_MINUTE)) {
                    error("That's a lot of joining. Wait a minute and try again.");
                    return;
                }
                // The room checks the rest (kicked, maps, version), as it knows
                // its players
                send({ t: "goto", code, ticket: this.ticket(player, code, "join") });
                return;
            }
        }
    }

    async webSocketClose(ws, code) {
        try {
            ws.close(code === 1005 ? 1000 : code);
        } catch {
            // Already closed
        }
    }

    // ---- What the rooms call ----

    // Who a ticket's for, used up, or undefined for one that's no good here
    redeem(ticket, code) {
        const entry = typeof ticket === "string" ? this.tickets.get(ticket) : undefined;
        this.tickets.delete(ticket);
        if (!entry || entry.code !== code || Date.now() > entry.expires) {
            return undefined;
        }
        return entry;
    }

    // A room saying it's there, and how it is now
    async roomUpdate(entry) {
        const previous = this.rooms.get(entry.code);
        const changed =
            !previous ||
            previous.pending ||
            [
                "name",
                "open",
                "started",
                "players",
                "mapId",
                "endless",
                "hard",
                "host",
                "country",
            ].some((key) => previous[key] !== entry[key]);
        if (changed) {
            await this.putRoom({ ...entry, order: previous?.order ?? entry.order });
        } else {
            previous.lastSeen = Date.now();
        }
    }

    async roomGone(code) {
        this.rooms.delete(code);
        this.openRooms = undefined;
        await this.ctx.storage.delete(`room:${code}`);
    }

    // For a plain GET of the relay: whether it's there, as the game asks
    status() {
        const live = this.liveRooms();
        return {
            coop: true,
            players: this.ctx.getWebSockets().length,
            rooms: live.length,
            full: live.length >= MAX_ROOMS,
        };
    }

    // ---- ----

    async putRoom(entry) {
        const stored = { ...entry };
        delete stored.lastSeen;
        this.rooms.set(entry.code, { ...entry, lastSeen: Date.now() });
        this.openRooms = undefined;
        await this.ctx.storage.put(`room:${entry.code}`, stored);
    }

    liveRoom(code) {
        const room = this.rooms.get(code);
        if (room && Date.now() - room.lastSeen > ROOM_STALE_MS) {
            // Gone without saying (its object restarted, or a ticket unused)
            this.roomGone(code);
            return undefined;
        }
        return room;
    }

    liveRooms() {
        return [...this.rooms.keys()].map((code) => this.liveRoom(code)).filter(Boolean);
    }

    list(message) {
        this.openRooms ??= this.liveRooms()
            .filter((room) => !room.pending && room.open && !room.started)
            .filter((room) => room.players < MAX_PARTY)
            .sort((a, b) => b.players - a.players || a.order - b.order)
            .map((room) => ({
                code: room.code,
                name: room.name,
                host: room.host ?? "",
                country: room.country,
                players: room.players,
                max: MAX_PARTY,
                mapId: room.mapId,
                endless: room.endless,
                hard: room.hard === true,
            }));
        const all = this.openRooms;
        const size = clampInt(message.size, 1, MAX_LIST_PAGE_SIZE, LIST_PAGE_SIZE);
        const pages = Math.max(1, Math.ceil(all.length / size));
        const page = clampInt(message.page, 0, pages - 1, 0);
        return {
            t: "rooms",
            rooms: all.slice(page * size, (page + 1) * size),
            page,
            pages,
            total: all.length,
            full: this.liveRooms().length >= MAX_ROOMS,
        };
    }

    ticket(player, code, kind, roomName) {
        const now = Date.now();
        for (const [token, entry] of this.tickets) {
            if (now > entry.expires) {
                this.tickets.delete(token);
            }
        }
        const token = randomToken();
        this.tickets.set(token, {
            id: player.id,
            name: player.name,
            address: player.address,
            code,
            kind,
            roomName,
            expires: now + TICKET_MS,
        });
        return token;
    }

    newPlayerName() {
        const taken = new Set(
            this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.name),
        );
        return playerName((name) => taken.has(name));
    }
}
