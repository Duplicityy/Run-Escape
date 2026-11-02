import { GameStore } from "../GameStore";
import { CoopLobby } from "./CoopLobby";

// A WebSocket that's open at once and keeps what's sent, for driving the
// lobby as a relay would
class FakeSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static all: FakeSocket[] = [];

    readyState = FakeSocket.CONNECTING;
    sent: { t: string; [key: string]: unknown }[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;

    constructor(readonly url: string) {
        FakeSocket.all.push(this);
        queueMicrotask(() => {
            this.readyState = FakeSocket.OPEN;
            this.onopen?.();
        });
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        if (this.readyState === FakeSocket.CLOSED) {
            return;
        }
        this.readyState = FakeSocket.CLOSED;
        this.onclose?.();
    }

    // What the relay says
    receive(message: object): void {
        this.onmessage?.({ data: JSON.stringify(message) });
    }
}

const ROOM = {
    code: "ABCDEFGH",
    name: "Amber Isle",
    open: true,
    hostId: "p1",
    mapId: "lumbridge",
    endless: false,
    started: false,
    members: [],
};

function makeLobby(): CoopLobby {
    const store = { set: () => {}, get: () => ({}) } as unknown as GameStore;
    return new CoopLobby(store);
}

async function connected(): Promise<{ lobby: CoopLobby; relay: FakeSocket }> {
    const lobby = makeLobby();
    const connecting = lobby.connect();
    const relay = FakeSocket.all[0];
    await Promise.resolve();
    relay.receive({ t: "welcome", id: "p1", name: "Steady Chicken" });
    await connecting;
    return { lobby, relay };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a relay that keeps each room on its own connection", () => {
    beforeEach(() => {
        FakeSocket.all = [];
        vi.stubGlobal("WebSocket", FakeSocket);
        vi.stubGlobal("window", {
            location: { href: "https://example.com/game/" },
            setInterval: () => 0,
            clearInterval: () => {},
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("makes the room on the room's connection, and talks to it there", async () => {
        const { lobby, relay } = await connected();
        lobby.create(true, "lumbridge", false);
        expect(relay.sent.at(-1)?.t).toBe("create");

        relay.receive({ t: "goto", code: "ABCDEFGH", ticket: "t1" });
        const room = FakeSocket.all[1];
        expect(room.url).toBe("wss://example.com/game/coop/room/ABCDEFGH?ticket=t1");
        await flush();
        // The same create, now to the room
        expect(room.sent).toEqual([expect.objectContaining({ t: "create", mapId: "lumbridge" })]);

        room.receive({ t: "room", room: ROOM, you: "p1" });
        expect(lobby.room?.code).toBe("ABCDEFGH");

        // What's said in a room goes to the room; the list and pings to the lobby
        lobby.setReady(true);
        lobby.sendDown({ upTo: 1, events: [] });
        expect(room.sent.map((m) => m.t)).toEqual(["create", "me", "down"]);
        lobby.refresh();
        expect(relay.sent.at(-1)?.t).toBe("list");
    });

    it("stays in the room it's in when joining another fails", async () => {
        const { lobby, relay } = await connected();
        lobby.create(false, "lumbridge", false);
        relay.receive({ t: "goto", code: "ABCDEFGH", ticket: "t1" });
        const first = FakeSocket.all[1];
        await flush();
        first.receive({ t: "room", room: ROOM, you: "p1" });

        lobby.join("ZZZZZZZZ");
        relay.receive({ t: "goto", code: "ZZZZZZZZ", ticket: "t2" });
        const second = FakeSocket.all[2];
        await flush();
        second.receive({ t: "error", message: "That room is full." });

        expect(second.readyState).toBe(FakeSocket.CLOSED);
        expect(first.readyState).toBe(FakeSocket.OPEN);
        expect(lobby.room?.code).toBe("ABCDEFGH");
    });

    it("leaves the old room once the new one has it", async () => {
        const { lobby, relay } = await connected();
        lobby.create(false, "lumbridge", false);
        relay.receive({ t: "goto", code: "ABCDEFGH", ticket: "t1" });
        const first = FakeSocket.all[1];
        await flush();
        first.receive({ t: "room", room: ROOM, you: "p1" });

        lobby.join("HGFEDCBA");
        relay.receive({ t: "goto", code: "HGFEDCBA", ticket: "t2" });
        const second = FakeSocket.all[2];
        await flush();
        second.receive({ t: "room", room: { ...ROOM, code: "HGFEDCBA" }, you: "p1" });

        expect(first.readyState).toBe(FakeSocket.CLOSED);
        expect(lobby.room?.code).toBe("HGFEDCBA");
    });

    it("tells the game when the room's connection drops", async () => {
        const { lobby, relay } = await connected();
        const onClosed = vi.fn();
        lobby.onClosed = onClosed;
        lobby.create(false, "lumbridge", false);
        relay.receive({ t: "goto", code: "ABCDEFGH", ticket: "t1" });
        const room = FakeSocket.all[1];
        await flush();
        room.receive({ t: "room", room: ROOM, you: "p1" });

        room.close();
        expect(lobby.room).toBeUndefined();
        expect(onClosed).toHaveBeenCalledOnce();
    });

    it("ignores a goto it didn't ask for", async () => {
        const { relay } = await connected();
        relay.receive({ t: "goto", code: "ABCDEFGH", ticket: "t1" });
        expect(FakeSocket.all).toHaveLength(1);
    });
});
