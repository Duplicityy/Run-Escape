const UNITS = ["", "K", "M", "B", "T", "Q"];

// A number in a few characters, for the damage panel, where an endless run's
// billions would otherwise push everything off the screen: 7.8, 950, 9.5K,
// 95K, 950K, 9.5M, 1.2B. Three figures at most, two under 10 of a unit.
export function formatCompact(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
        return "0";
    }
    let n = value;
    let unit = 0;
    // 999.5 and up would round to 1000, so it goes up a unit
    while (n >= 999.5 && unit < UNITS.length - 1) {
        n /= 1000;
        unit++;
    }
    const text = n < 9.95 ? n.toFixed(1) : Math.round(n).toString();
    return text.replace(/\.0$/, "") + UNITS[unit];
}

// A share of the whole as a whole percentage, with a sliver as "<1%"
export function formatShare(part: number, whole: number): string {
    if (!(whole > 0) || !(part > 0)) {
        return "0%";
    }
    const percent = (part / whole) * 100;
    return percent < 0.5 ? "<1%" : `${Math.round(percent)}%`;
}
