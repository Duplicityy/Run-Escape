// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import { GamePads, PAD, identifyPad, nearestInDirection, padLabel, padToMove } from "./GamePad";

const move = () => ({ x: 0, y: 0 });

describe("identifyPad", () => {
    test("knows the makes by Chrome's and Firefox's names", () => {
        expect(
            identifyPad({
                id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
                mapping: "standard",
            }),
        ).toEqual({ kind: "playstation", standard: true, name: "DualSense Wireless Controller" });
        expect(identifyPad({ id: "054c-09cc-Wireless Controller", mapping: "standard" })).toEqual({
            kind: "playstation",
            standard: true,
            name: "Wireless Controller",
        });
        expect(
            identifyPad({
                id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
                mapping: "standard",
            }).kind,
        ).toBe("xbox");
        expect(
            identifyPad({
                id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
                mapping: "standard",
            }).kind,
        ).toBe("xbox");
        expect(
            identifyPad({
                id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
                mapping: "standard",
            }).kind,
        ).toBe("nintendo");
    });

    test("anything else is generic, and its buttons trusted only on the standard layout", () => {
        expect(
            identifyPad({ id: "USB Joystick (Vendor: 0079 Product: 0006)", mapping: "" }),
        ).toEqual({
            kind: "generic",
            standard: false,
            name: "USB Joystick",
        });
        expect(identifyPad({ id: "", mapping: "standard" }).name).toBe("Controller");
    });

    test("labels the same place by who made it", () => {
        expect(padLabel("xbox", "south")).toBe("A");
        expect(padLabel("playstation", "south")).toBe("✕");
        expect(padLabel("nintendo", "south")).toBe("B");
        expect(padLabel("generic", "west")).toBe("X");
    });
});

describe("padToMove", () => {
    test("is north for a stick pushed up, and full speed any way", () => {
        expect(padToMove(0, -0.8, move())).toEqual({ x: 0, y: 1 });
        const { x, y } = padToMove(0.4, 0.3, move());
        expect(Math.hypot(x, y)).toBeCloseTo(1, 10);
        expect(y / x).toBeCloseTo(-0.3 / 0.4, 10);
    });

    test("a resting stick's drift doesn't walk", () => {
        expect(padToMove(0.15, -0.12, move())).toEqual({ x: 0, y: 0 });
    });
});

describe("nearestInDirection", () => {
    const box = (left: number, top: number) => ({ left, top, width: 100, height: 40 });
    // Three cards in a row, and a button under the middle one
    const rects = [box(0, 0), box(120, 0), box(240, 0), box(120, 80)];

    test("goes along a row and down to the button under it", () => {
        expect(nearestInDirection(rects[0], "right", rects)).toBe(1);
        expect(nearestInDirection(rects[1], "right", rects)).toBe(2);
        expect(nearestInDirection(rects[1], "down", rects)).toBe(3);
        expect(nearestInDirection(rects[3], "up", rects)).toBe(1);
    });

    test("stops at the edge", () => {
        expect(nearestInDirection(rects[0], "left", rects)).toBe(-1);
        expect(nearestInDirection(rects[2], "up", rects)).toBe(-1);
    });
});

// A pad for navigator.getGamepads, with these buttons down and the stick there
function fakePad(down: number[] = [], axes = [0, 0], mapping = "standard"): Gamepad {
    return {
        id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
        index: 0,
        connected: true,
        mapping,
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: down.includes(i),
            touched: down.includes(i),
            value: down.includes(i) ? 1 : 0,
        })),
    } as unknown as Gamepad;
}

describe("GamePads", () => {
    let pad = fakePad();
    const pads = () => {
        Object.defineProperty(navigator, "getGamepads", { value: () => [pad], configurable: true });
        const p = new GamePads();
        const keys: string[] = [];
        p.onKeyDown = (code) => keys.push("+" + code);
        p.onKeyUp = (code) => keys.push("-" + code);
        return { p, keys };
    };
    afterEach(() => {
        pad = fakePad();
        document.body.innerHTML = "";
    });

    test("takes a pad up when it's pressed, that press and all", () => {
        const { p, keys } = pads();
        const connected = vi.fn();
        p.onConnect = connected;
        p.poll(0, "run");
        expect(connected).not.toHaveBeenCalled();
        pad = fakePad([PAD.leftBumper]);
        p.poll(16, "run");
        expect(connected).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "xbox", standard: true }),
        );
        expect(keys).toEqual(["+Digit1"]);
        p.poll(32, "run");
        pad = fakePad();
        p.poll(48, "run");
        expect(keys).toEqual(["+Digit1", "-Digit1"]);
    });

    test("moves with the stick or the d-pad in a run, and not in a menu", () => {
        const { p } = pads();
        pad = fakePad([], [0, -1]);
        p.poll(0, "run");
        expect(p.getMove(move())).toEqual({ x: 0, y: 1 });
        pad = fakePad([PAD.left]);
        p.poll(16, "run");
        expect(p.getMove(move())).toEqual({ x: -1, y: 0 });
        p.poll(32, "menu");
        expect(p.getMove(move())).toEqual({ x: 0, y: 0 });
    });

    test("in a menu, the face buttons are the keys and south presses the highlighted button", () => {
        const { p, keys } = pads();
        document.body.innerHTML = `<div class="ui-modal"><button id="a">A</button><button id="b" class="ui-button-go">B</button></div>`;
        // jsdom lays nothing out, so give the buttons a size
        for (const el of document.querySelectorAll("button")) {
            el.getBoundingClientRect = () =>
                ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
        }
        const clicked = vi.fn();
        document.getElementById("b")!.addEventListener("click", clicked);
        pad = fakePad([PAD.east]);
        p.poll(0, "menu");
        pad = fakePad();
        p.poll(16, "menu");
        pad = fakePad([PAD.east]);
        p.poll(32, "menu");
        expect(keys).toEqual(["+Escape", "-Escape", "+Escape"]);
        // Nothing highlighted: Enter, and the highlight goes to the main button
        pad = fakePad([PAD.south]);
        p.poll(48, "menu");
        expect(keys).toEqual(["+Escape", "-Escape", "+Escape", "+Enter", "-Enter", "-Escape"]);
        expect(document.activeElement?.id).toBe("b");
        expect(clicked).not.toHaveBeenCalled();
        pad = fakePad();
        p.poll(64, "menu");
        pad = fakePad([PAD.south]);
        p.poll(80, "menu");
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    test("in a menu, start presses the main button wherever the highlight is, else it's P", () => {
        const { p, keys } = pads();
        document.body.innerHTML = `<button id="a">A</button><button id="go" class="ui-button-go">Go</button>`;
        for (const el of document.querySelectorAll("button")) {
            el.getBoundingClientRect = () =>
                ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
        }
        document.getElementById("a")!.focus();
        const go = vi.fn();
        document.getElementById("go")!.addEventListener("click", go);
        pad = fakePad([PAD.east]);
        p.poll(0, "menu");
        pad = fakePad([PAD.start]);
        p.poll(16, "menu");
        expect(go).toHaveBeenCalledTimes(1);
        expect(keys).not.toContain("+KeyP");
        document.getElementById("go")!.remove();
        pad = fakePad();
        p.poll(32, "menu");
        pad = fakePad([PAD.start]);
        p.poll(48, "menu");
        expect(keys).toContain("+KeyP");
    });

    test("a pad off the standard layout only moves", () => {
        const { p, keys } = pads();
        pad = fakePad([PAD.leftBumper], [1, 0], "");
        p.poll(0, "run");
        pad = fakePad([], [1, 0], "");
        p.poll(16, "run");
        pad = fakePad([PAD.leftBumper], [1, 0], "");
        p.poll(32, "run");
        expect(keys).toEqual([]);
        expect(p.getMove(move())).toEqual({ x: 1, y: 0 });
    });
});
