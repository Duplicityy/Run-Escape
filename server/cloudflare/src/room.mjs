// One co-op room, as its own Durable Object. Cloudflare starts it near the
// first request for it, which is the host making it, so the host's frames
// and the guests' inputs go through a relay close to the host rather than one
// fixed place. What it does is server/coop-relay.mjs's rooms, one room at a
// time: players come with a ticket from the lobby (lobby.mjs) and send their
// create or join first.
//
// It doesn't hibernate: mid-run it's passing messages all the time anyway.
//
// Cloudflare restarts Durable Objects now and then (runtime updates, moving
// them), which drops every connection and what's in memory. So the room keeps
// itself in storage, and a player whose connection drops is held for
// RESUME_GRACE_MS: their game reconnects with the token the room gave them
// (coop/room/<code>?resume=<token>) and carries on. The host's game resends
// frames a guest missed meanwhile (see CoopRun).
import { DurableObject } from "cloudflare:workers";

import { playerName } from "../../name-gen.mjs";
import {
    IDLE_MS,
    MAX_LOADOUT_BYTES,
    MAX_ME_BYTES,
    MAX_PARTY,
    MAX_UPS_PER_SECOND,
    MAX_UP_BYTES,
    MEMBER_UPDATE_MS,
    OTHER_BUILD_TEXT,
    RateLimit,
    cleanId,
    cleanUnlocks,
    countryCode,
    isAnyMapOn,
    lobbyStub,
    missingMap,
    parseMessage,
    randomToken,
} from "./shared.mjs";

// How often a room tells the lobby it's still there
const ROOM_HEARTBEAT_MS = 30_000;
// How long a player whose connection dropped keeps their place: longer than
// their game keeps trying (RESUME_WINDOW_MS in CoopLobby.ts)
const RESUME_GRACE_MS = 15_000;
// A connection that hasn't made or joined the room by now is closed. An open
// socket keeps this object running (and billed), and the lobby forgets a room
// that never got made, so nothing else would end it.
const ENTER_MS = 10_000;
// The room's saved, and the lobby told, this often at most
const SAVE_MS = 1000;

// A player's country, for their flag, unless they've hidden it. An open
// room's host shows theirs anyway: it's where the room is, for whoever's
// picking one from the list.
function shownCountry(member, room) {
    const openHost = room.open && room.hostId === member.id;
    return member.hideCountry && !openHost ? undefined : member.country;
}

export class Room extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.anyMap = isAnyMapOn(env);
        this.lobby = lobbyStub(env);
        this.code = "";
        // The room, once it's made, until it's empty or closed
        this.room = undefined;
        // Kicked addresses outlast a room's members, for the room's life
        this.kicked = new Set();
        // A room from before a restart
        ctx.blockConcurrencyWhile(() => this.load());
    }

    async fetch(request) {
        const url = new URL(request.url);
        const code = url.pathname.split("/").pop() ?? "";
        const resume = url.searchParams.get("resume");
        if (resume) {
            return this.resume(resume);
        }
        const who = await this.lobby.redeem(url.searchParams.get("ticket"), code);
        if (!who) {
            return new Response(null, { status: 403 });
        }
        this.code = code;
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        const member = this.newMember({
            id: who.id,
            name: who.name,
            address: request.headers.get("x-address") ?? who.address,
            country: countryCode(request.headers.get("x-country")),
            kind: who.kind,
            roomName: who.roomName,
        });
        this.attach(member, server);
        setTimeout(() => {
            if (!member.closed && !this.room?.members.includes(member)) {
                this.closeSocket(member, 1008);
            }
        }, ENTER_MS);
        return new Response(null, { status: 101, webSocket: client });
    }

    newMember(fields) {
        return {
            characterId: "",
            ready: false,
            loadout: undefined,
            unlocks: cleanUnlocks(undefined),
            build: undefined,
            // For their flag (index.mjs), and whether they've hidden it
            country: undefined,
            hideCountry: false,
            // Given on making or joining the room, to come back with
            token: undefined,
            ...fields,
            // Undefined while their connection's dropped
            socket: undefined,
            awayTimer: undefined,
            limit: new RateLimit(),
            upSecond: 0,
            upsThisSecond: 0,
        };
    }

    attach(member, socket) {
        clearTimeout(member.awayTimer);
        member.awayTimer = undefined;
        member.socket = socket;
        socket.addEventListener("message", (event) => {
            if (member.socket === socket) {
                this.receive(member, event.data);
            }
        });
        socket.addEventListener("close", () => this.lost(member, socket));
        socket.addEventListener("error", () => this.lost(member, socket));
    }

    // A player's game coming back after its connection dropped
    resume(token) {
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        const member = this.room?.members.find((m) => m.token === token && !m.closed);
        if (!member) {
            server.send(
                JSON.stringify({ t: "error", message: "The room closed while you were away." }),
            );
            server.close(1000);
            return new Response(null, { status: 101, webSocket: client });
        }
        const old = member.socket;
        this.attach(member, server);
        member.limit = new RateLimit();
        try {
            old?.close(1000);
        } catch {
            // Already closed
        }
        this.send(member, {
            t: "room",
            room: this.roomView(),
            you: member.id,
            token: member.token,
        });
        return new Response(null, { status: 101, webSocket: client });
    }

    // A player's connection closed without them leaving: in a room, they're
    // held for a moment to come back
    lost(member, socket) {
        if (member.socket !== socket) {
            return;
        }
        member.socket = undefined;
        if (member.closed) {
            return;
        }
        if (member.token && this.room?.members.includes(member)) {
            this.holdPlace(member);
        } else {
            this.dropped(member);
        }
    }

    holdPlace(member) {
        clearTimeout(member.awayTimer);
        member.awayTimer = setTimeout(() => {
            member.awayTimer = undefined;
            if (!member.socket) {
                this.dropped(member);
            }
        }, RESUME_GRACE_MS);
    }

    // ---- Keeping the room through a restart ----

    async load() {
        const saved = await this.ctx.storage.get("room");
        if (!saved) {
            return;
        }
        this.code = saved.code;
        this.kicked = new Set(saved.kicked);
        const { members, kicked, ...fields } = saved;
        const room = { ...fields, members: [] };
        this.room = room;
        for (const memberFields of members) {
            const member = this.newMember(memberFields);
            room.members.push(member);
            this.holdPlace(member);
        }
        this.startHeartbeat(room);
    }

    // Saves the room and tells the lobby, now or, if that was done in the
    // last SAVE_MS, once that's passed: a host flicking settings can't make
    // a storage write of every message. now: someone joining or leaving, or
    // the run starting or ending, saved at once and before anyone's told
    // (Cloudflare holds back what's sent after a write until it's stored), so
    // a restart straight after can't bring back the room as it was.
    persist(now = false) {
        const room = this.room;
        if (!room) {
            return;
        }
        if (room.saveTimer && !now) {
            room.saveWaiting = true;
            return;
        }
        clearTimeout(room.saveTimer);
        room.saveWaiting = false;
        this.tellLobby();
        this.save();
        room.saveTimer = setTimeout(() => {
            room.saveTimer = undefined;
            if (room.saveWaiting && this.room === room) {
                room.saveWaiting = false;
                this.persist();
            }
        }, SAVE_MS);
    }

    save() {
        const room = this.room;
        if (!room) {
            return;
        }
        const {
            members,
            heartbeat,
            updateTimer,
            updateWaiting,
            saveTimer,
            saveWaiting,
            ...fields
        } = room;
        this.ctx.storage
            .put("room", {
                ...fields,
                members: members.map((m) => ({
                    id: m.id,
                    name: m.name,
                    address: m.address,
                    country: m.country,
                    hideCountry: m.hideCountry,
                    kind: m.kind,
                    characterId: m.characterId,
                    ready: m.ready,
                    loadout: m.loadout,
                    unlocks: m.unlocks,
                    build: m.build,
                    token: m.token,
                })),
                kicked: [...this.kicked],
            })
            .catch((e) => console.warn("Co-op room: couldn't save the room:", e));
        // Clears out a room everyone's gone from, should the relay restart
        // with nobody coming back. Set once: alarm() sets the next.
        if (!room.alarmSet) {
            room.alarmSet = true;
            this.ctx.storage.setAlarm(Date.now() + IDLE_MS).catch(() => {});
        }
    }

    async alarm() {
        if (this.room?.members.some((member) => member.socket)) {
            this.ctx.storage.setAlarm(Date.now() + IDLE_MS).catch(() => {});
        } else if (this.room) {
            this.endRoom();
        } else {
            await this.ctx.storage.deleteAll();
        }
    }

    receive(member, data) {
        if (member.closed) {
            return;
        }
        if (!member.limit.allow(typeof data === "string" ? data.length : data.byteLength)) {
            this.closeSocket(member, 1008);
            this.dropped(member);
            return;
        }
        const message = parseMessage(data);
        if (!message) {
            return;
        }
        try {
            this.handle(member, message, data);
        } catch (e) {
            console.warn("Co-op room: dropped a connection over a message it couldn't handle:", e);
            this.closeSocket(member, 1011);
            this.dropped(member);
        }
    }

    send(member, message) {
        this.sendText(member, JSON.stringify(message));
    }

    sendText(member, text) {
        if (!member.closed && member.socket) {
            try {
                member.socket.send(text);
            } catch {
                // Gone; its close comes next
            }
        }
    }

    closeSocket(member, code = 1000) {
        if (!member.closed) {
            member.closed = true;
            clearTimeout(member.awayTimer);
            const socket = member.socket;
            member.socket = undefined;
            try {
                socket?.close(code);
            } catch {
                // Already closed
            }
        }
    }

    // A player's out of the room for good
    dropped(member) {
        member.closed = true;
        clearTimeout(member.awayTimer);
        if (this.room?.members.includes(member)) {
            this.leaveRoom(member);
        }
    }

    // ---- The room, as coop-relay.mjs ----

    roomView() {
        const room = this.room;
        return {
            code: room.code,
            name: room.name,
            open: room.open,
            hostId: room.hostId,
            mapId: room.mapId,
            endless: room.endless,
            hard: room.hard === true,
            started: room.started,
            members: room.members.map((client) => ({
                id: client.id,
                name: client.name,
                characterId: client.characterId,
                ready: client.ready,
                loadout: client.loadout,
                unlocks: client.unlocks,
                country: shownCountry(client, room),
            })),
        };
    }

    // Saved first by whoever calls it (persist)
    broadcastRoom() {
        const view = this.roomView();
        for (const member of this.room.members) {
            this.send(member, { t: "room", room: view, you: member.id, token: member.token });
        }
    }

    broadcastMembers() {
        const room = this.room;
        if (room.started) {
            return;
        }
        if (room.updateTimer) {
            room.updateWaiting = true;
            return;
        }
        this.persist();
        this.broadcastRoom();
        room.updateTimer = setTimeout(() => {
            room.updateTimer = undefined;
            if (room.updateWaiting && this.room === room) {
                room.updateWaiting = false;
                this.broadcastMembers();
            }
        }, MEMBER_UPDATE_MS);
    }

    tellLobby() {
        const room = this.room;
        if (!room) {
            return;
        }
        const host = room.members.find((member) => member.id === room.hostId);
        this.lobby
            .roomUpdate({
                code: room.code,
                name: room.name,
                open: room.open,
                started: room.started,
                players: room.members.length,
                mapId: room.mapId,
                endless: room.endless,
                hard: room.hard === true,
                host: host?.name ?? "",
                country: host ? shownCountry(host, room) : undefined,
                hostAddress: host?.address ?? "",
                order: room.order,
            })
            .catch((e) => console.warn("Co-op room: couldn't reach the lobby:", e));
    }

    // The room's over: the lobby forgets it and its timers stop
    endRoom() {
        const room = this.room;
        if (!room) {
            return;
        }
        clearInterval(room.heartbeat);
        clearTimeout(room.updateTimer);
        clearTimeout(room.saveTimer);
        this.room = undefined;
        this.kicked.clear();
        this.ctx.storage.deleteAll().catch(() => {});
        this.lobby.roomGone(room.code).catch(() => {});
    }

    leaveRoom(client, reason) {
        const room = this.room;
        room.members = room.members.filter((member) => member !== client);
        client.ready = false;
        if (reason) {
            this.send(client, { t: "gone", reason });
        }
        // Each room has its own connection, so leaving one closes it
        this.closeSocket(client);
        if (room.members.length === 0) {
            this.endRoom();
            return;
        }
        if (room.hostId === client.id) {
            if (room.started) {
                this.disband("hostLeft");
                return;
            }
            room.hostId = room.members[0].id;
        }
        this.persist(true);
        if (room.started) {
            for (const member of room.members) {
                this.send(member, { t: "left", id: client.id });
            }
        }
        this.broadcastRoom();
    }

    disband(reason) {
        const room = this.room;
        const members = room.members;
        room.members = [];
        for (const member of members) {
            member.ready = false;
            this.send(member, { t: "gone", reason });
            this.closeSocket(member);
        }
        this.endRoom();
    }

    setMember(client, message) {
        if (message.characterId !== undefined) {
            client.characterId = cleanId(message.characterId);
        }
        if (message.ready !== undefined) {
            client.ready = message.ready === true;
        }
        if (message.loadout !== undefined) {
            const size = JSON.stringify(message.loadout)?.length ?? 0;
            client.loadout = size <= MAX_LOADOUT_BYTES ? message.loadout : undefined;
        }
        if (message.unlocks !== undefined) {
            client.unlocks = cleanUnlocks(message.unlocks);
        }
        if (typeof message.build === "string") {
            client.build = message.build.slice(0, 64);
        }
        if (message.hideCountry !== undefined) {
            client.hideCountry = message.hideCountry === true;
        }
    }

    allowUp(client, text) {
        const second = Math.floor(Date.now() / 1000);
        if (second !== client.upSecond) {
            client.upSecond = second;
            client.upsThisSecond = 0;
        }
        return text.length <= MAX_UP_BYTES && ++client.upsThisSecond <= MAX_UPS_PER_SECOND;
    }

    handle(client, message, text) {
        const error = (message) => this.send(client, { t: "error", message });
        if (message.t === "ping") {
            this.send(client, { t: "pong" });
            return;
        }
        if (message.t === "create") {
            this.create(client, message);
            return;
        }
        if (message.t === "join") {
            this.join(client, message);
            return;
        }
        const room = this.room;
        if (!room || !room.members.includes(client)) {
            return;
        }
        if (message.t !== "me") {
            room.lastActive = Date.now();
        }
        const isHost = room.hostId === client.id;
        switch (message.t) {
            case "leave":
                this.leaveRoom(client, "left");
                return;
            case "me":
                if (text.length <= MAX_ME_BYTES) {
                    this.setMember(client, message);
                    this.broadcastMembers();
                }
                return;
            case "rename":
                if (!room.started) {
                    const taken = new Set(room.members.map((member) => member.name));
                    client.name = playerName((name) => taken.has(name));
                    this.send(client, { t: "named", name: client.name });
                    this.broadcastMembers();
                }
                return;
            case "settings":
                if (isHost && !room.started) {
                    const open = message.open !== undefined ? message.open === true : room.open;
                    const mapId =
                        message.mapId !== undefined
                            ? cleanId(message.mapId) || room.mapId
                            : room.mapId;
                    const endless =
                        message.endless !== undefined ? message.endless === true : room.endless;
                    const hard =
                        message.hard !== undefined ? message.hard === true : room.hard === true;
                    const missing = missingMap(
                        this.anyMap,
                        room.members.map((member) => ({ client: member })),
                        mapId,
                        endless,
                        hard,
                        client,
                    );
                    if (missing) {
                        this.send(client, missing);
                    }
                    const changed =
                        open !== room.open ||
                        (!missing &&
                            (mapId !== room.mapId ||
                                endless !== room.endless ||
                                hard !== (room.hard === true)));
                    room.open = open;
                    if (!missing) {
                        room.mapId = mapId;
                        room.endless = endless;
                        room.hard = hard;
                    }
                    // Nothing to save or send for a setting as it was, and
                    // as "me", only the latest of a burst every
                    // MEMBER_UPDATE_MS (a refused map still gets the room
                    // back, for the host's screen)
                    if (changed || missing) {
                        this.broadcastMembers();
                    }
                }
                return;
            case "kick": {
                if (!isHost) {
                    return;
                }
                const kicked = room.members.find((m) => m.id === message.id && m !== client);
                if (kicked) {
                    this.kicked.add(kicked.address);
                    this.leaveRoom(kicked, "kicked");
                }
                return;
            }
            case "disband":
                if (isHost) {
                    this.disband("disbanded");
                }
                return;
            case "start":
                if (isHost && !room.started) {
                    const missing = missingMap(
                        this.anyMap,
                        room.members.map((member) => ({ client: member })),
                        room.mapId,
                        room.endless,
                        room.hard === true,
                        client,
                    );
                    if (missing) {
                        this.send(client, missing);
                        return;
                    }
                    const odd = room.members.find((member) => member.build !== client.build);
                    if (odd) {
                        error(
                            odd === client
                                ? OTHER_BUILD_TEXT
                                : `${odd.name}'s game is another version. Everyone needs to reload the page.`,
                        );
                        return;
                    }
                    room.started = true;
                    for (const member of room.members) {
                        member.ready = false;
                    }
                    this.persist(true);
                    for (const member of room.members) {
                        this.send(member, { t: "start", game: message.game });
                    }
                    this.broadcastRoom();
                }
                return;
            case "end":
                if (isHost && room.started) {
                    room.started = false;
                    this.persist(true);
                    this.broadcastRoom();
                }
                return;
            case "up":
                // A guest's input for the host, saying who it's from: the
                // message as it came, with one more field last
                if (room.started && !isHost && this.allowUp(client, text)) {
                    const host = room.members.find((m) => m.id === room.hostId);
                    if (host) {
                        const end = text.lastIndexOf("}");
                        this.sendText(
                            host,
                            `${text.slice(0, end)},"from":${JSON.stringify(client.id)}}`,
                        );
                    }
                }
                return;
            case "down":
                if (isHost && room.started) {
                    for (const member of room.members) {
                        if (member !== client) {
                            this.sendText(member, text);
                        }
                    }
                }
                return;
        }
    }

    create(client, message) {
        if (client.kind !== "create" || this.room) {
            this.send(client, { t: "error", message: "Couldn't make that room. Try again." });
            this.closeSocket(client);
            return;
        }
        this.setMember(client, message.me ?? {});
        client.ready = false;
        client.token = randomToken();
        const now = Date.now();
        this.room = {
            code: this.code,
            name: client.roomName,
            open: message.open === true,
            hostId: client.id,
            mapId: cleanId(message.mapId) || "lumbridge",
            endless: message.endless === true,
            hard: message.hard === true,
            started: false,
            members: [client],
            order: now,
            lastActive: now,
        };
        this.startHeartbeat(this.room);
        this.persist(true);
        this.broadcastRoom();
    }

    startHeartbeat(room) {
        room.heartbeat = setInterval(() => {
            if (this.room !== room) {
                clearInterval(room.heartbeat);
            } else if (Date.now() - room.lastActive > IDLE_MS) {
                this.disband("idle");
            } else {
                this.tellLobby();
            }
        }, ROOM_HEARTBEAT_MS);
    }

    join(client, message) {
        const room = this.room;
        const error = (text) => {
            this.send(client, { t: "error", message: text });
            this.closeSocket(client);
        };
        if (client.kind !== "join" || !room) {
            error(`There's no room ${this.code}.`);
            return;
        }
        if (this.kicked.has(client.address)) {
            error("The host has removed you from that room.");
            return;
        }
        if (room.started) {
            error("That room's run has already started.");
            return;
        }
        if (room.members.length >= MAX_PARTY) {
            error("That room is full.");
            return;
        }
        if (room.members.includes(client)) {
            return;
        }
        const missing = missingMap(
            this.anyMap,
            [{ client, unlocks: cleanUnlocks(message.me?.unlocks) }],
            room.mapId,
            room.endless,
            room.hard === true,
            client,
        );
        if (missing) {
            this.send(client, missing);
            this.closeSocket(client);
            return;
        }
        const host = room.members.find((member) => member.id === room.hostId);
        const build = typeof message.me?.build === "string" ? message.me.build.slice(0, 64) : "";
        if (host && build !== host.build) {
            error(OTHER_BUILD_TEXT);
            return;
        }
        this.setMember(client, message.me ?? {});
        client.ready = false;
        client.token = randomToken();
        room.members.push(client);
        room.lastActive = Date.now();
        this.persist(true);
        this.broadcastRoom();
    }
}
