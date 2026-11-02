// One co-op room, as its own Durable Object. Cloudflare starts it near the
// first request for it, which is the host making it, so the host's frames
// and the guests' inputs go through a relay close to the host rather than one
// fixed place. What it does is server/coop-relay.mjs's rooms, one room at a
// time: players come with a ticket from the lobby (lobby.mjs) and send their
// create or join first.
//
// It doesn't hibernate: mid-run it's passing messages all the time anyway.
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
    isAnyMapOn,
    lobbyStub,
    missingMap,
    parseMessage,
} from "./shared.mjs";

// How often a room tells the lobby it's still there
const ROOM_HEARTBEAT_MS = 30_000;

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
    }

    async fetch(request) {
        const url = new URL(request.url);
        const code = url.pathname.split("/").pop() ?? "";
        const who = await this.lobby.redeem(url.searchParams.get("ticket"), code);
        if (!who) {
            return new Response(null, { status: 403 });
        }
        this.code = code;
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        const member = {
            id: who.id,
            name: who.name,
            address: request.headers.get("x-address") ?? who.address,
            kind: who.kind,
            roomName: who.roomName,
            socket: server,
            characterId: "",
            ready: false,
            loadout: undefined,
            unlocks: cleanUnlocks(undefined),
            build: undefined,
            limit: new RateLimit(),
            upSecond: 0,
            upsThisSecond: 0,
        };
        server.addEventListener("message", (event) => this.receive(member, event.data));
        server.addEventListener("close", () => this.dropped(member));
        server.addEventListener("error", () => this.dropped(member));
        return new Response(null, { status: 101, webSocket: client });
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
        if (!member.closed) {
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
            try {
                member.socket.close(code);
            } catch {
                // Already closed
            }
        }
    }

    // A player's connection to the room has closed, however
    dropped(member) {
        member.closed = true;
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
            started: room.started,
            members: room.members.map((client) => ({
                id: client.id,
                name: client.name,
                characterId: client.characterId,
                ready: client.ready,
                loadout: client.loadout,
                unlocks: client.unlocks,
            })),
        };
    }

    broadcastRoom() {
        const view = this.roomView();
        for (const member of this.room.members) {
            this.send(member, { t: "room", room: view, you: member.id });
        }
        this.tellLobby();
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
                host: host?.name ?? "",
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
        this.room = undefined;
        this.kicked.clear();
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
                    if (message.open !== undefined) {
                        room.open = message.open === true;
                    }
                    const mapId =
                        message.mapId !== undefined
                            ? cleanId(message.mapId) || room.mapId
                            : room.mapId;
                    const endless =
                        message.endless !== undefined ? message.endless === true : room.endless;
                    const missing = missingMap(
                        this.anyMap,
                        room.members.map((member) => ({ client: member })),
                        mapId,
                        endless,
                        client,
                    );
                    if (missing) {
                        this.send(client, missing);
                    } else {
                        room.mapId = mapId;
                        room.endless = endless;
                    }
                    this.broadcastRoom();
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
                        this.send(member, { t: "start", game: message.game });
                    }
                    this.broadcastRoom();
                }
                return;
            case "end":
                if (isHost && room.started) {
                    room.started = false;
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
        const now = Date.now();
        this.room = {
            code: this.code,
            name: client.roomName,
            open: message.open === true,
            hostId: client.id,
            mapId: cleanId(message.mapId) || "lumbridge",
            endless: message.endless === true,
            started: false,
            members: [client],
            order: now,
            lastActive: now,
        };
        const room = this.room;
        room.heartbeat = setInterval(() => {
            if (Date.now() - room.lastActive > IDLE_MS) {
                this.disband("idle");
            } else {
                this.tellLobby();
            }
        }, ROOM_HEARTBEAT_MS);
        this.broadcastRoom();
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
        room.members.push(client);
        room.lastActive = Date.now();
        this.broadcastRoom();
    }
}
