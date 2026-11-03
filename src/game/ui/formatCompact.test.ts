import { formatCompact, formatShare } from "./formatCompact";

describe("the damage panel's numbers", () => {
    it("stay a few characters long, however big", () => {
        expect(formatCompact(0)).toBe("0");
        expect(formatCompact(0.04)).toBe("0");
        expect(formatCompact(7.83)).toBe("7.8");
        expect(formatCompact(9.97)).toBe("10");
        expect(formatCompact(152)).toBe("152");
        expect(formatCompact(999.4)).toBe("999");
        expect(formatCompact(999.6)).toBe("1K");
        expect(formatCompact(9_540)).toBe("9.5K");
        expect(formatCompact(95_400)).toBe("95K");
        expect(formatCompact(954_000)).toBe("954K");
        expect(formatCompact(999_700)).toBe("1M");
        expect(formatCompact(9_540_000)).toBe("9.5M");
        expect(formatCompact(1_234_000_000)).toBe("1.2B");
        expect(formatCompact(56_700_000_000)).toBe("57B");
        expect(formatCompact(3.2e12)).toBe("3.2T");
        // An endless run's: the short scale's names, then powers of ten
        expect(formatCompact(4.6e15)).toBe("4.6Qa");
        expect(formatCompact(1_230_938_972e15)).toBe("1.2Sp");
        expect(formatCompact(999.6e33)).toBe("1e36");
        expect(formatCompact(4.5968e47)).toBe("4.6e47");
        expect(formatCompact(Infinity)).toBe("0");
        expect(formatCompact(NaN)).toBe("0");
    });

    it("give a share as a whole percentage", () => {
        expect(formatShare(42, 100)).toBe("42%");
        expect(formatShare(1, 3)).toBe("33%");
        expect(formatShare(0.2, 100)).toBe("<1%");
        expect(formatShare(0, 100)).toBe("0%");
        expect(formatShare(5, 0)).toBe("0%");
        expect(formatShare(2e9, 2e9)).toBe("100%");
    });
});
