# Phosani's Nightmare: design and playtest record

The fight's design, why it is the way it is, and the record of the session that made it hard:
what was wrong, what was tried, what was kept and why. Written 2026-11-03 against pull request
80 on the `phosanis-nightmare` branch. The numbers below are the ones the code had at the time;
the data in `src/game/content/phosani.ts` is the truth if they drift. The plan the work followed
is `docs/plans/phosani-harder.md`.

## 1. What the fight is

A boss fight on its own, open once Hallowed Night's beaten: her dream square in the Sisterhood
Sanctuary, no waves, no picks, no items, no drops. Everyone plays the Inquisitor with the Armadyl
crossbow at level 3 and nothing more, so the kit is the whole run and her hitpoints are tuned to
it. Three phases of shield then totems, as the real fight has, then a desperation finale. It is
meant to be learnt: every hit is wound up and shown first, and nothing heals but her totems, a
little. It can't be endless. It has a hard mode once beaten, a quest, and one reward.

The Inquisitor is hers alone: never in the roster anywhere else, and not a reward (section 8).

## 2. Principles

These came from reading bullet hell design (Sparen's danmaku guides, write-ups on Touhou, Enter
the Gungeon and Cuphead bosses, shmup forums) and they decided most of what follows.

- **Legibility first.** A death the player can't explain is the failure, not the difficulty.
  Every big hit keeps a long warning. Petals can come with a short one.
- **More bullets is not harder.** Structure and timing make difficulty: where arms form a wall
  at the moment you move, not how many there are.
- **Layer a macro pattern under micro pressure.** A slow ring or spiral the player must cross,
  with aimed shots over it, so they have to go somewhere and watch their feet on the way.
- **Aimed shots force movement, unaimed shape makes the floor.** A pattern that can be cheesed
  by standing still is a bug.
- **Random seeds, no blind spots.** A ring that always starts at the same angle leaves lanes
  that are never threatened.
- **Speed sets attention.** Walls slow and dense; aimed streams a little faster than the player,
  so they must be crossed rather than outrun. Anything a stream can't be stepped out of is
  unfair, whatever its speed.
- **Tempo rises through phases like a song.** Players feel escalation as pace, not as a bigger
  list of attacks.
- **What's drawn is what's hit.** The project's own rule, and the one most of the playtest
  fixes came back to.
- **Space is a lever.** Take the room away and a fight gets harder with no new bullets.

## 3. Why it was easy

The fight had plenty of patterns and none of them mattered. The diagnosis, each point tied to
where it came from:

- **A bullet could only hurt once a second.** `BULLET_GRACE_TICKS` was 50. A 3-damage petal
  was the worst any pattern could do per second; with 30 hitpoints you could stand in a spiral
  for ten seconds. Density was irrelevant past the first petal.
- **Patterns never overlapped.** A pattern held her still until its last volley, and her
  interval of 2.6 s plus windups of 1.1 to 1.9 s meant one pattern every 4 to 6 seconds,
  dodged on its own. Only `follow` ever put two things in the air, twice.
- **The arena was 64 tiles and she let you use it.** She kept 6 tiles off, the leash was 16,
  and a ring is passable once its bullets are 1.5 tiles apart, which her densest was beyond 7
  tiles from her. Every ring was a wall of gaps where you stood.
- **Bullets were slower than the player.** Rings and spirals at 3 to 6 tiles a second against
  the Inquisitor's 4. Only the sweep and barrage couldn't be outrun.
- **Two blast heals gave back 21 of 30 hitpoints.** On a fight whose point is that nothing
  heals.
- **No escalation.** Phased bosses skipped the enrage, so nothing changed by phase but a
  handful of random picks.
- **Attack choice was a lottery.** Set pieces on long cooldowns often never came in a phase.
- **The balance bot can't play it.** It dies in phase 1 inside a minute or two on every seed,
  so its numbers are a density meter, not a reading of a player.

## 4. The plan, and what landed

Seven stages were planned. Stages 1 to 3 landed and then playtesting took over; stage 4 was
done the other way round from the plan after playtesting (section 5); stages 5 to 7 are still
open (section 9).

### Stage 1: safety nets off

- `BossDef.bulletGrace`, hers 0.3 s. Other bosses keep the second, so The Nightmare on Hallowed
  Night plays as before.
- Blast heal 0.35 to 0.15: a breath, not a bar.
- Petals 3 to 4 damage: seven to die instead of ten. Claws, melee and the charge unchanged,
  since they're the ones with long warnings.
- The map's damage multiplier 0.9 to 1 (it rounded petals back to 3 and only took a point off
  the big hits).
- `Hero.damageByAttack`, what each of her attacks did by name, in the console and in the
  balance bot's output. Nothing had measured hits by attack before.

### Stage 2: overlap

- `BulletPatternDef.channel`: how long she stands still for a pattern. Rings and spirals get
  0.5 s, so the next thing comes through them; aimed spreads keep their whole length since
  they go where she faces.
- An **ambient** pattern per phase (`BossPhasesDef.phases[i].ambient`), run on its own timer
  under everything, through holds and cooldowns, reseeded every 30 s: five arms turning (phase
  1), a slow ring every 2.5 s each a half-step round from the last (phase 2), two arms wound
  against their mirror (phase 3). Each is sparse enough to be walked through with care, petals
  1.8 tiles apart along an arm against the 1.5 the Inquisitor needs. This is the macro layer
  the research asked for.

### Stage 3: escalation

- `tempo` per phase (1, 0.8, 0.65) on her interval and her pattern windups only, so the big
  hits keep their warnings; `speed` per phase (1, 1.15, 1.3) on her walk.
- A `finale`: after the last blast she stands 12 s more, untouchable, with her sleepwalkers
  walking in, claws on the player and the lattice doubled under them. OSRS's desperation
  phase, and the climax the fight lacked.

## 5. Playtest rounds

Each round is an issue the player reported, what caused it, what was done, and the decision
behind it. The order is the order they came in.

### Round 1

1. **She began her charge, teleported away and snapped back to the lane.** A charge ends at
   the far edge, past the leash distance. In the same tick the leash fired, so she sank and
   came up by the player, while the next chained charge had already picked its lane from the
   edge; when the leap ended the charge snapped her back. Fix: no leash between a chain's
   links or before a `follow`. A real bug, not tuning.
2. **The red shot's hitbox felt off: dodged, still hit.** The shot's model is a flat streak, a
   bounding radius of 0.56 tiles, drawn at twice that, with a hit radius of 0.4, a reach of
   0.75 tiles across with the player's 0.35. A sidestep that visibly cleared the streak by less
   than half a tile still hit. Fix: hit radius 0.25 for everything drawn as that streak (fans,
   barrage, parted petals, the hunting orbs via a new use of `radius` on projectile attacks),
   and bullets are never drawn smaller than their hit size whatever their `scale`. A camera
   pitch of about 70 degrees was ruled out as the cause: a bullet drawn 0.9 tiles up shifts
   only a third of a tile on screen.
3. **Too many jump-teleports; she should run after you.** Walk speed 1.7 to 3 (three quarters
   of the Inquisitor's 4), leash 16 to 22 with her coming up 8 off. The plan had the leash
   going the other way; the player's preference for chasing over teleporting decided it.

### Round 2

1. **You could run from her in the totems stage and nothing reached you.** Every attack had a
   range of 40, so from across the square she stood winding up petals that flew 16 to 22
   tiles and never arrived, and because she was always winding up the leash never got its
   turn. Fix: her petals, shots and claws have a range of 18, about as far as they fly. Past
   that she has only her charge and her summons, so she walks after you, charges, or sinks and
   comes up by you past 20. Spores keep 40 since they're laid round the player wherever they
   are. Leash 22 to 20.
2. **No charge in phases 1 and 2.** Weight 4 against the claws' 9 in a pool of fifteen. Fix:
   weight 9, cooldown 14 to 10, and past her reach it's most of what she has, so running from
   her is what brings it.
3. **The barrage was impossible to dodge.** A stream re-aimed every 0.12 s at 13 tiles a
   second: each shot arrived in under half a second, so there was no stepping out of it. Fix:
   speed 7 (under twice the player's pace) with 0.2 s between shots and ten of them. The
   hunting orbs turn at 0.8 instead of 1.2 and give up at 18 tiles instead of chasing for
   nearly eight seconds.

### Round 3

**The white needle sweeps had no gaps.** A needle every 0.06 s at 14 tiles a second is a solid
line, and crossing a line takes a third of a second, so no spacing of single needles could ever
be stepped through at that speed. The arm needs real holes. Fix: patterns can fire in `burst`s,
and the sweep, double sweep and scissors fire six needles then pause half a second, leaving
seven-tile holes that pass a point in half a second. Needles hit at 0.3, the streak they are.
The time she stands for a pattern counts the pauses.

### Round 4

1. **The phase 3 claw was a single circle.** Its ring of eight hands was placed round the boss,
   as every ring of ground marks was, so the eight landed round her out of view and only the
   mark on your tile showed. Fix: `around: "player"` on a ring of marks, and the claw uses it.
2. **It came far too often.** Weight 9 on a 6 s cooldown, in a phase where it also follows the
   parted petals. Fix: weight 3, cooldown 12, her rarest claw since it's her hardest.
3. Then **all the claws came too often**: weight 9 to 4, cooldowns 5 and 7 to 12 and 14, the
   random round three times to twice. The claws were written as the heart of the fight; the
   decision was to make them its punctuation. The charge kept its 9 on its own constant.

### Round 5

1. **The curse lasted too long.** 7 of her attacks to 3: about half the time, since her phases
   are quicker than when 7 was set.
2. **The flowers needed her jump, more time, and a red flash.** An attack that takes her to the
   middle now uses her leash's jump, the lines are placed where she will stand and grow from
   the moment she sinks, and the windup runs from when she's up: 5.4 s of warning instead of 3.
   The three quarters that will hurt flash red for a second. It's a colour overlay, drawn only
   as far as the camera sees, and the project prefers real assets, so the code and docs say so;
   the player asked for it by name.

### Round 6

1. **She fired red balls while her sleepwalkers walked, and you have to stand by her then.**
   Her attacks already waited for the walkers; the dream's pattern didn't, and a ring out of
   her is solid within five tiles. Fix: while her sleepwalkers walk, outside the finale, the
   ambient's emitters are dropped and it begins again the moment they're done.
2. **The red flash should mark the flowers appearing, not taking.** Moved to the start of her
   sink: the sign that it's happening and which way to run.
3. **Her death animation should play before the end screen.** `BossDef.fallSeconds`: the run
   goes on that long after a final boss falls, with nothing landing on the players, and the
   win is timed from the fall. Hers is 5.4 s, her death animation's length in the cache; the
   view plays all of such a boss's death where other deaths are cut at 1.2 s, and keeps the
   body that long.

### Round 7

1. **Husks, parasites and walkers dropped power-ups.** Summons that turn up at random weren't
   marked as dropping nothing. Fix: loot is off for a whole fight map, bones included; only the
   collection log's trophies from her kill still roll.
2. **The pink curse effect should flash as it ends.** It pulses ten times a second on the
   curse's last attack and flashes bright as it lifts.
3. **Parasites should be faster and heal a lot.** Speed 2 to 3.5, heal 4% every 3 s to 15%
   every 2 s of her shield, or of a totem's charge undone, seeking from anywhere. Which target
   was already right: a healer goes to the most hurt thing it heals, her shield counts as hurt
   only in the shield stage and a totem only while it's being charged.

## 6. The reward

**Asked:** what to give for beating her.

**Considered:** the Volatile staff and Inquisitor's mace were already Hallowed Night's. A
guaranteed Little Nightmare trophy for the first hard-mode kill (hard wins are saved, nothing
read them). The Slepey tablet as a one-use blink, her one unused OSRS drop. Experience, coins
or a passive were ruled out: the fight has no run, hard mode already pays, and the armour set
effect exists.

**Decided:** the **Nightmare staff**, the base staff the orbs attach to, unused in the game until
now. A rare magic strike unlocked by her kill: her grasping claws come up out of the ground
under enemies around the player, three hands to six, bosses and elites grabbed twice more, with
her own hand animation fitted to the strike and played out (`WeaponDef.impactFit`). Nothing new
from the cache but the staff's item. The bot puts it a little above Saradomin Strike, as a rare
should be, with the usual caveat that it plays strikes badly.

**Then the Inquisitor stopped being a reward.** They had unlocked for every map on her kill.
Now an adventurer can be one map's alone (`CharacterDef.only`): never in the roster, never
unlocked, never counted. The Inquisitor is Phosani's, and the staff is the whole reward.

## 7. What was good and what was bad

**Good**

- The diagnosis held up: the grace, the overlap and the range were the three real causes, and
  each fix was felt in play.
- Almost every fix was a data field with a default that keeps The Nightmare as she was, so the
  Hallowed Night fight never moved and its tests never changed.
- "What's drawn is what's hit" answered three complaints (the red shot, the needles, the
  claw's ring) without any new rule.
- A unit test went in with every change, so the fight's behaviour is pinned: 48 tests in
  `Phosani.test.ts` at the end.

**Bad**

- The first pass over-weighted the claws and under-weighted the charge; the player's rounds 2
  and 4 were about undoing that.
- Fast aimed streams were tuned by feel and were unplayable; the arithmetic in section 5 (a
  crossing takes a third of a second, so the stream's period must beat that) should have been
  done first.
- The balance bot measures nothing about this fight. Every real finding came from the player.
- Three visual changes (the curse flash, the death animation, one flash timing) went in
  without being seen, because the browser pane can't load while the session isn't in view.
- The suite's 30-seconds-per-adventurer test times out on a loaded machine and had to be rerun
  alone three times.

## 8. Decisions, in one place

| Decision                                            | Why                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Grace 0.3 s, not 0                                  | One volley's touching petals shouldn't double-hit; standing in a spiral should still kill              |
| Tempo on pattern windups only                       | The big hits' warnings are what make deaths explainable                                                |
| Leash later, speed up, not closer                   | The player preferred being chased to being teleported to                                               |
| Range 18 on patterns                                | Past it she walks or charges; standing far was free                                                    |
| Charge weighted as the top pick                     | It's the answer to a player who keeps away                                                             |
| Claws weight 4, long cooldowns, two rounds          | Each round's hands are up for seconds with nothing to do but stand clear; too many made them the fight |
| Bursts for sweeps                                   | A fast stream's gaps must be longer than a crossing takes; spacing single needles can't do that        |
| Hit radius 0.25 for the red streak, 0.3 for needles | Drawn width, not bounding radius                                                                       |
| Red flash as a colour overlay                       | Asked for by name; the flowers don't say which side is which until they hurt                           |
| Nothing drops in a fight map                        | Simpler than marking each summon; the fight has no loot by design                                      |
| Her death played before the win                     | Asked for; `fallSeconds` is general and defaults off                                                   |
| Nightmare staff as the reward                       | The unused base staff, her own claws, nothing new from the cache                                       |
| Inquisitor not a reward                             | Played nowhere else; the staff is enough                                                               |

## 9. Open

- **The human playtest in the plan's section 5** with its targets: a first run dies in phase 1
  or 2, a learnt run takes 5 to 6 minutes and finishes under half hitpoints, most hits are
  petals, no 5-second lull.
- **Stages 5 to 7 of the plan**: density where the player stands (paired rings, bullet hit
  radius 0.3 with the same look), rhythm instead of luck (OSRS-style sets per phase), a hard
  mode that raises tempo and density rather than hitpoints and damage. Stage 4 is done the
  other way round (section 5, round 2).
- **Unseen in the browser**: the curse's end flash, her death animation before the screen, the
  flash's new timing.
- **Keep distance** is still 6; the plan's 3 was never tried.

## 10. Fields added

For anyone building on this: `BossDef.bulletGrace`, `fallSeconds`; `BulletPatternDef.channel`,
`burst`; `BossPhasesDef.phases[i].ambient`, `tempo`, `speed` and `finale`; `around: "player"`
on a ring of ground marks; `radius` on projectile attacks; `WeaponDef.impactFit`;
`CharacterDef.only`; `Hero.damageByAttack`. Each is described in `docs/DEVELOPMENT.md` under
Boss fights as data and in `.claude/rules/adding-content.md`.
