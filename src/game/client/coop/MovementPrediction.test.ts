import { emptyStats } from "../../content/types";
import { PLAYER_SPEED, Sim } from "../../core/Sim";
import type { Enemy } from "../../core/entities";
import { usePortableMath } from "../../core/fmath";
import { cleanFrameEvent, syncHash } from "../../core/lockstep";
import { makeGrid } from "../../core/world/testGrid";
import { getPlayerPose } from "../PlayerPose";
import { CoopRun } from "./CoopRun";
import {
    MAX_INPUT_HISTORY,
    MOVE_REFRESH_MS,
    MovementPrediction,
    PREDICTION_MS,
} from "./MovementPrediction";

function makeSim(focus = 1, wall = false): Sim {
    const rows = Array.from({ length: 72 }, () =>
        Array.from({ length: 72 }, (_, x) => (wall && x === 35 ? "|" : ".")).join(""),
    );
    return new Sim({
        grid: makeGrid(rows, 1000, 1000),
        characterId: "warrior",
        metaStats: emptyStats(),
        seed: 3,
        spawnX: 1033.5,
        spawnY: 1036.5,
        focus,
        party: ["warrior", "wizard"].map((characterId, i) => ({
            name: `p${i}`,
            characterId,
            metaStats: emptyStats(),
        })),
    });
}

function setup(wall = false) {
    let now = 0;
    const sim = makeSim(1, wall);
    const prediction = new MovementPrediction(sim, () => now);
    prediction.confirm([]);
    return { sim, prediction, time: (ms: number) => (now = ms) };
}

afterEach(() => usePortableMath(false));

test("moves and turns immediately without writing any confirmed player state", () => {
    const { sim, prediction, time } = setup();
    const before = JSON.stringify(sim.heroes);
    const hash = syncHash(sim);
    prediction.sample([127, 0]);
    const initialX = sim.player.x;
    time(20);
    const pose = prediction.render()!;
    expect(pose.x).toBeCloseTo(initialX + PLAYER_SPEED);
    expect(pose.moving).toBe(true);
    expect(pose.yaw).not.toBe(sim.player.yaw);
    expect(JSON.stringify(sim.heroes)).toBe(before);
    expect(syncHash(sim)).toBe(hash);
    // A spectator or teammate always uses their own confirmed position.
    expect(getPlayerPose(sim, 0, 1, pose).x).toBe(sim.heroes[0].player.x);
    expect(getPlayerPose(sim, 1, 1, pose)).toBe(pose);
    expect(getPlayerPose(sim, 99, 1).x).toBe(sim.player.x);
});

test("replays terrain collision, movement speed and cursed controls", () => {
    const { sim, prediction, time } = setup(true);
    sim.heroes[1].stats.moveSpeed = 4;
    prediction.sample([127, 0]);
    time(300);
    expect(prediction.render()!.x).toBeLessThanOrEqual(1036 - sim.player.radius + 1e-9);

    const other = setup();
    other.sim.heroes[1].stats.moveSpeed = 1;
    other.sim.heroes[1].curse = { matrix: [-1, 0, 0, 1], attacksLeft: 3 };
    other.prediction.sample([127, 0]);
    other.time(20);
    expect(other.prediction.render()!.x).toBeCloseTo(other.sim.player.x - 2 * PLAYER_SPEED);
});

test("prediction applies the sled multiplier and the active boss arena", () => {
    const { sim, prediction, time } = setup();
    sim.heroes[1].sledEndTick = 100;
    sim.heroes[1].sledSpeed = 2;
    prediction.sample([127, 0]);
    time(20);
    expect(prediction.render()!.x).toBeCloseTo(sim.player.x + 2 * PLAYER_SPEED);

    const arena = setup();
    Object.defineProperty(arena.sim, "map", {
        value: {
            ...arena.sim.map,
            bossArena: { baseX: 1033, baseY: 1037, size: 1 },
        },
    });
    vi.spyOn(arena.sim, "shownBoss", "get").mockReturnValue({
        def: { boss: { phases: {} } },
    } as Enemy);
    arena.prediction.sample([127, 0]);
    arena.time(300);
    const pose = arena.prediction.render()!;
    expect(pose.x).toBeCloseTo(1034 - arena.sim.player.radius);
    expect(pose.y).toBeCloseTo(1038 - arena.sim.player.radius);
});

test("bounds prediction time and history during a stalled connection", () => {
    const { sim, prediction, time } = setup();
    prediction.sample([127, 0]);
    time(PREDICTION_MS);
    const maximum = sim.player.x + (PREDICTION_MS / 20) * PLAYER_SPEED;
    expect(prediction.render()!.x).toBeCloseTo(maximum);
    time(480);
    // Correction easing can leave a small visual error beyond the replay
    // window, but a stalled connection cannot move the picture indefinitely.
    const last = prediction.render()!.x;
    expect(last).toBeLessThan(maximum + 0.1);
    time(501);
    expect(prediction.render()!.x).toBeLessThan(last);
    time(1500);
    expect(prediction.render()).toBeUndefined();

    for (let i = 0; i < 1000; i++) {
        time(600 + i);
        prediction.sample([i % 2 ? 127 : -127, 0]);
    }
    expect((prediction as unknown as { inputs: unknown[] }).inputs.length).toBeLessThanOrEqual(
        MAX_INPUT_HISTORY,
    );
});

test.each(["frozen", "hold", "down", "left", "menu", "casket", "over"])(
    "eases back to confirmed presentation when %s",
    (reason) => {
        const { sim, prediction, time } = setup();
        prediction.sample([127, 0]);
        time(300);
        const before = prediction.render()!.x;
        if (reason === "frozen") sim.player.frozen = 30;
        if (reason === "hold") {
            sim.player.frozen = 30;
            sim.heroes[1].hold = {} as NonNullable<(typeof sim.heroes)[1]["hold"]>;
        }
        if (reason === "down") sim.heroes[1].down = true;
        if (reason === "left") sim.heroes[1].left = true;
        if (reason === "menu") sim.state = "levelUp";
        if (reason === "casket") sim.state = "chest";
        if (reason === "over") sim.state = "dead";
        time(316);
        const easing = prediction.render()!;
        expect(easing.x).toBeGreaterThan(sim.player.x);
        expect(easing.x).toBeLessThan(before);
        expect(before - easing.x).toBeLessThan(0.25);
        for (let now = 332; now <= 1200; now += 16) {
            time(now);
            prediction.render();
        }
        expect(prediction.render()).toBeUndefined();
    },
);

test("correction crosses a wall when the confirmed position is on its other side", () => {
    const { sim, prediction, time } = setup(true);
    sim.player.x = sim.player.prevX = 1035.6;
    prediction.confirm([]);
    prediction.render();
    // Less than SNAP_DISTANCE, with a thin wall between the two valid positions.
    sim.player.x = sim.player.prevX = 1036.4;
    for (let now = 20; now <= 600; now += 20) {
        time(now);
        prediction.confirm([]);
        prediction.render();
    }
    expect(prediction.render()!.x).toBeCloseTo(sim.player.x, 4);
});

test("100ms frames keep their movement and animation time", () => {
    const { sim, prediction, time } = setup();
    prediction.sample([127, 0]);
    prediction.render();
    time(100);
    const pose = prediction.render()!;
    expect(pose.x).toBeCloseTo(sim.player.x + 5 * PLAYER_SPEED);
    expect(pose.moveTicks).toBeCloseTo(5);
});

test("the newest stop is replayed even when the confirmation lead exceeds the budget", () => {
    const { sim, prediction, time } = setup();
    prediction.sample([127, 0]);
    time(300);
    const before = prediction.render()!.x;
    time(350);
    prediction.sample([0, 0]);
    for (let now = 360; now <= 480; now += 20) {
        time(now);
        prediction.render();
    }
    expect(prediction.render()!.x).toBeLessThan(before - 0.2);
    expect(prediction.render()!.moving).toBe(false);
    expect(sim.player.moving).toBe(false);
});

test("periodic input acknowledgments bound clock drift when the host runs slowly", () => {
    let now = 0;
    const heroes = new Map([
        ["p0", 0],
        ["p1", 1],
    ]);
    const host = new CoopRun(
        makeSim(0),
        true,
        {
            sendUp() {},
            sendDown: (message) => guest.receiveDown(message),
        },
        heroes,
        "p0",
        () => now,
    );
    const guest = new CoopRun(
        makeSim(1),
        false,
        {
            sendUp: (message) => host.receiveUp("p1", message),
            sendDown() {},
        },
        heroes,
        "p0",
        () => now,
    );
    host.receiveUp("p1", { loaded: true });
    for (now = 0; now <= 4200; now += 20) {
        guest.setMove(now < 3800 ? 1 : 0, 0);
        // Host simulates at half the real-time rate.
        if (now % 40 === 0) {
            host.stepFrame();
            host.flush(true);
        }
        while (guest.canStep()) guest.stepFrame();
        guest.prediction!.render();
        if (now === 3600) {
            const clock = guest.prediction as unknown as { confirmedAt: number };
            expect(now - clock.confirmedAt).toBeLessThan(MOVE_REFRESH_MS + 40);
        }
    }
    expect(guest.prediction!.render()!.x).toBeCloseTo(guest.sim.player.x, 2);
    expect(syncHash(guest.sim)).toBe(syncHash(host.sim));
});

test("teleports reset prediction instead of smoothing through scenery", () => {
    const { sim, prediction, time } = setup();
    prediction.sample([127, 0]);
    time(100);
    prediction.render();
    sim.player.x += 8;
    sim.player.prevX = sim.player.x;
    prediction.confirm([]);
    expect(prediction.render()!.x).toBe(sim.player.x);
});

test("host echoes the newest coalesced sequence and drops malformed metadata", () => {
    const sim = makeSim(0);
    const host = new CoopRun(
        sim,
        true,
        { sendUp() {}, sendDown() {} },
        new Map([
            ["p0", 0],
            ["p1", 1],
        ]),
        "p0",
    );
    host.receiveUp("p1", { move: [127, 0], moveSeq: 1 });
    host.receiveUp("p1", { move: [0, 127], moveSeq: 3 });
    expect(host.stepFrame()[0]).toMatchObject({ hero: 1, move: [0, 127], moveSeq: 3 });
    expect(host.prediction).toBeUndefined();
    expect(
        cleanFrameEvent({ frame: 1, hero: 1, move: [127, 0], moveSeq: Infinity }, 2),
    ).not.toHaveProperty("moveSeq");
    expect(
        cleanFrameEvent({ frame: 1, hero: 1, move: [127, 0], moveSeq: -1 }, 2),
    ).not.toHaveProperty("moveSeq");
});

test("a direction changed back inside the send throttle still gets acknowledged", () => {
    let now = 0;
    const messages: { move?: [number, number]; moveSeq?: number }[] = [];
    const guest = new CoopRun(
        makeSim(),
        false,
        {
            sendUp: (message) => messages.push(message as (typeof messages)[number]),
            sendDown() {},
        },
        new Map([
            ["p0", 0],
            ["p1", 1],
        ]),
        "p0",
        () => now,
    );
    guest.setMove(1, 0);
    now = 20;
    guest.setMove(0, 1);
    now = 40;
    guest.setMove(1, 0);
    expect(messages).toHaveLength(1);
    now = 80;
    guest.setMove(1, 0);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ move: [127, 0], moveSeq: 3 });
});

test.each([false, true])(
    "delayed starts, stops and reversals preserve confirmed hashes (jitter: %s)",
    (jitter) => {
        usePortableMath(true);
        let now = 0;
        const deliveries: { at: number; fn: () => void }[] = [];
        const lastDelivery = [0, 0];
        let sent = 0;
        const send = (channel: number, fn: () => void) => {
            const delay = jitter ? 80 + ((sent++ * 17) % 5) * 20 : 120;
            const at = Math.max(now + delay, lastDelivery[channel]);
            lastDelivery[channel] = at;
            deliveries.push({ at, fn });
        };
        const heroes = new Map([
            ["p0", 0],
            ["p1", 1],
        ]);
        const host = new CoopRun(
            makeSim(0),
            true,
            {
                sendUp() {},
                sendDown: (message) => send(0, () => guest.receiveDown(message)),
            },
            heroes,
            "p0",
            () => now,
        );
        const guest = new CoopRun(
            makeSim(1),
            false,
            {
                sendUp: (message) => send(1, () => host.receiveUp("p1", message)),
                sendDown() {},
            },
            heroes,
            "p0",
            () => now,
        );
        host.receiveUp("p1", { loaded: true });
        const hashes = new Map<number, number>();
        let firstPose = 0;
        let stoppedPose = 0;
        let beforeReverse = 0;
        for (now = 0; now <= 2000; now += 20) {
            for (let i = 0; i < deliveries.length; ) {
                if (deliveries[i].at <= now) deliveries.splice(i, 1)[0].fn();
                else i++;
            }
            const move = now >= 300 && now < 700 ? 1 : now >= 1100 && now < 1400 ? -1 : 0;
            guest.setMove(move, 0);
            host.stepFrame();
            hashes.set(host.frame, syncHash(host.sim));
            host.flush();
            while (guest.canStep()) {
                guest.stepFrame();
                expect(syncHash(guest.sim)).toBe(hashes.get(guest.frame));
            }
            const state = JSON.stringify(guest.sim.heroes.map((hero) => hero.player));
            const pose = guest.prediction!.render();
            expect(JSON.stringify(guest.sim.heroes.map((hero) => hero.player))).toBe(state);
            if (now === 300) firstPose = pose!.x;
            if (now === 340) {
                expect(pose!.x).toBeGreaterThan(firstPose + PLAYER_SPEED);
                expect(guest.sim.player.x).toBeCloseTo(firstPose);
            }
            if (now === 700) stoppedPose = pose!.x;
            if (now === 800)
                expect(Math.abs(pose!.x - stoppedPose)).toBeLessThan(jitter ? 0.2 : 0.05);
            if (now === 1100) beforeReverse = pose!.x;
            if (now === 1140) expect(pose!.x).toBeLessThan(beforeReverse - PLAYER_SPEED);
            if (now === 2000) expect(pose!.x).toBeCloseTo(guest.sim.player.x, 2);
        }
        expect(guest.desynced).toBe(false);
    },
);
