import { WeaponDamageBalance } from "./balance";
import { getWeaponDamageMultiplier } from "./weaponBalance";
import { WEAPONS, getWeapon, getWeaponStyle } from "./weapons";

// Isolate the controls from the shipped values, which can change with balance.
const neutral: WeaponDamageBalance = {};

describe("weapon damage tuning", () => {
    test("neutral profiles preserve every weapon in every supported run mode", () => {
        for (const weapon of WEAPONS) {
            for (const players of [1, 2, 3, 4]) {
                for (const hard of [false, true]) {
                    expect(
                        getWeaponDamageMultiplier(weapon, players, hard, neutral),
                        weapon.id,
                    ).toBe(1);
                }
            }
        }
    });

    test("a class evolution nerf leaves its base weapons and other classes alone", () => {
        const balance = structuredClone(neutral);
        balance.global = { styles: { magic: { evolved: 0.6 } } };
        for (const weapon of WEAPONS) {
            const expected = getWeaponStyle(weapon) === "magic" && weapon.evolved ? 0.6 : 1;
            expect(getWeaponDamageMultiplier(weapon, 4, true, balance), weapon.id).toBe(expected);
        }
    });

    test("uses explicit damage styles and the shared weapons' inferred styles", () => {
        const balance = structuredClone(neutral);
        balance.global = { styles: { magic: { all: 0.6 }, ranged: { all: 0.8 } } };
        const spell = getWeapon("fire_spells");
        expect(spell.kind).toBe("missile");
        expect(getWeaponDamageMultiplier(spell, 1, false, balance)).toBe(0.6);
        const shared = WEAPONS.find((w) => !w.style && !w.damageStyle)!;
        const expected = { melee: 1, ranged: 0.8, magic: 0.6 }[getWeaponStyle(shared)];
        expect(getWeaponDamageMultiplier(shared, 1, false, balance)).toBe(expected);
    });

    test.each([
        [1, false, 1],
        [1, true, 1],
        [2, false, 1],
        [2, true, 0.6],
        [4, true, 0.6],
    ])("isolates hard co-op evolution tuning (%i players, hard %s)", (players, hard, expected) => {
        const balance = structuredClone(neutral);
        balance.modes = { coop: { hard: { styles: { magic: { evolved: 0.6 } } } } };
        const weapon = WEAPONS.find((w) => w.evolved && getWeaponStyle(w) === "magic")!;
        expect(getWeaponDamageMultiplier(weapon, players, hard, balance)).toBe(expected);
    });

    test("multiplies class, stage, weapon, mode and party-size rules instead of overriding them", () => {
        const balance = structuredClone(neutral);
        const weapon = getWeapon("abyssal_whip");
        expect(weapon.evolved).toBe(true);
        balance.global = {
            all: 0.9,
            evolved: 0.6,
            styles: { melee: { all: 0.8, evolved: 0.7 } },
            weapons: { abyssal_whip: 1.2 },
        };
        balance.difficulty = { hard: { all: 0.95 } };
        balance.playMode = { coop: { evolved: 0.85 } };
        balance.modes = { coop: { hard: { weapons: { abyssal_whip: 1.1 } } } };
        balance.partySize = { 4: { styles: { melee: { evolved: 0.75 } } } };
        expect(getWeaponDamageMultiplier(weapon, 4, true, balance)).toBeCloseTo(
            0.9 * 0.6 * 0.8 * 0.7 * 1.2 * 0.95 * 0.85 * 1.1 * 0.75,
        );
        expect(getWeaponDamageMultiplier(getWeapon("scimitar"), 1, false, balance)).toBeCloseTo(
            0.9 * 0.8,
        );
    });

    test.each([-0.1, NaN, Infinity])("rejects invalid multipliers (%s)", (all) => {
        const balance = structuredClone(neutral);
        balance.global = { all };
        expect(() => getWeaponDamageMultiplier(getWeapon("scimitar"), 1, false, balance)).toThrow(
            "Invalid weapon damage multiplier",
        );
    });
});
