import { getEnemy } from "../content/enemies";
import { BossAttackDef, EnemyDef, emptyStats } from "../content/types";
import { BulletPool, MAX_BULLETS } from "./BulletPool";
import { Sim, TICKS_PER_SECOND } from "./Sim";
import { Enemy, quarterOf } from "./entities";
import { makeGrid } from "./world/testGrid";

const BASE = 1000;

// An open square with a wall round it; size is tiles a side
function createSim(size = 64, seed = 1, characterId = "wizard"): Sim {
    const rows: string[] = [];
    for (let y = 0; y < size; y++) {
        let row = "";
        for (let x = 0; x < size; x++) {
            row += x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "#" : ".";
        }
        rows.push(row);
    }
    const sim = new Sim({
        grid: makeGrid(rows, BASE, BASE),
        mapId: "lumbridge",
        characterId,
        metaStats: emptyStats(),
        seed,
        spawnX: BASE + size / 2 + 0.5,
        spawnY: BASE + size / 2 + 0.5,
    });
    // Nothing of the player's getting in the way of what's tested
    sim.weapons = [];
    return sim;
}

function run(sim: Sim, seconds: number, moveX = 0, moveY = 0): void {
    const ticks = Math.round(seconds * TICKS_PER_SECOND);
    for (let i = 0; i < ticks && !sim.runOver; i++) {
        sim.step(moveX, moveY);
    }
}

function nightmare(): EnemyDef {
    return getEnemy("the_nightmare");
}

// She's up, the entrance is over, and she won't do anything she isn't told to
function startFight(sim: Sim, hp = 3000): Enemy {
    sim.startIntro(nightmare(), "finalBoss", hp);
    run(sim, nightmare().boss!.intro!.seconds + 0.1);
    const boss = sim.enemies.find((e) => e.finalBoss)!;
    boss.attackCooldown = 1e9;
    sim.takeEvents();
    return boss;
}

function attack(name: string): BossAttackDef {
    return nightmare().boss!.attacks.find((a) => a.name === name)!;
}

function use(sim: Sim, boss: Enemy, name: string): void {
    sim["startBossAttack"](boss, attack(name));
    boss.attackCooldown = 1e9;
}

function phaseOf(boss: Enemy) {
    return boss.bossState!.phase!;
}

function breakShield(sim: Sim, boss: Enemy): void {
    sim.damageEnemy(boss, phaseOf(boss).shield * 2, 0, boss.x, boss.y, 0);
}

function chargeTotems(sim: Sim, boss: Enemy): void {
    for (const totem of [...phaseOf(boss).totems]) {
        sim.damageEnemy(totem, totem.hp * 2, 0, totem.x, totem.y, 0);
    }
}

describe("a boss's entrance", () => {
    function crowd(sim: Sim, count: number): Enemy[] {
        const goblin = getEnemy("goblin");
        const enemies: Enemy[] = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const at = {
                x: sim.player.x + Math.cos(angle) * (3 + (i % 12)),
                y: sim.player.y + Math.sin(angle) * (3 + (i % 12)),
            };
            enemies.push(sim.spawnEnemy(goblin, "normal", at)!);
        }
        return enemies;
    }

    test("everything runs for the nearest edge and is gone, with nothing dropped", () => {
        const sim = createSim();
        const enemies = crowd(sim, 40);
        const starts = enemies.map((e) => ({ x: e.x, y: e.y }));
        sim.startIntro(nightmare(), "finalBoss", 3000);
        const kills = sim.kills;
        const hash = sim.pickups.length;
        run(sim, 0.5);
        enemies.forEach((enemy, i) => {
            expect(enemy.leaving).toBeDefined();
            const grid = sim.grid;
            const edges = [
                starts[i].x - grid.baseX,
                grid.baseX + grid.sizeX - starts[i].x,
                starts[i].y - grid.baseY,
                grid.baseY + grid.sizeY - starts[i].y,
            ];
            const nearest = edges.indexOf(Math.min(...edges));
            const moved = [
                starts[i].x - enemy.x,
                enemy.x - starts[i].x,
                starts[i].y - enemy.y,
                enemy.y - starts[i].y,
            ];
            expect(moved[nearest]).toBeGreaterThan(0);
        });
        run(sim, 6);
        expect(sim.enemies.some((e) => enemies.includes(e))).toBe(false);
        expect(sim.kills).toBe(kills);
        expect(sim.pickups.length).toBe(hash);
    });

    test("the player can't be hit, and what's running can't be hit either", () => {
        const sim = createSim();
        const enemies = crowd(sim, 10);
        sim.startIntro(nightmare(), "finalBoss", 3000);
        const hp = sim.player.hp;
        const fleeing = enemies[0];
        const before = fleeing.hp;
        for (let i = 0; i < 100; i++) {
            sim.step(0, 0);
            sim.damageEnemy(fleeing, 50, 0, 0, 0);
        }
        expect(fleeing.hp).toBe(before);
        expect(sim.player.hp).toBe(hp);
        run(sim, 6);
        expect(sim.player.hp).toBe(hp);
    });

    test("she rises partway through and can't be hurt until it's over", () => {
        const sim = createSim();
        const intro = nightmare().boss!.intro!;
        sim.startIntro(nightmare(), "finalBoss", 3000);
        run(sim, intro.riseAt - 0.1);
        expect(sim.enemies.some((e) => e.finalBoss)).toBe(false);
        run(sim, 0.2);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        expect(boss).toBeDefined();
        expect(sim.bossSpawned).toBe(true);
        expect(boss.anim).toBe("attack");
        expect(boss.attackSeq).toBe(intro.seq);
        const shield = phaseOf(boss).shield;
        sim.damageEnemy(boss, 100, 0, 0, 0);
        expect(phaseOf(boss).shield).toBe(shield);
        const { x, y } = boss;
        run(sim, intro.seconds - intro.riseAt - 0.3);
        expect([boss.x, boss.y]).toEqual([x, y]);
        expect(boss.bossState!.windup).toBeUndefined();
        expect(sim.intro).toBeDefined();
        run(sim, 0.4);
        expect(sim.intro).toBeUndefined();
        sim.damageEnemy(boss, 100, 0, 0, 0);
        expect(phaseOf(boss).shield).toBeLessThan(shield);
    });

    test("she never rises on top of the player, even at the arena's middle", () => {
        const sim = createSim();
        sim.startIntro(nightmare(), "finalBoss", 3000);
        run(sim, nightmare().boss!.intro!.riseAt + 0.1);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        const distance = nightmare().boss!.intro!.distance;
        expect(Math.hypot(boss.x - sim.player.x, boss.y - sim.player.y)).toBeCloseTo(distance, 0);
    });

    test("she rises on screen, on the arena's side, wherever the player is", () => {
        const sim = createSim(96);
        sim.player.x = BASE + 12;
        sim.player.y = BASE + 12;
        sim.startIntro(nightmare(), "finalBoss", 3000);
        run(sim, nightmare().boss!.intro!.riseAt + 0.1);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        expect(Math.hypot(boss.x - sim.player.x, boss.y - sim.player.y)).toBeLessThan(12);
        // Beside them, not above: the screen's wider than it's tall
        expect(boss.x).toBeGreaterThan(sim.player.x);
        expect(boss.y).toBeCloseTo(sim.player.y);
    });

    test("nothing else turns up while she's alone with the player", () => {
        const sim = createSim();
        const boss = startFight(sim);
        run(sim, 20);
        const others = sim.enemies.filter((e) => e !== boss && !e.totemOf);
        expect(others).toEqual([]);
    });

    test("any boss can have one", () => {
        const sim = createSim();
        const goblin = getEnemy("goblin");
        const def: EnemyDef = {
            ...goblin,
            id: "goblin_lord",
            boss: {
                attackInterval: 2,
                attacks: [],
                enrage: { message: "!" },
                intro: { seconds: 2, riseAt: 1, title: "Goblin Lord", distance: 5 },
            },
        };
        const minion = sim.spawnEnemy(goblin, "normal", { x: sim.player.x + 4, y: sim.player.y })!;
        sim.startIntro(def, "boss");
        expect(minion.leaving).toBeDefined();
        run(sim, 2.1);
        expect(sim.enemies.find((e) => e.def === def)).toBeDefined();
        expect(sim.intro).toBeUndefined();
        // It wasn't alone, so the waves go on
        run(sim, 10);
        expect(sim.enemies.length).toBeGreaterThan(1);
    });
});

describe("her phases", () => {
    test("four totems stand at the arena's corners, less the margin", () => {
        for (const size of [40, 64, 96]) {
            const sim = createSim(size);
            const boss = startFight(sim);
            const margin = nightmare().boss!.phases!.totems.margin;
            const corners = phaseOf(boss)
                .totems.map((t) => `${Math.round(t.x - BASE)},${Math.round(t.y - BASE)}`)
                .sort();
            const low = margin;
            const high = size - margin;
            expect(corners).toEqual(
                [`${low},${low}`, `${low},${high}`, `${high},${low}`, `${high},${high}`].sort(),
            );
        }
    });

    test("a map can name the square her fight uses", () => {
        const sim = createSim(96);
        sim.map.bossArena = { baseX: BASE + 20, baseY: BASE + 30, size: 40 };
        try {
            expect(sim.bossArena).toEqual({
                minX: BASE + 20,
                minY: BASE + 30,
                maxX: BASE + 60,
                maxY: BASE + 70,
            });
            const boss = startFight(sim);
            const xs = phaseOf(boss).totems.map((t) => Math.round(t.x - BASE));
            expect(Math.min(...xs)).toBe(26);
            expect(Math.max(...xs)).toBe(54);
        } finally {
            sim.map.bossArena = undefined;
        }
    });

    test("a fight in a named square brings the player in and keeps them there", () => {
        const sim = createSim(96);
        sim.map.bossArena = { baseX: BASE + 20, baseY: BASE + 30, size: 40 };
        try {
            sim.player.x = sim.player.prevX = BASE + 5.5;
            sim.player.y = sim.player.prevY = BASE + 5.5;
            const boss = startFight(sim, 1e6);
            expect(sim.player.x).toBeGreaterThan(BASE + 20);
            expect(sim.player.y).toBeGreaterThan(BASE + 30);
            run(sim, 30, -1, 0);
            expect(boss.dead).toBe(false);
            expect(sim.player.x).toBeGreaterThanOrEqual(BASE + 20);
        } finally {
            sim.map.bossArena = undefined;
        }
    });

    test("random events wait until she's dead", () => {
        const sim = createSim();
        startFight(sim, 1e6);
        for (let i = 0; i < 200 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, 0);
            expect(sim.visitor).toBeUndefined();
        }
    });

    test("hits go to her shield, not her hitpoints", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const shield = phaseOf(boss).shield;
        sim.damageEnemy(boss, 200, 0, boss.x, boss.y, 0);
        expect(phaseOf(boss).shield).toBeLessThan(shield);
        expect(boss.hp).toBe(boss.maxHp);
    });

    test("with the shield down she can't be hit, and the totems can", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const totem = phaseOf(boss).totems[0];
        const before = totem.hp;
        sim.damageEnemy(totem, 10, 0, totem.x, totem.y, 0);
        expect(totem.hp).toBe(before);
        breakShield(sim, boss);
        expect(phaseOf(boss).stage).toBe("totems");
        expect(sim.takeEvents().some((e) => e.type === "bossStage")).toBe(true);
        expect(totem.def.id).toBe("nightmare_totem_charging");
        sim.damageEnemy(boss, 500, 0, boss.x, boss.y, 0);
        expect(boss.hp).toBe(boss.maxHp);
        sim.damageEnemy(totem, 10, 0, totem.x, totem.y, 0);
        expect(totem.hp).toBeLessThan(before);
        expect(totem.dead).toBe(false);
    });

    test("weapons go for the totems rather than her once her shield's down", () => {
        const sim = createSim();
        const boss = startFight(sim);
        breakShield(sim, boss);
        const near = sim["nearestEnemies"](boss.x, boss.y, 100, 4);
        expect(near).not.toContain(boss);
        expect(near.filter((e) => e.totemOf === boss).length).toBe(4);
    });

    test("with the shield down, bolts fly on through her to a totem, with nothing shown on her", () => {
        const sim = createSim();
        const boss = startFight(sim);
        breakShield(sim, boss);
        sim.takeEvents();
        // A totem brought in behind her, the player in front: the bolt's path
        // runs through her
        const totem = phaseOf(boss).totems[0];
        totem.x = totem.prevX = boss.x + 4;
        totem.y = totem.prevY = boss.y;
        sim.player.x = sim.player.prevX = boss.x - 4;
        sim.player.y = sim.player.prevY = boss.y;
        sim.addWeapon("armadyl_crossbow");
        const charge = totem.hp;
        const blocked = boss.blockedTick;
        run(sim, 3);
        expect(sim.enemies.find((e) => e.finalBoss)).toBe(boss);
        expect(boss.blockedTick).toBe(blocked);
        expect(totem.hp).toBeLessThan(charge);
        const splats = sim
            .takeEvents()
            .filter((e) => e.type === "damage" && e.enemyUid === boss.uid);
        expect(splats).toEqual([]);
    });

    test("a charged totem stays charged and takes no more", () => {
        const sim = createSim();
        const boss = startFight(sim);
        breakShield(sim, boss);
        const [totem] = phaseOf(boss).totems;
        sim.damageEnemy(totem, totem.hp * 2, 0, totem.x, totem.y, 0);
        expect(totem.def.id).toBe("nightmare_totem_charged");
        expect(totem.dead).toBe(false);
        sim.damageEnemy(totem, 500, 0, totem.x, totem.y, 0);
        expect(totem.hp).toBe(0);
        expect(phaseOf(boss).stage).toBe("totems");
    });

    test("three blasts end her, a third of her hitpoints at a time", () => {
        const sim = createSim();
        const boss = startFight(sim, 3000);
        breakShield(sim, boss);
        chargeTotems(sim, boss);
        expect(boss.hp).toBe(2000);
        expect(phaseOf(boss).index).toBe(1);
        expect(phaseOf(boss).stage).toBe("shield");
        expect(phaseOf(boss).opener?.summon?.enemyId).toBe("sleepwalker");
        expect(phaseOf(boss).totems.every((t) => t.hp === t.maxHp)).toBe(true);
        breakShield(sim, boss);
        chargeTotems(sim, boss);
        expect(boss.hp).toBe(1000);
        expect(phaseOf(boss).index).toBe(2);
        breakShield(sim, boss);
        chargeTotems(sim, boss);
        expect(boss.dead).toBe(true);
        expect(sim.state).toBe("victory");
        expect(sim.bossesKilled).toContain("the_nightmare");
        expect(sim.enemies.filter((e) => e.totemOf && !e.dead)).toEqual([]);
        expect(sim.bullets.count).toBe(0);
    });

    test("each blast gives the player some hitpoints back, as nothing else will", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.hp = 5;
        breakShield(sim, boss);
        chargeTotems(sim, boss);
        const heal = nightmare().boss!.phases!.blastHeal!;
        expect(sim.player.hp).toBe(5 + Math.round(sim.player.maxHp * heal));
    });

    test("a phase's openers come first, and each phase has its own attacks", () => {
        const sim = createSim();
        const boss = startFight(sim);
        breakShield(sim, boss);
        chargeTotems(sim, boss);
        boss.attackCooldown = 0;
        sim.step(0, 0);
        expect(boss.bossState!.windup?.attack.name).toBe("Sleepwalkers");
        const byPhase = (phase: number) =>
            nightmare().boss!.attacks.filter((a) => !a.phases || a.phases.includes(phase));
        const names = (phase: number) => byPhase(phase).map((a) => a.name);
        expect(names(1)).toEqual(expect.arrayContaining(["Husks", "Corpse Flowers"]));
        expect(names(1)).not.toContain("Surge");
        expect(names(2)).toEqual(expect.arrayContaining(["Curse", "Parasites"]));
        expect(names(3)).toEqual(expect.arrayContaining(["Spores", "Surge"]));
        for (const phase of [1, 2, 3]) {
            expect(names(phase)).toEqual(
                expect.arrayContaining(["Ranged", "Magic", "Melee", "Grasping Claws"]),
            );
        }
    });

    test("the bot nuke doesn't kill a totem", () => {
        const sim = createSim();
        const boss = startFight(sim);
        breakShield(sim, boss);
        sim["nuke"](0.5);
        expect(phaseOf(boss).totems.every((t) => !t.dead)).toBe(true);
    });
});

describe("the Surge", () => {
    function surge(sim: Sim, boss: Enemy) {
        use(sim, boss, "Surge");
        return boss.bossState!.windup!;
    }

    test("she goes to an edge, and the lane runs right across, through the player", () => {
        for (let seed = 1; seed <= 12; seed++) {
            const sim = createSim(64, seed);
            const boss = startFight(sim);
            const { lane } = surge(sim, boss);
            const across = Math.max(
                Math.abs(lane!.toX - lane!.fromX),
                Math.abs(lane!.toY - lane!.fromY),
            );
            expect(across).toBeGreaterThan(60);
            expect([boss.x, boss.y]).toEqual([lane!.fromX, lane!.fromY]);
            const alongX = lane!.fromY === lane!.toY;
            if (alongX) {
                expect(lane!.fromY).toBeCloseTo(sim.player.y);
            } else {
                expect(lane!.fromX).toBeCloseTo(sim.player.x);
            }
        }
    });

    test("the lane is up for the whole of its wind-up, and stays put", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const windup = surge(sim, boss);
        const lane = { ...windup.lane! };
        const ticks = windup.landTick - windup.startTick;
        expect(ticks / TICKS_PER_SECOND).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < ticks - 1; i++) {
            sim.step(1, 0);
            expect(boss.bossState!.windup?.lane).toEqual(lane);
        }
    });

    test("it hits whoever stays in the lane, once", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 200;
        surge(sim, boss);
        const hp = sim.player.hp;
        run(sim, attack("Surge").windup + 3);
        expect(hp - sim.player.hp).toBe(attack("Surge").damage);
    });

    test("stepping out of the lane in time dodges it", () => {
        for (let seed = 1; seed <= 6; seed++) {
            const sim = createSim(64, seed);
            const boss = startFight(sim);
            sim.player.maxHp = sim.player.hp = 200;
            const { lane } = surge(sim, boss);
            const alongX = lane!.fromY === lane!.toY;
            const hp = sim.player.hp;
            // Straight out, the way a person would: the wind-up is time enough
            run(sim, attack("Surge").windup, alongX ? 0 : 1, alongX ? 1 : 0);
            run(sim, 3);
            expect(sim.player.hp).toBe(hp);
        }
    });

    test("she goes all the way to the far side", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const { lane } = surge(sim, boss);
        run(sim, attack("Surge").windup + 0.1);
        expect(boss.bossState!.surge).toBeDefined();
        let last = { x: boss.x, y: boss.y };
        while (boss.bossState!.surge) {
            last = { x: boss.x, y: boss.y };
            sim.step(0, 0);
        }
        expect(Math.hypot(last.x - lane!.toX, last.y - lane!.toY)).toBeLessThan(2);
    });

    test("she leashes back after one, on any arena", () => {
        const sim = createSim(96);
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 500;
        surge(sim, boss);
        run(sim, attack("Surge").windup + 5);
        const leash = nightmare().boss!.leash!;
        expect(Math.hypot(boss.x - sim.player.x, boss.y - sim.player.y)).toBeLessThanOrEqual(
            leash.distance + 1,
        );
    });
});

describe("the Curse", () => {
    function cursed(seed = 1) {
        const sim = createSim(64, seed);
        const boss = startFight(sim);
        use(sim, boss, "Curse");
        run(sim, attack("Curse").windup + 0.1);
        return { sim, boss };
    }

    test("shuffles the controls, keys and the stick alike", () => {
        for (let seed = 1; seed <= 8; seed++) {
            const { sim } = cursed(seed);
            expect(sim.curse).toBeDefined();
            const [a, b, c, d] = sim.curse!.matrix;
            // A diagonal of the stick, at less than full length
            const moveX = 0.3;
            const moveY = 0.4;
            const { x, y } = sim.player;
            sim.step(moveX, moveY);
            const movedX = sim.player.x - x;
            const movedY = sim.player.y - y;
            const length = Math.hypot(movedX, movedY);
            expect(length).toBeGreaterThan(0);
            expect(movedX / length).toBeCloseTo((moveX * a + moveY * b) / 0.5, 3);
            expect(movedY / length).toBeCloseTo((moveX * c + moveY * d) / 0.5, 3);
            // Never just what was pressed
            expect([a, b, c, d]).not.toEqual([1, 0, 0, 1]);
        }
    });

    test("lifts after five attacks", () => {
        const { sim, boss } = cursed();
        for (let i = 0; i < 5; i++) {
            expect(sim.curse).toBeDefined();
            sim["startBossAttack"](boss, attack("Melee"));
            boss.bossState!.windup = undefined;
        }
        expect(sim.curse).toBeUndefined();
        const { x } = sim.player;
        run(sim, 0.1, 1, 0);
        expect(sim.player.x).toBeGreaterThan(x);
    });
});

describe("Husks", () => {
    function held(seed = 1) {
        const sim = createSim(64, seed);
        const boss = startFight(sim);
        use(sim, boss, "Husks");
        run(sim, attack("Husks").windup + 0.1);
        return { sim, boss };
    }

    test("one of each appears beside the player, who can't move until they're dead", () => {
        const { sim } = held();
        const husks = sim.enemies.filter((e) => e.def.id.startsWith("husk_"));
        expect(husks.map((h) => h.def.id).sort()).toEqual(["husk_magic", "husk_ranged"]);
        for (const husk of husks) {
            expect(Math.hypot(husk.x - sim.player.x, husk.y - sim.player.y)).toBeLessThan(3);
        }
        const { x } = sim.player;
        run(sim, 1, 1, 0);
        expect(sim.player.x).toBe(x);
        for (const husk of husks) {
            sim.damageEnemy(husk, 1e6, 0, husk.x, husk.y, 0);
        }
        run(sim, 0.2, 1, 0);
        expect(sim.player.x).toBeGreaterThan(x);
    });

    test("she holds off while they're held, and it can't last forever", () => {
        const { sim, boss } = held();
        boss.attackCooldown = 0;
        run(sim, 2);
        expect(boss.bossState!.windup).toBeUndefined();
        expect(sim.hazards).toEqual([]);
        boss.attackCooldown = 1e9;
        sim.player.maxHp = sim.player.hp = 500;
        run(sim, attack("Husks").summon!.holds!);
        expect(sim.hold).toBeUndefined();
    });

    test("a held player can still turn to hit what's holding them", () => {
        const { sim } = held();
        sim.step(0, 1);
        expect(sim.player.facingY).toBeCloseTo(1);
    });
});

describe("Corpse Flowers", () => {
    function flowers() {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 500;
        use(sim, boss, "Corpse Flowers");
        return { sim, boss, quarters: sim.quarters! };
    }

    test("they're up before they hurt, for long enough to reach the safe quarter", () => {
        for (let seed = 1; seed <= 10; seed++) {
            const sim = createSim(64, seed);
            const boss = startFight(sim);
            use(sim, boss, "Corpse Flowers");
            const quarters = sim.quarters!;
            const warning = (quarters.hurtTick - sim.tick) / TICKS_PER_SECOND;
            // The far corner of the lines from the player, at walking speed
            const def = attack("Corpse Flowers").quarters!;
            const walk = (Math.hypot(def.offset, def.offset) * 2) / (2 / 0.6);
            expect(warning).toBeGreaterThan(walk);
        }
    });

    test("the safe quarter is safe, and the rest hurt and feed her shield", () => {
        const { sim, boss, quarters } = flowers();
        const inQuarter = (quarter: number) => ({
            x: quarters.x + (quarter & 1 ? 2 : -2),
            y: quarters.y + (quarter & 2 ? 2 : -2),
        });
        phaseOf(boss).shield = phaseOf(boss).shieldMax / 2;
        const shield = phaseOf(boss).shield;
        const hp = sim.player.hp;
        Object.assign(sim.player, inQuarter(quarters.safe));
        expect(quarterOf(quarters.x, quarters.y, sim.player.x, sim.player.y)).toBe(quarters.safe);
        run(sim, attack("Corpse Flowers").windup + 2);
        expect(sim.player.hp).toBe(hp);
        expect(phaseOf(boss).shield).toBe(shield);
        Object.assign(sim.player, inQuarter((quarters.safe + 1) % 4));
        run(sim, 2);
        expect(sim.player.hp).toBeLessThan(hp);
        expect(phaseOf(boss).shield).toBeGreaterThan(shield);
    });

    test("they go when they've run their time", () => {
        const { sim } = flowers();
        const seconds =
            attack("Corpse Flowers").windup + attack("Corpse Flowers").quarters!.seconds;
        run(sim, seconds + 0.1);
        expect(sim.quarters).toBeUndefined();
    });
});

describe("parasites", () => {
    function infested(cured = false) {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 100;
        if (cured) {
            sim.buffs.push({
                itemId: "antidote",
                stats: {},
                cures: true,
                startTick: sim.tick,
                endTick: sim.tick + 1e6,
            });
        }
        use(sim, boss, "Parasites");
        run(sim, attack("Parasites").windup + 0.1);
        return { sim, boss };
    }

    test("the mark bursts after 10.8 seconds for a big hit and leaves one behind", () => {
        const { sim } = infested();
        expect(sim.parasite).toBeDefined();
        run(sim, 10.5);
        expect(sim.parasite).toBeDefined();
        expect(sim.player.hp).toBe(100);
        run(sim, 0.4);
        expect(sim.parasite).toBeUndefined();
        expect(sim.player.hp).toBe(100 - attack("Parasites").damage);
        expect(sim.enemies.some((e) => e.def.id === "nightmare_parasite")).toBe(true);
    });

    test("an antidote weakens it", () => {
        const { sim } = infested(true);
        run(sim, 11);
        expect(sim.player.hp).toBe(100 - Math.round(attack("Parasites").damage / 2));
        expect(sim.enemies.some((e) => e.def.id === "nightmare_parasite_weak")).toBe(true);
    });

    test("what's left feeds her shield until it's killed", () => {
        const { sim, boss } = infested();
        run(sim, 11);
        phaseOf(boss).shield = phaseOf(boss).shieldMax / 2;
        const shield = phaseOf(boss).shield;
        sim.player.hp = sim.player.maxHp = 1000;
        run(sim, 25);
        expect(phaseOf(boss).shield).toBeGreaterThan(shield);
        const parasite = sim.enemies.find((e) => e.def.id === "nightmare_parasite")!;
        sim.damageEnemy(parasite, 1e6, 0, parasite.x, parasite.y, 0);
        expect(parasite.dead).toBe(true);
        const fed = phaseOf(boss).shield;
        run(sim, 8);
        expect(phaseOf(boss).shield).toBe(fed);
    });
});

describe("Sleepwalkers", () => {
    function walkers() {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 200;
        use(sim, boss, "Sleepwalkers");
        run(sim, attack("Sleepwalkers").windup + 0.1);
        return { sim, boss };
    }

    test("they walk to her, and each that gets there makes her blast bigger", () => {
        const { sim, boss } = walkers();
        const count = attack("Sleepwalkers").summon!.count;
        const def = attack("Sleepwalkers").summon!.walkTo!;
        expect(sim.enemies.filter((e) => e.walksTo === boss).length).toBe(count);
        run(sim, 12);
        expect(sim.enemies.some((e) => e.walksTo === boss)).toBe(false);
        expect(boss.bossState!.walkers).toBeUndefined();
        const blast = attack("Sleepwalkers").damage + count * def.perAbsorbed;
        expect(sim.player.hp).toBe(200 - Math.round(blast));
    });

    test("kill them all and it's barely a scratch", () => {
        const { sim, boss } = walkers();
        for (const walker of sim.enemies.filter((e) => e.walksTo === boss)) {
            sim.damageEnemy(walker, 1e6, 0, walker.x, walker.y, 0);
        }
        run(sim, 0.2);
        expect(sim.player.hp).toBe(200 - attack("Sleepwalkers").damage);
    });

    test("they count for their quest, and drop nothing worth having", () => {
        const { sim, boss } = walkers();
        for (const walker of sim.enemies.filter((e) => e.walksTo === boss)) {
            sim.damageEnemy(walker, 1e6, 0, walker.x, walker.y, 0);
        }
        expect(sim.enemyKills.sleepwalker).toBe(attack("Sleepwalkers").summon!.count);
        expect(sim.pickups.every((p) => p.kind === "bones" && p.value === 0)).toBe(true);
    });

    test("any hit kills one, and she doesn't attack until it's settled", () => {
        const { sim, boss } = walkers();
        const walker = sim.enemies.find((e) => e.walksTo === boss)!;
        sim.damageEnemy(walker, 1, 0, walker.x, walker.y, 0);
        expect(walker.dead).toBe(true);
        boss.attackCooldown = 0;
        run(sim, 2);
        expect(boss.bossState!.windup).toBeUndefined();
    });
});

describe("spores", () => {
    test("wait on the ground, and go off under the player, slowing them and speeding her", () => {
        const sim = createSim();
        const boss = startFight(sim);
        use(sim, boss, "Spores");
        expect(sim.hazards.length).toBe(12);
        run(sim, attack("Spores").windup + 0.2);
        expect(sim.hazards.length).toBeGreaterThan(0);
        expect(sim.hazards.every((h) => h.armed)).toBe(true);

        const speed = () => {
            const { x, y } = sim.player;
            sim.step(1, 0);
            return Math.hypot(sim.player.x - x, sim.player.y - y);
        };
        sim.player.x = BASE + 20;
        sim.player.y = BASE + 20;
        const before = speed();
        sim.hazards = sim.hazards.slice(0, 1);
        sim.hazards[0].x = sim.player.x + 0.5;
        sim.hazards[0].y = sim.player.y;
        const hp = sim.player.hp;
        run(sim, 0.5);
        expect(sim.hazards).toEqual([]);
        expect(sim.player.hp).toBe(hp);
        expect(sim.debuffs.some((d) => d.id === "spores")).toBe(true);
        expect(speed()).toBeLessThan(before);

        boss.attackCooldown = 0;
        run(sim, 0.1);
        const interval = nightmare().boss!.attackInterval * TICKS_PER_SECOND;
        expect(boss.attackCooldown).toBeLessThan(interval * 0.8);
    });

    test("left alone, they go by themselves", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.x = BASE + 8;
        sim.player.y = BASE + 8;
        use(sim, boss, "Spores");
        for (const hazard of sim.hazards) {
            hazard.x = BASE + 40;
            hazard.y = BASE + 40;
        }
        run(sim, attack("Spores").windup + attack("Spores").ground!.armed! + 0.1);
        expect(sim.hazards).toEqual([]);
    });
});

describe("what's dodged on the ground", () => {
    test("Grasping Claws are marked before they land, and only hit on the marks", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 100;
        use(sim, boss, "Grasping Claws");
        const def = attack("Grasping Claws");
        expect(sim.hazards.length).toBe(1 + 8 + 12);
        // Between the rings, and between the marks on each
        const safeX = boss.x + Math.cos(0.26) * 6;
        const safeY = boss.y + Math.sin(0.26) * 6;
        const clear = sim.hazards.every(
            (h) => Math.hypot(h.x - safeX, h.y - safeY) > h.radius + sim.player.radius,
        );
        expect(clear).toBe(true);
        sim.player.x = safeX;
        sim.player.y = safeY;
        run(sim, def.windup + 0.1);
        expect(sim.hazards).toEqual([]);
        expect(sim.player.hp).toBe(100);

        use(sim, boss, "Grasping Claws");
        const spot = sim.hazards[3];
        sim.player.x = spot.x;
        sim.player.y = spot.y;
        run(sim, def.windup + 0.1);
        expect(sim.player.hp).toBe(100 - def.damage);
    });

    test("the around-you claws always leave somewhere to stand", () => {
        const sim = createSim();
        const boss = startFight(sim);
        use(sim, boss, "Grasping Claws (around you)");
        const { spacing } = attack("Grasping Claws (around you)").ground!.spots[0] as {
            spacing: number;
        };
        const radius = attack("Grasping Claws (around you)").ground!.radius;
        expect(spacing / Math.SQRT2).toBeGreaterThan(radius + sim.player.radius);
    });

    test("Melee hits in front and under her, and not beside her", () => {
        const swing = (dx: number, dy: number, faceX: number, faceY: number) => {
            const sim = createSim();
            const boss = startFight(sim);
            sim.player.maxHp = sim.player.hp = 100;
            sim.player.x = boss.x + faceX * 3;
            sim.player.y = boss.y + faceY * 3;
            use(sim, boss, "Melee");
            sim.player.x = boss.x + dx;
            sim.player.y = boss.y + dy;
            run(sim, attack("Melee").windup + 0.1);
            return 100 - sim.player.hp;
        };
        const damage = attack("Melee").damage;
        // In front, under her, and behind her
        expect(swing(4, 0, 1, 0)).toBe(damage);
        expect(swing(1, 0.5, 1, 0)).toBe(damage);
        expect(swing(-4, 0, 1, 0)).toBe(0);
        // Beside her, in reach but out of the wedge
        expect(swing(0, 4, 1, 0)).toBe(0);
    });

    test("every attack that can be dodged by walking gives time to walk", () => {
        for (const a of nightmare().boss!.attacks) {
            if (["ground", "surge", "pattern", "quarters"].includes(a.kind)) {
                expect(a.windup).toBeGreaterThanOrEqual(1.2);
            }
        }
    });
});

describe("bullet patterns", () => {
    test("a spread's a fan at the player, a ring's all round, a spiral turns", () => {
        for (const name of ["Ranged", "Magic", "Petal ring"]) {
            const sim = createSim();
            const boss = startFight(sim);
            sim.player.maxHp = sim.player.hp = 1e6;
            const def = attack(name);
            const pattern = def.pattern!;
            use(sim, boss, name);
            run(sim, def.windup + pattern.interval / 2);
            expect(sim.bullets.count).toBe(pattern.count);
            const angles: number[] = [];
            for (let i = 0; i < sim.bullets.count; i++) {
                const slot = sim.bullets.order[i];
                angles.push(Math.atan2(sim.bullets.vy[slot], sim.bullets.vx[slot]));
            }
            if (pattern.shape === "spread") {
                const aim = Math.atan2(sim.player.y - boss.y, sim.player.x - boss.x);
                const off = angles.map((a) => Math.atan2(Math.sin(a - aim), Math.cos(a - aim)));
                expect(Math.max(...off)).toBeCloseTo(pattern.arc! / 2, 1);
                expect(Math.min(...off)).toBeCloseTo(-pattern.arc! / 2, 1);
            } else {
                const sorted = [...angles].sort((a, b) => a - b);
                const gap = (Math.PI * 2) / pattern.count;
                for (let i = 1; i < sorted.length; i++) {
                    expect(sorted[i] - sorted[i - 1]).toBeCloseTo(gap, 1);
                }
            }
        }
    });

    test("a volley can be walked through: there's a gap wider than the player", () => {
        for (const name of ["Ranged", "Magic", "Petal ring"]) {
            const def = attack(name);
            const pattern = def.pattern!;
            const gap =
                pattern.shape === "spread"
                    ? pattern.arc! / (pattern.count - 1)
                    : (Math.PI * 2) / pattern.count;
            // Tiles between bullets a third of the way out
            const apart = gap * (pattern.range / 3);
            const sim = createSim();
            expect(apart).toBeGreaterThan(pattern.radius * 2 + sim.player.radius * 2);
        }
    });

    test("she stands still while a pattern goes out", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.x = boss.x + 12;
        use(sim, boss, "Magic");
        run(sim, attack("Magic").windup + 0.05);
        const { x, y } = boss;
        run(sim, 2);
        expect([boss.x, boss.y]).toEqual([x, y]);
    });

    test("a bullet that hits costs the one hit, and the next pass through for a moment", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.maxHp = sim.player.hp = 100;
        sim["startBossAttack"](boss, {
            ...attack("Petal ring"),
            windup: 0,
            pattern: {
                ...attack("Petal ring").pattern!,
                count: 200,
                volleys: 1,
                speed: 40,
                radius: 1,
            },
        });
        boss.attackCooldown = 1e9;
        sim.player.x = boss.x + 3;
        sim.player.y = boss.y;
        run(sim, 0.3);
        expect(sim.player.hp).toBe(100 - attack("Petal ring").damage);
    });

    test("the same seed plays out the same, bullets and all", () => {
        const play = () => {
            const sim = createSim(64, 9);
            const boss = startFight(sim);
            sim.player.maxHp = sim.player.hp = 1e6;
            boss.attackCooldown = 0;
            run(sim, 60, 0.6, -0.8);
            return {
                tick: sim.tick,
                bullets: sim.bullets.count,
                hp: sim.player.hp,
                x: boss.x,
                y: boss.y,
                rng: sim.rng.int(1 << 30),
            };
        };
        expect(play()).toEqual(play());
    });
});

describe("her real assets", () => {
    test("everything she fires or marks the ground with is a real model", () => {
        for (const a of nightmare().boss!.attacks) {
            if (a.pattern) {
                expect(a.spotAnim).toBeDefined();
            }
            if (a.ground) {
                expect(a.ground.spotAnim ?? a.ground.locId).toBeDefined();
            }
            if (a.parasite) {
                expect(a.spotAnim).toBeDefined();
            }
        }
    });
});

describe("the bullet pool", () => {
    function add(pool: BulletPool, x: number, vx = 0, life = 100): number {
        return pool.add(x, 0, vx, 0, 0, 0.25, 1, life, 0, 0);
    }
    const at = (x: number, y: number, spare = false) => ({ x, y, radius: 0.1, spare });

    test("spent bullets' slots are used again", () => {
        const pool = new BulletPool();
        for (let round = 0; round < 5; round++) {
            for (let i = 0; i < MAX_BULLETS; i++) {
                expect(add(pool, 100, 0, 2)).toBeGreaterThanOrEqual(0);
            }
            expect(pool.count).toBe(MAX_BULLETS);
            pool.step([at(0, 0)]);
            pool.step([at(0, 0)]);
            expect(pool.count).toBe(0);
        }
    });

    test("it stops at its size rather than growing", () => {
        const pool = new BulletPool();
        for (let i = 0; i < MAX_BULLETS; i++) {
            add(pool, 100);
        }
        expect(add(pool, 100)).toBe(-1);
        expect(pool.count).toBe(MAX_BULLETS);
    });

    test("every bullet moves, whichever ones go", () => {
        const pool = new BulletPool();
        const slots = [
            add(pool, 0, 1, 1),
            add(pool, 10, 1, 5),
            add(pool, 20, 1, 1),
            add(pool, 30, 1, 5),
        ];
        pool.step([at(1000, 1000)]);
        expect(pool.count).toBe(2);
        expect(pool.x[slots[1]]).toBe(11);
        expect(pool.x[slots[3]]).toBe(31);
    });

    test("a hit spends the bullet and says which; sparing the target leaves them", () => {
        const pool = new BulletPool();
        const slot = add(pool, 0);
        pool.step([at(0, 0, true)]);
        expect(pool.hits).toEqual([-1]);
        expect(pool.count).toBe(1);
        pool.step([at(0, 0)]);
        expect(pool.hits).toEqual([slot]);
        expect(pool.count).toBe(0);
    });

    test("each player is hit by one at most, and a bullet hits one at most", () => {
        const pool = new BulletPool();
        const first = add(pool, 0);
        const second = add(pool, 0);
        add(pool, 50);
        pool.step([at(0, 0), at(0, 0), at(0, 0)]);
        expect(pool.hits).toEqual([first, second, -1]);
        expect(pool.count).toBe(1);
    });

    test("it curves", () => {
        const pool = new BulletPool();
        const slot = pool.add(0, 0, 1, 0, Math.PI / 2, 0.25, 1, 100, 0, 0);
        pool.step([at(1000, 1000)]);
        expect(pool.vx[slot]).toBeCloseTo(0);
        expect(pool.vy[slot]).toBeCloseTo(1);
    });
});

describe("bullet sources", () => {
    test("a dead boss's slot is freed once its bullets are gone, for the next to take", () => {
        const sim = createSim();
        sim.player.maxHp = sim.player.hp = 1e6;
        const def = attack("Ranged");
        const pattern = def.pattern!;
        const fight = (): Enemy => {
            sim.startIntro(nightmare(), "boss", 3000);
            run(sim, nightmare().boss!.intro!.seconds + 0.1);
            const boss = sim.enemies.find((e) => e.def.id === "the_nightmare" && !e.dead)!;
            boss.attackCooldown = 1e9;
            use(sim, boss, "Ranged");
            run(sim, def.windup + pattern.interval / 2);
            return boss;
        };
        const first = fight();
        expect(sim.bullets.count).toBeGreaterThan(0);
        expect(sim.bulletSources).toEqual([{ attack: def, enemy: first }]);

        // Gone with bullets still in the air: they still need their source
        sim["vanish"](first);
        sim["freeBulletSources"]();
        expect(sim.bulletSources).toEqual([{ attack: def, enemy: first }]);

        run(sim, pattern.range / pattern.speed + pattern.volleys * pattern.interval + 1);
        expect(sim.bullets.count).toBe(0);
        const second = fight();
        expect(second).not.toBe(first);
        expect(sim.bulletSources).toEqual([{ attack: def, enemy: second }]);
        // A bullet in the air points at the slot's new owner
        const slot = sim.bullets.order[0];
        expect(sim.bulletSources[sim.bullets.source[slot]]!.enemy).toBe(second);
    });
});
