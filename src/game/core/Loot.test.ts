import {
    ARMOURY_COSTS,
    getArmouryCost,
    getNextUpgrade,
    getUpgradeLine,
    getUpgradedGear,
} from "../content/armoury";
import { getGearStats } from "../content/endless";
import {
    CASKET_GEAR,
    CASKET_TIERS,
    GEAR,
    ITEMS,
    UTILITY,
    VARIANT_BONUS,
    getGear,
    getItem,
} from "../content/items";
import { MAPS, hasPoison } from "../content/maps";
import { RARITY_ORDER, Rarity } from "../content/rarity";
import { SETS, getSetPieces } from "../content/sets";
import { CasketTier, GearSlot } from "../content/types";
import {
    SET_PIECE_CHANCE,
    describeItem,
    findInventorySlot,
    getAlchValue,
    getStartedSet,
    isBetterGear,
    rollBossCasketTier,
    rollCasketItem,
    rollCasketTier,
    setChange,
    shouldWear,
} from "./Loot";
import { Rng } from "./Rng";

function countRarities(tier: CasketTier, rolls: number): Record<Rarity, number> {
    const rng = new Rng(11);
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, veryRare: 0 };
    for (let i = 0; i < rolls; i++) {
        counts[getItem(rollCasketItem(rng, tier, 0, {}, false)).rarity]++;
    }
    return counts;
}

describe("items", () => {
    test("ids are unique and every rarity has something", () => {
        expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
        for (const rarity of RARITY_ORDER) {
            expect(UTILITY.some((i) => i.rarity === rarity)).toBe(true);
            expect(GEAR.some((i) => i.rarity === rarity)).toBe(true);
        }
    });

    test("every piece of gear adds something", () => {
        for (const item of GEAR) {
            expect(Object.values(item.stats).some((v) => v !== 0)).toBe(true);
        }
    });
});

describe("caskets", () => {
    test("better tiers give rarer items", () => {
        const easy = countRarities("easy", 5000);
        const elite = countRarities("elite", 5000);
        expect(elite.veryRare).toBeGreaterThan(easy.veryRare);
        expect(elite.rare).toBeGreaterThan(easy.rare);
        expect(easy.common).toBeGreaterThan(elite.common);
        // Easy caskets never have very rare items
        expect(easy.veryRare).toBe(0);
    });

    test("master caskets are the best", () => {
        const elite = countRarities("elite", 5000);
        const master = countRarities("master", 5000);
        expect(master.veryRare).toBeGreaterThan(elite.veryRare);
        expect(master.common).toBe(0);
    });

    test("bosses drop elite caskets, now and then a master one", () => {
        const rng = new Rng(3);
        const counts = new Map<string, number>();
        for (let i = 0; i < 2000; i++) {
            const tier = rollBossCasketTier(rng, 0);
            counts.set(tier, (counts.get(tier) ?? 0) + 1);
        }
        expect([...counts.keys()].sort()).toEqual(["elite", "master"]);
        expect(counts.get("master")!).toBeLessThan(counts.get("elite")! / 4);
        // However lucky, nothing else drops a master casket
        for (let i = 0; i < 500; i++) {
            expect(rollCasketTier(rng, 800, true, 5)).not.toBe("master");
        }
    });

    test("elites drop better caskets as the run goes on", () => {
        const rng = new Rng(1);
        const tierAt = (seconds: number, elite: boolean) =>
            CASKET_TIERS.indexOf(rollCasketTier(rng, seconds, elite, 0));
        expect(tierAt(120, true)).toBeLessThan(tierAt(700, true));
        expect(tierAt(120, false)).toBeLessThan(tierAt(120, true));
    });

    test("never offers the piece already worn", () => {
        const gear: Partial<Record<GearSlot, string>> = {};
        for (const item of CASKET_GEAR) {
            gear[item.slot] = item.id;
        }
        const worn = new Set(Object.values(gear));
        const rng = new Rng(4);
        for (let i = 0; i < 2000; i++) {
            const tier = CASKET_TIERS[i % CASKET_TIERS.length];
            expect(worn.has(rollCasketItem(rng, tier, 0.5, gear, true))).toBe(false);
        }
    });

    test("antipoisons only turn up where something poisons", () => {
        expect(MAPS.filter(hasPoison).map((m) => m.id)).toEqual([
            "wilderness",
            "desert",
            "fremennik",
            "kourend",
            "god_wars",
            "prifddinas",
            "halloween",
        ]);
        const cures = new Set(UTILITY.filter((i) => i.use.kind === "cure").map((i) => i.id));
        const rolled = (poison: boolean) => {
            const rng = new Rng(5);
            const ids = new Set<string>();
            for (let i = 0; i < 3000; i++) {
                ids.add(rollCasketItem(rng, CASKET_TIERS[i % 2], 0, {}, poison));
            }
            return [...ids].filter((id) => cures.has(id));
        };
        expect(rolled(false)).toEqual([]);
        expect(rolled(true).sort()).toEqual([...cures].sort());
    });

    test("a Prayer cape (an extra revive) only turns up in co-op", () => {
        const rng = new Rng(7);
        const rolled = (party: boolean) => {
            let times = 0;
            for (let i = 0; i < 3000; i++) {
                const found = rollCasketItem(
                    rng,
                    "master",
                    0,
                    {},
                    false,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    party,
                );
                if (found === "prayer_cape") {
                    times++;
                }
            }
            return times;
        };
        expect(rolled(false)).toBe(0);
        const times = rolled(true);
        expect(times).toBeGreaterThan(0);
        expect(times).toBeLessThan(300);
    });

    test("locked items never drop, and do once unlocked", () => {
        const rng = new Rng(5);
        const shields = (unlocked: ReadonlySet<string>) => {
            let found = 0;
            for (let i = 0; i < 3000; i++) {
                if (
                    rollCasketItem(rng, "master", 0, {}, false, undefined, unlocked) ===
                    "dragonfire_shield"
                ) {
                    found++;
                }
            }
            return found;
        };
        expect(shields(new Set())).toBe(0);
        expect(shields(new Set(["dragonfire_shield"]))).toBeGreaterThan(0);
    });

    test("utility items stack, then fill empty slots", () => {
        const inventory = [
            { itemId: "shark", count: 2 },
            null,
            { itemId: "bonecrusher", count: 1 },
        ];
        expect(findInventorySlot(inventory, "bonecrusher")).toBe(2);
        expect(findInventorySlot(inventory, "overload")).toBe(1);
        expect(findInventorySlot([{ itemId: "shark", count: 1 }], "overload")).toBe(-1);
    });
});

describe("upgraded gear", () => {
    test("upgrades add half the stats again, but leave capped stats be", () => {
        const helmet = GEAR.find((g) => g.id === "armadyl_helmet")!;
        expect(getGearStats(helmet, 0)).toBe(helmet.stats);
        const upgraded = getGearStats(helmet, 2);
        expect(upgraded.might).toBeCloseTo(helmet.stats.might! * 2);
        expect(upgraded.speed).toBeCloseTo(helmet.stats.speed! * 2);
        // Movement speed is capped
        expect(upgraded.moveSpeed).toBe(helmet.stats.moveSpeed);
        expect(describeItem(helmet, 2)).toContain("+10% damage");
        expect(getAlchValue(helmet, 0, 2)).toBe(getAlchValue(helmet, 0) * 2);
    });

    test("more upgrades can beat a rarer piece", () => {
        const common = getItem("rune_full_helm");
        const veryRare = getItem("slayer_helmet");
        expect(isBetterGear(veryRare, 0, common, 0)).toBe(true);
        expect(isBetterGear(common, 0, veryRare, 0)).toBe(false);
        expect(isBetterGear(common, 4, veryRare, 0)).toBe(false);
        expect(isBetterGear(common, 6, veryRare, 0)).toBe(true);
        expect(isBetterGear(common, 1, common, 0)).toBe(true);
    });

    test("the piece worn turns up again only when it'd come more upgraded", () => {
        // Everything but the head slot is out of the running
        const helmets = GEAR.filter((g) => g.slot === "head");
        const gear: Partial<Record<GearSlot, string>> = { head: "slayer_helmet" };
        const rolled = (offered: number, worn: number) => {
            const rng = new Rng(9);
            const seen = new Set<string>();
            for (let i = 0; i < 3000; i++) {
                const id = rollCasketItem(rng, "master", 0, gear, false, undefined, undefined, {
                    offered,
                    worn: { head: worn },
                });
                if (helmets.some((h) => h.id === id)) {
                    seen.add(id);
                }
            }
            return seen;
        };
        expect(rolled(0, 0).has("slayer_helmet")).toBe(false);
        expect(rolled(2, 2).has("slayer_helmet")).toBe(false);
        expect(rolled(3, 2).has("slayer_helmet")).toBe(true);
    });
});

describe("the Armoury", () => {
    const variants = GEAR.filter((g) => g.variantOf);

    test("every line goes up, in one slot, ending in its piece's variants", () => {
        const sameRarity: string[] = [];
        for (const piece of GEAR) {
            const into = getNextUpgrade(piece.id);
            if (into === undefined) {
                continue;
            }
            const next = getGear(into);
            expect(next.slot).toBe(piece.slot);
            expect(RARITY_ORDER.indexOf(next.rarity)).toBeGreaterThanOrEqual(
                RARITY_ORDER.indexOf(piece.rarity),
            );
            // A variant is only ever made from its own piece
            if (next.variantOf) {
                expect(next.variantOf).toBe(piece.id);
            }
            if (next.rarity === piece.rarity && !next.variantOf) {
                sameRarity.push(`${piece.id} > ${into}`);
            }
        }
        // A piece only leads to another of its rarity through a variant, or a
        // real OSRS upgrade
        expect(sameRarity.sort()).toEqual([
            "dragon_defender > avernic_defender",
            "fire_cape > infernal_cape",
        ]);
        for (const variant of variants) {
            expect(getNextUpgrade(variant.variantOf!)).toBe(variant.id);
        }
        // Almost every piece can be upgraded, or is the best of its line
        const stuck = CASKET_GEAR.filter(
            (g) =>
                getNextUpgrade(g.id) === undefined &&
                // (a variant can lead on to more: Berserker ring (i) to the
                // Ultor ring)
                !GEAR.some((other) => getNextUpgrade(other.id) === g.id),
        );
        // (and the Inquisitor's armour, which has no ornament kit, and the
        // pieces with nothing in OSRS to come from or become)
        expect(stuck.map((g) => g.id).sort()).toEqual([
            "amulet_of_avarice",
            "bellator_ring",
            "ferocious_gloves",
            "inquisitors_great_helm",
            "inquisitors_hauberk",
            "inquisitors_plateskirt",
            "lightbearer",
            "neitiznot_faceguard",
            "regen_bracelet",
            "ring_of_dueling",
            "twisted_buckler",
            "zaryte_vambraces",
        ]);
    });

    test("variants have more of every stat, and never come out of caskets", () => {
        for (const variant of variants) {
            const piece = getGear(variant.variantOf!);
            expect(variant.rarity).toBe(piece.rarity);
            expect(Object.keys(variant.stats)).toEqual(Object.keys(piece.stats));
            for (const [key, value] of Object.entries(piece.stats)) {
                expect(variant.stats[key as keyof typeof piece.stats]).toBeCloseTo(
                    value * (1 + VARIANT_BONUS),
                );
            }
            expect(isBetterGear(variant, 0, piece, 0)).toBe(true);
            expect(getAlchValue(variant, 0)).toBeGreaterThan(getAlchValue(piece, 0));
        }
        // A variant of a variant has more again
        expect(getGear("ardougne_cloak_4").stats.luck).toBeCloseTo(0.1 * 1.25 ** 3);
        const ids = new Set(variants.map((v) => v.id));
        const rng = new Rng(6);
        for (let i = 0; i < 4000; i++) {
            const tier = CASKET_TIERS[i % CASKET_TIERS.length];
            expect(ids.has(rollCasketItem(rng, tier, 0, {}, true))).toBe(false);
        }
    });

    test("pieces come out as they've been upgraded, up to the end of their line", () => {
        expect(getUpgradeLine("amulet_of_strength")).toEqual([
            "amulet_of_strength",
            "amulet_of_power",
            "amulet_of_torture",
            "amulet_of_torture_or",
        ]);
        expect(getUpgradedGear("amulet_of_strength", undefined)).toBe("amulet_of_strength");
        expect(getUpgradedGear("amulet_of_strength", { amulet_of_strength: 2 })).toBe(
            "amulet_of_torture",
        );
        expect(getUpgradedGear("amulet_of_strength", { amulet_of_strength: 9 })).toBe(
            "amulet_of_torture_or",
        );
        // Each piece has its own upgrades
        expect(getUpgradedGear("amulet_of_power", { amulet_of_strength: 2 })).toBe(
            "amulet_of_power",
        );
        expect(getUpgradedGear("shark", { shark: 1 })).toBe("shark");
        expect(getArmouryCost("amulet_of_torture")).toBe(ARMOURY_COSTS.veryRare);
    });

    test("caskets weigh gear as what it's been upgraded into", () => {
        // Wearing a torture: an Amulet of strength upgraded into one is the
        // piece worn, so it doesn't turn up
        const gear: Partial<Record<GearSlot, string>> = { neck: "amulet_of_torture" };
        const strengths = (armoury?: Record<string, number>) => {
            const rng = new Rng(8);
            let found = 0;
            for (let i = 0; i < 4000; i++) {
                const id = rollCasketItem(
                    rng,
                    "easy",
                    0,
                    gear,
                    false,
                    undefined,
                    undefined,
                    {
                        offered: 0,
                        worn: {},
                    },
                    armoury,
                );
                if (id === "amulet_of_strength") {
                    found++;
                }
            }
            return found;
        };
        expect(strengths()).toBeGreaterThan(0);
        expect(strengths({ amulet_of_strength: 2 })).toBe(0);
        // Upgraded past it, it's better than the one worn
        expect(strengths({ amulet_of_strength: 3 })).toBeGreaterThan(strengths());
    });
});

describe("sets", () => {
    test("every set takes fewer pieces than it has, each in its own slot", () => {
        for (const set of SETS) {
            const pieces = getSetPieces(set.id);
            expect(set.needed).toBeLessThan(pieces.length);
            expect(new Set(pieces.map((p) => p.slot)).size).toBe(pieces.length);
            // The Armoury's upgrades of a piece stay in its set
            for (const piece of pieces) {
                for (const id of getUpgradeLine(piece.id)) {
                    expect(getGear(id).set).toBe(set.id);
                }
            }
        }
        for (const item of GEAR) {
            if (item.set !== undefined) {
                expect(SETS.some((set) => set.id === item.set)).toBe(true);
            }
        }
    });

    // How many of rolls of a tier's casket are pieces of a set, for a player
    // wearing this
    function setPieces(
        setId: string,
        tier: CasketTier,
        gear: Partial<Record<GearSlot, string>>,
        rolls = 3000,
    ): number {
        const rng = new Rng(5);
        let count = 0;
        for (let i = 0; i < rolls; i++) {
            const item = getItem(rollCasketItem(rng, tier, 0, gear, false));
            if (item.kind === "gear" && item.set === setId) {
                expect(Object.values(gear)).not.toContain(item.id);
                count++;
            }
        }
        return count / rolls;
    }

    test("once a piece is worn, caskets often bring the set's other pieces", () => {
        const without = setPieces("void_knight", "medium", {});
        const started = setPieces("void_knight", "medium", { head: "void_melee_helm" });
        expect(without).toBeLessThan(0.08);
        // A little under the chance, as the casket's rare and very rare rolls
        // stay rare and very rare
        expect(started).toBeGreaterThan(SET_PIECE_CHANCE * 0.8);
        // Not once the bonus is on
        const done = setPieces("void_knight", "medium", {
            head: "void_melee_helm",
            body: "void_knight_top",
            legs: "elite_void_robe",
        });
        expect(done).toBeLessThan(0.08);
        // Never a piece rarer than the casket could hold
        expect(setPieces("torva", "easy", { head: "torva_full_helm" })).toBe(0);
    });

    test("a set's missing piece is at most a rarity above the casket's roll", () => {
        const worn = { head: "torva_full_helm" };
        // Torva is very rare, so it takes a rare or very rare roll
        const medium = setPieces("torva", "medium", worn);
        expect(medium).toBeGreaterThan(0.015);
        expect(medium).toBeLessThan(0.05);
        const elite = setPieces("torva", "elite", worn);
        expect(elite).toBeGreaterThan(0.08);
        expect(elite).toBeLessThan(SET_PIECE_CHANCE);
    });

    test("a set the player has turned down stops being brought", () => {
        const worn = { head: "torva_full_helm" };
        const rng = new Rng(7);
        let count = 0;
        for (let i = 0; i < 3000; i++) {
            const id = rollCasketItem(
                rng,
                "elite",
                0,
                worn,
                false,
                undefined,
                undefined,
                undefined,
                undefined,
                new Set(["torva"]),
            );
            if (getStartedSet(worn, getItem(id))) {
                count++;
            }
        }
        expect(count / 3000).toBeLessThan(0.03);
    });

    test("a set piece never takes the place of a rarer item", () => {
        // How many of a master casket's rolls are uncommon, for a player
        // wearing this
        const uncommon = (gear: Partial<Record<GearSlot, string>>) => {
            const rng = new Rng(9);
            let count = 0;
            for (let i = 0; i < 3000; i++) {
                if (getItem(rollCasketItem(rng, "master", 0, gear, false)).rarity === "uncommon") {
                    count++;
                }
            }
            return count / 3000;
        };
        // The Void knight's pieces are uncommon: a started set doesn't turn
        // the master casket's rare and very rare rolls into them
        const without = uncommon({});
        expect(uncommon({ head: "void_melee_helm" })).toBeLessThan(without + 0.03);
        // Though they still come when the roll is uncommon
        expect(setPieces("void_knight", "master", { head: "void_melee_helm" })).toBeGreaterThan(0);
    });

    test("a set piece goes on when it brings the bonus closer, but not to break one", () => {
        const piece = (id: string) => getItem(id);
        // A better helm, but the Void knight's would make two of three
        const started = { body: "void_knight_top", head: "slayer_helmet" };
        expect(setChange(started, piece("void_melee_helm"))).toBe(1);
        expect(shouldWear(started, {}, piece("void_melee_helm"), 0)).toBe(true);
        // The bonus is on: a better helm would take it off
        const done = { ...started, head: "void_melee_helm", legs: "void_knight_robe" };
        expect(setChange(done, piece("slayer_helmet"))).toBe(-1);
        expect(shouldWear(done, {}, piece("slayer_helmet"), 0)).toBe(false);
        // Nothing to do with sets: the better piece
        expect(shouldWear({ feet: "rune_boots" }, {}, piece("dragon_boots"), 0)).toBe(true);
        expect(shouldWear({ feet: "dragon_boots" }, {}, piece("rune_boots"), 0)).toBe(false);
        // A set no piece of which is worn yet is no reason to swap
        expect(shouldWear({ head: "slayer_helmet" }, {}, piece("void_melee_helm"), 0)).toBe(false);
    });
});
