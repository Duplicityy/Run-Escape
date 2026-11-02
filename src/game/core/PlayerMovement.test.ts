import { MovementRules, movePlayer } from "./PlayerMovement";
import { PLAYER_SPEED } from "./Sim";
import { makeGrid } from "./world/testGrid";

const grid = makeGrid(Array(8).fill("........"));
const rules: MovementRules = {
    radius: 0.35,
    baseSpeed: PLAYER_SPEED,
    moveSpeed: 0,
    tick: 10,
    sledEndTick: 0,
    sledSpeed: 1,
    frozen: false,
    held: false,
};
const body = () => ({ x: 103.5, y: 203.5, yaw: 0, facingX: 0, facingY: -1 });

test("the sled and movement-speed multipliers apply until the sled expires", () => {
    const active = body();
    movePlayer(grid, active, 1, 0, { ...rules, moveSpeed: 0.5, sledEndTick: 11, sledSpeed: 2 });
    expect(active.x).toBeCloseTo(103.5 + PLAYER_SPEED * 1.5 * 2, 12);
    const expired = body();
    movePlayer(grid, expired, 1, 0, { ...rules, moveSpeed: 0.5, sledEndTick: 10, sledSpeed: 2 });
    expect(expired.x).toBeCloseTo(103.5 + PLAYER_SPEED * 1.5, 12);
});

test("clamps a moving or stationary body inside the boss arena", () => {
    const arena = { minX: 103, minY: 203, maxX: 104, maxY: 204 };
    const moving = body();
    for (let i = 0; i < 50; i++) movePlayer(grid, moving, 1, -1, { ...rules, arena });
    expect(moving.x).toBe(104 - rules.radius);
    expect(moving.y).toBe(203 + rules.radius);
    const outside = { ...body(), x: 106, y: 201 };
    movePlayer(grid, outside, 0, 0, { ...rules, arena });
    expect(outside.x).toBe(moving.x);
    expect(outside.y).toBe(moving.y);
});

test("a held player can turn with cursed controls without moving", () => {
    const held = body();
    const moving = movePlayer(grid, held, 1, 0, {
        ...rules,
        frozen: true,
        held: true,
        curse: { matrix: [-1, 0, 0, 1], attacksLeft: 1 },
    });
    expect(moving).toBe(false);
    expect(held).toMatchObject({ x: 103.5, y: 203.5, facingX: -1, facingY: 0, yaw: 512 });
});
