// Checks a relay end to end, as two games would use it: the host makes a room,
// a guest joins by code, each is shown where they are until the host hides it,
// the run starts, frames and inputs go both ways, the guest leaves and the host
// disbands. Then it times round trips.
//
//   npm run check -- ws://127.0.0.1:8787/coop                          # wrangler dev
//   npm run check -- wss://run-escape-coop.<subdomain>.workers.dev/coop # deployed
//
// It uses Node's own WebSocket (Node 22, or Node 21 with
// NODE_OPTIONS=--experimental-websocket).
const base = process.argv[2] ?? "ws://127.0.0.1:8787/coop";
const unlocks = { maps: ["lumbridge"], endless: [] };

class Client {
    constructor(label) {
        this.label = label;
        this.queue = [];
        this.waiters = [];
    }
    open(url) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            ws.onmessage = (e) => {
                const m = JSON.parse(String(e.data));
                const w = this.waiters.find((w) => w.test(m));
                if (w) {
                    this.waiters = this.waiters.filter((x) => x !== w);
                    w.resolve(m);
                } else this.queue.push(m);
            };
            ws.onopen = () => resolve(ws);
            ws.onerror = (e) => reject(new Error(`${this.label}: ${e.message ?? "socket error"}`));
            ws.onclose = (e) => this.queue.push({ t: "_closed", code: e.code, url });
        });
    }
    next(t, test = () => true, ms = 5000) {
        const i = this.queue.findIndex((m) => m.t === t && test(m));
        if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(
                        new Error(`${this.label}: no ${t} (have ${this.queue.map((m) => m.t)})`),
                    ),
                ms,
            );
            this.waiters.push({
                test: (m) => m.t === t && test(m),
                resolve: (m) => (clearTimeout(timer), resolve(m)),
            });
        });
    }
    async connect() {
        this.lobby = await this.open(base);
        const welcome = await this.next("welcome");
        this.id = welcome.id;
        return welcome;
    }
    // create/join through the lobby, then over the room's own connection
    async enter(message) {
        this.lobby.send(JSON.stringify(message));
        const goto = await this.next("goto");
        const url = `${base}/room/${goto.code}?ticket=${goto.ticket}`;
        this.room = await this.open(url);
        this.room.send(JSON.stringify(message));
        return { goto, room: await this.next("room") };
    }
}

const ok = (cond, what) => {
    if (!cond) throw new Error(`FAIL: ${what}`);
    console.log(`ok - ${what}`);
};

async function rtt(ws, client, n = 20) {
    const times = [];
    for (let i = 0; i < n; i++) {
        const t = performance.now();
        ws.send('{"t":"ping"}');
        await client.next("pong");
        times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return {
        median: times[n >> 1].toFixed(1),
        min: times[0].toFixed(1),
        max: times[n - 1].toFixed(1),
    };
}

const status = await (await fetch(base.replace(/^ws/, "http"))).json();
ok(status.coop === true, `status says co-op is here (${JSON.stringify(status)})`);

const host = new Client("host");
const guest = new Client("guest");
const hw = await host.connect();
await guest.connect();
ok(hw.name && hw.id, `welcome gives a name (${hw.name})`);

const me = { characterId: "wizard", unlocks, build: "smoke" };
const { goto, room } = await host.enter({
    t: "create",
    open: false,
    mapId: "lumbridge",
    endless: false,
    me,
});
ok(room.room.hostId === host.id && room.room.code === goto.code, `host made room ${goto.code}`);

host.lobby.send(JSON.stringify({ t: "list" }));
const list = await host.next("rooms");
// Invite only, so players on a live relay never see it in their list
ok(!list.rooms.some((r) => r.code === goto.code), "an invite-only room stays off the list");

// A ticket only works once, and only for its room
const replayed = await new Promise((resolve) => {
    const ws = new WebSocket(`${base}/room/${goto.code}?ticket=${goto.ticket}`);
    ws.onopen = () => (ws.close(), resolve(true));
    ws.onerror = () => resolve(false);
});
ok(!replayed, "a used ticket is turned away");

guest.lobby.send(JSON.stringify({ t: "join", code: "ZZZZZZZZ", me }));
const wrong = await guest.next("error");
ok(/no room/.test(wrong.message), "a wrong code says there's no room");

const joined = await guest.enter({ t: "join", code: goto.code, me });
ok(joined.room.room.members.length === 2, "guest joined; the room has two");
await host.next("room", (m) => m.room.members.length === 2);

// Where each player is, for their flag, as Cloudflare says (wrangler dev asks
// Cloudflare for this machine's), until they hide it
const where = (update, id) => update.room.members.find((member) => member.id === id)?.country;
ok(
    where(joined.room, host.id) === hw.country,
    `the room shows where the host is (${hw.country ?? "Cloudflare didn't say"})`,
);
host.room.send(JSON.stringify({ t: "me", hideCountry: true }));
await guest.next("room", (m) => where(m, host.id) === undefined);
ok(true, "a host who hides their flag isn't shown anywhere");

host.room.send(JSON.stringify({ t: "start", game: { seed: 1 } }));
await guest.next("start");
ok(true, "start reaches the guest");

guest.room.send(JSON.stringify({ t: "up", d: { move: [1, 0] } }));
const up = await host.next("up");
ok(up.from === guest.id && up.d.move[0] === 1, "guest's input reaches the host with who it's from");

host.room.send(JSON.stringify({ t: "down", d: { upTo: 5, events: [] } }));
const down = await guest.next("down");
ok(down.d.upTo === 5, "host's frames reach the guest");

// A dropped connection comes back with the room's token, the run still on
ok(typeof joined.room.token === "string", "the room gives a token to come back with");
guest.room.close();
await new Promise((resolve) => setTimeout(resolve, 500));
guest.room = await guest.open(`${base}/room/${goto.code}?resume=${joined.room.token}`);
const back = await guest.next("room");
ok(back.room.started && back.room.members.length === 2, "the guest comes back, still in the run");
host.room.send(JSON.stringify({ t: "down", d: { upTo: 6, events: [] } }));
ok((await guest.next("down")).d.upTo === 6, "and the host's frames reach it again");
const stranger = new Client("stranger");
await stranger.open(`${base}/room/${goto.code}?resume=nottherighttoken`);
ok(/closed/.test((await stranger.next("error")).message), "a wrong token is turned away");

// Round trip guest -> host -> guest, the path a guest's input takes
const loops = [];
for (let i = 0; i < 20; i++) {
    const t = performance.now();
    guest.room.send(JSON.stringify({ t: "up", d: { move: [i, 0] } }));
    await host.next("up", (m) => m.d.move[0] === i);
    host.room.send(JSON.stringify({ t: "down", d: { upTo: 100 + i, events: [] } }));
    await guest.next("down", (m) => m.d.upTo === 100 + i);
    loops.push(performance.now() - t);
}
loops.sort((a, b) => a - b);
console.log(
    `guest -> host -> guest: median ${loops[10].toFixed(1)} ms (min ${loops[0].toFixed(1)}, max ${loops[19].toFixed(1)})`,
);
console.log("lobby ping:", await rtt(host.lobby, host));
console.log("room ping:", await rtt(host.room, host));

guest.room.send(JSON.stringify({ t: "leave" }));
const gone = await guest.next("gone");
ok(gone.reason === "left", "guest leaving hears it's gone");
const left = await host.next("left");
ok(left.id === guest.id, "host hears the guest left mid-run");

host.room.send(JSON.stringify({ t: "end" }));
host.room.send(JSON.stringify({ t: "disband" }));
const disbanded = await host.next("gone");
ok(disbanded.reason === "disbanded", "host disbanding closes the room");

host.lobby.send(JSON.stringify({ t: "list" }));
const after = await host.next("rooms");
ok(!after.rooms.some((r) => r.code === goto.code), "the room's off the list");

host.lobby.close();
guest.lobby.close();
console.log("all good");
process.exit(0);
