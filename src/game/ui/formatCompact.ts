// Thousands, millions, billions, trillions, then the short scale's names on
// up to decillions (Qa quadrillion, Qi quintillion, Sx, Sp, Oc, No, Dc)
const UNITS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

// A number in a few characters, for the damage panel and hitsplats, where an
// endless run's billions would otherwise push everything off the screen: 7.8,
// 950, 9.5K, 95K, 950K, 9.5M, 1.2B, 4.6Qa. Three figures at most, two under 10
// of a unit. Past the units it's a power of ten (1.2e36), still short.
export function formatCompact(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
        return "0";
    }
    if (value >= 999.5 * 1000 ** (UNITS.length - 1)) {
        const [mantissa, exponent] = value.toExponential(1).split("e+");
        return `${mantissa.replace(/\.0$/, "")}e${exponent}`;
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
