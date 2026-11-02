import { getPartyScale } from "../content/coop";
import { getEnemy } from "../content/enemies";
import { HARD_XP, getHardScale } from "../content/hard";
import { getMap } from "../content/maps";
import { getPowerUp } from "../content/powerups";
import { getRandomEvent } from "../content/randomEvents";
import { emptyStats } from "../content/types";
import { getWeapon } from "../content/weapons";
import { HeroOptions, Sim, TICKS_PER_SECOND } from "./Sim";
import { fm, usePortableMath } from "./fmath";
import { applyFrameEvent, syncHash } from "./lockstep";
import { makeGrid } from "./world/testGrid";

function openField(): string[] {
    const size = 72;
    const rows: string[] = [];
    for (let y = 0; y < size; y++) {
        let row = "";
        for (let x = 0; x < size; x++) {
            const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
            row += edge ? "#" : ".";
        }
        rows.push(row);
    }
    return rows;
}

function hero(characterId: string, name = characterId): HeroOptions {
    return { name, characterId, metaStats: emptyStats() };
}

function createParty(characters: string[], seed = 1, focus = 0, hard = false): Sim {
    return new Sim({
        grid: makeGrid(openField(), 1000, 1000),
        characterId: "",
        metaStats: emptyStats(),
        seed,
        spawnX: 1036.5,
        spawnY: 1036.5,
        party: characters.map((id) => hero(id)),
        focus,
        hard,
    });
}

// Plays both heroes round in circles, everyone taking their first choice
function play(sim: Sim, ticks: number): void {
    for (let i = 0; i < ticks && !sim.runOver; i++) {
        for (const h of sim.heroes) {
            if (h.pendingLevelUps > 0) {
                sim.as(h.index, () => sim.choose(0));
            }
            if (h.chests.length > 0) {
                sim.as(h.index, () => sim.resolveChest("take"));
            }
            if (sim.offer?.hero === h.index) {
                sim.as(h.index, () => sim.leaveEvent());
            }
            const angle = (sim.tick / TICKS_PER_SECOND) * 0.8 + h.index;
            sim.setInput(h.index, fm.cos(angle), fm.sin(angle));
        }
        sim.step();
        sim.takeEvents();
    }
}

// What two copies of a run have to agree on
function fingerprint(sim: Sim): string {
    return JSON.stringify({
        tick: sim.tick,
        xp: sim.xp,
        kills: sim.kills,
        coins: sim.coins,
        state: sim.state,
        heroes: sim.heroes.map((h) => [h.player.x, h.player.y, h.player.hp, h.weapons.length]),
        enemies: sim.enemies.map((e) => [e.uid, e.x, e.y, e.hp]),
    });
}

describe("co-op", () => {
    afterEach(() => usePortableMath(false));

    it("gives each player a hero of their own, apart at the start", () => {
        const sim = createParty(["warrior", "wizard"]);
        expect(sim.heroes).toHaveLength(2);
        const [a, b] = sim.heroes;
        expect(a.weapons[0].def.id).not.toBe(b.weapons[0].def.id);
        expect(Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y)).toBeGreaterThan(1);
        // The fields read the focus hero's
        expect(sim.player).toBe(a.player);
        expect(createParty(["warrior", "wizard"], 1, 1).player).not.toBe(a.player);
    });

    it("keeps each player's own runes going round when they share the weapon", () => {
        const sim = createParty(["seer", "seer"]);
        const [a, b] = sim.heroes;
        const runes = (index: number) => sim.projectiles.filter((p) => p.orbit && p.hero === index);
        // Cast on the same tick
        a.weapons[0].cooldown = b.weapons[0].cooldown = 0;
        sim.step();
        expect(runes(0).length).toBeGreaterThan(0);
        expect(runes(1).length).toBeGreaterThan(0);
        // Used again by one of them, only that one's are replaced
        const before = runes(0);
        const others = runes(1);
        b.weapons[0].cooldown = 1e9;
        a.weapons[0].cooldown = 0;
        sim.step();
        expect(runes(0).some((p) => before.includes(p))).toBe(false);
        expect(runes(1)).toEqual(others);
    });

    it("has enemies go for whoever's nearest", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        b.player.x = b.player.prevX = a.player.x + 20;
        const enemy = sim.spawnEnemy(getEnemy("goblin"), "normal", {
            x: b.player.x + 4,
            y: b.player.y,
        })!;
        const start = Math.hypot(enemy.x - b.player.x, enemy.y - b.player.y);
        for (let i = 0; i < 25; i++) {
            sim.step();
        }
        expect(Math.hypot(enemy.x - b.player.x, enemy.y - b.player.y)).toBeLessThan(start);
    });

    it("waits for everyone's level up, each with their own choices", () => {
        const sim = createParty(["warrior", "wizard"]);
        sim.xp = 1e4;
        sim.step();
        expect(sim.state).toBe("levelUp");
        const [a, b] = sim.heroes;
        expect(a.choices.length).toBeGreaterThan(0);
        expect(b.choices.length).toBeGreaterThan(0);
        expect(a.pendingLevelUps).toBe(b.pendingLevelUps);
        while (a.pendingLevelUps > 0) {
            sim.as(0, () => sim.choose(0));
        }
        expect(sim.state).toBe("levelUp");
        expect(sim.waitingOn).toEqual([b]);
        while (b.pendingLevelUps > 0) {
            sim.as(1, () => sim.choose(0));
        }
        expect(sim.state).toBe("playing");
    });

    it("carries on while anyone's up, and the fallen stay down", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        b.revivesLeft = 0;
        b.player.hp = 1;
        b.player.poisonDamage = 5;
        b.player.poisonEnd = sim.tick + TICKS_PER_SECOND + 1;
        for (let i = 0; i < TICKS_PER_SECOND + 2; i++) {
            sim.step();
        }
        expect(b.down).toBe(true);
        expect(sim.runOver).toBe(false);
        expect(sim.takeEvents().some((e) => e.type === "heroDown" && e.hero === 1)).toBe(true);
        // Standing over them doesn't bring them back
        a.player.x = b.player.x + 0.5;
        a.player.y = b.player.y;
        for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
            sim.step();
        }
        expect(b.down).toBe(true);
        expect(b.player.hp).toBe(0);
    });

    it("gives a ring of life's revive before going down", () => {
        const sim = createParty(["warrior", "wizard"]);
        const b = sim.heroes[1];
        b.revivesLeft = 1;
        b.player.hp = 1;
        b.player.poisonDamage = 5;
        b.player.poisonEnd = sim.tick + TICKS_PER_SECOND + 1;
        for (let i = 0; i < TICKS_PER_SECOND + 2; i++) {
            sim.step();
        }
        expect(b.down).toBe(false);
        expect(b.revivesLeft).toBe(0);
        expect(b.player.hp).toBe(b.player.maxHp);
    });

    it("keeps a win from a hit on anyone later in the tick", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        a.revivesLeft = 1;
        const boss = sim.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        sim.as(1, () => sim.damageEnemy(boss, 1e9, 0, b.player.x, b.player.y));
        expect(sim.state).toBe("victory");
        sim.as(0, () => sim["damagePlayer"](99999, "goblin", false));
        expect(sim.state).toBe("victory");
        expect(a.down).toBe(false);
        expect(a.revivesLeft).toBe(1);
    });

    it("wins with the final boss falling in the tick the last player does", () => {
        const sim = createParty(["warrior", "wizard"]);
        const boss = sim.spawnEnemy(getEnemy("wise_old_man"), "finalBoss", {
            x: 1040.5,
            y: 1036.5,
        })!;
        for (const h of sim.heroes) {
            h.revivesLeft = 0;
        }
        sim.as(1, () => sim["damagePlayer"](99999, "goblin", false));
        expect(sim.runOver).toBe(false);
        sim.as(0, () => sim["damagePlayer"](99999, "goblin", false));
        expect(sim.state).toBe("dead");
        // What the first to fall left behind (a projectile, a thrall) gets it
        sim.as(1, () => sim.damageEnemy(boss, 1e9, 0, boss.x, boss.y));
        expect(sim.state).toBe("victory");
    });

    it("ends the run when everyone's down or gone", () => {
        const sim = createParty(["warrior", "wizard"]);
        sim.leave(1);
        expect(sim.heroes[1].left).toBe(true);
        expect(sim.runOver).toBe(false);
        sim.leave(0);
        expect(sim.state).toBe("dead");
    });

    it("doesn't wait on a downed player's level ups", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        b.revivesLeft = 0;
        b.player.hp = 1;
        b.player.poisonDamage = 5;
        b.player.poisonEnd = sim.tick + TICKS_PER_SECOND + 1;
        for (let i = 0; i < TICKS_PER_SECOND + 2; i++) {
            sim.step();
        }
        expect(b.down).toBe(true);
        sim.xp = 1e4;
        sim.step();
        expect(sim.waitingOn).toEqual([a]);
        expect(b.choices).toEqual([]);
        // Choosing does nothing for them
        const weapons = b.weapons.length;
        sim.as(1, () => sim.choose(0));
        expect(b.weapons).toHaveLength(weapons);
        while (a.pendingLevelUps > 0) {
            sim.as(0, () => sim.choose(0));
        }
        expect(sim.state).toBe("playing");
    });

    it("doesn't let a downed player reroll or skip a level up", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        b.revivesLeft = 0;
        b.player.hp = 1;
        b.player.poisonDamage = 5;
        b.player.poisonEnd = sim.tick + TICKS_PER_SECOND + 1;
        for (let i = 0; i < TICKS_PER_SECOND + 2; i++) {
            sim.step();
        }
        expect(b.down).toBe(true);
        sim.xp = 1e4;
        sim.step();
        expect(sim.state).toBe("levelUp");
        expect(b.pendingLevelUps).toBeGreaterThan(0);
        sim.coins = 1000;
        const rerolls = b.rerollsLeft;
        expect(rerolls).toBeGreaterThan(0);
        expect(sim.as(1, () => sim.reroll())).toBe(false);
        expect(sim.as(1, () => sim.canSkip)).toBe(false);
        expect(sim.as(1, () => sim.skip())).toBe(false);
        // Nor as a guest's actions, over the network
        applyFrameEvent(sim, { frame: sim.tick, hero: 1, action: { kind: "reroll" } });
        applyFrameEvent(sim, { frame: sim.tick, hero: 1, action: { kind: "skip" } });
        expect(b.choices).toEqual([]);
        expect(b.rerollsLeft).toBe(rerolls);
        expect(b.skips).toBe(0);
        expect(sim.coins).toBe(1000);
        // The player who's up still can
        expect(sim.as(0, () => sim.reroll())).toBe(true);
        expect(sim.as(0, () => sim.skip())).toBe(true);
        expect(a.skips).toBe(1);
        expect(sim.coins).toBeLessThan(1000);
    });

    it("doesn't wait on a player who left", () => {
        const sim = createParty(["warrior", "wizard"]);
        sim.xp = 1e4;
        sim.step();
        while (sim.heroes[0].pendingLevelUps > 0) {
            sim.as(0, () => sim.choose(0));
        }
        expect(sim.state).toBe("levelUp");
        sim.leave(1);
        expect(sim.state).toBe("playing");
    });

    it("has a visitor's offer chosen by whoever met them, the rest waiting", () => {
        const sim = createParty(["warrior", "wizard", "ranger"]);
        expect(sim.startRandomEvent(getRandomEvent("mysterious_old_man"))).toBe(true);
        const visitor = sim.visitor!;
        for (const h of sim.heroes) {
            h.player.x = visitor.x + 10;
        }
        sim.heroes[1].player.x = visitor.x + 0.5;
        sim.heroes[1].player.y = visitor.y;
        sim.step();
        expect(sim.state).toBe("event");
        expect(sim.offer?.hero).toBe(1);
        expect(sim.waitingOn.map((h) => h.index)).toEqual([1]);
        // Nobody else can buy or walk away for them
        sim.coins = 1e6;
        expect(sim.as(0, () => sim.chooseEventOption(0))).toBe(false);
        sim.as(2, () => sim.leaveEvent());
        expect(sim.state).toBe("event");
        // Leaving the party walks away from it
        sim.leave(1);
        expect(sim.offer).toBeUndefined();
        expect(sim.state).toBe("playing");
    });

    it("rolls a level up that was waiting behind an offer whose player left", () => {
        const sim = createParty(["warrior", "wizard"]);
        expect(sim.startRandomEvent(getRandomEvent("mysterious_old_man"))).toBe(true);
        const visitor = sim.visitor!;
        sim.heroes[0].player.x = visitor.x + 10;
        sim.heroes[1].player.x = visitor.x + 0.5;
        sim.heroes[1].player.y = visitor.y;
        sim.step();
        expect(sim.offer?.hero).toBe(1);
        // A level up that came in while the offer was open
        sim.heroes[0].pendingLevelUps = 1;
        sim.leave(1);
        expect(sim.state).toBe("levelUp");
        expect(sim.heroes[0].choices.length).toBeGreaterThan(0);
    });

    it("tags a hero's own events with who they're about", () => {
        const sim = createParty(["warrior", "wizard"]);
        sim.dropPickup("coins", sim.heroes[1].player.x, sim.heroes[1].player.y, 5);
        sim.step();
        const pickup = sim.takeEvents().find((e) => e.type === "pickup");
        expect(pickup?.hero).toBe(1);
    });

    it("ends only its own player's timer when a rampage is over", () => {
        const sim = createParty(["warrior", "wizard"]);
        const bob = getPowerUp("evil_bob");
        for (const h of sim.heroes) {
            h.weapons = [];
            h.player.invulnerable = 1e6;
        }
        // Both charge on until their time is up, when the first one's own
        // timer has already gone
        sim.as(0, () => sim.usePowerUp(bob));
        const first = sim.rampages[0];
        first.passesLeft = 100;
        play(sim, TICKS_PER_SECOND);
        sim.as(1, () => sim.usePowerUp(bob));
        sim.rampages.find((r) => r.hero === 1)!.passesLeft = 100;
        const theirs = sim.powerUps.find((p) => p.hero === 1)!;
        const end = theirs.endTick;
        for (let i = 0; i < 20 * TICKS_PER_SECOND && first.doneTick === -1; i++) {
            play(sim, 1);
        }
        expect(first.doneTick).not.toBe(-1);
        play(sim, 2);
        expect(sim.powerUps).toContain(theirs);
        expect(theirs.endTick).toBe(end);
    });

    it("keeps each player's burning ground their own", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        const def = getWeapon("toktz_mej_tal");
        const burn = (index: number) =>
            sim.as(index, () =>
                (sim as unknown as Record<string, Function>).burnGround(def.burns, def.levels[0]),
            );
        b.player.x = a.player.x;
        b.player.y = a.player.y;
        burn(0);
        const mine = sim.fires[0];
        // A pulse on someone else's fire lights one of their own, rather
        // than feeding (and being credited to) the other's
        burn(1);
        expect(sim.fires.map((fire) => fire.hero)).toEqual([0, 1]);
        const theirs = sim.fires[1];
        // Their fires going out for room are their own oldest
        for (let i = 1; sim.fires.includes(theirs) && i < 10; i++) {
            b.player.x = a.player.x + i * 3;
            burn(1);
        }
        expect(sim.fires).not.toContain(theirs);
        expect(sim.fires).toContain(mine);
    });

    it("makes the crowd bigger and tougher for each player", () => {
        expect(getPartyScale(1)).toEqual({
            crowd: 1,
            hp: 1,
            bossHp: 1,
            damage: 1,
            xp: 1,
            caskets: 1,
        });
        const two = getPartyScale(2);
        expect(two.crowd).toBeGreaterThan(1);
        expect(getPartyScale(4).hp).toBeGreaterThan(two.hp);
        // Bosses keep up with a party's damage (about a player's worth each)
        expect(getPartyScale(4).bossHp).toBeGreaterThanOrEqual(4);
        const solo = createParty(["warrior"]);
        const duo = createParty(["warrior", "wizard"]);
        const goblin = getEnemy("goblin");
        const alone = solo.spawnEnemy(goblin, "normal")!;
        const together = duo.spawnEnemy(goblin, "normal")!;
        expect(together.maxHp).toBeGreaterThan(alone.maxHp);
        expect(together.damage).toBeGreaterThanOrEqual(alone.damage);
        expect(together.damageScale).toBeGreaterThan(alone.damageScale);
        // A bigger crowd's bones are worth a little less each
        expect(together.xp).toBeLessThan(alone.xp);
    });

    it("has a boss's pools and bullets land on each of the party, and curse just one", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        b.player.x = a.player.x + 6;
        b.player.y = a.player.y;
        const pool = { enemyId: "goblin", radius: 1, damage: 5, interval: 50, locId: -1 };
        sim.pools = [a, b].map((h, i) => ({
            ...pool,
            uid: i,
            x: h.player.x,
            y: h.player.y,
            startTick: 0,
            endTick: 1000,
            nextTick: 0,
        }));
        sim.step();
        expect(a.player.hp).toBeLessThan(a.player.maxHp);
        expect(b.player.hp).toBeLessThan(b.player.maxHp);

        const bullets = sim.bullets;
        sim.bulletSources.push({
            attack: getEnemy("the_nightmare").boss!.attacks[0],
            enemy: sim.spawnEnemy(getEnemy("goblin"), "normal")!,
        });
        sim.pools = [];
        a.player.invulnerable = b.player.invulnerable = 0;
        const before = [a.player.hp, b.player.hp];
        for (const h of [a, b]) {
            bullets.add(h.player.x, h.player.y, 0, 0, 0, 0.3, 4, 10, 0, sim.tick);
        }
        sim.step();
        expect(a.player.hp).toBeLessThan(before[0]);
        expect(b.player.hp).toBeLessThan(before[1]);

        sim.takeEvents();
        sim.as(1, () => sim.applyPlayerEffect({ kind: "curse", attacks: 3 }));
        expect(b.curse).toBeDefined();
        expect(a.curse).toBeUndefined();
        expect(sim.takeEvents().find((e) => e.type === "playerCursed")?.hero).toBe(1);
    });

    it("has the blast once a boss's walkers are in land on the whole party", () => {
        const sim = createParty(["warrior", "wizard"]);
        const [a, b] = sim.heroes;
        b.player.x = a.player.x + 20;
        const nightmare = getEnemy("the_nightmare");
        const boss = sim.spawnEnemy(nightmare, "boss")!;
        const attack = nightmare.boss!.attacks.find((attack) => attack.summon?.walkTo)!;
        const blast = { attack, enemies: [], absorbed: 2, perAbsorbed: 1 };
        sim.as(0, () => (sim as unknown as Record<string, Function>).stepWalkers(boss, blast));
        expect(a.player.hp).toBeLessThan(a.player.maxHp);
        expect(b.player.hp).toBeLessThan(b.player.maxHp);
    });

    it("scales the crowd down when a player goes, though not all the way", () => {
        const duo = createParty(["warrior", "wizard"]);
        const goblin = getEnemy("goblin");
        const before = duo.spawnEnemy(goblin, "normal")!;
        duo.leave(1);
        const after = duo.spawnEnemy(goblin, "normal")!;
        const solo = createParty(["warrior"]).spawnEnemy(goblin, "normal")!;
        expect(after.maxHp).toBeLessThan(before.maxHp);
        expect(after.maxHp).toBeGreaterThan(solo.maxHp);
    });

    it("tells apart copies that picked different rewards", () => {
        const picks = [0, 1].map((index) => {
            const sim = createParty(["warrior", "wizard"], 4);
            sim.xp = 100;
            sim.step();
            sim.as(0, () => sim.choose(index));
            return sim;
        });
        expect(picks[0].heroes[0].choices).toEqual(picks[1].heroes[0].choices);
        expect(syncHash(picks[0])).not.toBe(syncHash(picks[1]));
    });

    it("plays out the same on every player's copy", () => {
        usePortableMath(true);
        const host = createParty(["warrior", "wizard", "ranger"], 9, 0);
        const guest = createParty(["warrior", "wizard", "ranger"], 9, 2);
        play(host, 90 * TICKS_PER_SECOND);
        play(guest, 90 * TICKS_PER_SECOND);
        expect(host.kills).toBeGreaterThan(0);
        expect(fingerprint(guest)).toBe(fingerprint(host));
    }, 30000);

    it("plays out the same on every player's copy on hard mode too", () => {
        usePortableMath(true);
        const host = createParty(["warrior", "wizard", "ranger"], 9, 0, true);
        const guest = createParty(["warrior", "wizard", "ranger"], 9, 2, true);
        play(host, 90 * TICKS_PER_SECOND);
        play(guest, 90 * TICKS_PER_SECOND);
        expect(host.hard).toBe(true);
        expect(host.kills).toBeGreaterThan(0);
        expect(fingerprint(guest)).toBe(fingerprint(host));
        // And it's not the same run as one that isn't on hard mode
        const normal = createParty(["warrior", "wizard", "ranger"], 9, 0);
        play(normal, 90 * TICKS_PER_SECOND);
        expect(fingerprint(normal)).not.toBe(fingerprint(host));
    }, 30000);

    it("puts hard mode's numbers on top of the party's", () => {
        const party = getPartyScale(2);
        const scale = getHardScale(getMap("lumbridge"));
        const goblin = getEnemy("goblin");
        const spot = { x: 1040.5, y: 1036.5 };
        const spawn = (characters: string[], hard: boolean) => {
            const sim = createParty(characters, 1, 0, hard);
            // Long enough for the party's experience to be worked out from the crowd
            sim.step();
            return sim.spawnEnemy(goblin, "normal", spot)!;
        };
        const alone = spawn(["warrior"], false);
        const duo = spawn(["warrior", "wizard"], true);
        expect(duo.maxHp / alone.maxHp).toBeCloseTo(party.hp * scale.hp, 0);
        expect(duo.damageScale).toBeCloseTo(alone.damageScale * party.damage * scale.damage);
        expect(duo.xp).toBeCloseTo(alone.xp * party.xp * HARD_XP);
    });
});

describe("portable math", () => {
    afterEach(() => usePortableMath(false));

    it("is as good as the browser's", () => {
        usePortableMath(true);
        for (let i = -2000; i <= 2000; i++) {
            const x = i * 0.0731;
            expect(fm.sin(x)).toBeCloseTo(Math.sin(x), 13);
            expect(fm.cos(x)).toBeCloseTo(Math.cos(x), 13);
            const y = (i % 37) - 18.3;
            expect(fm.atan2(y, x)).toBeCloseTo(Math.atan2(y, x), 13);
            expect(fm.hypot(x, y)).toBeCloseTo(Math.hypot(x, y), 12);
        }
        for (let i = -100; i <= 100; i++) {
            expect(fm.acos(i / 100)).toBeCloseTo(Math.acos(i / 100), 7);
        }
        expect(fm.atan2(0, -1)).toBeCloseTo(Math.PI, 15);
        expect(fm.atan2(1, 0)).toBeCloseTo(Math.PI / 2, 15);
        expect(fm.pow(3.3, 4)).toBeCloseTo(3.3 ** 4, 12);
        expect(fm.pow(2, -2)).toBe(0.25);
    });
});
