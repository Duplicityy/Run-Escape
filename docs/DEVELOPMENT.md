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
connection in no room that's done nothing but ping for 10 minutes is closed (browsing the list
counts as doing something: a player waiting for a room), as is a room left alone for half an hour.

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
| Connections from one address  | 16 (a household or LAN party behind one address), and 128 from one IPv6 /48                           |
| Rooms hosted from one address | 4, and 16 from one IPv6 /48                                                                           |
| Rooms made from one address   | 10 a minute                                                                                           |
| Rooms joined from one address | 12 a minute (joining and leaving are each a room update for everyone in it)                           |
| Wrong room codes              | 20 a minute from one address, and 80 from its IPv6 /48, then it has to wait                           |
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
limits of its own: one person can easily have all of a /48's /64s, but a mobile provider can put
many homes in one, so nothing is refused for a /48 that one of its homes alone would get. A kicked
player can't rejoin that room from the same address (their /64). A room update carries
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

**On Cloudflare instead.** [server/cloudflare/](../server/cloudflare/README.md) is the same relay
as a Cloudflare Worker with Durable Objects: a lobby for the rooms list and names, and each room its
own object, started near its host, so a run's traffic doesn't cross the world to one server. There's
no server to run, and it's at a `workers.dev` address with no domain needed. Its README has the
setup, from `wrangler login` to the build, and what it costs. The game works with either relay.

#### Optional multiplayer metrics

A server that hosts the game (`npm run serve`, or the standalone relay) serves multiplayer metrics
by default, on a separate listener bound only to `127.0.0.1`, port 8788. The endpoint serves
Prometheus text format 0.0.4 with `HELP` and `TYPE` metadata. Read it from the server itself:

```sh
npm run serve
curl http://127.0.0.1:8788/coop/metrics
```

In PowerShell:

```powershell
npm run serve
# From another terminal:
(Invoke-WebRequest http://127.0.0.1:8788/coop/metrics).Content
```

Set `MULTIPLAYER_METRICS=off` (or `false`, `0`, `no`) and restart to turn the metrics listener off
(`$env:MULTIPLAYER_METRICS = "off"` in PowerShell); `on`, `true`, `1` or `yes` turn it on. Any other
value, an empty one included, is the same as none, like `MULTIPLAYER`. The dev server and
`npm run preview` only run the listener when it's set to `on`: nobody scrapes a dev server, and two
checkouts would fight over the port. If the standalone relay uses `MULTIPLAYER_PATH`, the metrics
path is that path plus `/metrics`. Multiplayer must be running for metrics to be available. Set
`MULTIPLAYER_METRICS_PORT` to another port (1–65535) if needed, for example when running several
relays on one machine. If that port is occupied, the server logs an error and co-op keeps running
without metrics; they are never moved to the public listener. The metrics listener closes with the
relay.

The metrics are:

- Player gauges: `coop_players_connected`, split into `coop_players_browsing` (no room),
  `coop_players_lobby` and `coop_players_in_run`. These count WebSocket connections, so multiple tabs
  count separately; single-player games aren't counted.
- Room gauges: `coop_rooms`, split into `coop_rooms_lobby` and `coop_rooms_in_run`, and separately
  into `coop_rooms_public` and `coop_rooms_private`. Public rooms include full and started rooms.
- Counters since startup: `coop_connections_total` (accepted connections), `coop_rooms_created_total`
  and `coop_runs_started_total`.
- Peak gauges since startup: `coop_players_connected_peak` and `coop_rooms_peak`.
- Uptime gauge: `coop_uptime_seconds`.
- Configured limit gauges: `coop_connections_limit` and `coop_rooms_limit`.

For example, part of the response looks like this:

```text
# HELP coop_players_connected Currently connected player sockets.
# TYPE coop_players_connected gauge
coop_players_connected 4
```

For Prometheus running on the same machine (and in the same network namespace if using containers),
add this job to its `scrape_configs`:

```yaml
scrape_configs:
    - job_name: run_escape
      scrape_interval: 15s
      metrics_path: /coop/metrics
      static_configs:
          - targets: ["127.0.0.1:8788"]
```

Adjust the target port or metrics path if you changed the settings above. Samples have no labels
or explicit timestamps; Prometheus supplies scrape timestamps.

Counts are in memory and reset on restart. Each GET reads the existing rooms once; totals and peaks
update only on connections, room creation and run starts. There is no background sampling, extra
package, disk write or per-message tracking. Responses aren't cached. Refresh the URL for a live snapshot;
if using a monitor, polling every 15–30 seconds is plenty for these counts.

The public game/relay port always returns 404 for `/coop/metrics`, even for requests coming through
a local reverse proxy. Keep port 8788 out of public proxy routes and container port publishing;
run the request on the server (inside its container if applicable), or use an SSH tunnel. `HOST`
only controls the game/relay listener and cannot make metrics listen publicly.
Metrics contain aggregate numbers only, with no player names, addresses or room codes. The public
`/coop` availability response contains only `{"coop":true}`, so it doesn't expose aggregate counts.

## Desktop

**Co-op on desktop.** The app answers every https request itself, so it only reaches a relay built
into it. Set the `COOP_URL` repository variable (Settings, Secrets and variables, Actions) to
`wss://example.com/coop`, and the release workflow builds it into the game and the launcher. It
has to be `wss://`, and the app lets only that address out: `protocol.handle` in `main.ts` answers
every other https request itself, and WebSockets, which don't go through it, are kept to the relay
by the `Content-Security-Policy` header `gameServer.ts` sends (`connect-src`). Without it there's
no Multiplayer.

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

The actions it uses are pinned to commits, with the version in a comment beside each. Dependabot
(`.github/dependabot.yml`) opens a pull request when one has a new release, so don't move them by
hand.

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
            mode's numbers); raids (a raid's rooms, points, supply chest, teleporters) and theatre
            (the Theatre of Blood's bosses)
    fun/    the fun maps (endless, random bosses) and their players: outfits, chat, shots
  core/     the game in plain TypeScript (no DOM), tested with vitest
    Sim.ts            fixed 20ms tick: movement, enemies, spawning, weapons, pickups, power-ups,
                      levels
    BulletPool.ts     a boss's bullets, in flat arrays: hundreds at once, no allocation in the tick
    world/            ArenaGrid (collision + heights), Collision (circle vs tiles and walls),
                      FlowField (Dijkstra from the player, how hundreds of enemies find a way),
                      FlightGrid (the terrain walls that stop what flies: blocked floor that
                      isn't liquid, and solid clumps too big to be a tree). A grid works out
                      once, as it's made, which steps out of each tile are allowed (`Steps`,
                      for flow fields and straight walks). Sim makes the FlightGrid with the
                      map when anything on it flies (`hasFliers` in content/maps.ts), since
                      making it takes a while
    SpatialHash.ts    enemies (and piles of bones) by cell, for what's near: flat arrays over
                      the arena, kept from tick to tick
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
            GameAssets (what gets baked), GameStore (state for the React UI, and the HUD's
            numbers apart from it), SaveLock (one tab saves at a time), DamageMeter (each
            weapon's damage a second for the HUD's damage panel), Minimap
    coop/     CoopLobby (the relay connection and the room), CoopRun (a run's lockstep, host or
              guest), protocol (the messages)
  render/   GameWebGLRenderer (the map viewer's renderer with the game's passes), CameraRig
  ui/       React screens and HUD, ChestModal (the casket opening), EventModal (a random event's
            offer), ItemIcon, CoopScreen (the rooms, the lobby, the party in a run),
            formatCompact (short numbers like 9.5K and 1.2B, for the damage panel)
  client/GameTouch.ts, ui/TouchControls.tsx, ui/Mobile.css   touch screens (see Touch screens)
server/     coop-relay.mjs: co-op's rooms, and passes each run's frames between its players
  cloudflare/  the same relay on Cloudflare Durable Objects, each room near its host (README.md)
src/mapviewer/webgl/actor/   actor renderer: baked animation frames drawn anywhere in the world,
                             any number of them, one multi-draw per segment and pass (without
                             multi draw, one instanced draw per frame of an animation)
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

The main thread and every worker decode the cache's tables for themselves, so they're kept small:
an index's reference table is decoded the first time something reads the index, into flat arrays
(`ReferenceTable`); a group's files stay in one array (`Archive`), so a file's data can be part of
a bigger buffer (mind its `byteOffset`); and `MapViewer`'s loaders are made the first time they're
used. The game's main thread only needs the textures, the seqs of animated scenery and the map
index, plus the locs when a ScapeRune recipe runs.

### Boss fights as data

A boss's fight is in its `BossDef` and `BossAttackDef`, with no boss named in `Sim.ts`. The Nightmare
(`content/nightmare.ts`) is built from these, and any boss can use them:

- `BossDef.intro`: the player's safe, the screen goes dark, what's left runs for the map's edge and
  is gone, and the boss rises. `alone` stops the waves until it's dead. `atMiddle` rises it at the
  middle of the map's `bossArena` with the players stood `distance` south of it (Phosani's), and
  `holds` roots them until it's over: `Sim.introHolds`, which the movement rules and co-op's
  prediction take like a hold. A boss's cooldown doesn't run while it rises, so the grace after an
  entrance is set as it rises: a second, or none after `holds`.
- `BossDef.phases`: a shield, then totems in the corners, then a blast for a share of its hitpoints.
  Only the shield takes hits, in `damageEnemy`. Totems are enemies that can't die: their hitpoints
  are the charge they still need, and `shieldEnd` is `Infinity` while they can't be hit, which keeps
  weapons off them. With the shield down the boss is off them the same way, and a projectile flies
  on through it with no blocked splat (`stepProjectiles`), so nothing of the player's registers
  on it until the totems have blasted.
- Attack kinds `pattern` (rings, spirals, aimed spreads), `ground` (marks that land, or stay armed;
  a `ring` of marks is round the boss unless `around: "player"`, as Phosani's claw on the player
  has), `quarters`, `surge` and `mark`, and `phases` on an attack for when it's used.
- The bullet hell's own tools (Phosani's Nightmare): `chain` uses an attack again straight after,
  with its own windup, a lane or spots picked afresh each time; `toMiddle` leaps the boss to the
  arena's middle as it begins (a `quarters` attack's lines cross there, placed where it will
  stand), with its `leash.jump` if it has one, the windup then running from when it's up
  (`leapToMiddle` returns the spot and the jump's ticks, and `stepLeap` goes on to the windup's
  animation), and the view flashes the quarters that will hurt red for a second as the flowers
  first appear (`flashQuarters`, a colour overlay); `QuartersDef.during` has
  it stand among its flowers using only those attacks at its own interval; a `pattern`'s `gap`
  leaves a way through a ring that turns with it, and `track` re-aims a spread's every volley.
- More of them, from the bullet hells she's modelled on: `gapAt` puts a ring's gap on the player or
  away from them (Hush's ring with the gap at Isaac); `mirror` fires each volley again mirrored
  about the aim, so the two turn opposite ways (a sweep's arms open like scissors, a spiral winds
  against itself, as Doremy's do); `speedUp` quickens each volley so rings catch each other up
  (Sparen's stacks); `around` fires a ring in from a circle round the player (Doremy's Ochre
  Confusion); and `follow` on an attack names the one that comes delay seconds after it's fired,
  through whatever's in the air (Rumia's slow rings and then an aimed volley). `summon.distance`
  puts summons in a ring that far out, and with `summon.thrown` they fly out of the boss to spots
  that far off in random directions (`Enemy.flung`, drawn in an arc by the view), shielded until
  they land. An enemy with `hatches` is gone after its seconds with its `into` out where it stood
  unless it's killed first (counted from landing, when thrown), `objId` draws it as an item's
  model with nothing to animate (Phosani's eggs are the Parasitic egg, baked as an `obj` under the
  enemy's key), `healthBar` keeps its bar over it from the start, and `solid` has the player give
  way instead of pushing it (as what can't move already did). A boss faces down its lane from the
  moment a `surge` is picked until the charge is done, and totems face the arena's middle plus
  `totems.yawOffset`, since The Nightmare's totem model has its scroll three-quarters of the way
  round from its yaw (the crowd code leaves their yaw alone). A ground attack's `grab` plays its
  `middleSpotAnim` out in full where each mark lands (an `Effect` with `fitRadius`, which the view
  scales to), instead of the faint warning just vanishing: the warning is a frame of the hands up
  (`GRAB_WARNING_TICK`) held still at `GRAB_WARNING_ALPHA`, as wide as the mark (`fit` 1), kept
  until the real hands have risen into sight (`grab.up.from`), and the mark only hurts from then
  until they sink (`up.to`), so what's drawn is what's hit; Phosani's marks are 0.75 tiles, near the
  real fight's one-tile hands, with more to a ring. The mark stays up for the grab's seconds (`GroundHazard.grabEnd`)
  and hurts each hero once who steps in meanwhile (`hit`), and the boss's `channelEnd` runs to
  the end of the animation, so a chain's next round waits for the hands. `leash.jump` has a leashing boss play a down
  animation where it is and an up one where it lands (`BossState.leap`), doing nothing else
  meanwhile, and never between a `chain`'s links or before a `follow` (a charge ends at the far
  edge and its next lane is picked from there; a leash then had her sink, come up by the player
  and snap back to the lane). A bullet is drawn no smaller than its hit radius, whatever its
  `scale`, so a miss that looks like one is one. The view shows a surge's lane for its first second only, and a grab mark is its hands
  alone (no outer model), faint until it lands. The Nightmare's NPC ids are
  several models on two skeletons: her real absorb (8604) and pit rising (8610) are on the other
  one (npc 9431's) and tear her usual model apart, so `nightmare.ts` uses her summon for the
  absorb and 8594 for a charge's wind-up, with 8607 and 8609 (npc 9432's) as her sink and rise.
  `scripts/cache/find-npc-seqs.ts` lists what each id's skeleton can play. `hintArrow` on an enemy has `BossFightView` draw the cache's
  hint arrow sprite (`HINT_ARROW_SPRITE`, `headicons_hint`) bobbing over it, or an arrow at the
  screen's edge when it's off the screen, as the totems get.
- `Sim.bossArena` is the square all this goes by: `MapDef.bossArena`, or the whole map. Nothing's
  sized by hand, so she fights on any square.
- A map's `music` names an OSRS track, and its recording (from the OSRS Wiki) goes in
  `src/media/music` as the name in lower case with underscores: `the_bane_of_ashihama.ogg` for
  Phosani's Nightmare. `GameClient` finds the files with a glob, so a track can be named before
  its recording is in: the map is silent until it is, and nothing breaks.
- `MapDef.fight` makes a map one fight (Phosani's Nightmare, `content/phosani.ts`): no waves, its
  final boss event at 0, and the adventurer's starting weapon at `weaponLevel` from the first tick,
  with nothing in the fight dropping anything (`dropLoot` keeps only the collection log's
  trophies there). Phosani's is built from her data alone: her sweep
  is a one-bullet `spread` that `turn`s each volley, and her husks are a `scatter` summon of
  enemies with `holds`, which pin the player once they arrive (`holdPlayer`).
- What makes a bullet hell hard, all defaulting to how The Nightmare plays: `BossDef.bulletGrace`
  is the seconds after one of its bullets hits before another can (`stepBullets`; a second unless
  set, Phosani's 0.3). A pattern's `channel` is how long the boss stands still for it instead of
  until its last volley, so the next attack comes through it (`startPattern` keeps the later
  `channelEnd`; Phosani's rings and spirals get 0.5 from the loop at the end of `phosani.ts`, her
  aimed spreads none). A pattern's `burst` fires `count` volleys and then pauses `pause` seconds
  (`stepEmitters`), so a fast sweep's arm is short solid pieces with holes between them that a
  player can run through; `patternSeconds` counts the pauses in how long the boss stands for it. `BossPhasesDef.phases[i].ambient` names a pattern attack of its (weight 0,
  `phases: []`, like an opener) begun again every `interval` seconds on the phase's own timer
  (`BossPhase.ambientNext`) in `stepPhase`, under whatever else it does, through holds and
  cooldowns, with no channel, and not while it's under the ground (`leap`) or its sleepwalkers
  walk (`BossState.walkers`, outside a finale: the ambient's emitters are dropped and it begins
  again the moment they're done, so a player up by it shooting them has nothing to step
  through). `BossDef.fallSeconds` on a final boss keeps the run going that long after it falls
  (`Sim.victoryAt`), with nothing landing on the players, so its death animation plays before
  the victory screen, all of it (the view cuts other deaths at `MAX_DEATH_ANIM_TICKS`, and
  `corpseTicks` keeps the body that long); the run's time is to the fall (`endRun`'s `at`).
  Phosani's is her death's 5.4 seconds. `tempo` multiplies
  the boss's interval and its pattern attacks' windups (only those: the big hits keep their
  warnings) in `startBossAttack`, and `speed` its walk, applied as each phase begins. `finale`
  keeps the boss up for `seconds` after the last blast as a stage of its own (`stage: "finale"`,
  untouchable like the totems stage, the HUD's bar the time left): it opens with `opener`, keeps
  to `attacks` at `interval` like the flowers' `during` (`keepsTo`), doesn't wait for its
  sleepwalkers (`stepWalkers` doesn't stop it), runs the finale's own `ambient`, and
  `stepPhase` kills it when the time's up. `Hero.damageByAttack` is what each boss attack did to
  that player, by name: `sim.damageByAttack` in the console, and the balance bot's `boss attacks
that hit` line, for tuning a fight.
- The Theatre of Blood's bosses (`content/theatre.ts`) add: patterns `wall` (a row with a gap
  somewhere new each volley) and `closing` (a ring round the player, coming in), ground marks that
  `lingers` and hurt while you stand in them, and `safe` marks a projectile spares you in;
  `EnemyDef.protects` (a share of ranged or magic weapons' damage); `BossDef.naps` (the Bloat: up
  and guarded, then down and open, then a stomp); and for a raid's expert mode `EnemyDef.onlyStyle`,
  `BossDef.colours`, `BossDef.stare`, `EnemyDef.expertAs` and `BossAttackDef.expert`.

The curse is applied to the input in `stepPlayer`, so keys and the touch stick go the same way.

Her animations are picked by eye, as `classify-npc-seqs.ts` can't tell them apart: she floats in all
of them, so none ends lying down. `find-npc-seqs.ts` scans every sequence and now runs out of the
2.4 GB a heavy job gets; `classify-npc-seqs.ts` with a band of ids is what got them.

### Raids

`MapDef.raid` makes a map a raid: rooms in `content/raids.ts`, each with its waves, its boss and
where things are. `Sim.stepRaid` runs them: a room's waves until its boss is due (`RaidRoomDef.at`,
a run second, as a campaign boss's), then the party's moved into its boss room (`startRaidBoss`,
`moveParty`), and once the boss is down the room's scored (`scoreRaidRoom`), each player gets the
supply chest (`openNextRaidShop`, an event offer paid in raid points) and the next room starts.
The last room's boss is the final boss, and its chest (`openRaidChest`) goes on the result.
Raid wins are kept by the save like a campaign map's; hard opens after one, endless never does, and
expert mode (`SimOptions.expert`, solo only for now) after a hard one. A hall's teleporter
(`stepTeleporter`) asks before skipping to its boss, `SimOptions.raidTeleports` times a raid, in
the halls `SimOptions.raidPortals` says (`getRaidPortals`: rooms whose boss the save has a kill of,
in any form). The game draws the portal (`raidTeleporter`), as it isn't in the map. Raid bosses'
rings, spreads and walls start `MELEE_POCKET` tiles out (`BulletPatternDef.from`), and their
hits are lightened to match a faster `attackInterval` (`oftener` in `theatre.ts`).

`?raidtest` (dev server only) puts a raid's rooms two minutes apart and every level up's pick at
its max; `?raidtest=short` does only the first.

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
gets from the model's origin in any frame of any animation, so bosses' big swings count. Without
`WEBGL_multi_draw` (Safari, Firefox) every draw is a real draw call, so `InstanceList.sortByFrame`
puts the actors on the same frame of the same animation together and each run of them is one
instanced draw: a crowd of one enemy is a few draws, not hundreds. The shader finds an actor's data
by `DRAW_ID + gl_InstanceID`.

Map squares keep only the world that can be seen. Past the play area the world fades into the sky
over 6 tiles (`PLAY_AREA_FADE` in `fog.glsl`), and a ray from the camera only gets further from the
play area once it's left it, so what's past the fade and further out than the camera can get is
never in front of anything but the sky. `GameWebGLRenderer.setPlayArea` works that keep area out
from `CAMERA_REACH` in `GameClient` (a run's camera can be 15 tiles south of the player, zoomed all
the way out; the title screen's circles closer in). The worker leaves out terrain, scenery and
animated scenery wholly outside it (`SdMapLoaderInput.keepArea`), and `MapManager` doesn't load a
square that's all outside. Collision doesn't come from these squares (it's `RegionDataLoader`'s),
so it isn't touched. If the camera's
pitch or zoom changes, `CAMERA_REACH` has to follow it, or the hole where something was left out
can show.

The game has no hover menus, multisampling or FXAA, so its frames are drawn straight to the canvas
(`drawsToCanvas`), with no framebuffer of their own and no screen quad to copy them across. The
canvas has `alpha: false`: the page behind it is black, so there's nothing to blend it with. The
map viewer keeps its framebuffer, for its hover menus. A script that reads a frame back reads the
canvas, in the same task as the frame (there's no `preserveDrawingBuffer`).

Enemies are baked when a run starts, for that map (`getMapEnemies`, `GameAssets.loadEnemies`), in
place of the last map's: they're most of the actors' memory, and a map uses few of them. It goes by
the enemy ids it finds in the map's waves, events and bosses, and in those enemies, so a new way for
an enemy to bring on another needs nothing added. An enemy that isn't baked anyway (the console's
`spawnBoss`) gets baked when it's first drawn, and shows up a moment later. The last map's enemies
stay on the menus, so playing it again starts at once; a run on another map drops them before
its own bake starts, so the two lots are never in memory together.

Enemies that would bake the same model are baked once (`GameAssets.mergeRequests`): the same NPC
with the same first animation (Nex's four phases), the same outfit, the same scenery. The merged
model has all of their animations, and the other enemies' keys point to it. A request's body is
everything its bake reads (`getRequestBody`), so a new field on a bake request goes in there too.

A bake is cut into small tasks (`getBakeTasks`: an NPC or player model each, the spot animations,
items and scenery a batch at a time), and each goes on the GPU as it lands, as a page of its own.
Baking a map's worth in one go per worker held all of it in the main thread at once, a spike of
hundreds of MB at the start of a run on the big maps, the likeliest moment for a phone to lose the
tab. The worker sends buffers cut to their length, not the doubled ones it grew.

A player is baked with the swings of the weapons they hold (`getRunAttackSeqs`) rather than every
weapon's, so a new weapon re-bakes them (it changes their `appearanceVersion`). Until it lands
the old model draws, and a swing it hasn't got shows the stance's animation instead. So that a
weapon picked swings at once, a level-up that offers a weapon re-bakes the look with its swings
as soon as it's offered (`getOfferedAttackSeqs`), and a look that has the swings asked for and
more isn't baked again: the ones not picked go at the next re-bake. The menus' look has the
starting weapon's swings (`setCharacterLook`), so a solo run starts with it baked.
`getPlayerAttackSeqs` is every weapon's, for the slim cache.

A baked animation is a posed copy of the model per frame, so what an enemy costs is its triangles
times its frames. A skeletal animation (the Colosseum's bosses, the gryphon, the naguas) has a pose
for every client tick, and baking each one made Varlamore's enemies several times any other map's,
too much for a phone. `ActorBakeLoader` samples those every `SKELETAL_TICK_STEP` ticks instead.

Indices are 16-bit, which halves the index buffer, about a quarter of a bake. WebGL2 has no base
vertex for a draw, so `ActorBakeSegments` cuts a bake's vertices into segments of up to 65,536,
never splits a frame between two (and an animation only if it doesn't fit in one), and counts each
frame's indices from its segment's first vertex. Each segment is drawn with a vertex array that
starts there (`ActorSegment`), so a page is a draw per segment that has something on screen. A
model with more vertices in one frame than that has its whole bake fall back to 32-bit.
`render-stats.ts --bake` shows each map's total and the heaviest actors, so a new boss can be
checked against the other maps before a phone finds it.

The overlay draws each hitsplat (its kind, number and size) once and copies it after, and the
projectile glows likewise: text and gradients are the slowest things on a 2D canvas, and a big
fight has a hundred splats. The effects it prunes each frame are pruned in place, and the enemies
reuse one options object, to keep a phone's garbage collector quiet.

`window.frameProbe` (dev only) counts what a frame sends to the GPU, at the GL calls:
`await frameProbe.sample(60)` gives triangles, draws and CPU time, split into world and actors.

Combat sounds are picked by the server, not the cache, so the ids in `content/` come from the OSRS
Wiki's [list of in-game sound IDs](https://oldschool.runescape.wiki/w/List_of_in-game_sound_IDs).
A sound's samples are let go once it's first played and its `AudioBuffer` holds them
(`GameAudio.getBuffer`), so each sound is only in memory once.

### Keeping it light on a phone

- **Frame cap**: `GameClient.update` sets `Renderer.fpsLimit` every frame from the Frame rate
  setting (`DisplaySettings.frameRate`, in Settings and the pause menu), through `frameCap`. Auto,
  the default and what older saved settings get, is 60 on a touch screen (90 and 120 Hz phones
  would draw twice as often for a sim that ticks 50 times a second) and no cap on a desktop; 30,
  60 and Unlimited are what they say. On the title screen and behind a solo run's menus (level up,
  casket, random event, pause, results), where only the scenery moves, it's 30 at most whatever
  the setting. Co-op isn't capped behind its menus, as its run goes on. The limiter keeps to a
  schedule rather than a gap since the last frame, so a 90 Hz screen capped at 60 draws two frames
  in three (`Renderer.test.ts`).
- **Lost graphics**: a phone can take the WebGL context away (short of memory, or the game in the
  background). `GameApp` calls `preventDefault`, pauses a solo run (`GameClient.onGraphicsLost`),
  stops drawing (`GameWebGLRenderer.contextLost`; a co-op run still steps for the others) and
  shows a Reload button, which ends the run as the pause menu's quit does, so its coins and quests
  are kept. There's no restore: everything on the GPU (programs, the texture array, map squares,
  the actor bakes, which aren't kept in JS) would have to be made again on the new context, which
  means `WebGLMapViewerRenderer.init` again, `clearMaps`, and baking every actor again. To try it,
  `game.renderer.app.gl.getExtension("WEBGL_lose_context").loseContext()`.
- **The HUD** is updated 10 times a second, in two parts. `UiSnapshot.hud` (`HudView`) is what the
  hero has (slots, gear, inventory), which changes with a level up or a casket. `HudNumbers` is
  what changes as the run's played (hitpoints, xp, the clock, damage, buffs, the boss bar, quest
  progress), in a store of its own (`GameStore.subscribeNumbers`): the UI's root doesn't see it,
  and each part reads only its own number with `useHudNumber`. `shareUnchanged` keeps whatever
  hasn't changed the same object, so the `memo`'d parts skip drawing, and nothing is told at all
  when nothing's changed. Something new that changes often goes in `HudNumbers`, and its numbers
  are rounded as they're shown (whole seconds), so they don't change when nothing on screen does.
  The bars fill with `transform: scaleX`, not `width`, which would lay the page out again.
- **The minimap** redraws 30 times a second at most, leaves out enemies off it, and draws its
  dots a colour at a time.
- **The casket's rays** have their fade drawn into them (an SVG gradient), not a `mask-image`, which
  makes the browser draw the turning rays again offscreen every frame. They slow to a stop, and the
  glow, float and shimmer stop after a few goes. A phone gets one set of rays and no shimmer.
- **The bundle**: `WebGLMapViewerRenderer` is the game's renderer's base class, so anything it
  imports is in the game's bundle. leva comes in only through the viewer's controls
  (`getControls(folder)`), and the render worker loads jszip only for the viewer's exports.

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
                                         road grades, plots, what the camera can see, banned locs, clashes with a
                                         town's walls, gates, roads and fences, and how a map looks against the real
                                         world's numbers (ONLY=regex for some of them)
scripts/scaperune/grid-hash.ts halloween a hash of what a recipe writes, to prove a shipped map hasn't moved
scripts/scaperune/research/              measures real places and made maps the same way
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
                                                        PARTY=4 a co-op party of that adventurer;
                                                        GOD=1 untouchable and FUNNEL=1 all into
                                                        its best weapon, with ENDLESS=1, to see
                                                        how damage keeps up with the rounds)
scripts/dev/icon-test.ts 1321            draw an item icon as ASCII
scripts/dev/render-stats.ts lumbridge    what a map costs to draw, without a browser: triangles,
                                         draw ranges, bytes (--cull=8 checks the culling boxes and
                                         counts what spots draw, --bake is memory per map's actors)
```

Tests: `npm test`. `.github/workflows/check.yml` runs them with the type check on every pull
request (without the game's cache, so `generator.test.ts` skips its long map check there).

URL flags: `?room=ABCDE` joins a co-op room (the invite link), `?autostart=wizard` starts a run right away, `?stress=300` adds 300 goblins, `?viewer=1`
opens the original map viewer (loaded only then), `?bgtick` (dev only) keeps the game running in a
browser tab that isn't being painted, `?notice` shows the notice even after it's been closed, `?raidtest` (dev only) speeds up a raid (see Raids). F3
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
answer to the same one until the host's frame moves it on, or 10 seconds pass, so a double click
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
- `core/runHash.test.ts` pins three seeded runs (solo, hard mode, a party of four) to a hash of
  everything in them, tick by tick. A change that's meant to leave play alone, like a speed-up,
  has to leave them as they are; one meant to change play changes them, so check it's only the
  runs it should, then update the numbers.
- `sim.enemies`, `projectiles`, `enemyProjectiles`, `effects` and `pickups` are the same arrays
  from tick to tick, tidied in place, so don't keep one and expect it to stay as it was. Enemies
  and pickups stay in uid order, which finding one by uid relies on: add them only through
  `spawnEnemy` and `dropPickup`, at the end.

Weapon damage tuning lives in `content/balance.ts`; see [Weapon damage tuning](BALANCE.md) for
class, evolution and normal/hard mode examples. Weapon damage rules use the starting party size
throughout the run.

How much bigger the crowd gets for each player is in `content/coop.ts`, worked out again whenever
one goes down, is revived or leaves, with each of those down or gone still counting as half a
player (`PLAYER_GONE`).

Revives are in `content/coop.ts` too (how many a player gets, the hitpoints each brings back,
how long a teammate stands over them, how long the immunity lasts, and the extra revive's item,
price and how often the Mysterious Old Man has one) and `Sim.stepRevives`: a downed hero keeps
who's standing over them and for how long in `Hero.revive`, `reviveHero` brings them back, and
`Hero.immuneEndTick` is how long nothing can hurt them. An extra revive is a utility item whose
use is `revive` (the Prayer cape): `rollCasketItem` only gives it a weight in a party, a casket's
"take" grants it at once through `gainRevive` rather than stashing it, and the old man's offer
carries it as an `EventOption` of kind `revive`. Each adds to `Hero.extraRevives`. The immunity holds
`player.invulnerable` every tick, the way the sled does, and `nearestHero` and `useSpawnHero`
skip an immune hero while anyone else is up (pickups go by `nearestUpHero`, which doesn't: a
revived player can still eat). The reviver's emote (`REVIVE_SEQ`) is baked with
every player look in co-op through `getRunAttackSeqs`, and its graphic (`REVIVE_SPOTANIM`) with
the base bake.
Bosses come as copies (`bossCopies` there), spawned together by `Sim.spawnBosses`: each by a
different player, clear of the others, sharing one boss's hitpoints, experience and loot through
their `Encounter`, so the first says so and the last to fall drops the loot. A boss with its own
spots (`spawnAt`) gets no more copies than it has free spots, which keeps Pest Control's portals
single, and a scripted entrance (`startIntro`) stays one boss.

Rooms only take players who've unlocked their map (and its endless or hard mode, for a room on
them), and the host can only pick what everyone in the room has, so nobody skips ahead: someone
without it is told "You need Barrows unlocked to join this room", and the open list shows that room
as locked to them. Each player's game sends the maps it has (`unlocks`), checked by the relay on
joining, on the host changing the map, endless or hard mode, and at the start. Whether the run's on
hard mode goes out in `GameStart`, like endless, so every player's copy plays the same.
`MULTIPLAYER_ANY_MAP=on` (or `--any-map`) lets anyone into any room instead, and a win then opens
that map for a player who hadn't got there. With no accounts, a player's maps are their game's word:
this keeps fair players fair rather than stopping a cheat.

A room's map, endless and hard mode are the relay's: the host's game sends `settings` and shows
what comes back in the room update, never a pick of its own, so a refused one changes nothing. A
host picking a map keeps endless and hard mode on only where everyone has them for it
(`GameClient.roomHas`), which is what the relay would refuse otherwise. The title screen's own
pick (`mapId`, `endless`, `hard` in the store) is only for solo runs and for making a room.

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

The Cloudflare relay (`server/cloudflare/`) speaks the same protocol, with one more message: it
answers `create` and `join` with a `goto` (a room code and a one-time ticket), and `CoopLobby`
then makes or joins the room on that room's own connection, at `coop/room/<code>`. What's said in
a room goes over that connection (`ROOM_MESSAGES` in `CoopLobby.ts`); pings, the list and
making or joining go to the lobby's. The Node relay never sends `goto`, so with it there's only
the one connection. Change the protocol in both relays.

Cloudflare restarts its objects now and then, dropping their connections, so the Cloudflare relay's
`room` message carries a `token`. `CoopLobby` reconnects to `coop/room/<code>?resume=<token>` for
`RESUME_WINDOW_MS` when the room's connection drops, holding what's said meanwhile, and the room
(kept in storage) holds the player's place a little longer. A guest that misses some of the host's
frames sees it from `from` on the next `down` and asks for them with a `resend` up message; the
host keeps 20 seconds of what it's sent (longer than the room holds a dropped player) and answers
once a second at most, from the earliest frame asked for, to every guest; each takes only frames
after the ones it has, in messages of `RESEND_EVENTS` at most. That part works on either relay.
A guest numbers its actions that aren't decisions (`actionSeq`, so using an item), and the host's
frames echo the number; after reconnecting it sends again those not echoed yet, and the host takes
each number once. Decisions have their own resend (`DECISION_RESEND_MS`). The room saves someone
joining or leaving, and the run starting or ending, at once and before telling anyone; other
changes at most once a second. The Node relay sends no token, so with it a dropped connection
still ends a guest's run.

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
- A touch screen also gets a pixel ratio capped at 1.5 (2 elsewhere, `DeviceUtil.pixelRatio`), 2
  workers instead of 4, textures at half size (64 a side, a quarter of the memory), 60 frames a
  second at most unless the Frame rate setting says otherwise (see Keeping it light on a phone),
  and a closer camera on a phone.
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
