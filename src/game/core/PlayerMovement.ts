import type { Player, PlayerCurse } from "./entities";
import { fm } from "./fmath";
import type { ArenaGrid } from "./world/ArenaGrid";
import { moveCircle } from "./world/Collision";

export type MovementBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type MovementRules = {
    radius: number;
    baseSpeed: number;
    moveSpeed: number;
    tick: number;
    sledEndTick: number;
    sledSpeed: number;
    frozen: boolean;
    held: boolean;
    curse?: PlayerCurse;
    arena?: MovementBounds;
};
type MovementBody = Pick<Player, "x" | "y" | "yaw"> & Partial<Pick<Player, "facingX" | "facingY">>;

// Only writes the supplied body. The sim and its separate presentation body
// share these rules; timers, animation transitions and combat stay with callers.
export function movePlayer(
    grid: ArenaGrid,
    body: MovementBody,
    moveX: number,
    moveY: number,
    rules: MovementRules,
    ticks = 1,
): boolean {
    if (rules.curse) {
        const [a, b, c, d] = rules.curse.matrix;
        const x = moveX * a + moveY * b;
        moveY = moveX * c + moveY * d;
        moveX = x;
    }
    const input = moveX !== 0 || moveY !== 0;
    const moving = !rules.frozen && input;
    if (moving && ticks > 0) {
        const sled = rules.tick < rules.sledEndTick ? rules.sledSpeed : 1;
        const speed = rules.baseSpeed * (1 + rules.moveSpeed) * sled;
        moveCircle(grid, body, moveX * speed * ticks, moveY * speed * ticks, rules.radius);
    }
    if (moving || (rules.frozen && rules.held && input)) {
        const len = fm.hypot(moveX, moveY);
        body.facingX = moveX / len;
        body.facingY = moveY / len;
        body.yaw = yawFromVector(moveX, moveY);
    }
    if (rules.arena) {
        const arena = rules.arena;
        const edge = rules.radius;
        body.x = Math.max(arena.minX + edge, Math.min(arena.maxX - edge, body.x));
        body.y = Math.max(arena.minY + edge, Math.min(arena.maxY - edge, body.y));
    }
    return moving;
}

// RS yaw (0 south, 512 west, 1024 north, 1536 east) for a direction.
export function yawFromVector(dx: number, dy: number): number {
    return Math.round((fm.atan2(-dx, -dy) / (2 * Math.PI)) * 2048) & 2047;
}
