// Co-op's relay on Cloudflare: the same protocol as server/coop-relay.mjs, but
// each room is its own Durable Object, started near its host, so a run's
// traffic goes through a relay close to the players rather than one server
// wherever it happens to be. See server/cloudflare/README.md.
//
//   /coop            the lobby (lobby.mjs); a plain GET says co-op's here
//   /coop/room/CODE  a room (room.mjs), with the ticket the lobby gave
import { CODE_LENGTH, addressKey, countryCode, lobbyStub } from "./shared.mjs";

export { Lobby } from "./lobby.mjs";
export { Room } from "./room.mjs";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
};

const ROOM_PATH = new RegExp(`^/coop/room/([A-Z0-9]{${CODE_LENGTH}})$`);

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const upgrade = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
        // Who's connecting, for the limits on each address, and their
        // country, for their flag. Only the Worker sets these: whatever a
        // player sent in their place is replaced.
        const headers = new Headers(request.headers);
        headers.set("x-address", addressKey(request.headers.get("CF-Connecting-IP") ?? "unknown"));
        headers.set("x-country", countryCode(request.cf?.country) ?? "");

        if (url.pathname === "/coop") {
            if (upgrade) {
                return lobbyStub(env).fetch(url.toString(), { headers });
            }
            if (request.method === "GET" || request.method === "HEAD") {
                const status = await lobbyStub(env).status();
                return new Response(JSON.stringify(status), {
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-store",
                        ...CORS,
                    },
                });
            }
        }

        const room = ROOM_PATH.exec(url.pathname);
        if (room && upgrade) {
            // The first request for a room makes it, near whoever sent it:
            // the host, as they're the first there
            const stub = env.ROOMS.get(env.ROOMS.idFromName(room[1]));
            return stub.fetch(url.toString(), { headers });
        }

        return new Response("Run Escape co-op relay\n", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
        });
    },
};
