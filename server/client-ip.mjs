// Who a connection's really from, for the relay's limits on each address.
// Behind a proxy every player looks like the proxy, so the proxy's word can be
// taken for who connected to it, but only when the server's said it has one
// (PROXY), and only from that proxy: a header anyone can send would let one
// player look like a thousand.
//
// - none (PROXY unset): the connection's own address. Hosting with nothing in
//   front, or on a LAN.
// - local: a proxy on the same machine or a private network (Caddy, nginx, a
//   container in front). Its X-Forwarded-For says who it saw, last in the
//   list (what it added itself; anything before that the player could have
//   made up). TRUSTED_PROXIES adds proxies elsewhere, as addresses or ranges
//   ("10.1.2.3,10.9.0.0/16"). Anyone else who can reach the server from one
//   of these addresses can say they're anyone, so only the proxy should be
//   able to: HOST=127.0.0.1, or in Docker a port published on 127.0.0.1, as
//   Docker's proxy passes on everyone from its private network.
// - cloudflare: Cloudflare in front (and maybe a local proxy behind it). Its
//   CF-Connecting-IP says who connected to it, believed only from
//   Cloudflare's own addresses.
import { BlockList, isIP } from "node:net";

// Where Cloudflare publishes its addresses. The relay fetches them when it
// starts behind Cloudflare and again each day, so there's no list here to go
// stale. CLOUDFLARE_IPS replaces them, and then nothing's fetched.
export const CLOUDFLARE_IPS_URL = "https://api.cloudflare.com/client/v4/ips";
const CLOUDFLARE_REFRESH_MS = 24 * 60 * 60_000;
// After a failed fetch, the next try
const CLOUDFLARE_RETRY_MS = 60_000;

// This machine and private networks: only a proxy of the server's own can
// connect from one
const LOCAL_RANGES = [
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "::1/128",
    "fc00::/7",
];

// A list of addresses and ranges, for checking an address against
export function addressList(ranges) {
    const list = new BlockList();
    for (const range of ranges) {
        const [address, bits] = range.trim().split("/");
        const type = isIP(address) === 6 ? "ipv6" : "ipv4";
        if (isIP(address) === 0) {
            continue;
        }
        if (bits === undefined) {
            list.addAddress(address, type);
        } else {
            list.addSubnet(address, parseInt(bits), type);
        }
    }
    return list;
}

function envList(name) {
    const value = process.env[name];
    return value ? value.split(",").filter((s) => s.trim()) : [];
}

const PROXIES = addressList([...LOCAL_RANGES, ...envList("TRUSTED_PROXIES")]);
// Cloudflare's addresses: CLOUDFLARE_IPS, or what was last fetched. Empty
// until the first fetch, so until then nobody's taken for Cloudflare.
let cloudflareList = addressList(envList("CLOUDFLARE_IPS"));

// Cloudflare's address ranges, from its API (CLOUDFLARE_IPS_URL)
export async function fetchCloudflareRanges(fetchImpl = fetch, url = CLOUDFLARE_IPS_URL) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    const body = await response.json();
    const ranges = [...(body?.result?.ipv4_cidrs ?? []), ...(body?.result?.ipv6_cidrs ?? [])];
    if (body?.success !== true || ranges.length === 0) {
        throw new Error(`${url} gave no addresses`);
    }
    return ranges.filter((range) => typeof range === "string");
}

// Keeps Cloudflare's addresses up to date: fetched now, then each day, and
// sooner after a failure (keeping the last ones that came). Nothing to do
// with CLOUDFLARE_IPS set. Returns a function that stops it.
export function watchCloudflareRanges({
    fetchImpl = fetch,
    env = process.env,
    refreshMs = CLOUDFLARE_REFRESH_MS,
    retryMs = CLOUDFLARE_RETRY_MS,
} = {}) {
    if (env.CLOUDFLARE_IPS) {
        return () => {};
    }
    let timer;
    let stopped = false;
    const load = async () => {
        let next = refreshMs;
        try {
            cloudflareList = addressList(await fetchCloudflareRanges(fetchImpl));
        } catch (e) {
            next = retryMs;
            console.warn(
                `Couldn't get Cloudflare's addresses (${e.message}), so players behind it ` +
                    `look like Cloudflare for now. Trying again in ${Math.round(retryMs / 1000)}s.`,
            );
        }
        if (!stopped) {
            timer = setTimeout(load, next);
            timer.unref?.();
        }
    };
    const loaded = load();
    const stop = () => {
        stopped = true;
        clearTimeout(timer);
    };
    stop.loaded = loaded;
    return stop;
}

// An address as written in a header or by Node, plain: IPv4 without the
// IPv6 wrapping or a port, IPv6 without brackets. Undefined if it isn't one.
export function plainAddress(text) {
    let address = typeof text === "string" ? text.trim() : "";
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
    if (bracketed) {
        address = bracketed[1];
    } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(address)) {
        address = address.slice(0, address.lastIndexOf(":"));
    }
    if (address.toLowerCase().startsWith("::ffff:") && isIP(address.slice(7)) === 4) {
        address = address.slice(7);
    }
    return isIP(address) === 0 ? undefined : address;
}

function inList(list, address) {
    return list.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

export const PROXY_MODES = ["none", "local", "cloudflare"];

// The proxy in front, as the server's set it: --proxy=cloudflare, or PROXY.
// Anything else is none, with a warning.
export function proxyMode(env = process.env, argv = process.argv) {
    const flag = argv.find((arg) => arg.startsWith("--proxy="))?.slice("--proxy=".length);
    const mode = (flag ?? env.PROXY ?? "none").trim().toLowerCase() || "none";
    if (!PROXY_MODES.includes(mode)) {
        console.warn(`Unknown proxy "${mode}" (${PROXY_MODES.join(", ")}): taking none.`);
        return "none";
    }
    return mode;
}

// Whether a request has come through a proxy on this machine or network:
// with no proxy set, every player behind it would look like one
export function viaProxy(req, socket, proxies = PROXIES) {
    const address = plainAddress(socket?.remoteAddress);
    return (
        address !== undefined &&
        inList(proxies, address) &&
        (req.headers?.["x-forwarded-for"] !== undefined ||
            req.headers?.["cf-connecting-ip"] !== undefined)
    );
}

// The address a request came from (see above)
export function clientAddress(
    req,
    socket,
    mode = "none",
    proxies = PROXIES,
    cloudflare = cloudflareList,
) {
    let address = plainAddress(socket?.remoteAddress) ?? "unknown";
    if (mode === "none") {
        return address;
    }
    const header = req.headers?.["x-forwarded-for"];
    const forwarded = (Array.isArray(header) ? header.join(",") : (header ?? ""))
        .split(",")
        .filter((s) => s.trim());
    // Back through the proxies that are ours, each one's last entry being who
    // connected to it
    while (address !== "unknown" && inList(proxies, address) && forwarded.length > 0) {
        const previous = plainAddress(forwarded.pop());
        if (!previous) {
            break;
        }
        address = previous;
    }
    const connecting = plainAddress(req.headers?.["cf-connecting-ip"]);
    if (
        mode === "cloudflare" &&
        connecting &&
        address !== "unknown" &&
        inList(cloudflare, address)
    ) {
        address = connecting;
    }
    return address;
}
