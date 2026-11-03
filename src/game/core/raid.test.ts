import { afterAll, describe, expect, it } from "vitest";

import { getEnemy } from "../content/enemies";
import { MAP_BY_ID, RAID_MAPS, getMap } from "../content/maps";
import { getRoomPoints } from "../content/raids";
import { TROPHIES } from "../content/trophies";
import { BossAttackDef, MapDef, RaidRoomDef, emptyStats } from "../content/types";
import { Sim, TICKS_PER_SECOND } from "./Sim";
import {
    createSave,
    getEarnedUnlocks,
    getRaidPortals,
    isEndlessUnlocked,
    isExpertUnlocked,
    isHardUnlocked,
    migrateSave,
    recordRun,
} from "./save";
import { makeGrid } from "./world/testGrid";

// A field split down the middle by a wall: a room each side, the top of each standing in for its
// boss room
function field(): string[] {
    const size = 72;
    const rows: string[] = [];
    for (let y = 0; y < size; y++) {
        let row = "";
        for (let x = 0; x < size; x++) {
            const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
            row += edge || x === 36 ? "#" : ".";
        }
        rows.push(row);
    }
    return rows;
}

const lumbridge = getMap("lumbridge");

// A room at x, its hall at the bottom of the field and its boss room at the top
function room(x: number, boss: string, at: number): RaidRoomDef {
    return {
        name: boss,
        start: { x: x + 0.5, y: 1010.5 },
        arrive: { x: x + 0.5, y: 1050.5 },
        bossAt: { x: x + 4.5, y: 1056.5 },
        chamber: { minX: x - 10, minY: 1045, maxX: x + 10, maxY: 1065 },
        teleporter: { x: x + 6, y: 1010.5 },
        at,
        waves: lumbridge.waves.slice(0, 2),
        events: [],
        boss,
        bossHp: 100,
    };
}

const TEST_RAID: MapDef = {
    ...lumbridge,
    id: "test_raid",
    events: [],
    raid: { rooms: [room(1018, "giant_rat", 30), room(1054, "giant_rat", 80)], minWaveSeconds: 0 },
};
MAP_BY_ID.set(TEST_RAID.id, TEST_RAID);
afterAll(() => {
    MAP_BY_ID.delete(TEST_RAID.id);
});

// raidTeleports: with a teleporter in every hall, as if each boss had been killed before
function raid(expert = false, raidTeleports = 0, raidPortals?: boolean[]): Sim {
    const sim = new Sim({
        grid: makeGrid(field(), 1000, 1000),
        mapId: TEST_RAID.id,
        expert,
        raidTeleports,
        raidPortals: raidPortals ?? TEST_RAID.raid!.rooms.map(() => raidTeleports > 0),
        characterId: "warrior",
        metaStats: emptyStats(),
        seed: 1,
        spawnX: 1018.5,
        spawnY: 1010.5,
    });
    sim.heroes[0].weapons = [];
    sim.player.invulnerable = 1e6;
    return sim;
}

// On to a second of the room, through what that second brings
function toRoomSecond(sim: Sim, seconds: number): void {
    const target = sim.raidRoomStartTick + Math.round(seconds * TICKS_PER_SECOND);
    // Level ups, caskets and random events pause the run: they're skipped here
    for (let steps = 0; sim.tick < target && !sim.runOver; steps++) {
        expect(steps).toBeLessThan(100_000);
        sim.player.invulnerable = 1e6;
        if (sim.state === "levelUp") {
            sim.choose(0);
        }
        if (sim.state === "chest") {
            sim.resolveChest("take");
        }
        if (sim.state === "event") {
            sim.leaveEvent();
        }
        sim.step();
    }
}

function killBosses(sim: Sim): void {
    for (const enemy of sim.enemies) {
        if (enemy.boss && !enemy.dead) {
            for (let hit = 0; hit < 20 && !enemy.dead; hit++) {
                sim.damageEnemy(enemy, 1e9, 0, sim.player.x, sim.player.y);
            }
            expect(enemy.dead).toBe(true);
        }
    }
    sim.step();
}

describe("raids", () => {
    it("brings what's left on the hall's floor to the boss, but not caskets", () => {
        const sim = raid();
        toRoomSecond(sim, 20);
        const { x, y } = sim.player;
        sim.dropPickup("bones", x + 12, y, 40);
        sim.dropPickup("coins", x - 12, y, 7);
        sim.dropPickup("casket", x, y + 12, 1);
        const xp = sim.xp;
        const coins = sim.coins;
        toRoomSecond(sim, 31);
        expect(sim.raidStage).toBe("boss");
        expect(sim.xp).toBeGreaterThan(xp);
        expect(sim.coins).toBeGreaterThan(coins);
        expect(sim.pickups.some((p) => p.kind === "bones" || p.kind === "coins")).toBe(false);
        expect(sim.pickups.some((p) => p.kind === "casket")).toBe(true);
    });

    it("has its waves in the first room, then takes the party into the boss's room", () => {
        const sim = raid();
        toRoomSecond(sim, 20);
        expect(sim.raidStage).toBe("waves");
        expect(sim.enemies.some((enemy) => !enemy.dead && !enemy.boss)).toBe(true);
        expect(sim.timeLeftForBoss).toBeCloseTo(10, 0);

        toRoomSecond(sim, 31);
        expect(sim.raidStage).toBe("boss");
        expect(sim.player.x).toBeCloseTo(1018.5);
        expect(sim.player.y).toBeCloseTo(1050.5);
        const alive = sim.enemies.filter((enemy) => !enemy.dead);
        expect(alive.map((enemy) => enemy.def.id)).toEqual(["giant_rat"]);
        expect(alive[0].finalBoss).toBe(false);
        // Where the room's boss turns up, give or take its first steps
        expect(Math.hypot(alive[0].x - 1022.5, alive[0].y - 1056.5)).toBeLessThan(3);
    });

    it("moves on to the next room once the boss is dead, and wins with the last boss", () => {
        const sim = raid();
        toRoomSecond(sim, 31);
        sim.takeEvents();
        killBosses(sim);
        expect(sim.raidStage).toBe("cleared");
        expect(sim.takeEvents().some((event) => event.type === "notice")).toBe(true);

        toRoomSecond(sim, 38);
        expect(sim.raidRoom).toBe(1);
        expect(sim.raidStage).toBe("waves");
        expect(sim.player.x).toBeCloseTo(1054.5);
        expect(sim.player.y).toBeCloseTo(1010.5);
        expect(sim.timeLeftForBoss).toBeGreaterThan(28);

        // Its boss is due at the run's 80th second, about 47 seconds into the room
        toRoomSecond(sim, 50);
        expect(sim.raidStage).toBe("boss");
        const boss = sim.enemies.find((enemy) => enemy.boss && !enemy.dead)!;
        expect(boss.def.id).toBe("giant_rat");
        expect(boss.finalBoss).toBe(true);
        sim.takeEvents();
        killBosses(sim);
        expect(sim.state).toBe("victory");
        // The last room's paid for too, and then there's the chest
        expect(sim.heroes[0].raidPointsEarned).toBe(400);
        const notices = sim.takeEvents().filter((event) => event.type === "notice");
        expect(notices.some((n) => n.type === "notice" && n.message.includes("chest"))).toBe(true);
        // And it's on the result, for the result screen
        const chest = sim.getResult().raidChest!;
        expect(chest.points).toBe(400);
        expect(chest.chance).toBeGreaterThan(0);
    });

    it("rolls the Theatre's uniques from its chest, more often with more points", () => {
        const sim = raid();
        Object.assign(sim, { map: getMap("theatre_of_blood") });
        const tob = TROPHIES.filter((t) => t.from.kind === "raid");
        sim.heroes[0].raidPointsEarned = 0;
        let few = 0;
        for (let i = 0; i < 200; i++) {
            sim.trophies.clear();
            sim["openRaidChest"]();
            few += sim.trophies.size;
        }
        sim.heroes[0].raidPointsEarned = 5000;
        let many = 0;
        for (let i = 0; i < 200; i++) {
            sim.trophies.clear();
            sim["openRaidChest"]();
            many += sim.trophies.size;
            for (const id of sim.trophies) {
                const trophy = tob.find((t) => t.id === id)!;
                // Hard mode's own only on hard mode
                expect(trophy.from.kind === "raid" && trophy.from.hard).toBeFalsy();
            }
        }
        // 5% and 65%
        expect(few).toBeGreaterThan(2);
        expect(few).toBeLessThan(25);
        expect(many).toBeGreaterThan(100);
    });

    it("keeps a raid's wins, normal and hard, when the save's loaded again", () => {
        const save = createSave();
        save.mapVictories.theatre_of_blood = 1;
        save.hardVictories.theatre_of_blood = 2;
        const loaded = migrateSave(JSON.parse(JSON.stringify(save)));
        expect(loaded.mapVictories.theatre_of_blood).toBe(1);
        expect(loaded.hardVictories.theatre_of_blood).toBe(2);
    });

    it("opens hard mode once a raid's beaten, and never endless", () => {
        const save = createSave();
        expect(isHardUnlocked(save, "theatre_of_blood")).toBe(false);
        save.mapVictories.theatre_of_blood = 1;
        expect(isHardUnlocked(save, "theatre_of_blood")).toBe(true);
        expect(isEndlessUnlocked(save, "theatre_of_blood")).toBe(false);
    });

    it("unlocks the Ghrazi rapier for beating the Theatre, and the Holy scythe on hard", () => {
        const earned = (save: ReturnType<typeof createSave>) =>
            getEarnedUnlocks(save).items.map((item) => item.id);
        const save = createSave();
        expect(earned(save)).not.toContain("ghrazi_rapier");
        save.mapVictories.theatre_of_blood = 1;
        expect(earned(save)).toContain("ghrazi_rapier");
        expect(earned(save)).not.toContain("holy_scythe_of_vitur");
        save.hardVictories.theatre_of_blood = 1;
        expect(earned(save)).toContain("holy_scythe_of_vitur");
    });

    it("scores a room on how fast its boss went down and how little you were hurt", () => {
        expect(getRoomPoints(10, 0, 100)).toBe(200);
        expect(getRoomPoints(120, 100, 100)).toBe(50);
        expect(getRoomPoints(70, 50, 100)).toBe(125);
        expect(getRoomPoints(300, 500, 100)).toBe(50);
    });

    it("opens the supply chest once a room's cleared, paid for in raid points", () => {
        const sim = raid();
        toRoomSecond(sim, 31);
        killBosses(sim);
        expect(sim.state).toBe("event");
        expect(sim.offer?.def.id).toBe("raid_supplies");
        // Down at once, and nothing taken
        expect(sim.raidPoints).toBe(200);

        const options = sim.offer!.options;
        const shark = options.findIndex((o) => o.kind === "supply" && o.supplyId === "shark");
        sim.player.hp = 1;
        expect(sim.chooseEventOption(shark)).toBe(true);
        expect(sim.raidPoints).toBe(170);
        expect(sim.player.hp).toBeGreaterThan(1);
        // Once each, and not past what's left
        expect(sim.chooseEventOption(shark)).toBe(false);
        const brew = options.findIndex(
            (o) => o.kind === "supply" && o.supplyId === "saradomin_brew",
        );
        const stamina = options.findIndex(
            (o) => o.kind === "supply" && o.supplyId === "stamina_potion",
        );
        expect(sim.chooseEventOption(brew)).toBe(true);
        expect(sim.chooseEventOption(stamina)).toBe(true);
        expect(sim.raidPoints).toBe(60);
        expect(sim.buffs.some((buff) => buff.look?.name === "Stamina potion")).toBe(true);
        const divine = options.findIndex(
            (o) => o.kind === "supply" && o.supplyId === "divine_super_combat",
        );
        expect(sim.chooseEventOption(divine)).toBe(false);
        // 200 points' worth: 4 coins each
        expect(sim.coins).toBe(800);

        sim.leaveEvent();
        expect(sim.state).toBe("playing");
        expect(sim.raidStage).toBe("cleared");
    });

    it("leaves nothing on the ground in a room the party's left", () => {
        const sim = raid();
        toRoomSecond(sim, 20);
        sim.dropPickup("coins", 1030.5, 1020.5, 5);
        toRoomSecond(sim, 31);
        for (const pickup of sim.pickups.filter((p) => p.value >= 0)) {
            expect(Math.hypot(pickup.x - 1018.5, pickup.y - 1050.5)).toBeLessThan(5);
        }
    });

    it("lists its raids' rooms in order, each with a boss", () => {
        for (const map of RAID_MAPS) {
            const rooms = map.raid!.rooms;
            expect(rooms.length).toBeGreaterThan(1);
            const bossEvents = map.events.filter(
                (e) => e.kind === "boss" || e.kind === "finalBoss",
            );
            expect(bossEvents.map((e) => e.enemyId)).toEqual(rooms.map((r) => r.boss));
            expect(bossEvents.at(-1)!.kind).toBe("finalBoss");
        }
    });
});

// Every boss the Theatre has, each form of each
const TEST_BOSS_IDS = [
    "maiden_of_sugadinti",
    "tob_pestilent_bloat",
    "nylocas_vasilias",
    "nylocas_vasilias_ranged",
    "nylocas_vasilias_magic",
    "tob_sotetseg",
    "xarpus",
    "tob_verzik_vitur",
    "tob_verzik_vitur_risen",
    "tob_verzik_vitur_spider",
];

describe("the Theatre's bullet shapes", () => {
    // One volley of a boss's attack, from its own spot
    function volley(attackName: string, bossId: string) {
        const sim = raid();
        const def = getEnemy(bossId);
        const attack = def.boss!.attacks.find((a) => a.name === attackName) as BossAttackDef;
        const boss = sim.spawnEnemy(def, "boss", { x: 1018.5, y: 1040.5 })!;
        sim.player.x = sim.player.prevX = 1018.5;
        sim.player.y = sim.player.prevY = 1030.5;
        const emitter = {
            enemyUid: boss.uid,
            attack,
            source: 0,
            nextTick: 0,
            volleysLeft: 1,
            angle: -Math.PI / 2,
            aim: -Math.PI / 2,
            damage: 1,
        };
        sim["fireVolley"](emitter, boss);
        const bullets = sim["bullets"];
        const shot = [];
        for (let i = 0; i < bullets.count; i++) {
            const slot = bullets.order[i];
            shot.push({
                x: bullets.x[slot],
                y: bullets.y[slot],
                vx: bullets.vx[slot],
                vy: bullets.vy[slot],
            });
        }
        return { attack, shot };
    }

    it("a wall is a line across, all going one way, with its gap left out", () => {
        const { attack, shot } = volley("The maze", "tob_sotetseg");
        const pattern = attack.pattern!;
        expect(shot).toHaveLength(pattern.count - pattern.gap!);
        // Across the way it's going (south, at the player), side by side, in front of the boss
        for (const bullet of shot) {
            expect(bullet.y).toBeCloseTo(1040.5 - pattern.from!);
            expect(bullet.vx).toBeCloseTo(0);
            expect(bullet.vy).toBeLessThan(0);
        }
        const xs = shot.map((b) => b.x).sort((a, b) => a - b);
        const steps = xs.slice(1).map((x, i) => Math.round((x - xs[i]) / pattern.spacing!));
        // One step's the gap's, the rest are next to each other
        expect(steps.filter((step) => step !== 1)).toEqual([pattern.gap! + 1]);
    });

    it("a spread starts out past the melee pocket by the boss", () => {
        const { attack, shot } = volley("Blood throw", "maiden_of_sugadinti");
        expect(shot).toHaveLength(attack.pattern!.count);
        for (const bullet of shot) {
            expect(Math.hypot(bullet.x - 1018.5, bullet.y - 1040.5)).toBeCloseTo(
                attack.pattern!.from!,
            );
            // Going away from the boss
            expect(
                (bullet.x - 1018.5) * bullet.vx + (bullet.y - 1040.5) * bullet.vy,
            ).toBeGreaterThan(0);
        }
    });

    it("leaves every raid boss a melee pocket: nothing it fires from itself starts up close", () => {
        const bosses = TEST_BOSS_IDS.map((id) => getEnemy(id));
        for (const boss of bosses) {
            for (const attack of boss.boss!.attacks) {
                const shape = attack.pattern?.shape;
                if (shape && shape !== "closing") {
                    expect(
                        attack.pattern!.from,
                        `${boss.id}: ${attack.name}`,
                    ).toBeGreaterThanOrEqual(2);
                }
            }
        }
    });

    it("a closing ring forms round the player and comes in on them, with its gap", () => {
        const { attack, shot } = volley("Blood tide", "maiden_of_sugadinti");
        const pattern = attack.pattern!;
        expect(shot).toHaveLength(pattern.count - pattern.gap!);
        for (const bullet of shot) {
            const dx = bullet.x - 1018.5;
            const dy = bullet.y - 1030.5;
            expect(Math.hypot(dx, dy)).toBeCloseTo(pattern.distance!);
            // Heading for the middle
            expect(dx * bullet.vx + dy * bullet.vy).toBeLessThan(0);
        }
    });
});

describe("the Theatre's bosses", () => {
    it("pray against missiles and magic, taking less from those weapons", () => {
        const sim = raid();
        const def = getEnemy("maiden_of_sugadinti");
        const hit = (weaponId: string) => {
            const boss = sim.spawnEnemy(def, "boss", { x: 1030.5, y: 1030.5 })!;
            sim["damageSource"] = `weapon:${weaponId}`;
            const hp = boss.hp;
            let dealt = 0;
            for (let i = 0; i < 40; i++) {
                dealt += sim.damageEnemy(boss, 100, 0, sim.player.x, sim.player.y);
            }
            boss.dead = true;
            expect(hp - boss.hp).toBe(dealt);
            return dealt;
        };
        const melee = hit("scythe_of_vitur");
        const ranged = hit("twisted_bow");
        const magic = hit("sanguinesti_staff");
        expect(ranged / melee).toBeCloseTo(0.3, 1);
        expect(magic / melee).toBeCloseTo(0.3, 1);
        // Everything else, as it was
        expect(getEnemy("sotetseg").protects).toBeUndefined();
        expect(getEnemy("tob_sotetseg").protects?.styles).toEqual(["ranged", "magic"]);
    });

    it("the Bloat takes little while he walks, all of it when he's down, and stomps getting up", () => {
        const sim = raid();
        const def = getEnemy("tob_pestilent_bloat");
        const naps = def.boss!.naps!;
        const bloat = sim.spawnEnemy(def, "boss", { x: 1030.5, y: 1030.5 })!;
        sim["damageSource"] = "weapon:scythe_of_vitur";
        const hit = () => {
            const hp = bloat.hp;
            for (let i = 0; i < 20; i++) {
                sim.damageEnemy(bloat, 100, 0, sim.player.x, sim.player.y);
            }
            return hp - bloat.hp;
        };
        const awake = hit();
        bloat.bossState!.nextNap = sim.tick;
        expect(sim["stepNap"](bloat, naps)).toBe(true);
        expect(sim["isNapping"](bloat)).toBe(true);
        const down = hit();
        // Hits vary by 15% either way
        expect(awake / down).toBeGreaterThan(naps.awakeDamage * 0.7);
        expect(awake / down).toBeLessThan(naps.awakeDamage * 1.4);
        sim.tick = bloat.bossState!.napEnd!;
        sim["stepNap"](bloat, naps);
        expect(sim["isNapping"](bloat)).toBe(false);
        expect(bloat.bossState!.windup?.attack.name).toBe(naps.wake);
    });

    it("drop nothing off their adds, and have no visitors, in their rooms", () => {
        const sim = raid();
        toRoomSecond(sim, 31);
        expect(sim.raidStage).toBe("boss");
        const add = sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1020.5, y: 1052.5 })!;
        const pickups = sim.pickups.length;
        sim.damageEnemy(add, 1e9, 0, sim.player.x, sim.player.y);
        expect(add.dead).toBe(true);
        expect(sim.pickups.length).toBe(pickups);
        sim["nextRandomEventSeconds"] = 0;
        sim["stepRandomEvents"]();
        expect(sim.visitor).toBeUndefined();
    });

    it("leave blood and acid on the floor that hurts for as long as you stand in it", () => {
        const sim = raid();
        const def = getEnemy("xarpus");
        const attack = def.boss!.attacks.find((a) => a.name === "Acid")!;
        const lingers = attack.ground!.lingers!;
        const boss = sim.spawnEnemy(def, "boss", { x: 1030.5, y: 1045.5 })!;
        sim.player.invulnerable = 0;
        const x = sim.player.x;
        const y = sim.player.y;
        sim.hazards.push({
            uid: 999,
            enemyUid: boss.uid,
            attack,
            x,
            y,
            radius: attack.ground!.radius,
            damage: 10,
            startTick: sim.tick,
            landTick: sim.tick,
            endTick: sim.tick,
            armed: false,
            fuseTick: -1,
            grabEnd: 0,
            hit: [],
            lingerEnd: -1,
            nextHurt: -1,
        });
        sim["stepHazards"]();
        const hazard = sim.hazards.find((h) => h.uid === 999)!;
        expect(hazard.lingerEnd).toBe(sim.tick + Math.round(lingers.seconds * TICKS_PER_SECOND));
        // Hurt again a while later, standing in it
        sim.player.invulnerable = 0;
        sim.player.x = x;
        sim.player.y = y;
        const hp = sim.player.hp;
        sim.tick = hazard.nextHurt;
        sim["stepHazards"]();
        expect(sim.player.hp).toBeLessThan(hp);
        // And gone once its time's up
        sim.tick = hazard.lingerEnd;
        sim["stepHazards"]();
        expect(sim.hazards.some((h) => h.uid === 999)).toBe(false);
    });
});

describe("expert mode", () => {
    // Hits from one weapon, 20 of them, and what they did
    function hits(sim: Sim, enemyId: string, weaponId: string): number {
        const enemy = sim.spawnEnemy(getEnemy(enemyId), "boss", { x: 1030.5, y: 1030.5 })!;
        sim["damageSource"] = `weapon:${weaponId}`;
        let dealt = 0;
        for (let i = 0; i < 20 && !enemy.dead; i++) {
            dealt += sim.damageEnemy(enemy, 1, 0, sim.player.x, sim.player.y);
        }
        enemy.dead = true;
        return dealt;
    }

    it("is hard mode, and only a raid's", () => {
        expect(raid(true).hard).toBe(true);
        expect(raid(false).expert).toBe(false);
    });

    it("lets each colour of Nylocas take only its own style, and only on expert", () => {
        const expert = raid(true);
        expect(hits(expert, "nylocas_ischyros", "twisted_bow")).toBe(0);
        expect(hits(expert, "nylocas_ischyros", "scythe_of_vitur")).toBeGreaterThan(0);
        expect(hits(expert, "nylocas_toxobolos", "scythe_of_vitur")).toBe(0);
        expect(hits(expert, "nylocas_toxobolos", "twisted_bow")).toBeGreaterThan(0);
        expect(hits(expert, "nylocas_hagios", "twisted_bow")).toBe(0);
        expect(hits(expert, "nylocas_hagios", "sanguinesti_staff")).toBeGreaterThan(0);
        // Anywhere else, any style will do
        expect(hits(raid(false), "nylocas_ischyros", "twisted_bow")).toBeGreaterThan(0);
    });

    it("has Nylocas Vasilias change colour, keeping its hitpoints", () => {
        const sim = raid(true);
        const boss = sim.spawnEnemy(getEnemy("nylocas_vasilias"), "boss", {
            x: 1030.5,
            y: 1030.5,
        })!;
        boss.hp -= 100;
        const hp = boss.hp;
        const every = getEnemy("nylocas_vasilias").boss!.colours!.every;
        sim["stepColours"](boss);
        sim.tick += Math.round(every * TICKS_PER_SECOND);
        sim["stepColours"](boss);
        expect(boss.def.id).toBe("nylocas_vasilias_ranged");
        expect(boss.def.onlyStyle).toBe("ranged");
        expect(boss.hp).toBe(hp);
        // Not off expert mode
        const calm = raid(false);
        const grey = calm.spawnEnemy(getEnemy("nylocas_vasilias"), "boss", {
            x: 1030.5,
            y: 1030.5,
        })!;
        calm.tick += Math.round(every * 3 * TICKS_PER_SECOND);
        calm["stepColours"](grey);
        expect(grey.def.id).toBe("nylocas_vasilias");
    });

    it("pays twice the coins, and gives one of Lil' Zik's looks each clear", () => {
        const sim = raid(true);
        toRoomSecond(sim, 31);
        killBosses(sim);
        // 200 points' worth at 4 coins, twice over
        expect(sim.coins).toBe(1600);
        Object.assign(sim, { map: getMap("theatre_of_blood") });
        sim.trophies.clear();
        sim["openRaidChest"]();
        const looks = TROPHIES.filter((t) => t.from.kind === "raid" && t.from.expert).map(
            (t) => t.id,
        );
        expect([...sim.trophies].some((id) => looks.includes(id))).toBe(true);
    });

    it("sends the Maiden's Matomenos to heal her", () => {
        const expert = raid(true).spawnEnemy(getEnemy("nylocas_matomenos"), "normal", {
            x: 1030.5,
            y: 1030.5,
        })!;
        expect(expert.def.id).toBe("nylocas_matomenos_healer");
        expect(expert.def.heals?.targets).toEqual(["maiden_of_sugadinti"]);
        const normal = raid(false).spawnEnemy(getEnemy("nylocas_matomenos"), "normal", {
            x: 1030.5,
            y: 1030.5,
        })!;
        expect(normal.def.id).toBe("nylocas_matomenos");
    });

    it("has Xarpus turn hits from in front of his stare back on you", () => {
        const sim = raid(true);
        const xarpus = sim.spawnEnemy(getEnemy("xarpus"), "boss", { x: 1030.5, y: 1030.5 })!;
        xarpus.bossState!.enraged = true;
        sim["stepStare"](xarpus);
        // Staring east
        xarpus.bossState!.stareAngle = 0;
        sim["damageSource"] = "weapon:scythe_of_vitur";
        sim.player.invulnerable = 0;
        sim.player.x = sim.player.prevX = 1033.5;
        sim.player.y = sim.player.prevY = 1030.5;
        const hp = sim.player.hp;
        expect(sim.damageEnemy(xarpus, 100, 0, sim.player.x, sim.player.y)).toBe(0);
        expect(sim.player.hp).toBeLessThan(hp);
        // From behind him, it lands
        sim.player.x = sim.player.prevX = 1027.5;
        expect(sim.damageEnemy(xarpus, 100, 0, sim.player.x, sim.player.y)).toBeGreaterThan(0);
    });

    it("has Verzik's green ball spare only whoever's in its circle", () => {
        const sim = raid(true);
        const spider = getEnemy("tob_verzik_vitur_spider");
        const ball = spider.boss!.attacks.find((a) => a.name === "Doom ball")!;
        expect(ball.expert).toBe(true);
        const verzik = sim.spawnEnemy(spider, "boss", { x: 1030.5, y: 1040.5 })!;
        sim["markGround"](verzik, ball, sim.tick);
        const circle = sim.hazards.find((h) => h.attack === ball)!;
        expect(circle.damage).toBe(0);
        // Away from her
        expect(Math.hypot(circle.x - verzik.x, circle.y - verzik.y)).toBeGreaterThanOrEqual(
            ball.ground!.spots[0].shape === "scatter" ? ball.ground!.spots[0].awayFrom! : 0,
        );
        sim.player.x = circle.x;
        sim.player.y = circle.y;
        expect(sim["inSafeMark"](ball)).toBe(true);
        sim.player.x = circle.x + circle.radius + 1;
        expect(sim["inSafeMark"](ball)).toBe(false);
    });

    it("opens once the raid's been beaten on hard, and keeps its wins", () => {
        const save = createSave();
        expect(isExpertUnlocked(save, "theatre_of_blood")).toBe(false);
        save.hardVictories.theatre_of_blood = 1;
        expect(isExpertUnlocked(save, "theatre_of_blood")).toBe(true);
        expect(isExpertUnlocked(save, "lumbridge")).toBe(false);
        recordRun(save, {
            mapId: "theatre_of_blood",
            hard: true,
            expert: true,
            victory: true,
            seconds: 1800,
            level: 50,
            kills: 1000,
            coins: 0,
            bossesKilled: [],
        });
        expect(save.expertVictories.theatre_of_blood).toBe(1);
        expect(save.hardVictories.theatre_of_blood).toBe(2);
        const loaded = migrateSave(JSON.parse(JSON.stringify(save)));
        expect(loaded.expertVictories.theatre_of_blood).toBe(1);
    });
});

describe("raid teleporters", () => {
    const room = () => TEST_RAID.raid!.rooms[0];
    function walkUp(sim: Sim): void {
        sim.player.x = room().teleporter!.x + 1;
        sim.player.y = room().teleporter!.y;
        sim["stepTeleporter"](room());
    }

    it("ask before taking you to the room's boss, saying how many are left", () => {
        const sim = raid(false, 2);
        walkUp(sim);
        expect(sim.state).toBe("event");
        expect(sim.offer?.def.speech).toContain(room().name);
        expect(sim.offer?.def.speech).toContain("2 more teleports");
        expect(sim.chooseEventOption(0)).toBe(true);
        expect(sim.raidStage).toBe("boss");
        expect(sim.raidTeleportsLeft).toBe(1);
    });

    it("can be turned down, and ask again only once you've stepped away", () => {
        const sim = raid(false, 2);
        walkUp(sim);
        sim.leaveEvent();
        expect(sim.state).toBe("playing");
        walkUp(sim);
        expect(sim.state).toBe("playing");
        sim.player.x = room().teleporter!.x - 10;
        sim["stepTeleporter"](room());
        walkUp(sim);
        expect(sim.state).toBe("event");
        expect(sim.raidTeleportsLeft).toBe(2);
    });

    it("are only in the halls of bosses killed before, any of their forms counting", () => {
        const save = createSave();
        expect(getRaidPortals(save, "theatre_of_blood")).toEqual([
            false,
            false,
            false,
            false,
            false,
            false,
        ]);
        save.enemyKills.maiden_of_sugadinti = 1;
        // Expert's blue Vasilias, and Verzik's last form
        save.enemyKills.nylocas_vasilias_magic = 1;
        save.enemyKills.tob_verzik_vitur_spider = 2;
        expect(getRaidPortals(save, "theatre_of_blood")).toEqual([
            true,
            false,
            true,
            false,
            false,
            true,
        ]);
        // Morytania's Verzik isn't the raid's
        expect(
            getRaidPortals({ ...save, enemyKills: { verzik_vitur: 5 } }, "theatre_of_blood")[5],
        ).toBe(false);
        const sim = raid(false, 2, [false, true]);
        expect(sim.raidTeleporter).toBeUndefined();
        walkUp(sim);
        expect(sim.state).toBe("playing");
    });

    it("aren't there before any boss is killed", () => {
        const sim = raid(false, 2, []);
        expect(sim.raidTeleporter).toBeUndefined();
        sim.takeEvents();
        walkUp(sim);
        expect(sim.state).toBe("playing");
        expect(sim.takeEvents().some((e) => e.type === "notice")).toBe(false);
    });

    it("stand in the hall while its waves are on, and go once the boss is up", () => {
        const sim = raid(false, 2);
        expect(sim.raidTeleporter).toEqual(room().teleporter);
        walkUp(sim);
        sim.chooseEventOption(0);
        expect(sim.raidTeleporter).toBeUndefined();
    });

    it("say so once they're used up", () => {
        const sim = raid(false, 2);
        sim.raidTeleportsLeft = 0;
        sim.takeEvents();
        walkUp(sim);
        expect(sim.state).toBe("playing");
        expect(
            sim
                .takeEvents()
                .some((e) => e.type === "notice" && e.message.includes("used all your teleports")),
        ).toBe(true);
    });
});

describe("raids in co-op", () => {
    function partyRaid(players: number): Sim {
        const sim = new Sim({
            grid: makeGrid(field(), 1000, 1000),
            mapId: TEST_RAID.id,
            characterId: "warrior",
            metaStats: emptyStats(),
            seed: 1,
            spawnX: 1018.5,
            spawnY: 1010.5,
            party: Array.from({ length: players }, (_, i) => ({
                name: `p${i}`,
                characterId: "warrior",
                metaStats: emptyStats(),
            })),
        });
        for (const hero of sim.heroes) {
            hero.weapons = [];
            hero.player.invulnerable = 1e6;
        }
        return sim;
    }

    // To the first boss, everyone kept safe and every pause skipped
    function toBoss(sim: Sim): void {
        for (let steps = 0; sim.raidStage === "waves" && steps < 100_000; steps++) {
            for (const hero of sim.heroes) {
                hero.player.invulnerable = 1e6;
            }
            for (const hero of sim.waitingOn) {
                sim.as(hero.index, () => {
                    if (sim.state === "levelUp") sim.choose(0);
                    else if (sim.state === "chest") sim.resolveChest("take");
                    else if (sim.state === "event") sim.leaveEvent();
                });
            }
            sim.step();
        }
    }

    it("gives the supply chest only to who's still in, a turn each", () => {
        const sim = partyRaid(3);
        toBoss(sim);
        sim.leave(1);
        killBosses(sim);
        expect(sim.offer?.hero).toBe(0);
        sim.as(0, () => sim.leaveEvent());
        // Player 2 is next: player 1's gone
        expect(sim.offer?.hero).toBe(2);
        sim.as(2, () => sim.leaveEvent());
        expect(sim.state).toBe("playing");
    });

    it("goes on to the next player's turn if one leaves during theirs", () => {
        const sim = partyRaid(3);
        toBoss(sim);
        killBosses(sim);
        expect(sim.offer?.hero).toBe(0);
        sim.leave(0);
        expect(sim.offer?.hero).toBe(1);
        sim.as(1, () => sim.leaveEvent());
        sim.as(2, () => sim.leaveEvent());
        expect(sim.state).toBe("playing");
        expect(sim["raidShopQueue"]).toEqual([]);
    });
});
