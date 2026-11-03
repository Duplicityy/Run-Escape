# Weapon damage tuning

Edit [`src/game/content/balance.ts`](../src/game/content/balance.ts) for weapon, class, evolution,
difficulty and party-size adjustments. The shipped config is `{}`: all profile multipliers are neutral. Authored
weapon levels remain in [`weapons.ts`](../src/game/content/weapons.ts).

## Current evolution curves

The controlled nerf edits 21 evolutions' authored damage at each level. It targets a 60% reduction
of the positive sustained-DPS gain above the strongest maxed parent:
`target = base DPS + 0.4 × (original evolution DPS − base DPS)`.

The target uses the original, unnerfed evolution. Changing the percentage replaces the previous
target; it doesn't stack another reduction. For example, a 100-DPS parent and 200-DPS original
evolution give a 140-DPS target, before rounding and the upgrade guards below.

`scripts/game/measure-weapon-dps.ts` measures actual attacks for 60 seconds on seeds 1–3, against
stationary normal and boss targets at an ideal distance. It includes projectiles, specials,
follow-ups, venom and burns, with no gear or Might. The selected integer damage meets the target
in both cases, keeps the primary hit and damage/cooldown above the maxed base, and rises at each
evolution level. Rounding and those guards can retain more than 40% of the original bonus.
Attack patterns, cooldowns, venom values and utility are unchanged.

Flames of Zamorak and Ancient godsword keep their original damage. They already trade sustained
single-target damage for area, extra boss hits or healing, so this comparison doesn't establish
safe nerf headroom for them. The 60% target applies to extra DPS above the parent. Rounding,
upgrade guards and secondary effects mean observed DPS can change by a different percentage.
Full-run sweeps are still needed alongside this stationary check.

See [the before/after validation](EVOLUTION_BALANCE_RESULTS.md) for the authored curves and full
progression runs across every shipped map, difficulty and tested party size.

These are developer settings, not player options. Restart the run after changing them; every
co-op player must use the same build. Tests and offline comparisons can pass `SimOptions.balance`
without mutating the shared config. Live runs use the shipped settings.

## Profiles

Missing entries mean `1`. A factor of `0.6` scales damage before rounding to 60%; `1.2` scales it
to 120%. Zero disables damage. Use finite, nonnegative values. Every scope accepts this profile;
include only the adjustments you want:

```ts
{
    all: 1,
    base: 1,
    evolved: 1,
    styles: {
        melee: { all: 1, base: 1, evolved: 1 },
        ranged: { all: 1, base: 1, evolved: 1 },
        magic: { all: 1, base: 1, evolved: 1 },
    },
    weapons: { abyssal_whip: 1 },
}
```

The style belongs to the weapon, not its adventurer; `getWeaponStyle` resolves shared weapons and
damage-style overrides. Evolution rules apply to `evolved: true` at every level. Individual
entries use exact ids from `weapons.ts`; an evolution has its own id.

| Scope                                   | Applies to                      |
| --------------------------------------- | ------------------------------- |
| `global`                                | Every run                       |
| `difficulty.normal` / `difficulty.hard` | That difficulty, solo and co-op |
| `playMode.solo` / `playMode.coop`       | That play mode, normal and hard |
| `modes.solo.normal` / `modes.solo.hard` | One solo difficulty             |
| `modes.coop.normal` / `modes.coop.hard` | One co-op difficulty            |
| `partySize[1]` through `partySize[4]`   | That starting party size        |

**Matching adjustments multiply; specific rules don't override broader ones.** Within a profile,
`all × base-or-evolved × style.all × style.base-or-evolved × weapon` applies. The matching global,
difficulty, play-mode, combined-mode and party-size profiles then multiply together.

## Examples

To scale magic evolutions to 60% of their authored damage everywhere:

```ts
export const WEAPON_DAMAGE_BALANCE: WeaponDamageBalance = {
    global: { styles: { magic: { evolved: 0.6 } } },
};
```

To apply that rule only in hard co-op:

```ts
export const WEAPON_DAMAGE_BALANCE: WeaponDamageBalance = {
    modes: { coop: { hard: { styles: { magic: { evolved: 0.6 } } } } },
};
```

Other independent examples:

```ts
// Every evolution in either co-op difficulty:
{ playMode: { coop: { evolved: 0.8 } } }
// Ranged weapons in four-player runs:
{ partySize: { 4: { styles: { ranged: { all: 0.9 } } } } }
// Just the Abyssal whip, everywhere:
{ global: { weapons: { abyssal_whip: 0.85 } } }
```

Combining the co-op `0.8` with the hard co-op magic `0.6` gives `0.48` damage before rounding for
magic evolutions there. Neither rule applies to solo runs.

## Damage and display rules

Multipliers are resolved once when a run starts and applied once when damage lands. Direct hits,
specials, delayed hits, boss bonus hits, chains, splits, splash, venom, burns and HP-based bolts
follow the originating weapon. Evolving doesn't change shots or DoTs already in flight.
Overlapping venom and ground fire keep the stronger tuned raw damage and its owner; ties keep the
existing effect. Refreshing the duration still works.

Might, rarity, gear, overlevels and target modifiers still apply. Items, power-ups and recoil use
their own rules. Damage-based healing follows adjusted damage. Speed, projectile count, area and
utility remain in the weapon levels.

**Rounding and the hit floor matter.** Positive hits round to whole numbers with a minimum of 1.
With a neutral damage roll, a `0.5` factor sends raw damage `1 → 1`, `3 → 2`, and `20 → 10`.
Small venom/burn ticks can lose much less than 50%. Zero deals zero. A multiplier doesn't promise
an exact change in observed DPS: rolls, rounding, targets, overkill and upgrades also affect it.

Cards, level-up changes, pause entries, tooltips and the Collection log include the **global**
profile's damage and venom adjustments. These are nominal content values, before Might, rarity,
rolls, rounding and the hit floor. Mode and party-size adjustments are run-specific and aren't
included in content stat lines. The damage meter and results show actual damage dealt.

Weapon rules use the **starting party size**: going down or leaving doesn't change survivors'
weapon multipliers.

## Enemy scaling and validation

Co-op enemy/reward constants and `getPartyScale` stay together in
[`content/coop.ts`](../src/game/content/coop.ts). `PLAYER_GONE` controls how much a downed/departed
player still counts. These values are unchanged by weapon tuning. Hard enemy multipliers stay in
`hard.ts` and each map's settings; endless round scaling stays in `endless.ts`.

A blanket evolution nerf can make evolving worse than keeping a maxed base weapon. Compare every
pair, including cooldowns, projectiles, multi-hits, venom, boss bonuses and utility. Tune authored
levels when changing permanent weapon progression.

Follow `CLAUDE.md` for tests and standard `scripts/game/simulate-run.ts` sweeps: matched seeds and
upgrades, every affected map, all three styles, solo/two/four players and both difficulties when
applicable. Report wins and run lengths. Short forced-loadout checks don't replace full progression
and win-rate testing. The bot is limited at strike weapons and co-op teamwork.

For a repeatable attack-level comparison, run `npx tsx scripts/game/measure-weapon-dps.ts`.
