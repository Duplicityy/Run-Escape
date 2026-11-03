// Sustained single-target attacks at an ideal distance. This includes actual
// projectiles, specials, follow-ups and DoTs, but not movement, gear or waves.
// Use simulate-run.ts as well before drawing conclusions about run balance.
import { pathToFileURL } from "node:url";

import { getEnemy } from "../../src/game/content/enemies";
import { WeaponDef, emptyStats } from "../../src/game/content/types";
import { WEAPONS, getWeapon } from "../../src/game/content/weapons";
import { Sim, TICKS_PER_SECOND } from "../../src/game/core/Sim";
import { makeGrid } from "../../src/game/core/world/testGrid";

export function measureWeaponDps(weapon: WeaponDef, level: number, boss = false): number {
    const seconds = 60;
    let total = 0;
    for (const seed of [1, 2, 3]) {
        const sim = new Sim({
            grid: makeGrid(Array(40).fill(".".repeat(40)), 1000, 1000),
            characterId: "warrior",
            metaStats: emptyStats(),
            seed,
            spawnX: 1020,
            spawnY: 1020,
            balance: {},
        });
        sim.weapons = [];
        sim.addWeapon(weapon.id);
        Object.assign(sim.weapons[0], { def: weapon, level, cooldown: 0 });
        sim.heroes[0].stats = emptyStats();
        sim.player.invulnerable = 1e9;
        const distance = weapon.kind === "orbit" ? weapon.levels[level - 1].area : 1.5;
        const enemy = sim.spawnEnemy(
            { ...getEnemy("goblin"), stationary: true, knockbackResist: 1 },
            "normal",
            { x: sim.player.x + distance, y: sim.player.y },
        )!;
        // Keep it alive, with representative max HP for toughness bonuses.
        enemy.hp = 1e9;
        enemy.maxHp = boss ? 10000 : 200;
        enemy.frozen = 1e9;
        enemy.boss = boss;
        sim["enemyHash"].insert(enemy);
        for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick++) {
            sim.tick++;
            sim["stepEnemies"]();
            sim["stepWeapons"]();
            sim["stepPendingHits"]();
            sim["stepProjectiles"]();
            sim["stepFires"]();
        }
        total += sim.damageBySource[`weapon:${weapon.id}`] ?? 0;
    }
    return total / (3 * seconds);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const rows = WEAPONS.filter((weapon) => weapon.evolution).map((base) => {
        const evolved = getWeapon(base.evolution!.into);
        return {
            base: base.id,
            evolution: evolved.id,
            baseNormal: measureWeaponDps(base, base.levels.length),
            evolvedNormal: measureWeaponDps(evolved, 1),
            baseBoss: measureWeaponDps(base, base.levels.length, true),
            evolvedBoss: measureWeaponDps(evolved, 1, true),
        };
    });
    console.log(JSON.stringify(rows, null, 2));
}
