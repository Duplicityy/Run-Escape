// Plays runs with a simple bot on the real arena (collision from a snapshot of
// the cache, see collision-snapshot.ts) and prints how they go, for balancing waves, weapons and the XP curve.
//
//   npx tsx scripts/game/simulate-run.ts                 # every character once
//   npx tsx scripts/game/simulate-run.ts wizard 3        # one character, 3 seeds
//   npx tsx scripts/game/simulate-run.ts "" 2 5          # everyone, 2 seeds, 5 minutes
//   MAP=barrows npx tsx scripts/game/simulate-run.ts     # another map (Lumbridge by default)
//   UNLOCKS=none npx tsx scripts/game/simulate-run.ts    # nothing from map tasks (all by default)
//   META=max npx tsx scripts/game/simulate-run.ts        # every shop upgrade bought (none by default)
//   ARMOURY=max npx tsx scripts/game/simulate-run.ts     # all gear upgraded in the Armoury (none by default)
//   ENDLESS=1 npx tsx scripts/game/simulate-run.ts       # an endless run (up to 90 minutes)
//   HARD=1 npx tsx scripts/game/simulate-run.ts          # on hard mode
//   WEAPON=crystal_bow npx tsx scripts/game/simulate-run.ts ranger  # start with this weapon instead
//   FINAL_BOSS=the_nightmare BOSS_ARENA=48 npx tsx ...   # another final boss, on a square of the map
//   FRESH=1 ...                                          # straight to it with nothing upgraded
//   DODGE=1 ...     # also keeps off what a phased boss marks on the ground, and sidesteps bullets
//   FLAT=1 ...      # the map's arena with nothing in it, as the bot walks straight into walls
//   SAFE_WAVES=1 ... # can't die before the final boss: it gets there with what the run earned
//   GOD=1 ...        # can't die at all: with ENDLESS=1, how damage keeps up with the rounds
//   FUNNEL=1 ...     # always takes its best weapon's next level when it's offered
import { getUpgradeLine } from "../../src/game/content/armoury";
import { CHARACTERS } from "../../src/game/content/characters";
import { getEnemy } from "../../src/game/content/enemies";
import { CASKET_GEAR, getGear, getItem } from "../../src/game/content/items";
import { getMap } from "../../src/game/content/maps";
import { RARITY_ORDER } from "../../src/game/content/rarity";
import { SHOP_UPGRADES } from "../../src/game/content/shop";
import { emptyStats } from "../../src/game/content/types";
import { RUN_LENGTH } from "../../src/game/content/waves";
import { ChestAction, shouldWear } from "../../src/game/core/Loot";
import { Sim, TICKS_PER_SECOND } from "../../src/game/core/Sim";
import { UpgradeChoice } from "../../src/game/core/Upgrades";
import { SimEvent } from "../../src/game/core/entities";
import { ArenaGrid } from "../../src/game/core/world/ArenaGrid";
import { makeGrid } from "../../src/game/core/world/testGrid";
import { loadRegionData } from "./collision-snapshot";

const [characterArg, seedsArg, minutesArg] = process.argv.slice(2);
const characters = characterArg ? [characterArg] : CHARACTERS.map((c) => c.id);
const seeds = parseInt(seedsArg ?? "1");
// How often to print progress (REPORT=15 for every 15 seconds)
const REPORT_SECONDS = parseInt(process.env.REPORT ?? "60");

const map = getMap(process.env.MAP ?? "lumbridge");
const endless = process.env.ENDLESS === "1";
const hard = process.env.HARD === "1";
// The weapons, passives and items brought in by map tasks: all of them, or none
const unlockedItems = process.env.UNLOCKS === "none" ? new Set<string>() : undefined;
// The shop's permanent upgrades: none, or all of them, as a player has by the
// later maps
const metaStats = emptyStats();
if (process.env.META === "max") {
    for (const upgrade of SHOP_UPGRADES) {
        metaStats[upgrade.stat] += upgrade.perRank * upgrade.maxRank;
    }
}
// The Armoury's upgrades: none, or every piece as far as it goes
const armoury =
    process.env.ARMOURY === "max"
        ? Object.fromEntries(CASKET_GEAR.map((g) => [g.id, getUpgradeLine(g.id).length - 1]))
        : undefined;
const ARENA = map.arena;
// Her map's not on every branch, so she can be tried on any map, in a square
// around its spawn
const finalBoss = process.env.FINAL_BOSS;
const fresh = process.env.FRESH === "1";
const dodges = process.env.DODGE === "1";
// A co-op party of this many of the adventurer, each played by the bot on its
// own (it doesn't play as a team: no regrouping, no waiting for the others)
const partySize = parseInt(process.env.PARTY ?? "1");
if (finalBoss) {
    map.events = map.events.map((e) =>
        e.kind === "finalBoss" ? { at: e.at, kind: e.kind, enemyId: finalBoss, hp: e.hp } : e,
    );
    const size = parseInt(process.env.BOSS_ARENA ?? "0");
    if (size > 0) {
        map.bossArena = {
            baseX: Math.round(map.spawn.x - size / 2),
            baseY: Math.round(map.spawn.y - size / 2),
            size,
        };
    }
}
console.time(`${map.name} arena`);
const grid =
    process.env.FLAT === "1"
        ? makeGrid(new Array(ARENA.sizeY).fill(".".repeat(ARENA.sizeX)), ARENA.baseX, ARENA.baseY)
        : new ArenaGrid(loadRegionData(map));
console.timeEnd(`${map.name} arena`);

// Like a person might: take evolutions, fill the weapon slots, then upgrade;
// between two of the same kind, the rarer roll
const CHOICE_PRIORITY: Record<UpgradeChoice["kind"], number> = {
    evolve: 0,
    // Only ever offered on their own
    hilt: 0,
    newWeapon: 1,
    weaponLevel: 2,
    newPassive: 3,
    passiveLevel: 4,
    food: 5,
    coins: 6,
};

function choiceScore(choice: UpgradeChoice): number {
    const quality = "quality" in choice ? RARITY_ORDER.indexOf(choice.quality) : 0;
    // A Rare or better roll beats a Common pick of a better kind
    return CHOICE_PRIORITY[choice.kind] * 10 - quality * 15;
}

// Wears gear unless what's worn is better (counting sets, like the casket's
// advice), keeps utility items when they fit
function chestAction(sim: Sim): ChestAction {
    const chest = sim.chest!;
    const item = getItem(chest.itemId);
    if (item.kind === "utility") {
        return sim.canStash(item.id) ? "take" : "use";
    }
    return shouldWear(sim.gear, sim.gearUpgrades, item, chest.upgrades) ? "take" : "alch";
}

// Runs a set was started in (a piece worn), and finished in (its bonus), for
// the summary at the end
const setsStarted = new Map<string, number>();
const setsFinished = new Map<string, number>();
let runs = 0;

// Eats when hurt, throws chinchompas into crowds, drinks antidotes when
// poisoned or drained, uses everything else straight away
function useItems(sim: Sim): void {
    const player = sim.player;
    let near = 0;
    for (const enemy of sim.enemies) {
        if (!enemy.dead && Math.hypot(enemy.x - player.x, enemy.y - player.y) < 5) {
            near++;
        }
    }
    sim.inventory.forEach((slot, index) => {
        const item = slot && getItem(slot.itemId);
        if (!item || item.kind !== "utility") {
            return;
        }
        const use = item.use.kind;
        if (
            (use === "heal" && player.hp < player.maxHp * 0.5) ||
            (use === "blast" && near >= 15) ||
            (use === "cure" && (player.poisonEnd !== -1 || sim.debuffs.length > 0)) ||
            use === "buff" ||
            use === "bones" ||
            use === "xp"
        ) {
            sim.useItem(index);
        }
    });
}

// Steers away from nearby enemies (closer counts more) and towards bones when
// nothing is close; slides along walls by trying a few nearby directions.
function botMove(sim: Sim): { x: number; y: number } {
    const player = sim.player;
    let ax = 0;
    let ay = 0;
    let threat = 0;
    for (const enemy of sim.enemies) {
        if (enemy.dead) {
            continue;
        }
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < (enemy.boss ? 144 : 64)) {
            // A person keeps well away from the boss
            const w = (enemy.boss ? 8 : 1) / Math.max(distSq, 0.25);
            ax += dx * w;
            ay += dy * w;
            threat += w;
        }
    }
    // Bones nearby are worth a detour unless enemies are right on top, and
    // power-ups and random events' visitors twice as far
    let best = Infinity;
    let bx = 0;
    let by = 0;
    if (sim.visitor) {
        bx = sim.visitor.x - player.x;
        by = sim.visitor.y - player.y;
        best = (bx * bx + by * by) / 4;
    }
    for (const pickup of sim.pickups) {
        const dx = pickup.x - player.x;
        const dy = pickup.y - player.y;
        const d = (dx * dx + dy * dy) / (pickup.kind === "powerUp" ? 4 : 1);
        if (d < best && d < 144) {
            best = d;
            bx = dx;
            by = dy;
        }
    }
    if (best < Infinity) {
        const len = Math.hypot(bx, by);
        const pull = threat < 0.08 ? 1 : 0.6 / (1 + threat * 4);
        ax += (bx / len) * pull;
        ay += (by / len) * pull;
    }
    // Drift back towards the middle of the arena so the bot doesn't pin itself
    // against its edge
    const cx = ARENA.baseX + ARENA.sizeX / 2 - player.x;
    const cy = ARENA.baseY + ARENA.sizeY / 2 - player.y;
    ax += cx * 0.002;
    ay += cy * 0.002;
    const len = Math.hypot(ax, ay);
    if (len < 1e-6) {
        return { x: 0, y: 0 };
    }
    return { x: ax / len, y: ay / len };
}

// A phased boss's fight, as a careful person plays it, or undefined outside one.
// Without DODGE it only goes where the fight needs it to: the totems and the
// sleepwalkers, without which it can't be won at all.
function fightMove(sim: Sim): { x: number; y: number } | undefined {
    const boss = sim.shownBoss;
    const state = boss?.bossState;
    const phase = state?.phase;
    if (!boss || !state || !phase || boss.dead) {
        return undefined;
    }
    const player = sim.player;
    const towards = (x: number, y: number) => {
        const length = Math.max(0.001, Math.hypot(x - player.x, y - player.y));
        return { x: (x - player.x) / length, y: (y - player.y) / length };
    };
    if (dodges) {
        const lane = state.windup?.lane ?? state.surge?.lane;
        if (lane) {
            const dx = lane.toX - lane.fromX;
            const dy = lane.toY - lane.fromY;
            const length = Math.max(0.001, Math.hypot(dx, dy));
            const across = ((player.x - lane.fromX) * dy - (player.y - lane.fromY) * dx) / length;
            if (Math.abs(across) < lane.halfWidth + 1) {
                const side = across >= 0 ? 1 : -1;
                return { x: (dy / length) * side, y: (-dx / length) * side };
            }
        }
        const quarters = sim.quarters;
        if (quarters) {
            return towards(
                quarters.x + (quarters.safe & 1 ? 3 : -3),
                quarters.y + (quarters.safe & 2 ? 3 : -3),
            );
        }
        // Sidesteps what's about to reach it, the nearer the more. A person reads
        // the arms of a spiral far sooner than this does.
        let awayX = 0;
        let awayY = 0;
        const { bullets } = sim;
        for (let i = 0; i < bullets.count; i++) {
            const slot = bullets.order[i];
            const dx = player.x - bullets.x[slot];
            const dy = player.y - bullets.y[slot];
            const distSq = dx * dx + dy * dy;
            // Only those coming this way
            if (distSq < 9 && dx * bullets.vx[slot] + dy * bullets.vy[slot] > 0) {
                const weight = 1 / Math.max(distSq, 0.1);
                // Across its path, to whichever side it's already nearer
                const side = dx * bullets.vy[slot] - dy * bullets.vx[slot] >= 0 ? 1 : -1;
                awayX += bullets.vy[slot] * side * weight;
                awayY += -bullets.vx[slot] * side * weight;
            }
        }
        if (awayX !== 0 || awayY !== 0) {
            const length = Math.hypot(awayX, awayY);
            return { x: awayX / length, y: awayY / length };
        }
        for (const hazard of sim.hazards) {
            const away = Math.hypot(player.x - hazard.x, player.y - hazard.y);
            if (away < hazard.radius + 1.2) {
                return towards(
                    player.x + (player.x - hazard.x) / Math.max(0.001, away),
                    player.y + (player.y - hazard.y) / Math.max(0.001, away),
                );
            }
        }
    }
    let target: { x: number; y: number } | undefined;
    let nearest = Infinity;
    const consider = (enemy: { x: number; y: number }) => {
        const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        if (distance < nearest) {
            nearest = distance;
            target = enemy;
        }
    };
    if (state.walkers) {
        state.walkers.enemies.filter((e) => !e.dead).forEach(consider);
    } else if (phase.stage === "totems") {
        phase.totems.filter((t) => t.hp > 0).forEach(consider);
    } else if (sim.weapons.every((w) => w.def.kind === "slash" || w.def.kind === "sweep")) {
        // With nothing but melee (the Inquisitor against Phosani's Nightmare) the
        // shield has to be hit from up close, so it walks up to her and takes
        // what comes
        consider(boss);
    }
    if (target) {
        // Close enough for short weapons, then it just stays there
        return nearest < 2 ? { x: 0, y: 0 } : towards(target.x, target.y);
    }
    return undefined;
}

// Works out what to press for a shuffled direction, as a person soon does
function uncursed(sim: Sim, move: { x: number; y: number }): { x: number; y: number } {
    const curse = sim.curse;
    if (!curse) {
        return move;
    }
    // They're all rotations and mirrors, so the inverse is the transpose
    const [a, b, c, d] = curse.matrix;
    return { x: move.x * a + move.y * c, y: move.x * b + move.y * d };
}

// Buys the dearest power-up it can until there's none it can, and knows the
// answer to every question
function eventChoice(sim: Sim): number {
    const options = sim.offer?.options ?? [];
    let best = -1;
    let bestPrice = -1;
    options.forEach((option, index) => {
        if (option.kind === "answer") {
            if (option.correct) {
                best = index;
            }
        } else if (!option.sold && option.price <= sim.coins && option.price > bestPrice) {
            best = index;
            bestPrice = option.price;
        }
    });
    return best;
}

function runOnce(characterId: string, seed: number) {
    const sim = new Sim({
        grid,
        characterId,
        metaStats,
        seed,
        mapId: map.id,
        spawnX: map.spawn.x,
        spawnY: map.spawn.y,
        unlockedItems,
        endless,
        hard,
        armoury,
    });
    // Another weapon to start with, to compare weapons on one character
    if (process.env.WEAPON) {
        sim.weapons = [];
        sim.addWeapon(process.env.WEAPON);
    }
    const maxTicks =
        (minutesArg ? parseFloat(minutesArg) * 60 : endless ? 90 * 60 : RUN_LENGTH + 120) *
        TICKS_PER_SECOND;
    let nextReport = REPORT_SECONDS;
    let stuckTicks = 0;
    let lastX = sim.player.x;
    let lastY = sim.player.y;
    let move = { x: 0, y: 0 };
    let chests = 0;
    let powerUps = 0;
    const started = new Set<string>();
    const finished = new Set<string>();
    const recentHits: { tick: number; event: SimEvent }[] = [];
    const startTime = performance.now();
    if (fresh && finalBoss) {
        sim.startIntro(getEnemy(finalBoss), "finalBoss");
    }
    let fightTicks = 0;
    while (sim.tick < maxTicks && !sim.runOver) {
        if (sim.state === "levelUp") {
            const ranked = sim.choices
                .map((choice, index) => ({ choice, index }))
                .sort((a, b) => choiceScore(a.choice) - choiceScore(b.choice));
            // As a player who's found their weapon: its next level whenever it's offered
            const best =
                process.env.FUNNEL === "1"
                    ? [...sim.weapons].sort((a, b) => b.bonus - a.bonus || b.level - a.level)[0]
                    : undefined;
            const funnel = sim.choices.findIndex(
                (choice) => choice.kind === "weaponLevel" && choice.weaponId === best?.def.id,
            );
            sim.choose(funnel >= 0 ? funnel : ranked[0].index);
            continue;
        }
        if (sim.state === "chest") {
            chests++;
            sim.resolveChest(chestAction(sim));
            for (const itemId of Object.values(sim.gear)) {
                const set = getGear(itemId).set;
                if (set !== undefined) {
                    started.add(set);
                }
            }
            for (const set of sim.activeSets) {
                finished.add(set);
            }
            continue;
        }
        if (sim.state === "event") {
            const choice = eventChoice(sim);
            if (choice === -1 || !sim.chooseEventOption(choice)) {
                sim.leaveEvent();
            }
            continue;
        }
        if (sim.tick % 25 === 0) {
            useItems(sim);
        }
        if (sim.tick % 5 === 0) {
            move = fightMove(sim) ?? botMove(sim);
            // Stuck against a wall: wiggle sideways for a moment
            if (Math.hypot(sim.player.x - lastX, sim.player.y - lastY) < 0.05) {
                stuckTicks += 5;
            } else {
                stuckTicks = 0;
            }
            if (stuckTicks > 15) {
                const side = (sim.tick / 50) % 2 < 1 ? 1 : -1;
                move = { x: -move.y * side, y: move.x * side };
            }
            lastX = sim.player.x;
            lastY = sim.player.y;
        }
        if (process.env.SAFE_WAVES === "1" && !sim.bossSpawned) {
            sim.player.hp = sim.player.maxHp;
        }
        if (process.env.GOD === "1") {
            // Untouchable, as a late endless round's hits are bigger than any health bar
            sim.player.invulnerable = 1e9;
        }
        const pressed = uncursed(sim, move);
        sim.step(pressed.x, pressed.y);
        if (sim.shownBoss?.bossState?.phase) {
            fightTicks++;
        }
        for (const event of sim.takeEvents()) {
            if (event.type === "playerHit") {
                recentHits.push({ tick: sim.tick, event });
            } else if (event.type === "powerUp") {
                powerUps++;
            }
        }
        while (recentHits.length > 0 && recentHits[0].tick < sim.tick - 30 * TICKS_PER_SECOND) {
            recentHits.shift();
        }
        if (sim.seconds >= nextReport) {
            nextReport += REPORT_SECONDS;
            const alive = sim.enemies.filter((e) => !e.dead).length;
            const weapons = sim.weapons.map((w) => `${w.def.id}:${w.level}`).join(" ");
            const passives = sim.passives.map((p) => `${p.id}:${p.level}`).join(" ");
            const gear = Object.values(sim.gear).join(" ");
            console.log(
                `  ${formatClock(sim.seconds)}${endless ? ` r${sim.round}` : ""}  lvl ${String(sim.level).padStart(2)}  ` +
                    `hp ${String(Math.max(0, Math.round(sim.player.hp))).padStart(3)}/${sim.player.maxHp}  ` +
                    `kills ${String(sim.kills).padStart(5)}  alive ${String(alive).padStart(3)}  ` +
                    `coins ${String(sim.coins).padStart(4)}  ${weapons} | ${passives} | ${gear}`,
            );
            if (endless) {
                // How the best weapon's damage keeps up with the round's hitpoints: a
                // ratio that climbs round on round means the player outgrows the run
                const best = Math.max(...sim.weapons.map((w) => 1 + w.bonus));
                console.log(
                    `    best weapon x${best.toExponential(2)}, enemy hp x${sim.roundHp.toExponential(2)}, ` +
                        `ratio ${(best / sim.roundHp).toExponential(2)}`,
                );
            }
        }
    }
    if (sim.state === "dead") {
        // What did the damage in the last 30 seconds
        const byEnemy = new Map<string, number>();
        for (const { event } of recentHits) {
            if (event.type === "playerHit") {
                const key = event.enemyId + (event.elite ? " (elite)" : "");
                byEnemy.set(key, (byEnemy.get(key) ?? 0) + event.amount);
            }
        }
        const sorted = [...byEnemy.entries()].sort((a, b) => b[1] - a[1]);
        console.log(
            "  damage taken in the last 30s: " + sorted.map(([k, v]) => `${k} ${v}`).join(", "),
        );
    }
    const fight = sim.shownBoss?.bossState?.phase;
    if (fightTicks > 0) {
        console.log(
            `  fight: ${(fightTicks / TICKS_PER_SECOND).toFixed(0)}s, ` +
                (fight ? `phase ${fight.index + 1} ${fight.stage}, ` : "") +
                `maxHp ${sim.player.maxHp}, armour ${sim.stats.armor}, ` +
                `taken ${sim.damageTaken}, dps ${Math.round(sim.dps)}`,
        );
        // Which of the boss's attacks did it, over the whole fight
        const byAttack = Object.entries(sim.damageByAttack).sort((a, b) => b[1] - a[1]);
        if (byAttack.length > 0) {
            console.log(
                "  boss attacks that hit: " + byAttack.map(([k, v]) => `${k} ${v}`).join(", "),
            );
        }
    }
    const result = sim.getResult();
    const ms = performance.now() - startTime;
    runs++;
    for (const set of started) {
        setsStarted.set(set, (setsStarted.get(set) ?? 0) + 1);
    }
    for (const set of finished) {
        setsFinished.set(set, (setsFinished.get(set) ?? 0) + 1);
    }
    if (started.size > 0) {
        console.log(
            `  sets: ${[...started].map((s) => s + (finished.has(s) ? " (bonus)" : "")).join(", ")}`,
        );
    }
    console.log(
        `${characterId} seed ${seed}: ${result.victory ? "VICTORY" : sim.state === "dead" ? "died" : "timed out"} at ` +
            `${Math.floor(result.seconds / 60)}:${String(Math.floor(result.seconds % 60)).padStart(2, "0")}, ` +
            (endless ? `round ${result.round}, ` : "") +
            `level ${result.level}, ${result.kills} kills, ${result.coins} coins, ${chests} caskets, ` +
            `${powerUps} power-ups ` +
            `(${(ms / sim.tick).toFixed(3)}ms per tick)`,
    );
    return result;
}

// A co-op run, the bot deciding for each player whenever the run waits on
// them, and moving each as it would on their own
function runParty(characterId: string, seed: number) {
    const sim = new Sim({
        grid,
        characterId,
        metaStats,
        seed,
        mapId: map.id,
        spawnX: map.spawn.x,
        spawnY: map.spawn.y,
        endless,
        hard,
        party: Array.from({ length: partySize }, (_, i) => ({
            name: "bot" + (i + 1),
            characterId,
            metaStats,
            unlockedItems,
            armoury,
        })),
    });
    const maxTicks = (endless ? 90 * 60 : RUN_LENGTH + 120) * TICKS_PER_SECOND;
    const moves = sim.heroes.map(() => ({ x: 0, y: 0 }));
    let firstDown: number | undefined;
    let fightTicks = 0;
    while (sim.tick < maxTicks && !sim.runOver) {
        if (sim.state !== "playing") {
            for (const hero of sim.waitingOn) {
                sim.as(hero.index, () => {
                    if (sim.state === "levelUp") {
                        const ranked = sim.choices
                            .map((choice, index) => ({ choice, index }))
                            .sort((a, b) => choiceScore(a.choice) - choiceScore(b.choice));
                        sim.choose(ranked[0].index);
                    } else if (sim.state === "chest") {
                        sim.resolveChest(chestAction(sim));
                    } else {
                        const choice = eventChoice(sim);
                        if (choice === -1 || !sim.chooseEventOption(choice)) {
                            sim.leaveEvent();
                        }
                    }
                });
            }
            continue;
        }
        for (const hero of sim.heroes) {
            if (hero.down || hero.left) {
                continue;
            }
            sim.as(hero.index, () => {
                if (sim.tick % 25 === 0) {
                    useItems(sim);
                }
                if (sim.tick % 5 === 0) {
                    moves[hero.index] = fightMove(sim) ?? botMove(sim);
                }
                const pressed = uncursed(sim, moves[hero.index]);
                sim.setInput(hero.index, pressed.x, pressed.y);
            });
        }
        sim.step();
        if (sim.shownBoss?.bossState?.phase) {
            fightTicks++;
        }
        for (const event of sim.takeEvents()) {
            if (event.type === "heroDown") {
                firstDown ??= sim.seconds;
            }
        }
    }
    const result = sim.getResult();
    const gear = sim.heroes.map((hero) => Object.keys(hero.gear).length);
    const outcome = result.victory ? "VICTORY" : sim.state === "dead" ? "died" : "timed out";
    runs++;
    console.log(
        characterId +
            " seed " +
            seed +
            " party of " +
            partySize +
            ": " +
            outcome +
            " at " +
            formatClock(result.seconds) +
            ", level " +
            result.level +
            ", " +
            result.kills +
            " kills, first down " +
            (firstDown === undefined ? "never" : formatClock(firstDown)) +
            ", worn gear " +
            (gear.reduce((a, b) => a + b, 0) / gear.length).toFixed(1) +
            " each" +
            (fightTicks > 0 ? ", fight " + (fightTicks / TICKS_PER_SECOND).toFixed(0) + "s" : ""),
    );
}

for (const characterId of characters) {
    for (let seed = 1; seed <= seeds; seed++) {
        if (partySize > 1) {
            runParty(characterId, seed);
            continue;
        }
        console.log(`\n${characterId} seed ${seed}`);
        runOnce(characterId, seed);
    }
}
if (setsStarted.size > 0) {
    const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    console.log(
        `\nSets started in ${runs} runs: ${total(setsStarted)}, finished: ${total(setsFinished)} ` +
            `(${[...setsStarted].map(([set, n]) => `${set} ${setsFinished.get(set) ?? 0}/${n}`).join(", ")})`,
    );
}

function formatClock(seconds: number): string {
    const s = Math.round(seconds);
    return `${String(Math.floor(s / 60)).padStart(2)}:${String(s % 60).padStart(2, "0")}`;
}
