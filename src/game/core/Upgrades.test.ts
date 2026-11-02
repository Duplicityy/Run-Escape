import { EVOLUTIONS } from "../content/evolutions";
import { PASSIVES, canLevelPassive, getPassive, getPassiveGain } from "../content/passives";
import { RARITIES, RARITY_ORDER, Rarity, rollRarity } from "../content/rarity";
import { CombatStyle } from "../content/types";
import { WEAPONS, getWeapon } from "../content/weapons";
import { Rng } from "./Rng";
import {
    MAX_PASSIVES,
    MAX_WEAPONS,
    UpgradeChoice,
    describeChoice,
    getEvolutionHint,
    hiltChoices,
    rollChoices,
} from "./Upgrades";
import { PassiveState, WeaponState } from "./entities";

function weapon(id: string, level = 1): WeaponState {
    return { def: getWeapon(id), level, cooldown: 0, bonus: 0, uses: 0 };
}

function passive(id: string, level = 1): PassiveState {
    return { id, level, value: getPassive(id).perLevel * level };
}

function countRarities(luck: number, rolls: number): Record<Rarity, number> {
    const rng = new Rng(42);
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, veryRare: 0 };
    for (let i = 0; i < rolls; i++) {
        counts[rollRarity(() => rng.next(), luck)]++;
    }
    return counts;
}

describe("rarity", () => {
    test("most rolls are common, very rare ones are rare", () => {
        const counts = countRarities(0, 20000);
        expect(counts.common / 20000).toBeCloseTo(0.7, 1);
        expect(counts.uncommon / 20000).toBeCloseTo(0.22, 1);
        expect(counts.rare).toBeGreaterThan(counts.veryRare);
        expect(counts.veryRare).toBeGreaterThan(0);
        expect(counts.veryRare / 20000).toBeLessThan(0.02);
    });

    test("luck makes rarer rolls likelier", () => {
        const unlucky = countRarities(0, 20000);
        const lucky = countRarities(0.5, 20000);
        expect(lucky.common).toBeLessThan(unlucky.common);
        expect(lucky.rare).toBeGreaterThan(unlucky.rare);
    });

    test("rarer passive picks are bigger", () => {
        const piety = getPassive("piety");
        let previous = 0;
        for (const quality of ["common", "uncommon", "rare", "veryRare"] as Rarity[]) {
            const gain = getPassiveGain(piety, quality);
            expect(gain).toBeGreaterThan(previous);
            previous = gain;
        }
        expect(getPassiveGain(piety, "veryRare")).toBeCloseTo(
            piety.perLevel * RARITIES.veryRare.power,
        );
    });

    test("a whole-number passive adds the same, whatever the pick's rarity", () => {
        const quiver = getPassive("dizanas_quiver");
        for (const quality of RARITY_ORDER) {
            expect(getPassiveGain(quiver, quality)).toBe(1);
        }
    });
});

describe("rollChoices", () => {
    test("offers three different things", () => {
        const choices = rollChoices(new Rng(1), [weapon("scimitar")], [], 0, "melee");
        expect(choices.length).toBe(3);
        const keys = choices.map((c) => JSON.stringify({ ...c, quality: undefined }));
        expect(new Set(keys).size).toBe(3);
    });

    test("no new weapons or passives once the slots are full", () => {
        const weapons = ["scimitar", "fire_spells", "throwing_knives", "ice_burst"].map((id) =>
            weapon(id),
        );
        const passives = ["piety", "graceful", "rapid_heal", "amulet_of_glory"].map((id) =>
            passive(id),
        );
        expect(weapons.length).toBe(MAX_WEAPONS);
        expect(passives.length).toBe(MAX_PASSIVES);
        const rng = new Rng(3);
        for (let i = 0; i < 200; i++) {
            for (const choice of rollChoices(rng, weapons, passives, 0, "melee")) {
                expect(choice.kind).not.toBe("newWeapon");
                expect(choice.kind).not.toBe("newPassive");
            }
        }
    });

    test("an evolution is always offered when it's ready", () => {
        const scimitar = weapon("scimitar", getWeapon("scimitar").levels.length);
        const choices = rollChoices(new Rng(5), [scimitar], [passive("piety")], 0, "melee");
        expect(choices[0]).toEqual({ kind: "evolve", weaponId: "scimitar", into: "abyssal_whip" });
    });

    test("rare items are offered less often than common ones", () => {
        const rng = new Rng(9);
        const offered = new Map<string, number>();
        for (let i = 0; i < 2000; i++) {
            for (const choice of rollChoices(rng, [weapon("fire_spells", 8)], [], 0, "ranged")) {
                if (choice.kind === "newWeapon") {
                    offered.set(choice.weaponId, (offered.get(choice.weaponId) ?? 0) + 1);
                }
            }
        }
        // Scimitar is common, the Bow of Faerdhinen rare
        expect(offered.get("scimitar")!).toBeGreaterThan(offered.get("bow_of_faerdhinen")! * 2);
    });

    test("falls back to coins and food when there's nothing left", () => {
        const weapons = ["abyssal_whip", "fire_spells", "throwing_knives", "saradomin_strike"].map(
            (id) => weapon(id, getWeapon(id).levels.length),
        );
        const passives = ["piety", "graceful", "rapid_heal", "amulet_of_glory"].map((id) =>
            passive(id, 5),
        );
        const choices: UpgradeChoice[] = rollChoices(new Rng(2), weapons, passives, 0, "melee");
        expect(choices.map((c) => c.kind).sort()).toEqual(["coins", "food"]);
    });
});

describe("evolutions", () => {
    test("an evolution never pushes less than the maxed weapon it came from", () => {
        for (const def of WEAPONS) {
            if (def.evolution) {
                const into = getWeapon(def.evolution.into);
                const maxed = def.levels[def.levels.length - 1].knockback;
                expect(into.levels[0].knockback).toBeGreaterThanOrEqual(maxed - 0.001);
            }
        }
    });

    test("every evolved weapon has three levels, and comes from something", () => {
        for (const def of WEAPONS.filter((w) => w.evolved)) {
            expect(def.levels.length).toBe(3);
            expect(EVOLUTIONS.some((e) => e.into === def)).toBe(true);
        }
    });

    test("every recipe names what it evolves", () => {
        const names = EVOLUTIONS.map((e) => e.name);
        expect(names).toContain("Dragon scimitar");
        expect(names).toContain("Any godsword");
        // Each result is listed once, even with several weapons behind it
        expect(new Set(EVOLUTIONS.map((e) => e.into.id)).size).toBe(EVOLUTIONS.length);
    });

    test("level up cards say what evolves with what", () => {
        const scimitar = weapon("scimitar");
        const offer: UpgradeChoice = {
            kind: "weaponLevel",
            weaponId: "scimitar",
            level: 2,
            quality: "common",
        };
        expect(getEvolutionHint(offer, [scimitar], [], "melee")).toEqual({
            text: "Evolves with Piety",
            held: false,
        });
        expect(getEvolutionHint(offer, [scimitar], [passive("piety")], "melee")?.held).toBe(true);
        const piety: UpgradeChoice = { kind: "newPassive", passiveId: "piety", quality: "common" };
        expect(getEvolutionHint(piety, [scimitar], [], "melee")).toEqual({
            text: "Evolves the Dragon scimitar",
            held: true,
        });
        // A ranged adventurer can't get the godsword, so it isn't mentioned
        expect(getEvolutionHint(piety, [], [], "ranged")).toEqual({
            text: "Evolves the Dragon scimitar",
            held: false,
        });
        expect(getEvolutionHint(piety, [], [], "melee")?.text).toBe(
            "Evolves the Dragon scimitar and any godsword",
        );
    });

    test("an evolved weapon has no hint, and a locked evolution isn't mentioned", () => {
        const whip: UpgradeChoice = {
            kind: "weaponLevel",
            weaponId: "abyssal_whip",
            level: 2,
            quality: "common",
        };
        expect(getEvolutionHint(whip, [weapon("abyssal_whip")], [], "melee")).toBeUndefined();
        const knives: UpgradeChoice = {
            kind: "newWeapon",
            weaponId: "throwing_knives",
            quality: "common",
        };
        expect(getEvolutionHint(knives, [], [], "melee", new Set())).toBeUndefined();
    });

    test("every evolution becomes an evolved weapon, with a passive that exists", () => {
        for (const def of WEAPONS) {
            if (def.evolution) {
                expect(getWeapon(def.evolution.into).evolved).toBe(true);
                expect(PASSIVES.some((p) => p.id === def.evolution!.requiresPassive)).toBe(true);
            }
        }
    });

    test("the weapons that couldn't evolve before can now, and a passive can serve two", () => {
        const evolutions: [string, string, string][] = [
            ["shortbow", "rigour", "dark_bow"],
            ["fire_spells", "augury", "flames_of_zamorak"],
            ["throwing_axes", "tome_of_fire", "chain_hit_axes"],
            ["blood_burst", "rapid_heal", "blood_barrage"],
            ["smoke_burst", "ancient_sceptre", "smoke_barrage"],
            ["shadow_burst", "ancient_sceptre", "shadow_barrage"],
            ["ivandis_flail", "book_of_the_dead", "blisterwood_flail"],
            ["crystal_bow", "graceful", "corrupted_bow"],
        ];
        for (const [base, passiveId, into] of evolutions) {
            const maxed = weapon(base, getWeapon(base).levels.length);
            const choices = rollChoices(new Rng(5), [maxed], [passive(passiveId)], 0, "melee");
            expect(choices[0]).toEqual({ kind: "evolve", weaponId: base, into });
        }
    });

    test("an evolved burst is still the one Ancient spell", () => {
        const rng = new Rng(8);
        for (let i = 0; i < 300; i++) {
            for (const choice of rollChoices(rng, [weapon("shadow_barrage")], [], 0, "magic")) {
                if (choice.kind === "newWeapon") {
                    expect(getWeapon(choice.weaponId).family).not.toBe("ancient_burst");
                }
            }
        }
    });
});

describe("hilts", () => {
    test("having beaten the Desert, a burst picks the run's Ancient spell once", () => {
        const spells = ["smoke_burst", "shadow_burst", "blood_burst"];
        const beaten = new Set(spells);
        expect(hiltChoices(weapon("ice_burst", 2), new Set())).toEqual([]);
        const choices = hiltChoices(weapon("ice_burst", 2), beaten);
        expect(choices.map((c) => c.kind === "hilt" && c.into)).toEqual(["ice_burst", ...spells]);
        expect(hiltChoices(weapon("smoke_burst", 2), beaten).length).toBe(4);
        // Only at that level, so keeping Ice Burst doesn't ask again
        expect(hiltChoices(weapon("ice_burst", 1), beaten)).toEqual([]);
        expect(hiltChoices(weapon("ice_burst", 3), beaten)).toEqual([]);
    });

    test("the godsword's blade offers its hilts at its hilt level, shown as the hilts", () => {
        expect(hiltChoices(weapon("godsword", 1))).toEqual([]);
        const choices = hiltChoices(weapon("godsword", 2));
        expect(choices.length).toBe(4);
        expect(describeChoice(choices[0])).toMatchObject({
            title: "Armadyl godsword",
            text: "Every third swing is The Judgement, a huge hit.",
            iconObjId: 11810,
        });
        // A godsword that has its hilt has no more to pick
        expect(hiltChoices(weapon("armadyl_godsword", 2))).toEqual([]);
    });
});

describe("unlocks", () => {
    // How often each new weapon and passive is offered over many level ups
    function offers(
        style: CombatStyle,
        unlocked: ReadonlySet<string> | undefined,
        rolls = 3000,
    ): Map<string, number> {
        const rng = new Rng(6);
        const offered = new Map<string, number>();
        for (let i = 0; i < rolls; i++) {
            for (const choice of rollChoices(
                rng,
                [weapon("throwing_knives")],
                [],
                0,
                style,
                unlocked,
            )) {
                const id =
                    choice.kind === "newWeapon"
                        ? choice.weaponId
                        : choice.kind === "newPassive"
                          ? choice.passiveId
                          : undefined;
                if (id) {
                    offered.set(id, (offered.get(id) ?? 0) + 1);
                }
            }
        }
        return offered;
    }

    test("locked weapons and passives are never offered, and are once unlocked", () => {
        const locked = [
            ...WEAPONS.filter((w) => w.unlock && !w.evolved),
            ...PASSIVES.filter((p) => p.unlock),
        ].map((d) => d.id);
        expect(locked.length).toBeGreaterThan(0);
        for (const style of ["melee", "ranged", "magic"] as CombatStyle[]) {
            const offered = offers(style, new Set());
            for (const id of locked) {
                expect(offered.has(id), id).toBe(false);
            }
        }
        const unlocked = offers("melee", new Set(["osmumtens_fang", "vengeance"]));
        expect(unlocked.get("osmumtens_fang")).toBeGreaterThan(0);
        expect(unlocked.get("vengeance")).toBeGreaterThan(0);
        expect(unlocked.has("dragon_warhammer")).toBe(false);
    });

    test("an evolution waits until what it becomes is unlocked", () => {
        const runes = weapon("elemental_runes", getWeapon("elemental_runes").levels.length);
        const vengeance = passive("vengeance");
        const roll = (unlocked: string[]) =>
            rollChoices(new Rng(5), [runes], [vengeance], 0, "magic", new Set(unlocked));
        expect(roll(["vengeance"]).some((c) => c.kind === "evolve")).toBe(false);
        expect(roll(["vengeance", "astral_runes"])[0]).toEqual({
            kind: "evolve",
            weaponId: "elemental_runes",
            into: "astral_runes",
        });
    });

    test("only Ice Burst is offered: the other Ancient spells come from its pick", () => {
        for (const unlocked of [undefined, new Set<string>()]) {
            const offered = offers("magic", unlocked);
            expect(offered.get("ice_burst")).toBeGreaterThan(0);
            for (const id of ["smoke_burst", "shadow_burst", "blood_burst"]) {
                expect(offered.has(id)).toBe(false);
            }
        }
    });
});

describe("class weapons", () => {
    // How often each new weapon is offered over many level ups
    function newWeaponOffers(
        style: CombatStyle,
        owned: WeaponState[],
        rolls = 4000,
    ): Map<string, number> {
        const rng = new Rng(11);
        const offered = new Map<string, number>();
        for (let i = 0; i < rolls; i++) {
            for (const choice of rollChoices(rng, owned, [], 0, style)) {
                if (choice.kind === "newWeapon") {
                    offered.set(choice.weaponId, (offered.get(choice.weaponId) ?? 0) + 1);
                }
            }
        }
        return offered;
    }

    test("are only offered to their own class", () => {
        for (const style of ["melee", "ranged", "magic"] as CombatStyle[]) {
            const offered = newWeaponOffers(style, [weapon("throwing_knives")]);
            for (const def of WEAPONS.filter((w) => w.style && !w.evolved)) {
                if (def.style === style) {
                    expect(offered.get(def.id) ?? 0).toBeGreaterThan(0);
                } else {
                    expect(offered.has(def.id)).toBe(false);
                }
            }
        }
    });

    test("the Very rare ones are offered least", () => {
        const offered = newWeaponOffers("melee", [weapon("throwing_knives")]);
        const scythe = offered.get("scythe_of_vitur")!;
        expect(offered.get("fire_spells")!).toBeGreaterThan(scythe * 8);
        expect(offered.get("saradomin_strike")!).toBeGreaterThan(scythe * 1.5);
    });

    test("the godswords share one weapon's chance, and only one is carried", () => {
        const offered = newWeaponOffers("melee", [weapon("throwing_knives")]);
        // The four, and the blade that takes the hilt picked
        const godswords = WEAPONS.filter((w) => w.family === "godsword" && !w.evolved).map(
            (w) => w.id,
        );
        expect(godswords.length).toBe(5);
        const anyGodsword = godswords.reduce((sum, id) => sum + (offered.get(id) ?? 0), 0);
        // About as often as Ranged adventurers are offered the Bow of
        // Faerdhinen, which is Rare too
        const bow = newWeaponOffers("ranged", [weapon("throwing_knives")]).get(
            "bow_of_faerdhinen",
        )!;
        expect(anyGodsword / bow).toBeGreaterThan(0.7);
        expect(anyGodsword / bow).toBeLessThan(1.4);

        const withOne = newWeaponOffers("melee", [weapon("armadyl_godsword")], 1000);
        for (const id of godswords) {
            expect(withOne.has(id)).toBe(false);
        }
    });

    test("a new weapon is offered at its own rarity or better", () => {
        const rng = new Rng(4);
        let seen = 0;
        for (let i = 0; i < 3000; i++) {
            for (const choice of rollChoices(rng, [], [], 0, "ranged")) {
                if (choice.kind !== "newWeapon") {
                    continue;
                }
                const rarity = getWeapon(choice.weaponId).rarity;
                expect(RARITY_ORDER.indexOf(choice.quality)).toBeGreaterThanOrEqual(
                    RARITY_ORDER.indexOf(rarity),
                );
                if (choice.weaponId === "twisted_bow") {
                    expect(choice.quality).toBe("veryRare");
                    seen++;
                }
            }
        }
        expect(seen).toBeGreaterThan(0);
    });
});

describe("endless runs", () => {
    // Every slot full and everything at its last level
    const weapons = ["abyssal_whip", "fire_spells", "throwing_knives", "saradomin_strike"].map(
        (id) => weapon(id, getWeapon(id).levels.length),
    );
    const passives = ["piety", "graceful", "ring_of_wealth", "amulet_of_glory"].map((id) =>
        passive(id, getPassive(id).maxLevel),
    );

    test("weapons and passives level on past their last level, but not capped stats", () => {
        const rng = new Rng(4);
        const offered = new Set<string>();
        for (let i = 0; i < 300; i++) {
            for (const choice of rollChoices(rng, weapons, passives, 0, "melee", undefined, true)) {
                if (choice.kind === "weaponLevel") {
                    const def = getWeapon(choice.weaponId);
                    expect(choice.level).toBe(def.levels.length + 1);
                    offered.add(choice.weaponId);
                } else if (choice.kind === "passiveLevel") {
                    expect(choice.level).toBe(getPassive(choice.passiveId).maxLevel + 1);
                    offered.add(choice.passiveId);
                } else {
                    throw new Error("Unexpected " + choice.kind);
                }
            }
        }
        for (const w of weapons) {
            expect(offered.has(w.def.id)).toBe(true);
        }
        expect(offered.has("piety")).toBe(true);
        expect(offered.has("amulet_of_glory")).toBe(true);
        // Movement speed and luck stop where they are
        expect(offered.has("graceful")).toBe(false);
        expect(offered.has("ring_of_wealth")).toBe(false);
    });

    test("a passive that adds to a capped stat too stops at its last level", () => {
        // Augury's effect duration is capped, Rigour's ranged damage isn't
        expect(canLevelPassive(getPassive("augury"), 5, true)).toBe(false);
        expect(canLevelPassive(getPassive("rigour"), 5, true)).toBe(true);
        expect(canLevelPassive(getPassive("augury"), 4, false)).toBe(true);
    });

    test("an evolution is still always offered, and the weapon can level on instead", () => {
        const sword = weapon("scimitar", getWeapon("scimitar").levels.length);
        const rng = new Rng(5);
        let levelledOn = false;
        for (let i = 0; i < 100; i++) {
            const choices = rollChoices(rng, [sword], passives, 0, "melee", undefined, true);
            expect(choices[0]).toEqual({
                kind: "evolve",
                weaponId: "scimitar",
                into: "abyssal_whip",
            });
            levelledOn ||= choices.some(
                (c) => c.kind === "weaponLevel" && c.weaponId === "scimitar",
            );
        }
        expect(levelledOn).toBe(true);
    });

    test("levels past the last read as upgrades", () => {
        const whip = getWeapon("abyssal_whip");
        const last = whip.levels.length;
        const choice = describeChoice({
            kind: "weaponLevel",
            weaponId: whip.id,
            level: last + 2,
            quality: "rare",
        });
        expect(choice.title).toBe(`${whip.levels[last - 1].name ?? whip.name} +2`);
        expect(choice.text).toBe("This weapon does 34% more damage.");
        // The pick multiplies what the weapon has, and the card shows the
        // before and after so "15% more" at +477% doesn't read as +492%
        expect(choice.stats).toBeUndefined();
        const stacked = describeChoice({
            kind: "weaponLevel",
            weaponId: whip.id,
            level: last + 3,
            quality: "common",
            bonus: 4.77,
        });
        expect(stacked.stats).toEqual([
            { label: "Damage bonus", value: "+564%", from: "+477%", better: true },
        ]);
        // An offer past the last level carries the weapon's bonus; one before it doesn't
        const rng = new Rng(1);
        const levelOffer = (level: number, endless: boolean): UpgradeChoice => {
            for (;;) {
                const held = { ...weapon(whip.id, level), bonus: 0.5 };
                const offer = rollChoices(rng, [held], [], 0, "melee", undefined, endless).find(
                    (c) => c.kind === "weaponLevel",
                );
                if (offer) return offer;
            }
        };
        expect(levelOffer(last, true)).toEqual({
            kind: "weaponLevel",
            weaponId: whip.id,
            level: last + 1,
            quality: expect.any(String),
            bonus: 0.5,
        });
        expect(levelOffer(1, false)).not.toHaveProperty("bonus");
        const piety = describeChoice({
            kind: "passiveLevel",
            passiveId: "piety",
            level: 6,
            quality: "common",
            currentValue: 0.25,
        });
        expect(piety.title).toBe("Piety +1");
        expect(piety.stats).toEqual([
            { label: "Damage", value: "+30%", from: "+25%", better: true },
        ]);
        const newPiety = describeChoice({
            kind: "newPassive",
            passiveId: "piety",
            quality: "common",
        });
        expect(newPiety.stats).toEqual([{ label: "Damage", value: "+5%" }]);
    });
});
