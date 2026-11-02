import { MovementRules, movePlayer } from "../../core/PlayerMovement";
import { PLAYER_SPEED, Sim, TICKS_PER_SECOND } from "../../core/Sim";
import type { FrameEvent } from "../../core/lockstep";
import { moveCircle } from "../../core/world/Collision";
import { PlayerPose, getPlayerPose } from "../PlayerPose";

const TICK_MS = 1000 / TICKS_PER_SECOND;
// Bound both replay work and how far the picture can run ahead of confirmed play.
export const PREDICTION_MS = 300;
export const MAX_INPUT_HISTORY = 128;
// Refresh a held direction so host time lost between ticks can't accumulate
// indefinitely in our local-to-confirmed timeline. Still uses the send throttle.
export const MOVE_REFRESH_MS = 200;
const STALE_MS = 500;
const CORRECTION_MS = 80;
const SNAP_DISTANCE = 1.5;

type Input = { seq: number; at: number; move: [number, number] };

// Replays only this player's movement on a separate position. No Sim.step,
// random numbers, combat, timers or writes to the authoritative player.
export class MovementPrediction {
    private sequence = 0;
    private acknowledged = 0;
    private inputs: Input[];
    private confirmedAt: number;
    private receivedAt: number;
    private renderedAt: number;
    private confirmed = false;
    private lastTick: number;
    private lastX: number;
    private lastY: number;
    private pose?: PlayerPose;
    private rules?: MovementRules;

    constructor(
        private readonly sim: Sim,
        private readonly now: () => number,
    ) {
        const time = now();
        this.confirmedAt = this.receivedAt = this.renderedAt = time;
        this.inputs = [{ seq: 0, at: time, move: [0, 0] }];
        this.lastTick = sim.tick;
        this.lastX = sim.player.x;
        this.lastY = sim.player.y;
    }

    // Called even when the network's move throttle hasn't elapsed yet.
    sample(move: [number, number]): number {
        const last = this.inputs[this.inputs.length - 1];
        if (
            last.move[0] !== move[0] ||
            last.move[1] !== move[1] ||
            ((move[0] !== 0 || move[1] !== 0) && this.now() - last.at >= MOVE_REFRESH_MS)
        ) {
            this.inputs.push({ seq: ++this.sequence, at: this.now(), move });
            if (this.inputs.length > MAX_INPUT_HISTORY) {
                this.inputs.shift();
                this.confirmedAt = Math.max(this.confirmedAt, this.inputs[0].at);
            }
        }
        return this.sequence;
    }

    // Called AFTER applying a confirmed frame, not just receiving its packet.
    confirm(events: readonly FrameEvent[]): void {
        const time = this.now();
        this.receivedAt = time;
        this.confirmed = true;
        this.confirmedAt += Math.max(0, this.sim.tick - this.lastTick) * TICK_MS;
        for (const event of events) {
            if (
                event.hero !== this.sim.focus ||
                !event.moveSeq ||
                event.moveSeq <= this.acknowledged
            ) {
                continue;
            }
            const input = this.inputs.find((entry) => entry.seq === event.moveSeq);
            if (input) {
                this.acknowledged = input.seq;
                // This confirmed step already moved once with that input.
                this.confirmedAt = input.at + TICK_MS;
            }
        }
        // Old host ticks mustn't consume input it hasn't applied yet. The
        // host may coalesce several changes; its latest sequence retires all.
        const pending = this.inputs.find((input) => input.seq > this.acknowledged);
        this.confirmedAt = Math.min(this.confirmedAt, pending?.at ?? time, time);
        while (
            this.inputs.length > 1 &&
            this.inputs[1].seq <= this.acknowledged &&
            this.inputs[1].at <= this.confirmedAt
        ) {
            this.inputs.shift();
        }
        const player = this.sim.player;
        if (Math.hypot(player.x - this.lastX, player.y - this.lastY) > SNAP_DISTANCE) {
            this.reset(time);
        }
        this.lastTick = this.sim.tick;
        this.lastX = player.x;
        this.lastY = player.y;
    }

    private reset(time: number): void {
        this.resetTimeline(time);
        this.renderedAt = time;
        this.pose = undefined;
    }

    private resetTimeline(time: number): void {
        const last = this.inputs[this.inputs.length - 1];
        this.inputs = [{ ...last, at: time }];
        this.acknowledged = last.seq;
        this.confirmedAt = time;
    }

    // Uses the sim's movement rules on a separate body, in bounded small steps.
    private move(pose: PlayerPose, input: Input, ms: number): void {
        let left = ms;
        do {
            const ticks = Math.min(left, TICK_MS) / TICK_MS;
            pose.moving = movePlayer(
                this.sim.grid,
                pose,
                input.move[0] / 127,
                input.move[1] / 127,
                this.rules!,
                ticks,
            );
            left -= TICK_MS;
        } while (left > 0);
    }

    private replay(pose: PlayerPose, from: number, to: number): void {
        let input = this.inputs[0];
        for (const next of this.inputs) {
            if (next.at <= from) {
                input = next;
            } else if (next.at < to) {
                this.move(pose, input, next.at - from);
                from = next.at;
                input = next;
            } else {
                break;
            }
        }
        this.move(pose, input, Math.max(0, to - from));
    }

    render(alpha = 1): PlayerPose | undefined {
        const time = this.now();
        const sim = this.sim;
        const player = sim.player;
        const dt = Math.max(0, time - this.renderedAt);
        const blend = 1 - Math.exp(-dt / CORRECTION_MS);
        if (
            !this.confirmed ||
            sim.state !== "playing" ||
            sim.runOver ||
            !sim.isUp(sim.heroes[sim.focus]) ||
            player.frozen > 0 ||
            time - this.receivedAt > STALE_MS ||
            time < this.renderedAt
        ) {
            // Keep the picture while its lead decays. Dropping it immediately
            // would jump both the body and camera back to the confirmed player.
            this.resetTimeline(time);
            this.renderedAt = time;
            const target = getPlayerPose(sim, sim.focus, alpha);
            const pose = this.pose;
            if (!pose) return undefined;
            pose.x += (target.x - pose.x) * blend;
            pose.y += (target.y - pose.y) * blend;
            pose.yaw = target.yaw;
            pose.moving = target.moving;
            pose.moveTicks = target.moveTicks;
            if (Math.hypot(target.x - pose.x, target.y - pose.y) < 0.001) {
                this.pose = undefined;
                return undefined;
            }
            return pose;
        }
        const target: PlayerPose = {
            hero: sim.focus,
            x: player.x,
            y: player.y,
            yaw: player.yaw,
            moving: player.moving,
            moveTicks: sim.tick - player.moveStart,
        };
        // Resolve this once per render, rather than scanning for the boss
        // during every replayed movement segment.
        const hero = sim.heroes[sim.focus];
        this.rules = {
            radius: player.radius,
            baseSpeed: PLAYER_SPEED,
            moveSpeed: hero.stats.moveSpeed,
            tick: sim.tick,
            sledEndTick: hero.sledEndTick,
            sledSpeed: hero.sledSpeed,
            frozen: player.frozen > 0,
            held: !!hero.hold,
            curse: hero.curse,
            arena: sim.map.bossArena && sim.shownBoss?.def.boss?.phases ? sim.bossArena : undefined,
        };
        // Keep the newest input when a lead exceeds the replay budget: starts,
        // stops and turns mustn't get stranded beyond the end of an old window.
        this.replay(target, Math.max(this.confirmedAt, time - PREDICTION_MS), time);
        const pose = this.pose ?? { ...target };
        const wasMoving = pose.moving;
        if (this.pose) {
            this.replay(pose, Math.max(this.renderedAt, time - PREDICTION_MS), time);
            const dx = target.x - pose.x;
            const dy = target.y - pose.y;
            if (Math.hypot(dx, dy) > SNAP_DISTANCE) {
                pose.x = target.x;
                pose.y = target.y;
            } else {
                const beforeX = pose.x;
                const beforeY = pose.y;
                moveCircle(sim.grid, pose, dx * blend, dy * blend, player.radius);
                const progress = (pose.x - beforeX) * dx + (pose.y - beforeY) * dy;
                // Correction is not a player walking. If a wall blocks it,
                // cross to the valid confirmed/replayed target instead of
                // leaving the camera stranded on the other side forever.
                if (progress + 1e-12 < (dx * dx + dy * dy) * blend * 0.5) {
                    pose.x = target.x;
                    pose.y = target.y;
                }
            }
        }
        // Facing and animation react even before the next movement tick.
        this.move(pose, this.inputs[this.inputs.length - 1], 0);
        pose.moveTicks = pose.moving === wasMoving ? pose.moveTicks + dt / TICK_MS : 0;
        this.renderedAt = time;
        this.pose = pose;
        return pose;
    }
}
