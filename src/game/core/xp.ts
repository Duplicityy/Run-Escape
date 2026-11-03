import { fm } from "./fmath";

// The OSRS experience table: the XP needed for each level, from level 1.
const MAX_LEVEL = 126;

// 2 to the power of 0/7 to 6/7, so 2^(level/7) is a whole power of two times
// one of these, and the table comes out the same in every browser (co-op
// copies have to agree)
const SEVENTHS = [
    1, 1.1040895136738123, 1.2190136542044754, 1.3459001926323562, 1.4859942891369484,
    1.6406707120152759, 1.8114473285278132,
];

const XP_FOR_LEVEL: number[] = (() => {
    const table = [0, 0];
    let points = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
        const power = 2 ** Math.floor(level / 7) * SEVENTHS[level % 7];
        points += Math.floor(level + 300 * power);
        table.push(Math.floor(points / 4));
    }
    return table;
})();

export function xpForLevel(level: number): number {
    return XP_FOR_LEVEL[Math.min(Math.max(level, 1), MAX_LEVEL)];
}

export function levelForXp(xp: number): number {
    let level = 1;
    while (level < MAX_LEVEL && XP_FOR_LEVEL[level + 1] <= xp) {
        level++;
    }
    return level;
}

// A run's levels: the OSRS table, stretched more the higher you go, so the
// first levels come about as fast and the later ones slow down (level 40 needs
// about twice the OSRS XP).
const RUN_STRETCH_PER_LEVEL = 1 / 40;

export function runXpForLevel(level: number): number {
    return Math.floor(xpForLevel(level) * (1 + (level - 1) * RUN_STRETCH_PER_LEVEL));
}

export function runLevelForXp(xp: number): number {
    let level = 1;
    while (level < MAX_LEVEL && runXpForLevel(level + 1) <= xp) {
        level++;
    }
    return level;
}

// Endless runs' levels: the run's table up to level 40 (about where the first
// round ends), then each level needs a little more XP than the one before (6%
// more), so levels keep coming as the rounds go by: about 29 a round, as a
// round's bones are worth ROUND_XP (4) times the last's, with bigger crowds.
//
// Past level 120 (about round 4) each needs 14% more, which makes it about 11
// a round. A player who puts half of them into one weapon (15% or more each,
// compounding) then grows a little slower than the rounds' hitpoints (3.3
// times a round), so a long run gets harder and ends. At 29 a round that
// weapon outgrew the rounds many times over, to numbers past 10^24 by round 13.
const ENDLESS_STEEP_LEVELS = 40;
const ENDLESS_GROWTH = 1.06;
const ENDLESS_LATE_LEVELS = 120;
const ENDLESS_LATE_GROWTH = 1.14;
const MAX_ENDLESS_LEVEL = 9999;

// XP for `levels` levels past one that took `step`, each taking `growth` times the last
function geometric(step: number, growth: number, levels: number): number {
    return (step * growth * (fm.pow(growth, levels) - 1)) / (growth - 1);
}

export function endlessXpForLevel(level: number): number {
    if (level <= ENDLESS_STEEP_LEVELS) {
        return runXpForLevel(level);
    }
    const top = runXpForLevel(ENDLESS_STEEP_LEVELS);
    const step = top - runXpForLevel(ENDLESS_STEEP_LEVELS - 1);
    const capped = Math.min(level, MAX_ENDLESS_LEVEL);
    const early = Math.min(capped, ENDLESS_LATE_LEVELS) - ENDLESS_STEEP_LEVELS;
    let xp = top + geometric(step, ENDLESS_GROWTH, early);
    if (capped > ENDLESS_LATE_LEVELS) {
        const lateStep = step * fm.pow(ENDLESS_GROWTH, early);
        xp += geometric(lateStep, ENDLESS_LATE_GROWTH, capped - ENDLESS_LATE_LEVELS);
    }
    return Math.floor(xp);
}

// Counts up from the level the player is at (endless levels have no top to
// stop at, so it's quicker than from 1)
export function endlessLevelForXp(xp: number, from = 1): number {
    let level = Math.max(1, from);
    while (level > 1 && endlessXpForLevel(level) > xp) {
        level--;
    }
    while (level < MAX_ENDLESS_LEVEL && endlessXpForLevel(level + 1) <= xp) {
        level++;
    }
    return level;
}
