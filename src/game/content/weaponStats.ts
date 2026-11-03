import { WEAPON_DAMAGE_BALANCE, WeaponDamageProfile } from "./balance";
import { WeaponDef, WeaponLevel } from "./types";
import { weaponDamageProfileScale } from "./weaponBalance";

// A weapon stat as the level up cards, the pause menu and the HUD's tooltips
// show it: "Damage 13", or for a level up "Damage 10 → 13"
export type WeaponStatLine = {
    label: string;
    value: string;
    // A level up's change: what it was before, and whether it's for the better
    from?: string;
    better?: boolean;
};

// A weapon's damage bonus (0.15 = +15%) as the HUD's tooltip and the level up
// cards show it: "+15%"
export function formatWeaponBonus(bonus: number): string {
    return `+${Math.round(bonus * 100)}%`;
}

type StatField = {
    label: string;
    // undefined when the stat means nothing for this weapon
    get: (level: WeaponLevel) => number | undefined;
    format: (value: number) => string;
    // Listed among the weapon's stats when this says so; otherwise it's only
    // shown when a level changes it
    listed?: (value: number) => boolean;
};

// The swing's arc when a level doesn't set one (Sim's SLASH_ARC)
const DEFAULT_ARC = 1.1;

// Rounds without trailing zeros: 2.2, 0.85, 13
function round(value: number, digits = 1): string {
    return String(Number(value.toFixed(digits)));
}

const always = () => true;
const positive = (value: number) => value > 0;

const damage: StatField = {
    label: "Damage",
    get: (level) => level.damage,
    format: (value) => round(value),
    listed: always,
};

// Attacks a second rather than the cooldown, so bigger is better like the rest
const rate: StatField = {
    label: "Attacks",
    get: (level) => 1 / level.cooldown,
    format: (value) => `${value.toFixed(2)}/s`,
    listed: always,
};

const knockback: StatField = {
    label: "Knockback",
    get: (level) => level.knockback,
    format: (value) => round(value, 2),
};

function tiles(label: string, listed?: StatField["listed"]): StatField {
    return {
        label,
        get: (level) => level.area,
        format: (value) =>
            value > 0 ? `${round(value, 2)} ${round(value, 2) === "1" ? "tile" : "tiles"}` : "none",
        listed,
    };
}

function seconds(label: string, listed?: StatField["listed"]): StatField {
    return {
        label,
        get: (level) => level.duration,
        format: (value) => `${round(value, 2)}s`,
        listed,
    };
}

const projectiles: StatField = {
    label: "Projectiles",
    get: (level) => level.amount,
    format: (value) => round(value),
    listed: always,
};

// Toktz-xil-ul's 99 is everything in the way
const pierce: StatField = {
    label: "Pierces",
    get: (level) => level.pierce,
    format: (value) => (value >= 99 ? "all" : round(value)),
    listed: positive,
};

const venom: StatField = {
    label: "Venom",
    get: (level) => level.venom,
    format: (value) => `${round(value)}/s`,
    listed: positive,
};

// What an aura's or a strike's duration is for: the freeze, the burning
// ground, the drain or the venom
function spellDuration(def: WeaponDef): StatField[] {
    if (def.freezes) {
        return [seconds("Freezes for", positive)];
    }
    if (def.burns) {
        return [seconds("Burns for", positive)];
    }
    if (def.drain) {
        return [seconds("Weakens for", positive)];
    }
    return [];
}

// Venom's length, for what poisons
function venomFields(damageScale: number): StatField[] {
    return [
        {
            ...venom,
            get: (level) => (level.venom === undefined ? undefined : level.venom * damageScale),
        },
        {
            ...seconds("Venom lasts", positive),
            get: (level) => (level.venom ? level.duration : undefined),
        },
    ];
}

// What each kind of weapon uses its level's numbers for (see Sim's fire*
// methods): amount is a slash's sides but a missile's projectiles, area a
// slash's reach but a missile's splash, and so on. Stats a kind ignores are
// left out.
function statFields(def: WeaponDef, profile: WeaponDamageProfile | undefined): StatField[] {
    const scale = weaponDamageProfileScale(profile, def);
    const tunedDamage = { ...damage, get: (level: WeaponLevel) => level.damage * scale };
    switch (def.kind) {
        case "slash":
        case "sweep":
            return [
                tunedDamage,
                rate,
                // Front, and behind too at 2
                {
                    label: "Sides",
                    get: (level) => Math.min(level.amount, 2),
                    format: (value) => round(value),
                    listed: (value) => value > 1,
                },
                tiles("Reach", always),
                ...(def.kind === "sweep"
                    ? [
                          {
                              label: "Arc",
                              get: (level: WeaponLevel) => level.arc ?? DEFAULT_ARC,
                              format: (value: number) =>
                                  `${Math.round((value * 2 * 180) / Math.PI)}°`,
                          },
                      ]
                    : []),
                { ...knockback, listed: positive },
            ];
        case "missile":
        case "knives":
        case "axes":
            return [
                tunedDamage,
                rate,
                projectiles,
                ...(def.kind === "axes"
                    ? [
                          {
                              label: "Bounces",
                              get: (level: WeaponLevel) => level.bounce ?? 0,
                              format: (value: number) => round(value),
                              listed: positive,
                          },
                      ]
                    : []),
                pierce,
                tiles("Splash", positive),
                ...venomFields(scale),
                { label: "Speed", get: (level) => level.speed, format: (value) => round(value) },
                knockback,
            ];
        case "aura":
            return [
                tunedDamage,
                rate,
                tiles("Radius", always),
                ...spellDuration(def),
                ...venomFields(scale),
                knockback,
            ];
        case "strike":
            return [
                tunedDamage,
                rate,
                { ...projectiles, label: "Targets" },
                tiles("Blast radius", always),
                ...spellDuration(def),
                ...venomFields(scale),
                knockback,
            ];
        case "orbit":
            return [
                tunedDamage,
                rate,
                projectiles,
                seconds("Lasts", always),
                tiles("Radius"),
                {
                    label: "Spin speed",
                    get: (level) => level.speed,
                    format: (value) => round(value),
                },
                knockback,
            ];
    }
}

// A weapon's stats at a level, the ones worth listing for its kind
export function weaponStats(
    def: WeaponDef,
    level: WeaponLevel,
    profile: WeaponDamageProfile | undefined = WEAPON_DAMAGE_BALANCE.global,
): WeaponStatLine[] {
    const lines: WeaponStatLine[] = [];
    for (const field of statFields(def, profile)) {
        const value = field.get(level);
        if (value !== undefined && field.listed?.(value)) {
            lines.push({ label: field.label, value: field.format(value) });
        }
    }
    return lines;
}

// What changes from one level to the next, before and after. Changes too
// small to show once rounded are left out.
export function weaponStatChanges(
    def: WeaponDef,
    from: WeaponLevel,
    to: WeaponLevel,
    profile: WeaponDamageProfile | undefined = WEAPON_DAMAGE_BALANCE.global,
): WeaponStatLine[] {
    const lines: WeaponStatLine[] = [];
    for (const field of statFields(def, profile)) {
        // A stat that only means something at one of the levels (venom's
        // length once there's venom) counts as none at the other
        const before = field.get(from) ?? 0;
        const after = field.get(to) ?? 0;
        const value = field.format(after);
        const was = field.format(before);
        if (value !== was) {
            lines.push({ label: field.label, value, from: was, better: after > before });
        }
    }
    return lines;
}

// "Damage 10 → 13", for plain text
export function formatWeaponStat(line: WeaponStatLine): string {
    return line.from === undefined
        ? `${line.label} ${line.value}`
        : `${line.label} ${line.from} → ${line.value}`;
}
