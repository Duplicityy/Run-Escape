import { ARMOURY_COSTS } from "../content/armoury";
import { CHARACTERS } from "../content/characters";
import { getEnemy } from "../content/enemies";
import { CASKET_GEAR } from "../content/items";
import { CAMPAIGN_MAPS, FUN_MAPS, MAPS, getMap } from "../content/maps";
import { QUESTS, QUEST_BY_ID, describeQuest } from "../content/quests";
import { LOCKABLE_ITEMS } from "../content/unlocks";
import { RUN_LENGTH } from "../content/waves";
import {
    LocalSaveStore,
    NewerSaveError,
    RunSummary,
    SAVE_VERSION,
    buyArmouryUpgrade,
    buyUpgrade,
    compareGameVersions,
    createSave,
    exportSave,
    getArmouryStep,
    getEarnedUnlocks,
    getFinishedQuests,
    getMetaStats,
    getNextUpgradeCost,
    getQuestProgress,
    getSkillCoins,
    importSave,
    isEndlessRecord,
    isEndlessUnlocked,
    isHardUnlocked,
    isMapUnlocked,
    migrateSave,
    recordRun,
    refundUpgrade,
    refundUpgrades,
} from "./save";

// The game's version, as far as these tests go
const GAME = "0.22.1";

function run(mapId: string, changes: Partial<RunSummary> = {}): RunSummary {
    return {
        mapId,
        victory: false,
        seconds: 300,
        level: 20,
        kills: 900,
        coins: 0,
        bossesKilled: [],
        ...changes,
    };
}

describe("save", () => {
    test("version 10 investments become one shared budget exactly once", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 9400;
        for (const style of ["melee", "ranged", "magic"] as const) {
            save.skillPages[style] = {
                upgrades: { strength: 1 },
                upgradesSpent: 200,
                upgradeRefunds: { strength: [200] },
            };
        }
        const loaded = migrateSave({ ...save, version: 10 });
        expect(loaded.coins).toBe(9800);
        expect(loaded.skillPages).toEqual(save.skillPages);
        expect(migrateSave(loaded)).toEqual(loaded);
        expect(importSave(exportSave(loaded, GAME), GAME)).toEqual(loaded);
        for (const style of ["melee", "ranged", "magic"] as const) {
            expect(getSkillCoins(loaded, style)).toBe(9800);
            refundUpgrades(loaded, style);
        }
        expect(loaded.coins).toBe(10000);
    });

    test("unequal page spending releases only the gold no other page needs", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 10000;
        buyUpgrade(save, "ring_of_life", "melee");
        buyUpgrade(save, "strength", "ranged");
        buyUpgrade(save, "strength", "magic");
        expect(getSkillCoins(save, "melee")).toBe(0);
        expect(getSkillCoins(save, "ranged")).toBe(9800);
        expect(getSkillCoins(save, "magic")).toBe(9800);
        expect(refundUpgrade(save, "ring_of_life", "melee")).toBe(true);
        expect(save.coins).toBe(9800);
        expect(getSkillCoins(save, "melee")).toBe(10000);
        expect(getSkillCoins(save, "ranged")).toBe(9800);
        expect(getSkillCoins(save, "magic")).toBe(9800);
        expect(buyUpgrade(save, "ring_of_life", "ranged")).toBe(false);
        expect(refundUpgrade(save, "strength", "ranged")).toBe(true);
        expect(save.coins).toBe(9800);
        refundUpgrades(save, "magic");
        expect(save.coins).toBe(10000);
    });

    test("earned gold expands every page and Armoury purchases reduce their available budgets", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 50000;
        buyUpgrade(save, "ring_of_life", "melee");
        buyUpgrade(save, "strength", "ranged");
        const before = Object.fromEntries(
            (["melee", "ranged", "magic"] as const).map((style) => [
                style,
                getSkillCoins(save, style),
            ]),
        );
        recordRun(save, run("lumbridge", { coins: 500 }));
        const gear = CASKET_GEAR.find((item) => {
            const step = getArmouryStep(save, item.id);
            return step && !step.locked;
        })!;
        save.foundGear.push(gear.id);
        const cost = getArmouryStep(save, gear.id)!.cost;
        expect(buyArmouryUpgrade(save, gear.id)).toBe(true);
        for (const style of ["melee", "ranged", "magic"] as const) {
            expect(getSkillCoins(save, style)).toBe(before[style] + 500 - cost);
        }
    });

    test("each class can spend the full gold budget without multiplying refund gold", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 10000;
        for (const style of ["melee", "ranged", "magic"] as const) {
            expect(buyUpgrade(save, "ring_of_life", style)).toBe(true);
            expect(save.coins).toBe(0);
        }
        const loaded = importSave(exportSave(save, GAME), GAME);
        const magic = structuredClone(loaded.skillPages.magic);
        expect(refundUpgrade(loaded, "ring_of_life", "melee")).toBe(true);
        expect(loaded.coins).toBe(0);
        expect(loaded.skillPages.magic).toEqual(magic);
        refundUpgrades(loaded, "ranged");
        expect(loaded.coins).toBe(0);
        expect(loaded.skillPages.magic).toEqual(magic);
        refundUpgrades(loaded, "magic");
        expect(loaded.coins).toBe(10000);
    });

    test("legacy shared skills migrate to melee without duplicating their investment", () => {
        expect.hasAssertions();
        const save = migrateSave({
            version: 9,
            coins: 39600,
            upgrades: { ring_of_life: 1, strength: 1 },
            upgradesSpent: 10400,
            upgradeRefunds: { ring_of_life: [10000], strength: [400] },
        });
        expect(save.version).toBe(SAVE_VERSION);
        expect(save.skillPages.melee.upgrades).toEqual({ ring_of_life: 1, strength: 1 });
        expect(save.skillPages.ranged).toEqual({ upgrades: {}, upgradesSpent: 0 });
        expect(save.skillPages.magic).toEqual({ upgrades: {}, upgradesSpent: 0 });
        const loaded = importSave(exportSave(save, GAME), GAME);
        expect(loaded).toEqual(save);
        expect(refundUpgrade(loaded, "ring_of_life", "melee")).toBe(true);
        expect(loaded.coins).toBe(49600);
        refundUpgrades(loaded, "ranged");
        refundUpgrades(loaded, "magic");
        expect(loaded.coins).toBe(49600);
        refundUpgrades(loaded, "melee");
        expect(loaded.coins).toBe(50000);
    });

    test.each(["melee", "ranged", "magic"] as const)(
        "%s prices and partial refunds are independent of the other classes",
        (style) => {
            expect.hasAssertions();
            const save = createSave();
            save.coins = 100000;
            const first = getNextUpgradeCost(save, "strength", style);
            for (const other of ["melee", "ranged", "magic"] as const) {
                if (other !== style) {
                    buyUpgrade(save, "ring_of_life", other);
                    buyUpgrade(save, "strength", other);
                }
            }
            expect(getNextUpgradeCost(save, "strength", style)).toBe(first);
            buyUpgrade(save, "strength", style);
            buyUpgrade(save, "hitpoints", style);
            const before = structuredClone(save);
            buyUpgrade(save, "strength", style);
            const loaded = importSave(exportSave(save, GAME), GAME);
            expect(refundUpgrade(loaded, "strength", style)).toBe(true);
            expect(loaded).toEqual(before);
            const noChange = structuredClone(loaded);
            expect(refundUpgrade(loaded, "unknown", style)).toBe(false);
            expect(loaded).toEqual(noChange);
            for (const other of ["melee", "ranged", "magic"] as const) {
                refundUpgrades(loaded, other);
            }
            expect(loaded.coins).toBe(100000);
        },
    );

    test("malformed class pages and refund histories do not affect valid pages", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 10000;
        buyUpgrade(save, "strength", "ranged");
        const loaded = migrateSave({
            ...save,
            skillPages: {
                melee: {
                    upgrades: { strength: 1.5, unknown: 9 },
                    upgradesSpent: 200,
                    upgradeRefunds: { strength: [-1] },
                },
                ranged: save.skillPages.ranged,
                magic: null,
            },
        });
        expect(loaded.skillPages.ranged).toEqual(save.skillPages.ranged);
        expect(loaded.skillPages.magic).toEqual({ upgrades: {}, upgradesSpent: 0 });
        expect(loaded.skillPages.melee.upgrades).toEqual({ strength: 1 });
        expect(refundUpgrade(loaded, "strength", "melee")).toBe(true);
        expect(loaded.skillPages.ranged).toEqual(save.skillPages.ranged);
        expect(loaded.skillPages.magic).toEqual({ upgrades: {}, upgradesSpent: 0 });
    });

    test("class skill pages survive export and refund independently", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 50000;
        buyUpgrade(save, "strength", "melee");
        buyUpgrade(save, "strength", "ranged");
        buyUpgrade(save, "hitpoints", "magic");
        const loaded = importSave(exportSave(save, GAME), GAME);
        const ranged = structuredClone(loaded.skillPages.ranged);
        const magic = structuredClone(loaded.skillPages.magic);
        expect(getMetaStats(loaded, "melee").might).toBeCloseTo(0.05);
        expect(getMetaStats(loaded, "ranged").might).toBeCloseTo(0.05);
        expect(getMetaStats(loaded, "magic").might).toBe(0);
        expect(refundUpgrade(loaded, "strength", "melee")).toBe(true);
        expect(loaded.skillPages.melee.upgrades).toEqual({});
        expect(loaded.skillPages.ranged).toEqual(ranged);
        expect(loaded.skillPages.magic).toEqual(magic);
        refundUpgrades(loaded, "ranged");
        expect(loaded.skillPages.magic).toEqual(magic);
        refundUpgrades(loaded, "magic");
        expect(loaded.coins).toBe(50000);
    });

    test("new saves have the free characters", () => {
        const save = createSave();
        expect(save.unlockedCharacters).toEqual(["warrior", "wizard", "ranger"]);
        expect(save.coins).toBe(0);
    });

    test("migrates partial and broken saves", () => {
        const save = migrateSave({
            coins: 120,
            upgrades: { strength: 9, unknown: 3 },
            unlockedCharacters: ["dwarf", "nobody"],
            runs: "lots",
        });
        expect(save.coins).toBe(120);
        expect(save.skillPages.melee.upgrades).toEqual({ strength: 5 });
        expect(save.unlockedCharacters).toContain("dwarf");
        expect(save.unlockedCharacters).not.toContain("nobody");
        expect(save.runs).toBe(0);
        expect(migrateSave(null)).toEqual(createSave());
        expect(migrateSave("garbage")).toEqual(createSave());
    });

    test("Crystal armour comes in with beating Prifddinas, on old saves too", () => {
        const pieces = ["crystal_helm", "crystal_body", "crystal_legs"];
        expect(createSave().unlockedItems).not.toEqual(expect.arrayContaining(pieces));
        const beaten = migrateSave({ ...createSave(), mapVictories: { prifddinas: 1 } });
        expect(beaten.unlockedItems).toEqual(expect.arrayContaining(pieces));
    });

    test("buying upgrades costs coins and raises later prices", () => {
        const save = createSave();
        save.coins = 10000;
        const first = getNextUpgradeCost(save, "strength")!;
        expect(buyUpgrade(save, "strength")).toBe(true);
        expect(save.coins).toBe(10000 - first);
        expect(getNextUpgradeCost(save, "strength")!).toBeGreaterThan(first);
        expect(getMetaStats(save).might).toBeCloseTo(0.05);
    });

    test("cannot buy past max rank or without coins", () => {
        const save = createSave();
        save.coins = 100;
        expect(buyUpgrade(save, "strength")).toBe(false);
        save.coins = 1e9;
        for (let i = 0; i < 5; i++) {
            expect(buyUpgrade(save, "strength")).toBe(true);
        }
        expect(buyUpgrade(save, "strength")).toBe(false);
        expect(getNextUpgradeCost(save, "strength")).toBeUndefined();
    });

    test("refunds give back everything spent", () => {
        const save = createSave();
        save.coins = 50000;
        buyUpgrade(save, "strength");
        buyUpgrade(save, "hitpoints");
        buyUpgrade(save, "strength");
        refundUpgrades(save);
        expect(save.coins).toBe(50000);
        expect(save.skillPages.melee.upgrades).toEqual({});
    });

    test("refunding one rank undoes the last purchase without changing other skills", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 50000;
        buyUpgrade(save, "strength");
        buyUpgrade(save, "hitpoints");
        const before = structuredClone(save);
        buyUpgrade(save, "strength");
        expect(refundUpgrade(save, "strength")).toBe(true);
        expect(save).toEqual(before);
        expect(getMetaStats(save).might).toBeCloseTo(0.05);
    });

    test("refunding a maxed skill reopens its last rank and removes its final rank", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 50000;
        for (let rank = 0; rank < 5; rank++) {
            buyUpgrade(save, "strength");
        }
        expect(getNextUpgradeCost(save, "strength")).toBeUndefined();
        expect(refundUpgrade(save, "strength")).toBe(true);
        expect(save.skillPages.melee.upgrades.strength).toBe(4);
        expect(getNextUpgradeCost(save, "strength")).toBeDefined();
        for (let rank = 0; rank < 4; rank++) {
            expect(refundUpgrade(save, "strength")).toBe(true);
        }
        expect(save.skillPages.melee.upgrades).toEqual({});
        expect(save.coins).toBe(50000);
        expect(save.skillPages.melee.upgradesSpent).toBe(0);
    });

    test("unbought and unknown skills cannot be refunded", () => {
        expect.hasAssertions();
        const save = createSave();
        const before = structuredClone(save);
        expect(refundUpgrade(save, "strength")).toBe(false);
        expect(refundUpgrade(save, "unknown")).toBe(false);
        expect(save).toEqual(before);
    });

    test("an early expensive purchase refunds its paid price after reloading", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 50000;
        buyUpgrade(save, "ring_of_life");
        buyUpgrade(save, "strength");
        buyUpgrade(save, "hitpoints");
        const loaded = migrateSave(JSON.parse(exportSave(save, GAME)));
        expect(refundUpgrade(loaded, "ring_of_life")).toBe(true);
        expect(loaded.coins).toBe(49540);
        expect(loaded.skillPages.melee.upgradesSpent).toBe(460);
        expect(loaded.skillPages.melee.upgrades).toEqual({ strength: 1, hitpoints: 1 });
        expect(loaded.skillPages.melee.upgradeRefunds).toEqual({
            strength: [220],
            hitpoints: [240],
        });
    });

    test("legacy saves allocate their full spending without making other skills free", () => {
        expect.hasAssertions();
        const save = migrateSave({
            ...createSave(),
            skillPages: undefined,
            coins: 39540,
            upgrades: { ring_of_life: 1, strength: 1, hitpoints: 1 },
            upgradesSpent: 10460,
        });
        expect(refundUpgrade(save, "ring_of_life")).toBe(true);
        expect(save.skillPages.melee.upgradesSpent).toBeGreaterThan(0);
        expect(save.coins + save.skillPages.melee.upgradesSpent).toBe(50000);
        buyUpgrade(save, "strength");
        expect(refundUpgrade(save, "strength")).toBe(true);
        expect(refundUpgrade(save, "hitpoints")).toBe(true);
        expect(refundUpgrade(save, "strength")).toBe(true);
        expect(save.coins).toBe(50000);
        expect(save.skillPages.melee.upgradesSpent).toBe(0);
        expect(save.skillPages.melee.upgradeRefunds).toBeUndefined();
    });

    test.each([
        { strength: [NaN] },
        { strength: [-200] },
        { strength: [200, 300] },
        { strength: [10000] },
        {},
    ])("invalid refund records fall back to the legacy balance: %o", (upgradeRefunds) => {
        expect.hasAssertions();
        const save = migrateSave({
            ...createSave(),
            skillPages: undefined,
            upgrades: { strength: 1 },
            upgradesSpent: 200,
            upgradeRefunds,
        });
        expect(refundUpgrade(save, "strength")).toBe(true);
        expect(save.coins).toBe(200);
        expect(save.skillPages.melee.upgradesSpent).toBe(0);
    });

    test("out-of-order refunds and repurchases never create coins", () => {
        expect.hasAssertions();
        const save = createSave();
        save.coins = 50000;
        buyUpgrade(save, "ring_of_life");
        buyUpgrade(save, "strength");
        buyUpgrade(save, "hitpoints");
        for (let attempt = 0; attempt < 3; attempt++) {
            expect(refundUpgrade(save, "ring_of_life")).toBe(true);
            expect(save.skillPages.melee.upgradesSpent).toBeGreaterThanOrEqual(0);
            expect(save.coins + save.skillPages.melee.upgradesSpent).toBe(50000);
            expect(buyUpgrade(save, "ring_of_life")).toBe(true);
        }
        refundUpgrades(save);
        expect(save.coins).toBe(50000);
        expect(save.skillPages.melee.upgradesSpent).toBe(0);
        expect(save.skillPages.melee.upgradeRefunds).toBeUndefined();
    });

    test("recording runs", () => {
        const save = createSave();
        recordRun(save, run("lumbridge", { coins: 3000 }));
        expect(save.coins).toBe(3000);
        expect(save.bestLevel).toBe(20);
        expect(save.runs).toBe(1);
        expect(save.unlockedCharacters).toEqual(["warrior", "wizard", "ranger"]);
    });

    test("beating a map unlocks the next", () => {
        const save = createSave();
        const won = (mapId: string) =>
            recordRun(save, run(mapId, { victory: true, seconds: 900, level: 40 }));
        expect(isMapUnlocked(save, CAMPAIGN_MAPS[0].id)).toBe(true);
        for (let i = 1; i < CAMPAIGN_MAPS.length; i++) {
            // Each opens when the one before it is beaten, and not before
            for (const later of CAMPAIGN_MAPS.slice(i)) {
                expect(isMapUnlocked(save, later.id)).toBe(false);
            }
            won(CAMPAIGN_MAPS[i - 1].id);
            expect(isMapUnlocked(save, CAMPAIGN_MAPS[i].id)).toBe(true);
        }
        expect(Object.keys(save.mapVictories)).toEqual(CAMPAIGN_MAPS.slice(0, -1).map((m) => m.id));
        expect(save.victories).toBe(CAMPAIGN_MAPS.length - 1);
        expect(isMapUnlocked(save, "nowhere")).toBe(false);
    });

    test("a map won in a co-op run opens, with the one after it", () => {
        const save = createSave();
        const map = MAPS[3];
        expect(isMapUnlocked(save, map.id)).toBe(false);
        recordRun(save, run(map.id, { victory: true, seconds: 900, level: 40 }));
        expect(isMapUnlocked(save, map.id)).toBe(true);
        expect(isMapUnlocked(save, MAPS[4].id)).toBe(true);
        // What came before it stays as it was
        expect(isMapUnlocked(save, MAPS[2].id)).toBe(false);
    });

    test("a seasonal map is open from the start and opens nothing", () => {
        const save = createSave();
        expect(isMapUnlocked(save, "halloween")).toBe(true);
        expect(getMap("halloween").seasonal).toBe(true);
        recordRun(save, run("halloween", { victory: true, seconds: 900, level: 40 }));
        expect(save.mapVictories.halloween).toBe(1);
        expect(isMapUnlocked(save, CAMPAIGN_MAPS[1].id)).toBe(false);
    });

    test("a boss fight opens once its map is beaten, and is never endless", () => {
        const save = createSave();
        expect(getMap("phosani").fight?.requires).toBe("halloween");
        expect(isMapUnlocked(save, "phosani")).toBe(false);
        expect(CAMPAIGN_MAPS.some((map) => map.id === "phosani")).toBe(false);
        recordRun(save, run("halloween", { victory: true, seconds: 900, level: 40 }));
        expect(isMapUnlocked(save, "phosani")).toBe(true);
        expect(isEndlessUnlocked(save, "phosani")).toBe(false);
        expect(isHardUnlocked(save, "phosani")).toBe(false);
        recordRun(save, run("phosani", { victory: true, seconds: 300, level: 20 }));
        expect(save.mapVictories.phosani).toBe(1);
        expect(isEndlessUnlocked(save, "phosani")).toBe(false);
        expect(isHardUnlocked(save, "phosani")).toBe(true);
        // Won in co-op before Hallowed Night was: it stays open
        const guest = createSave();
        recordRun(guest, run("phosani", { victory: true, seconds: 300, level: 20 }));
        expect(isMapUnlocked(guest, "phosani")).toBe(true);
        expect(isMapUnlocked(guest, CAMPAIGN_MAPS[1].id)).toBe(false);
    });

    test("wins from before maps count as Lumbridge wins", () => {
        expect(migrateSave({ version: 1, victories: 2 }).mapVictories).toEqual({ lumbridge: 2 });
        expect(migrateSave({ version: 1, victories: 0 }).mapVictories).toEqual({});
        const save = migrateSave({ victories: 3, mapVictories: { barrows: 1, nowhere: 4 } });
        expect(save.mapVictories).toEqual({ barrows: 1 });
    });

    test("beating a map brings in its adventurer", () => {
        const save = createSave();
        recordRun(save, run("lumbridge", { seconds: 900, bossesKilled: ["wise_old_man"] }));
        // Killing the final boss is what wins, but the run says so
        expect(save.unlockedCharacters).not.toContain("barbarian");
        recordRun(save, run("lumbridge", { victory: true, seconds: 900 }));
        expect(save.unlockedCharacters).toContain("barbarian");
        expect(save.unlockedCharacters).not.toContain("hunter");
        expect(save.unlockedCharacters).not.toContain("dragon_slayer");
    });

    test("tasks count on their own map, in one run", () => {
        const save = createSave();
        recordRun(save, run("barrows", { bossesKilled: ["count_draynor"] }));
        expect(save.unlockedCharacters).not.toContain("monk");
        recordRun(save, run("lumbridge", { bossesKilled: ["count_draynor"] }));
        expect(save.unlockedCharacters).toContain("monk");

        recordRun(save, run("barrows", { bossesKilled: ["torag", "karil", "guthan", "ahrim"] }));
        expect(save.unlockedCharacters).toContain("ancient_mage");

        // Two runs of five minutes aren't ten
        recordRun(save, run("wilderness", { seconds: 300 }));
        recordRun(save, run("wilderness", { seconds: 300 }));
        expect(save.unlockedCharacters).not.toContain("rogue");
        recordRun(save, run("lumbridge", { seconds: 600 }));
        expect(save.unlockedCharacters).not.toContain("rogue");
        recordRun(save, run("wilderness", { seconds: 600 }));
        expect(save.unlockedCharacters).toContain("rogue");
    });

    test("a run's task can be seen before it's recorded", () => {
        const save = createSave();
        const earned = getEarnedUnlocks(
            save,
            run("lumbridge", { bossesKilled: ["count_draynor"] }),
        );
        expect(earned.characters.map((c) => c.id)).toEqual(["monk"]);
        expect(save.unlockedCharacters).not.toContain("monk");
    });

    test("map tasks bring in items, which new saves don't have", () => {
        const save = createSave();
        expect(save.unlockedItems).toEqual([]);
        // Only on its own map
        recordRun(save, run("lumbridge", { bossesKilled: ["ket_zek"] }));
        expect(save.unlockedItems).toEqual([]);
        recordRun(save, run("karamja", { seconds: 460, bossesKilled: ["ket_zek"] }));
        expect([...save.unlockedItems].sort()).toEqual(["obsidian_armour", "toktz_xil_ul"]);
        // The Ancient spells take beating the Desert, not its bosses
        recordRun(save, run("desert", { seconds: 460, bossesKilled: ["fareed", "dessous"] }));
        expect(save.unlockedItems).not.toContain("smoke_burst");
        recordRun(save, run("desert", { victory: true, seconds: 900 }));
        expect(save.unlockedItems).toEqual(
            expect.arrayContaining([
                "osmumtens_fang",
                "smoke_burst",
                "shadow_burst",
                "blood_burst",
            ]),
        );
        expect(save.unlockedCharacters).toContain("nomad");
    });

    test("a run's item tasks can be seen before it's recorded", () => {
        const save = createSave();
        const earned = getEarnedUnlocks(save, run("karamja", { bossesKilled: ["ket_zek"] }));
        expect(earned.items.map((i) => i.id).sort()).toEqual(["obsidian_armour", "toktz_xil_ul"]);
        expect(save.unlockedItems).toEqual([]);
    });

    test("saves keep their items, and get the ones for maps already beaten", () => {
        const save = migrateSave({
            unlockedItems: ["smoke_burst", "nothing", "smoke_burst"],
            mapVictories: { desert: 1 },
        });
        expect([...save.unlockedItems].sort()).toEqual([
            "blood_burst",
            "osmumtens_fang",
            "shadow_burst",
            "smoke_burst",
        ]);
        expect(migrateSave({ version: 2 }).unlockedItems).toEqual([]);
        const old = migrateSave({ version: 2, mapVictories: { varlamore: 1 } });
        expect(old.unlockedItems).toEqual(
            expect.arrayContaining(["dizanas_quiver", "colossal_blade"]),
        );
    });

    test("saves with maps beaten get their adventurers", () => {
        const save = migrateSave({ unlockedCharacters: ["warrior"], mapVictories: { barrows: 1 } });
        expect(save.unlockedCharacters).toContain("hunter");
        expect(save.unlockedCharacters).not.toContain("barbarian");
        expect(migrateSave({ version: 1, victories: 1 }).unlockedCharacters).toContain("barbarian");
    });

    test("exported saves import as they were", () => {
        const save = createSave();
        recordRun(save, run("lumbridge", { victory: true, seconds: 900, coins: 10000 }));
        recordRun(save, run("karamja", { bossesKilled: ["ket_zek"] }));
        expect(buyUpgrade(save, "strength")).toBe(true);
        expect(importSave(exportSave(save, GAME), GAME)).toEqual(save);
        expect([...importSave(exportSave(save, GAME), GAME).unlockedItems].sort()).toEqual([
            "obsidian_armour",
            "toktz_xil_ul",
        ]);
        // Older exports come in migrated
        const old = JSON.stringify({ version: 1, victories: 1 });
        expect(importSave(old, GAME).mapVictories).toEqual({ lumbridge: 1 });
    });

    test("importing something that isn't a save throws", () => {
        expect(() => importSave("not json", GAME)).toThrow();
        expect(() => importSave("null", GAME)).toThrow();
        expect(() => importSave("[]", GAME)).toThrow();
        expect(() => importSave(JSON.stringify({ coins: 1e9 }), GAME)).toThrow();
    });

    test("exports say which game made them, and a newer game's won't import", () => {
        const text = exportSave(createSave(), "0.23.0");
        expect(JSON.parse(text).gameVersion).toBe("0.23.0");
        expect(() => importSave(text, GAME)).toThrow(NewerSaveError);
        expect(importSave(text, "0.23.0")).toEqual(createSave());
        expect(importSave(text, "0.100.0")).toEqual(createSave());
        // A newer format, whatever it says
        const format = JSON.stringify({ ...createSave(), version: SAVE_VERSION + 1 });
        expect(() => importSave(format, GAME)).toThrow(NewerSaveError);
    });

    test("game versions compare by number", () => {
        expect(compareGameVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
        expect(compareGameVersions("0.22.1", "0.22.10")).toBeLessThan(0);
        expect(compareGameVersions("1.0", "1.0.0")).toBe(0);
        expect(compareGameVersions("0.22.1", "0.22.1")).toBe(0);
    });

    test("every adventurer's and item's task can be done", () => {
        // The bosses that come to a map (on its schedule, or a fun map's at
        // random from its pool), and the forms they get back up as
        const bossesOn = (mapId: string) => {
            const map = getMap(mapId);
            const ids = [
                ...map.events
                    .filter((e) => e.kind === "boss" || e.kind === "finalBoss")
                    .map((e) => e.enemyId),
                ...(map.fun?.bosses.pool ?? []),
            ];
            for (const id of ids) {
                const into = getEnemy(id).boss?.rises?.into;
                if (into) {
                    ids.push(into);
                }
            }
            return ids;
        };
        const tasks = [
            ...CHARACTERS.flatMap((c) => c.unlock ?? []),
            ...LOCKABLE_ITEMS.map((i) => i.unlock),
        ];
        for (const task of tasks) {
            if (task.kind === "killBoss") {
                expect(bossesOn(task.mapId)).toContain(task.enemyId);
            } else if (task.kind === "survive") {
                expect(task.seconds).toBeLessThan(RUN_LENGTH);
            } else {
                expect(getMap(task.mapId)).toBeDefined();
            }
        }
    });
});

describe("hard mode", () => {
    const hardWin = (mapId: string) => run(mapId, { hard: true, victory: true, seconds: 900 });

    test("opens on a map once it's been beaten, and on fun maps from the start", () => {
        const save = createSave();
        expect(isHardUnlocked(save, "lumbridge")).toBe(false);
        expect(isHardUnlocked(save, FUN_MAPS[0].id)).toBe(true);
        recordRun(save, run("lumbridge", { victory: true, seconds: 900 }));
        expect(isHardUnlocked(save, "lumbridge")).toBe(true);
        expect(isHardUnlocked(save, "barrows")).toBe(false);
    });

    test("a win counts as a win, and on its own as a hard one", () => {
        const save = createSave();
        recordRun(save, run("lumbridge", { victory: true, seconds: 900 }));
        expect(save.hardVictories.lumbridge).toBeUndefined();
        recordRun(save, hardWin("lumbridge"));
        expect(save.mapVictories.lumbridge).toBe(2);
        expect(save.hardVictories.lumbridge).toBe(1);
        // Losing on hard is no win of either kind
        recordRun(save, run("lumbridge", { hard: true }));
        expect(save.mapVictories.lumbridge).toBe(2);
        expect(save.hardVictories.lumbridge).toBe(1);
    });

    test("endless records are kept apart from normal ones", () => {
        const save = createSave();
        const endless = (hard: boolean, round: number) =>
            run("lumbridge", { endless: true, hard, round, seconds: round * 600 });
        recordRun(save, endless(false, 4));
        expect(isEndlessRecord(save, endless(true, 2))).toBe(true);
        recordRun(save, endless(true, 2));
        expect(save.endlessBest.lumbridge.round).toBe(4);
        expect(save.hardEndlessBest.lumbridge.round).toBe(2);
        expect(isEndlessRecord(save, endless(true, 1))).toBe(false);
    });

    test("survives a round trip, and older saves load without it", () => {
        const save = createSave();
        recordRun(save, hardWin("lumbridge"));
        recordRun(save, run("lumbridge", { endless: true, hard: true, round: 2, seconds: 1500 }));
        const back = importSave(exportSave(save, GAME), GAME);
        expect(back.hardVictories).toEqual({ lumbridge: 1 });
        expect(back.hardEndlessBest).toEqual({ lumbridge: { round: 2, seconds: 1500 } });

        const older = migrateSave({ version: 8, mapVictories: { lumbridge: 3 } });
        expect(older.version).toBe(SAVE_VERSION);
        expect(older.hardVictories).toEqual({});
        expect(older.hardEndlessBest).toEqual({});

        const broken = migrateSave({
            hardVictories: { lumbridge: 2, nowhere: 5, barrows: "lots" },
            hardEndlessBest: { lumbridge: { round: 3, seconds: 900 }, nowhere: { round: 9 } },
        });
        expect(broken.hardVictories).toEqual({ lumbridge: 2 });
        expect(broken.hardEndlessBest).toEqual({ lumbridge: { round: 3, seconds: 900 } });
    });
});

describe("endless", () => {
    test("opens on a map once it's been beaten", () => {
        const save = createSave();
        expect(isEndlessUnlocked(save, "lumbridge")).toBe(false);
        recordRun(save, run("lumbridge", { victory: true, seconds: 900 }));
        expect(isEndlessUnlocked(save, "lumbridge")).toBe(true);
        expect(isEndlessUnlocked(save, "barrows")).toBe(false);
    });

    test("keeps each map's furthest run: the later round, or as far for longer", () => {
        const save = createSave();
        const endless = (round: number, seconds: number) =>
            run("lumbridge", { endless: true, round, seconds });
        recordRun(save, endless(2, 1500));
        expect(save.endlessBest.lumbridge).toEqual({ round: 2, seconds: 1500 });
        // Longer but a round short isn't further
        expect(isEndlessRecord(save, endless(1, 2000))).toBe(false);
        recordRun(save, endless(1, 2000));
        expect(save.endlessBest.lumbridge).toEqual({ round: 2, seconds: 1500 });
        recordRun(save, endless(2, 1600));
        expect(save.endlessBest.lumbridge).toEqual({ round: 2, seconds: 1600 });
        recordRun(save, endless(4, 2600));
        expect(save.endlessBest.lumbridge).toEqual({ round: 4, seconds: 2600 });
        // A normal run is never an endless record, and never wins a map from endless
        recordRun(save, run("barrows", { seconds: 5000 }));
        expect(save.endlessBest.barrows).toBeUndefined();
        expect(save.mapVictories.lumbridge).toBeUndefined();
    });

    test("records survive a round trip and broken ones are dropped", () => {
        const save = createSave();
        recordRun(save, run("lumbridge", { endless: true, round: 3, seconds: 2100 }));
        expect(importSave(exportSave(save, GAME), GAME).endlessBest).toEqual({
            lumbridge: { round: 3, seconds: 2100 },
        });
        const migrated = migrateSave({
            endlessBest: {
                lumbridge: { round: 2, seconds: 1300 },
                nowhere: { round: 9, seconds: 9000 },
                barrows: { round: "lots" },
                wilderness: null,
            },
        });
        expect(migrated.endlessBest).toEqual({ lumbridge: { round: 2, seconds: 1300 } });
        expect(migrateSave({}).endlessBest).toEqual({});
    });
});

describe("the Armoury", () => {
    test("upgrades gear that's been found, a step at a time", () => {
        const save = createSave();
        save.coins = 100000;
        // Not found yet
        expect(buyArmouryUpgrade(save, "amulet_of_strength")).toBe(false);
        recordRun(
            save,
            run("lumbridge", { gearFound: ["amulet_of_strength", "masori_mask_f", "shark", "x"] }),
        );
        // Only gear that comes out of caskets counts
        expect(save.foundGear).toEqual(["amulet_of_strength"]);
        expect(getArmouryStep(save, "amulet_of_strength")).toEqual({
            into: "amulet_of_power",
            cost: ARMOURY_COSTS.uncommon,
            locked: undefined,
        });
        expect(buyArmouryUpgrade(save, "amulet_of_strength")).toBe(true);
        expect(save.coins).toBe(100000 - ARMOURY_COSTS.uncommon);
        expect(save.armoury).toEqual({ amulet_of_strength: 1 });
        expect(getArmouryStep(save, "amulet_of_strength")?.into).toBe("amulet_of_torture");
        expect(buyArmouryUpgrade(save, "amulet_of_strength")).toBe(true);
        expect(buyArmouryUpgrade(save, "amulet_of_strength")).toBe(true);
        // Fully upgraded: an Amulet of torture (or)
        expect(getArmouryStep(save, "amulet_of_strength")).toBeUndefined();
        expect(buyArmouryUpgrade(save, "amulet_of_strength")).toBe(false);
        expect(save.armoury).toEqual({ amulet_of_strength: 3 });
        // Finding it again changes nothing
        recordRun(save, run("lumbridge", { gearFound: ["amulet_of_strength"] }));
        expect(save.foundGear).toEqual(["amulet_of_strength"]);
    });

    test("needs the coins", () => {
        const save = createSave();
        recordRun(save, run("lumbridge", { gearFound: ["coif"] }));
        save.coins = ARMOURY_COSTS.rare - 1;
        expect(buyArmouryUpgrade(save, "coif")).toBe(false);
        save.coins++;
        expect(buyArmouryUpgrade(save, "coif")).toBe(true);
        expect(save.coins).toBe(0);
    });

    test("an upgrade into a piece still locked waits for its task", () => {
        const save = createSave();
        save.coins = 100000;
        recordRun(save, run("lumbridge", { gearFound: ["antidragon_shield"] }));
        expect(getArmouryStep(save, "antidragon_shield")).toEqual({
            into: "dragonfire_shield",
            cost: ARMOURY_COSTS.veryRare,
            locked: { kind: "killBoss", mapId: "karamja", enemyId: "elvarg" },
        });
        expect(buyArmouryUpgrade(save, "antidragon_shield")).toBe(false);
        recordRun(save, run("karamja", { bossesKilled: ["elvarg"] }));
        expect(getArmouryStep(save, "antidragon_shield")?.locked).toBeUndefined();
        expect(buyArmouryUpgrade(save, "antidragon_shield")).toBe(true);
    });

    test("saves keep their gear and upgrades, and broken ones are dropped", () => {
        const save = createSave();
        save.coins = 100000;
        recordRun(save, run("lumbridge", { gearFound: ["coif", "rune_boots"] }));
        buyArmouryUpgrade(save, "coif");
        const imported = importSave(exportSave(save, GAME), GAME);
        expect(imported.foundGear).toEqual(["coif", "rune_boots"]);
        expect(imported.armoury).toEqual({ coif: 1 });
        const migrated = migrateSave({
            foundGear: ["coif", "coif", "masori_mask_f", "shark", 5],
            armoury: { coif: 9, masori_mask_f: 1, nobody: 2, rune_boots: -1, amulet_of_avarice: 1 },
        });
        expect(migrated.foundGear).toEqual(["coif"]);
        // The Coif's line is two upgrades long
        expect(migrated.armoury).toEqual({ coif: 2 });
        expect(migrateSave({ version: 4, coins: 5 }).foundGear).toEqual([]);
    });
});

describe("evolutions made", () => {
    test("runs add to them once each, and they survive a save", () => {
        const save = createSave();
        const run = {
            mapId: "lumbridge",
            victory: false,
            seconds: 60,
            level: 2,
            kills: 1,
            coins: 0,
            bossesKilled: [],
            evolutionsMade: ["abyssal_whip"],
        };
        recordRun(save, run);
        recordRun(save, run);
        expect(save.evolutionsMade).toEqual(["abyssal_whip"]);
        expect(migrateSave(JSON.parse(JSON.stringify(save))).evolutionsMade).toEqual([
            "abyssal_whip",
        ]);
    });

    test("older saves start with none, and unknown ids are dropped", () => {
        const { evolutionsMade: _, ...old } = createSave();
        expect(migrateSave({ ...old, version: 6 }).evolutionsMade).toEqual([]);
        expect(
            migrateSave({ ...old, evolutionsMade: ["abyssal_whip", "no_such_weapon"] })
                .evolutionsMade,
        ).toEqual(["abyssal_whip"]);
    });
});

describe("quests", () => {
    test("count kills over runs, and pay out once when finished", () => {
        const save = createSave();
        const quest = QUEST_BY_ID.get("goblin_diplomacy")!;
        const { count } = quest.objective as { count: number };
        expect(
            recordRun(save, run("lumbridge", { coins: 10, enemyKills: { goblin: count - 1 } })),
        ).toEqual([]);
        expect(getQuestProgress(save, quest)).toEqual({ done: count - 1, of: count });
        expect(save.coins).toBe(10);
        // Seen before the run that finishes it is recorded (mid-run)
        const finishing = run("lumbridge", { enemyKills: { goblin: 5 } });
        expect(getFinishedQuests(save, finishing)).toEqual([quest]);
        expect(recordRun(save, finishing)).toEqual([quest]);
        expect(save.questsDone).toEqual([quest.id]);
        expect(save.coins).toBe(10 + quest.coins);
        expect(save.totalCoins).toBe(10 + quest.coins);
        expect(getQuestProgress(save, quest)).toEqual({ done: count, of: count });
        // Never twice
        expect(recordRun(save, run("lumbridge", { enemyKills: { goblin: count } }))).toEqual([]);
        expect(save.coins).toBe(10 + quest.coins);
    });

    test("kills of any of a quest's enemies count, wherever they are", () => {
        const save = createSave();
        const quest = QUEST_BY_ID.get("ratcatchers")!;
        const { count } = quest.objective as { count: number };
        recordRun(save, run("lumbridge", { enemyKills: { rat: count / 2, goblin: 50 } }));
        recordRun(save, run("barrows", { enemyKills: { crypt_rat: count / 2 - 1 } }));
        expect(getQuestProgress(save, quest)).toEqual({ done: count - 1, of: count });
        expect(recordRun(save, run("barrows", { enemyKills: { giant_crypt_rat: 1 } }))).toEqual([
            quest,
        ]);
    });

    test("some need each of their bosses killed", () => {
        const save = createSave();
        const quest = QUEST_BY_ID.get("desert_treasure")!;
        recordRun(save, run("desert", { enemyKills: { fareed: 1, dessous: 1 } }));
        // Damis's first form doesn't count; he rises again
        recordRun(save, run("desert", { enemyKills: { fareed: 1, damis: 1 } }));
        expect(getQuestProgress(save, quest)).toEqual({ done: 2, of: 3 });
        expect(recordRun(save, run("desert", { enemyKills: { damis_risen: 1 } }))).toEqual([quest]);
    });

    test("nothing on the fun maps counts towards quests", () => {
        const save = createSave();
        const quest = QUEST_BY_ID.get("ratcatchers")!;
        const { count } = quest.objective as { count: number };
        const fun = run("grand_exchange", { enemyKills: { rat: count }, caskets: 50 });
        expect(getQuestProgress(save, quest, fun)).toEqual({ done: 0, of: count });
        expect(getFinishedQuests(save, fun)).toEqual([]);
        expect(recordRun(save, fun)).toEqual([]);
        expect(save.enemyKills).toEqual({});
        expect(save.casketsOpened).toBe(0);
    });

    test("some need their map beaten, not just played", () => {
        const save = createSave();
        const quest = QUEST_BY_ID.get("the_inferno")!;
        expect(describeQuest(quest.objective)).toBe("Beat The Inferno");
        expect(recordRun(save, run("inferno", { seconds: 600 }))).toEqual([]);
        expect(getQuestProgress(save, quest)).toEqual({ done: 0, of: 1 });
        expect(recordRun(save, run("inferno", { victory: true }))).toEqual([quest]);
    });

    test("caskets opened count", () => {
        const save = createSave();
        const quest = QUEST_BY_ID.get("pirates_treasure")!;
        const { count } = quest.objective as { count: number };
        recordRun(save, run("lumbridge", { caskets: count - 2 }));
        expect(getQuestProgress(save, quest)).toEqual({ done: count - 2, of: count });
        expect(recordRun(save, run("barrows", { caskets: 2 }))).toEqual([quest]);
    });

    test("every quest can be done, and says what it wants", () => {
        expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
        for (const quest of QUESTS) {
            expect(quest.coins).toBeGreaterThan(0);
            if (quest.mapId) {
                getMap(quest.mapId);
            }
            const objective = quest.objective;
            if (objective.kind === "beatMap") {
                getMap(objective.mapId);
            } else if (objective.kind !== "caskets") {
                for (const id of objective.enemyIds) {
                    getEnemy(id);
                }
                // More than one needs a name for them ("chickens")
                if (objective.kind === "kill" && objective.count > 1) {
                    expect(objective.what).toBeDefined();
                }
            }
            expect(describeQuest(objective)).not.toMatch(/undefined/);
        }
        expect(describeQuest(QUEST_BY_ID.get("vampyre_slayer")!.objective)).toBe(
            "Kill Count Draynor",
        );
        expect(describeQuest(QUEST_BY_ID.get("desert_treasure")!.objective)).toBe(
            "Kill Fareed, Dessous and Damis",
        );
    });

    test("saves keep their tallies and quests, and broken ones are dropped", () => {
        const save = createSave();
        recordRun(
            save,
            run("lumbridge", { enemyKills: { count_draynor: 1, goblin: 7 }, caskets: 3 }),
        );
        const imported = importSave(exportSave(save, GAME), GAME);
        expect(imported.enemyKills).toEqual({ count_draynor: 1, goblin: 7 });
        expect(imported.casketsOpened).toBe(3);
        expect(imported.questsDone).toEqual(["vampyre_slayer"]);
        const migrated = migrateSave({
            enemyKills: { goblin: 4.5, nobody: 3, rat: -2, imp: "lots" },
            casketsOpened: -4,
            questsDone: ["imp_catcher", "imp_catcher", "nothing", 3],
        });
        expect(migrated.enemyKills).toEqual({ goblin: 4 });
        expect(migrated.casketsOpened).toBe(0);
        expect(migrated.questsDone).toEqual(["imp_catcher"]);
        expect(migrateSave({ version: 5, coins: 5 }).questsDone).toEqual([]);
    });
});

// localStorage, as far as the save store uses it
function stubStorage(): Map<string, string> {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
        localStorage: {
            get length() {
                return stored.size;
            },
            key: (i: number) => [...stored.keys()][i] ?? null,
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => void stored.set(key, value),
            removeItem: (key: string) => void stored.delete(key),
        },
    });
    return stored;
}

describe("the save in the browser", () => {
    const KEY = "rune-survivors-save";

    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    test("starts afresh with nothing saved", () => {
        stubStorage();
        expect(new LocalSaveStore(GAME).load()).toEqual({ save: createSave() });
    });

    test("is marked with the game that saved it", () => {
        const stored = stubStorage();
        const store = new LocalSaveStore(GAME);
        const save = createSave();
        save.coins = 500;
        store.save(save);
        expect(JSON.parse(stored.get(KEY)!).gameVersion).toBe(GAME);
        expect(store.load()).toEqual({ save });
        // Saves from older games, and from before they were marked, load as
        // they always have
        stored.set(KEY, JSON.stringify({ ...save, gameVersion: "0.9.0" }));
        expect(store.load()).toEqual({ save });
        stored.set(KEY, JSON.stringify({ ...save, gameVersion: undefined }));
        expect(store.load()).toEqual({ save });
    });

    test("one from a newer game is played, but never written over", () => {
        const stored = stubStorage();
        const store = new LocalSaveStore(GAME);
        const newer = { ...createSave(), coins: 70, gameVersion: "0.23.0" };
        newer.mapVictories = { lumbridge: 1, some_future_map: 3 };
        stored.set(KEY, JSON.stringify(newer));
        const loaded = store.load();
        expect(loaded.newer).toEqual({ gameVersion: "0.23.0" });
        expect(loaded.save.coins).toBe(70);
        // It doesn't know the future map...
        expect(loaded.save.mapVictories).toEqual({ lumbridge: 1 });
        // ...but doesn't take it away
        store.save(loaded.save);
        expect(JSON.parse(stored.get(KEY)!).mapVictories.some_future_map).toBe(3);
        // What's stored can be had as it is, and written over once the player says so
        expect(store.read()).toBe(JSON.stringify(newer));
        store.writeOver();
        store.save(loaded.save);
        expect(JSON.parse(stored.get(KEY)!)).toMatchObject({ coins: 70, gameVersion: GAME });
        expect(JSON.parse(stored.get(KEY)!).mapVictories.some_future_map).toBeUndefined();
        // A newer format, whatever it says
        stored.set(KEY, JSON.stringify({ ...createSave(), version: SAVE_VERSION + 1 }));
        expect(store.load().newer).toEqual({ format: true });
        // Updated, it saves again
        const updated = new LocalSaveStore("0.23.0");
        stored.set(KEY, JSON.stringify(newer));
        updated.save(updated.load().save);
        expect(JSON.parse(stored.get(KEY)!).gameVersion).toBe("0.23.0");
    });

    test("JSON that isn't a save is kept too, rather than migrated into a fresh one", () => {
        const stored = stubStorage();
        const store = new LocalSaveStore(GAME);
        stored.set(KEY, '{"x":1}');
        const loaded = store.load();
        expect(loaded.save).toEqual(createSave());
        expect(loaded.unreadable).toMatch(/^rune-survivors-save-unreadable-\d+$/);
        expect(store.readUnreadable(loaded.unreadable!)).toBe('{"x":1}');
    });

    test("one that can't be read is kept before a fresh one goes in its place", () => {
        const stored = stubStorage();
        const store = new LocalSaveStore(GAME);
        store.save({ ...createSave(), coins: 500 });
        // Cut off partway through
        const broken = stored.get(KEY)!.slice(0, -5);
        stored.set(KEY, broken);
        const loaded = store.load();
        expect(loaded.save).toEqual(createSave());
        expect(loaded.unreadable).toMatch(/^rune-survivors-save-unreadable-\d+$/);
        const key = loaded.unreadable!;
        expect(store.readUnreadable(key)).toBe(broken);
        expect(store.getUnreadable()).toEqual([{ key, time: expect.any(Number) }]);
        // Loading it again (the tab getting the save back) keeps it once
        expect(store.load().unreadable).toBe(key);
        expect(store.getUnreadable()).toHaveLength(1);
        store.save(loaded.save);
        expect(store.load()).toEqual({ save: createSave() });
        expect(store.readUnreadable(key)).toBe(broken);
        // Not a save at all counts too
        stored.set(KEY, "null");
        expect(store.load().unreadable).toMatch(/^rune-survivors-save-unreadable-/);
    });

    test("keeps the last two that couldn't be read, newest first", () => {
        const stored = stubStorage();
        const store = new LocalSaveStore(GAME);
        vi.useFakeTimers();
        const keys = ["{", "{{", "{{{"].map((text, i) => {
            vi.setSystemTime(1000 * (i + 1));
            stored.set(KEY, text);
            return store.load().unreadable;
        });
        expect(store.getUnreadable()).toEqual([
            { key: keys[2], time: 3000 },
            { key: keys[1], time: 2000 },
        ]);
        expect(store.readUnreadable(keys[0]!)).toBeUndefined();
    });

    test("one that can't be read isn't written over when there's no room for a copy", () => {
        const stored = new Map([[KEY, "{"]]);
        vi.stubGlobal("window", {
            localStorage: {
                length: 0,
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: () => {
                    throw new Error("QuotaExceededError");
                },
            },
        });
        const store = new LocalSaveStore(GAME);
        const loaded = store.load();
        expect(loaded).toEqual({ save: createSave(), unreadable: KEY, noRoom: true });
        store.save(loaded.save);
        expect(stored.get(KEY)).toBe("{");
        expect(store.readUnreadable(KEY)).toBe("{");
        expect(store.read()).toBe("{");
    });

    test("deleting one that couldn't be read leaves the save alone", () => {
        const stored = stubStorage();
        const store = new LocalSaveStore(GAME);
        stored.set(KEY, "{");
        const key = store.load().unreadable!;
        store.deleteUnreadable(KEY);
        expect(stored.get(KEY)).toBe("{");
        store.deleteUnreadable(key);
        expect(store.getUnreadable()).toEqual([]);
    });
});
