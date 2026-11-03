# Phosani's Nightmare: design and playtest record

The fight's design, why it is the way it is, and the record of the two playtests that shaped
it: the one that made it hard (sections 3 to 5) and the one on what's seen (section 6). For each:
what was wrong, what was tried, what was kept and why. Written 2026-11-03 against pull request
80 on the `phosanis-nightmare` branch. The numbers below are the ones the code had at the time;
the data in `src/game/content/phosani.ts` is the truth if they drift. The plan the work followed
is `docs/plans/phosani-harder.md`. Section 12 is the arena: where its pieces came from, what
was tried, and what the player sent back. Section 13 is the session before the playtests: the
research, which bullet hell each pattern came from, the tools built for them, the eggs and her
track.

## 1. What the fight is

A boss fight on its own, open once Hallowed Night's beaten: her dream square in the Sisterhood
Sanctuary, no waves, no picks, no items, no drops. Everyone plays the Inquisitor with the Armadyl
crossbow at level 3 and nothing more, so the kit is the whole run and her hitpoints are tuned to
it. Three phases of shield then totems, as the real fight has, then a desperation finale. It is
meant to be learnt: every hit is wound up and shown first, and nothing heals but her totems, a
little. It can't be endless. It has a hard mode once beaten, a quest, and one reward.

The Inquisitor is hers alone: never in the roster anywhere else, and not a reward (section 9).

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
open (section 10).

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

## 6. The other playtest: what's seen

Alongside the hardening, in a session of its own on the same checkout, the player ran a second
playtest about what's seen rather than what's dodged: her entrance, her hands, her summons and
her totems. Its changes went into the hardening's commit, whose message doesn't list them. The
rounds, in the order they came in; where the two playtests pulled against each other (how often
the claws come), the hardening's round 4 had the last word.

### Round 1

1. **She rose wherever the player happened to be, and the player ran about while she woke.**
   Fix: she rises at the middle of her square (`intro.atMiddle`) with the player 7 tiles south
   of her, the map's spawn put on that tile so there's no jump, and the player rooted until
   she's up (`intro.holds`, which co-op's movement prediction honours too). The real fight's
   entrance.
2. **Her eggs just appeared, with too many hitpoints and no bar, and a hit flashed all three.**
   Fix: she flings them out of herself with her magic animation (`summon.thrown`), each a
   second's flight on an arc to its own random spot about 11 tiles off, untouchable until it
   lands, hatching 15 s after it does; 100 hitpoints, a few bolts, with a bar (`healthBar`);
   only the egg that's hit flashes.
3. **With her shield down the crossbow still went for her.** Fix: in the totems stage bolts fly
   on through her to a totem, and breaking the shield clears her as the target. Pinned for
   Hallowed Night as well.
4. **She looked at the player while she charged.** Her yaw follows her lane from the windup on.
5. **The totems were hard to make out.** Scale 2.5, with a 0.9-tile mark to hit for it.
6. **The Inquisitor felt slow.** 20% faster.

### Round 2

1. **Her claws' hands were cut short, and the ones in the middle were small.** Fix: `grab` on a
   ground attack plays the hands' spot animation (1761) out in full where each mark lands,
   scaled to the mark. Its first form, hands drawn at twice the mark, was undone in round 7.
2. **A ring's way through was wherever it fell.** `gapAt: "player"` on the closing ring and the
   turning wall: it opens on the player's side.
3. **She stood five seconds before her first attack.** Her cooldown doesn't count while she
   rises, and the entrance set it to a second past its end. Fix: with `holds` it's 0 as she
   rises, so she comes at the player the moment they're let go.
4. **Her totems faced any way.** Each is turned to the middle, and the crowd code leaves a
   totem's yaw alone. Round 3 found the scroll on the wrong side.
5. **Her husks stood and shot.** Fix: hers run as quick as the Inquisitor, throw nothing, are
   solid, and hold the player where they stand until they're dead (`holds` 30 s, a long stop).
   The rooted husks are gone, and husks come in every phase.
6. **Her charge tore her model apart.** 8604 (the absorb) and 8610 (the pit rise) are her other
   form's, on skeleton 1904 (npc 9431); on 9425's model they tear it. Fix: the charge floats on
   her walk animation, and the sleepwalkers' absorb uses her summon one. Hallowed Night's
   Nightmare tore the same way and is fixed with it (the changelog's Fixed).
7. **The player could push her and her summons about.** `solid`: the player is the one that
   gives.

### Round 3

1. **The scroll on each totem faced away from the middle.** The totem model's scroll hangs 768
   yaw units round from the model's facing, found by turning one in the browser. Fix:
   `totems.yawOffset`, 768 for hers and for Hallowed Night's.
2. **The hands were a mess.** In OSRS each hand is a tile on its own: the mark and the hand are
   the same thing. Fix: the hands are the whole mark, with no model under them and the warning
   the hands themselves, faint and still. Round 7 finished this.
3. **The eggs were hard to find.** OSRS's own hint arrow (sprite archive 441, `headicons_hint`)
   bobs over anything with `hintArrow`, and points from the screen's edge when it's off it.

### Round 4

1. **Husks took too long to shoot down.** 150 hitpoints, with a bar.
2. **The arrows were too big.** 1.2 times the sprite.
3. **"Flash the dash indicator for 1 second."** Read as a flash on the lane, which was wrong:
   round 6 has what was meant.
4. **Her leash just put her by the player.** Fix: `leash.jump`: she sinks (8607) where she is
   and comes up (8609) by the player, 1.2 s in all, untouchable and still meanwhile
   (`BossState.leap`). The flowers' jump to the middle (section 5, round 5) is the same jump.
5. **Her sleepwalker summon tore her model.** The other-form animation again (round 2, item 6).
6. **Parasites: too many hitpoints, no bar.** 400 and 200, a dozen bolts, bars on both, solid.
7. **The next round of claws came while the hands were still up, and the hands didn't hurt
   the player standing in them.** Fix: a grab holds her (`channelEnd`) for the hands'
   animation, so a chain's next round waits, and each mark stays and hurts each hero once who
   steps in while the hands are up (`GroundHazard.hit`).
8. **The flowers came back too soon.** Cooldown 60 s: each one is a run to the right quarter.

### Round 5

**"The map is gone from the selection screen."** Not reproduced: the tile was under Boss fights
on both dev servers. Left open (section 10).

### Round 6

1. **The lane: show it for a second, then take it away.** What round 4, item 3 meant. Fix: a
   charge's lane shows for a second from the windup (`LANE_SHOW_SECONDS`, at 0.6 alpha) and
   then it's gone; the charge itself draws no lane.
2. **The ground attack is good: lose the outline and do a lot more of them.** The model under
   the hands went. The claws' weights went to 9 and their cooldowns to 5, 7 and 6, and the
   hardening's round 4 walked them back to 4 and 12, 14, 12: each round's hands are up for
   seconds with nothing to do but stand clear.

### Round 7

1. **A black dot, then nothing, then the hands.** The hands' animation is under the ground for
   its first half second and from 1.9 s of its 2.4, and the faint warning was that animation
   from its first frame. Fix: the warning holds a frame with the hands up
   (`GRAB_WARNING_TICK` 40) at 0.45 alpha, kept until the real hands have risen into sight,
   where they take over in place.
2. **The hitbox no longer matched the hands.** The hands were drawn at twice the mark.
   Decision: shrink the mark to the hands, 0.75 tiles, rather than grow the hands to the mark,
   and put more marks to a ring instead (12, 18 and 24 from 8, 12 and 16; two dozen scattered
   from sixteen; eight round the player from six). A mark hurts only from 0.5 to 1.9 s after
   it lands, while the hands are in sight (`grab.up`): nothing's hit by what can't be seen.

The balance bot can't dodge, so its lifetime read only the density: 24, 29 and 42 s on three
seeds before this playtest, 18, 21 and 24 after it.

## 7. The reward

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

## 8. What was good and what was bad

**Good**

- The diagnosis held up: the grace, the overlap and the range were the three real causes, and
  each fix was felt in play.
- Almost every fix was a data field with a default that keeps The Nightmare as she was, so the
  Hallowed Night fight never moved and its tests never changed.
- "What's drawn is what's hit" answered three complaints (the red shot, the needles, the
  claw's ring) without any new rule.
- A unit test went in with every change, so the fight's behaviour is pinned: 48 tests in
  `Phosani.test.ts` at the end.
- Everything in the second playtest was seen in the browser before it was called done. A pane
  throttled out of view can be stepped by hand from the console (`game.sim.step`), with
  auto-pause off.

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
- "Flash the dash indicator" was read as a flash and cost a round. A word with two meanings
  should have been asked about.
- The hands' animation went in as a warning before anyone had looked at it frame by frame, so
  the first frame, under the ground, was a black dot for a round.
- The two playtests pulled against each other on the claws: one asked for a lot more, the other
  for fewer. Settle how often the set pieces come before tuning how they look.
- Her opener is often a charge, which leaves her at the edge, and a leash then swallows the
  attack a test was waiting for: the tests needed a `startFight` helper that resets her state
  and puts her back by the player. The flow field is stale after a test teleports the player,
  and her cooldown doesn't count while she rises.

## 9. Decisions, in one place

| Decision                                                | Why                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Grace 0.3 s, not 0                                      | One volley's touching petals shouldn't double-hit; standing in a spiral should still kill              |
| Tempo on pattern windups only                           | The big hits' warnings are what make deaths explainable                                                |
| Leash later, speed up, not closer                       | The player preferred being chased to being teleported to                                               |
| Range 18 on patterns                                    | Past it she walks or charges; standing far was free                                                    |
| Charge weighted as the top pick                         | It's the answer to a player who keeps away                                                             |
| Claws weight 4, long cooldowns, two rounds              | Each round's hands are up for seconds with nothing to do but stand clear; too many made them the fight |
| Bursts for sweeps                                       | A fast stream's gaps must be longer than a crossing takes; spacing single needles can't do that        |
| Hit radius 0.25 for the red streak, 0.3 for needles     | Drawn width, not bounding radius                                                                       |
| Red flash as a colour overlay                           | Asked for by name; the flowers don't say which side is which until they hurt                           |
| Nothing drops in a fight map                            | Simpler than marking each summon; the fight has no loot by design                                      |
| Her death played before the win                         | Asked for; `fallSeconds` is general and defaults off                                                   |
| Nightmare staff as the reward                           | The unused base staff, her own claws, nothing new from the cache                                       |
| Inquisitor not a reward                                 | Played nowhere else; the staff is enough                                                               |
| She rises at the middle, the player south and rooted    | The real fight's entrance; no running about while she wakes, and she attacks the moment it's over      |
| Eggs flung out of her, with a bar and OSRS's hint arrow | Seen to come from her; the player asked for the game's own arrow                                       |
| Hands are the whole mark, 0.75 tiles, more to a ring    | What's drawn is what's hit, kept by shrinking the mark rather than growing the hands                   |
| A mark hurts only while the hands are in sight          | Nothing's hit by what can't be seen                                                                    |
| The warning holds a frame of the hands up               | The animation's first frame is under the ground                                                        |
| The lane shows a second, then goes                      | Asked for; the windup animation is the warning after that                                              |
| The leash as a sink and a rise                          | Asked for; being there was a teleport                                                                  |
| Husks run, hold, and shoot nothing                      | Asked for: something to shoot down on the way, that costs the fight if it arrives                      |
| Nothing of hers can be pushed                           | Asked for; the player is the one that gives                                                            |
| Her charge on her walk animation                        | The charge's animation is her other form's, and tears her                                              |
| Totem yaw offset 768                                    | The scroll hangs behind the model's facing                                                             |
| The chamber round the square is all blocked             | Enemies and summons turn up anywhere walkable within 24 tiles; a walkable chamber strands them outside |
| An indigo floor, not the dream's black                  | The real floor is `#030303` under black slabs; her warnings are drawn faint                            |
| The Sanctuary's wall round the square, not the dream's  | The dream's ring pieces don't read from the play camera (section 12, round 2)                          |
| The sleepers lifted by a loc override                   | In the cache they stand on an upper level over the void; here there is no upper level                  |
| Boss-room locs, against the ScapeRune rule              | The ask was the real arena; the guide now says why                                                     |

## 10. Open

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
- **The map gone from the map screen**, reported once in the second playtest and not reproduced.
  The arena session met the same thing once with a cause of its own: the main checkout had been
  moved to `main`, which has no fight at all (section 12).
- **The arena on a phone**: its layout wasn't checked at a phone's size, and the north gate's
  view is the heaviest at about 68,000 world triangles against 34,000 in the middle.
- **The sleepers from above**: a figure a tile and a half tall, lifted, reads as a pale elongated
  shape from the play camera, as it does in the real arena. Nothing better was found.
- **Four pattern ideas from the research, not built** (section 13), each a new mechanism rather
  than a data field: a **curtain**, a wall of petals from one arena edge to the other with
  random holes, warned by a line on the ground (Hush's continuum, the classic wall); a
  **bursting orb**, a slow projectile that pops into a ring where it lands, so the danger is
  where you were going (the Dragun's rocket, Hush's splitting shots; a parasite egg in flight
  would fit); **sleep petals**, bullets that hurt only while you're moving, which inverts the
  survivors reflex and fits the spores' drowsiness (Undertale's blue attacks); and **darkness**,
  a few seconds with her ground warnings undrawn and only their sounds left (the real fight
  turns your prayer off in phase 3; Rumia's whole theme), risky on a phone, so short and rare.
  The fifth idea, a desperation finale, is stage 3's `finale`.

## 11. Fields added

For anyone building on this. From the pattern session (section 13): `BulletPatternDef.gapAt`,
`mirror`, `speedUp` and `around`; `BossAttackDef.follow`; `summon.distance`; `EnemyDef.objId`
and `hatches` (`Enemy.hatchTick`); `BulletEmitter.aim`; `BossState.follow`. From the hardening:
`BossDef.bulletGrace`, `fallSeconds`; `BulletPatternDef.channel`,
`burst`; `BossPhasesDef.phases[i].ambient`, `tempo`, `speed` and `finale`; `around: "player"`
on a ring of ground marks; `radius` on projectile attacks; `WeaponDef.impactFit`;
`CharacterDef.only`; `Hero.damageByAttack`. From the second playtest: `BossIntroDef.atMiddle`
and `holds` (and `Sim.introHolds`); `EnemyDef.healthBar`, `solid` and `hintArrow`;
`summon.thrown` (`Enemy.flung`); `GroundPatternDef.grab` with `seconds`, `fit` and `up`
(`GroundHazard.grabEnd`, `hit`; `Effect.fitRadius`); `BossPhasesDef.totems.yawOffset`;
`leash.jump` (`BossState.leap`); `HINT_ARROW_SPRITE`. Each is described in `docs/DEVELOPMENT.md`
under Boss fights as data and in `.claude/rules/adding-content.md`. From the arena:
`LocOverride.height` (lifts a model off the ground, in `src/rs/config/loctype/LocOverrides.ts`)
and `scripts/cache/dump-square.ts`, which lists what a real map square is made of, level by
level; both are in `src/game/scaperune/CLAUDE.md` under Shipping a map.

## 12. The arena: the Sisterhood Sanctuary

The arena is `src/game/scaperune/maps/sisterhoodSanctuary.ts`, which replaced the Inquisitor's
Field in a session of its own while the fight was being hardened. The ask was the real place: the
arena as OSRS has it, the cave in Slepe round it, the Theatre of Blood's dead adventurers, and
dead inquisitors if the cache had any.

### Where the pieces came from

Nothing was taken from the wiki's pictures. The cache's own map squares were read with
`dump-square.ts`, and each loc drawn with `loc-sheet.ts` and measured with `model-bounds.ts`:

- **The fight is a dream, not the Sanctuary.** "Disturb" sends you to map square 60,155: a
  22-tile square with a pure black floor (file underlay 72, which is the cache's 71) laid in 3x3
  slab locs, a ring of dark stone pieces stacked over three map levels, a gate north and south
  closed by an energy barrier, four totem locs in the corners, and round it an island of dead
  grass, nightmare flowers, dead trees, black fallen trunks and bats over the void (overlay 42).
  Six small armoured figures hang round it on the top level, bobbing.
- **The Sanctuary's chamber is on level 1 of square 59,152**, not level 0, which is why a first
  dump of it showed only her bed: a mosaic of solid slab locs. The chamber is the Sisterhood's
  masonry (37746 and its family), rock blocks (37754), Lumiere's candles, braziers, hooded and
  scythe statues, standing and lying coffins, chains and broken chains, rubble, the Pool of
  Nightmares and Phosani's coffin north of her bed, stairs and a camp.
- **The Theatre of Blood's dead** are the skeletons in Verzik's hall (32735), the armoured one in
  Ver Sinhaza (32741), a third (32742), and from Xarpus's room, which its script lays out rather
  than its square, the mercenaries' bodies (32754) and the corpses he exhumes (32743).
- **There is no dead inquisitor in the cache**, as loc or NPC. The Sisterhood's dead are their
  coffins and tombs, and the Inquisitor herself is Phosani, in hers north of the gate.
- Floor ids in a recipe are the map files' numbers, one above the cache's. Looking a floor up by
  the recipe's number reads the wrong floor, which is how the black came as a surprise.

### What it is

The one square in the middle is the dream, 64 tiles so the fight stays as tuned: a deep indigo
and slate floor with dead grass and the nightmare's flowers, and the middle kept clear where she
rises. Round it the chamber, 9 tiles of floor and then the Sanctuary's wall, rock blocks behind
it and the cave climbing to its roof. Beyond the north gate the pool, Phosani's coffin, two tombs
and two hooded statues; beyond the south one the scythe statues and the stairs, the camp to the
east and coffins to the west; all round, braziers, small statues, candles, chains, rubble, the
dream's dead trees and bats, forty of the Theatre's dead in their blood, and sixteen sleepers
hanging in the dark.

**Every tile of the chamber is blocked.** Enemies and scattered summons turn up anywhere walkable
19 to 24 tiles from the player, so a walkable chamber behind a ring would strand them outside.
The real arena is sealed by its barriers; this one is sealed by its collision, and the fight's
numbers didn't move: the balance bot dies at 0:41, 0:51 and 0:44 on three seeds on the old
arena and the new.

### Rounds

1. **The first build had a black arena, no gates, no statues and no barrier.** The black was the
   real floor, and the slabs over it draw black too; the indigo is Hallowed Night's palette.
   The gates, posts, barrier, pool and coffin had been refused by the recipe's own rule that
   keeps clutter off the gateway, and the big statues by a gap that reached into rock; a
   painted floor also counts as reserved, which quietly dropped anything on a dirt patch.
   Decision: things that belong on a gateway say so (`onWay`), and placement checks what's built
   (`footprint`), not what's painted.
2. **"There's a lot of broken map pieces scattered around."** Three screenshots. Each piece
   traced to an id: the dream's spikes are fragments of a wall stacked over three levels and
   draw as loose grey shards alone; its posts draw as flat framed plates; its fallen trunks as
   solid black bars; its Torii gates as a dark canopy from above; and the Sanctuary's cracked
   flags as chequered tiles. Decision: the ring is the Sanctuary's own wall on the tile past the
   arena's edge, facing in, a pilaster at each corner and either side of each gate, and the
   barrier kept, the one piece of the dream's ring that reads. The lesson: the loc sheet draws
   a small model small and a tall one by its bounds, so a piece has to be looked at in the game
   at a size that shows it.
3. **"Put the dead adventurers in the empty areas, and the floating inquisitors from the actual
   nightmare map."** The figures stand on the ground in their own model and float in the cache
   only by level. `LocOverride.height` lifts a model (model space points down, so the offset is
   negative), and each of the six gets a different lift. The raiders went from twelve to forty,
   each with blood on the tiles beside it. Two faults came out in the looking: the chequered
   plates still there were ids the sheet had shown as bones and pebbles (37786 to 37793), and
   the scatter helper had been putting half its placements on half tiles (an odd width divided
   by two), which is why some scatter counts had been low. Finding a lifted figure in a dark
   chamber took setting the renderer's brightness to 3 from the console; at the map's own it is
   a pale shape, as intended.
4. **"I meant dead adventurers as well from the Xarpus room."** His square holds only walls and
   battlements, so the bodies are the loc ids above. A floor list meant to drop the chequered
   flags in round 3 had missed, since Prettier had wrapped it onto two lines and the edit
   matched one; the build was counted before calling it done this time.

### Good and bad

- Reading the squares was the right research. Every id in the recipe is from the real places,
  and the wiki's text had none of the layout.
- The arena's test builds without the cache and pins what's placed: the wall ring to the tile,
  the gates, the pool, the coffin, the statues, the stairs, the dead and the sleepers.
- Three rounds were spent on pieces that looked right on the loc sheet and wrong in the game.
  Look in the game first, at a close camera, before building a ring out of anything.
- An edit that didn't apply went out as done once. Count the build.
- The session's worktree needed its own `node_modules` and a copied cache to run the game, and
  the branch had to be moved to the main checkout for the player to see it; that move is what
  took the map off the menu once.

## 13. Before the playtests: the patterns, the eggs and her track

The session before the hardening took the fight from the kit that mirrored The Nightmare (fans,
spiral, sweep, claws, charge, a gapped ring, lattice rings, a tracking barrage, hunting orbs) to
the bullet hell it is now. It was asked for as research first: read how bullet hell bosses are
built, then propose attacks. Everything below was built in that session; the hardening
(section 5) and the second playtest (section 6) then retuned most of it, so the numbers here are
the ones it began with.

### The research

Sparen's danmaku design guides, the Touhou wiki's pages on Rumia and Doremy Sweet, Enter the
Gungeon's Beholster and High Dragun, The Binding of Isaac's Hush, and the OSRS wiki's own page on
Phosani's Nightmare. Section 2's principles came out of it. Three more that shaped particular
attacks: an even fan straddles the player and an odd one aims at them, so an even fan pins them
in place for the next thing (Sparen); alternate direction each wave, so the habit the first wave
teaches is what the second punishes (Doremy's spiral turns one way on odd waves and the other on
even); and give the player something to shoot down mid-dodge (the Beholster's missiles, the
Dragun's knives lodged in the walls).

### Where each pattern came from

| Attack              | From                                                                | Tool it needed        |
| ------------------- | ------------------------------------------------------------------- | --------------------- |
| Turning wall        | Sparen's negative space: the gap is the attack, and it moves        | none (`gap`, `turn`)  |
| Pinwheel            | Touhou's curving suns: a straight line out walks into the hooks     | none (`curve`)        |
| Double sweep        | The Beholster's beam, as a bar through her                          | none (two-bullet fan) |
| Counter-spiral      | Doremy Sweet's spiral, odd waves one way and even the other         | `mirror`              |
| Sealing ring        | Hush's tight ring with its gap at Isaac; the next gap further round | `gapAt`               |
| Closing petals      | Sparen's stacks: same angle, several speeds, so they catch up       | `speedUp`             |
| Rings, then shots   | Rumia's Demarcation: slow rings, then an aimed volley after a delay | `follow`              |
| Scissors            | Two sweep arms opening from where you stand, one each way           | `mirror`              |
| Parted petals       | Sparen's even fan, then her claw on the tile you held still on      | `follow`              |
| The dream closes in | Doremy's Ochre Confusion: a ring round the player, flying in        | `around`, `gapAt`     |
| Rooted husks        | The Dragun's knives: turrets to shoot down under fire               | `summon.distance`     |

The rooted husks went in the second playtest (section 6, round 2): the player wanted husks that
run and hold, not ones that stand and shoot.

### The tools

Each was a few lines in `fireVolley` or `startPattern` and opened several patterns, which is why
they were built rather than the bigger ideas now in section 10: `gapAt` centres a ring's gap on
the aim or its opposite instead of a random angle; `mirror` fires each volley again mirrored
about the aim, so the second turns the other way (one emitter, no second state); `speedUp` adds
to each volley's speed by its index, with each volley's life from its own speed; `around` spawns
a ring's bullets on a circle round the nearest player, flying inward, recentred every volley so
the gap is the way out rather than running; `follow` queues a named attack from the moment the
first one fires and starts it at its delay through whatever is in the air, waiting only for a
hold. For an `around` ring, `gapAt: "away"` is the side towards her, which is why the dream's
way out is "run to her".

### The eggs

Asked for as the real fight's parasites, thrown out as eggs to break before they hatch, with the
Parasitic egg as the model. The cache has no egg NPC or loc for the Nightmare: `find-npcs`,
`find-objs` and `find-locs` over "egg", "parasit", "egg sac" and "larva" found only the pet's
item, 25838. So an enemy can be drawn as an item's model (`EnemyDef.objId`, baked as an `obj`
under the enemy's own key, one still frame that `getAnim` falls back to), and an enemy can
hatch (`hatches`: gone at its time with its `into` out where it stood, unless killed first).
They began at 300 hitpoints, three of them 6 tiles round the player, hatching at 9 s; the
second playtest made them 100, flung out of her, 11 tiles off, hatching at 15 s. At three times
scale they looked like boulders in the browser, so they're drawn at one and a half. Her
parasites were given the charging totem as a second heal target then, which the hardening kept
and made far stronger (section 5, round 7).

### Her track

The Bane of Ashihama is the OSRS Wiki's recording (5.2 MB, Ogg Vorbis, the same source and
licence as Massacre: Jagex's copyright, used with permission). The map had named it a session
earlier and the client already looked a track up by its file name, so adding the file was the
whole change, and the README credits the wiki for recordings.

### What the bot said

Nothing, as section 3 found: the Inquisitor died in phase 1 at 0:42, 0:21 and 0:28 on three
seeds before the patterns and 0:24, 0:29 and 0:42 after them.
