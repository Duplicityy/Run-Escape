---
paths:
    - "src/game/content/**"
    - "src/game/core/**"
---

# Adding content

Content is plain data in `src/game/content/`, typed in `types.ts`, and the comments there explain
each field. Find a similar entry, copy its shape, and look up real ids in the cache:

```sh
npx tsx scripts/cache/find-objs.ts "dinh's bulwark"      # items
npx tsx scripts/cache/find-npcs.ts "^count draynor$"     # NPCs and their idle and walk animations
npx tsx scripts/cache/find-npc-seqs.ts 655               # animations an NPC's model can play
npx tsx scripts/cache/classify-npc-seqs.ts 655 6182 6183 # tell attack and death animations apart
npx tsx scripts/cache/find-locs.ts multicannon           # scenery
npx tsx scripts/cache/sounds.ts seqs 390                 # sounds an animation plays
```

Attack sounds aren't in the cache: the ids come from the OSRS Wiki's list of in-game sound IDs.

Whatever you add, follow the checklist in `CLAUDE.md`: tests, simulations, changelog and docs, and
say in the pull request if it uses anything new from the cache. `docs/GAMEPLAY.md` lists most
content, so add new entries to its tables and lists.

## Weapon

Add it to `WEAPONS` in `weapons.ts`.

Damage tuning by style, evolution, weapon and run mode is in `content/balance.ts`; see
`docs/BALANCE.md`. It applies at damage time, so don't fold those multipliers into a weapon's
levels or secondary attacks as well. Keep the originating weapon's damage source on delayed effects.

- `kind` decides how it attacks and what each level's numbers mean: `slash`, `sweep`, `missile`,
  `knives`, `axes`, `aura`, `strike` or `orbit`. The `fire*` methods in `Sim.ts` do the work, and
  `statFields` in `weaponStats.ts` lists the stats each kind shows.
- `style` makes it a class weapon, only offered to adventurers who fight that way. Set
  `damageStyle` only for exceptions (see its comment).
- `unlock` brings it in through a task on a map. Without one it's there from the start.
- `evolution` needs a passive, and the weapon it becomes needs `evolved: true`, `evolvedLevels` for
  its 3 levels, and `style`/`family` kept from what it evolves from. Set `damage` to a three-value
  array for a tuned curve, or a number for the default progression. Recipes in `evolutions.ts`
  and the Collection log come from these fields, so they need no extra entry.
- A `sweep` with `arc: Math.PI` hits all the way round. `special` replaces every so many swings of
  a slash or sweep, and `special.aoe` hits all round.
- Every other level of a slash or sweep adds knockback automatically, from the loop after
  `WEAPONS`. Don't add those steps by hand.
- `burns.locId` is scenery for the flames on burning ground. `getBaseRequests` bakes it with the
  loc's own animation (`animated` on a loc request); other locs are baked static. Not every loc's
  model moves with its animation: `scripts/cache/find-locs.ts` gives the seq, but check it flickers.
- A strike's `impactFit` scales its impact spot animation to the strike's radius and plays it out
  in full (the Nightmare staff's hands), instead of a moment of it as it is.
- A swoosh colour goes in `SLASH_COLORS` in `client/GameView.ts`.
- Check the player's animation (`playerSeq`) in the browser. A seq id existing doesn't mean it
  suits the weapon.
- If the item doesn't use the plain human stance, add it to `STANCES` in `stances.ts`. The cache
  doesn't say which stance an item has, so the file says where to look it up.

## Passive

Add it to `PASSIVES` in `passives.ts`. `perLevel` is what a Common pick adds, and `alsoAdds` puts
the same amount on more stats. `iconSpriteId` shows an interface sprite instead of the item.

## Stat

Add the key to `StatKey` and `emptyStats` in `types.ts`, and to `STAT_INFO` in `stats.ts`.
TypeScript points out what's missing. A stat does nothing until `Sim.ts` reads it, from `this.stats`
(everything added up) or `this.metaStats` (the shop's alone, and set before the constructor adds the
starting weapon).

## Shop upgrade

Add it to `SHOP_UPGRADES` in `shop.ts`, themed as an OSRS skill, with its `stat`. Costs and
refunds come from `getUpgradeCost` and the save code. New ones don't need a save migration.

## Gear and utility items

`items.ts`: gear goes in `CASKET_GEAR`, and utility items in `UTILITY`. `armoury.ts` says what each
piece upgrades into, and `sets.ts` has the set bonuses. Run `scripts/cache/check-items.ts` afterwards.
A utility item with a new `ItemUse` kind needs a case in `Sim.useUtility`, a sound in
`USE_SOUNDS` in `client/GameSounds.ts`, and if it's only for some runs (the Prayer cape's extra
revive, co-op only), its weight in `itemWeight` in `core/Loot.ts`.

## Power-up

Add it to `POWER_UPS` in `powerups.ts`, with a `PowerUpEffect` kind in `types.ts` and a case in
`Sim.usePowerUp`. `objId` is the icon, and what lies on the ground unless `locId` is set.

- `look` is an item held and two player animations for as long as it lasts. It's baked with the
  player, and `slim-cache.ts` picks it up from there (`getPowerUpLookRequests`). Only player
  skeleton animations work, and the item's worn model matters: a look needs both.
- `sound`, `endSound`, `hitSound` and an effect's `locId` and `spotAnim` are collected for you, and
  a `rampage` effect's NPC too. Anything else from the cache needs adding to `getGameSoundIds`,
  `getSpotAnimIds` or `getBaseRequests`, or the deployed game won't have it.
- Anything meant to stop all damage has to hold `player.invulnerable` above
  `HIT_INVULNERABLE_TICKS` every tick, as the sled does in `stepPlayer`. A timer running down lets
  boss hits and poison through near the end.
- Give it a `price`, what the Mysterious Old Man charges before the run's time and the map's coins.

## Random event

Add it to `RANDOM_EVENTS` in `randomEvents.ts`, with a `RandomEventEffect` kind in `types.ts` if the
existing ones won't do, and a case in `Sim.meetVisitor` (`startRandomEvent` for an `ambush`).

- A visitor's `npcId` is baked on every map by `getBaseRequests`, and an `ambush` enemy by
  `getMapEnemies`. `idleSeq` must be a seq the NPC's model can play: `find-npcs.ts` gives its own.
- An effect's `sound` and a `buff` effect's `objId` are collected for you. Anything else from the
  cache needs adding, as with power-ups.
- Events roll on the sim's `eventRng`, not `rng`, so adding one doesn't send every seeded run down a
  new path. Keep what they decide on it too.
- `state === "event"` pauses the run for an offer. The sim's bot answers those in `eventChoice` in
  `simulate-run.ts`, so it needs to know a new kind of offer.

## Enemy or boss

Add it to `ENEMIES` in `enemies.ts` (fun map ones go in `fun/enemies.ts`), with its NPC id,
animations, sounds and stats. Tests check that every enemy a map or boss refers to exists, and
that every boss attacks. It's baked for the maps that use it (`getMapEnemies` finds its id wherever
a map, or an enemy on that map, mentions it), so that needs nothing added.

- `ghost` goes through everything, and is only for what's really a spirit. Anything with wings gets
  `flies`: over fences, walls, trees and water, and round terrain (`world/FlightGrid.ts`).
- A `blinks.surface` seq is baked like `blinks.seq`, and needs to be one the NPC's model can play.
- `holds` has an enemy pin the player where they stand once it reaches them (Phosani's husks), and
  a boss's `summon.scatter` brings its summons on wherever a wave's enemy would, so there's time to
  kill them on the way. `summon.thrown` flings them out of the boss to spots `distance` tiles off,
  unhittable in the air, `healthBar` on an enemy keeps its bar over it from the start, and `solid`
  means the player can't push it, and `hintArrow` puts the game's hint arrow over it. A ground
  attack's `grab` plays its `middleSpotAnim` out in full where each mark lands, `fit` times the
  mark's radius across, hurting whoever steps in while it's up, and a boss's `leash.jump` names
  the down and up animations it leashes with. A phased boss's `totems.yawOffset` turns a totem model whose mark isn't on
  its front towards the middle.
- A boss's `intro` can rise it at the middle of the map's `bossArena` with the player south of it
  (`atMiddle`), and root the player until it's over (`holds`), after which it attacks at once.
- A boss attack's `chain` repeats it straight after (dashes back to back, claws in rounds),
  `toMiddle` takes the boss to the arena's middle first (with its leash's jump, if it has one,
  the windup running from when it's there), a quarters attack's `during` says what it
  does among its flowers, and a pattern's `gap` and `track` make a ring with a way through and a
  stream that follows the player; `gapAt`, `mirror`, `speedUp` and `around` shape a ring further,
  and `follow` names the attack that comes after. An enemy with `hatches` turns into others
  unless it's killed in time, and one with `objId` is drawn as an item (Phosani's eggs). A
  pattern's `channel` is how long the boss stands still for it (the whole pattern unless set),
  its `burst` fires so many volleys and then pauses (holes along a sweep's arm), a
  boss's `bulletGrace` how long after a bullet hits before another can (a second), a final
  boss's `fallSeconds` how long its death plays before the victory screen, and a phased boss's
  phases each take an `ambient` pattern it keeps up on its own, a `tempo` and a `speed`, with a
  `finale` after the last blast. Boss fights as data in `docs/DEVELOPMENT.md` has the lot.
- In co-op a boss event spawns copies (`bossCopies` in `content/coop.ts`) that share one boss's
  hitpoints, experience and loot. One with `spawnAt` gets no more copies than it has free spots.

A new boss attack in `Sim.ts` that hits where the player stands has to hit each player in co-op:
check them with `forEachHeroInReach`, and keep anything it leaves on a player on their `Hero`.
`coop.test.ts` has a test to copy.

## Anything in the sim, for co-op

Co-op in `docs/DEVELOPMENT.md` has the rules: a player's own state goes on `Hero`, something that
lingers carries `hero` and acts through `useHeroAt`, a new event about one player goes in
`PERSONAL_EVENTS`, `this.player` means nothing outside a loop over the heroes, and trigonometry
goes through `fm`. A solo run has to play exactly as before: compare a sim with `main`'s.

## Map

Add it to `MAPS` in `maps.ts` (fun maps go in `fun/maps.ts`), with its waves in `waves.ts`.

- `arena` is in world tiles and is what collision is built for. `spawn` must be inside it.
- Set `plane` for dungeons above the ground floor.
- The game draws one plane, and hides roofs. If a map's roofs are plain scenery rather than the
  roof loc types, or something floats, see `src/mapviewer/webgl/loc/UpperLevels.ts`.
- Campaign maps unlock in the order of `MAPS`. A `seasonal` map goes after them in `MAPS`, is open
  from the start and has no place in the chain. Rewards come from `unlock` tasks on weapons,
  passives, items and adventurers.
- A map with `fight` is one boss fight (Phosani's Nightmare): `waves: []`, one `finalBoss` event
  at 0 whose boss has an `intro` with `alone`, and it opens once `fight.requires` is beaten. There
  are no picks and no items: everyone plays `fight.character` there (`getMapCharacter` in `maps.ts`
  is what reads it, and a fun map's `character`), an adventurer made for the fight and kept to it
  (`only` on the `CharacterDef`: never in the roster, never unlocked), whose starting weapon
  begins at `fight.weaponLevel`. Nothing in the fight drops
  experience, so that kit is the whole run, and the boss's hitpoints (the event's `hp`) are tuned
  to it. The spawn is the middle of the boss square, where the entrance puts the player anyway.
  The bot keeps away from bosses, so with nothing but melee it walks up to a shielded one and
  takes her swings: its numbers say how long the kit takes, not how a player fares. It's listed
  under Boss fights on the map screen, and can't be endless. Sim it with
  `FLAT=1 MAP=phosani DODGE=1`, which needs no cache, and go by how long the bot lasts and what
  hits it (its `boss attacks that hit` line says which of the boss's attacks did it): it can't
  dodge as a person does.
- Check it in the browser: the minimap, the spawn, and that enemies can reach you. The sim's bot
  uses the real collision, so a sim also shows whether a map plays at all.
- Fun maps don't count towards quests.
- `hard` is what hard mode multiplies its enemies' hitpoints and damage by (`hard.ts` has the rest of
  hard mode, and the numbers for a map that doesn't set its own). Sim it against normal with `HARD=1`.
- A map that isn't a slice of the real world is a ScapeRune recipe, and one that ships goes in
  `scaperune/maps/shippedMaps.ts` with `scaperune: true` on its `MapDef`: see
  `src/game/scaperune/CLAUDE.md`, which also has a random generator.

## Adventurer

Add it to `CHARACTERS` in `characters.ts`, with a `style`, `startingWeapon`, `equipment`, `bonus`
and usually an `unlock` task.

## Quest

Add it to `quests.ts`. Tests check every quest can be done, so its enemy ids must exist.
