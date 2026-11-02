import { getCharacter } from "../content/characters";
import { getEnemy } from "../content/enemies";
import { getMap } from "../content/maps";
import { emptyStats } from "../content/types";
import { INQUISITORS_BOSS_ARENA } from "../scaperune/maps/inquisitorsField";
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

function run(sim: Sim, seconds: number): void {
    const ticks = Math.round(seconds * TICKS_PER_SECOND);
    for (let i = 0; i < ticks && !sim.runOver; i++) {
        if (sim.state === "levelUp") {
            sim.choose(0);
            continue;
        }
        sim.step(0, 0);
    }
}

function pickAll(sim: Sim): number {
    let picks = 0;
    while (sim.state === "levelUp") {
        sim.choose(0);
        picks++;
    }
    return picks;
}

function phosani() {
    return getEnemy("phosanis_nightmare");
}

function phaseOf(boss: Enemy) {
    return boss.bossState!.phase!;
}

// Through the picks and her entrance, to the fight proper
function startFight(sim: Sim): Enemy {
    pickAll(sim);
    run(sim, phosani().boss!.intro!.seconds + 0.2);
    const boss = sim.enemies.find((e) => e.finalBoss)!;
    boss.attackCooldown = 1e9;
    return boss;
}

afterEach(() => {
    getMap("phosani").bossArena = INQUISITORS_BOSS_ARENA;
});

describe("the map", () => {
    test("is one fight, with her the only thing on it", () => {
        const map = getMap("phosani");
        expect(map.fight).toEqual({ requires: "halloween", levelUps: 8, character: "inquisitor" });
        expect(map.waves).toEqual([]);
        expect(map.events).toEqual([
            { at: 0, kind: "finalBoss", enemyId: "phosanis_nightmare", hp: 4200 },
        ]);
    });

    test("the run begins with its picks, before a tick is played", () => {
        const sim = createSim();
        expect(sim.tick).toBe(0);
        expect(sim.state).toBe("levelUp");
        expect(sim.level).toBe(9);
        expect(sim.choices.length).toBeGreaterThan(0);
        expect(pickAll(sim)).toBe(8);
        expect(sim.state).toBe("playing");
        expect(sim.weapons.length + sim.passives.length).toBeGreaterThan(1);
    });

    test("everyone plays the Inquisitor there, with the mace she drops", () => {
        const map = getMap("phosani");
        expect(map.fight?.character).toBe("inquisitor");
        const inquisitor = getCharacter("inquisitor");
        expect(inquisitor.startingWeapon).toBe("inquisitors_mace");
        expect(inquisitor.unlock).toEqual({
            kind: "killBoss",
            mapId: "phosani",
            enemyId: "phosanis_nightmare",
        });
        const sim = createSim();
        expect(sim.weapons.map((w) => w.def.id)).toEqual(["inquisitors_mace"]);
        // Their picks can take the mace further, though it's a locked weapon
        let levelled = false;
        for (let i = 0; i < 8 && !levelled; i++) {
            const index = sim.choices.findIndex(
                (c) => c.kind === "weaponLevel" && c.weaponId === "inquisitors_mace",
            );
            levelled = index !== -1;
            sim.choose(Math.max(0, index));
        }
        expect(sim.stats.moveSpeed).toBeGreaterThan(0);
        expect(sim.stats.bossMight).toBeGreaterThan(0);
    });

    test("she rises as soon as the picks are made, and nothing else ever comes", () => {
        const sim = createSim();
        pickAll(sim);
        sim.step(0, 0);
        expect(sim.intro?.def.id).toBe("phosanis_nightmare");
        run(sim, phosani().boss!.intro!.seconds + 0.2);
        const boss = sim.enemies.find((e) => e.finalBoss)!;
        expect(boss.def.id).toBe("phosanis_nightmare");
        expect(boss.maxHp).toBe(4200);
        expect(boss.damageScale).toBe(getMap("phosani").difficulty.damage);
        boss.attackCooldown = 1e9;
        run(sim, 30);
        const others = sim.enemies.filter((e) => e !== boss && !e.totemOf);
        expect(others).toEqual([]);
    });

    test("the picks are made by every hero, and the run waits on each", () => {
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
        expect(sim.state).toBe("levelUp");
        for (const hero of sim.heroes) {
            expect(hero.pendingLevelUps).toBe(8);
        }
    });
});

describe("her fight", () => {
    test("each blast heals and brings three levels' worth of picks", () => {
        const sim = createSim();
        const boss = startFight(sim);
        const level = sim.level;
        sim.player.hp = 1;
        sim.damageEnemy(boss, phaseOf(boss).shield * 2, 0, boss.x, boss.y, 0);
        expect(phaseOf(boss).stage).toBe("totems");
        for (const totem of [...phaseOf(boss).totems]) {
            sim.damageEnemy(totem, totem.hp * 2, 0, totem.x, totem.y, 0);
        }
        expect(phaseOf(boss).index).toBe(1);
        expect(sim.player.hp).toBeGreaterThan(1);
        sim.step(0, 0);
        expect(sim.state).toBe("levelUp");
        expect(sim.level).toBe(level + 3);
        expect(pickAll(sim)).toBe(3);
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

    test("her parasites heal her and no one else", () => {
        for (const id of ["phosani_parasite", "phosani_parasite_weak"]) {
            expect(getEnemy(id).heals?.targets).toEqual(["phosanis_nightmare"]);
        }
    });
});
