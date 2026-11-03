import {
    CLOUDFLARE_IPS_URL,
    addressList,
    clientAddress,
    clientCountry,
    countryCode,
    fetchCloudflareRanges,
    plainAddress,
    proxyMode,
    viaProxy,
    watchCloudflareRanges,
} from "./client-ip.mjs";

const PROXIES = addressList(["127.0.0.0/8", "10.0.0.0/8", "::1/128"]);
const CLOUDFLARE = addressList(["173.245.48.0/20", "2606:4700::/32"]);

function from(
    remoteAddress: string,
    headers: Record<string, string> = {},
    mode = "cloudflare",
): string {
    return clientAddress({ headers }, { remoteAddress }, mode, PROXIES, CLOUDFLARE);
}

describe("proxy setting", () => {
    it("is none unless it's set", () => {
        expect(proxyMode({}, [])).toBe("none");
        expect(proxyMode({ PROXY: "Local" }, [])).toBe("local");
        expect(proxyMode({ PROXY: "local" }, ["--proxy=cloudflare"])).toBe("cloudflare");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(proxyMode({ PROXY: "nginx" }, [])).toBe("none");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("trusts no header with no proxy set", () => {
        const headers = { "x-forwarded-for": "198.51.100.7", "cf-connecting-ip": "1.2.3.4" };
        expect(from("127.0.0.1", headers, "none")).toBe("127.0.0.1");
        expect(from("173.245.48.10", headers, "none")).toBe("173.245.48.10");
    });

    it("trusts only the local proxy's word with local", () => {
        expect(from("127.0.0.1", { "x-forwarded-for": "198.51.100.7" }, "local")).toBe(
            "198.51.100.7",
        );
        // Cloudflare's header counts for nothing without cloudflare
        expect(from("173.245.48.10", { "cf-connecting-ip": "1.2.3.4" }, "local")).toBe(
            "173.245.48.10",
        );
    });

    it("notices players coming through a proxy, for a warning when none is set", () => {
        expect(
            viaProxy(
                { headers: { "x-forwarded-for": "1.2.3.4" } },
                { remoteAddress: "127.0.0.1" },
                PROXIES,
            ),
        ).toBe(true);
        expect(viaProxy({ headers: {} }, { remoteAddress: "127.0.0.1" }, PROXIES)).toBe(false);
        expect(
            viaProxy(
                { headers: { "x-forwarded-for": "1.2.3.4" } },
                { remoteAddress: "203.0.113.9" },
                PROXIES,
            ),
        ).toBe(false);
    });
});

describe("client addresses, with Cloudflare set", () => {
    it("are the connection's own with no proxy in front", () => {
        expect(from("203.0.113.9")).toBe("203.0.113.9");
        expect(from("::ffff:203.0.113.9")).toBe("203.0.113.9");
    });

    it("don't believe headers from anyone but a proxy of ours", () => {
        expect(from("203.0.113.9", { "x-forwarded-for": "1.2.3.4" })).toBe("203.0.113.9");
        expect(from("203.0.113.9", { "cf-connecting-ip": "1.2.3.4" })).toBe("203.0.113.9");
    });

    it("take a local proxy's word for who it saw, and only that", () => {
        // A player can send X-Forwarded-For themselves; the proxy adds who it
        // really saw at the end
        expect(from("127.0.0.1", { "x-forwarded-for": "6.6.6.6, 198.51.100.7" })).toBe(
            "198.51.100.7",
        );
        expect(from("::1", { "x-forwarded-for": "198.51.100.7" })).toBe("198.51.100.7");
        // Two proxies of ours in a row
        expect(from("127.0.0.1", { "x-forwarded-for": "198.51.100.7, 10.0.0.5" })).toBe(
            "198.51.100.7",
        );
    });

    it("believe Cloudflare's header only from Cloudflare", () => {
        // Straight from Cloudflare
        expect(from("173.245.48.10", { "cf-connecting-ip": "198.51.100.7" })).toBe("198.51.100.7");
        // Cloudflare, then a proxy of ours
        expect(
            from("127.0.0.1", {
                "x-forwarded-for": "198.51.100.7, 173.245.48.10",
                "cf-connecting-ip": "198.51.100.7",
            }),
        ).toBe("198.51.100.7");
        // Round Cloudflare, straight to the proxy, with a made-up header
        expect(
            from("127.0.0.1", {
                "x-forwarded-for": "203.0.113.9",
                "cf-connecting-ip": "1.2.3.4",
            }),
        ).toBe("203.0.113.9");
        expect(from("2606:4700::1", { "cf-connecting-ip": "2001:db8::7" })).toBe("2001:db8::7");
    });

    it("read addresses however they're written", () => {
        expect(plainAddress("198.51.100.7:5123")).toBe("198.51.100.7");
        expect(plainAddress("[2001:db8::7]:443")).toBe("2001:db8::7");
        expect(plainAddress("not an address")).toBeUndefined();
        expect(from("127.0.0.1", { "x-forwarded-for": "garbage" })).toBe("127.0.0.1");
    });
});

describe("client countries", () => {
    const countryFrom = (
        remoteAddress: string,
        headers: Record<string, string>,
        mode = "cloudflare",
    ) => clientCountry({ headers }, { remoteAddress }, mode, PROXIES, CLOUDFLARE);

    it("are Cloudflare's word, from Cloudflare", () => {
        expect(countryFrom("173.245.48.10", { "cf-ipcountry": "FI" })).toBe("FI");
        // Through a proxy of ours, from Cloudflare
        expect(
            countryFrom("127.0.0.1", {
                "x-forwarded-for": "173.245.48.10",
                "cf-ipcountry": "se",
            }),
        ).toBe("SE");
    });

    it("aren't believed from anyone else, or without Cloudflare set", () => {
        expect(countryFrom("198.51.100.7", { "cf-ipcountry": "FI" })).toBeUndefined();
        expect(countryFrom("127.0.0.1", { "cf-ipcountry": "FI" })).toBeUndefined();
        expect(countryFrom("173.245.48.10", { "cf-ipcountry": "FI" }, "local")).toBeUndefined();
        expect(countryFrom("173.245.48.10", { "cf-ipcountry": "FI" }, "none")).toBeUndefined();
        expect(countryFrom("173.245.48.10", {})).toBeUndefined();
    });

    it("are two letters, and not Cloudflare's unknown or Tor", () => {
        expect(countryCode(" gb ")).toBe("GB");
        expect(countryCode("XX")).toBeUndefined();
        expect(countryCode("T1")).toBeUndefined();
        expect(countryCode("FIN")).toBeUndefined();
        expect(countryCode(undefined)).toBeUndefined();
    });
});

describe("Cloudflare's addresses", () => {
    // Cloudflare's API, as it answers
    const answer = (body: unknown, ok = true) =>
        (async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as any;
    const ranges = {
        success: true,
        result: { ipv4_cidrs: ["173.245.48.0/20"], ipv6_cidrs: ["2606:4700::/32"] },
    };
    // Through Cloudflare, with the list the relay has (not one of the test's)
    const viaCloudflare = (remoteAddress: string) =>
        clientAddress(
            { headers: { "cf-connecting-ip": "198.51.100.7" } },
            { remoteAddress },
            "cloudflare",
        );

    it("come from Cloudflare's API", async () => {
        let asked = "";
        const fetchImpl = (async (url: string) => {
            asked = url;
            return answer(ranges)();
        }) as any;
        expect(await fetchCloudflareRanges(fetchImpl)).toEqual([
            "173.245.48.0/20",
            "2606:4700::/32",
        ]);
        expect(asked).toBe("https://api.cloudflare.com/client/v4/ips");
        expect(CLOUDFLARE_IPS_URL).toBe(asked);
    });

    it("aren't taken from an answer that isn't right", async () => {
        await expect(fetchCloudflareRanges(answer(ranges, false))).rejects.toThrow(/503/);
        await expect(fetchCloudflareRanges(answer({ success: false }))).rejects.toThrow();
        await expect(
            fetchCloudflareRanges(answer({ success: true, result: { ipv4_cidrs: [] } })),
        ).rejects.toThrow(/no addresses/);
    });

    it("are believed once they've come, and kept after a failed fetch", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const failing = watchCloudflareRanges({ fetchImpl: answer({}, false), env: {} });
        await (failing as any).loaded;
        failing();
        expect(viaCloudflare("173.245.48.10")).toBe("173.245.48.10");
        expect(warn).toHaveBeenCalled();

        const stop = watchCloudflareRanges({ fetchImpl: answer(ranges), env: {} });
        await (stop as any).loaded;
        stop();
        expect(viaCloudflare("173.245.48.10")).toBe("198.51.100.7");
        // Not from anywhere else
        expect(viaCloudflare("203.0.113.9")).toBe("203.0.113.9");

        const again = watchCloudflareRanges({ fetchImpl: answer({}, false), env: {} });
        await (again as any).loaded;
        again();
        expect(viaCloudflare("173.245.48.10")).toBe("198.51.100.7");
        warn.mockRestore();
    });

    it("aren't fetched when CLOUDFLARE_IPS gives them", () => {
        let fetched = false;
        const stop = watchCloudflareRanges({
            fetchImpl: (async () => {
                fetched = true;
            }) as any,
            env: { CLOUDFLARE_IPS: "173.245.48.0/20" },
        });
        stop();
        expect(fetched).toBe(false);
    });
});
