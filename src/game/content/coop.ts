// Co-op: two to four players in one run. Everyone's weapons are on the same
// crowd, so it comes bigger and tougher with each player past the first, and
// bosses keep up with the party's damage. The crowd's attention is split
// between the players, so its hits are harder too. The run's level is shared
// (every level up gives each player their own pick) and a bigger crowd drops
// more bones, so each is worth a little less, and the party levels about as
// fast as a player on their own. It's worked out again whenever a player
// goes down or leaves, counting each of them as half a player (PLAYER_GONE),
// so the rest have it easier but not as easy as a party that size.

export const MAX_PARTY = 4;

// How much of a player one who's down or gone still counts for in the
// party's scale
export const PLAYER_GONE = 0.5;

export type PartyScale = {
    // Multiplies the waves' spawn rate and how many are about at once
    crowd: number;
    // Multiplies enemies' hitpoints (bosses' too, by their own amount)
    hp: number;
    bossHp: number;
    // Multiplies everything enemies hit with: touches, shots, bosses' attacks
    damage: number;
    // Multiplies the experience in enemies' bones
    xp: number;
    // Multiplies the chance of an enemy dropping a casket, so there's gear
    // enough for everyone
    caskets: number;
};

// Each player past the first adds this much of each (the experience, takes
// it away)
const CROWD_PER_PLAYER = 0.35;
const HP_PER_PLAYER = 0.5;
const BOSS_HP_PER_PLAYER = 1.1;
const DAMAGE_PER_PLAYER = 0.1;
const XP_PER_PLAYER = -0.12;
const CASKETS_PER_PLAYER = 0.2;

// Bosses come as copies in co-op: a pair on normal mode, one for each player
// on hard. Between them the copies have one boss's hitpoints and experience,
// and its loot drops with the last to fall (Sim.spawnBosses), so a party
// fights more bosses rather than bigger ones. A boss with its own spots
// (EnemyDef.spawnAt) gets no more than it has free: Pest Control's portals
// have one each, so they stay single.
export function bossCopies(players: number, hard: boolean): number {
    if (players <= 1) {
        return 1;
    }
    return hard ? Math.min(players, MAX_PARTY) : 2;
}

export function getPartyScale(players: number): PartyScale {
    const extra = Math.max(0, Math.min(players, MAX_PARTY) - 1);
    return {
        crowd: 1 + CROWD_PER_PLAYER * extra,
        hp: 1 + HP_PER_PLAYER * extra,
        bossHp: 1 + BOSS_HP_PER_PLAYER * extra,
        damage: 1 + DAMAGE_PER_PLAYER * extra,
        xp: 1 + XP_PER_PLAYER * extra,
        caskets: 1 + CASKETS_PER_PLAYER * extra,
    };
}

// A player who goes down can be brought back by a teammate standing over them
// (within REVIVE_RANGE tiles) for REVIVE_SECONDS, up to REVIVES_PER_PLAYER
// times a run, with less of their hitpoints each time (REVIVE_HP, by how many
// times they've been revived). Back up, nothing can hurt them and enemies
// leave them be for REVIVE_IMMUNITY_SECONDS.
export const REVIVES_PER_PLAYER = 3;
export const REVIVE_HP = [0.75, 0.5, 0.25];
export const REVIVE_SECONDS = 5;
export const REVIVE_RANGE = 1;
export const REVIVE_IMMUNITY_SECONDS = 5 * 60;

// The Prayer cape's skillcape emote, which a reviver performs over the fallen:
// the player animation and the graphic that goes with it
export const REVIVE_SEQ = 4979;
export const REVIVE_SPOTANIM = 829;
