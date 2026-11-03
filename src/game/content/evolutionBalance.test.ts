import { measureWeaponDps } from "../../../scripts/game/measure-weapon-dps";
import { WEAPONS, getWeapon } from "./weapons";

// These trade sustained single-target damage for area/healing or boss hits;
// their authored damage is unchanged by the controlled nerf.
const utilityTradeoffs = new Set(["flames_of_zamorak", "ancient_godsword"]);
const retuned = WEAPONS.filter(
    (base) => base.evolution && !utilityTradeoffs.has(base.evolution.into),
);

describe("controlled evolution progression", () => {
    test.each(retuned.map((base) => base.id))("%s still gains damage by evolving", (id) => {
        const base = getWeapon(id);
        const top = base.levels.at(-1)!;
        const evolved = getWeapon(base.evolution!.into);
        for (const level of evolved.levels) {
            expect(level.damage).toBeGreaterThan(top.damage);
            expect(level.damage / level.cooldown).toBeGreaterThan(top.damage / top.cooldown);
        }
        for (let i = 1; i < evolved.levels.length; i++) {
            expect(evolved.levels[i].damage).toBeGreaterThan(evolved.levels[i - 1].damage);
        }
        // Check actual specials, multi-hits, projectiles, venom and boss hits,
        // not just the stat-card damage divided by cooldown.
        for (const boss of [false, true]) {
            expect(measureWeaponDps(evolved, 1, boss)).toBeGreaterThan(
                measureWeaponDps(base, base.levels.length, boss),
            );
        }
    });
});
