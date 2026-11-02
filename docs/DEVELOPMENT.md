# Developing Run Escape

How the code is laid out, the tools that come with it, how to host a build, and the desktop app.
The [README](../README.md) covers getting it running.

## Hosting

```
npm run build
npm run slim-cache
```

writes the game to `dist/`, with a slim copy of the cache in `dist/caches/`: only what the game
reads, about 26 MB instead of 227 MB. Put what's in `dist/` on a web server, at the site's root or
in a folder (asset paths are relative, so https://example.com/game/ works):

```
index.html
assets/
caches/caches.json
caches/osrs-241_2026-09-30-slim-<hash>/
```

`npm run slim-cache` loads everything the game loads (every model it bakes, an icon for every
item, each map's arena and the map squares around it) with the game's own loaders and keeps the
groups they read. Then it loads it all again from the slim copy and fails if anything is missing.
It takes a couple of minutes. Run it again after changing the content (a new enemy, item or map),
or the game stops on a "missing from the cache" error. The slim cache is named after what's in it,
so players' browsers fetch the new one and drop the old. `npm run preview` serves the build with
its slim cache, to try it before uploading. The full cache works too, if you'd rather host that.
The map viewer (`?viewer=1`) needs the full one.

The server has to send two headers with the page. The game shares the cache with its workers in
a SharedArrayBuffer, which browsers only allow on a cross-origin isolated page; without them the
game says so instead of loading:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

With nginx, in the game's `location` block:

```
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

With Apache, in an `.htaccess` beside `index.html` (needs mod_headers):

```
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
```

It needs HTTPS (or localhost) for the browser's cache storage, and a folder's address with its
trailing slash (`/game/`, not `/game`), or the relative paths point at the parent folder.

### Co-op relay

The simplest way to host everything: `npm run serve` (`node server/serve.mjs`, no packages) serves
`dist/` with the headers above on `PORT` (8080), and runs the co-op relay in the same process.
Multiplayer is on unless it's turned off (`npm run serve:singleplayer`, `MULTIPLAYER=off` or
`--no-multiplayer`), and either way the game only offers it when a relay answers: it asks once,
in the background, as it starts, and hides Multiplayer if nothing says yes within 4 seconds. Run `npm run build` first; with no
slim cache in `dist/caches` it serves the full one from `caches/`, so it also works for trying a
build locally (http://localhost:8080). Put something that does HTTPS in front of it, like Caddy
(`caddy reverse-proxy --from game.example.com --to localhost:8080`).

The relay is light. In a load test at the game's own rates (host frames 25 times a second, guests'
moves about 4), a room of four was about 5.3 KB/s of messages and 109 of them a second, around
12 KB/s on the wire with TCP's own overhead, or about 40 MB an hour. 100 rooms (400 players, and 50
more browsing the room list) took at most 13% of one core and 64 MB. A small VPS runs it easily;
serving the game itself (about 26 MB for each new player) is the bigger cost.

Co-op needs the relay in [server/coop-relay.mjs](../server/coop-relay.mjs): plain Node 20 with no
packages, so copy it with `server/name-gen.mjs` (where players' and rooms' names come from) and
`server/client-ip.mjs` to the server and run it.

```
PORT=8787 node server/coop-relay.mjs
```

The game looks for it at `coop` beside the page (`wss://example.com/game/coop` for a game at
`/game/`), so proxy that path to it. With nginx:

```
location /game/coop {
    proxy_pass http://127.0.0.1:8787/coop;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
}
```

With Apache 2.4.47 or newer (`a2enmod proxy proxy_http`), which adds `X-Forwarded-For` itself:

```
ProxyPass "/game/coop" "http://127.0.0.1:8787/coop" upgrade=websocket
```

The relay limits each address (see below), so behind a proxy, where every player looks like the
proxy, tell it what's in front with `PROXY` (or `--proxy=` after `npm run serve --`). It's off
(`none`) unless it's set:

| `PROXY`        | For                                                                            | Whose word it takes for a player's address                                                                                       |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| unset (`none`) | nothing in front, or a LAN                                                     | nobody's: the connection's own                                                                                                   |
| `local`        | Caddy, nginx or a container in front, on the same machine or a private network | that proxy's: the last address in its `X-Forwarded-For`, which it adds itself (Caddy does by default, nginx with the line above) |
| `cloudflare`   | Cloudflare in front, with or without a local proxy behind it                   | Cloudflare's `CF-Connecting-IP`, only from Cloudflare's own addresses (and a local proxy's, as `local`)                          |

**Only your proxy should be able to reach the relay.** `local` (and `cloudflare`, for the proxy
behind it) believes `X-Forwarded-For` from any address on the machine or a private network, so
anyone else who can connect from one could say they're anyone and get round the limits. Set
`HOST=127.0.0.1` on the standalone relay or `serve.mjs`, with the proxy on the same machine. In
Docker, leave `HOST` alone inside the container and publish the port on the host's loopback
(`-p 127.0.0.1:8080:8080`): Docker's own proxy hands on connections from anywhere as if they came
from its private network.

The relay takes 800 connections in all, so give it room with `LimitNOFILE` if you raise that. A
connection in no room that's done nothing for 10 minutes is closed, as is a room left alone for
half an hour.

Headers from anyone else are ignored, so they can't be made up to get round the limits. Behind a
proxy with `PROXY` unset, the relay says so once. `TRUSTED_PROXIES` (`"10.1.2.3,10.9.0.0/16"`)
adds proxies elsewhere. With `cloudflare`, the relay fetches Cloudflare's addresses from
`https://api.cloudflare.com/client/v4/ips` when it starts and again each day, so there's no list
in the code to go out of date. Until the first fetch comes back (or if it fails, which it says and
then tries again a minute later), players look like Cloudflare to the limits; a failed refresh
keeps the last list. `CLOUDFLARE_IPS` gives the list instead, and then nothing's fetched.

Its limits, at the top of `server/coop-relay.mjs`:

| What                          | Limit                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Rooms on the relay            | 500, or `MULTIPLAYER_MAX_ROOMS`; past that, making one says they're all taken (and the menu shows it) |
| Connections from one address  | 16 (a household or LAN party behind one address), and 64 from one IPv6 /48                            |
| Rooms hosted from one address | 4, and 16 from one IPv6 /48                                                                           |
| Rooms made from one address   | 10 a minute                                                                                           |
| Rooms joined from one address | 12 a minute (joining and leaving are each a room update for everyone in it)                           |
| Wrong room codes              | 20 a minute from one address or IPv6 /48, then it has to wait                                         |
| A room with nothing happening | closed after 30 minutes (pings, looking at the list, and players' own updates and names don't count)  |
| A room hearing how it is      | at most once each 250 ms, with the latest, however often it changes                                   |
| What a host sends its room    | 64 KB/s (a run's start and frames), saving up to 256 KB; a host past it is dropped                    |
| A guest's input for the host  | 1 KB each and 60 a second; past that it goes no further                                               |
| A player's own update         | 40 KB, or it's ignored                                                                                |
| A player's loadout            | 16 KB, or it's dropped                                                                                |
| A message                     | 256 KB, in 16 pieces at most, and UTF-8; nested 16 deep at most, apart from the host's frames         |
| One connection                | 400 frames a second (empty ones and pings included) and 512 KB a second, or it's dropped              |
| Waiting to go out to one      | 1 MB: a connection that stops reading is dropped                                                      |

An IPv6 address counts by its /64, which is what one home or server gets, and its /48 has looser
limits of its own, as one person can easily have all of a /48's /64s. A kicked player can't rejoin
that room from the same address, or from anywhere in the same IPv6 /48. A room update carries
everyone's loadout to everyone, so the relay encodes it once and sends it at most each 250 ms
however fast the room changes. The host's frames, nearly all of what comes through, go on as they
came without the depth check: the relay never encodes them again, which is what a deep message
would break. A message that isn't a JSON object is ignored. One that isn't UTF-8, is too deep or
makes the relay throw drops that connection, never the relay, and a request whose path isn't a URL
is a 400. `serve.mjs` turns away WebSocket upgrades to any other path rather than leaving them
open, and answers `Range` with 206, as the cache's download resumes with one.

A room of four is about 12 KB/s through the relay, both ways, and about 0.15% of a core: 500 rooms
is around 50 Mbit/s and three quarters of one core. Set `MULTIPLAYER_MAX_ROOMS` (or
`--max-rooms=`) to what the server's bandwidth and CPU can take. The relay passes the game's own
messages on as they came rather than decoding and encoding them again, so what's left of its CPU is
mostly Node writing to sockets.

Or build with `VITE_COOP_URL=wss://relay.example.com/coop npm run build` to point it anywhere
else. `npm start` and `npm run preview` run a relay of their own at `/coop`
(`npm run start:singleplayer`, or `MULTIPLAYER=off`, without).

## Desktop

**Co-op on desktop.** The app answers every https request itself, so it only reaches a relay built
into it. Set the `COOP_URL` repository variable (Settings, Secrets and variables, Actions) to
`wss://example.com/coop`, and the release workflow builds it into the game and the launcher. It
has to be `wss://`, and the app lets only that address out. Without it there's no Multiplayer.

The launcher only gets it in a new download, so players on an older one keep playing without
Multiplayer until they fetch the new zip. Don't raise `minLauncher` for this: the game still runs.
Desktop and web players share rooms only on the same build, so publish a release and deploy the
website from the same commit.

The Windows app is a zip: `Run Escape.exe`, the Electron runtime and the game, so it plays offline
the first time it's opened. There's no installer. Unzip it anywhere and run it. It lives in
`desktop/`, apart from the game, which doesn't know it's in an app.

```
npm run build && npm run slim-cache
npm run desktop         # the app, on this build, with no update check
npm run desktop:dist    # everything a release carries, in release/
```

`desktop:dist` stops if `dist/caches` isn't the slim cache. It needs Node 22.12 or later (Electron
does), and Electron's binary downloads the first time it's run. Dev runs keep their saves in a
`Run Escape Dev` folder, so they can't touch a real one.

| File                   | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `main.ts`              | Windows, security settings, the order things happen at launch     |
| `gameServer.ts`        | Serves a game folder at `GAME_ORIGIN`, with the headers and Range |
| `gameUpdate.ts`        | Checks for, downloads, verifies and installs game updates         |
| `gameFiles.ts`         | The plain logic: versions, picking a folder, zip paths, manifests |
| `releaseSource.ts`     | The only place that says where updates come from                  |
| `version.ts`           | `LAUNCHER_VERSION`                                                |
| `release-files.ts`     | Makes the game zip, the manifest and the release notes            |
| `electron-builder.yml` | What goes in the launcher's zip                                   |

### Where things are kept

Saves and updates are under the user data folder, `%APPDATA%\Run Escape`, never beside the exe, so
they outlast the zip's folder being moved or deleted, and a new launcher zip finds them.

**Three things decide where saves are, and changing any of them loses every player's save:**
`GAME_ORIGIN` in `gameServer.ts`, the user data folder's name, and `GAME_PARTITION`, all but the
first in `main.ts`. They don't depend on the game's version, or on which folder the game's served
from.

The saves on a website and in the app are separate, as they're different origins. The Settings
screen's export and import carry one across.

### How the game's served

Nothing listens on a port. `gameServer.ts` answers the game's requests inside the app, at
`https://run-escape.invalid`, by intercepting `https` in the game's session. That looks odd, and
it's on purpose:

- **It can't be a custom scheme.** `app://` gets cross-origin isolation and `fetch`, but the Cache
  API's `put()` refuses anything but http(s) with `Request scheme 'app' is unsupported`, and
  `CacheFiles.ts` waits on those puts, so the game fails on its first load.
- `.invalid` can never resolve, so a request that somehow got out wouldn't reach anyone.
- Every answer needs the COOP and COEP headers, workers included, and a `.wasm` or `.js` needs the
  right type.
- `CacheFiles.ts` resumes with `Range: bytes=<offset>-<MAX_SAFE_INTEGER>` and adds what comes back
  to what it has, so a server that ignores Range corrupts the cache. `gameServer.ts` clamps the
  end and answers 206, with a `Content-Length` of what's left.

Interception only works reliably for one session per process, so don't add a second.

### Game updates

The launcher updates the game's files by itself, not the launcher. At launch:

1. It asks GitHub's API for the latest published release of Dynrothe/Run-Escape, with no token and
   a 5 second limit. Drafts aren't returned, so publishing is what lets players have it.
2. If the release's `game-manifest.json` has a newer version than the game it has, it shows a small
   window, downloads `game-<version>.zip`, checks its sha256, extracts it to a temporary folder and
   renames that to `game/<version>` in the user data folder. Then it removes older ones.
3. It plays the newest game folder it can run: an update, or the bundled files if those are newer,
   as they are after unzipping a newer launcher.

Offline, rate limited (GitHub allows 60 requests an hour per address), a bad download, a skipped
update: the game starts anyway with what it has, and `launcher.log` in the user data folder says
why. The old game stays until the rename, so nothing partway through can break it. A folder only
counts if it has the `verified.json` that's written just before that rename. The sha256 catches a
damaged download, not a bad release: the manifest comes from the same place as the zip, so anyone
who can publish a release can ship code to players.

Downloads start only from this repository's release URLs, over https. GitHub then redirects to
`release-assets.githubusercontent.com`, so redirects are checked one by one, which is why this uses
Node's `fetch`: Electron's `net.fetch` fails on `redirect: "manual"`. That means it doesn't use
Windows' proxy settings, so behind a proxy a player just gets no updates. A zip's entries are all
checked before any is written, by `unsafeOriginalName`, as JSZip tidies `../` out of `name`.

### When the launcher has to change

`LAUNCHER_VERSION` in `desktop/version.ts` isn't the game's version. A release's manifest gives it
as `minLauncher`. **Raise it only when the game can't run on launchers already out there**, like
when it needs a newer Electron, or a change to how the game's served. Then old launchers keep the
game they have, and show a message with a button to the release page, so every player has to
download the new zip by hand. Changing `desktop/` without raising it is fine: new downloads get the
new launcher, and existing players keep working.

### Releases

`.github/workflows/release.yml` runs on every push to `main`, and stops straight away unless
`package.json`'s version has no release yet, drafts included. So a merge that doesn't change the
version does nothing, and neither does one while a draft for this version is waiting. The Actions
tab's Run workflow button (`workflow_dispatch`) does the same but rebuilds a waiting draft, and it
only appears once the workflow's on `main`.

It builds on Windows, with the OSRS cache kept between runs by `actions/cache` under
`GAME_CACHE_NAME`. The draft is tagged `v<version>`, with notes from that version's section of
`CHANGELOG.md`, and carries `Run-Escape-<version>-win-x64.zip`, `game-<version>.zip` and
`game-manifest.json`. **Publishing the draft by hand is what releases it to players**, and the tag
only exists from then on. A version needs its own section in `CHANGELOG.md`, or the build fails.

The app isn't signed, so Windows shows a SmartScreen warning the first time it's run (More info,
then Run anyway). Unzip it first: running it from inside the zip fails.

## Code

```
src/game/
  content/  enemies, weapons, passives, items (gear, utility, caskets), armoury (what each piece
            of gear upgrades into), power-ups and thralls, random events, characters, shop, maps
            (arena, spawn, difficulty) and their waves: plain data with cache ids; unlocks
            (what each map's tasks bring in); quests (what each asks for and pays); hard (hard
            mode's numbers, solo only for now: rooms and GameStart don't carry it yet)
    fun/    the fun maps (endless, random bosses) and their players: outfits, chat, shots
  core/     the game in plain TypeScript (no DOM), tested with vitest
    Sim.ts            fixed 20ms tick: movement, enemies, spawning, weapons, pickups, power-ups,
                      levels
    BulletPool.ts     a boss's bullets, in flat arrays: hundreds at once, no allocation in the tick
    world/            ArenaGrid (collision + heights), Collision (circle vs tiles and walls),
                      FlowField (Dijkstra from the player, how hundreds of enemies find a way),
                      FlightGrid (the terrain walls that stop what flies: blocked floor that
                      isn't liquid, and solid clumps too big to be a tree)
    lockstep.ts       co-op's frame events, applying them, and the check that copies agree
    fmath.ts          trigonometry that every browser works out the same, for co-op
    Upgrades.ts       level up choices
    Loot.ts           what's in a casket, the inventory
    save.ts           versioned save with migrations, shop, unlocks (maps, and the adventurers
                      and items earned by tasks), the gear found and the Armoury's upgrades,
                      quests (and the kills and caskets they count), and LocalSaveStore (the
                      save in localStorage: see Saves)
  scaperune/ maps that aren't in OSRS: a seeded generator, recipes, prefabs cut from the real world.
            Dev-only but for the recipes in maps/shippedMaps.ts, with a temporary Map generator
            button on the dev server's title screen. Its CLAUDE.md is the guide to making one
  client/   GameClient (run flow, camera, input), GameView (3D actors + 2D overlay),
            BossFightView (a phased boss's ground marks, bullets and entrance),
            GameAssets (what gets baked), GameStore (state for the React UI), SaveLock (one
            tab saves at a time)
    coop/     CoopLobby (the relay connection and the room), CoopRun (a run's lockstep, host or
              guest), protocol (the messages)
  render/   GameWebGLRenderer (the map viewer's renderer with the game's passes), CameraRig
  ui/       React screens and HUD, ChestModal (the casket opening), EventModal (a random event's
            offer), ItemIcon, CoopScreen (the rooms, the lobby, the party in a run)
  client/GameTouch.ts, ui/TouchControls.tsx, ui/Mobile.css   touch screens (see Touch screens)
server/     coop-relay.mjs: co-op's rooms, and passes each run's frames between its players
src/mapviewer/webgl/actor/   actor renderer: baked animation frames drawn anywhere in the world,
                             any number of them, one multi-draw per pass
src/mapviewer/worker/        RegionDataLoader (collision and heights for the whole arena in one
                             scene build), ItemIconLoader (inventory icons drawn like the client)
                             SoundLoader (sound effects synthesized off the main thread),
                             SpriteDataLoader (interface sprites, like hitsplats)
src/rs/audio/               the client's sound effect synth: instruments, envelopes, filters
src/rs/model/player/         player models from identity kits and worn items
```

Changes to the map viewer itself are small: the game subclasses its WebGL renderer, a few decoders
learned the rev 241 opcodes, the map loader can take extra map squares as plain data
(`src/rs/map/CustomMapFileLoader.ts`, from ScapeRune), `src/rs/config/loctype/LocOverrides.ts`
gives a ScapeRune map a loc a different model or size, and two bugs were fixed (floor collision missing on the edge of every
map square, and a resize during loading leaving the 3D view in a corner). `?viewer=1` still loads
map squares its own way (see below).

### Boss fights as data

A boss's fight is in its `BossDef` and `BossAttackDef`, with no boss named in `Sim.ts`. The Nightmare
(`content/nightmare.ts`) is built from these, and any boss can use them:

- `BossDef.intro`: the player's safe, the screen goes dark, what's left runs for the map's edge and
  is gone, and the boss rises. `alone` stops the waves until it's dead.
- `BossDef.phases`: a shield, then totems in the corners, then a blast for a share of its hitpoints.
  Only the shield takes hits, in `damageEnemy`. Totems are enemies that can't die: their hitpoints
  are the charge they still need, and `shieldEnd` is `Infinity` while they can't be hit, which keeps
  weapons off them.
- Attack kinds `pattern` (rings, spirals, aimed spreads), `ground` (marks that land, or stay armed),
  `quarters`, `surge` and `mark`, and `phases` on an attack for when it's used.
- `Sim.bossArena` is the square all this goes by: `MapDef.bossArena`, or the whole map. Nothing's
  sized by hand, so she fights on any square.

The curse is applied to the input in `stepPlayer`, so keys and the touch stick go the same way.

Her animations are picked by eye, as `classify-npc-seqs.ts` can't tell them apart: she floats in all
of them, so none ends lying down. `find-npc-seqs.ts` scans every sequence and now runs out of the
2.4 GB a heavy job gets; `classify-npc-seqs.ts` with a band of ids is what got them.

### What gets drawn

A map square is 64 tiles a side and the camera sees a small part of one, so the game's squares are
baked into cells of 8 tiles (32 without `WEBGL_multi_draw`, where each one is a real draw call).
`CullGrid` gives each cell a bounding box of what's really in it: terrain goes in by tile, merged
models by triangle, and instanced models and animated locs by where they stand. Anything wider
than a cell gets a box of its own, so it can't stretch its cell's box over the rest. A frame tests
the boxes against the camera's frustum and leaves the rest out of the multi draw with a count of
0: `gl_DrawID` picks a draw's data, so the list has to stay in order. This holds at any camera
angle, because a box holds everything in it, whatever's looking at it. `SdMapLoaderInput.cullCellSize`
turns it on; those squares have no LOD or interact draws, which the viewer needs and the game
doesn't. The boxes follow what `main.vert.glsl` does to a vertex (`CullGrid.addInstance`), so a change
to where the shader puts things needs one there too. `render-stats.ts --cull=8` checks it.

Actors are culled as spheres in `ActorRenderer.draw`, by `ActorModel.reach`: the furthest any vertex
gets from the model's origin in any frame of any animation, so bosses' big swings count.

The game has no hover menus, so its frames have no interact buffer, and with no multisampling
they're drawn straight into the texture the screen quad reads.

Enemies are baked when a run starts, for that map (`getMapEnemies`, `GameAssets.loadEnemies`), in
place of the last map's: they're most of the actors' memory, and a map uses few of them. It goes by
the enemy ids it finds in the map's waves, events and bosses, and in those enemies, so a new way for
an enemy to bring on another needs nothing added. An enemy that isn't baked anyway (the console's
`spawnBoss`) gets baked when it's first drawn, and shows up a moment later.

`window.frameProbe` (dev only) counts what a frame sends to the GPU, at the GL calls:
`await frameProbe.sample(60)` gives triangles, draws and CPU time, split into world and actors.

Combat sounds are picked by the server, not the cache, so the ids in `content/` come from the OSRS
Wiki's [list of in-game sound IDs](https://oldschool.runescape.wiki/w/List_of_in-game_sound_IDs).

### Scripts

All run from the repository root with `npx tsx`:

```
scripts/cache/validate-decoders.ts       decode every type the game uses; fails on new opcodes
scripts/cache/find-npcs.ts goblin        NPC ids, levels and idle/walk animations by name
scripts/cache/find-objs.ts "rune .*"     item ids, wear slots and worn models
scripts/cache/check-items.ts             every casket item's id is the item it's named after
scripts/cache/check-fun-outfits.ts       every item the fun maps' players wear is the one named, in its slot
scripts/cache/find-locs.ts multicannon   scenery ids
scripts/cache/find-npc-seqs.ts 655 1173  animations built on an NPC's skeleton
scripts/cache/classify-npc-seqs.ts 655 6182 6183 6184   tell attack and death animations apart
scripts/cache/dump-idk.ts                player body kits
scripts/cache/dump-config.ts 13 92       raw bytes of a config entry, for working out new opcodes
scripts/cache/sounds.ts wav out 2266     write sound effects to .wav (also validate, seqs, info)
scripts/cache/slim-cache.ts [out dir]    the slim cache for hosting (npm run slim-cache)
scripts/scaperune/find-prefabs.ts 50 50  a map square as text, to pick prefabs and survey ground
scripts/scaperune/preview.ts out.png seed=7 biome=snow    a ScapeRune map from above, and its reachability
scripts/scaperune/relief.ts out.png preset=Alpine        a generated map's height, in seconds, without the cache
scripts/scaperune/check-maps.ts          generated maps: every open tile reaches the spawn, roads off bridges, slopes,
                                         road grades, plots, what the camera can see (ONLY=regex for some of them)
scripts/scaperune/check-prefabs.ts       every prefab, in every rotation: its whole floor, a way out
scripts/scaperune/check-palette.ts       the palette map reads all that generated maps read
scripts/game/simulate-run.ts [character] [seeds]        a bot plays full runs, for balancing
                                                        (MAP=barrows for another map,
                                                        META=max ARMOURY=max for everything
                                                        bought; uses a collision snapshot per
                                                        map in caches/collision, built on the
                                                        first run; FINAL_BOSS=the_nightmare
                                                        BOSS_ARENA=48 tries a phased boss on any
                                                        map, FRESH=1 straight at it, SAFE_WAVES=1
                                                        with what a run earned, FLAT=1 with no
                                                        walls, DODGE=1 keeping off its marks,
                                                        PARTY=4 a co-op party of that adventurer)
scripts/dev/icon-test.ts 1321            draw an item icon as ASCII
scripts/dev/render-stats.ts lumbridge    what a map costs to draw, without a browser: triangles,
                                         draw ranges, bytes (--cull=8 checks the culling boxes and
                                         counts what spots draw, --bake is memory per map's actors)
```

Tests: `npm test`.

URL flags: `?room=ABCDE` joins a co-op room (the invite link), `?autostart=wizard` starts a run right away, `?stress=300` adds 300 goblins, `?viewer=1`
opens the original map viewer (loaded only then), `?bgtick` (dev only) keeps the game running in a
browser tab that isn't being painted, `?notice` shows the notice even after it's been closed. F3
shows collision and stats.

### Co-op

Co-op runs in lockstep. Every player's browser runs the same `Sim`, built from the same seed and
everyone's loadout (`GameStart`), and only what the players do goes over the network. The host
numbers the ticks (frames) and sends, every frame or two, what happened at each: who changed what
they're pressing (as whole numbers, so every copy moves the same) and who chose what. Guests step
only as far as the host has sent, sending their own input to the host to go in a frame, a move
about 15 times a second at most. The host checks what a guest sends (`cleanMove`,
`cleanAction` in `core/lockstep.ts`) before it goes in, since every copy applies it. That only
checks its shape, so whether a player can do it now is the sim's to check: a modified game can
send anything (a downed player can't choose, reroll or skip, as `isChoosing` says). Nothing
waits on a slow guest; they see the run a little behind, and catch up at 8 ms a frame at most.
A decision (a level up, a casket, a random event) is answered once: `CoopRun.act` drops a second
answer to the same one until the host's frame moves it on, or 3 seconds pass, so a double click
can't land on the next decision unseen. An action the host turns away counts as an answer too, so
the client checks what the sim would refuse before sending it (a reroll with none left, or
during a hilt choice), or a refused action would hold up the real one.

Guests can predict their own **displayed** movement in `client/coop/MovementPrediction.ts`. It's
a trial for now: the `movePrediction` display setting (Settings and the pause menu) is off by
default, and `CoopRun.setPrediction` applies it, mid-run too. Off, a guest has no prediction,
sends no `moveSeq` and shows only what the host confirms; turned back on, it starts afresh. A local
input sequence (`moveSeq`) rides on movement messages and is echoed in the host's frame event,
including when queued moves are coalesced. The guest acknowledges it only after stepping that
frame, then replays a bounded local input history from the confirmed position. A change that
returns to the last sent direction inside the throttle still sends its new sequence, so a brief
predicted tap can't remain unacknowledged forever.

Prediction covers the character's position, facing and movement animation, camera, minimap,
health bar, attached text, slashes and auras. `PlayerPose` is presentation state: never write it
into `Sim`. Combat, pickups, world-space attack effects and all hashes still use confirmed
positions. `core/PlayerMovement.ts` shares terrain collision, speed, sleds, curses, facing and
boss arena limits with `Sim.stepPlayer`. Small errors ease toward the confirmed path; a wall
blocking correction snaps the picture to its valid target instead of trapping it. Large
confirmed displacements reset prediction. Death, known freezes, decisions and stale connections
ease back to confirmed presentation, including the camera.

`PREDICTION_MS` and `MAX_INPUT_HISTORY` bound replay work for one player. When the lead exceeds
that window, replay uses the newest inputs so a stop or turn still takes effect. Long render
frames retain their elapsed animation time and replay movement up to the same safety limit.
Held movement refreshes its sequence at `MOVE_REFRESH_MS` (still subject to the network send
throttle), bounding accumulated timing drift when the host loses simulation time. Prediction
never steps a second full simulation or rolls back combat. Extreme latency remains visible,
and a hit can still arrive after the local picture appears to have moved clear.

- **Loading**: the host waits up to 20 seconds for everyone's map. Anything that comes for the run
  while a player's map is still loading is kept and handed over once their copy's made
  (`toCoopRun` in `GameClient`), so a guest who loads first, slowly, or leaves meanwhile isn't
  lost.
- **Versions**: each player's game says its build (`__BUILD_ID__`, the version and commit), and a
  room only takes players on the host's, as different builds fall out of step.
- **Out of step**: every 50 frames the host sends a hash of its run (positions, hitpoints, the
  RNG, buffs, inventory, caskets and level ups). A guest whose run differs leaves and ends its own
  run, rather than everyone waiting on a copy that can't recover.
- **Waiting**: anyone the run waits on for 20 seconds (`DECIDE_AFTER_MS` in `CoopRun.ts`) has
  it decided for them by the host: the first reward, taking the casket, or walking away from the
  offer. The host can kick a player from the menu mid-run.
- **Hidden tabs**: a co-op player whose tab is hidden keeps stepping off a worker's timer, so the
  host keeps the run going and a guest keeps up.

For that every copy has to agree to the bit. The sim only uses its seeded `Rng`, and its
trigonometry goes through `fm` in `core/fmath.ts`: the browser's own `Math` on your own (so solo
runs are as they were), and in co-op versions built from `+ - * /` and `sqrt`, which every engine
rounds the same. Use `fm.sin`, `fm.cos`, `fm.atan2`, `fm.hypot`, `fm.acos` and `fm.pow` in
`core/`, never `Math`'s (`Math.sqrt`, `floor`, `round` and the like are fine).

The sim's player state is split into `Hero`s, one a player. `sim.player`, `sim.weapons`,
`sim.stats` and the rest are the current hero's: whichever one the sim is working on (an enemy's
target, a projectile's owner, whoever's picking something up), and between ticks the one this
browser plays (`focus`). Something that belongs to a hero (a projectile, a thrall, burning ground,
venom) remembers whose with `hero`, and the sim works as them when it acts. Whatever replaces,
merges with or caps those (an orbit weapon's orbs, burning ground, a power-up's timer) matches on
`hero` too, so one player's never takes the place of another's. Co-op actions go
through `sim.as(hero, ...)`. Events that are a hero's own (a hit taken, a pickup, a casket) carry
`hero` in co-op, so the client shows its own and leaves the rest. A solo run has one hero and
plays exactly as before.

Anything that lands where players stand (a boss's swing, bullets, ground marks, pools, a stomp)
checks each hero still up with `forEachHeroInReach`, not just the current one, and what a boss
does to a player (a curse, a parasite, being held) is kept on that `Hero`. Who a boss aims at is
the hero nearest it, as the current one when it acts. Outside a loop over the heroes,
`this.player` is whichever hero the sim last worked on, so don't lean on it there.

When adding to the sim:

- State that's a player's own goes on `Hero`, with a getter on `Sim` like the rest.
- Something that lingers (a projectile, a pool, a turret) carries `hero`, and acts with
  `useHeroAt(thing.hero)`.
- A new event that's about one player goes in `PERSONAL_EVENTS`, so it's tagged with who.
- Trigonometry goes through `fm`. `core/fmath.test.ts` fails on `Math.sin` and the like in
  `core/`.

How much bigger the crowd gets for each player is in `content/coop.ts`, worked out again whenever
one goes down or leaves, with each of those still counting as half a player (`PLAYER_GONE`).

Rooms only take players who've unlocked their map (and its endless, for an endless room), and the
host can only pick maps everyone in the room has, so nobody skips ahead: someone without it is told
"You need Barrows unlocked to join this room", and the open list shows that room as locked to them.
Each player's game sends the maps it has (`unlocks`), checked by the relay on joining, on the host
changing the map or endless, and at the start. `MULTIPLAYER_ANY_MAP=on` (or `--any-map`) lets anyone
into any room instead, and a win then opens that map for a player who hadn't got there. With no
accounts, a player's maps are their game's word: this keeps fair players fair rather than stopping
a cheat.

A game that's given a map or adventurer it hasn't got (from a newer or made-up game)
leaves the room rather than playing a run it can't, and other players' shop bonuses are kept within
what the shop sells.

Nobody types a name. The relay gives each player one as they connect (in `welcome`), and each room
one as it's made, from `server/name-gen.mjs`: two words, like "Plucky Chinchompa" or "Moonlit
Crossing", from short lists picked so any pair reads fine. That's why there's no list of banned
words to keep. A name's only one player's (or room's) at a time, and a number goes on the end once
the pairs it tries are all taken. **New name** (`rename`) asks for another, except during a run,
when everyone's copy of it has the old one. A name a game sends is ignored, and there are no
accounts, so a reconnect gets a new name. When adding words, keep them ones that can't make
something unfortunate next to any word in the other list.

`server/coop-relay.mjs` holds the rooms (code, name, open or invite only, host, map, members and their
ready state and loadout) and forwards `up` messages from guests to the host and `down` messages
from the host to everyone else. The host leaving a run ends it for everyone; in the lobby the
room goes to the next player. The balance bot plays a party with `PARTY=4`, each player on their
own, so it can't show teamwork.

The open rooms list comes a page at a time (8 rooms, the fullest first, then the ones waiting
longest), worked out once after each change rather than for every request; the menu asks for its
page every 5 seconds, and again when joining fails (a room that filled up or started meanwhile).

To try it locally, `npm start` and open the game in two windows (one private, for a
save of its own), make a room in one and join it from the other. A second ordinary window says the
game's open in another tab, and Play without saving lets it play (see Saves).

### Touch screens

Everything touch only hangs off `pointer: coarse`, so a mouse and keyboard never see it:
`isCoarsePointer` in code, a media query in `Mobile.css`.

- `client/GameTouch.ts` is the stick, with no DOM. `GameInput.getMoveVector` reads it when no key
  is down, so the sim gets the same input a keyboard gives: length 0 or 1.
- `ui/TouchControls.tsx` feeds it pointer events. The whole screen is the stick, with the buttons
  on top. Its buttons act on `pointerdown`, because a browser won't fire `click` for a second finger
  while the thumb's down.
- `ui/Mobile.css` lays the screens out again for a phone held sideways (`max-height: 520px`). The
  UI's zoom never goes below 1, as the pixel fonts don't survive it, so a new screen needs rules
  there too. Check it at 844x390 and 667x375. It's imported last, so it wins over the other CSS.
- A touch screen also gets a pixel ratio capped at 1.5, 2 workers instead of 4, and a closer camera
  on a phone.
- `public/manifest.webmanifest` lets a browser install the game to the home screen (HTTPS only,
  apart from localhost), opening full screen and sideways. `enterFullscreen` leaves an installed
  game alone. iOS ignores `orientation`, so an iPhone still gets the rotate notice, and it can give
  an installed game its own storage, without the saves or cache from Safari. There's no service
  worker, so it still needs a connection. The icons in `public/icons/` are whole multiples of
  `favicon.png`, to keep its pixels square.
- `client/saveFile.ts` exports a save. Installed on iOS it uses the share sheet, since a download
  there opens a sheet too small to use when held sideways. Everywhere else it's a plain download.

To test it, Playwright's `isMobile` and `hasTouch` turn on `pointer: coarse`, and CDP's
`Input.dispatchTouchEvent` sends real multi-touch. Mouse clicks don't test any of this.

### Saves

The save is in localStorage under `rune-survivors-save` (`LocalSaveStore` in `core/save.ts`). A
tab loads it once and writes the whole of it back after each run or purchase, so these keep one
from being lost:

- **One tab at a time.** `client/SaveLock.ts` holds the Web Lock `run-escape-save` for as long as
  the tab's open. Another tab doesn't save, and says the game's open elsewhere: Play here takes the
  lock, and the tab that had it stops saving. When the tab with it closes, the next one gets it.
  A tab reads the save again whenever it gets the lock, so it carries on from where the other left
  off. Never rename the lock, or an old tab and a new one won't see each other. Without Web Locks
  (Safari before 15.4, or plain http other than localhost) every tab saves, as before.
- **A newer game's save isn't written over.** Every write marks the save with `gameVersion`
  (`package.json`'s). One from a newer version, or with a `version` above `SAVE_VERSION`, is played
  but not written, and the player's told to reload. `migrateSave` keeps only the ids it knows, so
  an older game would otherwise drop new maps, upgrades and items. `SAVE_VERSION` alone can't
  tell, as new ids don't raise it. This catches a tab left open over a deploy, and an older branch
  on the dev server. Import turns one away too. Export gives the stored text as it is, not this
  game's pruned copy. Save anyway (`saveOverNewer`) writes over it after all, losing only what was
  new: the way out when a release is rolled back, so every player isn't stuck not saving. It isn't
  offered for a newer `version`, whose format this game can't read. The check comes before
  `migrateSave`, so a newer save that won't migrate still counts as newer, not unreadable.
- **One that won't load is kept.** A save that won't parse goes to
  `rune-survivors-save-unreadable-<Date.now()>` (the last two are kept) before a fresh one takes
  its place. The title screen says so, with Export, and Settings lists them to export or delete.
  With no room in localStorage for the copy, it stays where it is and nothing's written over it;
  the panel says so (`noRoom`), with Export.

Play without saving closes the panel, and a Not saving button on the title screen and in the pause
menu opens it again. What's bought or earned meanwhile lasts until the tab gets the save back or
reloads: getting the lock reads the stored save, which replaces what this tab had in memory. When
the lock goes mid-run, a solo run pauses under the panel (co-op's goes on for the others).

The desktop app has one window and plays the newest game it has, so neither tabs nor an older
game come up there; an export from a newer version is turned away on import, as anywhere.

### Notice

Whatever's written in [public/notice.md](../public/notice.md) pops up on the title screen until the
player closes it, once: a `# Title`, then paragraphs and `- ` lists, with `**bold**`. Changing it
shows it to everyone again; with nothing but its comment there's no notice. It's fetched when the
game loads rather than built in, so on a hosted game `notice.md` can be edited on the server.

### Versions

The version is `package.json`'s, shown in the title screen's corner, and [CHANGELOG.md](../CHANGELOG.md)
says what changed in each one; the title screen shows it too. Note changes under Unreleased as
they're made. For a release, `npm version minor --no-git-tag-version` (or `patch` for fixes alone),
then turn Unreleased into the new version's heading with the date. A test checks the two agree.
