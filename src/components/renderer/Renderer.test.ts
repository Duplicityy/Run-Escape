// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import { Renderer } from "./Renderer";

// jsdom has no WebGL, and says so loudly when DeviceUtil asks
vi.hoisted(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
});

class CountingRenderer extends Renderer {
    frames = 0;
    async init(): Promise<void> {}
    cleanUp(): void {}
    render(): void {
        this.frames++;
    }
}

// Frames drawn in a second of a screen refreshing `hz` times a second
function framesInASecond(hz: number, fpsLimit: number, jitterMs = 0): number {
    const renderer = new CountingRenderer();
    renderer.fpsLimit = fpsLimit;
    for (let i = 0; i < hz; i++) {
        const wobble = jitterMs * Math.sin(i * 1.7);
        renderer.frameCallback((i * 1000) / hz + wobble);
    }
    return renderer.frames;
}

describe("Renderer's frame cap", () => {
    test("a 90 Hz screen capped at 60 draws 60, not 45", () => {
        expect(framesInASecond(90, 60)).toBe(60);
    });

    test("keeps to the cap on faster screens", () => {
        expect(framesInASecond(120, 60)).toBe(60);
        expect(framesInASecond(144, 60)).toBeGreaterThanOrEqual(59);
        expect(framesInASecond(144, 60)).toBeLessThanOrEqual(61);
        expect(framesInASecond(120, 30)).toBe(30);
        expect(framesInASecond(90, 30)).toBe(30);
    });

    test("draws every frame of a screen at or under the cap, timestamps wobbling", () => {
        expect(framesInASecond(60, 60, 1.5)).toBe(60);
        expect(framesInASecond(30, 60, 1.5)).toBe(30);
    });

    test("no cap draws every frame", () => {
        expect(framesInASecond(144, 0)).toBe(144);
        expect(framesInASecond(144, 999)).toBe(144);
    });
});
