import { describe, expect, it } from "vitest";

import { createFractal, createRidged } from "./noise";
import { Terrain, getTileSlope, limitNorthFaces, limitSlope, spreadNearest } from "./terrain";

function ramp(cornersX: number, cornersY: number, rise: number): Terrain {
    const terrain = new Terrain(cornersX, cornersY);
    for (let y = 0; y < cornersY; y++) {
        for (let x = 0; x < cornersX; x++) {
            terrain.height[terrain.corner(x, y)] = x * rise;
        }
    }
    return terrain;
}

function steepest(terrain: Terrain): number {
    let most = 0;
    for (let y = 0; y + 1 < terrain.cornersY; y++) {
        for (let x = 0; x + 1 < terrain.cornersX; x++) {
            most = Math.max(most, terrain.getSlope(x, y));
        }
    }
    return most;
}

describe("getTileSlope", () => {
    it("goes by the steepest edge", () => {
        expect(getTileSlope([0, 8, 0, 8], 2, 0, 0)).toBe(8);
        expect(getTileSlope([0, 0, 8, 8], 2, 0, 0)).toBe(8);
    });

    it("counts a slope running across the tile at its full steepness", () => {
        // 16 over a diagonal of √2 tiles
        expect(getTileSlope([0, 8, 8, 16], 2, 0, 0)).toBeCloseTo(16 / Math.SQRT2);
    });

    it("is 0 on the flat", () => {
        expect(getTileSlope([40, 40, 40, 40], 2, 0, 0)).toBe(0);
    });
});

describe("limitSlope", () => {
    it("takes the top off anything too steep", () => {
        const terrain = ramp(20, 20, 10);
        limitSlope(terrain.height, 20, 20, 4);
        expect(steepest(terrain)).toBeLessThanOrEqual(4.001);
        // And leaves what was the lowest ground
        expect(terrain.height[0]).toBe(0);
    });

    it("leaves a cliff alone when told to keep off it", () => {
        const terrain = new Terrain(20, 4);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 20; x++) {
                terrain.height[terrain.corner(x, y)] = x < 10 ? 0 : 100;
            }
        }
        const keep = new Uint8Array(terrain.height.length).fill(1);
        for (let y = 0; y < 4; y++) {
            keep[terrain.corner(9, y)] = 0;
            keep[terrain.corner(10, y)] = 0;
        }
        limitSlope(terrain.height, 20, 4, 4, keep);
        expect(terrain.height[terrain.corner(15, 2)]).toBe(100);
    });
});

describe("Terrain.settle", () => {
    const flat = () => {
        const terrain = new Terrain(21, 21);
        terrain.height.fill(100);
        return terrain;
    };
    const none = (terrain: Terrain) => new Uint8Array(terrain.height.length);

    it("puts pinned corners exactly where they're pinned", () => {
        const terrain = flat();
        terrain.pin(10, 10, 40);
        terrain.settle(5, none(terrain));
        expect(terrain.getHeight(10, 10)).toBe(40);
    });

    it("cuts down to a pin no steeper than it's told", () => {
        const terrain = flat();
        terrain.pinRect(9, 9, 2, 2, 40);
        terrain.settle(5, none(terrain));
        expect(steepest(terrain)).toBeLessThanOrEqual(5.2);
        expect(terrain.getHeight(0, 0)).toBeGreaterThan(40);
    });

    it("builds up to a pin too", () => {
        const terrain = flat();
        terrain.pin(10, 10, 160);
        terrain.settle(5, none(terrain));
        expect(terrain.getHeight(11, 10)).toBeCloseTo(155);
        expect(terrain.getHeight(0, 0)).toBe(100);
    });

    it("leaves ground that's near enough alone", () => {
        const terrain = flat();
        terrain.pin(10, 10, 95);
        terrain.settle(5, none(terrain));
        expect(terrain.getHeight(13, 10)).toBe(100);
    });

    it("doesn't move what's held", () => {
        const terrain = flat();
        const held = none(terrain);
        held[terrain.corner(11, 10)] = 1;
        terrain.pin(10, 10, 40);
        terrain.settle(5, held);
        expect(terrain.getHeight(11, 10)).toBe(100);
    });

    it("lets go of its pins and keeps the ground as it is", () => {
        const terrain = flat();
        terrain.pin(10, 10, 40);
        terrain.settle(5, none(terrain));
        terrain.clearPins();
        expect(terrain.isPinned(10, 10)).toBe(false);
        expect(terrain.getHeight(10, 10)).toBe(40);
    });

    it("lets the nearest thing pinning a corner have it", () => {
        const terrain = flat();
        terrain.pin(5, 5, 50, 2);
        terrain.pin(5, 5, 60, 1);
        terrain.pin(5, 5, 70, 3);
        expect(terrain.getPinned(5, 5)).toBe(60);
    });
});

describe("Terrain.lock", () => {
    it("keeps a pin off a locked corner, however near", () => {
        const terrain = new Terrain(21, 21);
        terrain.height.fill(40);
        terrain.lock(terrain.corner(10, 10));
        terrain.pin(10, 10, 90);
        terrain.settle(4, new Uint8Array(terrain.height.length).fill(0));
        expect(terrain.isPinned(10, 10)).toBe(false);
    });

    it("leaves a pin that was there first", () => {
        const terrain = new Terrain(21, 21);
        terrain.pin(10, 10, 90);
        terrain.lock(terrain.corner(10, 10));
        terrain.pin(10, 10, 20, 0);
        expect(terrain.getPinned(10, 10)).toBe(90);
    });
});

describe("limitNorthFaces", () => {
    it("cuts back the top of a drop to the north, and leaves one to the south", () => {
        // A step up going south: from the camera, that's a wall hiding the ground behind it
        const cornersX = 2;
        const cornersY = 12;
        const field = new Float32Array(cornersX * cornersY);
        for (let y = 0; y < cornersY; y++) {
            field.fill(y < 6 ? 100 : 0, y * cornersX, (y + 1) * cornersX);
        }
        limitNorthFaces(field, cornersX, cornersY, 30, new Uint8Array(field.length));
        expect(field[5 * cornersX]).toBe(30);
        expect(field[4 * cornersX]).toBe(60);
        expect(field[2 * cornersX]).toBe(100);

        const rising = new Float32Array(cornersX * cornersY);
        for (let y = 0; y < cornersY; y++) {
            rising.fill(y < 6 ? 0 : 100, y * cornersX, (y + 1) * cornersX);
        }
        const before = Float32Array.from(rising);
        limitNorthFaces(rising, cornersX, cornersY, 30, new Uint8Array(rising.length));
        expect(rising).toEqual(before);
    });
});

describe("spreadNearest", () => {
    it("fills unset corners from the nearest set one", () => {
        const field = new Float32Array(9).fill(Infinity);
        field[0] = 10;
        field[8] = 20;
        spreadNearest(field, 3, 3);
        expect(field[1]).toBe(10);
        expect(field[5]).toBe(20);
    });

    it("leaves a field with nothing set as it was", () => {
        const field = new Float32Array(9).fill(Infinity);
        spreadNearest(field, 3, 3);
        expect(field[4]).toBe(Infinity);
    });
});

describe("mountain noise", () => {
    it("comes out the same from the same seed", () => {
        expect(createRidged(5, 3, 0.5)(1.3, 2.7)).toBe(createRidged(5, 3, 0.5)(1.3, 2.7));
        expect(createFractal(5, 3, 0.5)(1.3, 2.7)).toBe(createFractal(5, 3, 0.5)(1.3, 2.7));
    });

    it("stays between 0 and 1 when ridged", () => {
        const ridged = createRidged(9, 4, 0.5);
        for (let i = 0; i < 2000; i++) {
            const value = ridged(i * 0.137, i * 0.211);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        }
    });
});
