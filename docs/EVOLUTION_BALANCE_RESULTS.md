# Controlled evolution balance validation

Before: upstream `main` at `40a0460`, original weapon levels. After: the weapon damage controls and controlled evolution curves in this PR, with `WEAPON_DAMAGE_BALANCE = {}`.

## Full progression runs

1,026 planned seed cases per revision: every shipped map, warrior/ranger/wizard, seeds 1–3, solo/2/4 players, normal/hard, `META=max`, `ARMOURY=max`. There are 1,013 matched completed pairs; 13 pairs with a simulator error on either side are excluded from both sides' statistics and listed below. Standard `scripts/game/simulate-run.ts` progression and decisions are used, with per-seed error capture, no forced evolutions and no shortened run limit. One process per map runs each party/difficulty/adventurer combination. Each case uses these settings:

```sh
MAP=barrows META=max ARMOURY=max PARTY=2 HARD=1 npx tsx scripts/game/simulate-run.ts wizard 3
```

The standard limit is 17 minutes (`RUN_LENGTH + 120` seconds). Fun maps are endless and have no victory, so their time-cap completions are reported separately. Mean run length includes deaths, wins and timeouts; a longer run alone does not establish better balance. Three seeds per adventurer/case are a small sample, and the bot handles strike weapons and co-op teamwork poorly. Changing damage also changes later RNG paths.

### Campaign and seasonal maps

| Mode              | Runs each | Wins before → after | Mean length before → after | Timeouts before → after |
| ----------------- | --------: | ------------------: | -------------------------: | ----------------------: |
| Normal, solo      |       117 |             30 → 31 |              12:52 → 12:50 |                   8 → 5 |
| Normal, 2 players |       117 |             31 → 28 |              12:59 → 13:03 |                   6 → 8 |
| Normal, 4 players |       115 |             16 → 14 |              12:06 → 12:15 |                 11 → 10 |
| Hard, solo        |       117 |               4 → 2 |                9:40 → 9:34 |                   3 → 4 |
| Hard, 2 players   |       117 |               0 → 0 |                8:10 → 8:11 |                   1 → 1 |
| Hard, 4 players   |       107 |               1 → 1 |                6:56 → 6:56 |                   0 → 0 |

Campaign/seasonal wins changed from 82 to 76 out of 690 paired completed runs per revision. Compare wins alongside timeouts and run length; the sample is too small to establish a target difficulty or reliable per-map win rate.

### Every map and mode

Each row starts with nine planned runs per revision (three adventurers × three seeds). If either revision errors, the pair is excluded from both sides below. Timeouts on endless fun maps mean the party survived the full standard time window, not a win.

| Map                         | Difficulty | Players | Paired runs | Wins before → after | Mean length before → after | Timeouts before → after |
| --------------------------- | ---------- | ------: | ----------: | ------------------: | -------------------------: | ----------------------: |
| Lumbridge                   | Normal     |       1 |           9 |               5 → 6 |              15:43 → 15:36 |                   1 → 0 |
| Lumbridge                   | Normal     |       2 |           9 |               6 → 5 |              16:20 → 16:20 |                   2 → 2 |
| Lumbridge                   | Normal     |       4 |           9 |               4 → 7 |              16:17 → 15:58 |                   4 → 2 |
| Lumbridge                   | Hard       |       1 |           9 |               2 → 1 |              14:33 → 14:30 |                   1 → 1 |
| Lumbridge                   | Hard       |       2 |           9 |               0 → 0 |              10:49 → 10:50 |                   0 → 0 |
| Lumbridge                   | Hard       |       4 |           8 |               0 → 0 |              10:12 → 10:09 |                   0 → 0 |
| Barrows                     | Normal     |       1 |           9 |               6 → 6 |              14:17 → 14:18 |                   0 → 0 |
| Barrows                     | Normal     |       2 |           9 |               7 → 8 |              14:25 → 14:47 |                   0 → 0 |
| Barrows                     | Normal     |       4 |           9 |               3 → 2 |              14:27 → 15:04 |                   0 → 2 |
| Barrows                     | Hard       |       1 |           9 |               1 → 1 |              10:17 → 10:17 |                   0 → 0 |
| Barrows                     | Hard       |       2 |           9 |               0 → 0 |              10:11 → 10:05 |                   0 → 0 |
| Barrows                     | Hard       |       4 |           9 |               0 → 0 |                8:10 → 8:07 |                   0 → 0 |
| Wilderness                  | Normal     |       1 |           9 |               2 → 2 |              13:57 → 14:09 |                   0 → 0 |
| Wilderness                  | Normal     |       2 |           9 |               3 → 3 |              14:36 → 14:58 |                   0 → 0 |
| Wilderness                  | Normal     |       4 |           9 |               2 → 0 |              14:06 → 15:05 |                   1 → 0 |
| Wilderness                  | Hard       |       1 |           9 |               0 → 0 |                9:56 → 9:55 |                   0 → 0 |
| Wilderness                  | Hard       |       2 |           9 |               0 → 0 |                8:04 → 8:06 |                   0 → 0 |
| Wilderness                  | Hard       |       4 |           9 |               0 → 0 |                6:07 → 6:05 |                   0 → 0 |
| Kharidian Desert            | Normal     |       1 |           9 |               4 → 5 |              15:12 → 14:53 |                   1 → 0 |
| Kharidian Desert            | Normal     |       2 |           9 |               6 → 6 |              15:53 → 15:52 |                   1 → 1 |
| Kharidian Desert            | Normal     |       4 |           8 |               4 → 3 |              15:40 → 15:31 |                   2 → 1 |
| Kharidian Desert            | Hard       |       1 |           9 |               0 → 0 |                9:07 → 8:13 |                   0 → 0 |
| Kharidian Desert            | Hard       |       2 |           9 |               0 → 0 |                9:20 → 9:44 |                   0 → 0 |
| Kharidian Desert            | Hard       |       4 |           9 |               0 → 0 |                6:59 → 6:51 |                   0 → 0 |
| Fremennik Province          | Normal     |       1 |           9 |               5 → 5 |              14:52 → 14:51 |                   0 → 0 |
| Fremennik Province          | Normal     |       2 |           9 |               3 → 0 |              13:42 → 13:12 |                   0 → 0 |
| Fremennik Province          | Normal     |       4 |           9 |               3 → 2 |              14:33 → 14:55 |                   0 → 1 |
| Fremennik Province          | Hard       |       1 |           9 |               0 → 0 |              11:05 → 10:34 |                   0 → 0 |
| Fremennik Province          | Hard       |       2 |           9 |               0 → 0 |                7:30 → 7:34 |                   0 → 0 |
| Fremennik Province          | Hard       |       4 |           6 |               1 → 1 |                8:03 → 8:44 |                   0 → 0 |
| Karamja                     | Normal     |       1 |           9 |               0 → 0 |              12:24 → 12:29 |                   0 → 0 |
| Karamja                     | Normal     |       2 |           9 |               0 → 0 |              12:17 → 12:24 |                   0 → 1 |
| Karamja                     | Normal     |       4 |           9 |               0 → 0 |              11:31 → 11:45 |                   0 → 0 |
| Karamja                     | Hard       |       1 |           9 |               1 → 0 |              11:00 → 11:05 |                   0 → 1 |
| Karamja                     | Hard       |       2 |           9 |               0 → 0 |                7:04 → 7:03 |                   0 → 0 |
| Karamja                     | Hard       |       4 |           9 |               0 → 0 |                6:07 → 6:07 |                   0 → 0 |
| Kourend                     | Normal     |       1 |           9 |               0 → 0 |              13:09 → 13:09 |                   0 → 0 |
| Kourend                     | Normal     |       2 |           9 |               1 → 1 |              13:50 → 13:20 |                   0 → 0 |
| Kourend                     | Normal     |       4 |           9 |               0 → 0 |                8:14 → 8:46 |                   0 → 0 |
| Kourend                     | Hard       |       1 |           9 |               0 → 0 |                9:07 → 9:07 |                   0 → 0 |
| Kourend                     | Hard       |       2 |           9 |               0 → 0 |                7:00 → 7:00 |                   0 → 0 |
| Kourend                     | Hard       |       4 |           9 |               0 → 0 |                6:02 → 6:02 |                   0 → 0 |
| Varlamore                   | Normal     |       1 |           9 |               2 → 2 |              12:57 → 12:44 |                   1 → 0 |
| Varlamore                   | Normal     |       2 |           9 |               0 → 0 |              11:00 → 11:30 |                   0 → 0 |
| Varlamore                   | Normal     |       4 |           9 |               0 → 0 |              10:36 → 10:26 |                   0 → 0 |
| Varlamore                   | Hard       |       1 |           9 |               0 → 0 |                6:37 → 6:37 |                   0 → 0 |
| Varlamore                   | Hard       |       2 |           9 |               0 → 0 |                7:12 → 7:07 |                   0 → 0 |
| Varlamore                   | Hard       |       4 |           9 |               0 → 0 |                6:56 → 6:57 |                   0 → 0 |
| Morytania                   | Normal     |       1 |           9 |               0 → 0 |              10:52 → 10:49 |                   0 → 1 |
| Morytania                   | Normal     |       2 |           9 |               0 → 0 |              11:57 → 11:51 |                   0 → 0 |
| Morytania                   | Normal     |       4 |           9 |               0 → 0 |              11:08 → 11:06 |                   0 → 0 |
| Morytania                   | Hard       |       1 |           9 |               0 → 0 |                8:57 → 9:02 |                   0 → 0 |
| Morytania                   | Hard       |       2 |           9 |               0 → 0 |                7:08 → 7:19 |                   0 → 0 |
| Morytania                   | Hard       |       4 |           8 |               0 → 0 |                5:56 → 6:13 |                   0 → 0 |
| God Wars Dungeon            | Normal     |       1 |           9 |               5 → 4 |              14:32 → 14:33 |                   0 → 0 |
| God Wars Dungeon            | Normal     |       2 |           9 |               4 → 4 |              14:06 → 14:04 |                   0 → 0 |
| God Wars Dungeon            | Normal     |       4 |           9 |               0 → 0 |                9:55 → 9:53 |                   0 → 0 |
| God Wars Dungeon            | Hard       |       1 |           9 |               0 → 0 |              10:40 → 10:40 |                   0 → 0 |
| God Wars Dungeon            | Hard       |       2 |           9 |               0 → 0 |                8:03 → 7:30 |                   0 → 0 |
| God Wars Dungeon            | Hard       |       4 |           9 |               0 → 0 |                5:25 → 5:24 |                   0 → 0 |
| Prifddinas                  | Normal     |       1 |           9 |               0 → 0 |                8:17 → 8:17 |                   0 → 0 |
| Prifddinas                  | Normal     |       2 |           9 |               0 → 0 |                8:57 → 8:58 |                   0 → 0 |
| Prifddinas                  | Normal     |       4 |           8 |               0 → 0 |                9:32 → 9:10 |                   0 → 0 |
| Prifddinas                  | Hard       |       1 |           9 |               0 → 0 |                7:26 → 7:27 |                   0 → 0 |
| Prifddinas                  | Hard       |       2 |           9 |               0 → 0 |                7:59 → 8:08 |                   0 → 0 |
| Prifddinas                  | Hard       |       4 |           8 |               0 → 0 |                7:54 → 7:53 |                   0 → 0 |
| The Inferno                 | Normal     |       1 |           9 |               0 → 0 |                7:02 → 7:02 |                   0 → 0 |
| The Inferno                 | Normal     |       2 |           9 |               0 → 0 |                7:42 → 7:55 |                   0 → 0 |
| The Inferno                 | Normal     |       4 |           9 |               0 → 0 |                7:41 → 7:46 |                   0 → 0 |
| The Inferno                 | Hard       |       1 |           9 |               0 → 0 |                5:55 → 5:55 |                   0 → 0 |
| The Inferno                 | Hard       |       2 |           9 |               0 → 0 |                6:10 → 6:12 |                   0 → 0 |
| The Inferno                 | Hard       |       4 |           5 |               0 → 0 |                5:23 → 5:23 |                   0 → 0 |
| Hallowed Night              | Normal     |       1 |           9 |               1 → 1 |              14:04 → 13:58 |                   5 → 4 |
| Hallowed Night              | Normal     |       2 |           9 |               1 → 1 |              14:02 → 14:22 |                   3 → 4 |
| Hallowed Night              | Normal     |       4 |           9 |               0 → 0 |              13:52 → 13:49 |                   4 → 4 |
| Hallowed Night              | Hard       |       1 |           9 |               0 → 0 |              11:06 → 11:06 |                   2 → 2 |
| Hallowed Night              | Hard       |       2 |           9 |               0 → 0 |                9:39 → 9:39 |                   1 → 1 |
| Hallowed Night              | Hard       |       4 |           9 |               0 → 0 |                7:02 → 6:36 |                   0 → 0 |
| Grand Exchange (endless)    | Normal     |       1 |           9 |               0 → 0 |              12:51 → 12:52 |                   3 → 3 |
| Grand Exchange (endless)    | Normal     |       2 |           9 |               0 → 0 |              14:06 → 14:13 |                   5 → 5 |
| Grand Exchange (endless)    | Normal     |       4 |           9 |               0 → 0 |              14:24 → 14:02 |                   5 → 4 |
| Grand Exchange (endless)    | Hard       |       1 |           9 |               0 → 0 |              10:48 → 10:48 |                   2 → 2 |
| Grand Exchange (endless)    | Hard       |       2 |           9 |               0 → 0 |              11:38 → 12:07 |                   3 → 4 |
| Grand Exchange (endless)    | Hard       |       4 |           8 |               0 → 0 |                9:06 → 9:06 |                   1 → 1 |
| East Varrock (endless)      | Normal     |       1 |           9 |               0 → 0 |              12:48 → 12:48 |                   5 → 5 |
| East Varrock (endless)      | Normal     |       2 |           9 |               0 → 0 |              13:40 → 13:25 |                   5 → 5 |
| East Varrock (endless)      | Normal     |       4 |           9 |               0 → 0 |              12:39 → 12:38 |                   3 → 3 |
| East Varrock (endless)      | Hard       |       1 |           9 |               0 → 0 |              10:14 → 10:14 |                   2 → 2 |
| East Varrock (endless)      | Hard       |       2 |           9 |               0 → 0 |                8:53 → 8:57 |                   2 → 2 |
| East Varrock (endless)      | Hard       |       4 |           9 |               0 → 0 |                8:06 → 8:29 |                   0 → 0 |
| Falador (endless)           | Normal     |       1 |           9 |               0 → 0 |              13:31 → 13:31 |                   6 → 6 |
| Falador (endless)           | Normal     |       2 |           9 |               0 → 0 |              14:26 → 14:26 |                   5 → 5 |
| Falador (endless)           | Normal     |       4 |           9 |               0 → 0 |              11:31 → 11:05 |                   1 → 0 |
| Falador (endless)           | Hard       |       1 |           9 |               0 → 0 |              10:06 → 10:06 |                   2 → 2 |
| Falador (endless)           | Hard       |       2 |           9 |               0 → 0 |              10:44 → 10:44 |                   3 → 3 |
| Falador (endless)           | Hard       |       4 |           9 |               0 → 0 |                8:17 → 8:58 |                   0 → 0 |
| Last Man Standing (endless) | Normal     |       1 |           9 |               0 → 0 |                9:55 → 9:55 |                   2 → 2 |
| Last Man Standing (endless) | Normal     |       2 |           9 |               0 → 0 |              11:38 → 11:47 |                   2 → 2 |
| Last Man Standing (endless) | Normal     |       4 |           9 |               0 → 0 |               10:37 → 9:28 |                   2 → 1 |
| Last Man Standing (endless) | Hard       |       1 |           9 |               0 → 0 |                7:14 → 7:14 |                   1 → 1 |
| Last Man Standing (endless) | Hard       |       2 |           9 |               0 → 0 |                5:57 → 6:24 |                   0 → 1 |
| Last Man Standing (endless) | Hard       |       4 |           9 |               0 → 0 |                5:19 → 5:19 |                   0 → 0 |
| Castle Wars (endless)       | Normal     |       1 |           9 |               0 → 0 |              16:11 → 16:11 |                   8 → 8 |
| Castle Wars (endless)       | Normal     |       2 |           9 |               0 → 0 |              15:10 → 15:10 |                   7 → 7 |
| Castle Wars (endless)       | Normal     |       4 |           9 |               0 → 0 |              14:26 → 14:23 |                   5 → 5 |
| Castle Wars (endless)       | Hard       |       1 |           9 |               0 → 0 |              12:11 → 12:11 |                   5 → 5 |
| Castle Wars (endless)       | Hard       |       2 |           9 |               0 → 0 |              10:02 → 10:01 |                   2 → 2 |
| Castle Wars (endless)       | Hard       |       4 |           9 |               0 → 0 |                8:51 → 7:39 |                   1 → 0 |
| Pest Control (endless)      | Normal     |       1 |           9 |               0 → 0 |              16:11 → 16:34 |                   7 → 8 |
| Pest Control (endless)      | Normal     |       2 |           9 |               0 → 0 |              16:21 → 16:18 |                   8 → 7 |
| Pest Control (endless)      | Normal     |       4 |           9 |               0 → 0 |              16:55 → 17:00 |                   8 → 9 |
| Pest Control (endless)      | Hard       |       1 |           9 |               0 → 0 |              11:11 → 11:03 |                   3 → 3 |
| Pest Control (endless)      | Hard       |       2 |           9 |               0 → 0 |              16:16 → 16:35 |                   7 → 8 |
| Pest Control (endless)      | Hard       |       4 |           9 |               0 → 0 |              16:34 → 16:40 |                   8 → 8 |

### Simulator errors

The standard bot can reach a pending co-op level-up with no choices and throw at `ranked[0].index`. This also reproduces on unchanged `main`. A temporary copy adds only a try/catch around each seed so remaining seeds continue; combat and bot decisions are unchanged. Errors are not counted as deaths or timeouts.

| Map            | Mode   | Players | Adventurer | Seed | Before                                                                  | After                                                                   |
| -------------- | ------ | ------: | ---------- | ---: | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| lumbridge      | Hard   |       4 | warrior    |    1 | died                                                                    | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| desert         | Normal |       4 | ranger     |    1 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | died                                                                    |
| fremennik      | Hard   |       4 | warrior    |    1 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| fremennik      | Hard   |       4 | warrior    |    3 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| fremennik      | Hard   |       4 | wizard     |    2 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | died                                                                    |
| morytania      | Hard   |       4 | wizard     |    3 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| prifddinas     | Normal |       4 | warrior    |    1 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| prifddinas     | Hard   |       4 | warrior    |    3 | died                                                                    | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| inferno        | Hard   |       4 | warrior    |    1 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| inferno        | Hard   |       4 | warrior    |    2 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| inferno        | Hard   |       4 | warrior    |    3 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| inferno        | Hard   |       4 | wizard     |    2 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |
| grand_exchange | Hard   |       4 | wizard     |    2 | ERROR: TypeError: Cannot read properties of undefined (reading 'index') | ERROR: TypeError: Cannot read properties of undefined (reading 'index') |

## Weapon curves and attack benchmark

The tuning targets half of the positive gain above the strongest maxed parent: `base DPS + 0.5 × (original evolution DPS − base DPS)`. The smallest integer damage meeting that target against both normal and boss targets is chosen, also keeping primary hit damage and damage/cooldown above the maxed parent and each evolution level above its previous level. These guards and integer rounding can retain more than half the original gain. This is not a 50% reduction of total damage.

`npx tsx scripts/game/measure-weapon-dps.ts` exercises real attacks for 60 seconds on seeds 1–3: a stationary target at an ideal distance, normal/boss max HP of 200/10,000, no Might or gear, and no waves. The target's current HP is held high enough to survive. It includes specials, multi-hits, projectiles and DoTs, but does not measure crowd clearing, movement, healing value or full-run performance. Damage arrays list levels 1/2/3; DPS cells are normal/boss. Parent DPS uses the strongest parent in each scenario.

| Evolution                     | Old damage      | New damage   | Max parent DPS | Old level 1 DPS | New level 1 DPS |
| ----------------------------- | --------------- | ------------ | -------------- | --------------- | --------------- |
| Abyssal whip                  | 42 / 48 / 55    | 35 / 38 / 41 | 27.7 / 27.7    | 43.7 / 43.7     | 36.4 / 36.4     |
| Flames of Zamorak (unchanged) | 30 / 35 / 39    | 30 / 35 / 39 | 59.3 / 59.3    | 15.0 / 48.8     | 15.0 / 48.8     |
| Toktz-xil-ul                  | 14 / 16 / 18    | 11 / 12 / 13 | 64.5 / 64.5    | 135.2 / 135.2   | 106.2 / 106.2   |
| Ice Barrage                   | 16 / 18 / 21    | 12 / 13 / 14 | 4.2 / 4.2      | 10.1 / 10.1     | 7.6 / 7.6       |
| Smoke Barrage                 | 13 / 15 / 17    | 7 / 8 / 9    | 7.2 / 7.2      | 15.3 / 15.3     | 11.4 / 11.4     |
| Shadow Barrage                | 16 / 18 / 21    | 12 / 13 / 14 | 5.7 / 5.7      | 13.0 / 13.0     | 9.8 / 9.8       |
| Blood Barrage                 | 17 / 20 / 22    | 13 / 15 / 16 | 5.4 / 5.4      | 10.9 / 10.9     | 8.3 / 8.3       |
| Undead Grasp                  | 26 / 30 / 34    | 23 / 25 / 27 | 7.2 / 7.2      | 9.8 / 9.8       | 8.7 / 8.7       |
| Colossal blade                | 54 / 62 / 70    | 44 / 48 / 52 | 21.8 / 21.8    | 35.8 / 54.5     | 29.2 / 44.4     |
| Dark bow                      | 40 / 46 / 52    | 34 / 37 / 40 | 54.6 / 54.6    | 79.0 / 79.0     | 67.2 / 67.2     |
| Chain-hit axes                | 20 / 23 / 26    | 16 / 18 / 19 | 38.4 / 38.4    | 66.0 / 66.0     | 52.8 / 52.8     |
| Astral runes                  | 13 / 15 / 17    | 10 / 11 / 12 | 14.5 / 14.5    | 32.4 / 32.4     | 24.9 / 24.9     |
| Sanguine Scythe of Vitur      | 60 / 69 / 78    | 55 / 59 / 64 | 48.5 / 85.1    | 60.3 / 106.0    | 55.3 / 97.2     |
| Ancient godsword (unchanged)  | 74 / 85 / 96    | 74 / 85 / 96 | 54.2 / 54.2    | 50.8 / 50.8     | 50.8 / 50.8     |
| Burning claws                 | 18 / 21 / 23    | 17 / 18 / 19 | 37.3 / 37.3    | 53.9 / 53.9     | 50.9 / 50.9     |
| Blisterwood flail             | 32 / 37 / 42    | 30 / 33 / 35 | 28.6 / 28.6    | 33.3 / 33.3     | 31.2 / 31.2     |
| Elder maul                    | 72 / 83 / 94    | 67 / 73 / 78 | 60.0 / 60.0    | 70.8 / 70.8     | 65.9 / 65.9     |
| Dinh's blazing bulwark        | 110 / 126 / 143 | 97 / 98 / 99 | 31.9 / 31.9    | 65.7 / 65.7     | 58.0 / 58.0     |
| Corrupted twisted bow         | 24 / 28 / 31    | 22 / 24 / 26 | 85.2 / 149.6   | 102.8 / 257.5   | 94.1 / 236.1    |
| Corrupted bow (perfected)     | 20 / 23 / 26    | 18 / 19 / 21 | 34.7 / 34.7    | 49.5 / 49.5     | 44.5 / 44.5     |
| Corrupted tumeken's shadow    | 32 / 37 / 42    | 31 / 33 / 36 | 70.7 / 70.7    | 80.2 / 80.2     | 77.6 / 77.6     |
| Eldritch nightmare staff      | 14 / 16 / 18    | 13 / 14 / 15 | 33.6 / 33.6    | 39.3 / 39.3     | 36.5 / 36.5     |
| Holy sanguinesti staff        | 28 / 32 / 36    | 27 / 29 / 31 | 44.6 / 44.6    | 52.0 / 52.0     | 50.2 / 50.2     |

Flames of Zamorak and Ancient godsword are unchanged: their original level 1 already trades sustained single-target damage for area, boss hits or healing. The stationary comparison does not establish safe nerf headroom for them. Attack patterns, cooldowns, venom values and utility are unchanged for every weapon.

## Checks

- 1,327 tests across 60 files pass, including independent balance injection, stat display scaling, integer floors, DoT ownership/ties and every retuned evolution's upgrade progression.
- TypeScript and formatting checks pass.
- Browser component preview verified production stat formatting and ChoiceStats markup: Scimitar 32, whip 35, next whip level 35 → 38, and fixed-profile damage/venom fixtures. The game also loaded successfully and the Collection log was checked; combat was validated by the simulations.
- No new cache assets.
