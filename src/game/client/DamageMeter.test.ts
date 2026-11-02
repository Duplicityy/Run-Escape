import { DPS_WINDOW_SECONDS, TICKS_PER_SECOND } from "../core/Sim";
import { DamageMeter } from "./DamageMeter";

const SECOND = TICKS_PER_SECOND;

describe("the damage panel's meter", () => {
    it("gives each source's damage a second over the HUD's window", () => {
        const meter = new DamageMeter();
        // A whip at 100 a second, a bow at 25, a ring of recoil now and then
        for (let s = 0; s <= 20; s++) {
            meter.sample(s * SECOND, {
                "weapon:whip": 100 * s,
                "weapon:bow": 25 * s,
                recoil: s >= 18 ? 40 : 0,
            });
        }
        const { perSecond, totals } = meter.read();
        expect(perSecond["weapon:whip"]).toBeCloseTo(100);
        expect(perSecond["weapon:bow"]).toBeCloseTo(25);
        expect(perSecond.recoil).toBeCloseTo(40 / DPS_WINDOW_SECONDS);
        expect(totals["weapon:whip"]).toBe(2000);
    });

    it("forgets what's older than the window", () => {
        const meter = new DamageMeter();
        // A burst early on, then nothing
        meter.sample(0, { "weapon:whip": 0 });
        meter.sample(SECOND, { "weapon:whip": 5000 });
        for (let s = 2; s <= 2 + DPS_WINDOW_SECONDS; s++) {
            meter.sample(s * SECOND, { "weapon:whip": 5000 });
        }
        expect(meter.read().perSecond["weapon:whip"]).toBeUndefined();
        expect(meter.read().totals["weapon:whip"]).toBe(5000);
    });

    it("reads once a second, so the numbers hold still in between", () => {
        const meter = new DamageMeter();
        meter.sample(0, { "weapon:whip": 0 });
        meter.sample(SECOND, { "weapon:whip": 100 });
        const before = meter.read();
        meter.sample(SECOND + 10, { "weapon:whip": 999 });
        expect(meter.read()).toEqual(before);
    });

    it("averages over what the run's had, early on", () => {
        const meter = new DamageMeter();
        meter.sample(0, {});
        meter.sample(2 * SECOND, { "weapon:whip": 100 });
        expect(meter.read().perSecond["weapon:whip"]).toBeCloseTo(50);
    });

    it("counts only what isn't a weapon as other, a weapon that's gone included", () => {
        const meter = new DamageMeter();
        meter.sample(0, {});
        meter.sample(2 * SECOND, {
            "weapon:whip": 100,
            "weapon:scimitar": 300,
            recoil: 20,
            "powerUp:thrall": 40,
        });
        expect(meter.read().otherPerSecond).toBeCloseTo(30);
    });

    it("works a sample out once, and gives that until the next", () => {
        const meter = new DamageMeter();
        meter.sample(0, {});
        meter.sample(SECOND, { "weapon:whip": 100 });
        const reading = meter.read();
        meter.sample(SECOND + 10, { "weapon:whip": 999 });
        expect(meter.read()).toBe(reading);
        meter.sample(2 * SECOND, { "weapon:whip": 300 });
        expect(meter.read()).not.toBe(reading);
    });

    it("starts again for a new run", () => {
        const meter = new DamageMeter();
        meter.sample(0, {});
        meter.sample(30 * SECOND, { "weapon:whip": 9000 });
        meter.sample(0, {});
        expect(meter.read()).toEqual({ perSecond: {}, totals: {}, otherPerSecond: 0 });
        meter.reset();
        expect(meter.read()).toEqual({ perSecond: {}, totals: {}, otherPerSecond: 0 });
    });
});
