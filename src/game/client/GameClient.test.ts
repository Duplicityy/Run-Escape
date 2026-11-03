// @vitest-environment jsdom
import { getCharacter } from "../content/characters";
import { emptyStats } from "../content/types";
import { Sim } from "../core/Sim";
import { hasBadNumber } from "../core/lockstep";
import {
    LoadedSave,
    SaveData,
    SaveStore,
    buyUpgrade,
    createSave,
    getMetaStats,
} from "../core/save";
import { makeGrid } from "../core/world/testGrid";
import { DamageMeter } from "./DamageMeter";
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
        damageMeter: new DamageMeter(),
        lastHudUpdate: 0,
        display: {
            menuSpin: false,
            pauseOnBlur: true,
            questTracker: true,
            damagePanel: false,
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

function displayOf(client: GameClient): DisplaySettings {
    return (client as unknown as { display: DisplaySettings }).display;
}

describe("the damage panel", () => {
    test("is shut unless it's been opened, and is remembered", () => {
        const stored = new Map<string, string>();
        vi.stubGlobal("window", {
            matchMedia: () => ({ matches: false }),
            localStorage: {
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: (key: string, value: string) => stored.set(key, value),
            },
        });
        expect(loadDisplaySettings().damagePanel).toBe(false);
        // Settings saved before there was such a thing
        stored.set("rune-survivors-display", JSON.stringify({ questTracker: false }));
        expect(loadDisplaySettings().damagePanel).toBe(false);
        const { client } = createClient(createSim(), false);
        client.toggleDamagePanel();
        expect(loadDisplaySettings().damagePanel).toBe(true);
        client.toggleDamagePanel();
        expect(loadDisplaySettings().damagePanel).toBe(false);
        vi.unstubAllGlobals();
    });

    test("has each weapon's damage on the HUD", () => {
        vi.stubGlobal("window", { localStorage: { setItem() {} } });
        const sim = createSim();
        const { client, store } = createClient(sim, false);
        const updateHud = (client as unknown as { updateHud(force: boolean): void }).updateHud;
        const source = `weapon:${sim.weapons[0].def.id}` as const;
        sim.damageBySource[source] = 0;
        updateHud.call(client, true);
        for (let i = 0; i < 4 * 50; i++) {
            sim.tick++;
        }
        sim.damageBySource[source] = 400;
        updateHud.call(client, true);
        const hud = store.getSnapshot().hud!;
        expect(hud.weapons[0]).toMatchObject({ dps: 100, damage: 400 });
        expect(hud.otherDps).toBe(0);
        vi.unstubAllGlobals();
    });

    test("puts a weapon that's gone (evolved) under none, not Other", () => {
        vi.stubGlobal("window", { localStorage: { setItem() {} } });
        const sim = createSim();
        const { client, store } = createClient(sim, false);
        const updateHud = (client as unknown as { updateHud(force: boolean): void }).updateHud;
        updateHud.call(client, true);
        sim.tick += 4 * 50;
        // An old weapon's damage, and a ring of recoil's
        sim.damageBySource["weapon:evolved_away"] = 600;
        sim.damageBySource.recoil = 40;
        updateHud.call(client, true);
        expect(store.getSnapshot().hud!.otherDps).toBe(10);
        vi.unstubAllGlobals();
    });

    // Tab's the panel's (GameInput.takesKey, and the key press) only then
    test("takes Tab only while the run's being played", () => {
        const sim = createSim();
        const { client, store } = createClient(sim, false);
        const isPlaying = () =>
            (client as unknown as { isPlaying(): boolean }).isPlaying.call(client);
        store.set({ overlay: "none" });
        expect(isPlaying()).toBe(true);
        // A level up, a casket, the pause menu: Tab moves between their buttons
        for (const overlay of ["levelUp", "chest", "paused"] as const) {
            store.set({ overlay });
            expect(isPlaying()).toBe(false);
        }
        // Nor once the run's over
        store.set({ overlay: "none" });
        // How a run ends is the sim's business; only that it has matters here
        Object.defineProperty(sim, "runOver", { value: true });
        expect(isPlaying()).toBe(false);
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

    test.each([
        ["warrior", "melee"],
        ["ranger", "ranged"],
        ["wizard", "magic"],
    ] as const)("%s sends only its class's skills to co-op", (characterId, style) => {
        expect.hasAssertions();
        const { client, store } = createSaving(true);
        client.save.coins = 50000;
        buyUpgrade(client.save, "strength", "melee");
        buyUpgrade(client.save, "hitpoints", "ranged");
        buyUpgrade(client.save, "ring_of_life", "magic");
        store.set({ characterId });
        const loadout = (
            client as unknown as { getLoadout(): Parameters<typeof loadoutStats>[0] }
        ).getLoadout();
        const stats = loadoutStats(loadout);
        expect(stats.might).toBeCloseTo(style === "melee" ? 0.05 : 0);
        expect(stats.revival).toBe(style === "magic" ? 1 : 0);
    });

    test("a ranged skill refund persists without changing melee or magic", () => {
        expect.hasAssertions();
        const { client, store, saved } = createSaving(true);
        client.save.coins = 50000;
        buyUpgrade(client.save, "strength", "melee");
        buyUpgrade(client.save, "strength", "ranged");
        buyUpgrade(client.save, "hitpoints", "magic");
        const before = structuredClone(client.save);
        buyUpgrade(client.save, "strength", "ranged");
        client.refundUpgrade("strength", "ranged");
        expect(client.save).toEqual(before);
        expect(saved).toEqual([before]);
        expect(store.getSnapshot().save).toEqual(before);
    });

    test.each([
        ["warrior", "lumbridge", "warrior"],
        ["ranger", "lumbridge", "ranger"],
        ["wizard", "lumbridge", "wizard"],
        ["wizard", "falador", "durial321"],
    ])(
        "solo %s on %s uses the actual adventurer's class skills",
        async (selected, mapId, actual) => {
            expect.hasAssertions();
            const { client, store } = createSaving(true);
            client.save.coins = 50000;
            buyUpgrade(client.save, "strength", "melee");
            buyUpgrade(client.save, "hitpoints", "ranged");
            buyUpgrade(client.save, "ring_of_life", "magic");
            store.set({ characterId: selected });
            const enterRun = vi.fn<(sim: Sim) => void>();
            Object.assign(client, {
                grid: createSim().grid,
                travelTo: vi.fn().mockResolvedValue(true),
                enterRun,
                options: { stress: 0 },
            });
            await client.startRun(mapId);
            const sim = enterRun.mock.calls[0][0];
            expect(sim.characterId).toBe(actual);
            expect(sim.metaStats).toEqual(getMetaStats(client.save, getCharacter(actual).style));
        },
    );

    test("a co-op map's forced adventurer determines the skill page", () => {
        expect.hasAssertions();
        const { client, store } = createSaving(true);
        client.save.coins = 50000;
        buyUpgrade(client.save, "strength", "melee");
        buyUpgrade(client.save, "ring_of_life", "magic");
        store.set({ characterId: "wizard" });
        Object.assign(client, { coop: { room: { mapId: "falador" } } });
        const loadout = (
            client as unknown as { getLoadout(): Parameters<typeof loadoutStats>[0] }
        ).getLoadout();
        expect(loadoutStats(loadout)).toEqual(
            getMetaStats(client.save, getCharacter("durial321").style),
        );
    });

    test("a single skill refund is saved and refreshes the shop", () => {
        expect.hasAssertions();
        const { client, store, saved } = createSaving(true);
        client.save.coins = 10000;
        buyUpgrade(client.save, "strength");
        buyUpgrade(client.save, "hitpoints");
        const before = structuredClone(client.save);
        buyUpgrade(client.save, "strength");
        client.refundUpgrade("strength");
        expect(client.save).toEqual(before);
        expect(saved).toEqual([before]);
        expect(store.getSnapshot().save).toEqual(before);
        client.refundUpgrade("unknown");
        expect(saved).toHaveLength(1);
    });

    test("a single skill refund respects another tab's save lock", () => {
        expect.hasAssertions();
        const { client, store, saved, lockChanged } = createSaving(true);
        client.save.coins = 10000;
        buyUpgrade(client.save, "strength");
        lockChanged(false);
        client.refundUpgrade("strength");
        expect(client.save.skillPages.melee.upgrades).toEqual({});
        expect(store.getSnapshot().save.coins).toBe(10000);
        expect(saved).toEqual([]);
    });

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
