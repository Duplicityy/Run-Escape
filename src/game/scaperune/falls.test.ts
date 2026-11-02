import { describe, expect, it } from "vitest";

import { CLIFF_FALL, LOW_FALL } from "./biomes";
import { FALL_ROWS, FALL_WIDTH, getFallSeat, getSeatHeight, seatFall } from "./falls";
import { Terrain } from "./terrain";

describe("getFallSeat", () => {
    it("picks the model that fits the cliff", () => {
        expect(getFallSeat(40, 73)?.id).toBe(LOW_FALL);
        expect(getFallSeat(40, 105)?.id).toBe(CLIFF_FALL);
    });

    it("refuses a cliff too low for any fall", () => {
        expect(getFallSeat(40, 60)).toBeUndefined();
    });

    it("puts the top of the model at the lip", () => {
        const seat = getFallSeat(40, 90)!;
        expect(seat.base + 33).toBe(90);
    });

    it("cuts a cleft in a cliff taller than a fall can be", () => {
        const seat = getFallSeat(40, 240)!;
        expect(seat.id).toBe(CLIFF_FALL);
        expect(seat.lip).toBe(40 + 90);
    });
});

describe("seatFall", () => {
    const seated = () => {
        const terrain = new Terrain(40, 40);
        for (let y = 0; y < 40; y++) {
            for (let x = 0; x < 40; x++) {
                // A face that wanders, which is what shows a fall's back
                terrain.height[terrain.corner(x, y)] = y * 12 + (x % 3) * 9;
            }
        }
        const seat = getFallSeat(60, 125)!;
        seatFall(terrain, 18, 10, seat);
        terrain.settle(10, new Uint8Array(terrain.height.length));
        return { terrain, seat };
    };

    it("stands on rows level right across, past both edges", () => {
        const { terrain, seat } = seated();
        for (let row = 0; row <= FALL_ROWS + 2; row++) {
            for (let x = 16; x <= 18 + FALL_WIDTH + 2; x++) {
                expect(terrain.getPinned(x, 10 + row)).toBe(getSeatHeight(seat, row));
            }
        }
    });

    it("goes from its pool to its lip", () => {
        const { terrain, seat } = seated();
        expect(terrain.getPinned(19, 10)).toBe(seat.level);
        expect(terrain.getPinned(19, 10 + FALL_ROWS)).toBe(seat.lip);
    });
});
