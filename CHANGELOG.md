# Changelog

What's changed in Run Escape, newest first. The game shows this on its title screen too (click
the version in the corner).

## 0.24.1 - 2026-11-04

### Changed

- The map screen has a tab for each kind of map: Campaign, Bosses (boss fights and raids) and
  Fun. A map's details have a box of their own under the list, which scrolls for a long one.

### Fixed

- The Theatre of Blood couldn't be picked on the map screen: pointing at it pushed it out from
  under the pointer.

## 0.24.0 - 2026-11-03

### Added

- Raids, by Okaeri: the Theatre of Blood, a new section on the map screen. Six rooms one after
  another, each with its own waves and then its boss in its real room from OSRS, fought as a
  bullet hell. It's a melee raid: its bosses take far less from missiles and magic.
  - Raid points for each room, more for a fast, clean kill: they pay coins, buy food and potions from
    a supply chest between rooms, and better your chance of a purple from the chest at the end.
  - The Theatre's uniques for the Collection log, Lil' Zik, and two weapons: the Ghrazi rapier for
    beating it, and the Holy Scythe of Vitur for beating it on hard.
  - The raid runs through Morytania: each room fights its waves in a real place, from the woods
    outside Canifis to Vampyrium. Bones and coins left on a hall floor go with you to its boss.
  - Teleporters: once you've killed a room's boss, its hall has a portal straight to it (three a raid),
    to get back to the boss you're learning quicker.
  - Beat the raid on hard for expert mode, with more of the real raid's mechanics, twice the coins
    and Lil' Zik's looks.
- Phosani's Nightmare: a boss fight on its own, open once Hallowed Night's beaten. One fight in
  the Sisterhood Sanctuary under Slepe, with no waves, picks or items: everything The Nightmare
  has, quicker, plus bullet hell patterns, eggs that hatch parasites and husks that hold you where
  you stand. Everyone plays the Inquisitor, an adventurer made for the fight, with the Armadyl
  crossbow. It has a hard mode and a quest, and beating her brings the Nightmare staff, whose
  claws come up under enemies around you.
- Controller support, by Okaeri: move with the stick or d-pad, use items with the shoulder buttons
  and triggers, and pick level ups, caskets and menus with the d-pad and A. The hints show your
  controller's buttons, Xbox, PlayStation or Switch.
- Firemaking, a new skill, by Okaeri: up to 3 banishes a run. Banish a weapon or passive on a level
  up (pick another instead), or a casket's item (it's alched), and it won't be offered again that
  run. Banishing a set's piece banishes the whole set.
- Separate Melee, Ranged and Magic skill pages, by Deivid Smarzaro. Each can spend the full gold
  budget without taking gold from the others, refunds only touch the page you're on, and exported
  saves keep them.
- Single rank refunds, by Deivid Smarzaro: refund a skill rank with its arrow button, or right-click
  on desktop, without resetting the rest.
- Multiplayer shows where players are from: each open room has its host's flag and each player in
  a room theirs, the world list's own flags (a country without one shows its letters). Turn off
  Co-op flag in Settings to keep yours to yourself, unless you host an open room.
- A Frame rate setting, in Settings and the pause menu: Auto (60 on phones and tablets, no cap on
  a desktop), 30, 60 or Unlimited.

### Changed

- Co-op movement prediction, by trippy22: on by default when you join a game, and smoother: no
  camera nudges as you walk, no creeping or sliding back after you stop, and a glide rather than a
  jump after a dropped connection. It can still be turned off in Settings.
- Evolutions, rebalanced by trippy22: most gain less damage over their maxed base weapons, while
  keeping an upgrade at every level.
- Endless runs, by Okaeri: from about round 4, levels come about a dozen a round rather than
  thirty, so a weapon you pour everything into keeps up with the rounds rather than outgrowing
  them, and a long run gets harder instead of its numbers running away. The first rounds level as
  before.
- The game is lighter, most of all on phones: a run takes less memory to start, each frame does
  less work, and menus draw at 30 frames a second at most.

### Fixed

- Weapon cards and tooltips include fixed damage adjustments, including venom. Fixed by trippy22.
- Weaker poison and burning ground no longer take ownership of a stronger lingering effect. Fixed
  by trippy22.
- Co-op: a guest who misses some of the host's updates gets them again, rather than freezing.
  With a relay that supports it, a dropped connection reconnects within a few seconds and the run
  carries on. Fixed by Okaeri.
- Co-op: an item used just as the connection drops is used once it's back, and someone who joined,
  left or started a run just before a drop is remembered that way. Fixed by trippy22.
- Co-op: after buying from the Mysterious Old Man, or banishing a level up's reward, the menu's
  buttons work straight away, rather than doing nothing for a few seconds.
- Huge numbers stay short: the damage panel, stats and hitsplats go on past trillions to Qa,
  Qi, Sx and on, then powers of ten, rather than growing digit by digit. Fixed by Okaeri.
- In very long endless runs, bones no longer stop dropping once coins and food have built up
  around the map.
- The Nightmare's charge wind-up and sleepwalker animations tore her model apart, on Hallowed
  Night as well: they belonged to her other form.
- A phone taking the graphics away mid-run pauses a solo run, and Reload ends it keeping its coins
  and quests.
- Class skill tabs stay grouped on the left, with the selected page pressed in and green
  immediately, even while hovered. Fixed by Deivid Smarzaro.
- Coin icons stay visible while a changed stack size loads after buying or refunding skills. Fixed
  by Deivid Smarzaro.
- Maxed skills no longer look buyable, and touch long presses no longer refund ranks by accident.
  Fixed by Deivid Smarzaro.

## 0.23.0 - 2026-11-02

### Added

- Co-op revives: stand over a downed teammate for 5 seconds to bring them back. Each player can
  be revived once a run, with 75% of their hitpoints, and comes back untouchable for 5 seconds.
- Extra co-op revives: a Prayer cape, rarely in a casket or for sale from the Mysterious Old Man,
  lets a teammate revive you once more (with 50%, then 25% of your hitpoints).
- Hard mode in co-op: the host can turn it on once everyone in the room has it.
- Co-op results, by trippy22: a page for each player's own kills, damage, weapons and caskets, with
  arrows (or the arrow keys) to flip between them, and the party's totals underneath.
- Each weapon's damage during a run, by Okaeri: press Tab, or click or tap the DPS under the
  minimap, to see what each weapon is doing a second right now (the best first), its share, and
  its total. It stays open or shut as you left it.

### Changed

- Co-op's server holds up better against anyone trying to flood it or take every room.
- Co-op bosses come as a pair, or one for each player on hard mode, by trippy22. Between them
  they have one boss's hitpoints and loot, so a party fights more bosses rather than bigger ones.
- The Bow of Faerdhinen counts as a crystal bow for the Crystal armour set's bonus.
- A weapon level past its last (in endless runs) shows the weapon's damage bonus before and after
  on its card. Each pick multiplies what the weapon has, so a 15% pick at +477% gives +564%.

### Fixed

- With the game open in two tabs, only one saves, so they no longer undo each other's runs, coins
  and unlocks. The other offers to play there instead.
- A tab left open over an update no longer wipes progress from the newer version when it saves. It
  asks you to reload instead, or to save anyway and lose only what was new.
- A save that can't be read is kept rather than lost. The game tells you, and you can export it
  from Settings.
- If the game stops saving mid-run, a solo run pauses while it tells you why, and the pause menu
  says so afterwards.
- Killing the final boss wins the run, even if a hit lands in the same instant: it no longer counts
  as a death or uses up a ring of life.
- Co-op: two players with the same orbit weapon, like Elemental runes, no longer wipe out each
  other's circle.
- Co-op: a downed player can't reroll or skip level ups any more, so they can't spend the party's
  coins.
- Co-op: one player's Evil Bob finishing no longer ends another's Evil Bob timer early.
- Co-op: each player's Toktz-mej-tal burns ground of its own: another player's pulse no longer
  takes over your fire or puts it out.
- Durial321's task says what it takes: surviving 6:06 in Falador, not 6 minutes.
- Co-op: a double click or a quick second key on a level up, casket or random event no longer
  answers the next one too, unseen. Fixed by Okaeri.
- Pressing Enter or Space on a focused casket button no longer resolves the next casket as well.
  Fixed by Okaeri.
- Co-op: a tab left in the background no longer builds up effects to draw all at once when you come
  back. Fixed by Okaeri.
- Item icons that failed to draw are tried again, rather than staying blank until the game's
  reopened.
- Endless: a run no longer holds on to every boss it's had, so very long ones use less memory.
- Co-op: waiting on the Multiplayer screen for a room to appear no longer drops the connection
  after 10 minutes.
- Varlamore on a phone: its bosses' animations took several times the memory of any other map's,
  which could crash the game as the run loaded. They now take a third of it.

## 0.22.1 - 2026-11-02

### Added

- Movement prediction, a trial you can turn on in Settings or the pause menu: joining a co-op game,
  you move as soon as you press, then correct to the host. Hits and pickups still follow the host.
  Thanks to trippy22, who built it.

### Changed

- Multiplayer bosses spawn in pairs, or one per player in hard mode; Hallowed Night's final Nightmare fight stays a single boss.

## 0.22.0 - 2026-11-01

### Added

- Hard mode for solo runs on every map, once you've beaten it (fun maps from the start): more
  enemies, tougher and harder hitting, twice the elites, bosses that enrage sooner and attack faster,
  and 25% more coins.
- Put the game on your phone's home screen from your browser's menu: it gets its own icon and opens
  full screen.

### Fixed

- Exporting your save from the home screen on an iPhone or iPad opens the share menu, instead of a
  tiny sheet you had to scroll inside.

## 0.21.0 - 2026-11-01

### Added

- Co-op, built by trippy22: play a run with up to three friends. Make a room that's invite only
  (by its code or an invite link) or open to anyone, ready up, and the host picks the map. Everyone
  brings their own adventurer and progress, levels are shared with a pick each, and the run goes on
  while anyone's still standing. Winning on a map you haven't reached yet in a friend's party opens
  it for you. Anyone who keeps everyone waiting for 20 seconds has their pick made for them.
- Co-op names: everyone gets a readable name to play under, like "Plucky Chinchompa", and rooms get
  one too. New name picks another.
- Co-op on the desktop version too, for anyone with the new download.

### Changed

- A tidier main menu: Singleplayer and Multiplayer up front, smaller tiles for Skills, Armoury,
  Quests and the Collection log, and more of the world in view.

## 0.20.1 - 2026-11-01

### Added

- A Windows desktop version: unzip it, run it, and it plays offline and keeps itself up to date.
- A GitHub link beside the Discord one on the title screen.

### Changed

- The Inferno's Jal-ImKot are fairer: they come up further from you, slowly, one after another, and
  can't hit until they're up. They also have less health and hit a little softer.
- Bats and aviansies now go round cave walls and mountains instead of flying over them. They still
  fly over fences, buildings, trees and water. Only ghosts and the Ankou go through everything.

### Fixed

- The quest tracker no longer shows quests that can't be done on the map you're on, like Ratcatchers
  in the Inferno.

## 0.20.0 - 2026-10-31

### Added

- Hallowed Night, a Halloween map: a graveyard hamlet in a pumpkin patch at night, open to everyone
  from the start. Fifteen minutes of the restless dead, with Slash Bash, The Mimic and The Nightmare.
- The Nightmare: a three-phase final boss fought like a bullet hell. Break her shield, charge the
  four totems, and dodge what she throws at you, all marked on the ground before it lands.
- New boss: Slash Bash. His disease stacks up, a little slower and weaker each dose, and his bile
  leaves pools you won't want to stand in.
- New boss: The Mimic. Not every master casket is what it seems. It flings candy that brings its
  Third Age minions, and its stomp hurts more the longer you stay under it.
- Trick or treat: enemies on Hallowed Night sometimes drop a pumpkin. Walk over it for a treat
  (healing, coins, a sugar rush) or a trick (ghosts, a curse).
- New weapons for killing The Nightmare: the Inquisitor's mace, which crushes the undead, and the
  Volatile Nightmare staff, whose Immolate burns big things hardest.
- The Collection log has a Hallowed Night page: the Jar of Dreams and Little Nightmare from The
  Nightmare, and halloween masks and a Scythe hidden in pumpkins.
- Four new quests on Hallowed Night.

### Changed

- Ancient spells: level ups only offer Ice Burst now. Beat the Desert and its second level lets you
  pick which burst you want for the run.

## 0.19.2 - 2026-10-31

### Fixed

- The Mysterious Old Man's and Quiz Master's screens have room between their choices and buttons.
- Random event visitors come and go in a puff of smoke, not a flash of purple on the ground.

## 0.19.1 - 2026-10-31

### Added

- Random events: every few minutes someone turns up near you for 30 seconds. Walk up to them to see
  what they want.
- The Mysterious Old Man sells power-ups for coins, and his prices climb as the run goes on.
- The Quiz Master asks which item is the odd one out, with a power-up for the right answer.
- The Genie grants experience, Rick Turpentine drops a casket, and a Strange plant's fruit makes you
  faster and safe from poison for 20 seconds.
- The Sandwich lady heals you, but ignore her and she throws her baguette at you.
- The Highwayman ambushes you later in a run and steals coins until you take them back.
- New shop upgrade, Runecraft: power-ups drop more often.

## 0.19.0 - 2026-10-31

### Added

- Early support for phones and tablets: drag anywhere to move, and tap on-screen buttons to pause
  and use items.
- Every screen now fits a phone held sideways, with a nudge to turn it if it's held upright.
- A DPS meter under the quests shows how much damage you've been dealing, from everything, over
  the last 8 seconds.
- New setting, Auto alch: high alch every chest as you open it, with no chest screen and no pause.

### Changed

- Past 15 minutes in an endless run, chests are five times as likely to drop (25%, up from 5%), and 25
  can lie on the ground at once, up from 10.
- The game draws far less of the map on busy maps: only what's on screen, not everything nearby.
- The game starts much faster and uses far less memory. Each map's monsters now load when you set
  off for it, so the first run on a map takes a moment longer to start.

### Fixed

- Sound starts properly from the first tap on touch screens.
- Losing the graphics, which phones can do to a game in the background, now says so instead of
  leaving a black screen.

## 0.18.0 - 2026-10-30

### Added

- New power-up: the Sled. Ride for 8 seconds at more than twice the speed, shoving the crowd aside
  with nothing able to hurt you.
- New power-up: the Giant rune essence. A huge rock lands on the thickest crowd nearby.
- New power-up: Evil Bob. A giant cat charges through the crowd three times, throwing it aside.
- New power-up: the Fairy ring. A ring opens at your feet for 12 seconds and warps away whatever
  walks into it.
- New power-up: the Drill Demon. Everything nearby runs laps around you for 9 seconds and can't
  attack.

### Changed

- The player now stands and runs the way their weapon does in OSRS: a two-handed run with 2h swords
  and godswords, staves held out, crossbows at the ready, and so on.
- The same power-up no longer drops twice in a row.
- Toktz-mej-tal's burning ground is real fire now, flickering, with more flames across each patch.
- Past 15 minutes in an endless run, a chest that would drop only has a 5% chance to, and only 10
  can lie on the ground at once. A round's master casket always rolls through, though not past the
  limit.

### Fixed

- Two-handed weapons no longer leave a shield strapped to your arm. The shield still counts, it's
  just not shown while you hold one.
- Prifddinas's walkways and bridges are whole again instead of leaving pieces floating in the air.
  Only the buildings' roofs and the towers' domes are gone. A few stray roof edges went from
  Barrows too.
- Enemies only turn up where you could stand and walk to, so rings of enemies, summons and ghosts
  no longer appear behind walls or inside rock. East Varrock's enemies still come from both sides
  of the ditch, since they jump it.
- In the God Wars Dungeon and Castle Wars, an enemy with a wall between it and the other side for 3
  seconds gives up and comes for you for good, rather than standing at the wall.

## 0.17.2 - 2026-10-30

### Fixed

- Caskets no longer land inside Pest Control's portals or other spots you can't walk to, where you
  couldn't pick them up. Power-ups are fixed the same way.

## 0.17.1 - 2026-10-30

### Changed

- Caskets no longer flood you with a set's missing pieces: the odds of one are down from 30% to
  15%, and a piece can only be one rarity above what the casket rolled, so very rare sets like
  Torva stay rare. Alch or reroll a piece of a set you've started and caskets stop bringing that
  set for the rest of the run.
- Crystal armour now comes in with beating Prifddinas. Saves that have already beaten it keep it.

### Fixed

- The Grand Exchange has its walls and booths back, and scenery that had gone missing from other
  maps' buildings is back too.

## 0.17.0 - 2026-10-30

### Added

- Collection log: every evolution's recipe, and what it makes once you've made it.
- Nine new evolutions for the Scythe of Vitur, godswords, Dragon claws, Dragon warhammer, Dinh's
  bulwark, Twisted bow, Tumeken's shadow, Sanguinesti staff and Harmonised nightmare staff.

### Changed

- Level up cards say what evolves with what.
- The HUD and pause menu show what a weapon needs to evolve, and its slot glows when it's ready.
- Evolved weapons have 3 levels.
- A notice and a sound when a weapon evolves.

## 0.16.0 - 2026-10-30

### Added

- Thunder khopesh: a melee weapon whose special hits everything around you.
- Chivalry: a passive with more melee damage and more max hitpoints.
- Dinh's bulwark: a slow melee weapon that hits everything around you, far out.
- Smithing and Crafting skills: up to 2 more weapon slots and 2 more passive slots.
- Woodcutting skill: more melee knockback.

### Changed

- Melee weapons only swing when something's in reach.
- Melee weapons hit harder, and slashes are wider.
- Melee weapons show their Knockback, and every other level raises it.

## 0.15.0 - 2026-10-30

### Added

- Skip a level up (X) for coins: 25, then doubling each time.
- Run stats when a run ends: damage, kills and DPS per weapon, plus hits, healing and boss times.
- Music volume slider on maps with music.
- Dividers between the pause menu's columns and sections.

### Changed

- Level up cards, the pause menu and the HUD show weapon stats.
- The Armoury shows a piece's stats before and after an upgrade.

### Fixed

- Prifddinas's roofs no longer hide its buildings.

## 0.14.0 - 2026-10-29

### Added

- Four campaign maps: Morytania, God Wars Dungeon, Prifddinas and the Inferno.
- Two fun maps: Castle Wars and Pest Control.
- Ten adventurers.
- Twelve quests, and a quest tracker during runs (Q).
- Class weapons: Godsword (pick its hilt), Dragon claws, Ivandis flail, Armadyl crossbow, Crystal
  bow, Crystal staff and Toktz-mej-tal.
- Every weapon can evolve, with eight new evolutions.
- Passives: Rigour, Augury and the Ancient sceptre.
- Gear sets with bonuses: Void knight, Inquisitor's, Crystal, Torva and Virtus.
- New casket gear and Armoury lines, including the Desert Treasure II rings.

### Changed

- Enemy projectiles are bigger and outlined.
- Quests don't count on fun maps.
- The map list is split into campaign and fun maps.
- Ice Barrage counts as an Ancient burst.
- Weapons don't fire at shielded enemies.
- The boss bar shows the nearest boss, or the final boss.

### Fixed

- The minimap could stay black at the start of a run.

## 0.13.0 - 2026-10-29

### Added

- 22 quests that pay banked coins.
- Amulet of blood fury.

### Changed

- Bones and coins gather into piles.
- Blood Burst heals more.
- The King Black Dragon is full size.
- Old-school scroll bars.

### Fixed

- Spell and boss sounds that played Ice Burst's.

## 0.12.0 - 2026-10-28

### Added

- Fun maps, open and endless from the start: Grand Exchange, East Varrock, Falador and Last Man
  Standing.
- Four adventurers from the fun maps.

### Changed

- Monk's weapon speed bonus is down to 15%.
- Endless runs pay fewer coins.
- Endless rounds get harder faster.

## 0.11.0 - 2026-10-28

### Added

- Endless mode for beaten maps.
- Weapons and passives level past their max in endless runs.
- Armoury: upgrade casket gear for good with banked coins.

### Changed

- Scenery only blocks where it stands.
- The world fades out past the map's edge.

### Fixed

- Old bones far away no longer keep their experience for good.

## 0.10.1 - 2026-10-28

### Added

- Auto-pause setting.
- Discord link on the title screen.

### Changed

- New adventurer screen.
- Settings menu on the title screen.

## 0.10.0 - 2026-10-27

### Added

- Five campaign maps: Kharidian Desert, Fremennik Province, Karamja, Kourend and Varlamore.
- Ten adventurers.
- Map tasks that unlock weapons, passives and gear.
- Eight class weapons, the rest of the Ancient bursts and four evolutions.
- Rerolls (R).
- Save export and import.
- Thrownaxes, elemental runes, the Toxic blowpipe and the Sanguinesti staff.

### Changed

- Harmonised nightmare staff nerfed.
- Antipoisons only drop where something poisons you.

## 0.9.0 - 2026-10-26

### Added

- Adventurers unlock by beating maps and doing tasks.
- Six adventurers.
- 2h swords and shortbows.

### Changed

- 25 hitpoints instead of 100.
- The adventurer screen fits smaller windows.

## 0.8.0 - 2026-10-26

### Added

- 48 pieces of gear and 10 utility items.
- Bosses enrage at half their hitpoints.
- Option to stop the menu camera spinning.

### Changed

- Bosses are tougher.
- The hosted game downloads a 12 MB cache.

## 0.7.0 - 2026-10-26

### Added

- Minimap.
- Barrows and Wilderness monsters.

### Changed

- Renamed to Run Escape.
- The interface scales up on bigger windows.
- The game can be hosted in a folder.

## 0.6.0 - 2026-10-26

### Added

- Power-ups: Dwarf multicannon, Book of the Dead, Bot nuke, Magnet and Giant stopwatch.

### Changed

- The Dwarf multicannon is a power-up instead of a weapon.
- Thralls and the cannon are bigger, hitsplats smaller.

### Fixed

- Cannonballs splashed everything in range.
- Hitsplat numbers were off-centre and blurry.

## 0.5.0 - 2026-10-26

### Added

- Class weapons for Melee, Ranged and Magic, from Rare godswords to the Very rare Scythe of
  Vitur, Twisted bow and Tumeken's shadow.

## 0.4.0 - 2026-10-26

### Added

- Maps that open in turn: Lumbridge, the Barrows and the Wilderness.

### Changed

- The Barrows brothers and the King Black Dragon moved to their own maps.

## 0.3.0 - 2026-10-26

### Added

- Bosses, with the Wise Old Man as the final boss.
- Freeze, poison and drain effects on the player.

### Changed

- Count Draynor is a mid-run boss.
- Hitsplats are the client's own.

## 0.2.0 - 2026-10-26

### Added

- Reward caskets.
- Gear, worn on your character.
- Utility items (1-4).
- Loot beams and off-screen casket arrows.

### Fixed

- The multicannon aimed the wrong way.
- Item icons were drawn inside out.
- Health bars look like the client's.

## 0.1.0 - 2026-10-26

### Added

- First playable version: survive fifteen minutes in Lumbridge.
- Weapons, passives, evolutions and rarities.
- Levels on the OSRS experience table.
- Banked coins and skills.
- Sound effects from the cache.
