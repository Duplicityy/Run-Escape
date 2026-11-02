import type { Sim } from "../core/Sim";

// Presentation only: never put this position or facing back into a Sim.
export type PlayerPose = {
    hero: number;
    x: number;
    y: number;
    yaw: number;
    moving: boolean;
    moveTicks: number;
};

export function getPlayerPose(
    sim: Sim,
    hero: number,
    alpha: number,
    predicted?: PlayerPose,
): PlayerPose {
    if (predicted?.hero === hero) {
        return predicted;
    }
    const player = sim.heroes[hero]?.player ?? sim.player;
    return {
        hero,
        x: player.prevX + (player.x - player.prevX) * alpha,
        y: player.prevY + (player.y - player.prevY) * alpha,
        yaw: player.yaw,
        moving: player.moving,
        moveTicks: sim.tick - player.moveStart,
    };
}
