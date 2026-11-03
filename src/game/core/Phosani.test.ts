import { getCharacter } from "../content/characters";
import { getEnemy } from "../content/enemies";
import { getMap } from "../content/maps";
import { emptyStats } from "../content/types";
import { WEAPONS } from "../content/weapons";
import { SANCTUARY_BOSS_ARENA } from "../scaperune/maps/sisterhoodSanctuary";
import { yawFromVector } from "./PlayerMovement";
import { Sim, TICKS_PER_SECOND } from "./Sim";
import { Enemy } from "./entities";
import { createSave } from "./save";
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
// Through her entrance, to the fight proper, with whatever she opened with
// (she comes at the player the moment they're let go) cleared away
function startFight(sim: Sim): Enemy {
    run(sim, phosani().boss!.intro!.seconds + 0.2);
    const boss = sim.enemies.find((e) => e.finalBoss)!;
    boss.attackCooldown = 1e9;
    const state = boss.bossState!;
    state.windup = undefined;
    state.chain = undefined;
    state.follow = undefined;
    state.leap = undefined;
    state.channelEnd = 0;
    sim.hazards = [];
    sim.bullets.clear();
    sim["emitters"] = [];
    // Back where she rose, if an opening charge took her to an edge
    boss.x = boss.prevX = sim.player.x;
    boss.y = boss.prevY = sim.player.y + phosani().boss!.intro!.distance;
    boss.vx = boss.vy = 0;
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
        // The player starts where her entrance stands them: south of the
        // middle of her square, where she rises
        const intro = phosani().boss!.intro!;
        expect(intro.atMiddle).toBe(true);
        expect(map.spawn).toEqual({
            x: SANCTUARY_BOSS_ARENA.baseX + 32,
            y: SANCTUARY_BOSS_ARENA.baseY + 32 - intro.distance,
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
        // Hers alone: never unlocked for the roster, and not in a new save's
        expect(inquisitor.unlock).toBeUndefined();
        expect(inquisitor.only).toBe("phosani");
        expect(createSave().unlockedCharacters).not.toContain("inquisitor");
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

    test("she rises at the middle of her square, the player south of her and rooted till she's up", () => {
        const sim = createSim();
        sim.map.bossArena = { baseX: BASE, baseY: BASE, size: SIZE };
        const intro = phosani().boss!.intro!;
        expect(intro.holds).toBe(true);
        run(sim, intro.riseAt + 0.1);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        expect(boss.x).toBeCloseTo(BASE + SIZE / 2, 0);
        expect(boss.y).toBeCloseTo(BASE + SIZE / 2, 0);
        expect(sim.player.x).toBeCloseTo(boss.x, 0);
        expect(boss.y - sim.player.y).toBeCloseTo(intro.distance, 0);
        // Pushing the stick does nothing but turn them until she's up
        const { x, y } = sim.player;
        run(sim, 1, 1, 0);
        expect([sim.player.x, sim.player.y]).toEqual([x, y]);
        expect(sim.player.facingX).toBeCloseTo(1);
        run(sim, intro.seconds - intro.riseAt - 1 + 0.1);
        expect(sim.intro).toBeUndefined();
        run(sim, 0.5, 1, 0);
        expect(sim.player.x).toBeGreaterThan(x);
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
        // A breath, not a bar
        const heal = phosani().boss!.phases!.blastHeal!;
        expect(heal).toBeLessThanOrEqual(0.15);
        expect(sim.player.hp).toBe(1 + Math.round(sim.player.maxHp * heal));
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
        // And her claw lands on the player in her last phase, with its ring
        // round them, not round her
        const claw = attacks.find((a) => a.name === "Grasping Claws (on you)")!;
        expect(claw.phases).toEqual([3]);
        expect(claw.ground!.spots[0]).toEqual({ shape: "player" });
        expect(claw.ground!.spots[1]).toMatchObject({ shape: "ring", around: "player" });
        expect(claw.weight).toBeLessThan(attacks.find((a) => a.name === "Grasping Claws")!.weight);
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.x = sim.player.prevX = boss.x + 12;
        sim.player.y = sim.player.prevY = boss.y;
        sim["startBossAttack"](boss, claw);
        const ring = claw.ground!.spots[1] as { count: number; distance: number };
        expect(sim.hazards.length).toBe(1 + ring.count);
        for (const mark of sim.hazards) {
            expect(Math.hypot(mark.x - sim.player.x, mark.y - sim.player.y)).toBeLessThanOrEqual(
                ring.distance + 0.01,
            );
        }
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
            expect(husk.def.shot).toBeUndefined();
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
        // Only the chain's: started by hand, it's not on cooldown, and she
        // could pick it again after
        boss.bossState!.cooldowns[phosani().boss!.attacks.indexOf(attack)] = 1e9;
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

    test("her random claws leave ground to stand on, and come twice", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Grasping Claws (random)")!;
        expect(attack.ground!.spots).toEqual([{ shape: "scatter", count: 24, spread: 11 }]);
        expect(attack.chain).toEqual({ times: 1, windup: 0.9 });
        // Not picked again by chance once the chain's done: only its links count
        boss.bossState!.cooldowns[phosani().boss!.attacks.indexOf(attack)] = 1e9;
        boss.bossState!.chain = { attack, left: attack.chain!.times };
        sim["startBossAttack"](boss, attack);
        // Each round waits for the last one's hands to go down
        let rounds = 0;
        for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, 0);
            const windup = boss.bossState!.windup;
            if (windup?.attack === attack && windup.startTick === sim.tick) {
                rounds++;
            }
        }
        expect(rounds).toBe(attack.chain!.times);
        // Each round's spots are round the player, with a way out between them
        const player = sim.player;
        sim["startBossAttack"](boss, attack);
        const spots = sim.hazards.filter((h) => h.attack === attack);
        expect(spots.length).toBe(24);
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
        // Down where she was, and up at the middle, with the flowers growing
        // from the start: the lines are known well before they hurt
        const jump = phosani().boss!.leash!.jump!;
        const state = boss.bossState!;
        expect(state.leap).toBeDefined();
        expect(boss.attackSeq).toBe(jump.downSeq);
        expect(state.windup!.landTick - sim.tick).toBe(
            Math.round((attack.windup + 2 * jump.seconds) * TICKS_PER_SECOND),
        );
        const quarters = sim.quarters!;
        const middle = { x: BASE + SIZE / 2, y: BASE + SIZE / 2 };
        expect(Math.hypot(quarters.x - middle.x, quarters.y - middle.y)).toBeLessThanOrEqual(4.3);
        expect(boss.x).toBe(BASE + 10);
        sim.player.invulnerable = 1e9;
        // By the middle, so she's never leashed off to the player meanwhile
        sim.player.x = sim.player.prevX = BASE + SIZE / 2 - 1;
        sim.player.y = sim.player.prevY = BASE + SIZE / 2 - 1;
        run(sim, 2 * jump.seconds + 0.1);
        expect(state.leap).toBeUndefined();
        expect(boss.x).toBeCloseTo(middle.x, 0);
        expect(boss.y).toBeCloseTo(middle.y, 0);
        // Then her flowers' animation, to the end of their windup
        expect(boss.anim).toBe("attack");
        expect(boss.attackSeq).toBe(attack.seq);
        expect(state.windup?.attack).toBe(attack);
        expect(sim.quarters).toBe(quarters);
        run(sim, attack.windup + 0.1);
        expect(state.windup?.attack).not.toBe(attack);
        boss.attackCooldown = 0;
        const used = new Set<string>();
        const { x, y } = boss;
        // While the flowers stand (and not after, when a charge may take her off)
        for (let i = 0; i < (attack.quarters!.seconds - 0.5) * TICKS_PER_SECOND; i++) {
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

    test("her parasites heal her or a totem's charge, and no one else, quick and a lot", () => {
        for (const id of ["phosani_parasite", "phosani_parasite_weak"]) {
            const def = getEnemy(id);
            expect(def.heals?.targets).toEqual(["phosanis_nightmare", "phosani_totem_charging"]);
            expect(def.speed).toBeGreaterThanOrEqual(3.5);
            expect(def.heals?.fraction).toBeGreaterThanOrEqual(0.15);
            expect(def.heals?.interval).toBeLessThanOrEqual(2);
            expect(def.heals?.seek).toBeGreaterThan(60);
        }
        // Her shield fed by a good part at a time
        const sim = createSim();
        const boss = startFight(sim);
        sim.damageEnemy(boss, Math.round(phaseOf(boss).shield / 2), 0, boss.x, boss.y, 0);
        sim.weapons = [];
        sim.player.invulnerable = 1e9;
        // Bolts in the air and burns from her entrance land first
        run(sim, 5);
        const shield = phaseOf(boss).shield;
        const parasite = sim.spawnEnemy(getEnemy("phosani_parasite"), "normal", {
            x: boss.x - 2,
            y: boss.y,
        })!;
        run(sim, 3);
        expect(parasite.dead).toBe(false);
        expect(phaseOf(boss).shield - shield).toBeGreaterThanOrEqual(
            Math.round(phaseOf(boss).shieldMax * 0.15),
        );
    });

    test("beating her brings the Nightmare staff, whose hands come up under enemies around you", () => {
        const staff = WEAPONS.find((w) => w.id === "nightmare_staff")!;
        expect(staff.unlock).toEqual({
            kind: "killBoss",
            mapId: "phosani",
            enemyId: "phosanis_nightmare",
        });
        expect(staff.kind).toBe("strike");
        expect(staff.style).toBe("magic");
        expect(staff.levels[0].impactSpotAnim).toBe(1761);
        expect(staff.impactFit).toBe(1);
        // The hands land on enemies near the player, scaled to the strike,
        // and hurt them (after her entrance, which sends a crowd away)
        const sim = createSim();
        const boss = startFight(sim);
        boss.attackCooldown = 1e9;
        sim.weapons = [];
        sim.addWeapon("nightmare_staff");
        sim.player.invulnerable = 1e9;
        const goblins = [];
        for (let i = 0; i < 4; i++) {
            goblins.push(
                sim.spawnEnemy(getEnemy("goblin"), "normal", {
                    x: sim.player.x + 3 + i,
                    y: sim.player.y,
                })!,
            );
        }
        const hp = goblins.map((g) => g.hp);
        run(sim, staff.levels[0].cooldown + 0.2);
        const hands = sim.effects.filter((e) => e.spotAnim === 1761);
        expect(hands.length).toBeGreaterThan(0);
        for (const hand of hands) {
            expect(hand.fitRadius).toBeCloseTo(staff.levels[0].area);
            expect(hand.endTick - hand.startTick).toBeGreaterThanOrEqual(100);
        }
        expect(goblins.some((g, i) => g.hp < hp[i] || g.dead)).toBe(true);
    });

    test("nothing in the fight drops anything", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.invulnerable = 1e9;
        for (const id of ["phosani_husk_magic", "phosani_parasite", "phosani_sleepwalker"]) {
            for (let i = 0; i < 20; i++) {
                const one = sim.spawnEnemy(getEnemy(id), "normal", {
                    x: boss.x + 6,
                    y: boss.y + i * 0.2,
                })!;
                sim.damageEnemy(one, 1e6, 0, one.x, one.y, 0);
            }
        }
        run(sim, 0.2);
        expect(sim.pickups.length).toBe(0);
    });

    test("a parasite puts the charge back into a totem", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.damageEnemy(boss, phaseOf(boss).shield * 2, 0, boss.x, boss.y, 0);
        expect(phaseOf(boss).stage).toBe("totems");
        const totem = phaseOf(boss).totems[0];
        sim.damageEnemy(totem, Math.round(totem.maxHp / 2), 0, totem.x, totem.y, 0);
        const charged = totem.hp;
        expect(charged).toBeLessThan(totem.maxHp);
        // Beside the totem, with the player there too, as they'd be, though
        // not shooting, so the charge is the parasite's doing
        sim.player.x = totem.x + 1;
        sim.player.y = totem.y;
        sim.weapons = [];
        const parasite = sim.spawnEnemy(getEnemy("phosani_parasite_weak"), "normal", {
            x: totem.x - 1.5,
            y: totem.y,
        })!;
        sim.player.invulnerable = 1e9;
        run(sim, 8);
        expect(parasite.dead).toBe(false);
        expect(totem.hp).toBeGreaterThan(charged);
    });

    test("the gap of a sealing ring is on the player, and moves on each volley", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const ring = phosani().boss!.attacks.find((a) => a.name === "Sealing ring")!;
        expect(ring.pattern!.gapAt).toBe("player");
        // East of her, where the windup aims
        sim.player.x = boss.x + 8;
        sim.player.y = boss.y;
        sim["startBossAttack"](boss, ring);
        boss.attackCooldown = 1e9;
        run(sim, ring.windup + 0.05);
        const bullets = sim.bullets;
        const { count, gap } = ring.pattern!;
        expect(bullets.count).toBe(count - Math.ceil(gap! / ((Math.PI * 2) / count)));
        const headings = (): number[] => {
            const out: number[] = [];
            for (let i = 0; i < bullets.count; i++) {
                const slot = bullets.order[i];
                out.push(Math.atan2(bullets.vy[slot], bullets.vx[slot]));
            }
            return out;
        };
        // Nothing flies east, within the gap's half-width of the player
        const half = ring.pattern!.gap! / 2;
        expect(headings().every((h) => Math.abs(h) > half - 0.01)).toBe(true);
        // The next ring's gap has turned on: now there's a shot flying east
        run(sim, ring.pattern!.interval);
        expect(headings().some((h) => Math.abs(h) < half)).toBe(true);
    });

    test("her scissors open from the player, one arm each way", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Scissors")!;
        expect(attack.pattern!.mirror).toBe(true);
        sim.player.x = boss.x + 8;
        sim.player.y = boss.y;
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.05);
        const bullets = sim.bullets;
        // Both arms, at the player to begin with
        expect(bullets.count).toBeGreaterThan(0);
        expect(bullets.count % 2).toBe(0);
        for (let i = 0; i < bullets.count; i++) {
            expect(Math.abs(bullets.vy[bullets.order[i]])).toBeLessThan(0.02);
        }
        run(sim, 1.5);
        let north = 0;
        let south = 0;
        for (let i = 0; i < bullets.count; i++) {
            const slot = bullets.order[i];
            if (bullets.vy[slot] > 0.01) {
                north++;
            } else if (bullets.vy[slot] < -0.01) {
                south++;
            }
        }
        expect(north).toBeGreaterThan(0);
        expect(south).toBeGreaterThan(0);
        // Mirror images: as many each way
        expect(north).toBe(south);
    });

    test("closing petals fly quicker with each volley", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Closing petals")!;
        const pattern = attack.pattern!;
        expect(pattern.speedUp).toBeGreaterThan(0);
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.05);
        const bullets = sim.bullets;
        const speedOf = (slot: number) => Math.hypot(bullets.vx[slot], bullets.vy[slot]);
        const first = speedOf(bullets.order[0]);
        run(sim, pattern.interval * (pattern.volleys - 1) + 0.05);
        let fastest = 0;
        for (let i = 0; i < bullets.count; i++) {
            fastest = Math.max(fastest, speedOf(bullets.order[i]));
        }
        expect(fastest).toBeCloseTo(
            (pattern.speed + pattern.speedUp! * (pattern.volleys - 1)) / TICKS_PER_SECOND,
            3,
        );
        expect(fastest).toBeGreaterThan(first * 2);
    });

    test("the dream closes in from a ring round the player, with the gap on her side", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "The dream closes in")!;
        const pattern = attack.pattern!;
        expect(pattern.around).toBeGreaterThan(0);
        sim.player.x = boss.x + 10;
        sim.player.y = boss.y;
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.05);
        const bullets = sim.bullets;
        expect(bullets.count).toBeGreaterThan(pattern.count * 0.7);
        const player = sim.player;
        for (let i = 0; i < bullets.count; i++) {
            const slot = bullets.order[i];
            const dx = player.x - bullets.x[slot];
            const dy = player.y - bullets.y[slot];
            // On the circle, flying in at the player
            expect(Math.hypot(dx, dy)).toBeCloseTo(pattern.around!, 0);
            expect(dx * bullets.vx[slot] + dy * bullets.vy[slot]).toBeGreaterThan(0);
            // None between the player and her: that's the way out
            expect(bullets.x[slot] > player.x - pattern.around! * 0.85 || Math.abs(dy) > 2).toBe(
                true,
            );
        }
    });

    test("her barrage follows her slow rings, and her claw her parted petals", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const rings = phosani().boss!.attacks.find((a) => a.name === "Rings, then shots")!;
        expect(rings.follow).toEqual({ attack: "Barrage", delay: 1 });
        sim["startBossAttack"](boss, rings);
        boss.attackCooldown = 1e9;
        run(sim, rings.windup + 0.05);
        expect(boss.bossState!.follow?.attack.name).toBe("Barrage");
        // Not yet: her rings are still going out
        run(sim, 0.5);
        expect(boss.bossState!.windup).toBeUndefined();
        run(sim, 0.6);
        expect(boss.bossState!.windup?.attack.name).toBe("Barrage");
        expect(boss.bossState!.follow).toBeUndefined();

        const petals = phosani().boss!.attacks.find((a) => a.name === "Parted petals")!;
        expect(petals.pattern!.count % 2).toBe(0);
        expect(petals.follow?.attack).toBe("Grasping Claws (on you)");
        const claw = phosani().boss!.attacks.find((a) => a.name === petals.follow!.attack)!;
        expect(claw.ground!.spots[0]).toEqual({ shape: "player" });
    });

    test("her eggs fly out of her, stand where they land until broken, and hatch if not", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Eggs")!;
        const egg = getEnemy("phosani_egg");
        expect(egg.objId).toBe(25838);
        expect(egg.stationary).toBe(true);
        expect(egg.healthBar).toBe(true);
        expect(egg.hintArrow).toBe(true);
        expect(egg.hatches?.into).toBe("phosani_parasite_weak");
        const thrown = attack.summon!.thrown!;
        const distance = attack.summon!.distance!;
        // Her eggs are a few bolts each now, so the crossbow stays out of this
        sim.weapons = [];
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.05);
        const eggs = sim.enemies.filter((e) => e.def === egg);
        expect(eggs.length).toBe(3);
        // Out of her, in the air, and nothing can hit them there
        const from = { x: boss.x, y: boss.y };
        for (const one of eggs) {
            expect(one.flung).toBeDefined();
            expect(Math.hypot(one.x - from.x, one.y - from.y)).toBeLessThan(distance / 2);
            expect(one.shieldEnd).toBeGreaterThan(sim.tick);
            expect(one.noDrops).toBe(true);
        }
        expect(sim["nearestEnemies"](boss.x, boss.y, 100, 10)).not.toContain(eggs[0]);
        run(sim, thrown.seconds + 0.05);
        const landed = sim.tick;
        for (const one of eggs) {
            expect(one.flung).toBeUndefined();
            expect(one.shieldEnd).toBeLessThanOrEqual(sim.tick);
            // From about where she threw them: she's free to move meanwhile
            const away = Math.hypot(one.x - from.x, one.y - from.y);
            expect(away).toBeGreaterThan(distance / 2 - 1);
            expect(away).toBeLessThan(distance + 1);
            // Their time runs from landing
            expect(one.hatchTick).toBeGreaterThan(
                landed + (egg.hatches!.seconds - thrown.seconds - 0.2) * TICKS_PER_SECOND,
            );
        }
        // One's broken in time
        sim.damageEnemy(eggs[0], 1e6, 0, eggs[0].x, eggs[0].y, 0);
        sim.player.invulnerable = 1e9;
        run(sim, egg.hatches!.seconds + 0.2);
        const parasites = sim.enemies.filter(
            (e) => e.def.id === "phosani_parasite_weak" && !e.dead,
        );
        expect(parasites.length).toBe(2);
        expect(parasites.every((p) => p.noDrops)).toBe(true);
        // The eggs are gone
        expect(eggs.every((e) => e.dead)).toBe(true);
    });

    test("she faces down her lane as she charges, not round at the player", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Surge")!;
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        const lane = boss.bossState!.windup!.lane!;
        const down = yawFromVector(lane.toX - lane.fromX, lane.toY - lane.fromY);
        const alongX = lane.fromY === lane.toY;
        sim.player.invulnerable = 1e9;
        // Stepping off the lane during the wind-up, and then as she goes by
        let ticks = 0;
        while (boss.bossState!.windup || boss.bossState!.surge) {
            sim.step(alongX ? 0 : 1, alongX ? 1 : 0);
            expect(boss.yaw).toBe(down);
            ticks++;
        }
        expect(ticks).toBeGreaterThan(attack.windup * TICKS_PER_SECOND);
    });

    test("her totems are her own, grown to be seen, and what her parasites recharge", () => {
        const totems = phosani().boss!.phases!.totems;
        expect([totems.idleId, totems.chargingId, totems.chargedId]).toEqual([
            "phosani_totem",
            "phosani_totem_charging",
            "phosani_totem_charged",
        ]);
        for (const id of [totems.idleId, totems.chargingId, totems.chargedId]) {
            expect(getEnemy(id).scale).toBeGreaterThanOrEqual(2);
            expect(getEnemy(id).npcId).toBe(getEnemy(id.replace("phosani", "nightmare")).npcId);
        }
        expect(getEnemy("phosani_parasite").heals?.targets).toContain(totems.chargingId);
        const sim = createSim();
        const boss = startFight(sim);
        expect(phaseOf(boss).totems.map((t) => t.def.id)).toEqual(Array(4).fill(totems.idleId));
    });

    test("her husks throw nothing, run as quick as the Inquisitor, and come in every phase", () => {
        const attack = phosani().boss!.attacks.find((a) => a.name === "Husks")!;
        expect(attack.phases).toBeUndefined();
        expect(phosani().boss!.attacks.some((a) => a.name === "Rooted husks")).toBe(false);
        const inquisitor = getCharacter("inquisitor").bonus.moveSpeed ?? 0;
        for (const id of ["phosani_husk_magic", "phosani_husk_ranged"]) {
            const husk = getEnemy(id);
            expect(husk.shot).toBeUndefined();
            expect(husk.stationary).toBe(false);
            expect(husk.speed).toBeCloseTo((2 / 0.6) * (1 + inquisitor), 0);
            // A hold that only their death ends, in practice
            expect(husk.holds).toBeGreaterThanOrEqual(20);
            expect(husk.solid).toBe(true);
        }
    });

    test("her rings with a way through open it on the player's side", () => {
        for (const name of ["Closing ring", "Turning wall", "Sealing ring"]) {
            const pattern = phosani().boss!.attacks.find((a) => a.name === name)!.pattern!;
            expect(pattern.gap).toBeGreaterThan(0);
            expect(pattern.gapAt).toBe("player");
        }
        const sim = createSim();
        const boss = startFight(sim);
        const ring = phosani().boss!.attacks.find((a) => a.name === "Turning wall")!;
        sim.player.x = boss.x + 8;
        sim.player.y = boss.y;
        sim["startBossAttack"](boss, ring);
        boss.attackCooldown = 1e9;
        run(sim, ring.windup + 0.05);
        const bullets = sim.bullets;
        expect(bullets.count).toBeGreaterThan(0);
        // Nothing flies east at the player from the first volley
        const half = ring.pattern!.gap! / 2;
        for (let i = 0; i < bullets.count; i++) {
            const slot = bullets.order[i];
            const heading = Math.atan2(bullets.vy[slot], bullets.vx[slot]);
            expect(Math.abs(heading)).toBeGreaterThan(half - 0.01);
        }
    });

    test("she comes at the player the moment they're let go", () => {
        const sim = createSim();
        sim.map.bossArena = { baseX: BASE, baseY: BASE, size: SIZE };
        const intro = phosani().boss!.intro!;
        run(sim, intro.seconds + 0.02);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        expect(sim.intro).toBeUndefined();
        run(sim, 0.1);
        expect(boss.bossState!.windup).toBeDefined();
    });

    test("her totems face the middle of her square, and keep facing it", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const middle = { x: BASE + SIZE / 2, y: BASE + SIZE / 2 };
        // Their scroll hangs round from where the yaw points, and the offset
        // turns it to the middle
        const offset = phosani().boss!.phases!.totems.yawOffset!;
        expect(offset).toBe(768);
        const facing = () =>
            phaseOf(boss).totems.map((t) => [
                t.yaw,
                (yawFromVector(middle.x - t.x, middle.y - t.y) + offset) & 2047,
            ]);
        for (const [yaw, want] of facing()) {
            expect(yaw).toBe(want);
        }
        sim.player.invulnerable = 1e9;
        run(sim, 3, 1, 0);
        for (const [yaw, want] of facing()) {
            expect(yaw).toBe(want);
        }
    });

    test("her claws' hands come up in full where each mark lands", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Grasping Claws")!;
        const grab = attack.ground!.grab!;
        expect(grab.seconds).toBeGreaterThan(0.5);
        sim.player.invulnerable = 1e9;
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        const marks = sim.hazards.length;
        expect(sim.effects.filter((e) => e.spotAnim === attack.ground!.middleSpotAnim)).toEqual([]);
        run(sim, attack.windup + 0.05);
        const hands = sim.effects.filter((e) => e.spotAnim === attack.ground!.middleSpotAnim);
        expect(hands.length).toBe(marks);
        for (const hand of hands) {
            expect(hand.fitRadius).toBeCloseTo(attack.ground!.radius * grab.fit);
            expect(hand.endTick - hand.startTick).toBe(Math.round(grab.seconds * TICKS_PER_SECOND));
        }
        // The marks stay while the hands are up, and go as they sink
        expect(sim.hazards.length).toBe(marks);
        expect(sim.hazards.every((h) => h.grabEnd > sim.tick)).toBe(true);
        run(sim, grab.up.to);
        expect(sim.hazards).toEqual([]);
    });

    test("her claws' hands hurt whoever steps into them while they're up, once each", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Grasping Claws")!;
        const grab = attack.ground!.grab!;
        sim.player.maxHp = sim.player.hp = 500;
        // Well clear of every mark as they land
        sim.player.x = sim.player.prevX = boss.x + 20;
        sim.player.y = sim.player.prevY = boss.y;
        sim["startBossAttack"](boss, attack);
        boss.attackCooldown = 1e9;
        run(sim, attack.windup + 0.05);
        expect(sim.player.hp).toBe(500);
        // On one as it lands: the hands are still under the ground
        const spot = sim.hazards[3];
        sim.player.x = sim.player.prevX = spot.x;
        sim.player.y = sim.player.prevY = spot.y;
        sim.player.invulnerable = 0;
        run(sim, grab.up.from - 0.15);
        expect(sim.player.hp).toBe(500);
        // And up they come
        sim.player.invulnerable = 0;
        run(sim, 0.25);
        const hit = Math.round(sim["getBossDamage"](boss, attack));
        expect(sim.player.hp).toBe(500 - hit);
        // Standing there costs nothing more, from that one
        sim.player.invulnerable = 0;
        run(sim, 0.5);
        expect(sim.player.hp).toBe(500 - hit);
        // Gone once the hands have sunk, before their animation's out
        run(sim, grab.up.to);
        expect(sim.hazards).toEqual([]);
        expect(grab.up.to).toBeLessThan(grab.seconds);
    });

    test("the next round of claws waits for the hands to finish", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = phosani().boss!.attacks.find((a) => a.name === "Grasping Claws (random)")!;
        const grab = attack.ground!.grab!;
        sim.player.invulnerable = 1e9;
        boss.bossState!.chain = { attack, left: attack.chain!.times };
        sim["startBossAttack"](boss, attack);
        const landTick = boss.bossState!.windup!.landTick;
        run(sim, attack.windup + 0.05);
        expect(boss.bossState!.windup).toBeUndefined();
        // Not until the hands are down
        run(sim, grab.seconds - 0.2);
        expect(boss.bossState!.windup).toBeUndefined();
        run(sim, 0.3);
        expect(boss.bossState!.windup?.attack).toBe(attack);
        expect(boss.bossState!.windup!.startTick).toBeGreaterThanOrEqual(
            landTick + Math.round(grab.seconds * TICKS_PER_SECOND),
        );
    });

    test("leashing back to the player, she goes down into the ground and comes up by them", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const leash = phosani().boss!.leash!;
        expect(leash.jump).toBeDefined();
        const { downSeq, upSeq, seconds } = leash.jump!;
        sim.player.invulnerable = 1e9;
        // Well past the leash: she goes as soon as there's a spot by them to
        // go to (the flow field catches up with the player first)
        sim.player.x = sim.player.prevX = boss.x + leash.distance + 8;
        sim.player.y = sim.player.prevY = boss.y;
        for (let i = 0; i < 2 * TICKS_PER_SECOND && !boss.bossState!.leap; i++) {
            sim.step(0, 0);
        }
        const leap = boss.bossState!.leap!;
        expect(leap).toBeDefined();
        // Where she went down, after walking the player's way until then
        const from = { x: boss.x, y: boss.y };
        expect(boss.anim).toBe("attack");
        expect(boss.attackSeq).toBe(downSeq);
        expect(leap.switchTick - sim.tick).toBe(Math.round(seconds * TICKS_PER_SECOND));
        // Still where she was, doing nothing else, until she's gone down
        boss.attackCooldown = 0;
        while (sim.tick < leap.switchTick - 1) {
            sim.step(0, 0);
        }
        expect([boss.x, boss.y]).toEqual([from.x, from.y]);
        expect(boss.bossState!.windup).toBeUndefined();
        run(sim, 0.1);
        expect(boss.attackSeq).toBe(upSeq);
        expect(Math.hypot(boss.x - sim.player.x, boss.y - sim.player.y)).toBeLessThanOrEqual(
            leash.keep + 1,
        );
        run(sim, seconds);
        expect(boss.bossState!.leap).toBeUndefined();
    });

    test("the player can't push her or hers: they're the one that gives", () => {
        const sim = createSim();
        const boss = startFight(sim);
        expect(boss.def.solid).toBe(true);
        for (const id of ["phosani_sleepwalker", "phosani_parasite", "phosani_parasite_weak"]) {
            expect(getEnemy(id).solid).toBe(true);
        }
        sim.player.invulnerable = 1e9;
        boss.x = boss.prevX = sim.player.x + boss.radius + sim.player.radius - 0.3;
        boss.y = boss.prevY = sim.player.y;
        const bossX = boss.x;
        const playerX = sim.player.x;
        // Walking into her
        for (let i = 0; i < 10; i++) {
            sim.step(1, 0);
            boss.vx = boss.vy = 0;
        }
        expect(boss.x).toBeGreaterThanOrEqual(bossX - 0.01);
        expect(sim.player.x).toBeLessThan(playerX + 0.3);
    });
});

// Through her phases: the shield broken and the totems charged by hand, times over
function pushPhases(sim: Sim, boss: Enemy, times: number): void {
    for (let i = 0; i < times; i++) {
        sim.damageEnemy(boss, phaseOf(boss).shield * 2, 0, boss.x, boss.y, 0);
        for (const totem of [...phaseOf(boss).totems]) {
            sim.damageEnemy(totem, totem.hp * 2, 0, totem.x, totem.y, 0);
        }
    }
}

function attackNamed(name: string) {
    return phosani().boss!.attacks.find((a) => a.name === name)!;
}

describe("what makes her hard", () => {
    test("her petals land again a third of a second later, not a second", () => {
        expect(phosani().boss!.bulletGrace).toBe(0.3);
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.hp = sim.player.maxHp = 1000;
        const magic = attackNamed("Magic");
        sim["startBossAttack"](boss, magic);
        boss.attackCooldown = 1e9;
        run(sim, magic.windup + 0.05);
        // Stood right by her, in every arm of the spiral as it comes round
        let hits = 0;
        for (let i = 0; i < 2 * TICKS_PER_SECOND; i++) {
            sim.player.x = boss.x + 0.9;
            sim.player.y = boss.y;
            sim.player.invulnerable = 0;
            sim.step(0, 0);
            hits += sim.takeEvents().filter((e) => e.type === "playerHit").length;
        }
        // A second's grace would allow two
        expect(hits).toBeGreaterThanOrEqual(4);
        expect(sim.damageByAttack["Magic"]).toBe(hits * 4);
    });

    test("her rings hold her for half a second only, and the next attack comes through them", () => {
        for (const attack of phosani().boss!.attacks) {
            if (attack.pattern && attack.weight > 0) {
                // Aimed shots hold her; rings and spirals don't
                expect(attack.pattern.channel).toBe(
                    attack.pattern.shape === "spread" ? undefined : 0.5,
                );
            }
        }
        const sim = createSim();
        const boss = startFight(sim);
        const ring = attackNamed("Petal ring");
        sim["startBossAttack"](boss, ring);
        run(sim, ring.windup + 0.05);
        const state = boss.bossState!;
        const landed = sim.tick;
        expect(state.channelEnd - landed).toBeLessThanOrEqual(0.5 * TICKS_PER_SECOND);
        expect(state.channelEnd - landed).toBeGreaterThan(0.3 * TICKS_PER_SECOND);
        // Her interval's up a second after it lands, with volleys still to come
        sim.player.invulnerable = 1e9;
        run(sim, 1.3);
        const emitters = sim["emitters"] as { attack: { name: string }; volleysLeft: number }[];
        expect(emitters.some((e) => e.attack.name === "Petal ring" && e.volleysLeft > 0)).toBe(
            true,
        );
        expect(state.windup).toBeDefined();
        expect(state.windup!.attack.name).not.toBe("Petal ring");
    });

    test("the dream's spiral goes on under everything, through a hold and her cooldown", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const phases = phosani().boss!.phases!;
        expect(phases.phases[0].ambient?.attack).toBe("The dream's spiral");
        const dream = attackNamed("The dream's spiral");
        expect(dream.weight).toBe(0);
        expect(dream.phases).toEqual([]);
        const emitters = () =>
            (sim["emitters"] as { attack: { name: string } }[]).filter(
                (e) => e.attack.name === "The dream's spiral",
            );
        // Held, with her cooldown as long as the fight
        const husk = sim.spawnEnemy(getEnemy("phosani_husk_magic"), "normal", {
            x: sim.player.x + 1,
            y: sim.player.y,
        })!;
        sim.hold = { enemies: [husk], endTick: sim.tick + 1e9 };
        phaseOf(boss).ambientNext = sim.tick;
        run(sim, 0.1);
        expect(emitters().length).toBe(1);
        expect(boss.bossState!.windup).toBeUndefined();
        expect(boss.bossState!.channelEnd).toBeLessThanOrEqual(sim.tick);
        // Seeded afresh when its half minute's up, not before
        const next = phaseOf(boss).ambientNext - sim.tick;
        expect(next).toBeGreaterThan(29.5 * TICKS_PER_SECOND);
        expect(next).toBeLessThanOrEqual(30 * TICKS_PER_SECOND);
        run(sim, 5);
        expect(emitters().length).toBe(1);
        expect(phaseOf(boss).ambientNext - sim.tick).toBe(next - 5 * TICKS_PER_SECOND);
        // Not from under the ground
        boss.bossState!.leap = {
            toX: boss.x,
            toY: boss.y,
            switchTick: sim.tick + 1e9,
            endTick: sim.tick + 1e9,
        };
        sim["emitters"] = [];
        phaseOf(boss).ambientNext = sim.tick;
        run(sim, 0.1);
        expect(emitters().length).toBe(0);
    });

    test("each phase is a gear up: quicker between attacks, quicker petals, quicker feet, a thicker dream", () => {
        const phases = phosani().boss!.phases!.phases;
        expect(phases[1].tempo).toBeLessThan(1);
        expect(phases[2].tempo).toBeLessThan(phases[1].tempo!);
        expect(phases[2].speed).toBeGreaterThan(phases[1].speed!);
        expect(phases.map((p) => p.ambient?.attack)).toEqual([
            "The dream's spiral",
            "The dream's rings",
            "The dream's lattice",
        ]);
        const sim = createSim();
        const boss = startFight(sim);
        const interval = phosani().boss!.attackInterval;
        const ring = attackNamed("Petal ring");
        const claws = attackNamed("Grasping Claws");
        const state = boss.bossState!;
        sim["startBossAttack"](boss, ring);
        expect(state.windup!.landTick - sim.tick).toBe(Math.round(ring.windup * TICKS_PER_SECOND));
        expect(boss.attackCooldown).toBe(Math.round(interval * TICKS_PER_SECOND));
        const speed = boss.speed;
        sim.player.invulnerable = 1e9;
        pushPhases(sim, boss, 2);
        expect(phaseOf(boss).index).toBe(2);
        const tempo = phases[2].tempo!;
        expect(boss.speed).toBeCloseTo(speed * phases[2].speed!);
        state.windup = undefined;
        state.channelEnd = 0;
        sim["startBossAttack"](boss, ring);
        expect(state.windup!.landTick - sim.tick).toBe(
            Math.round(ring.windup * tempo * TICKS_PER_SECOND),
        );
        expect(boss.attackCooldown).toBe(Math.round(interval * tempo * TICKS_PER_SECOND));
        // Her big hits keep their warnings
        state.windup = undefined;
        sim["startBossAttack"](boss, claws);
        expect(state.windup!.landTick - sim.tick).toBe(Math.round(claws.windup * TICKS_PER_SECOND));
        sim["emitters"] = [];
        phaseOf(boss).ambientNext = sim.tick;
        run(sim, 0.1);
        const names = (sim["emitters"] as { attack: { name: string } }[]).map((e) => e.attack.name);
        expect(names).toContain("The dream's lattice");
    });

    test("after the last blast she stands her finale, untouchable, with claws on the player as her sleepwalkers walk in, and falls when it's up", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const finale = phosani().boss!.phases!.finale!;
        sim.player.invulnerable = 1e9;
        pushPhases(sim, boss, 3);
        const phase = phaseOf(boss);
        expect(phase.stage).toBe("finale");
        expect(boss.dead).toBe(false);
        expect(sim.state).toBe("playing");
        expect(sim.takeEvents().some((e) => e.type === "bossStage" && e.stage === "finale")).toBe(
            true,
        );
        // Nothing touches her now
        sim.damageEnemy(boss, 1e6, 0, boss.x, boss.y, 0);
        expect(boss.dead).toBe(false);
        expect(phaseOf(boss)).toBe(phase);
        // Her sleepwalkers come first (wound up as any summon is), and her
        // claws don't wait for them
        boss.attackCooldown = 0;
        const state = boss.bossState!;
        run(sim, 0.2);
        expect(state.windup?.attack.name).toBe(finale.opener);
        run(sim, attackNamed(finale.opener!).windup);
        expect(state.walkers).toBeDefined();
        const started: string[] = [];
        let whileWalking = false;
        for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) {
            sim.step(0, 0);
            const name = state.windup?.attack.name;
            if (name && started[started.length - 1] !== name) {
                started.push(name);
                whileWalking ||= state.walkers !== undefined;
            }
        }
        // (The crossbow shoots the sleepwalkers down as they come)
        expect(whileWalking).toBe(true);
        expect(started.length).toBeGreaterThan(0);
        for (const name of started) {
            expect(finale.attacks).toContain(name);
        }
        // Then she falls, her death plays out with nothing landing meanwhile,
        // and the fight's won, timed from her fall
        for (let i = 0; i < finale.seconds * TICKS_PER_SECOND && !boss.dead; i++) {
            sim.step(0, 0);
        }
        expect(boss.dead).toBe(true);
        expect(sim.state).toBe("playing");
        const fell = sim.tick;
        const fall = phosani().boss!.fallSeconds!;
        sim.player.invulnerable = 0;
        sim.player.hp = sim.player.maxHp;
        sim["damagePlayer"](10, "phosanis_nightmare", false);
        expect(sim.player.hp).toBe(sim.player.maxHp);
        run(sim, fall + 0.1);
        expect(sim.state).toBe("victory");
        expect(sim.endTick).toBeLessThanOrEqual(fell + 1);
        expect(sim.endTick).toBeGreaterThanOrEqual(fell - Math.round(0.5 * TICKS_PER_SECOND));
    });

    test("nothing of hers comes while her sleepwalkers walk in, not even the dream", () => {
        const sim = createSim();
        const boss = startFight(sim);
        sim.player.invulnerable = 1e9;
        // Into her second phase, whose opener is her sleepwalkers
        pushPhases(sim, boss, 1);
        boss.attackCooldown = 0;
        const opener = attackNamed("Sleepwalkers");
        run(sim, opener.windup + 0.2);
        const state = boss.bossState!;
        expect(state.walkers).toBeDefined();
        const ambient = () =>
            (sim["emitters"] as { ambient?: boolean }[]).filter((e) => e.ambient).length;
        expect(ambient()).toBe(0);
        // Her weapons off them: they walk, and still she fires nothing
        sim.weapons = [];
        const bullets = sim.bullets.count;
        run(sim, 1);
        expect(state.walkers).toBeDefined();
        expect(ambient()).toBe(0);
        expect(state.windup).toBeUndefined();
        expect(sim.bullets.count).toBeLessThanOrEqual(bullets);
        // Once they're dead the dream's back at once
        for (const walker of state.walkers!.enemies) {
            sim.damageEnemy(walker, 1e6, 0, walker.x, walker.y, 0);
        }
        run(sim, 0.2);
        expect(state.walkers).toBeUndefined();
        expect(ambient()).toBe(1);
    });

    test("she doesn't leash between her charges, however far off they end", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const attack = attackNamed("Surge");
        const leash = phosani().boss!.leash!;
        // Her charges cross the whole square, so each ends far past the leash
        expect(SIZE).toBeGreaterThan(leash.distance + 8);
        boss.bossState!.chain = { attack, left: attack.chain!.times };
        boss.bossState!.cooldowns[phosani().boss!.attacks.indexOf(attack)] = 1e9;
        sim["startBossAttack"](boss, attack);
        let surges = 0;
        let leaps = 0;
        sim.player.invulnerable = 1e9;
        for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) {
            sim.step(0, 0);
            const state = boss.bossState!;
            if (state.surge && state.surge.startTick === sim.tick) {
                surges++;
            }
            // (After the last she's far off at an edge, and leashes as meant)
            if (state.leap && surges < 3) {
                leaps++;
            }
            // Each charge begins where its lane does, never from a leap's spot
            if (state.surge && state.surge.startTick === sim.tick) {
                expect([boss.x, boss.y]).toEqual([state.surge.lane.fromX, state.surge.lane.fromY]);
            }
        }
        expect(surges).toBe(3);
        expect(leaps).toBe(0);
    });

    test("her red shots hit no wider than the streak they're drawn as", () => {
        const attacks = phosani().boss!.attacks;
        for (const attack of attacks) {
            if (attack.spotAnim === 1766) {
                const radius = attack.pattern ? attack.pattern.radius : attack.radius;
                expect(radius).toBeLessThanOrEqual(0.25);
            }
        }
        const sim = createSim();
        const boss = startFight(sim);
        const orbs = attackNamed("Hunting orbs");
        sim["startBossAttack"](boss, orbs);
        boss.attackCooldown = 1e9;
        run(sim, orbs.windup + 0.05);
        expect(sim.enemyProjectiles.length).toBe(orbs.count);
        for (const orb of sim.enemyProjectiles) {
            expect(orb.radius).toBe(orbs.radius);
        }
    });

    test("beyond her reach she walks after the player, or charges, rather than fire at nothing", () => {
        const attacks = phosani().boss!.attacks;
        // Her petals, shots and claws reach about as far as they fly; her
        // charge, her summons and her spores (laid round the player) anywhere
        for (const attack of attacks) {
            const reaches = attack.pattern || attack.ground || attack.kind === "projectile";
            if (reaches && attack.weight > 0 && !attack.ground?.armed) {
                expect(attack.range).toBeLessThanOrEqual(20);
            }
        }
        const surge = attackNamed("Surge");
        expect(surge.range).toBeGreaterThan(100);
        expect(surge.weight).toBeGreaterThanOrEqual(attackNamed("Grasping Claws").weight);
        expect(surge.cooldown).toBeLessThanOrEqual(10);
        // Just past her reach, and short of her leash
        const far = 19.5;
        expect(far).toBeLessThan(phosani().boss!.leash!.distance);
        const used = new Set<string>();
        for (let seed = 1; seed <= 4; seed++) {
            const sim = createSim(seed);
            const boss = startFight(sim);
            sim.player.invulnerable = 1e9;
            sim.player.x = sim.player.prevX = boss.x;
            sim.player.y = sim.player.prevY = boss.y + far;
            // Walking their way while her interval's up
            boss.attackCooldown = Math.round(0.5 * TICKS_PER_SECOND);
            const y = boss.y;
            run(sim, 0.5);
            expect(boss.y - y).toBeGreaterThan(1);
            // Then, from past her reach again, only what reaches: no petals
            // wound up at nothing
            boss.y = boss.prevY = sim.player.y - far;
            const state = boss.bossState!;
            state.cooldowns.fill(0);
            boss.attackCooldown = 0;
            sim.step(0, 0);
            expect(state.windup).toBeDefined();
            used.add(state.windup!.attack.name);
        }
        for (const name of used) {
            expect(attackNamed(name).range).toBeGreaterThan(far);
        }
    });

    test("her sweeps' arms come in bursts, with holes to run through", () => {
        for (const name of ["Sweep", "Double sweep", "Scissors"]) {
            const pattern = attackNamed(name).pattern!;
            expect(pattern.burst).toEqual({ count: 6, pause: 0.5 });
            expect(pattern.radius).toBeLessThanOrEqual(0.3);
        }
        const sim = createSim();
        const boss = startFight(sim);
        const sweep = attackNamed("Sweep");
        const { interval, burst } = sweep.pattern!;
        sim.player.invulnerable = 1e9;
        sim["startBossAttack"](boss, sweep);
        boss.attackCooldown = 1e9;
        // The first burst, one needle a volley, and then nothing for the pause
        run(sim, sweep.windup + (burst!.count - 1) * interval + 0.02);
        expect(sim.bullets.count).toBe(burst!.count);
        // She's still for the pauses too (four of them, in thirty volleys)
        const left = (boss.bossState!.channelEnd - sim.tick) / TICKS_PER_SECOND;
        expect(left).toBeGreaterThan(sweep.pattern!.volleys * interval + 3 * burst!.pause);
        run(sim, burst!.pause - 0.04);
        expect(sim.bullets.count).toBe(burst!.count);
        run(sim, interval + 0.04);
        expect(sim.bullets.count).toBe(burst!.count + 1);
    });

    test("her barrage and her orbs can be stepped across", () => {
        // The Inquisitor walks 4 tiles a second: a stream that follows them
        // has to be slow enough, and far enough between shots, to step out of
        const barrage = attackNamed("Barrage").pattern!;
        expect(barrage.track).toBe(true);
        expect(barrage.speed).toBeLessThanOrEqual(8);
        expect(barrage.interval).toBeGreaterThanOrEqual(0.2);
        const orbs = attackNamed("Hunting orbs");
        expect(orbs.homing).toBeLessThanOrEqual(0.8);
        expect(orbs.range).toBeLessThanOrEqual(20);
    });

    test("she runs after the player at most of their pace, and sinks after them only from well off", () => {
        const def = phosani();
        const leash = def.boss!.leash!;
        expect(def.speed).toBeGreaterThanOrEqual(3);
        expect(leash.distance).toBeGreaterThanOrEqual(20);
        const sim = createSim();
        const boss = startFight(sim);
        boss.attackCooldown = 1e9;
        sim.player.invulnerable = 1e9;
        sim.player.x = sim.player.prevX = boss.x + leash.distance - 2;
        sim.player.y = sim.player.prevY = boss.y;
        const x = boss.x;
        run(sim, 1);
        // Walking, not leaping, and nearly a player's second of ground in it
        expect(boss.bossState!.leap).toBeUndefined();
        expect(boss.x - x).toBeGreaterThan(def.speed * 0.8);
    });
});
