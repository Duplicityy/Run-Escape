import { ROUND_XP } from "../content/endless";
import {
    endlessLevelForXp,
    endlessXpForLevel,
    levelForXp,
    runLevelForXp,
    runXpForLevel,
    xpForLevel,
} from "./xp";

describe("xp table", () => {
    test("matches the OSRS table", () => {
        expect(xpForLevel(1)).toBe(0);
        expect(xpForLevel(2)).toBe(83);
        expect(xpForLevel(10)).toBe(1154);
        expect(xpForLevel(50)).toBe(101333);
        expect(xpForLevel(99)).toBe(13034431);
    });

    test("levels for xp", () => {
        expect(levelForXp(0)).toBe(1);
        expect(levelForXp(82)).toBe(1);
        expect(levelForXp(83)).toBe(2);
        expect(levelForXp(13034431)).toBe(99);
    });
});

describe("run levels", () => {
    test("early levels are close to OSRS, later ones need more", () => {
        expect(runXpForLevel(2)).toBeLessThan(xpForLevel(2) * 1.05);
        expect(runXpForLevel(41)).toBe(Math.floor(xpForLevel(41) * 2));
    });

    test("run levels for xp invert the run table", () => {
        for (const level of [1, 2, 10, 25, 40]) {
            expect(runLevelForXp(runXpForLevel(level))).toBe(level);
            if (level > 1) {
                expect(runLevelForXp(runXpForLevel(level) - 1)).toBe(level - 1);
            }
        }
    });
});

describe("endless levels", () => {
    test("follow the run's table, then each level needs a little more than the last", () => {
        for (let level = 1; level <= 40; level++) {
            expect(endlessXpForLevel(level)).toBe(runXpForLevel(level));
        }
        const step = (level: number) => endlessXpForLevel(level + 1) - endlessXpForLevel(level);
        for (const level of [41, 60, 119]) {
            expect(step(level) / step(level - 1)).toBeCloseTo(1.06, 2);
        }
        for (const level of [122, 160, 300]) {
            expect(step(level) / step(level - 1)).toBeCloseTo(1.14, 2);
        }
        // A round's bones are worth ROUND_XP times the last's. Early on that buys plenty of
        // levels; past 120 about 11, so a weapon given half of them (15% more damage each) grows
        // a little slower than the rounds' hitpoints (3.3 times) rather than outgrowing them
        expect(endlessLevelForXp(endlessXpForLevel(60) * ROUND_XP, 60) - 60).toBeGreaterThan(20);
        for (const level of [130, 200, 300]) {
            const gained = endlessLevelForXp(endlessXpForLevel(level) * ROUND_XP, level) - level;
            expect(gained).toBeGreaterThanOrEqual(10);
            expect(gained).toBeLessThanOrEqual(12);
        }
    });

    test("go on past the run's top level, counting from wherever the player is", () => {
        for (const level of [2, 39, 40, 41, 99, 126, 127, 160]) {
            const xp = endlessXpForLevel(level);
            expect(endlessLevelForXp(xp)).toBe(level);
            expect(endlessLevelForXp(xp + 1, 1)).toBe(level);
            expect(endlessLevelForXp(xp - 1, level + 5)).toBe(level - 1);
        }
    });
});
