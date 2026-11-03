import { StatKey, Stats } from "./types";

// How each stat reads to the player, for gear, potions and comparisons
export const STAT_INFO: Record<StatKey, { label: string; unit: "percent" | "flat" }> = {
    might: { label: "damage", unit: "percent" },
    meleeMight: { label: "melee damage", unit: "percent" },
    rangedMight: { label: "ranged damage", unit: "percent" },
    magicMight: { label: "magic damage", unit: "percent" },
    bossMight: { label: "damage to bosses", unit: "percent" },
    levelMight: { label: "damage a level", unit: "percent" },
    armor: { label: "armour", unit: "flat" },
    maxHp: { label: "max hitpoints", unit: "percent" },
    regen: { label: "hitpoints a minute", unit: "flat" },
    cooldown: { label: "weapon speed", unit: "percent" },
    area: { label: "area", unit: "percent" },
    auraArea: { label: "aura area", unit: "percent" },
    speed: { label: "projectile speed", unit: "percent" },
    duration: { label: "effect duration", unit: "percent" },
    amount: { label: "projectiles", unit: "flat" },
    moveSpeed: { label: "movement speed", unit: "percent" },
    magnet: { label: "pickup range", unit: "percent" },
    luck: { label: "luck", unit: "percent" },
    growth: { label: "experience", unit: "percent" },
    greed: { label: "coins", unit: "percent" },
    revival: { label: "revivals", unit: "flat" },
    reroll: { label: "rerolls", unit: "flat" },
    banish: { label: "banishes", unit: "flat" },
    thorns: { label: "recoil damage", unit: "flat" },
    healChance: { label: "chance to heal on hit", unit: "percent" },
    meleeKnockback: { label: "melee knockback", unit: "percent" },
    weaponSlots: { label: "weapon slots", unit: "flat" },
    passiveSlots: { label: "passive slots", unit: "flat" },
    powerUpRate: { label: "power-up drops", unit: "percent" },
};

// The order stats are listed in
const STAT_ORDER = Object.keys(STAT_INFO) as StatKey[];

// "+10% damage", "-1 armour"
export function formatStat(key: StatKey, value: number): string {
    const info = STAT_INFO[key];
    const sign = value < 0 ? "-" : "+";
    const abs = Math.abs(value);
    if (info.unit === "percent") {
        return `${sign}${Math.round(abs * 100)}% ${info.label}`;
    }
    return `${sign}${Math.round(abs * 10) / 10} ${info.label}`;
}

export function formatStats(stats: Partial<Stats>): string[] {
    const lines: string[] = [];
    for (const key of STAT_ORDER) {
        const value = stats[key];
        if (value) {
            lines.push(formatStat(key, value));
        }
    }
    return lines;
}

// A stat's value on its own: "+10%", "-1"
export function formatStatValue(key: StatKey, value: number): string {
    const sign = value < 0 ? "-" : "+";
    const abs = Math.abs(value);
    return STAT_INFO[key].unit === "percent"
        ? `${sign}${Math.round(abs * 100)}%`
        : `${sign}${Math.round(abs * 10) / 10}`;
}

// Every stat a piece has after an upgrade, with what it had before: for the
// Armoury's "Damage +10% → +15%". from is undefined when it's unchanged, and
// "+0" for a stat the upgrade adds.
export function compareStats(
    before: Partial<Stats>,
    after: Partial<Stats>,
): { key: StatKey; label: string; from?: string; to: string; better: boolean }[] {
    const lines: { key: StatKey; label: string; from?: string; to: string; better: boolean }[] = [];
    for (const key of STAT_ORDER) {
        const was = before[key] ?? 0;
        const now = after[key] ?? 0;
        if (!was && !now) {
            continue;
        }
        const label = STAT_INFO[key].label;
        lines.push({
            key,
            label: label[0].toUpperCase() + label.slice(1),
            ...(Math.abs(now - was) > 1e-9 && { from: formatStatValue(key, was) }),
            to: formatStatValue(key, now),
            better: now >= was,
        });
    }
    return lines;
}

// What changes going from one set of stats to another: for comparing a new
// piece of gear with the one it replaces
export function diffStats(
    from: Partial<Stats>,
    to: Partial<Stats>,
): { key: StatKey; delta: number; text: string }[] {
    const diffs: { key: StatKey; delta: number; text: string }[] = [];
    for (const key of STAT_ORDER) {
        const delta = (to[key] ?? 0) - (from[key] ?? 0);
        if (Math.abs(delta) > 1e-9) {
            diffs.push({ key, delta, text: formatStat(key, delta) });
        }
    }
    return diffs;
}
