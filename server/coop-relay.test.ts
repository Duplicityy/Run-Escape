import { once } from "node:events";
import { Server, createServer } from "node:http";
import { AddressInfo, Socket, connect as connectTcp } from "node:net";

import {
    RELAY_PATH,
    addressKey,
    createRelay,
    isAnyMapOn,
    isMetricsOn,
    isMultiplayerOn,
    maxRoomsSetting,
    metricsPortSetting,
    networkKey,
} from "./coop-relay.mjs";

// Cloudflare's addresses, for the tests behind it (PROXY=cloudflare): given,
// so nothing's fetched
vi.hoisted(() => {
    process.env.CLOUDFLARE_IPS = "173.245.48.0/20";
});

type Message = { t: string; [key: string]: any };

// A player's connection, with what's come in waiting to be taken
class TestClient {
    readonly messages: Message[] = [];
    // The name the relay gave it, on connecting
    name = "";
    private waiters: { type: string; resolve: (m: Message) => void }[] = [];
    readonly socket: WebSocket;

    constructor(url: string) {
        this.socket = new WebSocket(url);
        this.socket.onmessage = (event) => {
            const message = JSON.parse(String(event.data)) as Message;
            const waiter = this.waiters.find((w) => w.type === message.t);
            if (waiter) {
                this.waiters = this.waiters.filter((w) => w !== waiter);
                waiter.resolve(message);
            } else {
                this.messages.push(message);
            }
        };
    }

    send(message: Message): void {
        this.socket.send(JSON.stringify(message));
    }

    // The next message of this type (one that came already, or the next in)
    next(type: string): Promise<Message> {
        const index = this.messages.findIndex((m) => m.t === type);
        if (index !== -1) {
            return Promise.resolve(this.messages.splice(index, 1)[0]);
        }
        return new Promise((resolve) => this.waiters.push({ type, resolve }));
    }

    // The first room update that's like this, dropping the ones before it
    async roomWhere(test: (room: any) => boolean): Promise<Message> {
        for (;;) {
            const update = await this.next("room");
            if (test(update.room)) {
                return update;
            }
        }
    }

    // The latest room update, after dropping older ones
    async room(): Promise<Message> {
        let room = await this.next("room");
        for (;;) {
            const index = this.messages.findIndex((m) => m.t === "room");
            if (index === -1) {
                return room;
            }
            room = this.messages.splice(index, 1)[0];
        }
    }
}

// A connection that writes frames by hand, for what no browser would send
class RawClient {
    readonly socket: Socket;
    closed: Promise<void>;
    private received = Buffer.alloc(0);

    // headers: more of them, each line ending in \r\n
    constructor(port: number, path = RELAY_PATH, headers = "") {
        this.socket = connectTcp(port, "127.0.0.1");
        this.socket.on("error", () => {});
        this.socket.on("data", (data) => (this.received = Buffer.concat([this.received, data])));
        this.closed = new Promise((resolve) => this.socket.on("close", () => resolve()));
        this.socket.write(
            `GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
                `${headers}\r\n`,
        );
    }

    // A masked frame (with a mask of zeroes, so the payload goes as it is)
    static frame(opcode: number, payload: Buffer | string, fin = true): Buffer {
        const body = Buffer.from(payload);
        const length = body.length;
        const first = (fin ? 0x80 : 0) | opcode;
        const header =
            length < 126
                ? Buffer.from([first, 0x80 | length])
                : Buffer.from([first, 0x80 | 126, length >> 8, length & 0xff]);
        return Buffer.concat([header, Buffer.alloc(4), body]);
    }

    send(message: object): void {
        this.socket.write(RawClient.frame(0x1, JSON.stringify(message)));
    }

    // Once the relay's sent this (as text, anywhere in what's come in)
    async saw(text: string): Promise<void> {
        while (!this.received.toString("latin1").includes(text)) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }

    // The close frame's code, once one's come
    closeCode(): number | undefined {
        const at = this.received.lastIndexOf(Buffer.from([0x88, 0x02]));
        return at === -1 ? undefined : this.received.readUInt16BE(at + 2);
    }
}

describe("multiplayer toggle", () => {
    it("uses a configurable port for local metrics", () => {
        expect(metricsPortSetting({})).toBe(8788);
        expect(metricsPortSetting({ MULTIPLAYER_METRICS_PORT: "9001" })).toBe(9001);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            for (const value of ["0", "-1", "65536", "1.5", "bad"]) {
                expect(metricsPortSetting({ MULTIPLAYER_METRICS_PORT: value })).toBe(8788);
            }
        } finally {
            warn.mockRestore();
        }
    });

    it("serves local metrics unless they're turned off, or on where they're off by default", () => {
        expect(isMetricsOn({})).toBe(true);
        expect(isMetricsOn({}, false)).toBe(false);
        for (const value of ["false", "off", "0", "no", " OFF "]) {
            expect(isMetricsOn({ MULTIPLAYER_METRICS: value })).toBe(false);
            expect(isMetricsOn({ MULTIPLAYER_METRICS: value }, false)).toBe(false);
        }
        for (const value of ["true", "on", "1", "yes", " TRUE "]) {
            expect(isMetricsOn({ MULTIPLAYER_METRICS: value })).toBe(true);
            expect(isMetricsOn({ MULTIPLAYER_METRICS: value }, false)).toBe(true);
        }
        // An empty or unknown value is the same as none, like MULTIPLAYER
        for (const value of ["", "anything"]) {
            expect(isMetricsOn({ MULTIPLAYER_METRICS: value })).toBe(true);
            expect(isMetricsOn({ MULTIPLAYER_METRICS: value }, false)).toBe(false);
        }
    });

    it("is on unless it's turned off", () => {
        expect(isMultiplayerOn({}, [])).toBe(true);
        expect(isMultiplayerOn({ MULTIPLAYER: "on" }, [])).toBe(true);
        expect(isMultiplayerOn({ MULTIPLAYER: "off" }, [])).toBe(false);
        expect(isMultiplayerOn({ MULTIPLAYER: "0" }, [])).toBe(false);
        expect(isMultiplayerOn({ npm_lifecycle_event: "serve" }, [])).toBe(true);
        expect(isMultiplayerOn({ npm_lifecycle_event: "serve:singleplayer" }, [])).toBe(false);
        expect(isMultiplayerOn({}, ["node", "serve.mjs", "--no-multiplayer"])).toBe(false);
    });

    it("keeps rooms to players with their map unless MULTIPLAYER_ANY_MAP is on", () => {
        expect(isAnyMapOn({}, [])).toBe(false);
        expect(isAnyMapOn({ MULTIPLAYER_ANY_MAP: "on" }, [])).toBe(true);
        expect(isAnyMapOn({}, ["--any-map"])).toBe(true);
    });

    it("takes 500 rooms unless the server says otherwise", () => {
        expect(maxRoomsSetting({}, [])).toBe(500);
        expect(maxRoomsSetting({ MULTIPLAYER_MAX_ROOMS: "1200" }, [])).toBe(1200);
        expect(maxRoomsSetting({ MULTIPLAYER_MAX_ROOMS: "50" }, ["--max-rooms=80"])).toBe(80);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(maxRoomsSetting({ MULTIPLAYER_MAX_ROOMS: "lots" }, [])).toBe(500);
        expect(maxRoomsSetting({ MULTIPLAYER_MAX_ROOMS: "0" }, [])).toBe(500);
        warn.mockRestore();
    });
});

describe("co-op relay", () => {
    let server: Server;
    let metricsServer: Server | undefined;
    let relay: ReturnType<typeof createRelay>;
    let url: string;
    const clients: TestClient[] = [];

    // Everyone here connects from the same address, so the limits on each
    // address are out of the way unless a test sets them
    // (and rooms take anyone, unlocked maps or not, unless a test says so).
    // Rooms hear about changes sooner too, so tests needn't wait for them.
    const LOOSE = {
        connectionsPerAddress: 1000,
        roomsPerAddress: 1000,
        connectionsPerNetwork: 1000,
        roomsPerNetwork: 1000,
        createsPerMinute: 1000,
        roomUpdateMs: 5,
        anyMap: true,
        metrics: false,
        metricsPort: 0,
    };

    async function start(
        limits: Parameters<typeof createRelay>[0] = LOOSE,
        path = RELAY_PATH,
    ): Promise<void> {
        relay = createRelay(limits);
        server = createServer((req, res) => {
            if (!relay.handleRequest(req, res, path)) {
                res.writeHead(404);
                res.end();
            }
        });
        metricsServer = relay.attach(server, path, { closeOthers: true });
        // Listening, or given up on its port (it closes itself then)
        const metricsReady =
            metricsServer && !metricsServer.listening
                ? new Promise<void>((resolve) => {
                      metricsServer!.once("listening", resolve);
                      metricsServer!.once("close", resolve);
                  })
                : undefined;
        await new Promise<void>((resolve) => server.listen(0, resolve));
        await metricsReady;
        url = `ws://localhost:${(server.address() as AddressInfo).port}${path}`;
    }

    async function stop(): Promise<void> {
        for (const client of clients.splice(0)) {
            client.socket.close();
        }
        relay.close();
        await new Promise((resolve) => server.close(resolve));
    }

    // Starts again with these limits
    async function restart(
        limits: Parameters<typeof createRelay>[0],
        path = RELAY_PATH,
    ): Promise<void> {
        await stop();
        await start({ ...LOOSE, ...limits }, path);
    }

    beforeEach(() => start());
    afterEach(() => stop());

    async function connect(): Promise<TestClient> {
        const client = new TestClient(url);
        clients.push(client);
        client.name = (await client.next("welcome")).name;
        return client;
    }

    // A host with a room, and guests in it
    async function party(guests: number, open = false) {
        const host = await connect();
        host.send({ t: "create", open, me: { characterId: "warrior" } });
        const { room } = await host.room();
        const others: TestClient[] = [];
        for (let i = 0; i < guests; i++) {
            const guest = await connect();
            guest.send({ t: "join", code: room.code, me: {} });
            await guest.room();
            others.push(guest);
        }
        return { host, guests: others, code: room.code as string, name: room.name as string };
    }

    it("puts players in a room by its code", async () => {
        const { host, code } = await party(1);
        const { room, you } = await host.room();
        expect(room.code).toBe(code);
        // Two words each, from the relay
        expect(room.members.map((m: { name: string }) => m.name)).toEqual([
            expect.stringMatching(/^[A-Z][a-z]+ [A-Z][a-z]+$/),
            expect.stringMatching(/^[A-Z][a-z]+ [A-Z][a-z]+$/),
        ]);
        expect(room.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
        expect(room.hostId).toBe(you);
    });

    it("lists open rooms and not invite-only ones", async () => {
        const open = await party(0, true);
        await party(0, false);
        const browser = await connect();
        browser.send({ t: "list" });
        const { rooms } = await browser.next("rooms");
        expect(rooms.map((r: { code: string }) => r.code)).toEqual([open.code]);
        expect(rooms[0].host).toBe(open.host.name);
        expect(rooms[0].name).toBe(open.name);
    });

    it("names players itself, and won't take one they send", async () => {
        const client = new TestClient(url);
        clients.push(client);
        const { name } = await client.next("welcome");
        expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
        client.send({ t: "create", open: true, me: { name: "Typed Name" } });
        expect((await client.room()).room.members[0].name).toBe(name);
        client.send({ t: "rename" });
        const renamed = (await client.next("named")).name;
        expect(renamed).not.toBe(name);
        const { room } = await client.roomWhere((r) => r.members[0].name === renamed);
        expect(room.members[0].name).toBe(renamed);
    });

    it("keeps a name to one player at a time", async () => {
        const names = new Set<string>();
        for (let i = 0; i < 12; i++) {
            const client = new TestClient(url);
            clients.push(client);
            names.add((await client.next("welcome")).name);
        }
        expect(names.size).toBe(12);
    });

    it("won't rename a player mid-run", async () => {
        const { host } = await party(0);
        host.send({ t: "start", game: {} });
        await host.roomWhere((r) => r.started);
        host.send({ t: "rename" });
        // Messages are answered in order, so the pong comes after any name
        host.send({ t: "ping" });
        await host.next("pong");
        expect(host.messages.some((m) => m.t === "named")).toBe(false);
    });

    it("lists the open rooms a page at a time, fullest first", async () => {
        const codes: string[] = [];
        for (let i = 0; i < 5; i++) {
            codes.push((await party(0, true)).code);
        }
        // One more player in the last one: it goes to the top
        const busy = await party(1, true);
        const browser = await connect();
        const page = async (n: number) => {
            browser.send({ t: "list", page: n, size: 2 });
            return browser.next("rooms");
        };
        const first = await page(0);
        expect(first).toMatchObject({ page: 0, pages: 3, total: 6 });
        expect(first.rooms.map((r: { code: string }) => r.code)).toEqual([busy.code, codes[0]]);
        expect((await page(2)).rooms.map((r: { code: string }) => r.code)).toEqual([
            codes[3],
            codes[4],
        ]);
        // Past the end (rooms went while browsing): the last page
        expect(await page(9)).toMatchObject({ page: 2, pages: 3 });
        // A room that's started or filled up comes off the list
        busy.host.send({ t: "start", game: {} });
        await busy.guests[0].roomWhere((r) => r.started);
        browser.send({ t: "list", size: 20 });
        const after = await browser.next("rooms");
        expect(after.total).toBe(5);
        expect(after.rooms.map((r: { code: string }) => r.code)).not.toContain(busy.code);
    });

    it("lists nothing past what's there, and copes with nonsense", async () => {
        const browser = await connect();
        browser.send({ t: "list", page: -3, size: 1e9 });
        expect(await browser.next("rooms")).toMatchObject({
            rooms: [],
            page: 0,
            pages: 1,
            total: 0,
        });
    });

    it("says when a code's wrong or a room's full", async () => {
        const client = await connect();
        client.send({ t: "join", code: "ZZZZZ" });
        expect((await client.next("error")).message).toMatch(/no room/);
        const { code } = await party(3);
        client.send({ t: "join", code });
        expect((await client.next("error")).message).toMatch(/full/);
    });

    it("lets the host kick someone and disband the room", async () => {
        const { host, guests } = await party(2);
        const { room } = await host.room();
        host.send({ t: "kick", id: room.members[1].id });
        expect((await guests[0].next("gone")).reason).toBe("kicked");
        await host.roomWhere((r) => r.members.length === 2);
        host.send({ t: "disband" });
        expect((await guests[1].next("gone")).reason).toBe("disbanded");
        expect((await host.next("gone")).reason).toBe("disbanded");
        expect(relay.roomCount).toBe(0);
    });

    it("only lets the host change the room", async () => {
        const { host, guests } = await party(1);
        guests[0].send({ t: "settings", mapId: "barrows" });
        guests[0].send({ t: "kick", id: "p1" });
        host.send({ t: "settings", mapId: "draynor", open: true });
        const { room } = await guests[0].roomWhere((r) => r.mapId === "draynor");
        expect(room.mapId).toBe("draynor");
        expect(room.open).toBe(true);
        expect(room.members).toHaveLength(2);
    });

    it("hands the room on when the host leaves the lobby", async () => {
        const { host, guests } = await party(2);
        host.send({ t: "leave" });
        await host.next("gone");
        const { room } = await guests[0].roomWhere((r) => r.members.length === 2);
        expect(room.hostId).toBe(room.members[0].id);
    });

    it("keeps players' readiness and passes the game between host and guests", async () => {
        const { host, guests } = await party(1);
        guests[0].send({ t: "me", ready: true, characterId: "wizard" });
        const { room } = await host.roomWhere((r) => r.members[1].ready);
        expect(room.members[1]).toMatchObject({ ready: true, characterId: "wizard" });
        host.send({ t: "start", game: { seed: 5 } });
        expect((await guests[0].next("start")).game).toEqual({ seed: 5 });
        guests[0].send({ t: "up", d: { m: [1, 0] } });
        const up = await host.next("up");
        expect(up.d).toEqual({ m: [1, 0] });
        expect(up.from).toBe(room.members[1].id);
        // Passed on as it came, but not with a made-up sender
        guests[0].send({ t: "up", from: room.members[0].id, d: { m: [0, 1] } });
        expect((await host.next("up")).from).toBe(room.members[1].id);
        host.send({ t: "down", d: { n: 3 } });
        expect((await guests[0].next("down")).d).toEqual({ n: 3 });
    });

    it("ends the run for everyone if the host goes mid-run", async () => {
        const { host, guests } = await party(2);
        host.send({ t: "start", game: {} });
        await guests[0].next("start");
        host.socket.close();
        expect((await guests[0].next("gone")).reason).toBe("hostLeft");
        expect((await guests[1].next("gone")).reason).toBe("hostLeft");
    });

    it("tells the host when a guest goes mid-run", async () => {
        const { host, guests } = await party(2);
        host.send({ t: "start", game: {} });
        await guests[1].next("start");
        const { room } = await host.room();
        guests[0].socket.close();
        expect((await host.next("left")).id).toBe(room.members[1].id);
    });

    it("takes big messages in one piece", async () => {
        const { host, guests } = await party(1);
        const loadout = { items: "x".repeat(70_000) };
        host.send({ t: "start", game: { loadout } });
        expect((await guests[0].next("start")).game.loadout.items).toHaveLength(70_000);
    });

    it("says it's there to a plain request, for the game to offer co-op", async () => {
        await party(1);
        const response = await fetch(url.replace("ws:", "http:"));
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(await response.json()).toEqual({ coop: true });
        expect((await fetch(url.replace("ws:", "http:") + "/nope")).status).toBe(404);
    });

    describe("optional metrics", () => {
        const publicMetricsUrl = () => url.replace("ws:", "http:") + "/metrics";
        const metricsUrl = () =>
            `http://127.0.0.1:${(metricsServer!.address() as AddressInfo).port}${new URL(url).pathname}/metrics`;
        const parseMetrics = (text: string): Record<string, number> => {
            const values: Record<string, number> = {};
            for (const line of text.trimEnd().split("\n")) {
                if (line.startsWith("#")) {
                    continue;
                }
                const sample = /^(coop_[a-z_]+) (\d+)$/.exec(line);
                expect(sample, `invalid metric sample: ${line}`).not.toBeNull();
                const [, name, value] = sample!;
                expect(values).not.toHaveProperty(name);
                values[name] = Number(value);
            }
            return values;
        };
        const snapshot = async () => parseMetrics(await (await fetch(metricsUrl())).text());

        it("uses the environment toggle and keeps disabled metrics unavailable", async () => {
            vi.stubEnv("MULTIPLAYER_METRICS", "false");
            try {
                await restart({ metrics: undefined });
                expect(metricsServer).toBeUndefined();
                expect((await fetch(publicMetricsUrl())).status).toBe(404);
                vi.stubEnv("MULTIPLAYER_METRICS", undefined);
                await restart({ metrics: undefined });
                expect((await fetch(metricsUrl())).status).toBe(200);
                vi.stubEnv("MULTIPLAYER_METRICS", "true");
                await restart({ metrics: undefined });
                expect((await fetch(metricsUrl())).status).toBe(200);
                const previousUrl = metricsUrl();
                await restart({ metrics: false });
                expect(metricsServer).toBeUndefined();
                expect((await fetch(publicMetricsUrl())).status).toBe(404);
                await expect(fetch(previousUrl)).rejects.toThrow();
            } finally {
                vi.unstubAllEnvs();
            }
        });

        it("goes on without metrics when their port's taken", async () => {
            const taken = createServer();
            await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
            const error = vi.spyOn(console, "error").mockImplementation(() => {});
            try {
                await restart({
                    metrics: true,
                    metricsPort: (taken.address() as AddressInfo).port,
                });
                expect(error).toHaveBeenCalledWith(
                    expect.stringContaining("Multiplayer metrics unavailable"),
                );
                expect(metricsServer!.listening).toBe(false);
                // Co-op's fine, and the public listener still says nothing
                await party(1);
                const status = await fetch(url.replace("ws:", "http:"));
                expect(await status.json()).toEqual({ coop: true });
                expect((await fetch(publicMetricsUrl())).status).toBe(404);
            } finally {
                error.mockRestore();
                await new Promise((resolve) => taken.close(resolve));
            }
        });

        it("binds only to loopback and never serves metrics through the public listener", async () => {
            await restart({ metrics: true, proxy: "local" });
            expect((metricsServer!.address() as AddressInfo).address).toBe("127.0.0.1");
            expect((metricsServer!.address() as AddressInfo).port).not.toBe(
                (server.address() as AddressInfo).port,
            );
            for (const headers of [
                {},
                { "x-forwarded-for": "127.0.0.1" },
                { "x-forwarded-for": "203.0.113.1" },
                { "cf-connecting-ip": "127.0.0.1" },
                { forwarded: "for=127.0.0.1" },
            ]) {
                const response = await fetch(publicMetricsUrl(), { headers });
                expect(response.status).toBe(404);
                expect(await response.text()).toBe("");
            }
            expect((await fetch(publicMetricsUrl(), { method: "HEAD" })).status).toBe(404);
            const status = await fetch(url.replace("ws:", "http:"));
            expect(await status.json()).toEqual({ coop: true });
            expect((await fetch(metricsUrl())).status).toBe(200);
        });

        it("closes the metrics listener when the public server closes", async () => {
            await restart({ metrics: true });
            const localUrl = metricsUrl();
            const closed = once(metricsServer!, "close");
            await new Promise((resolve) => server.close(resolve));
            await closed;
            expect(metricsServer!.listening).toBe(false);
            await expect(fetch(localUrl)).rejects.toThrow();
        });

        it("serves Prometheus text, supports HEAD, and follows a custom relay path", async () => {
            await restart({ metrics: true });
            const response = await fetch(metricsUrl() + "?refresh=1");
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe(
                "text/plain; version=0.0.4; charset=utf-8",
            );
            expect(response.headers.get("cache-control")).toBe("no-store");
            const body = await response.text();
            const values = parseMetrics(body);
            expect(values).toEqual({
                coop_uptime_seconds: expect.any(Number),
                coop_players_connected: 0,
                coop_players_browsing: 0,
                coop_players_lobby: 0,
                coop_players_in_run: 0,
                coop_rooms: 0,
                coop_rooms_lobby: 0,
                coop_rooms_in_run: 0,
                coop_rooms_public: 0,
                coop_rooms_private: 0,
                coop_connections_total: 0,
                coop_rooms_created_total: 0,
                coop_runs_started_total: 0,
                coop_players_connected_peak: 0,
                coop_rooms_peak: 0,
                coop_connections_limit: 800,
                coop_rooms_limit: 500,
            });
            expect(body.endsWith("\n")).toBe(true);
            expect(body).not.toContain("\r");
            const lines = body.trimEnd().split("\n");
            // HELP, TYPE and the sample for each
            expect(lines).toHaveLength(Object.keys(values).length * 3);
            for (const name of Object.keys(values)) {
                const type = [
                    "coop_connections_total",
                    "coop_rooms_created_total",
                    "coop_runs_started_total",
                ].includes(name)
                    ? "counter"
                    : "gauge";
                const sampleLine = lines.indexOf(`${name} ${values[name]}`);
                expect(lines[sampleLine - 1]).toBe(`# TYPE ${name} ${type}`);
                expect(lines[sampleLine - 2]).toMatch(new RegExp(`^# HELP ${name} .+$`));
            }
            const head = await fetch(metricsUrl(), { method: "HEAD" });
            expect(head.status).toBe(200);
            expect(head.headers.get("content-type")).toBe(response.headers.get("content-type"));
            expect(await head.text()).toBe("");
            const post = await fetch(metricsUrl(), { method: "POST" });
            expect(post.status).toBe(405);
            expect(post.headers.get("allow")).toBe("GET, HEAD");

            await restart({ metrics: true }, "/game/coop");
            expect((await fetch(metricsUrl())).status).toBe(200);
            expect((await fetch(publicMetricsUrl())).status).toBe(404);
            const wrongPath = metricsUrl().replace("/game/coop/metrics", "/coop/metrics");
            expect((await fetch(wrongPath)).status).toBe(404);
        });

        it("tracks rooms and players through runs, leaving, disbanding and disconnecting", async () => {
            await restart({ metrics: true });
            const open = await party(1, true);
            const privateRoom = await party(0);
            await connect();
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 4,
                coop_players_browsing: 1,
                coop_players_lobby: 3,
                coop_players_in_run: 0,
                coop_rooms: 2,
                coop_rooms_lobby: 2,
                coop_rooms_in_run: 0,
                coop_rooms_public: 1,
                coop_rooms_private: 1,
                coop_connections_total: 4,
                coop_rooms_created_total: 2,
                coop_runs_started_total: 0,
                coop_players_connected_peak: 4,
                coop_rooms_peak: 2,
            });

            open.host.send({ t: "start", game: {} });
            await open.guests[0].next("start");
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 4,
                coop_players_browsing: 1,
                coop_players_lobby: 1,
                coop_players_in_run: 2,
                coop_rooms: 2,
                coop_rooms_lobby: 1,
                coop_rooms_in_run: 1,
                coop_rooms_public: 1,
                coop_rooms_private: 1,
                coop_runs_started_total: 1,
            });
            // A repeated start and the game's traffic aren't new runs.
            open.host.send({ t: "start", game: {} });
            open.host.send({ t: "down", d: { n: 1 } });
            await open.guests[0].next("down");
            open.host.send({ t: "end" });
            await open.host.roomWhere((r) => r.started);
            await open.host.roomWhere((r) => !r.started);
            expect(await snapshot()).toMatchObject({
                coop_players_lobby: 3,
                coop_players_in_run: 0,
                coop_rooms_lobby: 2,
                coop_rooms_in_run: 0,
                coop_runs_started_total: 1,
            });

            open.host.send({ t: "settings", open: false });
            await open.host.roomWhere((r) => !r.open);
            open.guests[0].send({ t: "leave" });
            await open.guests[0].next("gone");
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 4,
                coop_players_browsing: 2,
                coop_players_lobby: 2,
                coop_players_in_run: 0,
                coop_rooms_public: 0,
                coop_rooms_private: 2,
            });
            privateRoom.host.send({ t: "disband" });
            await privateRoom.host.next("gone");
            open.host.socket.close();
            await expect.poll(async () => (await snapshot()).coop_players_connected).toBe(3);
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 3,
                coop_players_browsing: 3,
                coop_players_lobby: 0,
                coop_players_in_run: 0,
                coop_rooms: 0,
                coop_rooms_lobby: 0,
                coop_rooms_in_run: 0,
                coop_rooms_public: 0,
                coop_rooms_private: 0,
                coop_connections_total: 4,
                coop_rooms_created_total: 2,
                coop_runs_started_total: 1,
                coop_players_connected_peak: 4,
                coop_rooms_peak: 2,
            });
            // A fresh relay starts its counters over.
            await restart({ metrics: true });
            expect(await snapshot()).toMatchObject({
                coop_connections_total: 0,
                coop_rooms_created_total: 0,
                coop_runs_started_total: 0,
                coop_players_connected_peak: 0,
                coop_rooms_peak: 0,
            });
        });

        it("counts cleanup when a host goes mid-run or rooms expire", async () => {
            await restart({ metrics: true, idleMs: 1 });
            const { host, guests } = await party(1);
            host.send({ t: "start", game: {} });
            await guests[0].next("start");
            host.socket.close();
            await guests[0].next("gone");
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 1,
                coop_players_browsing: 1,
                coop_players_lobby: 0,
                coop_players_in_run: 0,
                coop_rooms: 0,
                coop_rooms_in_run: 0,
            });
            const lobby = await party(1, true);
            relay.sweep(Date.now() + 1000);
            await lobby.host.next("gone");
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 3,
                coop_players_browsing: 3,
                coop_players_lobby: 0,
                coop_players_in_run: 0,
                coop_rooms: 0,
                coop_rooms_public: 0,
                coop_rooms_private: 0,
                coop_connections_total: 4,
                coop_rooms_created_total: 2,
                coop_runs_started_total: 1,
                coop_players_connected_peak: 3,
                coop_rooms_peak: 1,
            });
        });

        it("counts accepted connections and rooms, excluding refused attempts", async () => {
            await restart({ metrics: true, maxConnections: 2, maxRooms: 1 });
            await party(0);
            const browser = await connect();
            browser.send({ t: "create", me: {} });
            await browser.next("error");
            const refused = new WebSocket(url);
            await new Promise((resolve) => refused.addEventListener("error", resolve));
            expect(await snapshot()).toMatchObject({
                coop_players_connected: 2,
                coop_players_browsing: 1,
                coop_players_lobby: 1,
                coop_players_in_run: 0,
                coop_connections_total: 2,
                coop_rooms_created_total: 1,
                coop_runs_started_total: 0,
                coop_players_connected_peak: 2,
                coop_rooms_peak: 1,
                coop_connections_limit: 2,
                coop_rooms_limit: 1,
            });
        });
    });

    it("tells you when every room's taken", async () => {
        await restart({ maxRooms: 2 });
        await party(0, true);
        await party(0, true);
        const late = await connect();
        late.send({ t: "list" });
        expect((await late.next("rooms")).full).toBe(true);
        late.send({ t: "create", open: true, me: {} });
        expect((await late.next("error")).message).toMatch(/All rooms are taken/);
    });

    it("limits the connections and rooms from one address", async () => {
        await restart({ connectionsPerAddress: 3, roomsPerAddress: 2 });
        await party(0);
        await party(0);
        const third = await connect();
        third.send({ t: "create", me: {} });
        expect((await third.next("error")).message).toMatch(/too many rooms/);
        // A fourth connection isn't let in at all
        const refused = new WebSocket(url);
        const closed = await new Promise<boolean>((resolve) => {
            refused.onopen = () => resolve(false);
            refused.onerror = () => resolve(true);
        });
        expect(closed).toBe(true);
    });

    it("slows down making room after room", async () => {
        await restart({ createsPerMinute: 2 });
        const client = await connect();
        for (let i = 0; i < 2; i++) {
            client.send({ t: "create", me: {} });
            await client.room();
        }
        client.send({ t: "create", me: {} });
        expect((await client.next("error")).message).toMatch(/Wait a minute/);
    });

    it("closes a room nobody's done anything in for a while", async () => {
        const { host, guests } = await party(1);
        relay.sweep(Date.now() + 29 * 60_000);
        expect(relay.roomCount).toBe(1);
        relay.sweep(Date.now() + 31 * 60_000);
        expect((await guests[0].next("gone")).reason).toBe("idle");
        expect((await host.next("gone")).reason).toBe("idle");
        expect(relay.roomCount).toBe(0);
    });

    it("drops a loadout too big to be real", async () => {
        const { host } = await party(0);
        host.send({ t: "me", loadout: { unlockedItems: ["x".repeat(20_000)] } });
        const { room } = await host.roomWhere(() => true);
        expect(room.members[0].loadout).toBeUndefined();
    });

    it("only takes players with the room's map unlocked, by default", async () => {
        await restart({ anyMap: false });
        const has = { maps: ["lumbridge", "barrows"], endless: ["lumbridge"] };
        const host = await connect();
        // The host's beaten Barrows (so has it endless), the others haven't
        const hostHas = { ...has, endless: ["lumbridge", "barrows"] };
        host.send({ t: "create", mapId: "barrows", me: { unlocks: hostHas } });
        const { room } = await host.room();
        const newcomer = await connect();
        newcomer.send({
            t: "join",
            code: room.code,
            me: { unlocks: { maps: ["lumbridge"], endless: [] } },
        });
        const refused = await newcomer.next("error");
        expect(refused.need).toEqual({ mapId: "barrows", endless: false, hard: false });
        // The host can't move the room to a map someone in it hasn't got
        const veteran = await connect();
        veteran.send({ t: "join", code: room.code, me: { unlocks: has } });
        await veteran.room();
        host.send({ t: "settings", endless: true });
        expect((await host.next("error")).need).toEqual({
            mapId: "barrows",
            endless: true,
            hard: false,
            who: veteran.name,
        });
    });

    it("only goes on hard mode with everyone in the room having it", async () => {
        await restart({ anyMap: false });
        const beaten = { maps: ["barrows"], endless: ["barrows"], hard: ["barrows"] };
        const notBeaten = { maps: ["barrows"], endless: [], hard: [] };

        // Not for a host who hasn't got it
        const newHost = await connect();
        newHost.send({ t: "create", mapId: "barrows", hard: true, me: { unlocks: notBeaten } });
        expect((await newHost.next("error")).need).toEqual({
            mapId: "barrows",
            endless: false,
            hard: true,
        });

        const host = await connect();
        host.send({ t: "create", open: true, mapId: "barrows", me: { unlocks: beaten } });
        const { room } = await host.room();
        expect(room.hard).toBe(false);

        // Not while someone in the room hasn't got it
        const guest = await connect();
        guest.send({ t: "join", code: room.code, me: { unlocks: notBeaten } });
        await guest.room();
        await host.room();
        host.send({ t: "settings", hard: true });
        expect((await host.next("error")).need).toEqual({
            mapId: "barrows",
            endless: false,
            hard: true,
            who: guest.name,
        });
        expect((await host.room()).room.hard).toBe(false);

        // Once they've gone it can, and it shows on the list
        guest.send({ t: "leave" });
        await host.room();
        host.send({ t: "settings", hard: true });
        expect((await host.room()).room.hard).toBe(true);
        guest.send({ t: "list" });
        const { rooms } = await guest.next("rooms");
        expect(rooms.find((r: { code: string }) => r.code === room.code).hard).toBe(true);

        // Nobody without it can join, and whoever has it sees the room's on it
        guest.send({ t: "join", code: room.code, me: { unlocks: notBeaten } });
        expect((await guest.next("error")).need).toEqual({
            mapId: "barrows",
            endless: false,
            hard: true,
        });
        const veteran = await connect();
        veteran.send({ t: "join", code: room.code, me: { unlocks: beaten } });
        expect((await veteran.room()).room.hard).toBe(true);

        // Moving the map keeps hard mode, so everyone needs it there too
        host.send({ t: "settings", mapId: "lumbridge" });
        expect((await host.next("error")).need.hard).toBe(true);
    });

    describe("against what no browser sends", () => {
        const port = () => Number(new URL(url).port);

        async function stillWorks(): Promise<void> {
            const client = await connect();
            client.send({ t: "ping" });
            await client.next("pong");
        }

        it("survives a request path that isn't a URL", async () => {
            const http = connectTcp(port(), "127.0.0.1");
            http.on("error", () => {});
            http.write("GET //[ HTTP/1.1\r\nHost: x\r\n\r\n");
            const upgrade = new RawClient(port(), "//[");
            await upgrade.saw("404 Not Found");
            await upgrade.closed;
            http.destroy();
            await stillWorks();
        });

        it("lets go of a connection it turns away, even one that never closes", async () => {
            const socket = connectTcp(port(), "127.0.0.1");
            socket.on("error", () => {});
            let answer = "";
            socket.on("data", (data) => (answer += data.toString()));
            const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
            // An old WebSocket version: turned away
            socket.write(
                `GET ${RELAY_PATH} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
                    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 8\r\n\r\n",
            );
            await closed;
            expect(answer).toMatch(/^HTTP\/1.1 400/);
        });

        it("drops a message nested too deep to encode again", async () => {
            const raw = new RawClient(port());
            await raw.saw("welcome");
            const deep = "[".repeat(60_000) + "]".repeat(60_000);
            raw.socket.write(RawClient.frame(0x1, '{"t":"create","me":{"loadout":' + deep + "}}"));
            await raw.closed;
            expect(relay.roomCount).toBe(0);
            await stillWorks();
        });

        it("drops a message sent in endless empty pieces", async () => {
            const raw = new RawClient(port());
            await raw.saw("welcome");
            const pieces = [RawClient.frame(0x1, "", false)];
            for (let i = 0; i < 10_000; i++) {
                pieces.push(RawClient.frame(0x0, "", false));
            }
            raw.socket.write(Buffer.concat(pieces));
            await raw.closed;
            expect(raw.closeCode()).toBe(1009);
            await stillWorks();
        });

        it("counts every frame, empty ones too, against its rate", async () => {
            const raw = new RawClient(port());
            await raw.saw("welcome");
            raw.socket.write(
                Buffer.concat(Array.from({ length: 1000 }, () => RawClient.frame(0x9, ""))),
            );
            await raw.closed;
            expect(raw.closeCode()).toBe(1008);
        });

        it("turns away text that isn't UTF-8, which a browser would fail on", async () => {
            const raw = new RawClient(port());
            await raw.saw("welcome");
            const bad = Buffer.concat([
                Buffer.from('{"t":"ping","x":"'),
                Buffer.from([0xff]),
                Buffer.from('"}'),
            ]);
            raw.socket.write(RawClient.frame(0x1, bad));
            await raw.closed;
            expect(raw.closeCode()).toBe(1007);
        });

        it("reads a message sent a byte at a time", async () => {
            const raw = new RawClient(port());
            await raw.saw("welcome");
            for (const byte of RawClient.frame(0x1, JSON.stringify({ t: "ping" }))) {
                raw.socket.write(Buffer.from([byte]));
            }
            await raw.saw("pong");
            raw.socket.destroy();
        });

        it("drops a guest that stops reading, rather than keeping all it's sent", async () => {
            await restart({
                bytesPerSecond: Infinity,
                hostBytesPerSecond: 1e12,
                hostBurstBytes: 1e12,
            });
            const { host, code } = await party(0);
            const raw = new RawClient(port());
            await raw.saw("welcome");
            raw.send({ t: "join", code, me: {} });
            await host.roomWhere((room) => room.members.length === 2);
            host.send({ t: "start", game: {} });
            raw.socket.pause();
            const big = "x".repeat(200_000);
            for (let i = 0; i < 300; i++) {
                host.send({ t: "down", upTo: i, events: [], big });
                if (i % 10 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                }
            }
            expect((await host.next("left")).id).toMatch(/^p/);
            raw.socket.destroy();
        });
    });

    it("only takes players on the host's build of the game", async () => {
        const host = await connect();
        host.send({ t: "create", me: { build: "1.0-abc" } });
        const { room } = await host.room();
        const old = await connect();
        old.send({ t: "join", code: room.code, me: { build: "0.9-def" } });
        expect((await old.next("error")).message).toMatch(/another version/);
        const same = await connect();
        same.send({ t: "join", code: room.code, me: { build: "1.0-abc" } });
        await same.roomWhere((r) => r.members.length === 2);
        // One that changes build in the lobby (a reload) holds up the start
        same.send({ t: "me", build: "1.1-xyz" });
        await host.roomWhere(() => true);
        host.send({ t: "start", game: {} });
        expect((await host.next("error")).message).toMatch(/another version/);
    });

    it("sends a flood of a player's updates on as one, with the latest", async () => {
        await restart({ roomUpdateMs: 100 });
        const { host, guests } = await party(1);
        await new Promise((resolve) => setTimeout(resolve, 150));
        host.messages.length = 0;
        for (let i = 0; i < 50; i++) {
            guests[0].send({ t: "me", characterId: `c${i}` });
        }
        const { room } = await host.roomWhere((r) => r.members[1].characterId === "c49");
        expect(room.members[1].characterId).toBe("c49");
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(host.messages.filter((m) => m.t === "room").length).toBeLessThan(5);
    });

    it("sends no player updates mid-run, and has them all when it ends", async () => {
        await restart({ roomUpdateMs: 1 });
        const { host, guests } = await party(1);
        host.send({ t: "start", game: { seed: 5 } });
        await guests[0].next("start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        host.messages.length = 0;
        guests[0].send({ t: "me", characterId: "wizard" });
        guests[0].send({ t: "up", d: { m: [1, 0] } });
        await host.next("up");
        expect(host.messages.filter((m) => m.t === "room")).toEqual([]);
        host.send({ t: "end" });
        await host.roomWhere((r) => !r.started && r.members[1].characterId === "wizard");
    });

    it("lets a seat go as soon as a connection ends without a close frame", async () => {
        const { host, code } = await party(0);
        const raw = new RawClient(Number(new URL(url).port));
        await raw.saw("welcome");
        raw.socket.write(RawClient.frame(0x1, JSON.stringify({ t: "join", code, me: {} })));
        await host.roomWhere((r) => r.members.length === 2);
        raw.socket.end();
        await host.roomWhere((r) => r.members.length === 1);
    });

    it("slows down going in and out of rooms", async () => {
        await restart({ joinsPerMinute: 2 });
        const { host, code } = await party(0);
        const guest = await connect();
        for (let i = 0; i < 2; i++) {
            guest.send({ t: "join", code, me: {} });
            await host.roomWhere((r) => r.members.length === 2);
            guest.send({ t: "leave" });
            await host.roomWhere((r) => r.members.length === 1);
        }
        guest.send({ t: "join", code, me: {} });
        expect((await guest.next("error")).message).toMatch(/Wait a minute/);
    });

    it("makes codes too long to guess", async () => {
        const { code } = await party(0);
        expect(code).toMatch(/^[A-Z2-9]{8}$/);
    });

    it("turns connections away past its limit", async () => {
        await restart({ maxConnections: 1 });
        await connect();
        const raw = new RawClient(Number(new URL(url).port));
        await raw.saw("503 Service Unavailable");
    });

    it("closes a connection in no room that only pings, not one browsing or in a room", async () => {
        await restart({ idleConnectionMs: 500 });
        const { host } = await party(0);
        const idle = await connect();
        const browsing = await connect();
        await new Promise((resolve) => setTimeout(resolve, 600));
        idle.send({ t: "ping" });
        await idle.next("pong");
        browsing.send({ t: "list" });
        await browsing.next("rooms");
        relay.sweep(Date.now());
        await new Promise<void>((resolve) => {
            idle.socket.onclose = () => resolve();
        });
        browsing.send({ t: "ping" });
        await browsing.next("pong");
        host.send({ t: "ping" });
        await host.next("pong");
    });

    it("doesn't let a player's own updates or new names keep a room open", async () => {
        await restart({ idleMs: 1000 });
        const { host } = await party(0);
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 100));
        host.send({ t: "me", characterId: "wizard" });
        await host.roomWhere((r) => r.members[0].characterId === "wizard");
        host.send({ t: "rename" });
        await host.next("named");
        // Idle since it was made, though not since these
        relay.sweep(start + 1050);
        expect((await host.next("gone")).reason).toBe("idle");
    });

    it("passes on a guest's input only at the size and rate a game sends it", async () => {
        const { host, guests } = await party(1);
        host.send({ t: "start", game: { seed: 5 } });
        await guests[0].next("start");
        guests[0].send({ t: "up", d: "x".repeat(2000) });
        for (let i = 0; i < 100; i++) {
            guests[0].send({ t: "up", n: i });
        }
        guests[0].send({ t: "ping" });
        await guests[0].next("pong");
        await new Promise((resolve) => setTimeout(resolve, 30));
        const ups = host.messages.filter((m) => m.t === "up");
        expect(ups.every((m) => m.d === undefined)).toBe(true);
        expect(ups.length).toBeLessThanOrEqual(120);
    });

    it("closes a connection sending too many bytes", async () => {
        const raw = new RawClient(Number(new URL(url).port));
        await raw.saw("welcome");
        const big = RawClient.frame(0x1, JSON.stringify({ t: "ping", d: "x".repeat(200_000) }));
        for (let i = 0; i < 4; i++) {
            raw.socket.write(big);
        }
        await raw.closed;
    });

    it("keeps a kicked player out, and slows down guessing codes", async () => {
        await restart({ wrongCodesPerMinute: 3 });
        const { host, guests, code } = await party(1);
        const { room } = await host.room();
        host.send({ t: "kick", id: room.members[1].id });
        await guests[0].next("gone");
        guests[0].send({ t: "join", code, me: {} });
        expect((await guests[0].next("error")).message).toMatch(/removed you/);
        const guesser = await connect();
        for (let i = 0; i < 3; i++) {
            guesser.send({ t: "join", code: "ZZZZZ" });
            expect((await guesser.next("error")).message).toMatch(/no room/);
        }
        guesser.send({ t: "join", code });
        expect((await guesser.next("error")).message).toMatch(/wrong codes/);
    });

    it("sends the room round once in a while, however fast the host changes it", async () => {
        await restart({ roomUpdateMs: 100 });
        const { host, guests } = await party(1);
        await new Promise((resolve) => setTimeout(resolve, 150));
        guests[0].messages.length = 0;
        for (let i = 0; i < 50; i++) {
            host.send({ t: "settings", mapId: `m${i}` });
            host.send({ t: "start", game: {} });
            host.send({ t: "end" });
        }
        let updates = 0;
        await guests[0].roomWhere((r) => {
            updates++;
            return r.mapId === "m49" && !r.started;
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        updates += guests[0].messages.filter((m) => m.t === "room").length;
        expect(updates).toBeLessThan(6);
    });

    it("takes a room off the open list the moment it starts, update waiting or not", async () => {
        await restart({ roomUpdateMs: 1000 });
        const { host, code } = await party(0, true);
        const browser = await connect();
        browser.send({ t: "list" });
        expect((await browser.next("rooms")).rooms.map((r: { code: string }) => r.code)).toEqual([
            code,
        ]);
        // The first change goes round at once, and the start waits its turn
        host.send({ t: "settings", mapId: "draynor" });
        host.send({ t: "start", game: {} });
        await host.next("start");
        browser.send({ t: "list" });
        expect((await browser.next("rooms")).rooms).toEqual([]);
    });

    // A connection from this address, as a proxy in front says (with PROXY=local)
    function from(address: string): RawClient {
        const port = Number(new URL(url).port);
        return new RawClient(port, RELAY_PATH, `X-Forwarded-For: ${address}\r\n`);
    }

    it("limits the connections from an IPv6 /48, not only from each /64", async () => {
        await restart({ proxy: "local", connectionsPerAddress: 1, connectionsPerNetwork: 2 });
        await from("2001:db8:1:1::1").saw("welcome");
        await from("2001:db8:1:2::1").saw("welcome");
        await from("2001:db8:1:3::1").saw("429 Too Many Requests");
        await from("2001:db8:2:1::1").saw("welcome");
    });

    it("limits the rooms hosted from an IPv6 /48", async () => {
        await restart({ proxy: "local", roomsPerNetwork: 1 });
        const first = from("2001:db8:1:1::1");
        await first.saw("welcome");
        first.send({ t: "create", me: {} });
        await first.saw('"t":"room"');
        const second = from("2001:db8:1:2::1");
        await second.saw("welcome");
        second.send({ t: "create", me: {} });
        await second.saw("too many rooms");
    });

    it("keeps a kicked player out from their /64, not their neighbours in the /48", async () => {
        await restart({ proxy: "local" });
        const { host, code } = await party(0);
        const kicked = from("2001:db8:1:1::1");
        await kicked.saw("welcome");
        kicked.send({ t: "join", code, me: {} });
        const { room } = await host.roomWhere((r) => r.members.length === 2);
        host.send({ t: "kick", id: room.members[1].id });
        await kicked.saw('"reason":"kicked"');
        const again = from("2001:db8:1:1::2");
        await again.saw("welcome");
        again.send({ t: "join", code, me: {} });
        await again.saw("removed you");
        const nextDoor = from("2001:db8:1:2::1");
        await nextDoor.saw("welcome");
        nextDoor.send({ t: "join", code, me: {} });
        await host.roomWhere(
            (r) => r.members.length === 2 && r.members[1].id !== room.members[1].id,
        );
    });

    it("slows down guessing from a whole /48, without one address shutting it out", async () => {
        await restart({
            proxy: "local",
            wrongCodesPerMinute: 2,
            wrongCodesPerNetworkPerMinute: 4,
        });
        const { code } = await party(0);
        const guess = async (address: string, times: number) => {
            const client = from(address);
            await client.saw("welcome");
            for (let i = 0; i < times; i++) {
                client.send({ t: "join", code: "ZZZZZ" });
                await client.saw("no room");
            }
            return client;
        };
        // An address at its limit has to wait, but its neighbour doesn't
        const first = await guess("2001:db8:1:1::1", 2);
        first.send({ t: "join", code, me: {} });
        await first.saw("wrong codes");
        await guess("2001:db8:1:2::1", 2);
        // Now the whole /48 is at its limit
        const third = from("2001:db8:1:3::1");
        await third.saw("welcome");
        third.send({ t: "join", code, me: {} });
        await third.saw("wrong codes");
    });

    // Through Cloudflare (PROXY=cloudflare): a proxy of ours saw it come from
    // Cloudflare, which says who it's from and where
    function viaCloudflare(country: string): RawClient {
        const port = Number(new URL(url).port);
        return new RawClient(
            port,
            RELAY_PATH,
            "X-Forwarded-For: 173.245.48.10\r\nCF-Connecting-IP: 198.51.100.7\r\n" +
                `CF-IPCountry: ${country}\r\n`,
        );
    }

    it("shows where players are from, as Cloudflare says, unless they hide it", async () => {
        await restart({ proxy: "cloudflare" });
        const host = viaCloudflare("fi");
        await host.saw('"country":"FI"');
        host.send({ t: "create", open: true, me: {} });
        await host.saw('"t":"room"');
        // Straight to the relay, not through Cloudflare: nowhere
        const browser = new TestClient(url);
        clients.push(browser);
        expect((await browser.next("welcome")).country).toBeUndefined();
        browser.send({ t: "list" });
        const [listed] = (await browser.next("rooms")).rooms;
        expect(listed.country).toBe("FI");
        browser.send({ t: "join", code: listed.code, me: {} });
        await browser.roomWhere((r) => r.members.length === 2);
        // A guest who's hidden theirs, until they show it
        const guest = viaCloudflare("SE");
        await guest.saw('"country":"SE"');
        guest.send({ t: "join", code: listed.code, me: { hideCountry: true } });
        const { room } = await browser.roomWhere((r) => r.members.length === 3);
        const countries = (r: { members: { country?: string }[] }) =>
            r.members.map((m) => m.country);
        expect(countries(room)).toEqual(["FI", undefined, undefined]);
        guest.send({ t: "me", hideCountry: false });
        await browser.roomWhere((r) => r.members[2].country === "SE");
        // The host of an open room shows theirs either way: it's where the
        // room is. Invite only, they can hide it.
        host.send({ t: "me", hideCountry: true });
        host.send({ t: "settings", open: false });
        expect(countries((await browser.roomWhere((r) => !r.open)).room)[0]).toBeUndefined();
        host.send({ t: "settings", open: true });
        expect(countries((await browser.roomWhere((r) => r.open)).room)[0]).toBe("FI");
        const other = await connect();
        other.send({ t: "list" });
        expect((await other.next("rooms")).rooms[0].country).toBe("FI");
    });

    it("drops a host that sends its room more than a run does", async () => {
        await restart({ hostBytesPerSecond: 1000, hostBurstBytes: 4000 });
        const { host, guests } = await party(1);
        host.send({ t: "start", game: {} });
        await guests[0].next("start");
        host.send({ t: "down", d: { upTo: 1, events: [] } });
        expect((await guests[0].next("down")).d.upTo).toBe(1);
        for (let i = 2; i < 12; i++) {
            host.send({ t: "down", d: { upTo: i, events: [], big: "x".repeat(1000) } });
        }
        expect((await guests[0].next("gone")).reason).toBe("hostLeft");
        expect(guests[0].messages.filter((m) => m.t === "down").length).toBeLessThan(5);
    });
});

describe("relay limits by address", () => {
    it("puts an IPv6 /64 in its /48, and an IPv4 address on its own", () => {
        expect(networkKey("2001:db8:1:2::/64")).toBe("2001:db8:1::/48");
        expect(networkKey("203.0.113.9")).toBe("203.0.113.9");
    });

    it("counts an IPv6 address by its /64", () => {
        expect(addressKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
        expect(addressKey("2001:db8:1:2:ffff:1:2:3")).toBe("2001:db8:1:2::/64");
        expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
        expect(addressKey("::1")).toBe("0:0:0:0::/64");
        expect(addressKey("203.0.113.9")).toBe("203.0.113.9");
    });
});
