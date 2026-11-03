# Making Phosani's Nightmare significantly harder

Written against the `phosanis-nightmare` branch as of 2026-11-03, with the fight's numbers read
from `src/game/content/phosani.ts`, `maps.ts`, `characters.ts` and `src/game/core/Sim.ts`.
**Stages 1 to 3 have landed** on that branch (section 1 describes the fight before them);
stages 4 to 7 are still to do, and the playtest in section 5 is still to run.

## 1. Why the fight is easy now

The fight has a lot of patterns, but the sim plays them one at a time with long rests, and
four safety nets soak up what does land. Each point below names where it comes from.

**The player can only be hurt by a bullet once a second.** `BULLET_GRACE_TICKS` is 50 in
`Sim.ts`, and every bullet spares the player until it runs out. A 3-damage petal is the worst
any pattern can do per second, so with the Inquisitor's 30 hitpoints a player can stand in the
thick of a spiral for 10 seconds before dying. Nothing about a pattern's density matters past
the first bullet. Boss hits that aren't bullets (claws, melee, the charge) don't have this.

**Patterns never overlap.** When a pattern attack lands, `channelEnd` is set to the end of
its last volley, and `stepBoss` won't start anything until then. With her `attackInterval`
of 2.6 s and windups of 1.1 to 1.9 s, the player sees one pattern every 4 to 6 seconds, dodges
it in isolation, and rests. Only `follow` ever puts two things in the air at once, and it is
used twice. Bullet hell difficulty comes from layering (see section 2), and the fight has none.

**The arena is enormous and she lets the player use it.** The boss square is 64 tiles a side.
Her patterns reach 16 to 22 tiles, `keepDistance` is 6, and the leash only pulls her back when
the player is 16 tiles off. A ring can be walked between when its bullets are more than
1.5 tiles apart (two bullet radii of 0.4 plus two player radii of 0.35). Her densest ring is
30 bullets, which is passable anywhere beyond 7.2 tiles from her; the 22-bullet rings beyond
5.3 tiles. Since she stands 6 tiles off by choice, every ring she fires is a wall of gaps by
the time it reaches the player. Rings are decoration; only the aimed shots and the claws hit.

**Bullets are slow.** The Inquisitor moves 4 tiles a second (3.33 plus 20%). Rings and spirals
fly at 3 to 6 tiles a second and the hunting orbs at 6, so the player can outrun most of what
comes at them, and stroll out of a closing ring. The sweep and barrage at 13 to 14 are the only
things faster than walking.

**The healing is big.** Each totem blast heals 35% of max hitpoints (10.5 HP). Two blasts
happen before the last one ends the fight, so the player gets 21 of their 30 hitpoints back
over a run. That's two thirds of a bar, free, on a fight whose whole point is that nothing heals.

**The fight has no escalation.** Phased bosses skip the enrage (`stepBoss` checks
`!def.phases`), so nothing in her gets faster or denser by phase. Phase 3 adds five attacks
to a pool of twenty-odd, so the player feels no change of gear. In OSRS, Phosani's phase 3
switches off your protection prayer and phase 4 is a desperation stand; here phase 3 feels
like phase 1 with a different handful of random picks.

**Attack choice is a lottery.** `weightedIndex` over everything off cooldown. Her claws are
weighted 9 and most patterns 3, so the long-cooldown set pieces (Corpse Flowers at 60 s, Eggs
at 26 s) often never come in a phase, and a phase can be mostly Ranged, Magic and claws.
There's no rhythm of standard attack, standard attack, special, as the real fight has.

**The balance bot can't measure any of this.** `FLAT=1 MAP=phosani DODGE=1` has every
adventurer dead inside 25 s to 2.5 min in phase 1 (3 seeds each, run today). It sidesteps a
little and otherwise walks into everything, so its numbers are a floor, not a reading of how a
player fares. Human playtesting is the only measure for this fight (section 5).

## 2. What bullet hell design says

The research points the same way from several directions. The sources are at the end.

- **Legibility first, then difficulty.** Every write-up on good bullet hell bosses agrees that
  the player must understand why they died. Telegraph length should scale with how dangerous
  the attack is: a 3-damage petal can come with a short wind-up, a 15-damage charge needs its
  two seconds. The fight already does this well, so the plan keeps every big hit's warning and
  takes the ease out elsewhere.
- **More bullets does not mean harder.** Sparen's danmaku guide is blunt about it: structure
  and timing make the difficulty, not the count. A dense swarm with clear paths is easy; a
  sparse pattern whose arms form a wall at the moment you need to move is hard.
- **Macro-dodging and micro-dodging, blended.** Macro patterns (walls, rings that seal off the
  inside, a sweep) force big movement across the arena. Micro patterns (an aimed stream, a few
  bullets from several directions) demand attention to a small area. The best patterns layer
  one over the other, so the player has to go somewhere _and_ watch their feet on the way.
- **Layering sub-patterns is the easiest source of difficulty.** A slow ring with a rotating
  aimed spread over it is the textbook example. Offset their spawn times so each stays readable,
  and alternate where they come from so attention has to move.
- **Aimed bullets force movement; static ones make shape.** Pure danmaku is mostly unaimed
  shape. The aimed ones are there so the player can never stand still. A pattern that can be
  cheesed by standing in one spot is a bug.
- **Random seed angles, no blind spots.** A ring that always starts at the same angle leaves
  lanes that are never threatened. The fight's rings already start at a random angle unless
  `gapAt` is set; the plan keeps that and uses it on more.
- **Speed sets where attention goes.** Faster bullets widen the area the player has to track
  and lose the pattern's shape; slower ones let the player focus close in. Walls should be slow
  and dense, aimed streams a little faster than the player so they must be crossed rather than
  outrun. One jam write-up puts it as: common bullets at or below the player's speed, the
  aimed ones above it.
- **Negative space as a path.** A gap that moves round a ring over time (the Turning wall)
  leads the player along a path. Patterns can be made harder by making the path narrower or
  moving it against the player's instinct, without adding a single bullet.
- **Tempo should rise through phases like a song.** Phase changes should subvert or expand
  what the player learnt, not swap one random pool for another. Players feel escalation as
  tempo, not as a bigger list.
- **Small hitboxes make dense patterns fair.** Danmaku player hitboxes are tiny next to the
  sprite. The Inquisitor's 0.35 is already generous for a bullet hell; shrinking the bullets'
  hit radius a little lets rings be denser without feeling cheap. Not a difficulty lever on its
  own, but what lets the others be pushed.
- **I-frames are for crowds, not patterns.** A second or two of invulnerability after a hit is
  a convention for _dying_, and half a second is what people recommend against multi-hit
  frustration. A full second against every bullet is a shield, not a courtesy.
- **Space control.** Twin-stick bullet hells (Enter the Gungeon, Hades) get their hard bosses
  by taking the room away: hazards that stay, arenas that shrink, attacks that cover the far
  side so standing off isn't free. The fight has the tools (spores, the closing ring, the
  charge) and uses them as occasional picks.

## 3. The plan

Seven stages, each a change on its own with a before and after, in the order they should
land. The first three do most of the work; the rest make the fight hers. Numbers are
starting points to playtest from, not targets.

### Stage 1. Take away the safety nets

The fight should be hard because of what she does, so the soaks go first, before any
pattern is touched. All in `Sim.ts` and `phosani.ts`.

- `BULLET_GRACE_TICKS` 50 to 15 (0.3 s): long enough that one volley's two touching petals
  don't double-hit, short enough that standing in a spiral kills. If it must stay at a second
  for other bosses, make it a `BossDef.bulletGrace` and set hers.
- `blastHeal` 0.35 to 0.15: a totem blast gives back 4 or 5 HP, a reward for a clean totem
  stage, not a new bar. Update the "each blast heals" test's number.
- Petal damage 3 to 4 on the rings, spirals and spreads. Seven hits to die instead of ten.
  Keep claws (12), melee (12) and the charge (15) as they are: they're already half a bar, and
  they're the ones with the long warnings.
- The map's `difficulty.damage` 0.9 to 1. It rounds 3 back to 3 today, so it does nothing
  for petals and takes a point off the big hits. Simpler at 1.

### Stage 2. Let her patterns overlap

The single biggest structural change: she should start her next attack while the last
pattern's volleys are still coming. In `Sim.ts` `landBossAttack`, `channelEnd` for a pattern
attack becomes the length of its _first_ volley or two rather than all of them (a
`BulletPatternDef.channel?: number` in seconds, defaulting to the whole pattern for The
Nightmare so she plays as before). Hers: the slow rings and spirals channel for 0.5 s, the
sweeps and barrage for their whole length (they're aimed and need her facing).

Then a **background pattern per phase**: `BossPhasesDef.phases[i].ambient?: string`, an
attack by name that `stepBossFight` keeps firing on its own timer the whole phase, under
everything else, regardless of cooldowns and holds. Phase 1: a slow 5-arm spiral (speed 3,
turn 0.12, interval 0.3), the floor the fight is dodged on. Phase 2: a slow ring every 3 s
with a random seed angle. Phase 3: the counter-spiral at half density. These are the macro
layer; her aimed attacks are the micro layer over it. This is what the danmaku guide calls
the easiest way to make a pattern hard, and it turns twenty isolated set pieces into a fight.

Both need a test each in `Phosani.test.ts` (two emitters live at once; the ambient fires
through a hold and across a cooldown) and a look at `BossFightView` for bullet counts:
`MAX_BULLETS` is 1024 and a phase-3 ambient plus a ring plus a barrage is about 300.

### Stage 3. Escalation by phase

`BossPhasesDef.phases[i].tempo?: number` multiplying her `attackInterval` and every pattern
windup, and `speed?: number` for her walk, applied in `startBossAttack` where enrage's
multipliers already are. Phase 1 tempo 1, phase 2 0.8, phase 3 0.65: the same 2.6 s interval
becomes 2.1 then 1.7, and a 1.6 s petal windup becomes 1.0 in phase 3 while the big hits keep
theirs (a `windup` below 1.1 s is never shortened). The player feels the gear change on the
first attack of each phase, as the research says they should.

A **desperation finale**, as OSRS's phase 4: `BossPhasesDef.finale?: { seconds; attacks }`.
When the third blast lands, instead of `killEnemy` at once she has `seconds` (12) of continuous
claws on the player, sleepwalkers walking in, and the ambient spiral at double rate, and dies
at the end if the player is still up. It's the climax the fight lacks, and the one place where
a run that's been clean can still be lost.

### Stage 4. Close the space

She should fight the player in a square about 20 tiles across, not 64.

- `keepDistance` 6 to 3: she comes close, so rings reach the player while they're still dense.
- Done the other way round after playtesting: she walks at 3 tiles a second (was 1.7), quicker
  by the phase, and the leash is 22 tiles with her coming up 8 off, so she runs after the player
  and the sink-and-rise is for when they've got well away, not every few seconds.
- Done, the other way round after playtesting: her patterns' `range` (how far off the player can
  be for her to use them) is 18, about as far as they fly, so past that she walks after the
  player or charges instead of standing still firing at nothing, which is what let the player
  charge totems unbothered. `Surge` is weighted as her claws (9) with a 10 s cooldown, and reaches
  anywhere. Her barrage flies at 7 with 0.2 s between shots, and her orbs turn at 0.8 and give up
  at 18 tiles: a tracking stream at 13 was not steppable.
- `Spores` from phase 1, `armed` 14 to 25 s, so the floor fills up over a phase.
- `The dream closes in` and `Sealing ring` to every phase, and fired `around` the player at 9
  tiles, so distance from her is no help against them.

### Stage 5. Density where the player actually stands

With her 3 tiles off and bullets reaching 28, rings can be tuned to be a wall at 6 to 10 tiles
and a lattice beyond, which is where the fight now happens.

- Ring counts up so spacing is under 1.5 tiles at 8 tiles out: 34 bullets for a single ring.
  Cheaper and more readable: two rings of 18 a quarter-step apart (`Weaving petals` already
  does this with 14). Prefer the pair.
- Bullet hit radius 0.4 to 0.3 on rings and spirals, with `scale` keeping the petal the same
  size on screen: the danmaku hitbox trick, which is what lets the counts rise without the
  player clipping what they visibly missed. Say so in the pull request.
- Ring and spiral speed 4.5 to 6 stays (walls are slow). `Barrage` and `Hunting orbs` to 1.3
  times the player's speed (5.2) so they must be crossed, with `homing` 1.2 to 1.8.
- `Pinwheel` `curve` 0.7 to 1.0 and `Closing petals` `speedUp` 1.4 to 2: the hooks and the
  stack collisions are where Sparen's guide puts micro-dodging.
- Her two aimed spreads (`Ranged`, `Parted petals`) get a wider arc and one more volley, and
  `Ranged` fires with `track` on every other volley so standing between two shots stops working.

### Stage 6. Rhythm instead of luck

OSRS's Phosani uses a special every few standard attacks, drawn from a set of three that
alternates by phase. Give her that: `BossPhasesDef.phases[i].sets?: string[][]`, each set a
list of attack names she cycles through in order between standard picks, with the weighted
pool only for the standards (Ranged, Magic, Melee, the two claws). Phase 1 sets: [Husks, Turning
wall, Surge], [Corpse Flowers, Eggs, Sweep]. Phase 2: [Parasites, Sealing ring, Curse],
[Spores, Double sweep, Closing petals]. Phase 3: [Scissors, Grasping Claws (on you),
The dream closes in], [Parted petals, Hunting orbs, Rings then shots]. Every set piece is
seen every phase, every phase has a shape, and the lulls where everything's on cooldown go.
`follow` chains can then be three long (ring, barrage, claw) without fear of stacking two
set pieces by chance.

### Stage 7. Hard mode that's a harder bullet hell

Hard mode today multiplies her hitpoints and damage by 1.3 and the interval by 0.85, which
is a longer fight with the same patterns. Give the map's `hard` a `tempo` and `density`
instead: tempo another 0.85 on each phase, ring counts times 1.25, the ambient pattern's
interval times 0.75, and leave damage alone. Harder to dodge, not harder to survive hits.

## 4. What stays

Everything the research says makes a hard fight fair, and that the fight already has:

- Every hit above petal damage keeps its full wind-up and its warning on the ground. The
  claws' hands stay the exact size of what they hit.
- Rings with a way through keep the gap on the player's side; the way out is always shown.
- The player's speed and radius don't change. If anything feels wrong it's a pattern, not
  the player.
- Messages for the set pieces stay, shortened if the tempo makes them stack.
- The intro, the arena and the music are not touched.

## 5. Verification

The bot can't play this, so the measure is people. Before stage 1, record a baseline from
three runs by a player who knows the fight: time to the kill, hits taken by attack name, and
which phase a first-time player dies in. Nothing shows hits by attack today: the damage panel
is the player's weapons, and the bot's `damage taken` lines are by enemy. Stage 1 should add a
dev-only count of `playerHit` events by attack name, readable from `window.game.sim` in the
console, so every later stage can be measured the same way. Targets to tune to:

- A first run dies in phase 1 or 2.
- A learnt run takes 5 to 6 minutes and finishes under half hitpoints, with no blast heal
  carrying it.
- Most hits taken are petals, not claws: the patterns are the fight, the claws its punctuation.
- No phase has a 5-second stretch with nothing in the air.

For each stage: `npm test` (the Phosani tests named in section 3 change), `npx tsc --noEmit
-p .`, Prettier, and `FLAT=1 MAP=phosani DODGE=1 npx tsx scripts/game/simulate-run.ts "" 3`
before and after, read as a density meter only (how much of what hit the bot). Playtest in
the browser with `?autostart=inquisitor`, and on a phone's layout: the stick has to cross a
barrage too. The Nightmare on Hallowed Night must play exactly as before, so defaults on every
new field reproduce today's behaviour and `Nightmare.test.ts` stays green.

Each stage is its own pull request on top of `phosanis-nightmare`, with the changelog's
Unreleased entry amended rather than extended (the fight isn't released). `docs/GAMEPLAY.md`'s
Phosani paragraph, `docs/DEVELOPMENT.md`'s Boss fights as data and `.claude/rules/adding-content.md`
get the new fields as they land.

## Sources

- Sparen, Danmaku Design Guide, [density, layering and attention](https://sparen.github.io/ph3tutorials/ddsga4.html)
  and [bullet angles, seeding and aiming](https://sparen.github.io/ph3tutorials/ddsga2.html).
- Choost, [what makes the best bullet hell bosses](https://choost-site.pages.dev/blog/bullet-hell-games-best-bosses)
  and [what a bullet hell game is](https://choostgames.com/blog/what-is-a-bullet-hell-game/).
- NYU Game Center, [on readable bullet patterns](https://gamecenter.nyu.edu/?p=9284).
- Scoutski, [boss design: telegraph, react, punish](https://scoutski.github.io/posts/boss-design/).
- itch.io jam threads on [bullet hell tips](https://itch.io/jam/bullet-hell-v/topic/3751351/bullet-hell-tips)
  and [bullet speed against player speed](https://itch.io/post/12433835).
- shmups forum, [hitboxes and slow-bullet games](https://shmups.system11.org/viewtopic.php?p=329403).
- TV Tropes, [Danmaku](https://tvtropes.org/pmwiki/pmwiki.php/Main/Danmaku).
- Game Developer, [Exit the Gungeon: tighter spaces, denser patterns, smaller hitboxes](https://www.gamedeveloper.com/design/building-i-enter-the-gungeon-i-s-dungeon-climbing-spin-off-i-exit-the-gungeon-i-).
- OSRS Wiki, [Phosani's Nightmare strategies](https://oldschool.runescape.wiki/w/Phosani%27s_Nightmare/Strategies),
  for her sets, phase 3 and the desperation phase.
