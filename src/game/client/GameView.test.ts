// @vitest-environment jsdom
import { emptyStats } from "../content/types";
import { Sim } from "../core/Sim";
import { makeGrid } from "../core/world/testGrid";
import type { GameAssets } from "./GameAssets";
import { GameView } from "./GameView";
import type { Overlay } from "./Overlay";

vi.hoisted(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
});

test("slashes and auras follow the displayed body without moving confirmed effects", () => {
    const sim = new Sim({
        grid: makeGrid(Array(8).fill("........")),
        characterId: "warrior",
        metaStats: emptyStats(),
        seed: 3,
        spawnX: 103.5,
        spawnY: 203.5,
    });
    const view = new GameView({} as GameAssets);
    const confirmed = { x: sim.player.x, y: sim.player.y };
    const pose = {
        hero: 0,
        x: confirmed.x + 1,
        y: confirmed.y + 0.5,
        yaw: 0,
        moving: true,
        moveTicks: 0,
    };
    view.localPlayerPose = pose;
    view.onEvents(sim, [
        {
            type: "slash",
            ...confirmed,
            dirX: 1,
            dirY: 0,
            reach: 2,
            width: 1,
            arc: 0,
            weaponId: "scimitar",
        },
        { type: "aura", ...confirmed, radius: 2 },
    ]);
    const points: { x: number; y: number }[] = [];
    const overlay = {
        ctx: { beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {} },
        project(x: number, _height: number, y: number) {
            points.push({ x, y });
            return { x, y, visible: true };
        },
    } as unknown as Overlay;
    const draw = view as unknown as {
        drawSlashes(overlay: Overlay, sim: Sim, alpha: number, now: number, scale: number): void;
        drawAuras(overlay: Overlay, sim: Sim, alpha: number, now: number): void;
    };
    draw.drawSlashes(overlay, sim, 1, performance.now(), 1);
    expect(points[0].x).toBeCloseTo(pose.x + 1.6);
    expect(points[0].y).toBe(pose.y);
    points.length = 0;
    draw.drawAuras(overlay, sim, 1, performance.now());
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(pose.x);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(pose.y);
    expect(sim.player.x).toBe(confirmed.x);
    expect(sim.player.y).toBe(confirmed.y);
});
