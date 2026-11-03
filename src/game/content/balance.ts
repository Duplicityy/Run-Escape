import { CombatStyle } from "./types";

// Damage multipliers: 1 keeps the authored damage, 0.6 does 40% less, 1.2 does 20%
// more. Missing entries mean 1. All matching entries multiply together.
// See docs/BALANCE.md for examples and how these affect DPS.
export type DamageStages = {
    all?: number;
    base?: number;
    evolved?: number;
};

export type WeaponDamageProfile = DamageStages & {
    styles?: Partial<Record<CombatStyle, DamageStages>>;
    // Exact ids from weapons.ts. An evolution has its own id.
    weapons?: Record<string, number>;
};

type Difficulty = "normal" | "hard";
type PlayMode = "solo" | "coop";

export type WeaponDamageBalance = {
    global?: WeaponDamageProfile;
    difficulty?: Partial<Record<Difficulty, WeaponDamageProfile>>;
    playMode?: Partial<Record<PlayMode, WeaponDamageProfile>>;
    modes?: Partial<Record<PlayMode, Partial<Record<Difficulty, WeaponDamageProfile>>>>;
    // Starting party size; going down or leaving doesn't change weapon damage.
    partySize?: Partial<Record<1 | 2 | 3 | 4, WeaponDamageProfile>>;
};

// Leave authored weapon balance unchanged unless a rule is explicitly added.
export const WEAPON_DAMAGE_BALANCE: WeaponDamageBalance = {};
