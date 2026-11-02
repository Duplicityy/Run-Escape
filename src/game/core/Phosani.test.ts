import { getCharacter } from "../content/characters";
import { getEnemy } from "../content/enemies";
import { getMap } from "../content/maps";
import { emptyStats } from "../content/types";
import { SANCTUARY_BOSS_ARENA } from "../scaperune/maps/sisterhoodSanctuary";
import { Sim, TICKS_PER_SECOND } from "./Sim";
import { Enemy } from "./entities";
import { makeGrid } from "./world/testGrid";

// Phosani's Nightmare, on the Inquisitor's Field: a run that's one fight
// (MapDef.fight), with its picks before she rises and with each blast

const BASE = 1000;
const SIZE = 64;

// An open square with a wall round it, as big as her square on the real map
function createSim(seed = 1, characterId = "inquisitor"): Sim {
    const rows: string[] = [];
    for (let y = 0; y < SIZE; y++) {
        let row = "";
        for (let x = 0; x < SIZE; x++) {
            row += x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? "#" : ".";
        }
        rows.push(row);
    }
    const sim = new Sim({
        grid: makeGrid(rows, BASE, BASE),
        mapId: "phosani",
        characterId,
        metaStats: emptyStats(),
        seed,
        spawnX: BASE + SIZE / 2 + 0.5,
        spawnY: BASE + 8.5,
    });
    // Her square is on the real map, not this test's field
    sim.map.bossArena = undefined;
    return sim;
}

function run(sim: Sim, seconds: number, moveX = 0, moveY = 0): void {
    const ticks = Math.round(seconds * TICKS_PER_SECOND);
    for (let i = 0; i < ticks && !sim.runOver; i++) {
        if (sim.state === "levelUp") {
            sim.choose(0);
            continue;
        }
        sim.step(moveX, moveY);
    }
}

function phosani() {
    return getEnemy("phosanis_nightmare");
}

function phaseOf(boss: Enemy) {
    return boss.bossState!.phase!;
}

// Through her entrance, to the fight proper
function startFight(sim: Sim): Enemy {
    run(sim, phosani().boss!.intro!.seconds + 0.2);
    const boss = sim.enemies.find((e) => e.finalBoss)!;
    boss.attackCooldown = 1e9;
    return boss;
}

afterEach(() => {
    getMap("phosani").bossArena = SANCTUARY_BOSS_ARENA;
});

describe("the map", () => {
    test("is one fight, with her the only thing on it", () => {
        const map = getMap("phosani");
        expect(map.fight).toEqual({
            requires: "halloween",
            character: "inquisitor",
            weaponLevel: 3,
        });
        // The player starts where her entrance puts them: the middle of her square
        expect(map.spawn).toEqual({
            x: SANCTUARY_BOSS_ARENA.baseX + 32,
            y: SANCTUARY_BOSS_ARENA.baseY + 32,
        });
        expect(map.waves).toEqual([]);
        expect(map.events).toEqual([
            { at: 0, kind: "finalBoss", enemyId: "phosanis_nightmare", hp: 6000 },
        ]);
    });

    test("the run begins at once, with the kit and no picks", () => {
        const sim = createSim();
        expect(sim.tick).toBe(0);
        expect(sim.state).toBe("playing");
        expect(sim.level).toBe(1);
        expect(sim.choices).toEqual([]);
        expect(sim.passives).toEqual([]);
    });

    test("everyone plays the Inquisitor there, with their crossbow at the map's level", () => {
        const map = getMap("phosani");
        expect(map.fight?.character).toBe("inquisitor");
        const inquisitor = getCharacter("inquisitor");
        expect(inquisitor.style).toBe("ranged");
        expect(inquisitor.startingWeapon).toBe("armadyl_crossbow");
        expect(inquisitor.unlock).toEqual({
            kind: "killBoss",
            mapId: "phosani",
            enemyId: "phosanis_nightmare",
        });
        const sim = createSim();
        expect(sim.weapons.map((w) => [w.def.id, w.level])).toEqual([["armadyl_crossbow", 3]]);
        expect(sim.stats.moveSpeed).toBeGreaterThan(0);
        expect(sim.stats.maxHp).toBeGreaterThan(0);
    });

    test("she rises as the run begins, and nothing else ever comes", () => {
        const sim = createSim();
        sim.step(0, 0);
        expect(sim.intro?.def.id).toBe("phosanis_nightmare");
        run(sim, phosani().boss!.intro!.seconds + 0.2);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        expect(boss.def.id).toBe("phosanis_nightmare");
        expect(boss.maxHp).toBe(6000);
        expect(boss.damageScale).toBe(getMap("phosani").difficulty.damage);
        boss.attackCooldown = 1e9;
        run(sim, 30);
        const others = sim.enemies.filter((e) => e !== boss && !e.totemOf);
        expect(others).toEqual([]);
    });

    test("a party has the kit each, and no picks either", () => {
        const sim = new Sim({
            grid: makeGrid(
                Array.from({ length: SIZE }, (_, y) =>
                    Array.from({ length: SIZE }, (_, x) =>
                        x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? "#" : ".",
                    ).join(""),
                ),
                BASE,
                BASE,
            ),
            mapId: "phosani",
            characterId: "wizard",
            metaStats: emptyStats(),
            seed: 3,
            spawnX: BASE + 32.5,
            spawnY: BASE + 8.5,
            party: [
                { name: "a", characterId: "wizard", metaStats: emptyStats() },
                { name: "b", characterId: "warrior", metaStats: emptyStats() },
            ],
        });
        sim.map.bossArena = undefined;
        expect(sim.state).toBe("playing");
        for (const hero of sim.heroes) {
            expect(hero.pendingLevelUps).toBe(0);
            expect(hero.weapons.map((w) => w.level)).toEqual([3]);
        }
    });
});

describe("her fight", () => {
    test("each blast heals, and nothing in the fight gives a level", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.hp = 1;
        sim.damageEnemy(boss, phaseOf(boss).shield * 2, 0, boss.x, boss.y, 0);
        expect(phaseOf(boss).stage).toBe("totems");
        for (const totem of [...phaseOf(boss).totems]) {
            sim.damageEnemy(totem, totem.hp * 2, 0, totem.x, totem.y, 0);
        }
        expect(phaseOf(boss).index).toBe(1);
        expect(sim.player.hp).toBeGreaterThan(1);
        run(sim, 5);
        expect(sim.state).toBe("playing");
        expect(sim.level).toBe(1);
        expect(sim.xp).toBe(0);
    });

    test("she fights with everything of hers from the first phase", () => {
        const attacks = phosani().boss!.attacks;
        const firstPhase = attacks.filter((a) => !a.phases || a.phases.includes(1));
        const names = firstPhase.map((a) => a.name);
        expect(names).toContain("Surge");
        expect(names).toContain("Sweep");
        expect(names).toContain("Husks");
        expect(names).toContain("Corpse Flowers");
        // Her sweep's one arm, aimed and then turned
        const sweep = attacks.find((a) => a.name === "Sweep")!.pattern!;
        expect(sweep.shape).toBe("spread");
        expect(sweep.count).toBe(1);
        expect(sweep.turn).toBeGreaterThan(0);
        // And her claw lands on the player in her last phase
        const claw = attacks.find((a) => a.name === "Grasping Claws (on you)")!;
        expect(claw.phases).toEqual([3]);
        expect(claw.ground!.spots[0]).toEqual({ shape: "player" });
    });

    test("her sweep turns one way, from where the player stood", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Sweep")!;
        sim.player.x = boss.x + 8;
        sim.player.y = boss.y;
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.1);
        const bullets = sim.bullets;
        expect(bullets.count).toBeGreaterThan(0);
        const first = bullets.order[0];
        // The first flies east, at the player
        expect(bullets.vx[first]).toBeGreaterThan(0);
        expect(Math.abs(bullets.vy[first])).toBeLessThan(0.01);
        run(sim, 1.5);
        // Later ones have turned widdershins (north), and none the other way
        let north = 0;
        for (let i = 0; i < bullets.count; i++) {
            const slot = bullets.order[i];
            expect(bullets.vy[slot]).toBeGreaterThanOrEqual(-0.001);
            if (bullets.vy[slot] > 0.01) {
                north++;
            }
        }
        expect(north).toBeGreaterThan(0);
    });

    test("her husks turn up away from the player, walking, and hold once they arrive", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Husks")!;
        expect(attack.summon?.scatter).toBe(true);
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.1);
        const husks = sim.enemies.filter((e) => e.def.id.startsWith("phosani_husk"));
        expect(husks.length).toBe(2);
        for (const husk of husks) {
            expect(husk.def.stationary).toBeFalsy();
            expect(husk.speed).toBeGreaterThan(0);
            expect(Math.hypot(husk.x - sim.player.x, husk.y - sim.player.y)).toBeGreaterThan(5);
        }
        // Not held until one gets there
        expect(sim.hold).toBeUndefined();
        const [husk] = husks;
        husk.x = husk.prevX = sim.player.x + 0.6;
        husk.y = husk.prevY = sim.player.y;
        husk.attackCooldown = 0;
        sim.player.invulnerable = 0;
        run(sim, 0.2);
        expect(sim.hold?.enemies).toContain(husk);
        const { x, y } = sim.player;
        run(sim, 1, 1, 0);
        expect([sim.player.x, sim.player.y]).toEqual([x, y]);
        // Killing it lets go
        for (const one of husks) {
            sim.damageEnemy(one, 1e6, 0, one.x, one.y, 0);
        }
        run(sim, 0.2);
        expect(sim.hold).toBeUndefined();
        run(sim, 1, 1, 0);
        expect(sim.player.x).toBeGreaterThan(x);
    });

    test("she charges three times over, each lane picked afresh", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Surge")!;
        expect(attack.chain).toEqual({ times: 2, windup: 0.8 });
        boss.bossState!.chain = { attack, left: attack.chain!.times };
        sim["startBossAttack"](boss, attack);
        let surges = 0;
        let lanes = 0;
        let lastLane: unknown;
        for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            // Moving between charges, so each lane's somewhere else
            sim.step(i % 40 < 20 ? 1 : -1, 0);
            const state = boss.bossState!;
            const lane = state.windup?.lane ?? state.surge?.lane;
            if (lane && lane !== lastLane) {
                lanes++;
                lastLane = lane;
            }
            if (state.surge && state.surge.startTick === sim.tick) {
                surges++;
            }
        }
        expect(surges).toBe(3);
        expect(lanes).toBe(3);
        expect(boss.bossState!.chain).toBeUndefined();
    });

    test("her random claws leave ground to stand on, and come three times", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Grasping Claws (random)")!;
        expect(attack.ground!.spots).toEqual([{ shape: "scatter", count: 16, spread: 11 }]);
        boss.bossState!.chain = { attack, left: attack.chain!.times };
        sim["startBossAttack"](boss, attack);
        let rounds = 0;
        for (let i = 0; i < 6 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, 0);
            const windup = boss.bossState!.windup;
            if (windup?.attack === attack && windup.startTick === sim.tick) {
                rounds++;
            }
        }
        expect(rounds).toBe(2);
        // Each round's spots are round the player, with a way out between them
        const player = sim.player;
        sim["startBossAttack"](boss, attack);
        const spots = sim.hazards.filter((h) => h.attack === attack);
        expect(spots.length).toBe(16);
        for (const spot of spots) {
            expect(Math.hypot(spot.x - player.x, spot.y - player.y)).toBeLessThanOrEqual(11.1);
            // None on another: each is its own thing to step round
            for (const other of spots) {
                if (other !== spot) {
                    expect(Math.hypot(spot.x - other.x, spot.y - other.y)).toBeGreaterThan(
                        spot.radius * 2,
                    );
                }
            }
        }
        let clear = 0;
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            const x = player.x + Math.cos(angle) * 2.5;
            const y = player.y + Math.sin(angle) * 2.5;
            if (spots.every((s) => Math.hypot(s.x - x, s.y - y) > s.radius + player.radius)) {
                clear++;
            }
        }
        expect(clear).toBeGreaterThan(0);
    });

    test("for her flowers she takes the middle and keeps up her petals and claws", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Corpse Flowers")!;
        expect(attack.toMiddle).toBe(true);
        boss.x = boss.prevX = BASE + 10;
        boss.y = boss.prevY = BASE + 10;
        sim["startBossAttack"](boss, attack);
        expect(boss.x).toBeCloseTo(BASE + SIZE / 2, 0);
        expect(boss.y).toBeCloseTo(BASE + SIZE / 2, 0);
        const quarters = sim.quarters!;
        expect(Math.hypot(quarters.x - boss.x, quarters.y - boss.y)).toBeLessThanOrEqual(4.3);
        boss.attackCooldown = 0;
        const used = new Set<string>();
        const { x, y } = boss;
        for (let i = 0; i < 11 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            sim.player.x = BASE + SIZE / 2 - 1;
            sim.player.y = BASE + SIZE / 2 - 1;
            sim.step(0, 0);
            const name = boss.bossState!.windup?.attack.name;
            if (name) {
                used.add(name);
            }
        }
        for (const name of used) {
            expect(attack.quarters!.during!.attacks.concat("Corpse Flowers")).toContain(name);
        }
        expect(used.size).toBeGreaterThan(1);
        // She stood her ground among them
        expect([boss.x, boss.y]).toEqual([x, y]);
    });

    test("a closing ring has a way through, and a barrage follows the player", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const ring = phosani().boss!.attacks.find((a) => a.name === "Closing ring")!;
        sim["startBossAttack"](boss, ring);
        boss.attackCooldown = 1e9;
        run(sim, ring.windup + 0.1);
        const bullets = sim.bullets;
        expect(bullets.count).toBeLessThan(ring.pattern!.count);
        expect(bullets.count).toBeGreaterThan(ring.pattern!.count * 0.7);
        run(sim, 8);
        expect(bullets.count).toBe(0);

        const barrage = phosani().boss!.attacks.find((a) => a.name === "Barrage")!;
        expect(barrage.pattern!.track).toBe(true);
        sim.player.x = boss.x + 8;
        sim.player.y = boss.y;
        sim["startBossAttack"](boss, barrage);
        boss.attackCooldown = 1e9;
        run(sim, barrage.windup + 0.05);
        const east = bullets.order[0];
        expect(bullets.vx[east]).toBeGreaterThan(0);
        expect(Math.abs(bullets.vy[east])).toBeLessThan(0.01);
        sim.player.x = boss.x;
        sim.player.y = boss.y + 8;
        run(sim, 0.5);
        let north = 0;
        for (let i = 0; i < bullets.count; i++) {
            if (bullets.vy[bullets.order[i]] > 0.1) {
                north++;
            }
        }
        expect(north).toBeGreaterThan(0);
    });

    test("her orbs hunt the player", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const orbs = phosani().boss!.attacks.find((a) => a.name === "Hunting orbs")!;
        expect(orbs.kind).toBe("projectile");
        expect(orbs.homing).toBeGreaterThan(0);
        sim["startBossAttack"](boss, orbs);
        boss.attackCooldown = 1e9;
        run(sim, orbs.windup + 0.1);
        expect(sim.enemyProjectiles.length).toBe(3);
    });

    test("her parasites heal her and no one else", () => {
        for (const id of ["phosani_parasite", "phosani_parasite_weak"]) {
            expect(getEnemy(id).heals?.targets).toEqual(["phosanis_nightmare"]);
        }
    });
});
