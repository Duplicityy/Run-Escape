import { describeChoice } from "../core/Upgrades";
import { formatWeaponStat, weaponStatChanges, weaponStats } from "./weaponStats";
import { getWeapon } from "./weapons";

// Level n's changes from the level before, as text
function changes(weaponId: string, level: number): string[] {
    const def = getWeapon(weaponId);
    return weaponStatChanges(def, def.levels[level - 2], def.levels[level - 1]).map(
        formatWeaponStat,
    );
}

describe("weapon stats", () => {
    test("cards and tooltips include global evolution tuning without changing weapon data", () => {
        const base = getWeapon("scimitar");
        const evolved = getWeapon("abyssal_whip");
        const profile = { evolved: 0.5 };
        const first = { ...evolved.levels[0], damage: 42 };
        const next = { ...evolved.levels[1], damage: 48 };
        expect(weaponStats(base, base.levels[7], profile).map(formatWeaponStat)).toContain(
            "Damage 32",
        );
        expect(weaponStats(evolved, first, profile).map(formatWeaponStat)).toContain("Damage 21");
        expect(first.damage).toBe(42);
        expect(weaponStatChanges(evolved, first, next, profile).map(formatWeaponStat)).toContain(
            "Damage 21 → 24",
        );
    });

    test("global class and weapon tuning also applies to displayed venom", () => {
        const def = getWeapon("smoke_barrage");
        const profile = {
            all: 0.8,
            styles: { magic: { evolved: 0.5 } },
            weapons: { smoke_barrage: 0.5 },
        };
        const lines = weaponStats(def, { ...def.levels[0], damage: 13, venom: 7 }, profile).map(
            formatWeaponStat,
        );
        expect(lines).toContain("Damage 2.6");
        expect(lines).toContain("Venom 1.4/s");
        expect(lines).toContain(`Attacks ${(1 / def.levels[0].cooldown).toFixed(2)}/s`);
    });

    test("a level up shows what it changes, before and after", () => {
        expect(changes("scimitar", 3)).toEqual(["Damage 16 → 21", "Knockback 0.5 → 0.7"]);
        expect(changes("scimitar", 6)).toEqual(["Attacks 0.74/s → 0.80/s"]);
        expect(changes("scimitar", 7)).toEqual([
            "Damage 24 → 27",
            "Reach 2.4 tiles → 2.6 tiles",
            "Knockback 0.9 → 1.1",
        ]);
        // A slash's amount is its sides, front and back
        expect(changes("scimitar", 2)).toEqual(["Sides 1 → 2"]);
    });

    test("projectile weapons show more projectiles, pierce and splash", () => {
        expect(changes("shortbow", 2)).toEqual(["Projectiles 1 → 2"]);
        expect(changes("shortbow", 4)).toEqual(["Pierces 0 → 1"]);
        expect(changes("fire_spells", 5)).toEqual(["Damage 12 → 15", "Splash none → 0.9 tiles"]);
        expect(changes("throwing_axes", 2)).toEqual(["Bounces 1 → 2"]);
    });

    test("durations are named for what they do", () => {
        expect(changes("ice_burst", 5)).toEqual(["Freezes for 0.6s → 0.85s"]);
        expect(changes("smoke_burst", 7)).toEqual(["Venom 3/s → 4/s", "Venom lasts 3s → 4s"]);
        expect(changes("elemental_runes", 5)).toEqual([
            "Lasts 3s → 3.5s",
            "Radius 2.2 tiles → 2.6 tiles",
        ]);
    });

    test("nothing is shown when nothing changes", () => {
        const def = getWeapon("scimitar");
        expect(weaponStatChanges(def, def.levels[2], def.levels[2])).toEqual([]);
        // Swapping only the look (the shortbow's black arrows keep the
        // willow bow) isn't a change either
        const bow = getWeapon("shortbow");
        expect(weaponStatChanges(bow, bow.levels[2], { ...bow.levels[2], objId: 1 })).toEqual([]);
    });

    test("only the stats a kind uses are listed", () => {
        // A slash has no projectiles or pierce; its one side isn't worth a line
        expect(
            weaponStats(getWeapon("scimitar"), getWeapon("scimitar").levels[0]).map(
                formatWeaponStat,
            ),
        ).toEqual(["Damage 16", "Attacks 0.74/s", "Reach 2.2 tiles", "Knockback 0.5"]);
        const knives = getWeapon("throwing_knives");
        expect(weaponStats(knives, knives.levels[0]).map(formatWeaponStat)).toEqual([
            "Damage 6",
            "Attacks 1.54/s",
            "Projectiles 1",
            "Pierces 1",
        ]);
        const ring = getWeapon("toktz_xil_ul");
        expect(weaponStats(ring, ring.levels[0]).map(formatWeaponStat)).toContain("Pierces all");
    });

    test("level up cards carry the stats", () => {
        expect(
            describeChoice({
                kind: "weaponLevel",
                weaponId: "scimitar",
                level: 3,
                quality: "common",
            }).stats,
        ).toEqual([
            { label: "Damage", value: "21", from: "16", better: true },
            { label: "Knockback", value: "0.7", from: "0.5", better: true },
        ]);
        const fresh = describeChoice({
            kind: "newWeapon",
            weaponId: "shortbow",
            quality: "common",
        });
        expect(fresh.stats?.map(formatWeaponStat)).toEqual([
            "Damage 8",
            "Attacks 1.11/s",
            "Projectiles 1",
        ]);
        const evolved = describeChoice({
            kind: "evolve",
            weaponId: "scimitar",
            into: "abyssal_whip",
        });
        expect(evolved.stats?.map(formatWeaponStat)).toContain("Sides 2");
        // Past the last level it's only more damage, multiplying what the
        // weapon has: the card shows the bonus before and after
        const over = describeChoice({
            kind: "weaponLevel",
            weaponId: "scimitar",
            level: 9,
            quality: "common",
            bonus: 0.2,
        });
        expect(over.stats).toEqual([
            { label: "Damage bonus", value: "+38%", from: "+20%", better: true },
        ]);
    });
});
