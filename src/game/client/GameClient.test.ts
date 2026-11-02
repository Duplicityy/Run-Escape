// @vitest-environment jsdom
import { emptyStats } from "../content/types";
import { Sim } from "../core/Sim";
import { hasBadNumber } from "../core/lockstep";
import { LoadedSave, SaveData, SaveStore, createSave } from "../core/save";
import { makeGrid } from "../core/world/testGrid";
import { DisplaySettings, loadDisplaySettings, saveDisplaySettings } from "./DisplaySettings";
import { GameClient, loadoutStats } from "./GameClient";
import { GameStore } from "./GameStore";

function createSim(): Sim {
    const row = ".".repeat(72);
    return new Sim({
        grid: makeGrid(Array(72).fill(row), 1000, 1000),
        mapId: "lumbridge",
        characterId: "warrior",
        metaStats: emptyStats(),
        seed: 5,
        spawnX: 1036.5,
        spawnY: 1036.5,
    });
}

// The client's run flow on its own: nothing it draws or plays is needed
function createClient(sim: Sim, autoAlch: boolean) {
    const save = createSave();
    const store = new GameStore(save);
    const client: GameClient = Object.create(GameClient.prototype);
    Object.assign(client, {
        sim,
        save,
        store,
        paused: false,
        shownDps: 0,
        shownDpsTick: 0,
        lastHudUpdate: 0,
        display: {
            menuSpin: false,
            pauseOnBlur: true,
            questTracker: true,
            autoAlch,
            movePrediction: false,
        },
        sounds: { onEvents() {}, levelUp() {}, playerDied() {} },
        view: { onEvents() {} },
        finishRun() {},
    });
    const sync = () => {
        (client as unknown as { syncOverlay(): void }).syncOverlay();
    };
    return { client, store, sync };
}

describe("movement prediction", () => {
    test("is off unless it's been turned on, and is remembered", () => {
        const stored = new Map<string, string>();
        vi.stubGlobal("window", {
            matchMedia: () => ({ matches: false }),
            localStorage: {
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: (key: string, value: string) => stored.set(key, value),
            },
        });
        expect(loadDisplaySettings().movePrediction).toBe(false);
        // Settings saved before there was such a thing
        stored.set("rune-survivors-display", JSON.stringify({ menuSpin: false }));
        expect(loadDisplaySettings().movePrediction).toBe(false);
        saveDisplaySettings({ ...loadDisplaySettings(), movePrediction: true });
        expect(loadDisplaySettings().movePrediction).toBe(true);
        vi.unstubAllGlobals();
    });

    test("the toggle reaches a run that's going", () => {
        vi.stubGlobal("window", { localStorage: { setItem() {} } });
        const { client } = createClient(createSim(), false);
        const setPrediction = vi.fn();
        Object.assign(client, { coopRun: { setPrediction } });
        client.toggleMovePrediction();
        expect(setPrediction).toHaveBeenLastCalledWith(true);
        client.toggleMovePrediction();
        expect(setPrediction).toHaveBeenLastCalledWith(false);
        vi.unstubAllGlobals();
    });
});

describe("auto alch", () => {
    test("is off unless it's been turned on, and is remembered", () => {
        const stored = new Map<string, string>();
        vi.stubGlobal("window", {
            matchMedia: () => ({ matches: false }),
            localStorage: {
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: (key: string, value: string) => stored.set(key, value),
            },
        });
        expect(loadDisplaySettings().autoAlch).toBe(false);
        // Settings saved before there was such a thing
        const key = "rune-survivors-display";
        stored.set(key, JSON.stringify({ menuSpin: false }));
        expect(loadDisplaySettings().autoAlch).toBe(false);
        const settings: DisplaySettings = { ...loadDisplaySettings(), autoAlch: true };
        saveDisplaySettings(settings);
        expect(loadDisplaySettings().autoAlch).toBe(true);
        vi.unstubAllGlobals();
    });

    test("turned off, the casket screen comes up as usual", () => {
        const sim = createSim();
        const { store, sync } = createClient(sim, false);
        sim.openCasket("easy");
        sync();
        expect(store.getSnapshot().overlay).toBe("chest");
        expect(store.getSnapshot().chest).toBeDefined();
        expect(sim.state).toBe("chest");
    });

    test("does just what clicking High alch does, without the casket screen", () => {
        const clicked = createSim();
        const auto = createSim();
        const { store, sync } = createClient(auto, true);
        // A piece of a started set: alching another stops the set, too
        for (const sim of [clicked, auto]) {
            sim.equip("torva_full_helm");
            sim.takeEvents();
        }
        for (const tier of ["easy", "hard", "master"] as const) {
            clicked.openCasket(tier);
            clicked.chests[0].itemId = "torva_platebody";
            clicked.resolveChest("alch");
            auto.openCasket(tier);
            auto.chests[0].itemId = "torva_platebody";
            sync();
            expect(store.getSnapshot().overlay).toBe("none");
            expect(store.getSnapshot().chest).toBeUndefined();
            expect(auto.state).toBe("playing");
        }
        expect(auto.coins).toBe(clicked.coins);
        expect(auto.coins).toBeGreaterThan(0);
        expect([...auto.declinedSets]).toEqual(["torva"]);
        expect(auto.getResult()).toEqual(clicked.getResult());
    });

    test("says what was alched, and for how much", () => {
        const sim = createSim();
        const { store, sync } = createClient(sim, true);
        sim.openCasket("easy");
        sim.chests[0].itemId = "torva_platebody";
        const worth = sim.alchValue("torva_platebody", 0);
        sync();
        expect(store.getSnapshot().toasts.map((t) => t.text)).toEqual([
            `High alched Torva platebody for ${worth.toLocaleString()} coins`,
        ]);
    });

    test("takes several caskets in a row, then carries on", () => {
        const sim = createSim();
        const { store, sync } = createClient(sim, true);
        sim.openCasket("easy");
        sim.openCasket("medium");
        sim.openCasket("hard");
        expect(sim.chests.length).toBe(3);
        sync();
        expect(sim.chests.length).toBe(0);
        expect(sim.casketsOpened).toBe(3);
        expect(sim.state).toBe("playing");
        expect(store.getSnapshot().overlay).toBe("none");
        expect(store.getSnapshot().toasts.length).toBe(3);
    });

    test("leaves a level up that came in on its screen", () => {
        const sim = createSim();
        const { store, sync } = createClient(sim, true);
        sim.openCasket("easy");
        sim.xp = sim.xpForNextLevel;
        sync();
        expect(sim.chests.length).toBe(0);
        expect(sim.state).toBe("levelUp");
        expect(store.getSnapshot().overlay).toBe("levelUp");
    });

    test("waits for an open level up, then alchs the casket", () => {
        const sim = createSim();
        const { client, store, sync } = createClient(sim, true);
        sim.xp = sim.xpForNextLevel;
        sim.step(0, 0);
        expect(sim.state).toBe("levelUp");
        sync();
        const coins = sim.coins;
        sim.openCasket("easy");
        const opened = sim.coins;
        expect(opened).toBeGreaterThanOrEqual(coins);
        sync();
        // The level up is still there, and the casket's waiting
        expect(store.getSnapshot().overlay).toBe("levelUp");
        expect(sim.chests.length).toBe(1);
        client.choose(0);
        expect(sim.chests.length).toBe(0);
        expect(sim.coins).toBeGreaterThan(opened);
        expect(store.getSnapshot().overlay).toBe("none");
    });

    test("a casket the run ended on is left, as it is with the screen", () => {
        const sim = createSim();
        const { store, sync } = createClient(sim, true);
        sim.openCasket("easy");
        const coins = sim.coins;
        sim.state = "dead";
        sync();
        expect(store.getSnapshot().overlay).toBe("dead");
        expect(sim.chests.length).toBe(1);
        expect(sim.coins).toBe(coins);
    });
});

describe("saving", () => {
    // The client and what it saves to, with a lock that's held or not
    function createSaving(held: boolean) {
        const save = createSave();
        const store = new GameStore(save);
        const saved: SaveData[] = [];
        let next: LoadedSave = { save: createSave() };
        const writeOver = vi.fn();
        const saveStore: SaveStore = {
            gameVersion: "0.22.1",
            load: () => next,
            save: (data) => void saved.push(structuredClone(data)),
            read: () => "stored",
            writeOver,
            getUnreadable: () => [],
            readUnreadable: () => undefined,
            deleteUnreadable() {},
        };
        const saveLock = { held, listen: () => () => {}, takeOver() {} };
        const client: GameClient = Object.create(GameClient.prototype);
        Object.assign(client, { save, store, saveStore, saveLock, coop: { setMe() {} } });
        // What's in storage, as another tab left it
        const setStored = (loaded: LoadedSave) => {
            next = loaded;
        };
        const lockChanged = (now: boolean) => {
            saveLock.held = now;
            (client as unknown as { onSaveLock(held: boolean): void }).onSaveLock(now);
        };
        return { client, store, saved, writeOver, setStored, lockChanged };
    }

    test("nothing's saved while another tab has the game", () => {
        const { client, store, saved, lockChanged } = createSaving(true);
        lockChanged(false);
        expect(store.getSnapshot().saveBlock).toEqual({ kind: "otherTab" });
        client.refundUpgrades();
        expect(saved).toEqual([]);
        // Played on without saving, the panel goes, and the button to open it
        // again comes
        client.playWithoutSaving();
        expect(store.getSnapshot().saveBlockClosed).toBe(true);
        client.showSaveBlock();
        expect(store.getSnapshot().saveBlockClosed).toBe(false);
    });

    test("getting the game back reads the save as the other tab left it", () => {
        const { client, store, saved, setStored, lockChanged } = createSaving(false);
        lockChanged(false);
        client.playWithoutSaving();
        setStored({ save: { ...createSave(), coins: 300 } });
        lockChanged(true);
        expect(client.save.coins).toBe(300);
        expect(store.getSnapshot().save.coins).toBe(300);
        expect(store.getSnapshot().saveBlock).toBeUndefined();
        client.refundUpgrades();
        expect(saved.map((s) => s.coins)).toEqual([300]);
        // Losing it again shows the panel again
        lockChanged(false);
        expect(store.getSnapshot().saveBlockClosed).toBe(false);
    });

    test("a save from a newer game is played but not saved", () => {
        const { client, store, saved, setStored, lockChanged } = createSaving(false);
        setStored({ save: { ...createSave(), coins: 70 }, newer: { gameVersion: "0.23.0" } });
        lockChanged(true);
        expect(store.getSnapshot().saveBlock).toEqual({ kind: "newerGame", gameVersion: "0.23.0" });
        expect(client.save.coins).toBe(70);
        client.refundUpgrades();
        expect(saved).toEqual([]);
    });

    test("saving anyway writes over a newer game's save, but never a newer format", () => {
        const { client, store, saved, writeOver, setStored, lockChanged } = createSaving(false);
        setStored({ save: { ...createSave(), coins: 70 }, newer: { gameVersion: "0.23.0" } });
        lockChanged(true);
        client.saveOverNewer();
        expect(writeOver).toHaveBeenCalledTimes(1);
        expect(saved.map((s) => s.coins)).toEqual([70]);
        expect(store.getSnapshot().saveBlock).toBeUndefined();
        // A format this game can't read is never written
        const format = { gameVersion: "0.24.0", format: true };
        setStored({ save: createSave(), newer: format });
        lockChanged(true);
        client.saveOverNewer();
        expect(writeOver).toHaveBeenCalledTimes(1);
        expect(saved).toHaveLength(1);
        expect(store.getSnapshot().saveBlock).toEqual({ kind: "newerGame", ...format });
    });

    test("exports a newer game's save as it's stored, not this game's copy of it", async () => {
        const saveFile = await import("./saveFile");
        const spy = vi.spyOn(saveFile, "saveFile").mockImplementation(() => {});
        const { client, setStored, lockChanged } = createSaving(false);
        setStored({ save: { ...createSave(), coins: 70 }, newer: { gameVersion: "0.23.0" } });
        lockChanged(true);
        client.exportSave();
        expect(spy).toHaveBeenLastCalledWith("run-escape-save.json", "stored", "application/json");
        // This game's own is marked with its version
        setStored({ save: { ...createSave(), coins: 80 } });
        lockChanged(true);
        client.exportSave();
        const text = spy.mock.lastCall![1];
        expect(JSON.parse(text)).toMatchObject({ coins: 80, gameVersion: "0.22.1" });
        spy.mockRestore();
    });

    test("another tab taking the save pauses a solo run, once, and not co-op's", () => {
        const { client, lockChanged } = createSaving(true);
        const pause = vi.fn();
        Object.assign(client, { sim: {}, pause });
        lockChanged(false);
        expect(pause).toHaveBeenCalledTimes(1);
        lockChanged(false);
        expect(pause).toHaveBeenCalledTimes(1);
        lockChanged(true);
        Object.assign(client, { coopRun: {} });
        lockChanged(false);
        expect(pause).toHaveBeenCalledTimes(1);
    });

    test("a save that couldn't be read, with no room for a copy, is left as it is", () => {
        const { client, store, saved, setStored, lockChanged } = createSaving(false);
        setStored({ save: createSave(), unreadable: "rune-survivors-save", noRoom: true });
        lockChanged(true);
        expect(store.getSnapshot().saveBlock).toEqual({ kind: "noRoom" });
        // The panel saying so is the notice
        expect(store.getSnapshot().unreadableSave).toBeUndefined();
        client.refundUpgrades();
        expect(saved).toEqual([]);
    });

    test("a save that couldn't be read is kept, told about, and a fresh one saved", () => {
        const { client, store, saved, setStored, lockChanged } = createSaving(false);
        setStored({ save: createSave(), unreadable: "rune-survivors-save-unreadable-1" });
        lockChanged(true);
        expect(store.getSnapshot().unreadableSave).toBe("rune-survivors-save-unreadable-1");
        expect(saved).toEqual([createSave()]);
        client.closeUnreadableNotice();
        expect(store.getSnapshot().unreadableSave).toBeUndefined();
    });
});

describe("loadoutStats", () => {
    test("takes the stats' own names only, each no more than the shop sells", () => {
        const stats = loadoutStats({
            metaStats: {
                might: 1e9,
                armor: -5,
                regen: NaN,
                constructor: 1,
                toString: 2,
                valueOf: 3,
                nothing: 4,
            },
            unlockedItems: [],
            armoury: {},
        });
        expect(Object.keys(stats)).toEqual(Object.keys(emptyStats()));
        expect(hasBadNumber(stats)).toBe(false);
        expect(stats.might).toBeGreaterThan(0);
        expect(stats.might).toBeLessThan(1e9);
        expect(stats.armor).toBe(0);
        expect(stats.regen).toBe(0);
    });
});
