# Co-op relay on Cloudflare

The same relay as [`../coop-relay.mjs`](../coop-relay.mjs), as a Cloudflare Worker with Durable
Objects, so each room runs near its host instead of on one server wherever that is.

- **The lobby** (`src/lobby.mjs`) is one Durable Object for the whole relay. Every player connects
  to it first, at `/coop`, for their name, the open rooms list, and making or joining a room. It
  hibernates between messages, so players sitting in menus cost next to nothing.
- **Each room** (`src/room.mjs`) is its own Durable Object, at `/coop/room/<code>`. Cloudflare
  starts one near the first request for it, which is the host making it, so a run's frames and
  inputs go through a relay close to the host.
- To make or join a room, the lobby checks the relay's limits and answers with a `goto`: the room's
  code and a one-time ticket. The game opens the room's own connection with it and sends its
  `create` or `join` there. Everything said in a room (`me`, `start`, `up`, `down` and the rest) goes
  over that connection. The Node relay never sends `goto`, so the game works with either.

## Running it

```sh
cd server/cloudflare
npm install
npx wrangler dev --port 8787        # locally, at ws://127.0.0.1:8787/coop
npx wrangler login                  # once, to deploy
npx wrangler deploy                 # at wss://run-escape-coop.<your-subdomain>.workers.dev/coop
```

Point the game at it with `VITE_COOP_URL`:

```sh
VITE_COOP_URL=ws://127.0.0.1:8787/coop npm start
VITE_COOP_URL=wss://run-escape-coop.<your-subdomain>.workers.dev/coop npm run build
```

`MULTIPLAYER_ANY_MAP` in `wrangler.toml` (or `--var MULTIPLAYER_ANY_MAP:on` with `wrangler dev`)
lets players into rooms on maps they haven't unlocked, as on the Node relay.

## Differences from the Node relay

- Player names are unique among players connected to the lobby, and a name picked with New name in
  a room is unique in that room.
- Connections per address are counted at the lobby only. Cloudflare's own protection sits in front
  of everything.
- A room tells the lobby it's there every 30 seconds; one that stops (its object restarted) drops
  off the list after 90.
