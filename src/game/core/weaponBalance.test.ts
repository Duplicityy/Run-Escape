import { WeaponDamageBalance } from "../content/balance";
import { getEnemy } from "../content/enemies";
import { emptyStats } from "../content/types";
import { WEAPONS, getWeapon } from "../content/weapons";
import { DPS_WINDOW_SECONDS, Sim, TICKS_PER_SECOND } from "./Sim";
import { DamageSource, Enemy } from "./entities";
import { makeGrid } from "./world/testGrid";

afterEach(() => vi.restoreAllMocks());

function createSim(players = 1, hard = false, balance: WeaponDamageBalance = {}): Sim {
    const sim = new Sim({
        balance,
        grid: makeGrid(Array(40).fill(".".repeat(40)), 1000, 1000),
        characterId: "warrior",
        metaStats: emptyStats(),
        seed: 1,
        spawnX: 1020,
        spawnY: 1020,
        hard,
        party: Array.from({ length: players }, () => ({
            name: "test",
            characterId: "warrior",
            metaStats: emptyStats(),
        })),
    });
    for (const hero of sim.heroes) {
        hero.weapons = [];
        hero.stats = emptyStats();
        hero.player.invulnerable = 1e6;
    }
    const range = sim.rng.range.bind(sim.rng);
    vi.spyOn(sim.rng, "range").mockImplementation((min, max) =>
        min === 0.85 && max === 1.15 ? 1 : range(min, max),
    );
    return sim;
}

function dummy(sim: Sim, distance = 1.5): Enemy {
    const enemy = sim.spawnEnemy(getEnemy("goblin"), "normal", {
        x: sim.player.x + distance,
        y: sim.player.y,
    })!;
    enemy.hp = enemy.maxHp = 1e9;
    enemy.frozen = 1e6;
    sim["enemyHash"].insert(enemy);
    return enemy;
}

function hit(sim: Sim, enemy: Enemy, source: DamageSource, damage = 1000): number {
    sim["damageSource"] = source;
    return sim.damageEnemy(enemy, damage, 0, enemy.x, enemy.y);
}

describe("weapon balance in combat", () => {
    test("two simulations can use different profiles without changing shared content", () => {
        const normal = createSim();
        const reduced = createSim(1, false, { global: { evolved: 0.5 } });
        expect(hit(reduced, dummy(reduced), "weapon:abyssal_whip")).toBe(500);
        expect(hit(normal, dummy(normal), "weapon:abyssal_whip")).toBe(1000);
        const next = createSim();
        expect(hit(next, dummy(next), "weapon:abyssal_whip")).toBe(1000);
    });

    test.each([
        [1, 1],
        [3, 2],
        [20, 10],
    ])("documents rounding and the minimum hit at raw damage %i", (raw, expected) => {
        const sim = createSim(1, false, { global: { evolved: 0.5 } });
        const enemy = dummy(sim);
        expect(hit(sim, enemy, "weapon:abyssal_whip", raw)).toBe(expected);
    });

    test("equal tuned DoT damage retains its first source, while stronger damage replaces it", () => {
        const sim = createSim(2, false, { global: { weapons: { smoke_barrage: 0.5 } } });
        const enemy = dummy(sim);
        sim["damageSource"] = "weapon:toxic_blowpipe";
        sim["envenom"](enemy, 100, 100);
        sim.as(1, () => {
            sim["damageSource"] = "weapon:smoke_barrage";
            sim["envenom"](enemy, 200, 200);
        });
        expect(enemy.venomSource).toBe("weapon:toxic_blowpipe");
        expect(enemy.venomHero).toBe(0);
        expect(enemy.venomEnd).toBe(200);
        sim.as(1, () => sim["envenom"](enemy, 202, 300));
        expect(enemy.venomSource).toBe("weapon:smoke_barrage");
        expect(enemy.venomHero).toBe(1);
        const def = getWeapon("toktz_mej_tal");
        sim["damageSource"] = "weapon:toxic_blowpipe";
        sim["burnGround"](def.burns!, { ...def.levels[0], damage: 100 });
        sim["damageSource"] = "weapon:smoke_barrage";
        sim["burnGround"](def.burns!, { ...def.levels[0], damage: 200 });
        expect(sim.fires[0].source).toBe("weapon:toxic_blowpipe");
        sim["burnGround"](def.burns!, { ...def.levels[0], damage: 202 });
        expect(sim.fires[0].source).toBe("weapon:smoke_barrage");
    });

    // Run the combat steps without waves or upgrades, so every hit can be
    // compared against the same attack with neutral tuning, including DoTs.
    function attacks(weaponId: string, scale: number): number[] {
        const sim = createSim(1, false, { global: { all: scale } });
        const def = getWeapon(weaponId);
        dummy(sim, def.kind === "orbit" ? def.levels[0].area : 1.5);
        sim.addWeapon(weaponId);
        const weapon = sim.weapons[0];
        weapon.cooldown = 0;
        // Exercise special attacks on the first swing too.
        weapon.uses = (def.special?.every ?? 1) - 1;
        for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
            sim.tick++;
            sim["stepEnemies"]();
            sim["stepWeapons"]();
            sim["stepPendingHits"]();
            sim["stepProjectiles"]();
            sim["stepFires"]();
        }
        const damage = sim
            .takeEvents()
            .flatMap((event) => (event.type === "damage" ? [event.amount] : []));
        expect(sim.damageBySource[`weapon:${weaponId}`]).toBe(damage.reduce((a, b) => a + b, 0));
        expect(sim.dps * DPS_WINDOW_SECONDS).toBe(damage.reduce((a, b) => a + b, 0));
        return damage;
    }

    test.each(WEAPONS.map((weapon) => weapon.id))(
        "scales %s's hits once, including follow-ups",
        (id) => {
            const normal = attacks(id, 1);
            const nerfed = attacks(id, 0.6);
            expect(normal.length).toBeGreaterThan(0);
            expect(nerfed).toHaveLength(normal.length);
            normal.forEach((damage, i) => {
                // Each hit rounds separately and still has a minimum of 1.
                expect(Math.abs(nerfed[i] - Math.max(1, damage * 0.6))).toBeLessThanOrEqual(1);
            });
        },
    );

    test.each([
        [1, false, 1000],
        [1, true, 1000],
        [2, false, 1000],
        [2, true, 600],
        [4, true, 600],
    ])(
        "uses hard co-op rules only in that mode (%i players, hard %s)",
        (players, hard, expected) => {
            const sim = createSim(players, hard, {
                modes: { coop: { hard: { styles: { melee: { evolved: 0.6 } } } } },
            });
            const enemy = dummy(sim);
            expect(hit(sim, enemy, "weapon:abyssal_whip")).toBe(expected);
            expect(hit(sim, enemy, "weapon:scimitar")).toBe(1000);
            if (players > 1) {
                for (let i = 1; i < players; i++) {
                    sim.leave(i);
                }
                expect(hit(sim, enemy, "weapon:abyssal_whip")).toBe(expected);
            }
        },
    );

    test("uses the attacking weapon's style even on an adventurer of another class", () => {
        const sim = createSim(1, false, { global: { styles: { magic: { all: 0.6 } } } });
        const enemy = dummy(sim);
        expect(hit(sim, enemy, "weapon:fire_spells")).toBe(600);
        expect(hit(sim, enemy, "weapon:scimitar")).toBe(1000);
    });

    test("a projectile keeps its base-weapon tuning after its owner evolves", () => {
        const sim = createSim(1, false, { global: { base: 0.8, evolved: 0.6 } });
        const enemy = dummy(sim);
        const def = getWeapon("fire_spells");
        sim["addProjectile"]("spell", def, { ...def.levels[0], damage: 1000 }, enemy, 0);
        sim.addWeapon(def.evolution!.into);
        sim["projectileHit"](sim.projectiles[0], enemy);
        expect(sim.damageBySource["weapon:fire_spells"]).toBe(800);
    });

    test("HP-based bolt effects are tuned even when they ignore Might", () => {
        const sim = createSim(1, false, { global: { weapons: { armadyl_crossbow: 0.6 } } });
        sim.stats.might = 10;
        const enemy = dummy(sim);
        const def = getWeapon("armadyl_crossbow");
        sim["addProjectile"]("spell", def, { ...def.levels[0], damage: 1000 }, enemy, 0);
        sim["damageSource"] = "weapon:armadyl_crossbow";
        sim["boltProc"](
            {
                name: "Blood Forfeit",
                weight: 1,
                spotAnim: 0,
                effect: { kind: "hpFraction", fraction: 0.2, max: 5 },
            },
            sim.projectiles[0],
            enemy,
        );
        expect(sim.damageBySource["weapon:armadyl_crossbow"]).toBe(3000);
    });

    test("zero disables weapon damage without the minimum-hit floor affecting other sources", () => {
        const sim = createSim(1, false, { global: { all: 0 } });
        const enemy = dummy(sim);
        expect(hit(sim, enemy, "weapon:scimitar")).toBe(0);
        expect(enemy.hp).toBe(enemy.maxHp);
        expect(sim.dps).toBe(0);
        for (const source of [
            "item:black_chinchompa",
            "powerUp:cannon",
            "recoil",
            "other",
        ] as const) {
            expect(hit(sim, enemy, source), source).toBe(1000);
        }
    });

    test("overlapping venom keeps the stronger tuned dose and its original hero", () => {
        const sim = createSim(2, false, { global: { weapons: { smoke_barrage: 0.1 } } });
        const enemy = dummy(sim);
        sim["damageSource"] = "weapon:toxic_blowpipe";
        sim["envenom"](enemy, 100, 100);
        sim.as(1, () => {
            sim["damageSource"] = "weapon:smoke_barrage";
            sim["envenom"](enemy, 200, 200);
        });
        expect(enemy.venomSource).toBe("weapon:toxic_blowpipe");
        expect(enemy.venomHero).toBe(0);
        expect(enemy.venomEnd).toBe(200);
        sim.tick = enemy.venomNext;
        sim["stepEnemies"]();
        expect(sim.heroes[0].damageBySource["weapon:toxic_blowpipe"]).toBe(100);
        expect(sim.heroes[1].damageBySource["weapon:smoke_barrage"]).toBeUndefined();
    });

    test("merged ground fires compare their weapons' tuned damage", () => {
        const sim = createSim(2, false, { global: { weapons: { fire_spells: 0.1 } } });
        dummy(sim);
        const def = getWeapon("toktz_mej_tal");
        const level = { ...def.levels[0], damage: 1000 };
        sim["damageSource"] = "weapon:fire_spells";
        sim["burnGround"](def.burns!, level);
        sim["damageSource"] = "weapon:toktz_mej_tal";
        sim["burnGround"](def.burns!, { ...level, damage: 500 });
        expect(sim.fires).toHaveLength(1);
        expect(sim.fires[0].source).toBe("weapon:toktz_mej_tal");
        expect(sim.fires[0].hero).toBe(0);
        sim.tick = sim.fires[0].nextTick;
        sim["stepFires"]();
        expect(sim.heroes[0].damageBySource["weapon:toktz_mej_tal"]).toBe(500 * def.burns!.damage);
    });
});
