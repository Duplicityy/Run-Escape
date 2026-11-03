import { emptyStats } from "../content/types";
import { HeroOptions, Sim, SimOptions, TICKS_PER_SECOND } from "./Sim";
import { fm, usePortableMath } from "./fmath";
import { syncHash } from "./lockstep";
import { makeGrid } from "./world/testGrid";

// Seeded runs pinned to the hash they come out with, so a change that's meant
// to leave play alone (a speed-up, a tidy) can show it moved nothing: the same
// enemies in the same places, the same kills and drops, tick for tick. A
// change meant to change play moves these too: check it's only the runs it
// should, then update them.

// Walls of every kind for enemies to find their way round and slide along:
// solid blocks, water, fences on tile edges and signposts
function field(): string[] {
    const size = 72;
    const rows: string[] = [];
    for (let row = 0; row < size; row++) {
        const y = size - 1 - row;
        let line = "";
        for (let x = 0; x < size; x++) {
            const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
            if (edge || (x === 30 && y > 20 && y < 50) || (y === 44 && x > 40 && x < 60)) {
                line += "#";
            } else if (x > 12 && x < 20 && y > 40 && y < 47) {
                line += "~";
            } else if (x === 50 && y > 10 && y < 30) {
                line += "|";
            } else if (y === 26 && x > 8 && x < 26) {
                line += "_";
            } else if ((x * 7 + y * 13) % 41 === 0) {
                line += "o";
            } else {
                line += ".";
            }
        }
        rows.push(line);
    }
    return rows;
}

function hero(characterId: string): HeroOptions {
    return { name: characterId, characterId, metaStats: emptyStats() };
}

// Plays every hero round in circles of their own, each taking their first choice
function play(sim: Sim, seconds: number): number {
    let hash = 0x811c9dc5;
    const words = new Uint32Array(2);
    const value = new Float64Array(words.buffer);
    const fold = (v: number) => {
        value[0] = v;
        hash = Math.imul(hash ^ words[0], 0x01000193) >>> 0;
        hash = Math.imul(hash ^ words[1], 0x01000193) >>> 0;
    };
    for (let i = 0; i < seconds * TICKS_PER_SECOND && !sim.runOver; i++) {
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
            const angle = (sim.tick / TICKS_PER_SECOND) * 0.5 + h.index;
            sim.setInput(h.index, fm.cos(angle), fm.sin(angle));
        }
        sim.step();
        sim.takeEvents();
        if (sim.tick % 25 === 0) {
            fold(syncHash(sim));
            // Everything, not only the totals co-op compares
            for (const enemy of sim.enemies) {
                fold(enemy.uid);
                fold(enemy.x);
                fold(enemy.y);
                fold(enemy.hp);
            }
            for (const projectile of sim.projectiles) {
                fold(projectile.x);
                fold(projectile.y);
            }
            for (const pickup of sim.pickups) {
                fold(pickup.x);
                fold(pickup.y);
                fold(pickup.value);
            }
        }
    }
    return hash;
}

function run(options: Partial<SimOptions>, seconds: number): number {
    const sim = new Sim({
        grid: makeGrid(field(), 1000, 1000),
        characterId: "",
        metaStats: emptyStats(),
        seed: 3,
        spawnX: 1036.5,
        spawnY: 1036.5,
        ...options,
    });
    // Strong enough to last, so the crowds build up
    for (const h of sim.heroes) {
        h.metaStats.maxHp = 5;
        h.metaStats.armor = 5;
        sim.as(h.index, () => sim.updateStats());
    }
    return play(sim, seconds);
}

describe("seeded runs", () => {
    afterEach(() => usePortableMath(false));

    test("a wizard in Lumbridge, their spells chasing targets", () => {
        expect(run({ party: [hero("wizard")], mapId: "lumbridge" }, 240)).toBe(0xd41a8dba);
    }, 60000);

    test("a ranger in the Inferno on hard mode", () => {
        expect(run({ party: [hero("ranger")], mapId: "inferno", hard: true }, 120)).toBe(
            0xd61a2ada,
        );
    }, 60000);

    test("a party of four in the God Wars, armies fighting each other", () => {
        usePortableMath(true);
        const party = ["warrior", "wizard", "ranger", "pyromancer"].map(hero);
        // Every weapon can come up, so a new one (the Nightmare staff) changes it
        expect(run({ party, mapId: "god_wars" }, 120)).toBe(0x9f825f41);
    }, 60000);
});
