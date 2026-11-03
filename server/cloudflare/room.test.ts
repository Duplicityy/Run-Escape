import { Room } from "./src/room.mjs";

// What the room says and saves, in order, as Cloudflare would see it
let log: string[];
let saved: any;
let writes: number;
// What the room's told the lobby, newest last
let listings: any[];

class Socket {
    sent: any[] = [];
    constructor(private readonly who: string) {}
    accept() {}
    addEventListener() {}
    send(text: string) {
        const message = JSON.parse(text);
        this.sent.push(message);
        log.push(`${this.who} ${message.t}`);
    }
    close() {}
}

const env = {
    MULTIPLAYER_ANY_MAP: "on",
    LOBBY: {
        idFromName: (name: string) => name,
        get: () => ({
            roomUpdate: async (listing: any) => {
                listings.push(listing);
            },
            roomGone: async () => {},
        }),
    },
};

async function loadRoom(): Promise<any> {
    let ready: Promise<unknown> = Promise.resolve();
    const ctx = {
        storage: {
            get: async () => structuredClone(saved),
            put: async (_key: string, value: unknown) => {
                writes++;
                log.push("save");
                saved = structuredClone(value);
            },
            setAlarm: async () => {},
            deleteAll: async () => {
                saved = undefined;
            },
        },
        blockConcurrencyWhile: (load: () => Promise<unknown>) => (ready = ready.then(load)),
    };
    const room = new Room(ctx, env);
    await ready;
    return room;
}

function enter(room: any, id: string, kind: "create" | "join") {
    const member = room.newMember({ id, name: id, kind, address: id, roomName: "Room" });
    room.attach(member, new Socket(id));
    return member;
}

function say(room: any, member: any, message: object) {
    room.receive(member, JSON.stringify(message));
}

const me = { characterId: "warrior", build: "a" };

async function party() {
    const room = await loadRoom();
    room.code = "ABCDEFGH";
    const host = enter(room, "host", "create");
    say(room, host, { t: "create", me });
    const guest = enter(room, "guest", "join");
    say(room, guest, { t: "join", me });
    return { room, host, guest };
}

describe("Cloudflare co-op room", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        log = [];
        saved = undefined;
        writes = 0;
        listings = [];
    });
    afterEach(() => vi.useRealTimers());

    it("saves someone joining at once, even straight after another save", async () => {
        const { room } = await party();
        expect(saved.members.map((m: any) => m.id)).toEqual(["host", "guest"]);
        // After a restart, the guest's token still brings them back
        const restarted = await loadRoom();
        expect(restarted.room.members[1].token).toBe(room.room.members[1].token);
    });

    it("saves the run starting before anyone's told", async () => {
        const { room, host } = await party();
        log = [];
        say(room, host, { t: "start", game: {} });
        expect(log[0]).toBe("save");
        expect(log).toContain("guest start");
        expect(saved.started).toBe(true);
        expect((await loadRoom()).room.started).toBe(true);
    });

    it("doesn't bring back someone who left just before a restart", async () => {
        const { room, host, guest } = await party();
        say(room, host, { t: "start", game: {} });
        log = [];
        say(room, guest, { t: "leave" });
        // Saved before the host hears of it
        expect(log.indexOf("save")).toBeGreaterThan(-1);
        expect(log.indexOf("save")).toBeLessThan(log.indexOf("host left"));
        const restarted = await loadRoom();
        expect(restarted.room.members.map((m: any) => m.id)).toEqual(["host"]);
        expect(restarted.room.started).toBe(true);
    });

    it("still saves what players pick no more than once a second", async () => {
        const { room, guest } = await party();
        const before = writes;
        for (let i = 0; i < 5; i++) {
            say(room, guest, { t: "me", ready: i % 2 === 0 });
            vi.advanceTimersByTime(100);
        }
        expect(writes - before).toBeLessThanOrEqual(1);
        vi.advanceTimersByTime(2000);
        expect(saved.members[1].ready).toBe(true);
    });

    it("hides a hidden flag, but not an open room's host's", async () => {
        const room = await loadRoom();
        room.code = "ABCDEFGH";
        const host = enter(room, "host", "create");
        host.country = "FI";
        say(room, host, { t: "create", me: { ...me, hideCountry: true } });
        const guest = enter(room, "guest", "join");
        guest.country = "SE";
        say(room, guest, { t: "join", me: { ...me, hideCountry: true } });
        vi.advanceTimersByTime(2000);
        const shown = () => {
            const view = guest.socket.sent.filter((m: any) => m.t === "room").at(-1).room;
            return view.members.map((m: any) => m.country);
        };
        expect(shown()).toEqual([undefined, undefined]);
        expect(listings.at(-1).country).toBeUndefined();

        say(room, host, { t: "settings", open: true });
        vi.advanceTimersByTime(2000);
        expect(shown()).toEqual(["FI", undefined]);
        expect(listings.at(-1).country).toBe("FI");
        // Kept after a restart
        expect(saved.members[0].hideCountry).toBe(true);

        say(room, host, { t: "settings", open: false });
        vi.advanceTimersByTime(2000);
        expect(shown()).toEqual([undefined, undefined]);
    });
});
