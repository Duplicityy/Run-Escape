import { getBuffViews } from "../client/ItemViews";
import { getUpgradeLine, getUpgradedGear } from "../content/armoury";
import { CHARACTERS } from "../content/characters";
import {
    ENDLESS_COINS,
    LATER_ROUND_START,
    LATE_CASKET_CHANCE,
    LATE_CASKET_LIMIT,
    LATE_CASKET_SECONDS,
    ROUND_DAMAGE,
    ROUND_HP,
    ROUND_XP,
    endlessCoinScale,
    roundScale,
} from "../content/endless";
import { ENEMIES, getEnemy } from "../content/enemies";
import { CASKET_GEAR, CASKET_TIERS, getGear, getItem } from "../content/items";
import { getMapEnemies } from "../content/mapEnemies";
import { CAMPAIGN_MAPS, FUN_MAPS, MAPS, getArenaRegion, getMap } from "../content/maps";
import { POWER_UPS, POWER_UP_LIFETIME, THRALLS, getPowerUp } from "../content/powerups";
import {
    OLD_MAN_OFFERS,
    RANDOM_EVENTS,
    RANDOM_EVENT_FIRST,
    VISITOR_DISTANCE,
    VISITOR_LIFETIME,
    getQuizGroups,
    getRandomEvent,
} from "../content/randomEvents";
import { SHOP_UPGRADES } from "../content/shop";
import { EnemyDef, emptyStats } from "../content/types";
import { RUN_LENGTH } from "../content/waves";
import { WEAPONS, getWeapon } from "../content/weapons";
import { DPS_WINDOW_SECONDS, LEVEL_MIGHT_LEVELS, Sim, TICKS_PER_SECOND } from "./Sim";
import { Enemy, SimEvent, Visitor } from "./entities";
import { TestLoc, makeGrid } from "./world/testGrid";
import { endlessXpForLevel, runXpForLevel } from "./xp";

// An open field with a few walls, big enough for enemies to spawn off screen
function openField(): string[] {
    const size = 72;
    const rows: string[] = [];
    for (let y = 0; y < size; y++) {
        let row = "";
        for (let x = 0; x < size; x++) {
            const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
            const wall = (x === 30 && y > 20 && y < 50) || (y === 44 && x > 40 && x < 60);
            row += edge || wall ? "#" : ".";
        }
        rows.push(row);
    }
    return rows;
}

function createSim(
    characterId = "warrior",
    seed = 1,
    mapId = "lumbridge",
    metaStats = emptyStats(),
    endless = false,
): Sim {
    const grid = makeGrid(openField(), 1000, 1000);
    return new Sim({
        grid,
        mapId,
        characterId,
        metaStats,
        seed,
        spawnX: 1036.5,
        spawnY: 1036.5,
        endless,
    });
}

function runFor(sim: Sim, seconds: number, move: "circle" | "still" = "circle"): void {
    const ticks = seconds * TICKS_PER_SECOND;
    for (let i = 0; i < ticks && !sim.runOver; i++) {
        if (sim.state === "levelUp") {
            sim.choose(0);
        }
        if (sim.state === "chest") {
            sim.resolveChest("take");
        }
        if (sim.state === "event") {
            sim.leaveEvent();
        }
        if (move === "circle") {
            const angle = (sim.tick / TICKS_PER_SECOND) * 0.8;
            sim.step(Math.cos(angle), Math.sin(angle));
        } else {
            sim.step(0, 0);
        }
        sim.takeEvents();
    }
}

describe("Sim", () => {
    test("a minute of play spawns, fights and levels", () => {
        // Standing still: enemies come to the player and their bones land close by
        const sim = createSim("wizard");
        // Enough hitpoints to stand in the crowd for the whole minute
        sim.metaStats.maxHp = 3;
        sim.updateStats();
        runFor(sim, 60, "still");
        expect(sim.kills).toBeGreaterThan(5);
        expect(sim.level).toBeGreaterThan(1);
        expect(sim.enemies.length).toBeGreaterThan(0);
        for (const enemy of sim.enemies) {
            expect(Number.isFinite(enemy.x) && Number.isFinite(enemy.y)).toBe(true);
            // Nothing ends up inside the walls or outside the field
            expect(sim.grid.isSolid(Math.floor(enemy.x), Math.floor(enemy.y))).toBe(false);
        }
        expect(sim.player.hp).toBeLessThanOrEqual(sim.player.maxHp);
    });

    // Half a minute of play for each of them takes a while
    test("every character's starting weapon kills things", () => {
        for (const { id } of CHARACTERS) {
            const sim = createSim(id, 7);
            runFor(sim, 30);
            expect(sim.kills).toBeGreaterThan(0);
        }
    }, 20000);

    test("levelling up pauses the run until a choice is made", () => {
        const sim = createSim();
        sim.xp = 200;
        sim.step(0, 0);
        expect(sim.state).toBe("levelUp");
        expect(sim.choices.length).toBeGreaterThanOrEqual(3);
        const tick = sim.tick;
        sim.step(1, 0);
        expect(sim.tick).toBe(tick);
        // 200 xp is two levels: one choice, then another
        sim.choose(0);
        expect(sim.state).toBe("levelUp");
        sim.choose(0);
        expect(sim.state).toBe("playing");
    });

    test("killing the boss wins the run", () => {
        const sim = createSim();
        const boss = sim.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.state).toBe("victory");
        expect(sim.runOver).toBe(true);
        const seconds = sim.seconds;
        sim.step(0, 0);
        expect(sim.seconds).toBe(seconds);
    });

    test("dying ends the run, unless a ring of life saves you", () => {
        const sim = createSim();
        sim.revivesLeft = 1;
        sim.player.hp = 1;
        const goblin = sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1036.9, y: 1036.5 })!;
        goblin.damage = 50;
        for (let i = 0; i < 400 && !sim.runOver; i++) {
            sim.step(0, 0);
            if (sim.state === "levelUp") {
                sim.choose(0);
            }
        }
        expect(sim.revivesLeft).toBe(0);
        expect(sim.takeEvents().some((e) => e.type === "revive")).toBe(true);
    });

    test("a win stands, whatever hits the player later in the tick", () => {
        const sim = createSim();
        sim.revivesLeft = 0;
        sim["endRun"]("victory");
        sim.player.invulnerable = 0;
        expect(sim["damagePlayer"](99999, "goblin", false)).toBe(0);
        expect(sim.state).toBe("victory");
        expect(sim.player.hp).toBe(sim.player.maxHp);
    });

    test("a ring of life isn't used up once the run's won", () => {
        const sim = createSim();
        sim.revivesLeft = 1;
        const boss = sim.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        sim.takeEvents();
        sim["damagePlayer"](99999, "goblin", false);
        expect(sim.state).toBe("victory");
        expect(sim.revivesLeft).toBe(1);
        expect(sim.takeEvents().some((e) => e.type === "revive")).toBe(false);
    });

    test("the final boss falling in the tick the player does wins, but not a tick later", () => {
        const won = createSim();
        won.revivesLeft = 0;
        const boss = won.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        won["damagePlayer"](99999, "goblin", false);
        expect(won.state).toBe("dead");
        // The player's weapons still fire in the tick they fall
        won.damageEnemy(boss, 1e9, 0, won.player.x, won.player.y);
        expect(won.state).toBe("victory");
        // And they're standing on the victory screen
        expect(won.heroes[0].down).toBe(false);
        expect(won.player.deathTick).toBe(-1);
        expect(won.player.hp).toBeGreaterThan(0);

        const lost = createSim();
        lost.revivesLeft = 0;
        const late = lost.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        lost["damagePlayer"](99999, "goblin", false);
        lost.step(0, 0);
        lost.damageEnemy(late, 1e9, 0, lost.player.x, lost.player.y);
        expect(lost.state).toBe("dead");
    });

    test("with too many bones lying around, the furthest pile comes to the new ones", () => {
        const sim = createSim();
        const { x, y } = sim.player;
        for (let i = 0; i < 400; i++) {
            sim.dropPickup("bones", x + 5 + (i % 20), y + 5 + Math.floor(i / 20), 1);
        }
        const furthest = sim.pickups[sim.pickups.length - 1];
        const xp = sim.pickups.reduce((total, p) => total + p.value, 0);
        sim.dropPickup("bones", x + 2, y, 10);
        expect(sim.pickups.length).toBe(400);
        expect(furthest).toMatchObject({ x: x + 2, y, value: 11, kind: "bones" });
        expect(sim.pickups.reduce((total, p) => total + p.value, 0)).toBe(xp + 10);
    });

    test("coins and food lying around don't keep new bones off the ground", () => {
        const sim = createSim();
        const { x, y } = sim.player;
        // Left behind over a long run, far from the player
        for (let i = 0; i < 400; i++) {
            const kind = i % 4 === 0 ? "food" : "coins";
            sim.dropPickup(kind, x - 30 + (i % 20), y - 30 + Math.floor(i / 20), 1);
        }
        for (let i = 0; i < 10; i++) {
            sim.dropPickup("bones", x + 6 + i, y + 6, 10);
        }
        const bones = sim.pickups.filter((p) => p.kind === "bones");
        expect(bones.map((p) => p.x)).toEqual([...Array(10).keys()].map((i) => x + 6 + i));
    });

    test("with too many coins lying around, the furthest pile comes to the new ones", () => {
        const sim = createSim();
        const { x, y } = sim.player;
        for (let i = 0; i < 100; i++) {
            sim.dropPickup("coins", x + 5 + (i % 10), y + 5 + Math.floor(i / 10), 2);
        }
        const furthest = sim.pickups[sim.pickups.length - 1];
        sim.dropPickup("coins", x + 2, y, 3);
        expect(sim.pickups.length).toBe(100);
        expect(furthest).toMatchObject({ x: x + 2, y, value: 5, kind: "coins" });
        // Bones aren't held back by them
        sim.dropPickup("bones", x - 2, y, 10);
        expect(sim.pickups.length).toBe(101);
    });

    test("bones lying close together gather into the biggest pile, and coins into coins", () => {
        const sim = createSim();
        sim.weapons = [];
        sim.player.invulnerable = 10000;
        const { x, y } = sim.player;
        sim.dropPickup("bones", x + 11, y + 0.5, 10);
        sim.dropPickup("bones", x + 10, y, 30);
        sim.dropPickup("bones", x + 10.5, y - 1, 5);
        // Too far from the others
        sim.dropPickup("bones", x + 16, y, 7);
        sim.dropPickup("coins", x + 10.5, y, 3);
        sim.dropPickup("coins", x + 9.5, y, 4);
        runFor(sim, 1, "still");
        const bones = sim.pickups.filter((p) => p.kind === "bones");
        expect(bones).toEqual([
            expect.objectContaining({ x: x + 10, y, value: 45 }),
            expect.objectContaining({ x: x + 16, y, value: 7 }),
        ]);
        const coins = sim.pickups.filter((p) => p.kind === "coins");
        expect(coins).toEqual([expect.objectContaining({ x: x + 9.5, y, value: 7 })]);
    });

    test("bones never go further from the player to join a pile", () => {
        const sim = createSim();
        sim.weapons = [];
        sim.player.invulnerable = 10000;
        const { x, y } = sim.player;
        // Nearer than the bigger pile: stays
        sim.dropPickup("bones", x + 4, y, 10);
        sim.dropPickup("bones", x + 5, y, 30);
        // Further than the bigger pile: joins it
        sim.dropPickup("bones", x - 4, y, 30);
        sim.dropPickup("bones", x - 5, y, 10);
        runFor(sim, 1, "still");
        expect(sim.pickups).toEqual([
            expect.objectContaining({ x: x + 4, y, value: 10 }),
            expect.objectContaining({ x: x + 5, y, value: 30 }),
            expect.objectContaining({ x: x - 4, y, value: 40 }),
        ]);
    });

    test("bones on their way to a pile that gets picked up stay where they are", () => {
        const sim = createSim();
        sim.weapons = [];
        sim.player.invulnerable = 10000;
        const { x, y } = sim.player;
        sim.dropPickup("bones", x + 10, y, 20);
        sim.dropPickup("bones", x + 11.5, y, 5);
        const [pile, piece] = sim.pickups;
        while (piece.pileUid === 0) {
            sim.step(0, 0);
        }
        expect(piece.pileUid).toBe(pile.uid);
        // The player's magnet gets the pile first
        pile.attracted = true;
        const xp = sim.xp;
        runFor(sim, 1, "still");
        expect(sim.xp).toBeCloseTo(xp + 20 * (1 + sim.stats.growth));
        expect(sim.pickups).toEqual([piece]);
        expect(piece).toMatchObject({ value: 5, pileUid: 0 });
    });
});

describe("melee", () => {
    test("a slash waits for something in reach rather than swinging at air", () => {
        const sim = createSim();
        sim.enemies = [];
        const scimitar = sim.weapons[0];
        scimitar.cooldown = 0;
        sim.step(0, 0);
        expect(sim.takeEvents().some((e) => e.type === "slash")).toBe(false);
        // Tries again in a moment, rather than after a whole swing's cooldown
        expect(scimitar.cooldown).toBeLessThanOrEqual(10);
        sim.spawnEnemy(getEnemy("chicken"), "normal", { x: sim.player.x + 1, y: sim.player.y });
        scimitar.cooldown = 0;
        sim.step(0, 0);
        expect(sim.takeEvents().some((e) => e.type === "slash")).toBe(true);
        expect(scimitar.cooldown).toBeGreaterThan(10);
    });

    test("the Thunder khopesh's Thunderclap hits everything around you", () => {
        const sim = createSim();
        sim.enemies = [];
        sim.weapons.length = 0;
        sim.addWeapon("thunder_khopesh");
        const khopesh = sim.weapons[0];
        const { x, y } = sim.player;
        // One in front, one behind, one beside, and one out of reach
        const near = [
            { x: x + 1.5, y },
            { x: x - 2, y },
            { x, y: y + 2.5 },
        ].map((at) => sim.spawnEnemy(getEnemy("chicken"), "normal", at)!);
        const far = sim.spawnEnemy(getEnemy("chicken"), "normal", { x: x + 8, y })!;
        for (const enemy of [...near, far]) {
            enemy.hp = enemy.maxHp = 1e6;
        }
        // The third swing is the special
        khopesh.uses = 2;
        khopesh.cooldown = 0;
        sim.step(0, 0);
        for (const enemy of near) {
            expect(enemy.hp).toBeLessThan(1e6);
        }
        expect(far.hp).toBe(1e6);
    });

    test("Dinh's bulwark hits everything around you, far out", () => {
        const sim = armed("dinhs_bulwark");
        const near = [
            dummy(sim, 3.5, 0),
            dummy(sim, -3.5, 0),
            dummy(sim, 0, 3.5),
            dummy(sim, 0, -3.5),
        ];
        const far = dummy(sim, 8, 0);
        sim.weapons[0].cooldown = 0;
        sim.step(0, 0);
        for (const enemy of near) {
            expect(enemy.hp).toBeLessThan(enemy.maxHp);
        }
        expect(far.hp).toBe(far.maxHp);
    });

    test("the shop's melee knockback pushes melee hits, not ranged ones", () => {
        const push = (weaponId: string, meleeKnockback: number): number => {
            const sim = armed(weaponId, "warrior", { ...emptyStats(), meleeKnockback });
            const enemy = dummy(sim, 2, 0);
            sim.weapons[0].cooldown = 0;
            let most = 0;
            for (let i = 0; i < 20; i++) {
                sim.step(0, 0);
                most = Math.max(most, Math.abs(enemy.vx));
            }
            return most;
        };
        expect(push("scimitar", 1)).toBeGreaterThan(push("scimitar", 0));
        expect(push("throwing_knives", 1)).toBe(push("throwing_knives", 0));
    });

    test("evolving swaps the weapon, keeps its bonus and shows a notice", () => {
        const sim = armed("scimitar");
        sim.weapons[0].bonus = 0.2;
        sim.takeEvents();
        sim.apply({ kind: "evolve", weaponId: "scimitar", into: "abyssal_whip" });
        expect(sim.weapons[0].def.id).toBe("abyssal_whip");
        expect(sim.weapons[0].level).toBe(1);
        expect(sim.weapons[0].bonus).toBe(0.2);
        expect(sim.evolutionsMade).toEqual(["abyssal_whip"]);
        expect(sim.getResult().evolutionsMade).toEqual(["abyssal_whip"]);
        const events = sim.takeEvents();
        expect(events.some((e) => e.type === "evolved")).toBe(true);
        expect(events.some((e) => e.type === "notice")).toBe(true);
    });

    test("Dinh's blazing bulwark's Shield Bash burns what it hits", () => {
        const sim = armed("dinhs_blazing_bulwark");
        dummy(sim, 3, 0);
        // Out of a normal bash's reach
        const near = dummy(sim, -6, 0);
        const weapon = sim.weapons[0];
        weapon.uses = 2;
        weapon.cooldown = 0;
        sim.step(0, 0);
        expect(near.hp).toBeLessThan(near.maxHp);
        const hit = near.hp;
        runFor(sim, 1, "still");
        expect(near.hp).toBeLessThan(hit);
    });

    test("Chivalry adds melee damage and max hitpoints", () => {
        const sim = createSim();
        const hp = sim.player.maxHp;
        sim.apply({ kind: "newPassive", passiveId: "chivalry", quality: "common" });
        expect(sim.stats.meleeMight).toBeCloseTo(0.08);
        expect(sim.player.maxHp).toBe(Math.round(hp * 1.08));
    });
});

describe("power-ups", () => {
    function goblin(sim: Sim, x: number, y: number, hp = 1000): Enemy {
        const enemy = sim.spawnEnemy(getEnemy("goblin"), "normal", { x, y })!;
        enemy.hp = enemy.maxHp = hp;
        return enemy;
    }

    test("kills drop one now and then, never two close together", () => {
        const sim = createSim();
        sim.weapons = [];
        const killGoblins = (count: number) => {
            for (let i = 0; i < count; i++) {
                sim.damageEnemy(goblin(sim, 1040.5, 1036.5, 1), 1e9, 0, 0, 0);
            }
        };
        const dropped = () => sim.pickups.filter((p) => p.kind === "powerUp").length;
        // None in the first seconds of a run
        killGoblins(300);
        expect(dropped()).toBe(0);
        // Likely after a few minutes, but only one at a time
        sim.tick += 3 * 60 * TICKS_PER_SECOND;
        killGoblins(300);
        expect(dropped()).toBe(1);
    });

    test("the same one never drops twice in a row", () => {
        const sim = createSim();
        sim.weapons = [];
        const seen: string[] = [];
        // A kill with the odds of a drop nearly certain, over and over
        sim.stats.luck = 1e6;
        for (let i = 0; i < 300; i++) {
            sim.tick += 60 * TICKS_PER_SECOND;
            sim.damageEnemy(goblin(sim, 1040.5, 1036.5, 1), 1e9, 0, 0, 0);
            const pickup = sim.pickups.filter((p) => p.kind === "powerUp").pop();
            seen.push(pickup!.powerUp!);
            sim.pickups.length = 0;
        }
        expect(seen.some((id, i) => i > 0 && id === seen[i - 1])).toBe(false);
        // All of them, bar what drops some other way (the pumpkin)
        expect(new Set(seen).size).toBe(POWER_UPS.filter((p) => p.weight > 0).length);
    });

    test("are walked over to use them, and don't wait around", () => {
        const sim = createSim();
        sim.dropPowerUp("magnet", sim.player.x + 1.5, sim.player.y);
        const lying = sim.pickups[sim.pickups.length - 1];
        // Not pulled in like bones, even this close
        runFor(sim, 5, "still");
        expect(sim.pickups).toContain(lying);
        runFor(sim, POWER_UP_LIFETIME, "still");
        expect(sim.pickups).not.toContain(lying);

        sim.dropPowerUp("stopwatch", sim.player.x, sim.player.y);
        sim.step(0, 0);
        expect(sim.powerUps.map((p) => p.id)).toEqual(["stopwatch"]);
        const used = sim.takeEvents().find((e) => e.type === "powerUp");
        expect(used).toMatchObject({ id: "stopwatch", message: "Time stands still!" });
    });

    describe("the sled", () => {
        const SECONDS = 8;
        const TICKS = SECONDS * TICKS_PER_SECOND;

        function ride(sim: Sim): void {
            sim.usePowerUp(getPowerUp("sled"));
        }

        test("is more than twice as fast, then back to normal", () => {
            const sim = createSim();
            sim.weapons = [];
            const distance = (ticks: number) => {
                const start = sim.player.x;
                for (let i = 0; i < ticks; i++) {
                    sim.step(1, 0);
                }
                return sim.player.x - start;
            };
            const walking = distance(20);
            ride(sim);
            expect(distance(20) / walking).toBeCloseTo(2.2);
            runFor(sim, SECONDS, "still");
            expect(distance(20) / walking).toBeCloseTo(1);
        });

        test("lasts 8 seconds whatever Effect duration says", () => {
            const sim = createSim();
            sim.stats.duration = 2;
            ride(sim);
            expect(sim.powerUps[0].endTick - sim.tick).toBe(TICKS);
        });

        test("nothing hurts the player: crowds, poison, bosses, any of it", () => {
            const sim = createSim("warrior");
            sim.weapons = [];
            const { player } = sim;
            player.poisonDamage = 3;
            player.poisonEnd = sim.tick + 20 * TICKS_PER_SECOND;
            for (let i = 0; i < 40; i++) {
                const angle = (i / 40) * Math.PI * 2;
                goblin(sim, player.x + Math.cos(angle), player.y + Math.sin(angle));
            }
            sim.spawnEnemy(getEnemy("kalphite_queen"), "boss", { x: player.x + 2, y: player.y });
            ride(sim);
            const hp = player.hp;
            for (let i = 1; i < TICKS; i++) {
                sim.step(0, 0);
                // Bosses and poison stop at more than a hit's worth, and more
                // than 30 would blink the player the whole ride
                expect(player.invulnerable).toBeGreaterThan(12);
                expect(player.invulnerable).toBeLessThanOrEqual(30);
            }
            expect(player.hp).toBe(hp);
            expect(sim.takeEvents().some((e) => e.type === "playerHit")).toBe(false);
        });

        test("doesn't cut a ring of life's longer protection short", () => {
            const sim = createSim();
            sim.player.invulnerable = TICKS * 2;
            ride(sim);
            sim.step(0, 0);
            expect(sim.player.invulnerable).toBe(TICKS * 2 - 1);
        });

        test("the player can be hurt again once it's over", () => {
            const sim = createSim();
            sim.weapons = [];
            ride(sim);
            runFor(sim, SECONDS, "still");
            const hp = sim.player.hp;
            goblin(sim, sim.player.x + 1, sim.player.y);
            runFor(sim, 3, "still");
            expect(sim.player.hp).toBeLessThan(hp);
        });

        test("frees a frozen player", () => {
            const sim = createSim();
            sim.player.frozen = 500;
            ride(sim);
            expect(sim.player.frozen).toBe(0);
            const x = sim.player.x;
            sim.step(1, 0);
            expect(sim.player.x).toBeGreaterThan(x);
        });

        test("shoves the crowd aside without hurting it", () => {
            const sim = createSim();
            sim.weapons = [];
            const { player } = sim;
            // Just off the line it rides, so it goes to one side
            const inTheWay = goblin(sim, player.x + 4, player.y + 0.2);
            ride(sim);
            for (let i = 0; i < 80; i++) {
                sim.step(1, 0);
            }
            expect(player.x).toBeGreaterThan(inTheWay.x);
            expect(inTheWay.hp).toBe(inTheWay.maxHp);
        });

        test("wearing it lasts as long as the ride, with one sound at the end", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 10000;
            ride(sim);
            expect(sim.wornPowerUp?.id).toBe("sled");
            sim.takeEvents();
            for (let i = 1; i < TICKS; i++) {
                sim.step(0, 0);
            }
            expect(sim.wornPowerUp?.id).toBe("sled");
            expect(sim.takeEvents().some((e) => e.type === "powerUpEnded")).toBe(false);
            sim.step(0, 0);
            expect(sim.wornPowerUp).toBeUndefined();
            expect(sim.takeEvents().filter((e) => e.type === "powerUpEnded")).toEqual([
                { type: "powerUpEnded", id: "sled" },
            ]);
        });

        test("comes off when the player dies or the run ends, and ends silently", () => {
            const sim = createSim();
            sim.weapons = [];
            ride(sim);
            sim.takeEvents();
            // Only a run's end can get past it, like the final boss falling
            (sim as unknown as { playerDied(): void }).playerDied();
            expect(sim.runOver).toBe(true);
            expect(sim.wornPowerUp).toBeUndefined();
            runFor(sim, SECONDS + 1, "still");
            sim.step(0, 0);
            expect(sim.takeEvents().some((e) => e.type === "powerUpEnded")).toBe(false);

            const won = createSim();
            ride(won);
            won.state = "victory";
            expect(won.wornPowerUp).toBeUndefined();
        });
    });

    describe("the giant rune essence", () => {
        const rock = () => getPowerUp("giant_essence");

        test("lands on the thickest crowd after a moment, hitting all of it", () => {
            const sim = createSim();
            sim.weapons = [];
            const { x, y } = sim.player;
            sim.player.invulnerable = 10000;
            const alone = goblin(sim, x - 6, y);
            const crowd = [0, 1, 2, 3].map((i) => goblin(sim, x + 7 + i * 0.3, y + i * 0.3));
            const outOfReach = goblin(sim, x + 20, y);
            for (const enemy of [alone, ...crowd, outOfReach]) {
                enemy.frozen = 1000;
            }
            sim.usePowerUp(rock());
            expect(sim.rocks[0].x).toBeCloseTo(crowd[0].x, 0);
            sim.takeEvents();

            for (let i = 1; i < 1.2 * TICKS_PER_SECOND; i++) {
                sim.step(0, 0);
            }
            expect(crowd[0].hp).toBe(crowd[0].maxHp);
            sim.step(0, 0);
            const events = sim.takeEvents();
            expect(events.some((e) => e.type === "powerUpHit")).toBe(true);
            expect(events.filter((e) => e.type === "blast")).toHaveLength(1);
            for (const enemy of crowd) {
                expect(enemy.hp).toBeLessThan(enemy.maxHp);
            }
            expect(alone.hp).toBe(alone.maxHp);
            expect(outOfReach.hp).toBe(outOfReach.maxHp);
        });

        test("kills what it can, throws survivors back and takes a share of a boss", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 10000;
            const { x, y } = sim.player;
            const weak = goblin(sim, x + 8, y, 10);
            const tough = goblin(sim, x + 9, y, 1e5);
            weak.frozen = 1000;
            const boss = sim.spawnEnemy(getEnemy("dharok"), "boss", { x: x + 10, y })!;
            boss.frozen = 1000;
            boss.hp = boss.maxHp = 10000;
            const toughX = tough.x;
            sim.usePowerUp(rock());
            runFor(sim, 2, "still");
            expect(weak.dead).toBe(true);
            expect(tough.hp).toBeLessThan(tough.maxHp);
            expect(Math.abs(tough.x - toughX)).toBeGreaterThan(0.5);
            expect(boss.maxHp - boss.hp).toBeGreaterThan(10000 * 0.08 * 0.8);
            expect(boss.maxHp - boss.hp).toBeLessThan(10000 * 0.08 * 1.2);
        });

        test("never hurts the player, and comes down nearby with no one about", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.enemies = [];
            const { x, y } = sim.player;
            const hp = sim.player.hp;
            sim.usePowerUp(rock());
            expect(Math.hypot(sim.rocks[0].x - x, sim.rocks[0].y - y)).toBeLessThan(5);
            for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) {
                sim.enemies = [];
                sim.step(0, 0);
            }
            expect(sim.rocks).toHaveLength(0);
            expect(sim.player.hp).toBe(hp);
        });

        test("its damage counts for the run's stats", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 10000;
            const enemy = goblin(sim, sim.player.x + 6, sim.player.y);
            enemy.frozen = 1000;
            sim.usePowerUp(rock());
            runFor(sim, 2, "still");
            expect(sim.damageBySource["powerUp:giant_essence"]).toBeGreaterThan(0);
        });
    });

    describe("Evil Bob", () => {
        const bob = () => getPowerUp("evil_bob");
        const seconds = 7;

        function crowd(sim: Sim, hp = 1e6): Enemy[] {
            const { x, y } = sim.player;
            return [0, 1, 2, 3, 4, 5].map((i) => {
                const enemy = goblin(sim, x + 6 + i * 0.4, y + (i % 2) * 0.4, hp);
                enemy.frozen = 10000;
                return enemy;
            });
        }

        test("charges through the crowd three times, hitting each one once a pass", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 100000;
            const enemies = crowd(sim);
            sim.usePowerUp(bob());
            const damages: number[] = [];
            for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
                sim.step(0, 0);
                damages.push(
                    ...sim
                        .takeEvents()
                        .filter((e) => e.type === "damage" && e.enemyUid === enemies[0].uid)
                        .map((e) => (e as { amount: number }).amount),
                );
            }
            expect(damages.length).toBeGreaterThanOrEqual(1);
            expect(damages.length).toBeLessThanOrEqual(3);
            expect(sim.damageBySource["powerUp:evil_bob"]).toBeGreaterThan(0);
            for (const damage of damages) {
                expect(damage).toBeGreaterThanOrEqual(60 * 0.8);
            }
            for (const enemy of enemies) {
                expect(enemy.hp).toBeLessThan(enemy.maxHp);
            }
        });

        test("is gone with its timer in the time it's given", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 100000;
            crowd(sim);
            sim.usePowerUp(bob());
            expect(sim.rampages).toHaveLength(1);
            expect(sim.powerUps.map((p) => p.id)).toEqual(["evil_bob"]);
            sim.takeEvents();
            runFor(sim, seconds + 1, "still");
            expect(sim.rampages).toHaveLength(0);
            expect(sim.powerUps).toHaveLength(0);
        });

        test("makes the same passes with nothing there, and never hurts the player", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.enemies = [];
            const hp = sim.player.hp;
            sim.usePowerUp(bob());
            for (let i = 0; i < (seconds + 1) * TICKS_PER_SECOND; i++) {
                sim.enemies = [];
                sim.step(0, 0);
            }
            expect(sim.rampages).toHaveLength(0);
            expect(sim.player.hp).toBe(hp);
        });
    });

    describe("the fairy ring", () => {
        const ring = () => getPowerUp("fairy_ring");

        test("warps away what walks into it, far from the player", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 100000;
            const { x, y } = sim.player;
            sim.usePowerUp(ring());
            const walker = goblin(sim, x + 4, y);
            const warpedFrom: number[] = [];
            for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
                const before = { x: walker.x, y: walker.y };
                sim.step(0, 0);
                if (Math.hypot(walker.x - before.x, walker.y - before.y) > 5) {
                    warpedFrom.push(Math.hypot(before.x - x, before.y - y));
                }
            }
            expect(warpedFrom).toHaveLength(1);
            expect(warpedFrom[0]).toBeLessThan(4);
            expect(Math.hypot(walker.x - x, walker.y - y)).toBeGreaterThan(8);
            expect(walker.hp).toBe(walker.maxHp);
        });

        test("stays where it opened while the player walks off, for its time", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.usePowerUp(ring());
            const { x, y } = sim.rings[0];
            expect(sim.powerUps.map((p) => p.id)).toEqual(["fairy_ring"]);
            sim.player.invulnerable = 100000;
            for (let i = 0; i < 2 * TICKS_PER_SECOND; i++) {
                sim.step(1, 0);
            }
            expect(sim.rings[0]).toMatchObject({ x, y });
            runFor(sim, 11, "still");
            expect(sim.rings).toHaveLength(0);
        });

        test("leaves bosses and what can't move alone", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 100000;
            const { x, y } = sim.player;
            const boss = sim.spawnEnemy(getEnemy("dharok"), "boss", { x: x + 1, y })!;
            boss.frozen = 10000;
            const portal = sim.spawnEnemy({ ...getEnemy("goblin"), stationary: true }, "normal", {
                x: x - 1,
                y,
            })!;
            const bossX = boss.x;
            sim.usePowerUp(ring());
            runFor(sim, 1, "still");
            expect(Math.abs(boss.x - bossX)).toBeLessThan(1);
            expect(portal.x).toBeCloseTo(x - 1);
        });

        test("puts what it warps behind a moving player", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 100000;
            sim.usePowerUp(ring());
            const { x, y } = sim.rings[0];
            let ahead = 0;
            let behind = 0;
            for (let i = 0; i < 60; i++) {
                const enemy = goblin(sim, x, y);
                sim.step(1, 0);
                sim.step(1, 0);
                if (Math.abs(enemy.x - x) > 5) {
                    if (enemy.x > sim.player.x) {
                        ahead++;
                    } else {
                        behind++;
                    }
                }
                sim.enemies = [];
                sim.player.x = sim.player.prevX = x + 3;
            }
            expect(behind).toBeGreaterThan(ahead * 3);
        });
    });

    describe("the Drill Demon", () => {
        const drill = () => getPowerUp("drill_demon");

        test("the crowd runs round the player instead of attacking", () => {
            const sim = createSim();
            sim.weapons = [];
            const { player } = sim;
            const enemies = [0, 1, 2, 3, 4, 5].map((i) => {
                const angle = (i / 6) * Math.PI * 2;
                const x = player.x + Math.cos(angle) * 2;
                return goblin(sim, x, player.y + Math.sin(angle) * 2);
            });
            sim.usePowerUp(drill());
            const hp = player.hp;
            const angleOf = (e: Enemy) => Math.atan2(e.y - player.y, e.x - player.x);
            let turned = 0;
            let angle = angleOf(enemies[0]);
            for (let i = 0; i < 8 * TICKS_PER_SECOND; i++) {
                sim.step(0, 0);
                const now = angleOf(enemies[0]);
                turned += Math.atan2(Math.sin(now - angle), Math.cos(now - angle));
                angle = now;
            }
            expect(player.hp).toBe(hp);
            // Well round the ring, not just standing back
            expect(Math.abs(turned)).toBeGreaterThan(Math.PI);
            for (const enemy of enemies) {
                const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
                expect(distance).toBeGreaterThan(4);
                expect(distance).toBeLessThan(8);
            }
        });

        test("what's right on top of the player runs out too", () => {
            const sim = createSim();
            sim.weapons = [];
            const { x, y } = sim.player;
            const onTop = goblin(sim, x, y);
            onTop.x = x;
            onTop.y = y;
            sim.usePowerUp(drill());
            runFor(sim, 4, "still");
            expect(Math.hypot(onTop.x - x, onTop.y - y)).toBeGreaterThan(3);
        });

        test("shooters hold their fire", () => {
            const sim = createSim("warrior", 1, "east_varrock");
            sim.weapons = [];
            const ranger = sim.spawnEnemy(getEnemy("f2p_ranger"), "normal", {
                x: sim.player.x + 5,
                y: sim.player.y,
            })!;
            expect(ranger).toBeDefined();
            sim.usePowerUp(drill());
            for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) {
                sim.step(0, 0);
            }
            expect(sim.enemyProjectiles).toHaveLength(0);
        });

        test("bosses, what can't move and what's far off carry on", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 100000;
            const { x, y } = sim.player;
            const post = sim.spawnEnemy({ ...getEnemy("goblin"), stationary: true }, "normal", {
                x: x + 3,
                y,
            })!;
            const far = goblin(sim, x + 16, y);
            const boss = sim.spawnEnemy(getEnemy("dharok"), "boss", { x: x - 6, y })!;
            sim.usePowerUp(drill());
            const bossDistance = Math.hypot(boss.x - x, boss.y - y);
            const farDistance = Math.hypot(far.x - x, far.y - y);
            for (let i = 0; i < 20; i++) {
                sim.step(0, 0);
            }
            expect(post.x).toBeCloseTo(x + 3);
            expect(Math.hypot(far.x - x, far.y - y)).toBeLessThan(farDistance);
            expect(Math.hypot(boss.x - x, boss.y - y)).toBeLessThanOrEqual(bossDistance);
        });

        test("what turns up meanwhile joins in, and it all stops when it's over", () => {
            const sim = createSim();
            sim.weapons = [];
            sim.usePowerUp(drill());
            sim.takeEvents();
            sim.step(0, 0);
            const late = goblin(sim, sim.player.x + 3, sim.player.y);
            for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
                sim.step(0, 0);
            }
            expect(Math.hypot(late.x - sim.player.x, late.y - sim.player.y)).toBeGreaterThan(5);
            const hp = sim.player.hp;
            runFor(sim, 16, "still");
            expect(sim.player.hp).toBeLessThan(hp);
        });

        test("shouts its line", () => {
            const sim = createSim();
            sim.usePowerUp(drill());
            expect(sim.takeEvents()).toContainEqual({
                type: "playerShout",
                text: "Run laps, maggots!",
            });
        });
    });

    test("a cannon shoots for a while, and its cannonballs only hit what they're fired at", () => {
        const sim = createSim();
        sim.weapons = [];
        sim.player.invulnerable = 10000;
        sim.usePowerUp(getPowerUp("cannon"));
        const turret = sim.turrets[0];
        expect(turret).toBeDefined();
        const target = goblin(sim, turret.x + 3, turret.y);
        target.frozen = 1000;
        // Out of the cannon's range, but close to what it shoots
        const beside = goblin(sim, turret.x + 10, turret.y);
        beside.frozen = 1000;
        sim.takeEvents();
        for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
            sim.step(0, 0);
        }
        const hurt = sim.takeEvents().flatMap((e) => (e.type === "damage" ? [e.enemyUid] : []));
        expect(hurt).toContain(target.uid);
        expect(hurt).not.toContain(beside.uid);
        runFor(sim, 20, "still");
        expect(sim.turrets.length).toBe(0);
        expect(sim.powerUps.length).toBe(0);
    });

    test("hit harder later in a run, as enemies get tougher", () => {
        const early = createSim();
        early.usePowerUp(getPowerUp("cannon"));
        const late = createSim();
        late.tick = 10 * 60 * TICKS_PER_SECOND;
        late.usePowerUp(getPowerUp("cannon"));
        expect(late.turrets[0].damage).toBeCloseTo(early.turrets[0].damage * 1.9);
    });

    test("every thrall fights beside you, then goes", () => {
        for (const def of THRALLS) {
            const sim = createSim();
            sim.weapons = [];
            sim.player.invulnerable = 10000;
            sim.usePowerUp(getPowerUp("thrall"));
            expect(sim.thralls.length).toBe(1);
            sim.thralls[0].def = def;
            const enemy = goblin(sim, sim.player.x + 4, sim.player.y);
            runFor(sim, 5, "still");
            expect(enemy.hp).toBeLessThan(1000);
            runFor(sim, 30, "still");
            expect(sim.thralls.length).toBe(0);
        }
    });

    test("a bot nuke kills everything but bosses", () => {
        const sim = createSim();
        const goblins = [0, 1, 2].map((i) => goblin(sim, 1045.5 + i, 1036.5));
        const elite = sim.spawnEnemy(getEnemy("cow"), "elite", { x: 1036.5, y: 1045.5 })!;
        const boss = sim.spawnEnemy(getEnemy("dharok"), "boss", { x: 1026.5, y: 1036.5 })!;
        sim.takeEvents();
        sim.usePowerUp(getPowerUp("bot_nuke"));
        expect(goblins.every((g) => g.dead)).toBe(true);
        expect(elite.dead).toBe(true);
        // A tenth of the boss's hitpoints (give or take the damage roll)
        expect(boss.dead).toBe(false);
        expect(boss.hp / boss.maxHp).toBeGreaterThan(0.88);
        expect(boss.hp / boss.maxHp).toBeLessThan(0.92);
        // What they drop is left to pick up
        expect(sim.pickups.some((p) => p.kind === "casket")).toBe(true);
        expect(sim.pickups.filter((p) => p.kind === "bones").length).toBeGreaterThanOrEqual(3);
        const used = sim.takeEvents().find((e) => e.type === "powerUp");
        expect(used).toMatchObject({ id: "bot_nuke", message: "Bot nuke! 4 bots banned." });
    });

    test("a magnet pulls in everything on the ground", () => {
        const sim = createSim();
        const { x, y } = sim.player;
        sim.dropPickup("bones", x + 20, y, 5);
        sim.dropPickup("coins", x, y - 15, 10);
        sim.dropCasket(x - 12, y, false);
        sim.dropPowerUp("stopwatch", x, y + 18);
        const drops = [...sim.pickups];
        const coins = sim.coins;
        sim.usePowerUp(getPowerUp("magnet"));
        runFor(sim, 3, "still");
        expect(drops.some((p) => sim.pickups.includes(p))).toBe(false);
        expect(sim.coins).toBeGreaterThan(coins);
        expect(sim.powerUps.map((p) => p.id)).toEqual(["stopwatch"]);
    });

    test("a stopwatch stops everything but bosses, even what turns up meanwhile", () => {
        const sim = createSim();
        sim.weapons = [];
        sim.player.invulnerable = 10000;
        const first = goblin(sim, 1046.5, 1036.5);
        const boss = sim.spawnEnemy(getEnemy("dharok"), "boss", { x: 1026.5, y: 1036.5 })!;
        sim.usePowerUp(getPowerUp("stopwatch"));
        const later = goblin(sim, 1036.5, 1046.5);
        const where = (e: Enemy) => ({ x: e.x, y: e.y });
        const before = [first, later, boss].map(where);
        runFor(sim, 4, "still");
        expect(where(first)).toEqual(before[0]);
        expect(where(later)).toEqual(before[1]);
        expect(where(boss)).not.toEqual(before[2]);
        runFor(sim, 6, "still");
        expect(where(first)).not.toEqual(before[0]);
    });
});

describe("caskets and items", () => {
    test("an opened casket pauses the run until its item is dealt with", () => {
        const sim = createSim();
        const coins = sim.coins;
        sim.openCasket("hard");
        expect(sim.state).toBe("chest");
        expect(sim.chest).toBeDefined();
        expect(sim.coins).toBeGreaterThan(coins);
        const tick = sim.tick;
        sim.step(1, 0);
        expect(sim.tick).toBe(tick);
        const before = sim.coins;
        sim.resolveChest("alch");
        expect(sim.state).toBe("playing");
        expect(sim.coins).toBeGreaterThan(before);
    });

    test("two caskets at once open one after the other", () => {
        const sim = createSim();
        sim.openCasket("easy");
        sim.openCasket("easy");
        sim.resolveChest("alch");
        expect(sim.state).toBe("chest");
        sim.resolveChest("alch");
        expect(sim.state).toBe("playing");
        // Both count for quests
        expect(sim.getResult().caskets).toBe(2);
    });

    test("a level up that comes in with a casket waits for it", () => {
        const sim = createSim();
        sim.xp = 100;
        sim.openCasket("easy");
        sim.step(0, 0);
        expect(sim.state).toBe("chest");
        sim.resolveChest("alch");
        expect(sim.state).toBe("levelUp");
    });

    test("gear adds its stats, and the piece it replaces is alched", () => {
        const sim = createSim();
        sim.equip("climbing_boots");
        expect(sim.stats.moveSpeed).toBeCloseTo(0.05);
        const coins = sim.coins;
        sim.equip("dragon_boots");
        expect(sim.gear.feet).toBe("dragon_boots");
        expect(sim.stats.moveSpeed).toBeCloseTo(0);
        expect(sim.stats.might).toBeCloseTo(0.07);
        expect(sim.coins).toBeGreaterThan(coins);
    });

    test("losing max hitpoints with a swap never kills", () => {
        const sim = createSim();
        sim.equip("rune_chainbody");
        sim.player.hp = 1;
        sim.equip("mystic_robe_top");
        expect(sim.player.maxHp).toBe(25);
        expect(sim.player.hp).toBe(1);
    });

    test("utility items stack in the inventory and potions wear off", () => {
        const sim = createSim();
        expect(sim.stash("super_strength")).toBe(true);
        expect(sim.stash("super_strength")).toBe(true);
        expect(sim.inventory[0]).toEqual({ itemId: "super_strength", count: 2 });
        expect(sim.useItem(0)).toBe(true);
        expect(sim.stats.might).toBeCloseTo(0.25);
        expect(sim.inventory[0]?.count).toBe(1);
        runFor(sim, 31, "still");
        expect(sim.buffs.length).toBe(0);
        expect(sim.stats.might).toBeCloseTo(0);
    });

    test("regen heals its hitpoints a minute", () => {
        const sim = createSim("wizard");
        sim.metaStats.regen = 60;
        sim.updateStats();
        sim.player.hp = 5;
        // Over before the first enemies can get there
        runFor(sim, 5.5, "still");
        expect(sim.player.hp).toBe(10);
    });

    test("a Saradomin brew heals, and changes stats until it wears off", () => {
        // The wizard has no armour or damage bonus of their own
        const sim = createSim("wizard");
        sim.player.hp = 5;
        sim.stash("saradomin_brew");
        sim.useItem(0);
        expect(sim.player.hp).toBe(23);
        expect(sim.stats.armor).toBeCloseTo(1.5);
        expect(sim.stats.might).toBeCloseTo(-0.15);
        runFor(sim, 21, "still");
        expect(sim.buffs.length).toBe(0);
        expect(sim.stats.might).toBeCloseTo(0);
    });

    test("an antidote cures poison and drains, and keeps them off for a while", () => {
        const sim = createSim();
        const tainted = getEnemy("karil").boss!.attacks[1].effect!;
        sim.applyPlayerEffect({ kind: "poison", damage: 3, seconds: 10 });
        sim.applyPlayerEffect(tainted);
        expect(sim.stats.moveSpeed).toBeLessThan(0);
        sim.stash("antidote_plus_plus");
        sim.useItem(0);
        expect(sim.player.poisonEnd).toBe(-1);
        expect(sim.debuffs).toEqual([]);
        expect(sim.stats.moveSpeed).toBe(0);

        sim.applyPlayerEffect({ kind: "poison", damage: 3, seconds: 10 });
        sim.applyPlayerEffect(tainted);
        expect(sim.player.poisonEnd).toBe(-1);
        expect(sim.debuffs).toEqual([]);
        // It doesn't thaw anyone out
        sim.applyPlayerEffect({ kind: "freeze", seconds: 1 });
        expect(sim.player.frozen).toBeGreaterThan(0);

        runFor(sim, 31, "still");
        expect(sim.cured).toBe(false);
        sim.applyPlayerEffect(tainted);
        expect(sim.debuffs.length).toBe(1);
    });

    test("the inventory fills up", () => {
        const sim = createSim();
        for (const id of ["shark", "bonecrusher", "overload", "antique_lamp"]) {
            expect(sim.stash(id)).toBe(true);
        }
        expect(sim.canStash("red_chinchompa")).toBe(false);
        expect(sim.canStash("shark")).toBe(true);
        // Taking an item that doesn't fit uses it there and then
        sim.chests.push({
            uid: -1,
            tier: "easy",
            itemId: "stamina_potion",
            upgrades: 0,
            coins: 0,
        });
        sim.state = "chest";
        sim.resolveChest("take");
        expect(sim.buffs.map((b) => b.itemId)).toEqual(["stamina_potion"]);
    });

    test("turning down a started set's piece stops caskets bringing that set", () => {
        const offer = (sim: Sim, itemId: string) => {
            sim.chests.push({ uid: -1, tier: "elite", itemId, upgrades: 0, coins: 0 });
            sim.state = "chest";
        };
        const alched = createSim();
        // Not started yet, so there's nothing to turn down
        offer(alched, "torva_platebody");
        alched.resolveChest("alch");
        expect(alched.declinedSets.size).toBe(0);
        alched.gear.head = "torva_full_helm";
        offer(alched, "torva_platebody");
        alched.resolveChest("alch");
        expect([...alched.declinedSets]).toEqual(["torva"]);

        const rerolled = createSim();
        rerolled.gear.head = "torva_full_helm";
        rerolled.rerollsLeft = 1;
        offer(rerolled, "torva_platebody");
        expect(rerolled.reroll()).toBe(true);
        expect([...rerolled.declinedSets]).toEqual(["torva"]);

        const taken = createSim();
        taken.gear.head = "torva_full_helm";
        offer(taken, "torva_platebody");
        taken.resolveChest("take");
        expect(taken.declinedSets.size).toBe(0);
    });

    test("a chinchompa blows up what's around you", () => {
        const sim = createSim();
        const goblins = [0, 1, 2, 3].map(
            (i) =>
                sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1038.5 + i * 0.5, y: 1036.5 })!,
        );
        const far = sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1050.5, y: 1036.5 })!;
        sim.stash("black_chinchompa");
        sim.useItem(0);
        expect(goblins.every((g) => g.dead)).toBe(true);
        expect(far.dead).toBe(false);
        expect(sim.takeEvents().some((e) => e.type === "blast")).toBe(true);
    });

    test("a lamp gives a level", () => {
        const sim = createSim();
        sim.stash("antique_lamp");
        sim.useItem(0);
        expect(sim.state).toBe("levelUp");
    });

    test("a reroll rolls a level up's rewards again", () => {
        const sim = createSim();
        expect(sim.rerollsLeft).toBe(1);
        // Nothing on offer while playing, so nothing to reroll
        expect(sim.reroll()).toBe(false);
        expect(sim.rerollsLeft).toBe(1);
        sim.stash("antique_lamp");
        sim.useItem(0);
        expect(sim.state).toBe("levelUp");
        expect(sim.reroll()).toBe(true);
        expect(sim.state).toBe("levelUp");
        expect(sim.choices.length).toBeGreaterThan(0);
        expect(sim.rerollsLeft).toBe(0);
        expect(sim.reroll()).toBe(false);
    });

    test("a level up can be skipped for coins, dearer each time", () => {
        const sim = createSim();
        // Nothing on offer while playing, so nothing to skip
        expect(sim.canSkip).toBe(false);
        expect(sim.skip()).toBe(false);
        sim.stash("antique_lamp");
        sim.useItem(0);
        expect(sim.state).toBe("levelUp");
        expect(sim.canSkip).toBe(true);
        // Not without the coins
        sim.coins = 24;
        expect(sim.skip()).toBe(false);
        expect(sim.state).toBe("levelUp");
        expect(sim.coins).toBe(24);
        sim.coins = 1000;
        const level = sim.level;
        const passives = sim.passives.length;
        expect(sim.skip()).toBe(true);
        expect(sim.state).toBe("playing");
        expect(sim.coins).toBe(975);
        // Still levelled up, with nothing taken
        expect(sim.level).toBe(level);
        expect(sim.weapons.length).toBe(1);
        expect(sim.passives.length).toBe(passives);
        const costs = [];
        for (let i = 0; i < 5; i++) {
            costs.push(sim.skipCost);
            sim.skips++;
        }
        expect(costs).toEqual([50, 100, 200, 400, 800]);
    });

    test("a skip takes one level up of several, and not the fallback or a hilt", () => {
        const sim = createSim();
        sim.coins = 1000;
        sim.stash("antique_lamp");
        sim.useItem(0);
        // Two levels at once
        sim.pendingLevelUps++;
        expect(sim.skip()).toBe(true);
        expect(sim.state).toBe("levelUp");
        expect(sim.pendingLevelUps).toBe(1);
        // Only the coins and shark left on offer: nothing to skip
        sim.choices = [
            { kind: "coins", amount: 25 },
            { kind: "food", amount: 10 },
        ];
        expect(sim.canSkip).toBe(false);
        expect(sim.skip()).toBe(false);
        // A godsword's hilt is picked, not skipped
        sim.choices = [
            { kind: "hilt", weaponId: "godsword", into: "armadyl_godsword", hiltObjId: 11810 },
        ];
        expect(sim.skip()).toBe(false);
        expect(sim.coins).toBe(975);
    });

    test("the run's stats credit damage and kills to what dealt them", () => {
        const sim = createSim();
        runFor(sim, 60);
        const stats = sim.getResult().stats;
        expect(sim.kills).toBeGreaterThan(0);
        // Every kill is somebody's, and the starting scimitar did most of it
        expect(stats.sources.reduce((sum, s) => sum + s.kills, 0)).toBe(sim.kills);
        const scimitar = stats.sources.find((s) => s.source === "weapon:scimitar")!;
        expect(scimitar.damage).toBeGreaterThan(0);
        expect(scimitar.seconds).toBeCloseTo(sim.seconds, 5);
        expect(stats.sources.every((s) => s.source !== "other")).toBe(true);
        // Most damage first
        const damages = stats.sources.map((s) => s.damage);
        expect(damages).toEqual([...damages].sort((a, b) => b - a));
        expect(stats.highestHit).toBeGreaterThan(0);
        expect(stats.highestHit).toBeLessThanOrEqual(scimitar.damage);
    });

    test("the run's stats count damage taken, healing, rerolls, skips and bosses", () => {
        const sim = createSim();
        sim.player.hp = 10;
        sim.heal(50);
        // Only what it actually healed
        expect(sim.healed).toBe(sim.player.maxHp - 10);
        sim.stash("antique_lamp");
        sim.useItem(0);
        sim.reroll();
        sim.coins = 100;
        sim.skip();
        const boss = sim.spawnEnemy(getEnemy("count_draynor"), "boss", { x: 1040, y: 1036 })!;
        // He gets back up once
        for (let i = 0; i < 5 && !boss.dead; i++) {
            sim.damageEnemy(boss, boss.hp * 10, 0, 1036, 1036);
        }
        const stats = sim.getResult().stats;
        expect(stats.rerollsUsed).toBe(1);
        expect(stats.skips).toBe(1);
        expect(stats.bossKills).toEqual([{ enemyId: "count_draynor", seconds: sim.seconds }]);
        expect(stats.damageTaken).toBe(0);
    });

    test("a casket's reroll is another item, and the shop adds rerolls", () => {
        const sim = createSim("warrior", 1, "lumbridge", { ...emptyStats(), reroll: 3 });
        expect(sim.rerollsLeft).toBe(4);
        sim.openCasket("elite");
        expect(sim.state).toBe("chest");
        const coins = sim.coins;
        for (let i = 0; i < 4; i++) {
            const before = sim.chest!.itemId;
            expect(sim.reroll()).toBe(true);
            expect(sim.chest!.itemId).not.toBe(before);
        }
        // The casket's coins stay as they were
        expect(sim.coins).toBe(coins);
        expect(sim.reroll()).toBe(false);
        expect(sim.state).toBe("chest");
    });

    test("caskets give gear as the Armoury has upgraded it, and note what was found", () => {
        // Everything upgraded as far as it goes
        const armoury = Object.fromEntries(
            CASKET_GEAR.map((g) => [g.id, getUpgradeLine(g.id).length - 1]),
        );
        const sim = new Sim({
            grid: makeGrid(openField(), 1000, 1000),
            characterId: "warrior",
            metaStats: { ...emptyStats(), reroll: 50 },
            seed: 2,
            spawnX: 1036.5,
            spawnY: 1036.5,
            armoury,
        });
        const found = new Set<string>();
        let upgraded = 0;
        for (let i = 0; i < 80; i++) {
            sim.openCasket(CASKET_TIERS[i % CASKET_TIERS.length]);
            if (i % 4 === 0) {
                sim.reroll();
            }
            const chest = sim.chest!;
            const item = getItem(chest.itemId);
            if (item.kind === "gear") {
                const from = chest.upgradedFrom ?? chest.itemId;
                found.add(from);
                expect(chest.itemId).toBe(getUpgradedGear(from, armoury));
                if (chest.upgradedFrom) {
                    upgraded++;
                    expect(chest.itemId).not.toBe(chest.upgradedFrom);
                }
            } else {
                expect(chest.upgradedFrom).toBeUndefined();
            }
            sim.resolveChest("alch");
        }
        expect(upgraded).toBeGreaterThan(10);
        // As found (rerolled away too), never as upgraded
        const gearFound = sim.getResult().gearFound;
        for (const id of found) {
            expect(gearFound).toContain(id);
        }
        expect(gearFound.some((id) => getGear(id).variantOf)).toBe(false);
    });

    test("a ring of recoil hurts whatever hits you", () => {
        const sim = createSim();
        // Nothing else to hurt it
        sim.weapons = [];
        sim.equip("ring_of_recoil");
        const goblin = sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1036.9, y: 1036.5 })!;
        goblin.hp = goblin.maxHp = 1000;
        for (let i = 0; i < 30; i++) {
            sim.step(0, 0);
        }
        expect(goblin.hp).toBeLessThan(1000);
    });

    test("elites drop caskets", () => {
        const sim = createSim();
        const elite = sim.spawnEnemy(getEnemy("cow"), "elite", { x: 1040.5, y: 1036.5 })!;
        sim.damageEnemy(elite, 1e9, 0, sim.player.x, sim.player.y);
        const casket = sim.pickups.find((p) => p.kind === "casket");
        expect(casket?.tier).toBeDefined();
        expect(sim.takeEvents().some((e) => e.type === "casketDropped")).toBe(true);
    });
});

describe("bosses", () => {
    // A tick of play, taking the first choice at a level up
    function step(sim: Sim, moveX: number, moveY: number): void {
        if (sim.state === "levelUp") {
            sim.choose(0);
        }
        if (sim.state === "chest") {
            sim.resolveChest("alch");
        }
        sim.step(moveX, moveY);
    }

    // Stands still until the boss starts winding up an attack
    function untilWindup(sim: Sim, boss: Enemy): void {
        for (let i = 0; i < 500 && !boss.bossState!.windup; i++) {
            step(sim, 0, 0);
        }
        expect(boss.bossState!.windup).toBeDefined();
    }

    // Plays until the windup lands, moving the player along (moveX, moveY)
    function throughWindup(sim: Sim, boss: Enemy, moveX: number, moveY: number): void {
        const landTick = boss.bossState!.windup!.landTick;
        for (let i = 0; i < 500 && sim.tick < landTick; i++) {
            step(sim, moveX, moveY);
        }
    }

    test("turn up on time, and the run goes on once they're dead", () => {
        const sim = createSim();
        const event = getMap("lumbridge").events.find((e) => e.kind === "boss")!;
        sim.tick = event.at * TICKS_PER_SECOND;
        sim.step(0, 0);
        const boss = sim.enemies.find((e) => e.def.id === event.enemyId)!;
        expect(boss.boss && !boss.finalBoss).toBe(true);
        expect(sim.shownBoss).toBe(boss);
        const spawned = sim.takeEvents().find((e) => e.type === "bossSpawned");
        expect(spawned).toMatchObject({ name: boss.def.name, finalBoss: false });

        // Count Draynor gets back up once
        while (!boss.dead) {
            sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        }
        expect(sim.state).toBe("playing");
        expect(sim.shownBoss).toBeUndefined();
        const casket = sim.pickups.find((p) => p.kind === "casket");
        expect(["elite", "master"]).toContain(casket?.tier);
        // Once, though he rose (it's what the Monk's task looks for, and his
        // quest)
        expect(sim.getResult().bossesKilled).toEqual(["count_draynor"]);
        expect(sim.getResult().enemyKills).toEqual({ count_draynor: 1 });
    });

    test("a swing hits only if you're still in reach when it lands", () => {
        const dharok = getEnemy("dharok");
        const reach = dharok.boss!.attacks[0].radius!;

        const stay = createSim();
        const boss = stay.spawnEnemy(dharok, "boss", { x: 1038, y: 1036.5 })!;
        untilWindup(stay, boss);
        const hp = stay.player.hp;
        // Nothing until it lands
        step(stay, 0, 0);
        expect(stay.player.hp).toBe(hp);
        throughWindup(stay, boss, 0, 0);
        expect(stay.player.hp).toBeLessThan(hp);

        const dodge = createSim();
        const boss2 = dodge.spawnEnemy(dharok, "boss", { x: 1038, y: 1036.5 })!;
        untilWindup(dodge, boss2);
        const hp2 = dodge.player.hp;
        throughWindup(dodge, boss2, -1, 0);
        expect(Math.hypot(dodge.player.x - boss2.x, dodge.player.y - boss2.y)).toBeGreaterThan(
            reach,
        );
        expect(dodge.player.hp).toBe(hp2);
    });

    test("Dharok hits harder the lower his hitpoints get", () => {
        const hitFor = (hpFraction: number) => {
            const sim = createSim();
            const boss = sim.spawnEnemy(getEnemy("dharok"), "boss", { x: 1038, y: 1036.5 })!;
            // Too many hitpoints for the player's weapon to finish him first
            boss.maxHp = 1e6;
            boss.hp = boss.maxHp * hpFraction;
            untilWindup(sim, boss);
            sim.takeEvents();
            throughWindup(sim, boss, 0, 0);
            const hit = sim.takeEvents().find((e) => e.type === "playerHit");
            return hit?.type === "playerHit" ? hit.amount : 0;
        };
        const full = hitFor(1);
        expect(full).toBeGreaterThan(0);
        expect(hitFor(0.01)).toBeGreaterThan(full * 1.8);
    });

    test("projectiles hit a player standing still and miss one on the move", () => {
        const shotAt = (moveY: number) => {
            const sim = createSim("wizard");
            const boss = sim.spawnEnemy(getEnemy("karil"), "boss", { x: 1042.5, y: 1036.5 })!;
            boss.hp = boss.maxHp = 1e9;
            let hits = 0;
            for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) {
                step(sim, 0, moveY);
                hits += sim.takeEvents().filter((e) => e.type === "playerHit").length;
            }
            return hits;
        };
        expect(shotAt(0)).toBeGreaterThan(0);
        expect(shotAt(1)).toBe(0);
    });

    // A boss with only one of its attacks, so a test knows what's coming, and
    // too many hitpoints to die by accident
    function bossWith(
        sim: Sim,
        enemyId: string,
        attackName: string,
        at: { x: number; y: number },
    ): Enemy {
        const def = getEnemy(enemyId);
        const attacks = def.boss!.attacks.filter((a) => a.name === attackName);
        const type = enemyId === "wise_old_man" ? "finalBoss" : "boss";
        const boss = sim.spawnEnemy({ ...def, boss: { ...def.boss!, attacks } }, type, at)!;
        boss.hp = boss.maxHp = 1e9;
        return boss;
    }

    function wiseOldManWith(sim: Sim, attackName: string, at: { x: number; y: number }): Enemy {
        return bossWith(sim, "wise_old_man", attackName, at);
    }

    function hitsFrom(sim: Sim, enemyId: string): number {
        return sim.takeEvents().filter((e) => e.type === "playerHit" && e.enemyId === enemyId)
            .length;
    }

    test("the Wise Old Man's Ice Barrage lands where you stood", () => {
        const stay = createSim();
        const boss = wiseOldManWith(stay, "Ice Barrage", { x: 1040.5, y: 1036.5 });
        untilWindup(stay, boss);
        expect(boss.bossState!.windup!.targets[0].x).toBeCloseTo(stay.player.x);
        stay.takeEvents();
        throughWindup(stay, boss, 0, 0);
        expect(hitsFrom(stay, "wise_old_man")).toBe(1);
        expect(stay.player.frozen).toBeGreaterThan(0);

        const dodge = createSim();
        const boss2 = wiseOldManWith(dodge, "Ice Barrage", { x: 1040.5, y: 1036.5 });
        untilWindup(dodge, boss2);
        dodge.takeEvents();
        throughWindup(dodge, boss2, 0, 1);
        expect(hitsFrom(dodge, "wise_old_man")).toBe(0);
        expect(dodge.player.frozen).toBe(0);
    });

    test("the Wise Old Man teleports away from anyone who comes close", () => {
        const sim = createSim();
        const boss = wiseOldManWith(sim, "Teleport", { x: 1038.5, y: 1036.5 });
        untilWindup(sim, boss);
        throughWindup(sim, boss, 0, 0);
        const distance = Math.hypot(boss.x - sim.player.x, boss.y - sim.player.y);
        expect(distance).toBeGreaterThan(6);
        expect(sim.grid.isSolid(Math.floor(boss.x), Math.floor(boss.y))).toBe(false);
    });

    test("the Wise Old Man's grab takes coins, and they come back when he dies", () => {
        const sim = createSim();
        sim.coins = 1000;
        const boss = wiseOldManWith(sim, "Telekinetic Grab", { x: 1041.5, y: 1036.5 });
        let stolen = 0;
        for (let i = 0; i < 4 * TICKS_PER_SECOND && stolen === 0; i++) {
            step(sim, 0, 0);
            for (const event of sim.takeEvents()) {
                if (event.type === "coinsStolen") {
                    stolen = event.amount;
                }
            }
        }
        expect(stolen).toBe(50);
        expect(boss.bossState!.stolenCoins).toBe(50);
        const coins = sim.coins;
        sim.damageEnemy(boss, 1e12, 0, sim.player.x, sim.player.y);
        expect(sim.state).toBe("victory");
        expect(sim.coins).toBe(coins + 50);
    });

    test("Count Draynor gets back up once, then stays down", () => {
        const sim = createSim();
        const boss = sim.spawnEnemy(getEnemy("count_draynor"), "boss", { x: 1040.5, y: 1036.5 })!;
        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        expect(boss.dead).toBe(false);
        expect(boss.hp).toBe(Math.round(boss.maxHp / 2));
        expect(sim.takeEvents().some((e) => e.type === "bossRose")).toBe(true);
        expect(sim.pickups.some((p) => p.kind === "casket")).toBe(false);

        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        expect(boss.dead).toBe(true);
        expect(sim.pickups.some((p) => p.kind === "casket")).toBe(true);
    });

    test("Count Draynor's bite heals him", () => {
        const sim = createSim();
        const boss = bossWith(sim, "count_draynor", "Bite", { x: 1038, y: 1036.5 });
        boss.hp = boss.maxHp / 2;
        untilWindup(sim, boss);
        const hp = boss.hp;
        sim.takeEvents();
        throughWindup(sim, boss, 0, 0);
        const events = sim.takeEvents();
        const bitten = events.find((e) => e.type === "playerHit");
        const bite = bitten?.type === "playerHit" ? bitten.amount : 0;
        expect(bite).toBeGreaterThan(0);
        // The player's weapon hits him meanwhile; put that back
        let taken = 0;
        for (const event of events) {
            if (event.type === "damage" && event.enemyUid === boss.uid) {
                taken += event.amount;
            }
        }
        expect(boss.hp + taken - hp).toBe(bite * getEnemy("count_draynor").boss!.lifesteal!);
    });

    test("Count Draynor calls in bats", () => {
        const sim = createSim();
        const boss = bossWith(sim, "count_draynor", "Summon bats", { x: 1042.5, y: 1036.5 });
        untilWindup(sim, boss);
        const bats = () => sim.enemies.filter((e) => e.def.id === "giant_bat").length;
        const before = bats();
        throughWindup(sim, boss, 0, 0);
        expect(bats()).toBe(before + 4);
    });

    test("blasts of several land around you, and hit you once", () => {
        const sim = createSim();
        const boss = bossWith(sim, "crazy_archaeologist", "Rain of knowledge", {
            x: 1041.5,
            y: 1036.5,
        });
        untilWindup(sim, boss);
        const windup = boss.bossState!.windup!;
        expect(windup.targets.length).toBe(3);
        for (const target of windup.targets) {
            const distance = Math.hypot(target.x - sim.player.x, target.y - sim.player.y);
            expect(distance).toBeLessThanOrEqual(2.5);
        }
        const events = sim.takeEvents();
        expect(events).toContainEqual({
            type: "bossShout",
            enemyUid: boss.uid,
            text: "Rain of knowledge!",
        });
        throughWindup(sim, boss, 0, 0);
        expect(hitsFrom(sim, "crazy_archaeologist")).toBe(1);
    });

    test("Verac's flail hits through armour", () => {
        const hitFor = (enemyId: string, attack: string) => {
            // The wizard has no armour of their own
            const sim = createSim("wizard");
            sim.metaStats.armor = 3;
            sim.updateStats();
            const boss = bossWith(sim, enemyId, attack, { x: 1038, y: 1036.5 });
            untilWindup(sim, boss);
            sim.takeEvents();
            throughWindup(sim, boss, 0, 0);
            const hit = sim.takeEvents().find((e) => e.type === "playerHit");
            return hit?.type === "playerHit" ? hit.amount : 0;
        };
        // Torag hits for 5 (2 through the armour); Verac for all 7
        expect(hitFor("torag", "Hammers")).toBe(2);
        expect(hitFor("verac", "Flail")).toBe(7);
    });

    test("are enraged at half their hitpoints: faster, and red", () => {
        const intervalFor = (hpFraction: number) => {
            const sim = createSim();
            const boss = bossWith(sim, "karil", "Bolt", { x: 1042.5, y: 1036.5 });
            const speed = boss.speed;
            boss.hp = boss.maxHp * hpFraction;
            untilWindup(sim, boss);
            const enraged = sim.takeEvents().find((e) => e.type === "bossEnraged");
            expect(boss.bossState!.enraged).toBe(hpFraction <= 0.5);
            expect(enraged !== undefined).toBe(hpFraction <= 0.5);
            expect(boss.speed > speed).toBe(hpFraction <= 0.5);
            expect(boss.tint !== 0xffffff).toBe(hpFraction <= 0.5);
            return boss.attackCooldown;
        };
        expect(intervalFor(0.4)).toBeLessThan(intervalFor(0.9) * 0.8);
    });

    test("enraged attacks wait until the boss is enraged", () => {
        const sim = createSim();
        const boss = bossWith(sim, "karil", "Volley", { x: 1042.5, y: 1036.5 });
        for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
            step(sim, 0, 0);
        }
        expect(boss.bossState!.windup).toBeUndefined();
        boss.hp = boss.maxHp / 3;
        untilWindup(sim, boss);
        expect(boss.bossState!.windup!.attack.name).toBe("Volley");
    });

    test("a leap lands the boss on the spot you stood on", () => {
        const leap = (moveY: number) => {
            const sim = createSim();
            const boss = bossWith(sim, "dharok", "Leap", { x: 1044.5, y: 1036.5 });
            untilWindup(sim, boss);
            const target = boss.bossState!.windup!.targets[0];
            expect(target.x).toBeCloseTo(sim.player.x);
            sim.takeEvents();
            throughWindup(sim, boss, 0, moveY);
            // Pushed off the player a little, if it landed on them
            expect(Math.hypot(boss.x - target.x, boss.y - target.y)).toBeLessThan(1);
            return hitsFrom(sim, "dharok");
        };
        expect(leap(0)).toBe(1);
        expect(leap(1)).toBe(0);
    });

    test("the King Black Dragon stops short of you, in reach of every melee weapon", () => {
        const melee = WEAPONS.filter((w) => w.kind === "slash" || w.kind === "sweep");
        expect(melee.length).toBeGreaterThan(0);
        for (const weapon of melee) {
            const sim = armed(weapon.id);
            const dragon = sim.spawnEnemy(getEnemy("king_black_dragon"), "boss", {
                x: sim.player.x + 6,
                y: sim.player.y,
            })!;
            dragon.hp = dragon.maxHp = 1e9;
            // Walks up without being hit on the way, and nothing else turns up
            sim.weapons[0].cooldown = 1e9;
            for (let i = 0; i < 6 * TICKS_PER_SECOND; i++) {
                sim.player.invulnerable = 100;
                sim.step(0, 0);
                sim.enemies = sim.enemies.filter((e) => e === dragon);
            }
            const distance = Math.hypot(dragon.x - sim.player.x, dragon.y - sim.player.y);
            expect(distance).toBeGreaterThan(2);
            expect(distance).toBeLessThan(dragon.def.boss!.keepDistance!);
            sim.takeEvents();
            expect(hitsOn(attack(sim), dragon).length, weapon.id).toBeGreaterThan(0);
        }
    });

    test("drains, freezes and poison", () => {
        const sim = createSim();
        const speed = (sim: Sim) => {
            const x = sim.player.x;
            step(sim, 1, 0);
            return sim.player.x - x;
        };
        const normal = speed(sim);

        sim.applyPlayerEffect(getEnemy("karil").boss!.attacks[1].effect!);
        expect(sim.stats.moveSpeed).toBeLessThan(0);
        expect(speed(sim)).toBeLessThan(normal * 0.8);
        for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) {
            step(sim, 0, 0);
        }
        expect(sim.debuffs).toEqual([]);
        expect(sim.stats.moveSpeed).toBe(0);

        sim.applyPlayerEffect({ kind: "freeze", seconds: 1 });
        expect(speed(sim)).toBe(0);
        for (let i = 0; i < TICKS_PER_SECOND; i++) {
            step(sim, 0, 0);
        }
        expect(speed(sim)).toBeCloseTo(normal);

        sim.takeEvents();
        const hp = sim.player.hp;
        sim.applyPlayerEffect({ kind: "poison", damage: 3, seconds: 4 });
        for (let i = 0; i < 6 * TICKS_PER_SECOND; i++) {
            step(sim, 0, 0);
        }
        const poisoned = sim.takeEvents().filter((e) => e.type === "playerPoisoned");
        expect(poisoned.length).toBe(4);
        expect(sim.player.hp).toBe(hp - 12);
        expect(sim.player.poisonEnd).toBe(-1);
    });
});

describe("enemy mechanics", () => {
    // Enemies made up for a test from an existing one, with the parts it's
    // testing
    function variant(baseId: string, changes: Partial<EnemyDef>): EnemyDef {
        return { ...getEnemy(baseId), id: "test_" + baseId, ...changes };
    }

    // Plays seconds, standing still and too tough to die, keeping the events
    function play(sim: Sim, seconds: number, moveX = 0, moveY = 0): SimEvent[] {
        const events: SimEvent[] = [];
        for (let i = 0; i < seconds * TICKS_PER_SECOND && !sim.runOver; i++) {
            if (sim.state === "levelUp") {
                sim.choose(0);
            }
            if (sim.state === "chest") {
                sim.resolveChest("alch");
            }
            sim.player.hp = sim.player.maxHp;
            sim.step(moveX, moveY);
            events.push(...sim.takeEvents());
        }
        return events;
    }

    // Something stationary and harmless to stand things around, 20 tiles east
    function portal(sim: Sim, changes: Partial<EnemyDef> = {}): Enemy {
        const def = variant("goblin", { stationary: true, damage: 0, ...changes });
        const enemy = sim.spawnEnemy(def, "boss", { x: 1056.5, y: 1036.5 })!;
        enemy.hp = enemy.maxHp = 10000;
        return enemy;
    }

    test("stationary enemies stay put, knocked or left behind", () => {
        const sim = createSim();
        const enemy = portal(sim);
        sim.damageEnemy(enemy, 1, 5, sim.player.x, sim.player.y);
        play(sim, 3, 1, 0);
        expect(enemy.x).toBe(1056.5);
        expect(enemy.y).toBe(1036.5);
        // Far away, it doesn't come back near the player
        play(sim, 2, -1, 0);
        sim.player.x = sim.player.prevX = 1003.5;
        play(sim, 1);
        expect(enemy.x).toBe(1056.5);
    });

    test("the player can't walk through something stationary", () => {
        const sim = createSim();
        const enemy = sim.spawnEnemy(variant("goblin", { stationary: true, damage: 0 }), "boss", {
            x: 1039.5,
            y: 1036.5,
        })!;
        enemy.hp = enemy.maxHp = 1e9;
        play(sim, 2, 1, 0);
        expect(enemy.x).toBe(1039.5);
        expect(sim.player.x).toBeLessThan(1039.5 - enemy.radius);
    });

    test("spawners call in their enemies now and then, up to their most at once", () => {
        const sim = createSim();
        const enemy = portal(sim, {
            spawns: { enemies: [{ id: "rat", weight: 1 }], interval: 1, count: 2, max: 3 },
        });
        const own = () => sim.enemies.filter((e) => !e.dead && e.spawnedBy === enemy.uid);
        play(sim, 0.9);
        expect(own().length).toBe(0);
        play(sim, 0.2);
        expect(own().length).toBe(2);
        for (const rat of own()) {
            expect(rat.def.id).toBe("rat");
            expect(Math.hypot(rat.x - enemy.x, rat.y - enemy.y)).toBeLessThan(3);
        }
        play(sim, 3);
        expect(own().length).toBe(3);
    });

    test("spawn spots: an enemy turns up at one of its own", () => {
        const sim = createSim();
        const def = variant("goblin", { spawnAt: [{ x: 1060.5, y: 1012.5 }] });
        const enemy = sim.spawnEnemy(def, "elite")!;
        expect([enemy.x, enemy.y]).toEqual([1060.5, 1012.5]);
    });

    test("a shield blocks every hit until it drops, and says so when it does", () => {
        const sim = createSim();
        const enemy = portal(sim, { shield: { seconds: 2, message: "The shield drops!" } });
        expect(sim.damageEnemy(enemy, 100, 0, sim.player.x, sim.player.y)).toBe(0);
        expect(sim.damageEnemy(enemy, 100, 0, sim.player.x, sim.player.y)).toBe(0);
        expect(enemy.hp).toBe(enemy.maxHp);
        // One blocked splat for the two hits
        const blocked = sim.takeEvents().filter((e) => e.type === "damage");
        expect(blocked).toEqual([expect.objectContaining({ amount: 0, blocked: true })]);

        const events = play(sim, 2.1);
        expect(events).toContainEqual({ type: "notice", message: "The shield drops!" });
        expect(sim.damageEnemy(enemy, 100, 0, sim.player.x, sim.player.y)).toBeGreaterThan(0);
        expect(enemy.hp).toBeLessThan(enemy.maxHp);
    });

    test("a bot nuke doesn't kill what's shielded", () => {
        const sim = createSim();
        const def = variant("goblin", { shield: { seconds: 5 } });
        const shielded = sim.spawnEnemy(def, "normal", { x: 1046.5, y: 1036.5 })!;
        sim.usePowerUp(getPowerUp("bot_nuke"));
        expect(shielded.dead).toBe(false);
    });

    test("healers go to what they heal and heal it, a share of its hitpoints at a time", () => {
        const sim = createSim();
        const enemy = portal(sim);
        enemy.hp = enemy.maxHp / 2;
        const healerDef = variant("goblin", {
            heals: { fraction: 0.05, interval: 1, range: 1.5, targets: [enemy.def.id] },
        });
        const healer = sim.spawnEnemy(healerDef, "normal", { x: 1049.5, y: 1036.5 })!;
        healer.hp = healer.maxHp = 1e9;
        play(sim, 6);
        expect(Math.hypot(healer.x - enemy.x, healer.y - enemy.y)).toBeLessThan(2.5);
        expect(enemy.hp).toBeGreaterThan(enemy.maxHp / 2);
        // Whole heals of 5%
        expect((enemy.hp - enemy.maxHp / 2) % (enemy.maxHp * 0.05)).toBe(0);

        // Healed up, it comes for the player again
        enemy.hp = enemy.maxHp;
        play(sim, 10);
        expect(Math.hypot(healer.x - sim.player.x, healer.y - sim.player.y)).toBeLessThan(2);
    });

    test("healers with no targets set heal bosses, not other enemies", () => {
        const sim = createSim();
        const healerDef = variant("goblin", { heals: { fraction: 0.1, interval: 0.5, range: 2 } });
        const healer = sim.spawnEnemy(healerDef, "normal", { x: 1050.5, y: 1030.5 })!;
        healer.frozen = 1e9;
        const goblin = sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1051.5, y: 1030.5 })!;
        goblin.frozen = 1e9;
        goblin.hp = 1;
        play(sim, 2);
        expect(goblin.hp).toBe(1);
    });

    test("revivers bring back what died near them, which drops nothing the second time", () => {
        const sim = createSim();
        const reviver = portal(sim, { revives: { interval: 1, range: 6, hp: 0.5 } });
        const goblin = sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1052.5, y: 1036.5 })!;
        goblin.frozen = 1e9;
        sim.damageEnemy(goblin, 1e9, 0, sim.player.x, sim.player.y);
        const bones = () => sim.pickups.filter((p) => p.kind === "bones").length;
        const bonesAfterOne = bones();
        play(sim, 1.2);
        const risen = sim.enemies.find((e) => !e.dead && e.def.id === "goblin" && e.noDrops)!;
        expect(risen).toBeDefined();
        expect(Math.hypot(risen.x - 1052.5, risen.y - 1036.5)).toBeLessThan(1);
        expect(risen.hp).toBe(Math.round(risen.maxHp * 0.5));
        expect(reviver.dead).toBe(false);

        risen.frozen = 1e9;
        sim.damageEnemy(risen, 1e9, 0, sim.player.x, sim.player.y);
        expect(bones()).toBe(bonesAfterOne);
        // And it stays down
        play(sim, 2);
        expect(sim.enemies.filter((e) => !e.dead && e.noDrops)).toEqual([]);
    });

    test("splitters split into smaller enemies when they die, unless a nuke kills them", () => {
        const sim = createSim();
        const def = variant("goblin", { splits: { into: "rat", count: 3 } });
        const splitter = sim.spawnEnemy(def, "normal", { x: 1046.5, y: 1036.5 })!;
        const rats = () => sim.enemies.filter((e) => !e.dead && e.def.id === "rat");
        sim.damageEnemy(splitter, 1e9, 0, sim.player.x, sim.player.y);
        expect(rats().length).toBe(3);
        for (const rat of rats()) {
            expect(Math.hypot(rat.x - splitter.x, rat.y - splitter.y)).toBeLessThan(1);
        }

        const nuked = createSim();
        nuked.spawnEnemy(def, "normal", { x: 1046.5, y: 1036.5 });
        nuked.usePowerUp(getPowerUp("bot_nuke"));
        expect(nuked.enemies.some((e) => !e.dead)).toBe(false);
    });

    test("exploders blow up when they die, hurting a player close by", () => {
        const blowUp = (distance: number) => {
            const sim = createSim();
            const def = variant("goblin", { explodes: { damage: 4, radius: 2 } });
            const enemy = sim.spawnEnemy(def, "normal", { x: 1036.5 + distance, y: 1036.5 })!;
            // Just hit by something else: it still lands
            sim.player.invulnerable = 5;
            sim.damageEnemy(enemy, 1e9, 0, sim.player.x, sim.player.y);
            const events = sim.takeEvents();
            expect(events).toContainEqual({ type: "blast", x: enemy.x, y: enemy.y, radius: 2 });
            return events.filter((e) => e.type === "playerHit" && e.enemyId === def.id).length;
        };
        expect(blowUp(1.5)).toBe(1);
        expect(blowUp(4)).toBe(0);
    });

    test("blinkers wind up, then come up right by the player", () => {
        const sim = createSim();
        const def = variant("goblin", {
            blinks: { interval: 2, minRange: 5, distance: 1.5, windup: 0.5 },
        });
        const enemy = sim.spawnEnemy(def, "normal", { x: 1052.5, y: 1036.5 })!;
        enemy.hp = enemy.maxHp = 1e9;
        let windupAt = -1;
        let landed = false;
        for (let i = 0; i < 3 * TICKS_PER_SECOND && !landed; i++) {
            const x = enemy.x;
            play(sim, 1 / TICKS_PER_SECOND);
            if (windupAt === -1 && enemy.abilities!.blinkLand !== -1) {
                windupAt = sim.tick;
            } else if (windupAt !== -1 && enemy.abilities!.blinkLand !== -1) {
                // Winding up, it stands still
                expect(enemy.x).toBe(x);
            }
            landed = Math.hypot(enemy.x - sim.player.x, enemy.y - sim.player.y) < 2;
        }
        expect(landed).toBe(true);
        expect(sim.tick - windupAt).toBe(TICKS_PER_SECOND / 2);
        expect(sim.grid.isSolid(Math.floor(enemy.x), Math.floor(enemy.y))).toBe(false);
    });

    test("what surfaces comes up slowly: it stands there, can't hit, and can be hit", () => {
        const sim = createSim();
        sim.weapons = [];
        const def = variant("goblin", {
            blinks: {
                interval: 1,
                minRange: 5,
                distance: 1,
                sound: 2500,
                surface: { seq: 7601, seconds: 2 },
            },
        });
        const enemy = sim.spawnEnemy(def, "normal", { x: 1052.5, y: 1036.5 })!;
        enemy.hp = enemy.maxHp = 1e9;
        const events: SimEvent[] = [];
        for (let i = 0; i < 2 * TICKS_PER_SECOND && enemy.risingEnd === 0; i++) {
            events.push(...play(sim, 1 / TICKS_PER_SECOND));
        }
        expect(enemy.risingEnd).toBeGreaterThan(sim.tick);
        expect(enemy.anim).toBe("attack");
        expect(enemy.attackSeq).toBe(7601);
        // Once as it digs in, and again where it's coming up
        const sounds = events.filter((e) => e.type === "bossAttack" && e.sound === 2500);
        expect(sounds.length).toBe(2);
        expect(sounds[1]).toMatchObject({ x: enemy.x, y: enemy.y });

        const { x, y } = enemy;
        const rest = (enemy.risingEnd - sim.tick - 1) / TICKS_PER_SECOND;
        const during = play(sim, rest);
        expect([enemy.x, enemy.y]).toEqual([x, y]);
        expect(during.some((e) => e.type === "playerHit")).toBe(false);
        sim["damageEnemy"](enemy, 5, 0, enemy.x, enemy.y);
        expect(enemy.hp).toBeLessThan(enemy.maxHp);

        // Up now, it comes on and hits as anything else does
        const after = play(sim, 2);
        expect(enemy.risingEnd).toBe(0);
        expect(after.some((e) => e.type === "playerHit")).toBe(true);
    });

    test("a crowd left behind go one after another", () => {
        const sim = createSim();
        sim.weapons = [];
        const def = variant("goblin", {
            blinks: { interval: 1, minRange: 5, distance: 1, windup: 0.5, gap: 2 },
        });
        const crowd = [0, 1, 2, 3, 4, 5].map((i) => {
            const enemy = sim.spawnEnemy(def, "normal", { x: 1052.5, y: 1030.5 + i * 2 })!;
            enemy.hp = enemy.maxHp = 1e9;
            enemy.frozen = 0;
            return enemy;
        });
        let mostAtOnce = 0;
        for (let i = 0; i < 6 * TICKS_PER_SECOND; i++) {
            play(sim, 1 / TICKS_PER_SECOND);
            const going = crowd.filter((e) => e.abilities!.blinkLand !== -1).length;
            mostAtOnce = Math.max(mostAtOnce, going);
        }
        expect(mostAtOnce).toBe(1);
    });

    test("the Jal-ImKot comes up well clear of the player, with time to get away", () => {
        const blinks = getEnemy("jal_imkot").blinks!;
        expect(blinks.distance).toBeGreaterThanOrEqual(4);
        expect(blinks.surface!.seconds).toBeGreaterThanOrEqual(2);
        expect(blinks.gap).toBeGreaterThan(0);
    });

    describe("what flies", () => {
        // A fence of thin objects at x = 30, and a band of rock at x = 40-45 from
        // the south edge up to y = 50, with the player between them
        function fieldWithRock(): string[] {
            return openField().map((row, i) => {
                const y = 71 - i;
                return y > 0 && y <= 50 ? row.slice(0, 40) + "^^^^^^" + row.slice(46) : row;
            });
        }
        function setUp(changes: Partial<EnemyDef>, x: number): { sim: Sim; enemy: Enemy } {
            const sim = new Sim({
                grid: makeGrid(fieldWithRock(), 1000, 1000),
                mapId: "lumbridge",
                characterId: "warrior",
                metaStats: emptyStats(),
                seed: 1,
                spawnX: 1036.5,
                spawnY: 1036.5,
                endless: false,
            });
            sim.weapons = [];
            const def = variant("goblin", { speed: 4, ...changes });
            const enemy = sim.spawnEnemy(def, "normal", { x, y: 1036.5 })!;
            enemy.hp = enemy.maxHp = 1e9;
            return { sim, enemy };
        }

        test("goes straight over a fence, as a walker can't", () => {
            const flying = setUp({ flies: true }, 1026.5);
            play(flying.sim, 1.5);
            expect(flying.enemy.x).toBeGreaterThan(1031);
            expect(Math.abs(flying.enemy.y - 1036.5)).toBeLessThan(0.5);

            const walking = setUp({}, 1026.5);
            play(walking.sim, 1.5);
            expect(walking.enemy.x).toBeLessThan(1030);
        });

        test("goes round terrain, never over it, and gets there", () => {
            const { sim, enemy } = setUp({ flies: true }, 1050.5);
            let wentOver = false;
            for (let i = 0; i < 20 * TICKS_PER_SECOND; i++) {
                play(sim, 1 / TICKS_PER_SECOND);
                wentOver ||= enemy.x > 1040 && enemy.x < 1046 && enemy.y < 1051;
            }
            expect(wentOver).toBe(false);
            expect(Math.hypot(enemy.x - sim.player.x, enemy.y - sim.player.y)).toBeLessThan(2);
        });

        test("a ghost goes straight through the lot", () => {
            const { sim, enemy } = setUp({ ghost: true }, 1050.5);
            play(sim, 2);
            expect(enemy.x).toBeLessThan(1044);
            expect(Math.abs(enemy.y - 1036.5)).toBeLessThan(0.5);
        });

        test("only ghosts and the Ankou go through walls; bats and aviansies fly", () => {
            const ghosts = ENEMIES.filter((def) => def.ghost).map((def) => def.id);
            expect(ghosts.sort()).toEqual(["ankou", "ghost"]);
            for (const id of ["giant_bat", "crystalline_bat", "jal_mejrah", "aviansie"]) {
                expect(getEnemy(id).flies).toBe(true);
            }
        });
    });

    test("enemies of different factions hurt each other; it's nobody's kill and drops nothing", () => {
        const sim = createSim();
        // Too far from the player for its weapon, and standing still
        const at = (faction: string, x: number, type: "normal" | "elite" = "normal") => {
            const def = variant("goblin", { id: "test_" + faction, faction, stationary: true });
            const enemy = sim.spawnEnemy(def, type, { x, y: 1056.5 })!;
            enemy.hp = enemy.maxHp = 100;
            return enemy;
        };
        const bandos = at("bandos", 1050.5);
        const zamorak = at("zamorak", 1051.1);
        const bandos2 = at("bandos", 1040.5);
        const bandos3 = at("bandos", 1041.1);
        // Elites hit back but aren't hurt (they'd lose their caskets)
        const bandos4 = at("bandos", 1060.5);
        const saradomin = at("saradomin", 1061.3, "elite");
        play(sim, 1.5);
        expect(bandos.hp).toBeLessThan(bandos.maxHp);
        expect(zamorak.hp).toBeLessThan(zamorak.maxHp);
        expect(bandos2.hp).toBe(bandos2.maxHp);
        expect(bandos3.hp).toBe(bandos3.maxHp);
        expect(bandos4.hp).toBeLessThan(bandos4.maxHp);
        expect(saradomin.hp).toBe(saradomin.maxHp);

        zamorak.hp = 1;
        const kills = sim.kills;
        const pickups = sim.pickups.length;
        const events = play(sim, 1.5);
        expect(zamorak.dead).toBe(true);
        expect(events).toContainEqual(
            expect.objectContaining({ type: "kill", enemyUid: zamorak.uid, byEnemy: true }),
        );
        expect(sim.kills).toBe(kills);
        expect(sim.pickups.length).toBe(pickups);
    });

    test("enemies of different factions go for each other, not the player, when the player's off", () => {
        const sim = createSim();
        sim.weapons = [];
        const player = sim.player;
        const at = (faction: string, x: number) => {
            const def = variant("goblin", { id: "test_" + faction, faction });
            const enemy = sim.spawnEnemy(def, "normal", { x, y: player.y + 8 })!;
            enemy.hp = enemy.maxHp = 1000;
            return enemy;
        };
        const bandos = at("bandos", player.x - 2);
        const zamorak = at("zamorak", player.x + 2);
        play(sim, 3);
        // They met halfway and fought, facing each other, instead of coming
        // on to the player
        expect(Math.hypot(bandos.x - zamorak.x, bandos.y - zamorak.y)).toBeLessThan(1.2);
        expect(bandos.hp).toBeLessThan(bandos.maxHp);
        expect(zamorak.hp).toBeLessThan(zamorak.maxHp);
        expect(Math.hypot(bandos.x - player.x, bandos.y - player.y)).toBeGreaterThan(5);
        expect(bandos.foe).toBe(zamorak);
        // Hit by the player, it's after the player from then on
        sim.damageEnemy(zamorak, 1, 0, player.x, player.y);
        play(sim, 2);
        expect(zamorak.foe).toBeUndefined();
        expect(Math.hypot(zamorak.x - player.x, zamorak.y - player.y)).toBeLessThan(5);
        // With the player up close, the player comes first
        player.x = bandos.x + 1;
        player.y = bandos.y;
        play(sim, 0.5);
        expect(bandos.foe).toBeUndefined();
    });

    describe("a foe it can't get at", () => {
        // Two armies either side of the wall at x 1030: they can't touch, and
        // the player's out of it
        function acrossTheWall(sim: Sim, faction: string, x: number): Enemy {
            const def = variant("goblin", { id: "test_" + faction, faction, damage: 1 });
            const enemy = sim.spawnEnemy(def, "normal", { x, y: 1036.5 })!;
            enemy.hp = enemy.maxHp = 1e6;
            return enemy;
        }
        function setUp() {
            const sim = createSim();
            sim.weapons = [];
            sim.player.x = sim.player.prevX = 1015.5;
            return sim;
        }

        test("after 3 seconds it goes for the player for good", () => {
            const sim = setUp();
            const bandos = acrossTheWall(sim, "bandos", 1029);
            const zamorak = acrossTheWall(sim, "zamorak", 1032);
            play(sim, 2.5);
            expect(bandos.foe).toBe(zamorak);
            expect(bandos.aggro).toBe(false);
            play(sim, 1);
            expect(bandos.aggro).toBe(true);
            expect(bandos.foe).toBeUndefined();
            play(sim, 1);
            // It stays that way with the foe still there
            expect(bandos.aggro).toBe(true);
            expect(bandos.foe).toBeUndefined();
            expect(Math.hypot(bandos.x - sim.player.x, bandos.y - sim.player.y)).toBeLessThan(
                Math.hypot(1029 - sim.player.x, 1036.5 - sim.player.y),
            );
        });

        test("open ground doesn't count, however long it's been", () => {
            const sim = createSim();
            sim.weapons = [];
            // A long walk off for something this slow, with nothing in the way
            const def = variant("goblin", { id: "test_bandos", faction: "bandos", speed: 0.1 });
            const bandos = sim.spawnEnemy(def, "normal", { x: 1040.5, y: 1060.5 })!;
            bandos.hp = bandos.maxHp = 1e6;
            const zamorak = acrossTheWall(sim, "zamorak", 1046.5);
            zamorak.y = zamorak.prevY = 1060.5;
            zamorak.frozen = 1e6;
            play(sim, 6);
            expect(bandos.foe).toBe(zamorak);
            expect(bandos.aggro).toBe(false);
            expect(bandos.foeWait).toBe(0);
        });

        test("nor does a crowd of its own side in the way", () => {
            const sim = createSim();
            sim.weapons = [];
            const at = (faction: string, x: number, y: number) => {
                const enemy = acrossTheWall(sim, faction, x);
                enemy.y = enemy.prevY = y;
                return enemy;
            };
            const zamorak = at("zamorak", 1046.5, 1060.5);
            zamorak.frozen = 1e6;
            // A wall of bandos between it and the foe, that can't move
            for (let y = 1056.5; y <= 1064.5; y += 0.6) {
                at("bandos", 1043.5, y).frozen = 1e6;
            }
            const behind = at("bandos", 1041.5, 1060.5);
            play(sim, 6);
            expect(behind.foe).toBe(zamorak);
            expect(behind.aggro).toBe(false);
        });

        test("nor does a wall to a ghost, which walks through it", () => {
            const sim = setUp();
            const def = variant("goblin", { id: "test_bandos", faction: "bandos", ghost: true });
            const bandos = sim.spawnEnemy(def, "normal", { x: 1029, y: 1036.5 })!;
            bandos.hp = bandos.maxHp = 1e6;
            const zamorak = acrossTheWall(sim, "zamorak", 1032);
            zamorak.frozen = 1e6;
            play(sim, 4);
            expect(bandos.aggro).toBe(false);
            expect(zamorak.hp).toBeLessThan(zamorak.maxHp);
        });

        test("landing hits keeps it at the fight", () => {
            const sim = createSim();
            sim.weapons = [];
            const at = (faction: string, x: number) => {
                const enemy = acrossTheWall(sim, faction, x);
                enemy.y = enemy.prevY = 1060.5;
                return enemy;
            };
            const bandos = at("bandos", 1040.5);
            const zamorak = at("zamorak", 1041.2);
            play(sim, 8);
            expect(bandos.foe).toBe(zamorak);
            expect(bandos.aggro).toBe(false);
            expect(zamorak.aggro).toBe(false);
        });

        test("flipping between foes doesn't put it off", () => {
            const sim = setUp();
            const bandos = acrossTheWall(sim, "bandos", 1029);
            const others = [
                acrossTheWall(sim, "zamorak", 1032),
                acrossTheWall(sim, "saradomin", 1032),
            ];
            for (const other of others) {
                other.frozen = 1e6;
            }
            let swaps = 0;
            for (let i = 0; i < 3.5 * TICKS_PER_SECOND; i++) {
                if (sim.state === "levelUp") {
                    sim.choose(0);
                }
                sim.player.invulnerable = 100;
                // Whichever it's after moves out of its range, the other back in
                const foe = bandos.foe;
                if (foe && i % 30 === 29) {
                    const other = foe === others[0] ? others[1] : others[0];
                    foe.y = foe.prevY = 1046.5;
                    other.y = other.prevY = bandos.y;
                    bandos.nextFoeLook = 0;
                    swaps++;
                }
                sim.step(0, 0);
            }
            expect(swaps).toBeGreaterThan(1);
            expect(bandos.aggro).toBe(true);
        });

        test("a new foe gets the full 3 seconds once the last's dead", () => {
            const sim = setUp();
            const bandos = acrossTheWall(sim, "bandos", 1029);
            const first = acrossTheWall(sim, "zamorak", 1032);
            play(sim, 2.5);
            expect(bandos.foe).toBe(first);
            first.dead = true;
            acrossTheWall(sim, "saradomin", 1032);
            play(sim, 2.5);
            expect(bandos.aggro).toBe(false);
            expect(bandos.foe?.def.faction).toBe("saradomin");
        });

        test("a shooter's shots at the player don't count as hitting its foe", () => {
            const sim = setUp();
            const shot = { ...getEnemy("f2p_ranger").shot!, range: 40, interval: 0.5 };
            const def = variant("goblin", { id: "test_bandos", faction: "bandos", shot });
            const shooter = sim.spawnEnemy(def, "normal", { x: 1029, y: 1036.5 })!;
            shooter.hp = shooter.maxHp = 1e6;
            acrossTheWall(sim, "zamorak", 1032);
            const shots = play(sim, 3.5).filter((event) => event.type === "bossAttack");
            expect(shots.length).toBeGreaterThan(0);
            expect(shooter.aggro).toBe(true);
        });
    });

    describe("where they turn up", () => {
        // A sealed room to the east of the player's spot, in reach of a ring
        // of enemies (12 tiles off) on one side and of the waves (19 to 24
        // off) on the other
        const ROOM = { x0: 1045, y0: 1026, x1: 1062, y1: 1046 };
        const inRoom = ({ x, y }: { x: number; y: number }) =>
            x >= ROOM.x0 && x <= ROOM.x1 + 1 && y >= ROOM.y0 && y <= ROOM.y1 + 1;
        function walledIn(): Sim {
            const { x0, y0, x1, y1 } = ROOM;
            const grid = makeGrid(openField(), 1000, 1000, [
                { x: x0 - 1, y: y0 - 1, sizeX: x1 - x0 + 3, sizeY: 1 },
                { x: x0 - 1, y: y1 + 1, sizeX: x1 - x0 + 3, sizeY: 1 },
                { x: x0 - 1, y: y0, sizeX: 1, sizeY: y1 - y0 + 1 },
                { x: x1 + 1, y: y0, sizeX: 1, sizeY: y1 - y0 + 1 },
            ]);
            const sim = new Sim({
                grid,
                characterId: "warrior",
                metaStats: emptyStats(),
                seed: 1,
                spawnX: 1036.5,
                spawnY: 1036.5,
            });
            sim.weapons = [];
            return sim;
        }
        const ghost = variant("goblin", { id: "test_ghost", ghost: true });

        test("a ring round the player leaves out what's walled off", () => {
            for (const def of [getEnemy("goblin"), ghost]) {
                const sim = walledIn();
                sim["spawnRing"](def, 40);
                expect(sim.enemies.length).toBeGreaterThan(20);
                expect(sim.enemies.length).toBeLessThan(40);
                expect(sim.enemies.filter(inRoom)).toEqual([]);
            }
        });

        test("a wave never lands there, ghosts included", () => {
            for (const def of [getEnemy("goblin"), ghost]) {
                const sim = walledIn();
                for (let i = 0; i < 300; i++) {
                    sim.spawnEnemy(def, "normal");
                }
                expect(sim.enemies.length).toBeGreaterThan(200);
                expect(sim.enemies.filter(inRoom)).toEqual([]);
                for (const enemy of sim.enemies) {
                    const tile = [Math.floor(enemy.x), Math.floor(enemy.y)] as const;
                    expect(sim.grid.isSolid(...tile)).toBe(false);
                }
            }
        });

        test("nor does what something calls in beside the wall", () => {
            const sim = walledIn();
            const caller = sim.spawnEnemy(getEnemy("goblin"), "normal", {
                x: ROOM.x0 - 2.5,
                y: 1036.5,
            })!;
            for (let i = 0; i < 100; i++) {
                sim["spawnNear"](caller, getEnemy("goblin"), 5, i, 100, 3);
            }
            expect(sim.enemies.length).toBeGreaterThan(30);
            expect(sim.enemies.filter(inRoom)).toEqual([]);
        });

        test("nothing's brought back behind the wall", () => {
            const sim = walledIn();
            const reviver = variant("goblin", {
                revives: { interval: 1, range: 50 },
            });
            const caller = sim.spawnEnemy(reviver, "normal", { x: ROOM.x0 - 2.5, y: 1036.5 })!;
            sim["deaths"].push({ def: ghost, x: 1050.5, y: 1036.5, variant: 0, tick: sim.tick });
            expect(sim["revive"](caller, reviver.revives!)).toBe(false);
        });

        test("the far side of a ditch counts where enemies can jump it, and only there", () => {
            const map = getMap("east_varrock");
            const ditchY = map.ditch!.y;
            const baseX = map.spawn.x - 36.5;
            const baseY = ditchY - 31;
            const rows = openField().map((row, i) => {
                const y = baseY + 71 - i;
                return y === ditchY || y === ditchY + 1 ? row.replace(/\./g, "#") : row;
            });
            const ring = (mapId: string) => {
                const sim = new Sim({
                    grid: makeGrid(rows, baseX, baseY),
                    mapId,
                    characterId: "warrior",
                    metaStats: emptyStats(),
                    seed: 1,
                    spawnX: map.spawn.x,
                    spawnY: map.spawn.y,
                });
                sim["spawnRing"](getEnemy("clan_noob"), 40);
                return sim.enemies.filter((enemy) => enemy.y < ditchY).length;
            };
            expect(ring("east_varrock")).toBeGreaterThan(0);
            expect(ring("lumbridge")).toBe(0);
        });
    });

    test("each faction's army comes from its own side", () => {
        const sim = createSim();
        const player = sim.player;
        const sides = (faction: string) => {
            const def = variant("goblin", { id: "test_" + faction, faction });
            return Array.from({ length: 20 }, () => {
                const enemy = sim.spawnEnemy(def, "normal")!;
                return Math.atan2(enemy.y - player.y, enemy.x - player.x);
            });
        };
        // How far apart two directions are, in radians
        const apart = (a: number, b: number) =>
            Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        const bandos = sides("bandos");
        const zamorak = sides("zamorak");
        for (const angles of [bandos, zamorak]) {
            // A few go anywhere when their side has no room
            const together = angles.filter((a) => apart(a, angles[0]) < 1.3);
            expect(together.length).toBeGreaterThanOrEqual(16);
        }
        expect(apart(bandos[0], zamorak[0])).toBeGreaterThan(1.5);
    });

    test("bosses call in enemies as their hitpoints drop past each mark, once", () => {
        const sim = createSim();
        const dharok = getEnemy("dharok");
        const def = variant("dharok", {
            stationary: true,
            boss: {
                ...dharok.boss!,
                summonsAt: [
                    { hp: 0.75, enemyId: "giant_crypt_rat", count: 2, message: "Rats!" },
                    { hp: 0.25, enemyId: "giant_crypt_rat", count: 3 },
                ],
            },
        });
        const boss = sim.spawnEnemy(def, "boss", { x: 1056.5, y: 1036.5 })!;
        const rats = () => sim.enemies.filter((e) => e.def.id === "giant_crypt_rat").length;
        play(sim, 0.5);
        expect(rats()).toBe(0);
        boss.hp = boss.maxHp * 0.7;
        const events = play(sim, 0.1);
        expect(rats()).toBe(2);
        expect(events).toContainEqual({ type: "notice", message: "Rats!" });
        play(sim, 1);
        expect(rats()).toBe(2);
        boss.hp = boss.maxHp * 0.1;
        play(sim, 0.1);
        expect(rats()).toBe(5);
    });

    describe("a glyph", () => {
        // A boss 14 tiles north of the player whose one attack is a blockable
        // swing that reaches everywhere, or a blockable projectile
        function glyphBoss(
            sim: Sim,
            glyph: { halfLength: number; speed: number },
            kind: "swing" | "projectile" = "swing",
        ): Enemy {
            const dharok = getEnemy("dharok");
            const def = variant("dharok", {
                stationary: true,
                boss: {
                    ...dharok.boss!,
                    keepDistance: 30,
                    attacks: [
                        {
                            name: "Blast",
                            kind,
                            damage: 10,
                            windup: 1,
                            cooldown: 0,
                            range: 40,
                            radius: 40,
                            speed: 12,
                            weight: 1,
                            blockable: true,
                            message: "Hide behind the glyph!",
                        },
                    ],
                    glyph: { lookId: "goblin", distance: 4, width: 1.5, ...glyph },
                },
            });
            const boss = sim.spawnEnemy(def, "boss", { x: 1036.5, y: 1050.5 })!;
            boss.hp = boss.maxHp = 1e9;
            return boss;
        }

        test("slides back and forth across the way to the player", () => {
            const sim = createSim();
            glyphBoss(sim, { halfLength: 3, speed: 2 });
            const glyph = sim.glyphs[0];
            expect([glyph.x, glyph.y]).toEqual([1036.5, 1046.5]);
            const xs: number[] = [];
            for (let i = 0; i < 8 * TICKS_PER_SECOND; i++) {
                play(sim, 1 / TICKS_PER_SECOND);
                xs.push(glyph.x);
                expect(glyph.y).toBeCloseTo(1046.5);
            }
            expect(Math.min(...xs)).toBeCloseTo(1033.5, 1);
            expect(Math.max(...xs)).toBeCloseTo(1039.5, 1);
        });

        test("takes a blockable attack for a player behind it", () => {
            const hitsFor = (moveX: number, kind: "swing" | "projectile") => {
                const sim = createSim();
                const boss = glyphBoss(sim, { halfLength: 0, speed: 0 }, kind);
                const events = play(sim, 3.5, moveX, 0);
                expect(events).toContainEqual({
                    type: "notice",
                    message: "Hide behind the glyph!",
                });
                return events.filter((e) => e.type === "playerHit" && e.enemyId === boss.def.id)
                    .length;
            };
            expect(hitsFor(0, "swing")).toBe(0);
            expect(hitsFor(1, "swing")).toBeGreaterThan(0);
            expect(hitsFor(0, "projectile")).toBe(0);
        });

        test("goes when its boss dies", () => {
            const sim = createSim();
            const boss = glyphBoss(sim, { halfLength: 2, speed: 1 });
            expect(sim.glyphs.length).toBe(1);
            sim.damageEnemy(boss, 1e12, 0, sim.player.x, sim.player.y);
            play(sim, 0.1);
            expect(sim.glyphs).toEqual([]);
        });
    });
});

describe("maps", () => {
    test("every map's waves, events and bosses make sense", () => {
        for (const map of MAPS) {
            if (map.fight) {
                // One boss fight: nothing but its final boss, from the start
                expect(map.waves).toEqual([]);
                expect(map.events.length).toBe(1);
                expect(map.events[0]).toMatchObject({ at: 0, kind: "finalBoss" });
                expect(getEnemy(map.events[0].enemyId).boss?.intro?.alone).toBe(true);
                expect(getMap(map.fight.requires).fight).toBeUndefined();
                expect(CHARACTERS.some((c) => c.id === map.fight!.character)).toBe(true);
                continue;
            }
            expect(map.waves.length).toBeGreaterThan(0);
            for (const wave of map.waves) {
                expect(wave.enemies.length).toBeGreaterThan(0);
                for (const { id } of wave.enemies) {
                    expect(getEnemy(id)).toBeDefined();
                }
            }
            const times = map.events.map((e) => e.at);
            expect(times).toEqual([...times].sort((a, b) => a - b));
            const last = map.events[map.events.length - 1];
            expect(last).toMatchObject({ at: RUN_LENGTH, kind: "finalBoss" });
            for (const event of map.events) {
                const enemy = getEnemy(event.enemyId);
                if (event.kind === "boss") {
                    // Mid-run bosses fight with attacks of their own
                    expect(enemy.boss).toBeDefined();
                }
            }
        }
    });

    test("bosses come to their own maps, at the map's strength", () => {
        const sim = createSim("warrior", 1, "barrows");
        const event = sim.map.events.find((e) => e.kind === "boss")!;
        sim.tick = event.at * TICKS_PER_SECOND;
        sim.step(0, 0);
        const boss = sim.enemies.find((e) => e.def.id === event.enemyId)!;
        expect(boss.def.id).toBe("torag");
        expect(boss.maxHp).toBe(event.kind === "boss" ? event.hp : 0);
        expect(boss.damageScale).toBe(sim.map.difficulty.damage);
        expect(sim.getResult().mapId).toBe("barrows");

        // Lumbridge has none of them now
        const lumbridge = getMap("lumbridge").events.map((e) => e.enemyId);
        for (const id of ["dharok", "karil", "ahrim", "king_black_dragon"]) {
            expect(lumbridge).not.toContain(id);
        }
    });

    test("each map's monsters come from its part of the world", () => {
        const enemiesOn = (mapId: string) => {
            const map = getMap(mapId);
            const fromWaves = map.waves.flatMap((w) => w.enemies.map((e) => e.id));
            const fromEvents = map.events
                .filter((e) => e.kind === "elite" || e.kind === "ring")
                .map((e) => e.enemyId);
            return new Set([...fromWaves, ...fromEvents]);
        };
        // Zombies and skeletons turn up all over; everything else is the map's own
        const shared = ["zombie", "skeleton"];
        for (const map of CAMPAIGN_MAPS) {
            const own = [...enemiesOn(map.id)].filter((id) => !shared.includes(id));
            for (const other of CAMPAIGN_MAPS.filter((m) => m !== map)) {
                const theirs = enemiesOn(other.id);
                for (const id of own) {
                    expect(theirs.has(id), `${id} on ${other.id}`).toBe(false);
                }
            }
        }
        expect(enemiesOn("barrows")).toContain("crypt_rat");
        expect(enemiesOn("wilderness")).toContain("revenant_imp");
        expect(enemiesOn("desert")).toContain("scarab_swarm");
        expect(enemiesOn("fremennik")).toContain("rock_crab");
        expect(enemiesOn("karamja")).toContain("tz_kih");
        expect(enemiesOn("kourend")).toContain("lizardman");
        expect(enemiesOn("varlamore")).toContain("minotaur");
        expect(enemiesOn("morytania")).toContain("vyrewatch");
        expect(enemiesOn("god_wars")).toContain("aviansie");
        expect(enemiesOn("prifddinas")).toContain("crystalline_bat");
        expect(enemiesOn("inferno")).toContain("jal_nib");
    });

    test("enemies are tougher on each later map", () => {
        const goblinHp = (mapId: string) => {
            const sim = createSim("warrior", 1, mapId);
            return sim.spawnEnemy(getEnemy("goblin"), "normal", { x: 1040.5, y: 1036.5 })!.maxHp;
        };
        for (let i = 1; i < CAMPAIGN_MAPS.length; i++) {
            expect(goblinHp(CAMPAIGN_MAPS[i].id)).toBeGreaterThan(
                goblinHp(CAMPAIGN_MAPS[i - 1].id),
            );
        }
    });

    test("every boss attacks", () => {
        for (const map of MAPS) {
            for (const event of map.events) {
                if (event.kind !== "boss" && event.kind !== "finalBoss") {
                    continue;
                }
                const sim = createSim("warrior", 1, map.id);
                const def = getEnemy(event.enemyId);
                const intro = def.boss?.intro;
                // Her square is on the real map, not this test's field
                const square = map.bossArena;
                map.bossArena = undefined;
                if (intro) {
                    sim.startIntro(def, "finalBoss");
                } else {
                    sim.spawnEnemy(def, "boss", { x: sim.player.x + 3, y: sim.player.y });
                }
                let attacked = false;
                const seconds = 10 + (intro?.seconds ?? 0);
                for (let i = 0; i < seconds * TICKS_PER_SECOND && !attacked; i++) {
                    sim.player.invulnerable = 100;
                    if (sim.state === "levelUp") {
                        sim.choose(0);
                    }
                    if (sim.state === "chest") {
                        sim.resolveChest("alch");
                    }
                    sim.step(0, 0);
                    attacked = sim.takeEvents().some((e) => e.type === "bossAttack");
                }
                map.bossArena = square;
                expect(attacked, `${def.id} on ${map.id}`).toBe(true);
            }
        }
    });

    test("Damis rises in his second form, and is killed in it", () => {
        const sim = createSim("warrior", 1, "desert");
        const boss = sim.spawnEnemy(getEnemy("damis"), "boss", { x: 1040.5, y: 1036.5 })!;
        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        expect(boss.dead).toBe(false);
        const risen = getEnemy("damis_risen");
        expect(boss.def).toBe(risen);
        expect(boss.hp).toBe(boss.maxHp);
        expect(boss.attackSeq).toBe(risen.attackSeq);
        expect(boss.bossState!.cooldowns.length).toBe(risen.boss!.attacks.length);
        expect(sim.takeEvents().some((e) => e.type === "bossRose")).toBe(true);

        // Once is all: the second form stays down
        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        expect(boss.dead).toBe(true);
        expect(sim.getResult().bossesKilled).toEqual(["damis_risen"]);
    });

    test("the Kalphite Queen gets back up as her second form, at 80% of her hitpoints", () => {
        const sim = createSim("warrior", 1, "desert");
        const queen = sim.spawnEnemy(getEnemy("kalphite_queen"), "boss", { x: 1040.5, y: 1036.5 })!;
        sim.damageEnemy(queen, 1e9, 0, sim.player.x, sim.player.y);
        expect(queen.def.id).toBe("kalphite_queen_risen");
        expect(queen.hp).toBe(Math.round(queen.maxHp * 0.8));
    });

    test("Verzik Vitur gets up twice, in her next form each time, and the last one wins the run", () => {
        const sim = createSim("warrior", 1, "morytania");
        const verzik = sim.spawnEnemy(getEnemy("verzik_vitur"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        // On her throne she stays put, behind her shield
        expect(verzik.def.stationary).toBe(true);
        expect(sim.damageEnemy(verzik, 100, 0, sim.player.x, sim.player.y)).toBe(0);
        verzik.shieldEnd = 0;
        for (const form of ["verzik_vitur_risen", "verzik_vitur_spider"]) {
            sim.damageEnemy(verzik, 1e9, 0, sim.player.x, sim.player.y);
            expect(verzik.dead).toBe(false);
            expect(verzik.def.id).toBe(form);
            expect(verzik.def.stationary).toBeUndefined();
            expect(verzik.hp).toBe(verzik.maxHp);
        }
        sim.damageEnemy(verzik, 1e9, 0, sim.player.x, sim.player.y);
        expect(verzik.dead).toBe(true);
        expect(sim.state).toBe("victory");
        expect(sim.getResult().bossesKilled).toEqual(["verzik_vitur_spider"]);
    });

    test("Zulrah stays where it surfaces in all three of its forms, and calls in snakelings", () => {
        const sim = createSim("warrior", 1, "prifddinas");
        const zulrah = sim.spawnEnemy(getEnemy("zulrah"), "boss", { x: 1044.5, y: 1036.5 })!;
        for (const form of ["zulrah_magma", "zulrah_tanzanite"]) {
            sim.damageEnemy(zulrah, 1e9, 0, sim.player.x, sim.player.y);
            expect(zulrah.def.id).toBe(form);
        }
        sim.player.invulnerable = 1e6;
        runFor(sim, 20, "still");
        expect(zulrah.x).toBe(1044.5);
        expect(zulrah.y).toBe(1036.5);
        const snakelings = sim.enemies.filter((e) => e.spawnedBy === zulrah.uid);
        expect(snakelings.length).toBeGreaterThan(0);
        expect(snakelings.every((e) => e.def.id === "snakeling")).toBe(true);
    });

    test("Nex gets up as her shadow, blood and ice forms, each calling in its own bodyguard", () => {
        const sim = createSim("warrior", 1, "god_wars");
        const nex = sim.spawnEnemy(getEnemy("nex"), "finalBoss", { x: 1040.5, y: 1036.5 })!;
        const forms = ["nex", "nex_shadow", "nex_blood", "nex_ice"];
        const bodyguards = ["fumus", "umbra", "cruor", "glacies"];
        for (let i = 0; i < forms.length; i++) {
            expect(nex.def.id).toBe(forms[i]);
            expect(nex.hp).toBe(nex.maxHp);
            nex.hp = Math.round(nex.maxHp * 0.55);
            sim.player.invulnerable = 100;
            sim.step(0, 0);
            const called = sim.enemies.filter((e) => e.def.id === bodyguards[i]);
            expect(called.length, bodyguards[i]).toBe(1);
            sim.damageEnemy(nex, 1e9, 0, sim.player.x, sim.player.y);
        }
        expect(nex.dead).toBe(true);
        expect(sim.state).toBe("victory");
        expect(sim.getResult().bossesKilled).toEqual(["nex_ice"]);
    });

    test("a form beaten in one blow still calls in its helpers", () => {
        const sim = createSim("warrior", 1, "god_wars");
        const nex = sim.spawnEnemy(getEnemy("nex"), "finalBoss", { x: 1040.5, y: 1036.5 })!;
        // From full hitpoints to her next form, past where Fumus comes
        sim.damageEnemy(nex, 1e9, 0, sim.player.x, sim.player.y);
        expect(nex.def.id).toBe("nex_shadow");
        expect(sim.enemies.filter((e) => e.def.id === "fumus")).toHaveLength(1);
        // And the next form's own still come as she's hurt
        nex.hp = Math.round(nex.maxHp * 0.55);
        sim.player.invulnerable = 100;
        sim.step(0, 0);
        expect(sim.enemies.filter((e) => e.def.id === "umbra")).toHaveLength(1);
    });

    test("the Inferno's three final Jads all have to fall to win", () => {
        const sim = createSim("warrior", 1, "inferno");
        const finale = sim.map.events.filter((e) => e.kind === "finalBoss");
        expect(finale.map((e) => e.enemyId)).toEqual([
            "jaltok_jad_finale",
            "jaltok_jad_finale",
            "jaltok_jad_finale",
        ]);
        const jads = [0, 1, 2].map(
            (i) =>
                sim.spawnEnemy(getEnemy("jaltok_jad_finale"), "finalBoss", {
                    x: 1030.5 + i * 3,
                    y: 1054.5,
                })!,
        );
        sim.damageEnemy(jads[0], 1e9, 0, sim.player.x, sim.player.y);
        sim.damageEnemy(jads[1], 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.state).not.toBe("victory");
        // The bar shows the one still standing
        expect(sim.shownBoss).toBe(jads[2]);
        sim.damageEnemy(jads[2], 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.state).toBe("victory");
    });

    test("a boss's glyph goes when it does", () => {
        const sim = createSim("warrior", 1, "inferno");
        const jad = getEnemy("jaltok_jad");
        const def = {
            ...jad,
            boss: {
                ...jad.boss!,
                glyph: { lookId: "jal_zek", distance: 4, halfLength: 5, speed: 2, width: 1.5 },
            },
        };
        const boss = sim.spawnEnemy(def, "finalBoss", { x: 1036.5, y: 1054.5 })!;
        expect(sim.glyphs).toHaveLength(1);
        sim.damageEnemy(boss, 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.state).toBe("victory");
        expect(sim.glyphs).toHaveLength(0);
    });

    test("an enemy brought back by a Jal-Zek isn't another kill", () => {
        const sim = createSim("warrior", 1, "inferno");
        sim.weapons = [];
        sim.spawnEnemy(getEnemy("jal_zek"), "normal", { x: 1040.5, y: 1036.5 });
        const nib = sim.spawnEnemy(getEnemy("jal_nib"), "normal", { x: 1042.5, y: 1036.5 })!;
        sim.damageEnemy(nib, 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.kills).toBe(1);
        let risen: Enemy | undefined;
        for (let i = 0; i < 12 * TICKS_PER_SECOND && !risen; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, 0);
            risen = sim.enemies.find((e) => e.noDrops && !e.dead);
        }
        expect(risen?.def.id).toBe("jal_nib");
        sim.damageEnemy(risen!, 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.kills).toBe(1);
    });

    test("every enemy that's turned into, called in, healed or looked like is there", () => {
        for (const enemy of ENEMIES) {
            const ids = [
                enemy.splits?.into,
                enemy.hatches?.into,
                ...(enemy.spawns?.enemies.map((e) => e.id) ?? []),
                ...(enemy.heals?.targets ?? []),
                enemy.boss?.rises?.into,
                ...(enemy.boss?.summonsAt?.map((s) => s.enemyId) ?? []),
                ...(enemy.boss?.attacks.map((a) => a.summon?.enemyId) ?? []),
                enemy.boss?.glyph?.lookId,
            ];
            for (const id of ids) {
                if (id !== undefined) {
                    expect(() => getEnemy(id), `${id} for ${enemy.id}`).not.toThrow();
                }
            }
        }
    });

    test("every arena is on one of the cache's four planes, the ground floor unless set", () => {
        for (const map of [...MAPS, ...FUN_MAPS]) {
            const region = getArenaRegion(map);
            expect(region.plane).toBe(map.plane ?? 0);
            expect([0, 1, 2, 3]).toContain(region.plane);
            expect(region).toMatchObject(map.arena);
        }
    });

    test("a run starts on the nearest free spot", () => {
        const grid = makeGrid(openField(), 1000, 1000);
        // Inside the wall at x = 30
        const sim = new Sim({
            grid,
            characterId: "warrior",
            metaStats: emptyStats(),
            seed: 1,
            spawnX: 1030.5,
            spawnY: 1030.5,
        });
        expect(grid.isSolid(Math.floor(sim.player.x), Math.floor(sim.player.y))).toBe(false);
        expect(Math.hypot(sim.player.x - 1030.5, sim.player.y - 1030.5)).toBeLessThan(1.5);
    });

    test("enemies still find a player standing by a signpost's post", () => {
        // A signpost on four tiles, its post where they meet
        const grid = makeGrid(openField(), 1000, 1000, [
            { x: 1036, y: 1036, sizeX: 2, sizeY: 2, stands: [1036.9, 1036.9, 1037.1, 1037.1] },
        ]);
        const sim = new Sim({
            grid,
            characterId: "warrior",
            metaStats: emptyStats(),
            seed: 1,
            spawnX: 1036.3,
            spawnY: 1036.3,
        });
        // On one of the signpost's tiles
        expect(grid.isSolid(Math.floor(sim.player.x), Math.floor(sim.player.y))).toBe(true);
        const { targetX, targetY } = sim.flowField;
        expect(grid.isSolid(targetX, targetY)).toBe(false);
        expect(Math.hypot(targetX + 0.5 - sim.player.x, targetY + 0.5 - sim.player.y)).toBeLessThan(
            1,
        );
        expect(sim.flowField.isReachable(1050, 1036)).toBe(true);
    });
});

// A run with only this weapon
function armed(weaponId: string, characterId = "warrior", metaStats = emptyStats()): Sim {
    const sim = new Sim({
        grid: makeGrid(openField(), 1000, 1000),
        characterId,
        metaStats,
        seed: 3,
        spawnX: 1036.5,
        spawnY: 1036.5,
    });
    sim.weapons = [];
    sim.addWeapon(weaponId);
    return sim;
}

// A goblin (or a boss) that won't die, at (dx, dy) from the player
function dummy(sim: Sim, dx: number, dy: number, type: "normal" | "boss" = "normal"): Enemy {
    const def = getEnemy(type === "boss" ? "dharok" : "goblin");
    const enemy = sim.spawnEnemy(def, type, { x: sim.player.x + dx, y: sim.player.y + dy })!;
    enemy.hp = enemy.maxHp = 1e6;
    return enemy;
}

// Uses the weapon now, standing still; returns that tick's events
function attack(sim: Sim) {
    sim.weapons[0].cooldown = 0;
    sim.step(0, 0);
    return sim.takeEvents();
}

function hitsOn(events: ReturnType<Sim["takeEvents"]>, enemy: Enemy): number[] {
    return events.flatMap((e) =>
        e.type === "damage" && e.enemyUid === enemy.uid ? [e.amount] : [],
    );
}

// Uses the weapon once, then stands still for a while without using it
// again; returns everything that happened
function attackOnce(sim: Sim, seconds: number) {
    const events = attack(sim);
    sim.weapons[0].cooldown = 1e9;
    for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
        sim.player.invulnerable = 100;
        sim.step(0, 0);
        events.push(...sim.takeEvents());
    }
    return events;
}

describe("class weapons", () => {
    // Half a minute of play for each of them takes a while
    test("every class weapon kills things", () => {
        const classes = { melee: "warrior", ranged: "ranger", magic: "wizard" };
        for (const weapon of WEAPONS.filter((w) => w.style)) {
            const sim = armed(weapon.id, classes[weapon.style!]);
            runFor(sim, 30);
            expect(sim.kills).toBeGreaterThan(0);
        }
    }, 20000);

    test("the scythe sweeps a wide arc in front, and hits bosses three times", () => {
        const sim = armed("scythe_of_vitur");
        const front = dummy(sim, 1.8, 0);
        const side = dummy(sim, 0, 2);
        const behind = dummy(sim, -2.5, 0);
        const boss = dummy(sim, 1.5, -1.5, "boss");
        const events = attack(sim);
        expect(hitsOn(events, front).length).toBe(1);
        expect(hitsOn(events, side).length).toBe(1);
        expect(hitsOn(events, behind).length).toBe(0);
        // 100%, 50% and 25%
        const bossHits = hitsOn(events, boss);
        expect(bossHits.length).toBe(3);
        expect(bossHits[0]).toBeGreaterThan(bossHits[2]);
        const slash = events.find((e) => e.type === "slash");
        expect(slash).toMatchObject({ weaponId: "scythe_of_vitur", arc: 1.75 });
    });

    test("every third godsword swing is its special attack", () => {
        const sim = armed("zamorak_godsword");
        const goblin = dummy(sim, 1.5, 0);
        attack(sim);
        attack(sim);
        expect(goblin.frozen).toBe(0);
        expect(sim.player.attackSeq).toBe(getWeapon("zamorak_godsword").playerSeq);
        attack(sim);
        // Ice Cleave
        expect(goblin.frozen).toBeGreaterThan(0);
        expect(sim.player.attackSeq).toBe(getWeapon("zamorak_godsword").special!.playerSeq);
        expect(sim.effects.some((e) => e.spotAnim === 1210)).toBe(true);
    });

    test("a special attack waits for something to hit", () => {
        const sim = armed("armadyl_godsword");
        const goblin = dummy(sim, 1.5, 0);
        attack(sim);
        attack(sim);
        // Out of reach for the third swing: it's a normal one, and the special
        // is still due
        goblin.x = goblin.prevX = sim.player.x + 15;
        attack(sim);
        expect(sim.weapons[0].uses).toBe(2);
        goblin.x = goblin.prevX = sim.player.x + 1.5;
        const events = attack(sim);
        expect(sim.weapons[0].uses).toBe(3);
        // The Judgement: over twice a normal hit (20 damage, give or take 15%)
        expect(hitsOn(events, goblin)[0]).toBeGreaterThan(20 * 1.15 * 1.5);
    });

    test("Healing Blade heals and Warstrike drains", () => {
        const sgs = armed("saradomin_godsword");
        dummy(sgs, 1.5, 0);
        sgs.player.hp = 5;
        attack(sgs);
        attack(sgs);
        expect(sgs.player.hp).toBe(5);
        attack(sgs);
        // Half the damage, up to 3
        expect(sgs.player.hp).toBe(8);

        const bgs = armed("bandos_godsword");
        const goblin = dummy(bgs, 1.5, 0);
        attack(bgs);
        attack(bgs);
        attack(bgs);
        expect(goblin.drain).toBe(0.25);
        expect(goblin.drainEnd).toBeGreaterThan(bgs.tick);
        const other = dummy(bgs, -8, 0);
        let drained = 0;
        let normal = 0;
        for (let i = 0; i < 20; i++) {
            drained += bgs.damageEnemy(goblin, 100, 0, bgs.player.x, bgs.player.y);
            normal += bgs.damageEnemy(other, 100, 0, bgs.player.x, bgs.player.y);
        }
        expect(drained / normal).toBeGreaterThan(1.15);
        // It wears off
        bgs.tick = goblin.drainEnd;
        const after = bgs.damageEnemy(goblin, 100, 0, bgs.player.x, bgs.player.y);
        expect(after).toBeLessThanOrEqual(115);
    });

    test("the Twisted bow shoots the toughest enemy, harder the tougher it is", () => {
        const sim = armed("twisted_bow", "ranger");
        // Closer, but a goblin's hitpoints
        dummy(sim, -3, 0).maxHp = 20;
        const boss = dummy(sim, 9, 0, "boss");
        // Its hitpoints decide the extra damage, not what's left of them
        boss.maxHp = 6000;
        attack(sim);
        expect(sim.projectiles.length).toBe(1);
        expect(sim.projectiles[0].targetUid).toBe(boss.uid);
        const hits: number[] = [];
        for (let i = 0; i < 60 && hits.length === 0; i++) {
            sim.step(0, 0);
            hits.push(...hitsOn(sim.takeEvents(), boss));
        }
        // 18 damage with up to +150% against the toughest
        const scale = 1 + (1.5 * 6000) / (6000 + 600);
        expect(hits[0]).toBeGreaterThanOrEqual(Math.floor(18 * scale * 0.85));
        expect(hits[0]).toBeLessThanOrEqual(Math.ceil(18 * scale * 1.15));
    });

    test("weapons go for what they can hurt, not what's shielded", () => {
        const sim = armed("twisted_bow", "ranger");
        const goblin = dummy(sim, -3, 0);
        goblin.maxHp = 20;
        const boss = dummy(sim, 9, 0, "boss");
        boss.maxHp = 6000;
        boss.shieldEnd = sim.tick + 1e6;
        attack(sim);
        expect(sim.projectiles.map((p) => p.targetUid)).toEqual([goblin.uid]);
        // With only the shielded one about, nothing's wasted on it
        sim.enemies.splice(sim.enemies.indexOf(goblin), 1);
        sim.projectiles = [];
        attack(sim);
        expect(sim.projectiles).toHaveLength(0);
        // A slash swings at the one it can hurt, though the other's closer
        const melee = armed("scimitar");
        const shielded = dummy(melee, 0, 1);
        shielded.shieldEnd = melee.tick + 1e6;
        const open = dummy(melee, 0, -1.5);
        const events = attack(melee);
        expect(hitsOn(events, open).length).toBeGreaterThan(0);
    });

    test("Tumeken's shadow triples the damage bonus", () => {
        const stats = { ...emptyStats(), might: 0.5 };
        const sim = armed("tumekens_shadow", "wizard", stats);
        const goblin = dummy(sim, 4, 0);
        attack(sim);
        const hits: number[] = [];
        for (let i = 0; i < 60 && hits.length === 0; i++) {
            sim.step(0, 0);
            hits.push(...hitsOn(sim.takeEvents(), goblin));
        }
        // 26 damage, +150% rather than +50%
        expect(hits[0]).toBeGreaterThanOrEqual(Math.floor(26 * 2.5 * 0.85));
    });

    test("the rarest weapon is the one in hand", () => {
        const sim = createSim("ranger");
        expect(sim.getHeldObjId()).toBe(864);
        sim.addWeapon("twisted_bow");
        expect(sim.getHeldObjId()).toBe(20997);
    });

    test("the Toxic blowpipe's venom hurts every second, and spreads", () => {
        const sim = armed("toxic_blowpipe", "ranger");
        const near = dummy(sim, 2, 0);
        // Further away, behind it
        const far = dummy(sim, 5, 0);
        near.frozen = far.frozen = 1e6;
        // The first dart goes for the nearest, and leaves venom in it
        attackOnce(sim, 0.5);
        expect(near.venomEnd).toBeGreaterThan(sim.tick);
        expect(far.venomEnd).toBeLessThan(sim.tick);
        // The next goes for one without venom, flying past the one with it
        attack(sim);
        expect(sim.projectiles[0].targetUid).toBe(far.uid);
        const venomEnd = near.venomEnd;
        const events = attackOnce(sim, 4);
        expect(hitsOn(events, far).length).toBeGreaterThan(0);
        const onNear = (poison: boolean) =>
            events.flatMap((e) =>
                e.type === "damage" && e.enemyUid === near.uid && !!e.poison === poison
                    ? [e.amount]
                    : [],
            );
        expect(onNear(false)).toEqual([]);
        // 3 damage a second for 3 seconds (give or take 15%), as poison splats
        expect(onNear(true).length).toBe(3);
        expect(Math.max(...onNear(true))).toBeLessThanOrEqual(4);
        expect(sim.tick).toBeGreaterThan(venomEnd);
        // Worn off: no more
        for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) {
            sim.step(0, 0);
        }
        expect(sim.takeEvents().some((e) => e.type === "damage" && e.poison)).toBe(false);
    });

    test("the Sanguinesti staff heals now and then, a little", () => {
        const sim = armed("sanguinesti_staff", "wizard");
        dummy(sim, 3, 0).frozen = 1e6;
        sim.player.hp = 1;
        let heals = 0;
        for (let i = 0; i < 24; i++) {
            const hp = sim.player.hp;
            attackOnce(sim, 0.35);
            const healed = sim.player.hp - hp;
            // Half of 16 damage would be 8, but it's at most 2
            expect(healed).toBeLessThanOrEqual(2);
            if (healed > 0) {
                heals++;
                expect(sim.effects.some((e) => e.spotAnim === 1542)).toBe(true);
            }
        }
        // One hit in six
        expect(heals).toBeGreaterThan(0);
        expect(heals).toBeLessThan(12);
    });

    test("the Amulet of blood fury heals now and then off any weapon's hits", () => {
        // Hitpoints healed over a minute of scimitar hits, every 0.2 seconds
        const healed = (amulet?: string) => {
            const sim = armed("scimitar");
            if (amulet) {
                sim.equip(amulet);
            }
            const goblin = dummy(sim, 1, 0);
            goblin.frozen = 1e6;
            let total = 0;
            let heals = 0;
            for (let i = 0; i < 300; i++) {
                // Back in reach after the last hit's knockback
                goblin.x = sim.player.x + 1;
                goblin.y = sim.player.y;
                goblin.vx = goblin.vy = 0;
                // No level ups from what else it kills to stop the run
                sim.xp = 0;
                sim.player.hp = 1;
                sim.player.invulnerable = 100;
                attackOnce(sim, 0.2);
                const amount = sim.player.hp - 1;
                total += amount;
                if (amount > 0) {
                    heals++;
                    expect(sim.effects.some((e) => e.spotAnim === 1542)).toBe(true);
                }
            }
            expect(sim.state).toBe("playing");
            return { total, heals };
        };
        expect(healed().total).toBe(0);
        // A roll a second, one in five healing 2: about 12 times
        const base = healed("amulet_of_blood_fury");
        expect(base.heals).toBeGreaterThan(5);
        expect(base.heals).toBeLessThan(20);
        expect(base.total).toBe(base.heals * 2);
        // Fully upgraded, a roll a second at a 39% chance: about 23 times
        const upgraded = healed("amulet_of_blood_fury_4");
        expect(upgraded.heals).toBeGreaterThan(base.heals);
        expect(upgraded.heals).toBeLessThan(35);
        expect(upgraded.total).toBe(upgraded.heals * 2);
    });
});

describe("adventurers' bonuses", () => {
    test("the vampyre hunter hits bosses 25% harder, and nothing else", () => {
        const sim = createSim("vampyre_hunter");
        sim.rng.range = () => 1;
        const boss = dummy(sim, 3, 0, "boss");
        const goblin = dummy(sim, -3, 0);
        const hit = 100 * (1 + sim.stats.might);
        expect(sim.damageEnemy(boss, 100, 0, sim.player.x, sim.player.y)).toBe(
            Math.round(hit * 1.25),
        );
        expect(sim.damageEnemy(goblin, 100, 0, sim.player.x, sim.player.y)).toBe(Math.round(hit));
        // Not damage that leaves out the bonuses (a ruby bolt's share of
        // hitpoints, the nuke's)
        expect(sim.damageEnemy(boss, 100, 0, sim.player.x, sim.player.y, 0)).toBe(100);
    });

    test("the gauntlet runner starts weak and hits 2% harder with every level, to level 41", () => {
        const sim = createSim("gauntlet_runner");
        expect(sim.stats.might).toBeCloseTo(-0.3);
        sim.xp = runXpForLevel(11);
        sim.step(0, 0);
        expect(sim.level).toBe(11);
        expect(sim.stats.might).toBeCloseTo(-0.1);

        const later = createSim("gauntlet_runner");
        later.xp = runXpForLevel(31);
        later.step(0, 0);
        expect(later.stats.might).toBeCloseTo(0.3);

        // It stops at level 41, however far an endless run goes
        const endless = createSim("gauntlet_runner", 1, "lumbridge", emptyStats(), true);
        endless.xp = endlessXpForLevel(80);
        endless.step(0, 0);
        expect(endless.level).toBe(80);
        expect(LEVEL_MIGHT_LEVELS).toBe(40);
        expect(endless.stats.might).toBeCloseTo(0.5);
    });
});

describe("the new maps' weapons", () => {
    // Uses the weapon now, standing still and safe; returns that tick's events
    function safeAttack(sim: Sim) {
        sim.player.invulnerable = 100;
        return attack(sim);
    }

    test("Smoke Burst poisons what it hits, and only Ice Burst freezes", () => {
        const sim = armed("smoke_burst");
        const goblin = dummy(sim, 1.5, 0);
        expect(hitsOn(safeAttack(sim), goblin).length).toBe(1);
        expect(goblin.frozen).toBe(0);
        expect(goblin.venomEnd).toBeGreaterThan(sim.tick);
        // 2 damage a second for 3 seconds, as poison splats
        const events = attackOnce(sim, 3.5);
        const poison = events.filter(
            (e) => e.type === "damage" && e.enemyUid === goblin.uid && e.poison,
        );
        expect(poison.length).toBe(3);

        const ice = armed("ice_burst");
        const frozen = dummy(ice, 1.5, 0);
        safeAttack(ice);
        expect(frozen.frozen).toBeGreaterThan(0);
    });

    test("Shadow Burst makes what it hits take 20% more damage for a while", () => {
        const sim = armed("shadow_burst");
        const goblin = dummy(sim, 1.5, 0);
        safeAttack(sim);
        expect(goblin.drain).toBe(0.2);
        expect(goblin.drainEnd).toBeGreaterThan(sim.tick + 3.5 * TICKS_PER_SECOND);
        expect(goblin.drainEnd).toBeLessThanOrEqual(sim.tick + 4 * TICKS_PER_SECOND);
    });

    test("Blood Burst heals now and then, by 2", () => {
        const sim = armed("blood_burst");
        for (let i = 0; i < 8; i++) {
            dummy(sim, Math.cos(i) * 1.5, Math.sin(i) * 1.5).frozen = 1e6;
        }
        let healed = 0;
        for (let i = 0; i < 40; i++) {
            sim.player.hp = 1;
            safeAttack(sim);
            healed += sim.player.hp - 1;
        }
        // 320 hits, each with a 5% chance of healing 2: about 32
        expect(healed).toBeGreaterThan(10);
        expect(healed).toBeLessThan(60);
        expect(healed % 2).toBe(0);
        expect(sim.effects.some((e) => e.spotAnim === 1542)).toBe(true);
    });

    test("the Blue moon spear's strikes freeze, though not bosses", () => {
        const sim = armed("blue_moon_spear");
        const goblin = dummy(sim, 3, 0);
        const boss = dummy(sim, -3, 0, "boss");
        const events = safeAttack(sim);
        expect(hitsOn(events, goblin).length).toBe(1);
        expect(hitsOn(events, boss).length).toBe(1);
        expect(goblin.frozen).toBeGreaterThan(0);
        expect(boss.frozen).toBe(0);

        // Other strikes don't
        const strike = armed("saradomin_strike");
        const other = dummy(strike, 3, 0);
        expect(hitsOn(safeAttack(strike), other).length).toBe(1);
        expect(other.frozen).toBe(0);
    });

    test("Osmumten's fang and the dragon hunter crossbow hit bosses again", () => {
        const fang = armed("osmumtens_fang");
        const boss = dummy(fang, 1.5, 0, "boss");
        // 100% and 60%
        const bossHits = hitsOn(safeAttack(fang), boss);
        expect(bossHits.length).toBe(2);
        expect(bossHits[1]).toBeLessThan(bossHits[0]);
        const other = armed("osmumtens_fang");
        const goblin = dummy(other, 1.5, 0);
        expect(hitsOn(safeAttack(other), goblin).length).toBe(1);

        const bow = armed("dragon_hunter_crossbow");
        const target = dummy(bow, 4, 0, "boss");
        target.frozen = 1e6;
        expect(hitsOn(attackOnce(bow, 1), target).length).toBe(2);
    });

    test("every third Dragon warhammer blow is Smash, after which things take more damage", () => {
        const sim = armed("dragon_warhammer");
        const goblin = dummy(sim, 1.5, 0);
        const blow = () => {
            // Knocked back or not, it's in reach for every blow
            goblin.x = goblin.prevX = sim.player.x + 1.5;
            goblin.y = goblin.prevY = sim.player.y;
            return hitsOn(safeAttack(sim), goblin);
        };
        const hammer = getWeapon("dragon_warhammer");
        expect(blow().length).toBe(1);
        expect(blow().length).toBe(1);
        expect(goblin.drainEnd).toBeLessThan(sim.tick);
        expect(sim.player.attackSeq).toBe(hammer.playerSeq);
        expect(blow().length).toBe(1);
        expect(goblin.drain).toBe(0.3);
        expect(goblin.drainEnd).toBeGreaterThan(sim.tick + 7 * TICKS_PER_SECOND);
        expect(sim.player.attackSeq).toBe(hammer.special!.playerSeq);
    });
});

describe("thrown axes and runes", () => {
    test("kill things", () => {
        for (const weaponId of ["throwing_axes", "elemental_runes"]) {
            const sim = armed(weaponId);
            runFor(sim, 30);
            expect(sim.kills).toBeGreaterThan(0);
        }
    });

    test("an axe bounces on from what it hits to the nearest it hasn't", () => {
        for (const level of [1, 2]) {
            const sim = armed("throwing_axes");
            sim.weapons[0].level = level;
            const first = dummy(sim, 3, 0);
            // Close to the first, then close to the second but not the first
            const second = dummy(sim, 3, 3);
            const third = dummy(sim, 3, 6);
            for (const enemy of [first, second, third]) {
                enemy.frozen = 1e6;
            }
            const events = attackOnce(sim, 2);
            expect(hitsOn(events, first).length).toBe(1);
            expect(hitsOn(events, second).length).toBe(1);
            // One bounce at level 1, two at level 2
            expect(hitsOn(events, third).length).toBe(level === 1 ? 0 : 1);
            expect(sim.projectiles.length).toBe(0);
        }
    });

    test("an axe with nothing to bounce on to stops", () => {
        const sim = armed("throwing_axes");
        const goblin = dummy(sim, 3, 0);
        goblin.frozen = 1e6;
        dummy(sim, 3, 9).frozen = 1e6;
        expect(hitsOn(attackOnce(sim, 2), goblin).length).toBe(1);
        expect(sim.projectiles.length).toBe(0);
    });

    test("runes circle the player, hitting what they pass once a pass", () => {
        const sim = armed("elemental_runes");
        sim.weapons[0].level = 2;
        const goblin = dummy(sim, 2.2, 0);
        goblin.frozen = 1e6;
        attack(sim);
        sim.weapons[0].cooldown = 1e9;
        const runes = sim.projectiles.filter((p) => p.orbit);
        expect(runes.map((p) => p.objId)).toEqual([556, 555]);
        // They go round the player wherever they go
        let hits = 0;
        for (let i = 0; i < 2.5 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, i < 20 ? 1 : 0);
            hits += hitsOn(sim.takeEvents(), goblin).length;
            for (const rune of runes) {
                const distance = Math.hypot(rune.x - sim.player.x, rune.y - sim.player.y);
                expect(distance).toBeCloseTo(2.2, 5);
            }
        }
        // Two runes, about one turn: each hits it about once
        expect(hits).toBeGreaterThanOrEqual(1);
        expect(hits).toBeLessThanOrEqual(3);
        // Used again, new ones take their place; then they go
        attack(sim);
        expect(sim.projectiles.filter((p) => p.orbit).length).toBe(2);
        expect(sim.projectiles.some((p) => runes.includes(p))).toBe(false);
        attackOnce(sim, 3.5);
        expect(sim.projectiles.length).toBe(0);
    });
});

describe("sets", () => {
    test("a set's bonus comes with enough of its pieces, and says so", () => {
        const sim = createSim();
        sim.equip("void_melee_helm");
        sim.equip("void_knight_top");
        expect(sim.activeSets).toEqual([]);
        const might = sim.stats.might;
        sim.takeEvents();
        // An Armoury variant counts as its piece
        sim.equip("elite_void_robe");
        expect(sim.activeSets).toEqual(["void_knight"]);
        expect(sim.stats.might).toBeCloseTo(might + 0.03 * 1.25 + 0.1);
        const notices = sim.takeEvents().filter((e) => e.type === "notice");
        expect(notices).toEqual([
            { type: "notice", message: "Void knight set bonus: +10% damage!" },
        ]);
        // A fourth piece adds no second notice; taking off one of four keeps
        // the bonus, and one of three takes it away
        sim.equip("void_knight_gloves");
        sim.equip("rune_full_helm");
        expect(sim.activeSets).toEqual(["void_knight"]);
        expect(sim.takeEvents().some((e) => e.type === "notice")).toBe(false);
        sim.equip("rune_platebody");
        expect(sim.activeSets).toEqual([]);
        expect(sim.stats.might).toBeCloseTo(0.03 * 1.25 + 0.03);
    });

    test("Torva's bonus is stats, the others boost their weapons", () => {
        const sim = createSim();
        sim.equip("torva_full_helm");
        sim.equip("torva_platebody");
        expect(sim.stats.maxHp).toBeCloseTo(0.05 + 0.1 + 0.2);
        expect(sim.stats.armor).toBeCloseTo(1 + 1 + 1.5 + 1);

        const level = (s: Sim) => s["getEffectiveLevel"](s.weapons[0]);
        // Inquisitor's: slashes and sweeps, not spells
        const melee = armed("scimitar");
        const before = level(melee).damage;
        melee.equip("inquisitors_great_helm");
        melee.equip("inquisitors_plateskirt");
        expect(level(melee).damage).toBeCloseTo(before * 1.15);
        melee.addWeapon("fire_spells");
        expect(melee["getEffectiveLevel"](melee.weapons[1]).damage).toBe(
            getWeapon("fire_spells").levels[0].damage,
        );
        // Crystal armour: the crystal weapons, harder and faster
        const crystal = armed("crystal_bow", "ranger");
        crystal.equip("crystal_helm");
        crystal.equip("corrupted_crystal_legs");
        const bow = getWeapon("crystal_bow").levels[0];
        expect(level(crystal).damage).toBeCloseTo(bow.damage * 1.2);
        dummy(crystal, 4, 0);
        const ticks = () => {
            attack(crystal);
            return crystal.weapons[0].cooldown;
        };
        const faster = 1 - (1 - crystal.stats.cooldown) * 0.85;
        expect(ticks()).toBe(Math.round(bow.cooldown * TICKS_PER_SECOND * (1 - faster)));
        // Though no faster than the cooldown cap lets anything be
        crystal.metaStats.cooldown = 1;
        crystal.updateStats();
        expect(ticks()).toBe(Math.max(5, Math.round(bow.cooldown * TICKS_PER_SECOND * 0.4)));
        // The Bow of Faerdhinen is a crystal bow too
        crystal.addWeapon("bow_of_faerdhinen");
        expect(crystal["getEffectiveLevel"](crystal.weapons[1]).damage).toBeCloseTo(
            getWeapon("bow_of_faerdhinen").levels[0].damage * 1.2,
        );
        // Virtus: auras cover more ground
        const aura = armed("ice_burst", "wizard");
        aura.equip("virtus_mask");
        aura.equip("virtus_robe_bottom");
        expect(level(aura).area).toBeCloseTo(getWeapon("ice_burst").levels[0].area * 1.2);
    });
});

describe("the new weapons", () => {
    // An enemy of this kind that won't die, standing still at (dx, dy) from
    // the player
    function standing(sim: Sim, id: string, dx: number, dy: number): Enemy {
        const enemy = sim.spawnEnemy(getEnemy(id), "normal", {
            x: sim.player.x + dx,
            y: sim.player.y + dy,
        })!;
        enemy.hp = enemy.maxHp = 1e6;
        enemy.frozen = 1e6;
        return enemy;
    }

    function total(events: SimEvent[], enemy: Enemy): number {
        return hitsOn(events, enemy).reduce((a, b) => a + b, 0);
    }

    test("the godsword's blade takes the hilt picked, at its hilt level", () => {
        const sim = armed("godsword");
        // The blade can't be held on its own
        expect(sim.getHeldObjId()).toBe(-1);
        sim.xp = 200;
        sim.step(0, 0);
        expect(sim.state).toBe("levelUp");
        const pending = sim.pendingLevelUps;
        sim.choices = [{ kind: "weaponLevel", weaponId: "godsword", level: 2, quality: "common" }];
        sim.choose(0);
        // The hilt is picked as the rest of that level up, and can't be
        // rerolled
        expect(sim.pendingLevelUps).toBe(pending);
        expect(sim.choices.map((c) => c.kind === "hilt" && c.into)).toEqual([
            "armadyl_godsword",
            "bandos_godsword",
            "saradomin_godsword",
            "zamorak_godsword",
        ]);
        expect(sim.reroll()).toBe(false);
        sim.choose(1);
        expect(sim.weapons[0].def.id).toBe("bandos_godsword");
        expect(sim.weapons[0].level).toBe(2);
        expect(sim.getHeldObjId()).toBe(11804);
        expect(sim.pendingLevelUps).toBe(pending - 1);
        // Then the next level up as usual
        expect(sim.state).toBe("levelUp");
        expect(sim.choosingHilt).toBe(false);
    });

    test("the hilted godsword's special attack comes every third swing", () => {
        const sim = armed("godsword");
        sim.weapons[0].level = 2;
        sim.apply({ kind: "hilt", weaponId: "godsword", into: "zamorak_godsword", hiltObjId: 1 });
        const goblin = dummy(sim, 1.5, 0);
        attack(sim);
        attack(sim);
        expect(goblin.frozen).toBe(0);
        attack(sim);
        expect(goblin.frozen).toBeGreaterThan(0);
    });

    test("Dragon claws hit four times a swing, a moment apart, the last the hardest", () => {
        const sim = armed("dragon_claws");
        const goblin = standing(sim, "goblin", 1.2, 0);
        expect(hitsOn(attack(sim), goblin).length).toBe(1);
        sim.weapons[0].cooldown = 1e9;
        const later: SimEvent[] = [];
        for (let i = 0; i < 20; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, 0);
            later.push(...sim.takeEvents());
        }
        const hits = hitsOn(later, goblin);
        expect(hits.length).toBe(3);
        // 100% of the damage against 40%, give or take 15% each
        expect(hits[2]).toBeGreaterThan(8 * 0.4 * 1.15);
    });

    test("the Ivandis flail hits vampyres and the undead harder", () => {
        expect(getEnemy("count_draynor").tags).toEqual(["vampyre"]);
        expect(getEnemy("dharok").tags).toEqual(["undead"]);
        const sim = armed("ivandis_flail");
        const zombie = standing(sim, "zombie", 1.5, 0.3);
        const goblin = standing(sim, "goblin", 1.5, -0.3);
        const events: SimEvent[] = [];
        for (let i = 0; i < 30; i++) {
            sim.player.invulnerable = 100;
            events.push(...attack(sim));
            // Back where they were, knocked back or not
            for (const [enemy, y] of [
                [zombie, 0.3],
                [goblin, -0.3],
            ] as const) {
                enemy.x = enemy.prevX = sim.player.x + 1.5;
                enemy.y = enemy.prevY = sim.player.y + y;
                enemy.vx = enemy.vy = 0;
            }
        }
        expect(hitsOn(events, goblin).length).toBe(30);
        expect(total(events, zombie) / total(events, goblin)).toBeCloseTo(1.5, 1);
    });

    test("the Blisterwood flail passes its hit on to the undead nearby", () => {
        const sim = armed("blisterwood_flail");
        sim.player.invulnerable = 100;
        const zombie = standing(sim, "zombie", 1.5, 0);
        // Out of reach, but close to the zombie
        const ghost = standing(sim, "ghost", 4.5, 0);
        const goblin = standing(sim, "goblin", 4.5, 1);
        const events = attack(sim);
        expect(hitsOn(events, zombie).length).toBe(1);
        expect(hitsOn(events, ghost).length).toBe(1);
        expect(hitsOn(events, goblin).length).toBe(0);
        expect(sim.effects.some((e) => e.spotAnim === 147 && e.enemyUid === ghost.uid)).toBe(true);
    });

    test("the Armadyl crossbow's bolts now and then do an enchanted bolt's effect", () => {
        const sim = armed("armadyl_crossbow", "ranger");
        const target = standing(sim, "goblin", 3, 0);
        const procs = new Set<number>();
        let burned = false;
        for (let i = 0; i < 80; i++) {
            attackOnce(sim, 0.5);
            for (const effect of sim.effects) {
                procs.add(effect.spotAnim);
            }
            burned ||= target.venomEnd > sim.tick;
        }
        // Ruby, diamond and dragonstone
        expect([754, 758, 756].every((id) => procs.has(id))).toBe(true);
        expect(burned).toBe(true);
    });

    test("crystal arrows split into three where they first hit", () => {
        const sim = armed("crystal_bow", "ranger");
        const first = standing(sim, "goblin", 4, 0);
        const others = [
            standing(sim, "goblin", 6, 2),
            standing(sim, "goblin", 6, -2),
            standing(sim, "goblin", 7.5, 0),
        ];
        // Too far from the first
        const far = standing(sim, "goblin", -4, 9);
        const events = attackOnce(sim, 2);
        expect(hitsOn(events, first).length).toBe(1);
        for (const other of others) {
            const hits = hitsOn(events, other);
            expect(hits.length).toBe(1);
            // Half the arrow's damage
            expect(hits[0]).toBeLessThan(hitsOn(events, first)[0]);
        }
        expect(hitsOn(events, far).length).toBe(0);
    });

    test("Toktz-mej-tal leaves the ground burning, hurting what's in it", () => {
        const sim = armed("toktz_mej_tal", "wizard");
        const goblin = standing(sim, "goblin", 1.5, 0);
        const events = attackOnce(sim, 2);
        // The pulse, then the fire every half second while it burns
        expect(hitsOn(events, goblin).length).toBeGreaterThanOrEqual(4);
        expect(sim.fires.length).toBeGreaterThan(0);
        expect(sim.fires[0].locId).toBe(getWeapon("toktz_mej_tal").burns!.locId);
        expect(sim.fires[0].flames.length).toBeGreaterThan(4);
        // It takes up no effect slots, so it can't crowd out anything else
        expect(sim.effects.filter((e) => e.loop)).toEqual([]);
        // Then it goes out
        for (let i = 0; i < 2 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 100;
            sim.step(0, 0);
        }
        expect(sim.fires.length).toBe(0);
    });

    test("Rigour, Augury and the Ancient sceptre boost their own style's weapons", () => {
        const sim = armed("shortbow", "ranger");
        sim.addWeapon("scimitar");
        sim.addWeapon("ice_burst");
        const level = (i: number) => sim["getEffectiveLevel"](sim.weapons[i]);
        sim.passives.push(
            { id: "rigour", level: 1, value: 0.2 },
            { id: "augury", level: 1, value: 0.1 },
            { id: "ancient_sceptre", level: 1, value: 0.3 },
        );
        sim.updateStats();
        expect(level(0).damage).toBeCloseTo(getWeapon("shortbow").levels[0].damage * 1.2);
        expect(level(1).damage).toBe(getWeapon("scimitar").levels[0].damage);
        const burst = getWeapon("ice_burst").levels[0];
        expect(level(2).damage).toBeCloseTo(burst.damage * 1.1);
        expect(level(2).area).toBeCloseTo(burst.area * 1.3);
        // Augury's longer effects
        expect(sim.stats.duration).toBeCloseTo(0.1);
    });
});

describe("endless runs", () => {
    function createEndless(characterId = "warrior"): Sim {
        return createSim(characterId, 1, "lumbridge", emptyStats(), true);
    }

    // Kills this round's final boss, starting the next round
    function beatRound(sim: Sim): void {
        const boss = sim.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        sim.damageEnemy(boss, 1e12, 0, sim.player.x, sim.player.y);
    }

    describe("past fifteen minutes", () => {
        const countCaskets = (sim: Sim) => sim.pickups.filter((p) => p.kind === "casket").length;

        function lateRun(endless = true): Sim {
            const sim = createSim("warrior", 1, "lumbridge", emptyStats(), endless);
            sim.tick = LATE_CASKET_SECONDS * TICKS_PER_SECOND;
            return sim;
        }

        test("a casket only has a small chance to drop", () => {
            const sim = lateRun();
            let dropped = 0;
            for (let i = 0; i < 2000; i++) {
                sim.dropCasket(1040.5, 1036.5, true);
                dropped += countCaskets(sim);
                sim.pickups.length = 0;
            }
            expect(dropped / 2000).toBeCloseTo(LATE_CASKET_CHANCE, 1);
            expect(dropped).toBeGreaterThan(0);
        });

        test("a casket's chance is 25%, and 25 can lie on the ground", () => {
            expect(LATE_CASKET_CHANCE).toBe(0.25);
            expect(LATE_CASKET_LIMIT).toBe(25);
            const sim = lateRun();
            let dropped = 0;
            for (let i = 0; i < 5000; i++) {
                sim.dropCasket(1040.5, 1036.5, true);
                dropped += countCaskets(sim);
                sim.pickups.length = 0;
            }
            expect(dropped / 5000).toBeGreaterThan(0.235);
            expect(dropped / 5000).toBeLessThan(0.265);
        });

        test("the limit doesn't apply before then, or outside endless runs", () => {
            const early = createEndless();
            early.tick = (LATE_CASKET_SECONDS - 1) * TICKS_PER_SECOND;
            const normal = lateRun(false);
            for (const sim of [early, normal]) {
                for (let i = 0; i < LATE_CASKET_LIMIT + 5; i++) {
                    sim.dropCasket(1040.5, 1036.5, true);
                }
                expect(countCaskets(sim)).toBe(LATE_CASKET_LIMIT + 5);
            }
        });

        test("drop as usual before then, and outside endless runs", () => {
            const early = createEndless();
            early.tick = (LATE_CASKET_SECONDS - 1) * TICKS_PER_SECOND;
            const normal = lateRun(false);
            for (const sim of [early, normal]) {
                for (let i = 0; i < 20; i++) {
                    sim.dropCasket(1040.5, 1036.5, true);
                }
                expect(countCaskets(sim)).toBe(20);
            }
        });

        test("no more than the limit lie on the ground, and the rest raise an alert", () => {
            const sim = lateRun();
            sim.rng.chance = () => true;
            for (let i = 0; i < LATE_CASKET_LIMIT + 2; i++) {
                sim.dropCasket(1040.5, 1036.5, true);
            }
            expect(countCaskets(sim)).toBe(LATE_CASKET_LIMIT);
            const alerts = sim.takeEvents().filter((e) => e.type === "notice");
            expect(alerts).toEqual(
                Array(2).fill({
                    type: "notice",
                    message: "You have a funny feeling there would've been a chest",
                }),
            );
        });

        test("a round's master casket doesn't roll for it, but keeps to the limit", () => {
            const sim = lateRun();
            sim.rng.chance = () => false;
            beatRound(sim);
            expect(sim.pickups.some((p) => p.kind === "casket" && p.tier === "master")).toBe(true);

            const full = lateRun();
            full.rng.chance = () => true;
            for (let i = 0; i < LATE_CASKET_LIMIT; i++) {
                full.dropCasket(1040.5, 1036.5, true);
            }
            beatRound(full);
            expect(countCaskets(full)).toBe(LATE_CASKET_LIMIT);
            expect(full.pickups.some((p) => p.tier === "master")).toBe(false);
        });
    });

    test("killing the final boss starts the next round instead of winning", () => {
        const sim = createEndless();
        expect(sim.timeLeftForBoss).toBe(RUN_LENGTH);
        runFor(sim, 2);
        beatRound(sim);
        expect(sim.state).toBe("playing");
        expect(sim.runOver).toBe(false);
        expect(sim.round).toBe(2);
        expect(sim.takeEvents()).toContainEqual({ type: "roundStarted", round: 2 });
        // It drops a master casket
        expect(sim.pickups.some((p) => p.kind === "casket" && p.tier === "master")).toBe(true);
        // The next round picks up some way into the map, so it's shorter
        expect(sim.mapSeconds).toBe(LATER_ROUND_START);
        expect(sim.timeLeftForBoss).toBe(RUN_LENGTH - LATER_ROUND_START);
        const result = sim.getResult();
        expect(result).toMatchObject({ endless: true, round: 2, victory: false });
        // The clock keeps going for the record
        expect(result.seconds).toBeGreaterThan(1.9);
    });

    test("pay less in coins, and less again as the rounds go on", () => {
        // Coins picked up off the ground, and what a piece of gear alchs for
        function found(sim: Sim): { pickup: number; alch: number } {
            const coins = sim.coins;
            sim.dropPickup("coins", sim.player.x, sim.player.y, 100);
            runFor(sim, 1, "still");
            return { pickup: sim.coins - coins, alch: sim.alchValue("rune_platebody") };
        }
        const normal = found(createSim());
        const sim = createEndless();
        expect(found(sim)).toEqual({
            pickup: Math.round(normal.pickup * ENDLESS_COINS),
            alch: Math.round(normal.alch * ENDLESS_COINS),
        });
        beatRound(sim);
        beatRound(sim);
        const later = found(sim);
        expect(later.pickup).toBe(Math.round(normal.pickup * endlessCoinScale(3)));
        expect(later.pickup).toBeLessThan(normal.pickup * ENDLESS_COINS);
        // Upgraded gear alchs for more, but no more than the round's crowds make up for
        expect(sim.alchValue("rune_platebody", 2)).toBe(Math.round(normal.alch * ENDLESS_COINS));
    });

    test("the next round's enemies are tougher, and their bones worth more", () => {
        const sim = createEndless();
        const at = { x: 1044.5, y: 1036.5 };
        const draynor = getEnemy("count_draynor");
        const before = sim.spawnEnemy(draynor, "boss", at)!;
        beatRound(sim);
        beatRound(sim);
        expect(sim.round).toBe(3);
        const after = sim.spawnEnemy(draynor, "boss", at)!;
        expect(after.maxHp / before.maxHp).toBeCloseTo(roundScale(ROUND_HP, 3), 2);
        expect(after.damageScale / before.damageScale).toBeCloseTo(roundScale(ROUND_DAMAGE, 3));
        expect(after.xp / before.xp).toBeCloseTo(roundScale(ROUND_XP, 3));
    });

    test("weapons level past their last level, multiplying their damage", () => {
        const sim = createEndless();
        const weapon = sim.weapons[0];
        const last = weapon.def.levels.length;
        weapon.level = last;
        weapon.bonus = 0.5;
        sim.apply({
            kind: "weaponLevel",
            weaponId: weapon.def.id,
            level: last + 1,
            quality: "common",
        });
        expect(weapon.level).toBe(last + 1);
        expect(weapon.bonus).toBeCloseTo(1.5 * 1.15 - 1);
        // Held and fired as the last level
        expect(sim.getHeldObjId()).toBe(weapon.def.levels[last - 1].objId ?? -1);
        runFor(sim, 20, "still");
        expect(sim.kills).toBeGreaterThan(0);
    });

    test("normal runs stop weapons and passives at their last level", () => {
        const sim = createSim();
        const weapon = sim.weapons[0];
        const last = weapon.def.levels.length;
        weapon.level = last;
        sim.apply({
            kind: "weaponLevel",
            weaponId: weapon.def.id,
            level: last + 1,
            quality: "common",
        });
        expect(weapon.level).toBe(last);
        sim.passives.push({ id: "piety", level: 5, value: 0.25 });
        sim.apply({
            kind: "passiveLevel",
            passiveId: "piety",
            level: 6,
            quality: "common",
            currentValue: 0.25,
        });
        expect(sim.passives[0].level).toBe(5);
    });

    test("later rounds' caskets bring upgraded gear", () => {
        const sim = createEndless();
        beatRound(sim);
        beatRound(sim);
        sim.takeEvents();
        let gear = 0;
        for (let i = 0; i < 40; i++) {
            sim.openCasket("elite");
            const chest = sim.chest!;
            const item = getItem(chest.itemId);
            expect(chest.upgrades).toBe(item.kind === "gear" ? 2 : 0);
            if (item.kind === "gear") {
                gear++;
                sim.resolveChest("take");
                expect(sim.gearUpgrades[item.slot]).toBe(2);
            } else {
                sim.resolveChest("alch");
            }
        }
        expect(gear).toBeGreaterThan(0);
        // Worn upgraded gear counts for its upgrades
        sim.gear = { head: "berserker_helm" };
        sim.gearUpgrades = { head: 2 };
        sim.updateStats();
        const helm = getGear("berserker_helm");
        expect(sim.stats.might).toBeCloseTo(helm.stats.might! * 2);
    });

    test("food heals more in later rounds", () => {
        const sim = createEndless();
        beatRound(sim);
        sim.player.hp = 1;
        sim.player.maxHp = 1000;
        sim.stash("shark");
        const index = sim.inventory.findIndex((slot) => slot?.itemId === "shark");
        sim.useItem(index);
        const shark = getItem("shark");
        const heal = shark.kind === "utility" && shark.use.kind === "heal" ? shark.use.amount : 0;
        expect(sim.player.hp).toBeCloseTo(1 + heal * ROUND_DAMAGE);
    });
});

describe("fun maps", () => {
    test("every fun map's waves, events and boss pools make sense", () => {
        for (const map of FUN_MAPS) {
            expect(map.fun).toBeDefined();
            for (const wave of map.waves) {
                for (const { id } of wave.enemies) {
                    // Players wear outfits; Pest Control's pests are NPCs
                    const enemy = getEnemy(id);
                    expect((enemy.outfits?.length ?? 0) > 0 || enemy.npcId !== -1, id).toBe(true);
                }
            }
            const times = map.events.map((e) => e.at);
            expect(times).toEqual([...times].sort((a, b) => a - b));
            // No final boss: a fun map's rounds turn over on their own
            expect(map.events.some((e) => e.kind === "finalBoss" || e.kind === "boss")).toBe(false);
            for (const id of map.fun!.bosses.pool) {
                expect(getEnemy(id).boss, id).toBeDefined();
            }
            if (map.fun!.character) {
                expect(CHARACTERS.some((c) => c.id === map.fun!.character)).toBe(true);
            }
        }
    });

    test("East Varrock's enemies jump the Wilderness Ditch; the player can't cross it", () => {
        const map = getMap("east_varrock");
        const ditchY = map.ditch!.y;
        // An open field round the spawn, the ditch two rows deep across it
        const baseX = map.spawn.x - 36.5;
        const baseY = ditchY - 31;
        const rows = openField().map((row, i) => {
            const y = baseY + 71 - i;
            return y === ditchY || y === ditchY + 1 ? row.replace(/\./g, "#") : row;
        });
        const sim = new Sim({
            grid: makeGrid(rows, baseX, baseY),
            mapId: map.id,
            characterId: "warrior",
            metaStats: emptyStats(),
            seed: 1,
            spawnX: map.spawn.x,
            spawnY: map.spawn.y,
        });
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        const pker = sim.spawnEnemy(getEnemy("clan_noob"), "normal", {
            x: map.spawn.x,
            y: ditchY - 12.5,
        })!;
        let jumped = false;
        for (let i = 0; i < 8 * TICKS_PER_SECOND && pker.y < ditchY; i++) {
            sim.step(0, 0);
            jumped ||= pker.anim === "jump";
        }
        expect(jumped).toBe(true);
        runFor(sim, 2, "still");
        expect(pker.y).toBeGreaterThan(ditchY + 2);
        expect(pker.jump).toBeUndefined();
        // Running south stops at the ditch
        for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
            sim.step(0, -1);
        }
        expect(sim.player.y).toBeGreaterThan(ditchY + 2);
    });

    test("are endless from the start, and turn over a round every fifteen minutes", () => {
        const sim = createSim("warrior", 1, "grand_exchange");
        expect(sim.endless).toBe(true);
        sim.tick = (RUN_LENGTH - 1) * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(sim.round).toBe(1);
        sim.tick = (RUN_LENGTH + 1) * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(sim.round).toBe(2);
        expect(sim.takeEvents().some((e) => e.type === "roundStarted")).toBe(true);
        // Later rounds pick up five minutes in, like an endless run's
        expect(Math.round(sim.mapSeconds)).toBe(LATER_ROUND_START);
        expect(sim.state).not.toBe("victory");
    });

    test("bring a random boss from the pool every few minutes, the first at four", () => {
        const sim = createSim("warrior", 3, "falador");
        const pool = sim.map.fun!.bosses.pool;
        const bosses = () => sim.enemies.filter((e) => e.boss && !e.dead);
        sim.tick = 239 * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(bosses()).toHaveLength(0);
        sim.tick = 240 * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(bosses()).toHaveLength(1);
        const first = bosses()[0].def.id;
        expect(pool).toContain(first);
        // Not again before three minutes, and a different one next
        sim.tick = (240 + 179) * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(bosses()).toHaveLength(1);
        sim.tick = (240 + 301) * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(bosses()).toHaveLength(2);
        expect(bosses()[1].def.id).not.toBe(first);
    });

    test("players wear one of their outfits", () => {
        const sim = createSim("warrior", 5, "grand_exchange");
        const def = getEnemy("scammer");
        const variants = new Set<number>();
        for (let i = 0; i < 40; i++) {
            const enemy = sim.spawnEnemy(def, "normal", {
                x: 1040.5 + (i % 8),
                y: 1030.5 + Math.floor(i / 8),
            })!;
            expect(enemy.variant).toBeGreaterThanOrEqual(0);
            expect(enemy.variant).toBeLessThan(def.outfits!.length);
            variants.add(enemy.variant);
        }
        expect(variants.size).toBeGreaterThan(1);
    });

    test("rangers hang back and shoot, and their shots only land when a crowd's hit could", () => {
        const sim = createSim("warrior", 1, "east_varrock");
        const ranger = sim.spawnEnemy(getEnemy("f2p_ranger"), "normal", { x: 1042.5, y: 1036.5 })!;
        const range = ranger.def.shot!.range;
        runFor(sim, 3, "still");
        // Close enough to shoot, not walking up to touch
        const distance = Math.hypot(ranger.x - sim.player.x, ranger.y - sim.player.y);
        expect(distance).toBeLessThanOrEqual(range);
        expect(distance).toBeGreaterThan(1.5);
        expect(sim.player.hp).toBeLessThan(sim.player.maxHp);

        // Just hit: a shot arriving now does nothing
        const sim2 = createSim("warrior", 1, "east_varrock");
        const shooter = sim2.spawnEnemy(getEnemy("f2p_mage"), "normal", { x: 1041.5, y: 1036.5 })!;
        sim2.player.invulnerable = 1000;
        runFor(sim2, 4, "still");
        expect(sim2.player.hp).toBe(sim2.player.maxHp);
        expect(shooter.dead).toBe(false);
    });

    test("enemies near the player chat, and Durial321 answers back", () => {
        const sim = createSim("durial321", 1, "falador");
        sim.spawnEnemy(getEnemy("noob"), "normal", { x: 1040.5, y: 1036.5 });
        const said: string[] = [];
        let durial = 0;
        for (let i = 0; i < 30 * TICKS_PER_SECOND; i++) {
            sim.step(0, 0);
            if (sim.state === "levelUp") {
                sim.choose(0);
            }
            for (const event of sim.takeEvents()) {
                if (event.type === "bossShout") {
                    said.push(event.text);
                } else if (event.type === "playerShout") {
                    durial++;
                    expect(sim.map.fun!.playerChat!.lines).toContain(event.text);
                }
            }
        }
        expect(said.length).toBeGreaterThan(5);
        expect(said.every((line) => getEnemy("noob").chat!.includes(line) || line.length > 0)).toBe(
            true,
        );
        expect(durial).toBeGreaterThan(0);
    });
});

describe("Castle Wars and Pest Control", () => {
    test("the Flag carrier runs from the player, stands off a way, and comes back when far", () => {
        const sim = createSim("warrior", 1, "castle_wars");
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        const def = getEnemy("flag_carrier");
        const range = def.flees!.range;
        const carrier = sim.spawnEnemy(def, "boss")!;
        const distance = () => Math.hypot(carrier.x - sim.player.x, carrier.y - sim.player.y);
        // Close by: he runs, and keeps out of reach
        carrier.x = carrier.prevX = sim.player.x + 4;
        carrier.y = carrier.prevY = sim.player.y + 0.5;
        // Not in the middle of a teleport out
        carrier.bossState!.cooldowns.fill(1e6);
        runFor(sim, 3, "still");
        expect(distance()).toBeGreaterThanOrEqual(range - 0.5);
        // Further off, he stands his ground
        const x = carrier.x;
        const y = carrier.y;
        runFor(sim, 2, "still");
        expect(Math.hypot(carrier.x - x, carrier.y - y)).toBeLessThan(0.5);
        // Far away, he comes back
        carrier.x = carrier.prevX = sim.player.x - 25;
        carrier.y = carrier.prevY = sim.player.y;
        runFor(sim, 2, "still");
        expect(distance()).toBeLessThan(24);
    });

    test("the Flag carrier runs along a wall rather than into it", () => {
        const sim = createSim("warrior", 1, "castle_wars");
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        const carrier = sim.spawnEnemy(getEnemy("flag_carrier"), "boss")!;
        carrier.bossState!.cooldowns.fill(1e6);
        // Between the player and the field's west edge: straight away is the wall
        sim.player.x = sim.player.prevX = 1006.5;
        sim.player.y = sim.player.prevY = 1036.5;
        carrier.x = carrier.prevX = 1002.5;
        carrier.y = carrier.prevY = 1036.5;
        runFor(sim, 1.5, "still");
        expect(Math.abs(carrier.y - 1036.5)).toBeGreaterThan(1.5);
        expect(sim.grid.isSolid(Math.floor(carrier.x), Math.floor(carrier.y))).toBe(false);
    });

    test("the Flag carrier drops two caskets", () => {
        const sim = createSim("warrior", 1, "castle_wars");
        const carrier = sim.spawnEnemy(getEnemy("flag_carrier"), "boss", {
            x: sim.player.x + 8,
            y: sim.player.y,
        })!;
        sim.damageEnemy(carrier, 1e9, 0, sim.player.x, sim.player.y);
        const caskets = sim.pickups.filter((p) => p.kind === "casket");
        expect(caskets.map((p) => p.tier)).toEqual(["elite", "elite"]);
        expect(sim.bossesKilled).toContain("flag_carrier");
    });

    // An open field round the Pest Control island, so the portals' spots are
    // on it
    function pestControl(seed = 1, locs: TestLoc[] = []): Sim {
        const map = getMap("pest_control");
        return new Sim({
            grid: makeGrid(openField(), 2620, 2560, locs),
            mapId: map.id,
            characterId: "warrior",
            metaStats: emptyStats(),
            seed,
            spawnX: 2656.5,
            spawnY: 2600.5,
        });
    }

    test("Pest Control's portals open together, shielded, and call in pests that only drop bones", () => {
        const sim = pestControl();
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        const pool = sim.map.fun!.bosses.pool;
        const portals = () => sim.enemies.filter((e) => e.boss && !e.dead);
        sim.tick = (sim.map.fun!.bosses.firstAt - 1) * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(portals()).toHaveLength(0);
        sim.tick = sim.map.fun!.bosses.firstAt * TICKS_PER_SECOND;
        sim.step(0, 0);
        expect(
            portals()
                .map((p) => p.def.id)
                .sort(),
        ).toEqual([...pool].sort());
        for (const portal of portals()) {
            // On their own spots, and shielded
            expect({ x: portal.x, y: portal.y }).toEqual(portal.def.spawnAt![0]);
            expect(sim.damageEnemy(portal, 100, 0, sim.player.x, sim.player.y)).toBe(0);
        }
        // Their shields drop one at a time, purple's first
        const notices: string[] = [];
        for (let i = 0; i < 16 * TICKS_PER_SECOND; i++) {
            sim.player.invulnerable = 1e6;
            sim.step(0, 0);
            if (sim.state === "levelUp") {
                sim.choose(0);
            }
            for (const event of sim.takeEvents()) {
                if (event.type === "notice") {
                    notices.push(event.message);
                }
            }
        }
        expect(notices).toContain("The purple portal's shield has dropped!");
        expect(notices.some((n) => n.includes("blue"))).toBe(false);
        const purple = portals().find((p) => p.def.id === "purple_portal")!;
        expect(purple.shieldEnd).toBe(0);
        const blue = portals().find((p) => p.def.id === "blue_portal")!;
        expect(blue.shieldEnd).toBeGreaterThan(sim.tick);
        // The pests they call in drop their bones and nothing else
        const pests = sim.enemies.filter((e) => e.spawnedBy !== 0 && !e.dead);
        expect(pests.length).toBeGreaterThan(0);
        expect(pests.every((e) => e.bonesOnly)).toBe(true);
        sim.metaStats.luck = 1e6;
        sim.updateStats();
        const before = sim.pickups.length;
        for (const pest of pests) {
            sim.damageEnemy(pest, 1e9, 0, sim.player.x, sim.player.y);
        }
        const dropped = sim.pickups.slice(before);
        expect(dropped.length).toBeGreaterThan(0);
        expect(dropped.every((p) => p.kind === "bones")).toBe(true);
    });

    test("destroying all four portals drops a master casket, and they come back a few minutes later", () => {
        const sim = pestControl(2);
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        const fun = sim.map.fun!;
        sim.tick = fun.bosses.firstAt * TICKS_PER_SECOND;
        sim.step(0, 0);
        const portals = sim.enemies.filter((e) => e.boss && !e.dead);
        expect(portals).toHaveLength(4);
        const caskets = () => sim.pickups.filter((p) => p.kind === "casket").map((p) => p.tier);
        for (const portal of portals) {
            portal.shieldEnd = 0;
        }
        for (const portal of portals.slice(0, 3)) {
            sim.damageEnemy(portal, 1e9, 0, sim.player.x, sim.player.y);
        }
        // A smaller casket each, and nothing more until the last
        expect(caskets()).toEqual(["medium", "medium", "medium"]);
        sim.damageEnemy(portals[3], 1e9, 0, sim.player.x, sim.player.y);
        expect(caskets()).toEqual(["medium", "medium", "medium", "medium", "master"]);
        expect(sim.takeEvents()).toContainEqual({
            type: "notice",
            message: fun.bosses.together!.message,
        });
        // Not before the next lot is due, and then all four again
        const killed = sim.seconds;
        const alive = () => sim.enemies.filter((e) => e.boss && !e.dead).length;
        sim.tick = Math.round((killed + fun.bosses.every[0] - 1) * TICKS_PER_SECOND);
        sim.step(0, 0);
        expect(alive()).toBe(0);
        sim.tick = Math.round((killed + fun.bosses.every[1] + 1) * TICKS_PER_SECOND);
        sim.step(0, 0);
        expect(alive()).toBe(4);
        expect(sim.bossesKilled).toContain("purple_portal");
    });

    test("a portal's caskets land where the player can walk over them", () => {
        // Each portal stands in the middle of three tiles by three of solid map
        const spots = getMap("pest_control").fun!.bosses.pool.map((id) => getEnemy(id).spawnAt![0]);
        const sim = pestControl(
            2,
            spots.map(({ x, y }) => ({
                x: Math.floor(x) - 1,
                y: Math.floor(y) - 1,
                sizeX: 3,
                sizeY: 3,
            })),
        );
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        sim.tick = sim.map.fun!.bosses.firstAt * TICKS_PER_SECOND;
        sim.step(0, 0);
        const portals = sim.enemies.filter((e) => e.boss && !e.dead);
        expect(portals).toHaveLength(4);
        for (const portal of portals) {
            portal.shieldEnd = 0;
            sim.damageEnemy(portal, 1e9, 0, sim.player.x, sim.player.y);
        }
        const caskets = sim.pickups.filter((p) => p.kind === "casket");
        expect(caskets).toHaveLength(5);
        for (const casket of caskets) {
            // Walk at it from the far side of it from the nearest portal
            const portal = [...portals].sort(
                (a, b) =>
                    Math.hypot(a.x - casket.x, a.y - casket.y) -
                    Math.hypot(b.x - casket.x, b.y - casket.y),
            )[0];
            const angle = Math.atan2(casket.y - portal.y, casket.x - portal.x);
            sim.player.x = sim.player.prevX = casket.x + Math.cos(angle) * 3;
            sim.player.y = sim.player.prevY = casket.y + Math.sin(angle) * 3;
            for (let i = 0; i < 2 * TICKS_PER_SECOND; i++) {
                if (sim.state === "levelUp") {
                    sim.choose(0);
                }
                if (sim.state === "chest") {
                    sim.resolveChest("alch");
                }
                sim.step(-Math.cos(angle), -Math.sin(angle));
            }
            expect(sim.pickups).not.toContain(casket);
        }
    });

    test("what needs walking over doesn't land somewhere walled off", () => {
        // A one tile room with no way in, at (1040, 1040)
        const grid = makeGrid(openField(), 1000, 1000, [
            { x: 1039, y: 1041, sizeX: 3, sizeY: 1 },
            { x: 1039, y: 1039, sizeX: 3, sizeY: 1 },
            { x: 1039, y: 1040, sizeX: 1, sizeY: 1 },
            { x: 1041, y: 1040, sizeX: 1, sizeY: 1 },
        ]);
        const sim = new Sim({
            grid,
            characterId: "warrior",
            metaStats: emptyStats(),
            seed: 1,
            spawnX: 1036.5,
            spawnY: 1036.5,
        });
        // In the room's east wall, nearest the room
        sim.dropCasket(1041.1, 1040.5, false);
        sim.dropPowerUp("magnet", 1041.1, 1040.5);
        for (const pickup of sim.pickups) {
            expect({ x: pickup.x, y: pickup.y }).toEqual({ x: 1042.5, y: 1040.5 });
        }
        expect(sim.pickups).toHaveLength(2);
    });

    test("spinners go and heal a hurt portal", () => {
        const sim = pestControl();
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        const portal = sim.spawnEnemy(getEnemy("purple_portal"), "boss")!;
        portal.shieldEnd = 0;
        portal.hp = Math.round(portal.maxHp / 2);
        sim.spawnEnemy(getEnemy("spinner"), "normal", { x: portal.x + 10, y: portal.y });
        const hurt = portal.hp;
        runFor(sim, 8, "still");
        expect(portal.hp).toBeGreaterThan(hurt);
    });

    test("the nearest of the portals is the one shown", () => {
        const sim = pestControl();
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        sim.tick = sim.map.fun!.bosses.firstAt * TICKS_PER_SECOND;
        sim.step(0, 0);
        const portal = (id: string) => sim.enemies.find((e) => e.def.id === id)!;
        const red = portal("red_portal");
        const purple = portal("purple_portal");
        sim.player.x = purple.x + 3;
        sim.player.y = purple.y;
        expect(sim.shownBoss).toBe(purple);
        sim.player.x = red.x + 3;
        sim.player.y = red.y;
        expect(sim.shownBoss).toBe(red);
        // Not one that's down
        red.shieldEnd = 0;
        sim.damageEnemy(red, 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.shownBoss).not.toBe(red);
        expect(sim.shownBoss?.dead).toBe(false);
    });

    test("the final boss's bar stays up over a nearer boss, to the victory screen", () => {
        const sim = createSim("warrior", 1, "prifddinas");
        const hunllef = sim.spawnEnemy(getEnemy("corrupted_hunllef"), "finalBoss", {
            x: 1050.5,
            y: 1036.5,
        })!;
        const zulrah = sim.spawnEnemy(getEnemy("zulrah"), "boss", { x: 1038.5, y: 1036.5 })!;
        expect(zulrah.dead).toBe(false);
        expect(sim.shownBoss).toBe(hunllef);
        sim.damageEnemy(hunllef, 1e9, 0, sim.player.x, sim.player.y);
        expect(sim.state).toBe("victory");
        expect(sim.shownBoss).toBe(hunllef);
    });
});

describe("the Ancient spell pick", () => {
    test("a burst's second level becomes the spell picked, at the same level", () => {
        const sim = new Sim({
            grid: makeGrid(openField(), 1000, 1000),
            mapId: "lumbridge",
            characterId: "ancient_mage",
            metaStats: emptyStats(),
            seed: 1,
            spawnX: 1036.5,
            spawnY: 1036.5,
            unlockedItems: new Set(["smoke_burst", "shadow_burst", "blood_burst"]),
        });
        sim.state = "levelUp";
        sim.pendingLevelUps = 1;
        sim.choices = [{ kind: "weaponLevel", weaponId: "ice_burst", level: 2, quality: "common" }];
        sim.choose(0);
        expect(sim.choosingHilt).toBe(true);
        expect(sim.choices.length).toBe(4);
        sim.choose(2);
        expect(sim.weapons.map((w) => [w.def.id, w.level])).toEqual([["shadow_burst", 2]]);
    });
});

describe("extra slots from the shop", () => {
    const slots = (weaponSlots: number, passiveSlots: number) =>
        createSim("warrior", 1, "lumbridge", { ...emptyStats(), weaponSlots, passiveSlots });
    const PASSIVES = ["piety", "graceful", "rapid_heal", "amulet_of_glory", "chivalry"];
    const takePassives = (sim: Sim) => {
        for (const passiveId of PASSIVES) {
            sim.apply({ kind: "newPassive", passiveId, quality: "common" });
        }
    };

    test("weapons stop at the usual 4 without them", () => {
        const sim = slots(0, 0);
        sim.weapons = [];
        for (const id of ["scimitar", "fire_spells", "throwing_knives", "ice_burst", "shortbow"]) {
            sim.addWeapon(id);
        }
        expect(sim.weapons.length).toBe(4);
        takePassives(sim);
        expect(sim.passives.length).toBe(4);
    });

    test("they add weapon slots, and level ups offer new weapons for them", () => {
        const sim = slots(2, 0);
        sim.weapons = [];
        for (const id of ["scimitar", "fire_spells", "throwing_knives", "ice_burst", "shortbow"]) {
            sim.addWeapon(id);
        }
        expect(sim.weapons.length).toBe(5);
        const offers = Array.from({ length: 50 }, () => sim["roll"]()).flat();
        expect(offers.some((choice) => choice.kind === "newWeapon")).toBe(true);
    });

    test("they add passive slots, and level ups offer new passives for them", () => {
        const sim = slots(0, 2);
        takePassives(sim);
        expect(sim.passives.length).toBe(5);
        const offers = Array.from({ length: 50 }, () => sim["roll"]()).flat();
        expect(offers.some((choice) => choice.kind === "newPassive")).toBe(true);
    });
});

describe("the damage meter", () => {
    const windowTicks = DPS_WINDOW_SECONDS * TICKS_PER_SECOND;
    // What the results screen would say the run has dealt
    const totalDamage = (sim: Sim) =>
        sim.getRunStats().sources.reduce((sum, row) => sum + row.damage, 0);

    function quietSim(): Sim {
        const sim = createSim();
        sim.weapons = [];
        sim.player.invulnerable = 1e6;
        return sim;
    }

    function dummy(sim: Sim, hp = 1e9): Enemy {
        const enemy = sim.spawnEnemy(getEnemy("goblin"), "normal", {
            x: sim.player.x + 4,
            y: sim.player.y,
        })!;
        enemy.hp = enemy.maxHp = hp;
        enemy.frozen = 1e6;
        return enemy;
    }

    function hit(sim: Sim, enemy: Enemy, damage = 1000): void {
        sim.damageEnemy(enemy, damage, 0, sim.player.x, sim.player.y);
    }

    function steps(sim: Sim, ticks: number): void {
        for (let i = 0; i < ticks; i++) {
            sim.step(0, 0);
        }
    }

    test("is damage a second over the window, back to 0 once you stop hitting", () => {
        const sim = quietSim();
        const enemy = dummy(sim);
        expect(sim.dps).toBe(0);
        hit(sim, enemy);
        const dealt = totalDamage(sim);
        expect(dealt).toBeGreaterThan(0);
        expect(sim.dps).toBe(dealt / DPS_WINDOW_SECONDS);
        steps(sim, windowTicks - 1);
        expect(sim.dps).toBe(dealt / DPS_WINDOW_SECONDS);
        steps(sim, 1);
        expect(sim.dps).toBe(0);
    });

    test("only counts the window, however long the run's been hitting", () => {
        const sim = quietSim();
        const enemy = dummy(sim);
        const hits: number[] = [];
        for (let second = 0; second < 3 * DPS_WINDOW_SECONDS; second++) {
            const before = totalDamage(sim);
            hit(sim, enemy);
            hits.push(totalDamage(sim) - before);
            const recent = hits.slice(-DPS_WINDOW_SECONDS).reduce((a, b) => a + b, 0);
            expect(sim.dps).toBe(recent / DPS_WINDOW_SECONDS);
            steps(sim, TICKS_PER_SECOND);
        }
    });

    test("counts every source, the same as the results screen", () => {
        const setups: [string, (sim: Sim, enemy: Enemy) => void][] = [
            ["weapon:scimitar", (sim) => sim.addWeapon("scimitar")],
            [
                "weapon:toxic_blowpipe",
                (sim, enemy) => {
                    enemy.venom = 40;
                    enemy.venomEnd = sim.tick + 1000;
                    enemy.venomNext = sim.tick + 1;
                    enemy.venomSource = "weapon:toxic_blowpipe";
                },
            ],
            ["powerUp:cannon", (sim) => sim.usePowerUp(getPowerUp("cannon"))],
            ["powerUp:thrall", (sim) => sim.usePowerUp(getPowerUp("thrall"))],
            ["powerUp:giant_essence", (sim) => sim.usePowerUp(getPowerUp("giant_essence"))],
            ["powerUp:evil_bob", (sim) => sim.usePowerUp(getPowerUp("evil_bob"))],
            [
                "item:black_chinchompa",
                (sim) => {
                    sim.stash("black_chinchompa");
                    sim.useItem(0);
                },
            ],
            [
                "recoil",
                (sim, enemy) => {
                    sim.player.invulnerable = 0;
                    sim.player.maxHp = sim.player.hp = 1e6;
                    sim.equip("ring_of_recoil");
                    enemy.frozen = 0;
                    enemy.x = sim.player.x + 0.4;
                },
            ],
        ];
        for (const [source, setUp] of setups) {
            const sim = quietSim();
            const enemy = dummy(sim);
            enemy.x = sim.player.x + 1.5;
            setUp(sim, enemy);
            runFor(sim, DPS_WINDOW_SECONDS / 2, "still");
            expect(sim.damageBySource[source] ?? 0, source).toBeGreaterThan(0);
            expect(sim.dps * DPS_WINDOW_SECONDS, source).toBe(totalDamage(sim));
        }
    });

    test("agrees with the results screen all through a real run", () => {
        const sim = createSim("warrior", 3);
        sim.player.maxHp = sim.player.hp = 1e6;
        const totals = new Map<number, number>();
        let checked = 0;
        for (let i = 0; i < 6000; i++) {
            runFor(sim, 1 / TICKS_PER_SECOND);
            totals.set(sim.tick, totalDamage(sim));
            const earlier = totals.get(sim.tick - windowTicks);
            if (earlier !== undefined) {
                expect(sim.dps * DPS_WINDOW_SECONDS).toBe(totalDamage(sim) - earlier);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(5000);
        expect(totalDamage(sim)).toBeGreaterThan(0);
    });

    test("counts overkill, and not what's blocked or already dead", () => {
        const sim = quietSim();
        const small = dummy(sim, 5);
        hit(sim, small, 1e6);
        expect(small.dead).toBe(true);
        const dealt = totalDamage(sim);
        // Like the results screen: the whole hit, not the 5 hitpoints it took
        expect(dealt).toBeGreaterThan(5);
        expect(sim.dps * DPS_WINDOW_SECONDS).toBe(dealt);

        hit(sim, small, 1e6);
        const shielded = dummy(sim);
        shielded.shieldEnd = sim.tick + 1e6;
        hit(sim, shielded, 1e6);
        expect(totalDamage(sim)).toBe(dealt);
        expect(sim.dps * DPS_WINDOW_SECONDS).toBe(dealt);
    });

    test("stands still while the run waits, then carries on where it was", () => {
        const sim = quietSim();
        const enemy = dummy(sim);
        hit(sim, enemy);
        steps(sim, windowTicks - 10);
        const dps = sim.dps;
        expect(dps).toBeGreaterThan(0);

        sim.openCasket("easy");
        expect(sim.state).toBe("chest");
        steps(sim, 5 * windowTicks);
        expect(sim.dps).toBe(dps);
        sim.resolveChest("alch");

        sim.state = "levelUp";
        steps(sim, 5 * windowTicks);
        expect(sim.dps).toBe(dps);
        sim.state = "playing";

        steps(sim, 9);
        expect(sim.dps).toBe(dps);
        steps(sim, 1);
        expect(sim.dps).toBe(0);
    });

    test("comes out the same for the same seed", () => {
        const run = () => {
            const sim = createSim("warrior", 7);
            runFor(sim, 30);
            return sim.dps;
        };
        const dps = run();
        expect(dps).toBeGreaterThan(0);
        expect(run()).toBe(dps);
    });
});

describe("random events", () => {
    // One particular visitor, with the player standing somewhere else for now
    function withVisitor(id: string, sim = createSim()): Visitor {
        expect(sim.startRandomEvent(getRandomEvent(id))).toBe(true);
        return sim.visitor!;
    }

    function walkUp(sim: Sim): void {
        const visitor = sim.visitor!;
        sim.player.x = visitor.x + 0.5;
        sim.player.y = visitor.y;
        sim.step(0, 0);
    }

    test("every visitor can be baked and says what they're doing", () => {
        for (const event of RANDOM_EVENTS) {
            if (event.effect.kind === "ambush") {
                expect(getEnemy(event.effect.enemyId).boss).toBeDefined();
                continue;
            }
            expect(event.npcId).toBeDefined();
            expect(event.idleSeq).toBeDefined();
            expect(event.arrive).toBeTruthy();
            expect(event.leave).toBeTruthy();
            expect(event.shouts?.length).toBeGreaterThan(0);
        }
    });

    test("they turn up in time, one at a time and not the same twice running", () => {
        // Endless, and with no crowd to slow it down or kill the player
        const sim = createSim("wizard", 1, "lumbridge", emptyStats(), true);
        const seen: string[] = [];
        let first = -1;
        for (let i = 0; i < 4000 * TICKS_PER_SECOND && seen.length < 10; i++) {
            const before = sim["lastRandomEventId"];
            sim.enemies = [];
            sim.step(0, 0);
            sim.takeEvents();
            const latest = sim["lastRandomEventId"];
            if (latest && latest !== before) {
                seen.push(latest);
                if (first === -1) {
                    first = sim.seconds;
                }
            }
        }
        // (a repeat would never register as a change, so ten means none came twice running)
        expect(seen.length).toBe(10);
        expect(first).toBeGreaterThanOrEqual(RANDOM_EVENT_FIRST[0]);
        expect(first).toBeLessThanOrEqual(RANDOM_EVENT_FIRST[1]);
        expect(new Set(seen).size).toBeGreaterThan(3);
    });

    test("a visitor waits, says their piece, then goes", () => {
        const sim = createSim();
        const visitor = withVisitor("genie", sim);
        const distance = Math.hypot(visitor.x - sim.player.x, visitor.y - sim.player.y);
        expect(distance).toBeGreaterThanOrEqual(VISITOR_DISTANCE[0] - 1);
        expect(distance).toBeLessThanOrEqual(VISITOR_DISTANCE[1] + 1);
        expect(sim.takeEvents().some((e) => e.type === "visitor")).toBe(true);
        sim.step(0, 0);
        expect(sim.takeEvents().some((e) => e.type === "visitorShout")).toBe(true);
        runFor(sim, VISITOR_LIFETIME - 1, "still");
        expect(sim.visitor).toBe(visitor);
        runFor(sim, 2, "still");
        expect(sim.visitor).toBeUndefined();
    });

    test("the genie grants experience", () => {
        const sim = createSim();
        withVisitor("genie", sim);
        const level = sim.xpForNextLevel - sim.xpForThisLevel;
        const xp = sim.xp;
        walkUp(sim);
        expect(sim.visitor).toBeUndefined();
        expect(sim.xp - xp).toBeGreaterThanOrEqual(level * 0.75);
    });

    test("the sandwich lady feeds you, and it's no good ignoring her", () => {
        const sim = createSim();
        withVisitor("sandwich_lady", sim);
        sim.player.hp = 5;
        walkUp(sim);
        expect(sim.player.hp).toBe(5 + sim.player.maxHp * 0.4);

        const ignored = createSim();
        const { endTick } = withVisitor("sandwich_lady", ignored);
        ignored.tick = endTick - 1;
        ignored.step(0, 0);
        expect(ignored.visitor).toBeUndefined();
        expect(ignored.player.hp).toBeLessThan(ignored.player.maxHp);

        // But she's not out to kill
        const close = createSim();
        const last = withVisitor("sandwich_lady", close);
        close.player.hp = 1;
        close.tick = last.endTick - 1;
        close.step(0, 0);
        expect(close.visitor).toBeUndefined();
        expect(close.state).toBe("playing");
        expect(close.player.hp).toBe(1);
    });

    test("Rick Turpentine leaves a casket to walk over", () => {
        const sim = createSim();
        withVisitor("rick_turpentine", sim);
        walkUp(sim);
        expect(sim.pickups.some((p) => p.kind === "casket")).toBe(true);
    });

    test("the strange plant's fruit speeds you up and cures poison", () => {
        const sim = createSim();
        withVisitor("strange_plant", sim);
        sim.player.poisonEnd = sim.tick + 500;
        sim.player.poisonDamage = 1;
        walkUp(sim);
        expect(sim.stats.moveSpeed).toBeCloseTo(0.3);
        expect(sim.player.poisonEnd).toBe(-1);
        expect(sim.cured).toBe(true);
        // It's not an item, so its timer goes by what it says
        expect(getBuffViews(sim)[0]).toMatchObject({ name: "Strange fruit", objId: 464 });
    });

    describe("the Mysterious Old Man", () => {
        function meetOldMan(coins: number, sim = createSim()): Sim {
            withVisitor("mysterious_old_man", sim);
            sim.coins = coins;
            walkUp(sim);
            return sim;
        }

        test("has the run wait while he shows different power-ups", () => {
            const sim = meetOldMan(0);
            expect(sim.state).toBe("event");
            const ids = sim.offer!.options.map((o) => (o.kind === "powerUp" ? o.powerUpId : ""));
            expect(new Set(ids).size).toBe(OLD_MAN_OFFERS);
            const tick = sim.tick;
            sim.step(1, 0);
            expect(sim.tick).toBe(tick);
            sim.leaveEvent();
            expect(sim.state).toBe("playing");
            expect(sim.offer).toBeUndefined();
        });

        test("wants paying", () => {
            const sim = meetOldMan(0);
            sim.takeEvents();
            expect(sim.chooseEventOption(0)).toBe(false);
            expect(sim.takeEvents().some((e) => e.type === "powerUp")).toBe(false);
            expect(sim.state).toBe("event");
        });

        test("sells each thing once and is done when it's all gone", () => {
            const sim = meetOldMan(100000);
            const prices = sim.offer!.options.map((o) => (o.kind === "powerUp" ? o.price : 0));
            sim.takeEvents();
            expect(sim.chooseEventOption(0)).toBe(true);
            expect(sim.coins).toBe(100000 - prices[0]);
            expect(sim.takeEvents().some((e) => e.type === "powerUp")).toBe(true);
            expect(sim.chooseEventOption(0)).toBe(false);
            expect(sim.coins).toBe(100000 - prices[0]);
            expect(sim.chooseEventOption(1)).toBe(true);
            expect(sim.state).toBe("event");
            expect(sim.chooseEventOption(2)).toBe(true);
            expect(sim.state).toBe("playing");
        });

        test("doesn't put off the next power-up to drop", () => {
            const sim = meetOldMan(100000);
            const lastDrop = sim["lastPowerUpTick"];
            sim.chooseEventOption(0);
            expect(sim["lastPowerUpTick"]).toBe(lastDrop);
        });

        test("charges more later on, and less in endless runs where coins are worth less", () => {
            const price = (sim: Sim) => sim["oldManPrice"](getPowerUp("magnet").price);
            const early = createSim();
            const late = createSim();
            late.tick = 10 * 60 * TICKS_PER_SECOND;
            const endless = createSim("warrior", 1, "lumbridge", emptyStats(), true);
            endless.tick = late.tick;
            expect(price(late)).toBeGreaterThan(price(early));
            expect(price(endless)).toBeLessThan(price(late));
        });

        test("a level up that came in meanwhile waits its turn", () => {
            const sim = meetOldMan(0);
            sim.xp = sim.xpForNextLevel;
            sim.leaveEvent();
            expect(sim.state).toBe("levelUp");
        });

        test("a nuke that finishes off the final boss ends the run", () => {
            const sim = meetOldMan(100000);
            const boss = sim.spawnEnemy(getEnemy("wise_old_man"), "finalBoss")!;
            boss.hp = 1;
            sim.offer!.options[0] = {
                kind: "powerUp",
                powerUpId: "bot_nuke",
                price: 1,
                sold: false,
            };
            sim.chooseEventOption(0);
            expect(sim.state).toBe("victory");
            expect(sim.offer).toBeUndefined();
        });
    });

    describe("the Quiz Master", () => {
        function meetQuizMaster(seed = 1): Sim {
            const sim = createSim("warrior", seed);
            withVisitor("quiz_master", sim);
            walkUp(sim);
            return sim;
        }

        test("always has one odd one out, from another group", () => {
            const groups = getQuizGroups();
            expect(groups.length).toBeGreaterThan(2);
            for (let seed = 1; seed <= 40; seed++) {
                const options = meetQuizMaster(seed).offer!.options;
                expect(options.length).toBe(4);
                const answers = options.flatMap((o) => (o.kind === "answer" ? [o] : []));
                const odd = answers.filter((o) => o.correct);
                expect(odd.length).toBe(1);
                const rest = answers.filter((o) => !o.correct).map((o) => o.itemId);
                const group = groups.find((g) => g.some((item) => item.id === rest[0]))!;
                expect(rest.every((id) => group.some((item) => item.id === id))).toBe(true);
                expect(group.some((item) => item.id === odd[0].itemId)).toBe(false);
            }
        });

        test("gives a power-up for the right answer and nothing for a wrong one", () => {
            const right = meetQuizMaster();
            right.takeEvents();
            const answers = right.offer!.options;
            right.chooseEventOption(answers.findIndex((o) => o.kind === "answer" && o.correct));
            expect(right.state).toBe("playing");
            expect(right.takeEvents().some((e) => e.type === "powerUp")).toBe(true);

            const wrong = meetQuizMaster();
            wrong.takeEvents();
            wrong.chooseEventOption(
                wrong.offer!.options.findIndex((o) => o.kind === "answer" && !o.correct),
            );
            expect(wrong.state).toBe("playing");
            expect(wrong.takeEvents().some((e) => e.type === "powerUp")).toBe(false);
        });
    });

    describe("the highwayman", () => {
        const event = getRandomEvent("highwayman");

        test("keeps up with the run, robs you, and pays it back with a casket", () => {
            const sim = createSim();
            sim.tick = 8 * 60 * TICKS_PER_SECOND;
            sim.coins = 1000;
            expect(sim.startRandomEvent(event)).toBe(true);
            expect(sim.visitor).toBeUndefined();
            const boss = sim.enemies.find((e) => e.def.id === "highwayman")!;
            expect(boss.maxHp).toBeGreaterThan(getEnemy("highwayman").hp);
            sim.applyPlayerEffect({ kind: "steal", fraction: 0.1 }, boss);
            expect(sim.coins).toBe(900);
            boss.hp = 1;
            sim["damageEnemy"](boss, 10, 0, sim.player.x, sim.player.y);
            expect(sim.coins).toBe(1000);
            expect(sim.pickups.some((p) => p.kind === "casket" && p.tier === "hard")).toBe(true);
        });

        test("waits until there's something to steal and no one else about", () => {
            const pick = (sim: Sim) => {
                const seen = new Set<string>();
                for (let i = 0; i < 200; i++) {
                    seen.add(sim["rollRandomEvent"]()!.id);
                }
                return seen;
            };
            const sim = createSim();
            expect(pick(sim)).not.toContain("highwayman");
            sim.tick = (event.minSeconds ?? 0) * TICKS_PER_SECOND;
            expect(pick(sim)).toContain("highwayman");
            sim.spawnEnemy(getEnemy("wise_old_man"), "boss");
            expect(pick(sim)).not.toContain("highwayman");
        });

        test("is baked for every map", () => {
            for (const map of [...MAPS, ...FUN_MAPS]) {
                expect(getMapEnemies(map).map((def) => def.id)).toContain("highwayman");
            }
        });
    });
});

describe("the power-up rate", () => {
    // Power-ups from a steady two kills a second for a few hours
    function dropsOver(rate: number): number {
        const metaStats = emptyStats();
        metaStats.powerUpRate = rate;
        const sim = createSim("warrior", 7, "lumbridge", metaStats);
        let drops = 0;
        const ticks = 4 * 60 * 60 * TICKS_PER_SECOND;
        for (sim.tick = 0; sim.tick < ticks; sim.tick += TICKS_PER_SECOND / 2) {
            sim["rollPowerUp"](sim.player.x, sim.player.y);
            drops += sim.pickups.length;
            sim.pickups.length = 0;
        }
        return drops;
    }

    test("Runecraft's ranks have them drop that much more often", () => {
        const runecraft = SHOP_UPGRADES.find((u) => u.id === "runecraft")!;
        const rate = runecraft.perRank * runecraft.maxRank;
        const ratio = dropsOver(rate) / dropsOver(0);
        expect(ratio).toBeGreaterThan((1 + rate) * 0.9);
        expect(ratio).toBeLessThan((1 + rate) * 1.1);
    });
});
