import { WEAPON_DAMAGE_BALANCE, WeaponDamageBalance, WeaponDamageProfile } from "./balance";
import { WeaponDef } from "./types";
import { getWeaponStyle } from "./weapons";

export function weaponDamageProfileScale(
    profile: WeaponDamageProfile | undefined,
    weapon: WeaponDef,
): number {
    const stage = weapon.evolved ? "evolved" : "base";
    const style = profile?.styles?.[getWeaponStyle(weapon)];
    const factors = [
        profile?.all,
        profile?.[stage],
        style?.all,
        style?.[stage],
        profile?.weapons?.[weapon.id],
    ];
    let scale = 1;
    for (const factor of factors) {
        if (factor !== undefined) {
            if (!Number.isFinite(factor) || factor < 0) {
                throw new Error(`Invalid weapon damage multiplier for ${weapon.id}: ${factor}`);
            }
            scale *= factor;
        }
    }
    return scale;
}

// Uses the weapon's damage style, not the adventurer holding it. Compiled once
// per run so hits, delayed attacks and damage over time all use the same rules.
export function getWeaponDamageMultiplier(
    weapon: WeaponDef,
    players: number,
    hard: boolean,
    balance: WeaponDamageBalance = WEAPON_DAMAGE_BALANCE,
): number {
    const playMode = players > 1 ? "coop" : "solo";
    const difficulty = hard ? "hard" : "normal";
    const profiles = [
        balance.global,
        balance.difficulty?.[difficulty],
        balance.playMode?.[playMode],
        balance.modes?.[playMode]?.[difficulty],
        balance.partySize?.[players as 1 | 2 | 3 | 4],
    ];
    return profiles.reduce(
        (scale, profile) => scale * weaponDamageProfileScale(profile, weapon),
        1,
    );
}
