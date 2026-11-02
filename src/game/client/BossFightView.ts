import { ActorRenderer } from "../../mapviewer/webgl/actor/ActorRenderer";
import { FREEZE_SPOTANIM, Sim, yawFromVector } from "../core/Sim";
import {
    BossQuarters,
    BossWindup,
    Enemy,
    GroundHazard,
    SimEvent,
    SurgeLane,
} from "../core/entities";
import { GameAssets } from "./GameAssets";
import { Overlay, ScreenPoint } from "./Overlay";

// What a boss with a fight of its own puts in the world (BossDef.phases,
// BossDef.intro): marks on the ground, bullets, the dark of its entrance. All of
// it is warned on the ground, so anything here that's hard to read is a bug.

const BEAM_MS = 700;
// Tiles either way from the player that flowers and lines are drawn: enough to
// fill the screen at the widest zoom, and no more
const VIEW_REACH = 44;
// A long edge is split into pieces this long, to lie on the ground
const GROUND_STEP = 3;
const BULLET_HEIGHT = 0.9;
// Her flowers are all that says which quarter's safe, so they stand out
const FLOWER_SCALE = 1.7;
// Tiles from her that petals start gathering, and end up; radians a tick they turn
const GATHER_FAR = 7;
const GATHER_NEAR = 2;
const GATHER_SPIN = 0.05;
// A spore that's been stepped on, about to go
const FUSE_FLASH = 0.7;
// What she throws at the player, shown over them until it bursts, in tiles
const PARASITE_HEIGHT = 2;
const DARK = 0.78;
const FADE_TICKS = 40;
const LANE_CHEVRON_GAP = 4;
// Pixels, at a scale of 1
const TOTEM_ARROW = 14;

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function clamp01(t: number): number {
    return Math.min(1, Math.max(0, t));
}

export class BossFightView {
    private beams: { x: number; y: number; toX: number; toY: number; start: number }[] = [];
    private readonly a: ScreenPoint = { x: 0, y: 0, visible: false };
    private readonly b: ScreenPoint = { x: 0, y: 0, visible: false };

    constructor(private readonly assets: GameAssets) {}

    reset(): void {
        this.beams = [];
    }

    onEvent(event: SimEvent, now: number): void {
        if (event.type === "totemBlast") {
            const { x, y, toX, toY } = event;
            this.beams.push({ x, y, toX, toY, start: now });
        }
    }

    private ground(sim: Sim, x: number, y: number): number {
        return sim.grid.getHeight(x, y) / 128;
    }

    // ---- In the 3D view ----

    submitActors(actors: ActorRenderer, sim: Sim, alpha: number): void {
        const quarters = sim.quarters;
        if (quarters) {
            this.drawFlowers(actors, sim, quarters);
        }
        this.drawBullets(actors, sim, alpha);
        this.drawGathering(actors, sim);
        this.drawPlayerMarks(actors, sim, alpha);
        for (const hazard of sim.hazards) {
            this.drawHazard(actors, sim, hazard);
        }
    }

    // Her real portals and spores, at the size of what they do: nothing else marks
    // them, and a real portal's fill is its countdown
    private drawHazard(actors: ActorRenderer, sim: Sim, hazard: GroundHazard): void {
        const ground = hazard.attack.ground!;
        const model = this.assets.get(
            ground.locId !== undefined ? "loc:" + ground.locId : "spot:" + ground.spotAnim,
        );
        if (!model) {
            return;
        }
        const anim = model.anims[0];
        const frame = anim.getFrame(sim.tick - hazard.startTick, true);
        const lit = hazard.fuseTick !== -1 ? FUSE_FLASH : 0;
        const fit = ground.fit ?? 1;
        actors.draw(
            model,
            anim,
            frame,
            hazard.x,
            this.ground(sim, hazard.x, hazard.y),
            hazard.y,
            0,
            { scale: (fit * hazard.radius * 128) / Math.max(1, model.radius), flash: lit },
        );
        const middle = this.assets.get("spot:" + ground.middleSpotAnim);
        if (middle) {
            const arm = middle.anims[0];
            actors.draw(
                middle,
                arm,
                arm.getFrame(sim.tick - hazard.startTick, false),
                hazard.x,
                this.ground(sim, hazard.x, hazard.y),
                hazard.y,
                0,
            );
        }
    }

    // Her real shots, each pointing the way it's going. Drawn at their hit size.
    private drawBullets(actors: ActorRenderer, sim: Sim, alpha: number): void {
        const bullets = sim.bullets;
        const { prevX, prevY, x, y, vx, vy, radius, source, startTick, order } = bullets;
        const tick = sim.tick;
        const options = { scale: 1, flash: 0 };
        for (let i = 0; i < bullets.count; i++) {
            const slot = order[i];
            // A bullet in the air keeps its source (Sim.freeBulletSources)
            const attack = sim.bulletSources[source[slot]]!.attack;
            const model = this.assets.get("spot:" + attack.spotAnim);
            if (!model) {
                continue;
            }
            const wx = lerp(prevX[slot], x[slot], alpha);
            const wy = lerp(prevY[slot], y[slot], alpha);
            const anim = model.anims[0];
            const pattern = attack.pattern!;
            options.scale =
                pattern.scale ?? Math.max(1, (radius[slot] * 128) / Math.max(1, model.radius));
            options.flash = pattern.bright ?? 0;
            actors.draw(
                model,
                anim,
                anim.getFrame(tick - startTick[slot]),
                wx,
                this.ground(sim, wx, wy) - BULLET_HEIGHT,
                wy,
                yawFromVector(vx[slot], vy[slot]),
                options,
            );
        }
    }

    // Her petals drawing in on her before a spiral or a ring
    private drawGathering(actors: ActorRenderer, sim: Sim): void {
        for (const enemy of sim.enemies) {
            const windup = enemy.bossState?.windup;
            const attack = windup?.attack;
            if (!windup || !attack?.pattern || enemy.dead || attack.pattern.shape === "spread") {
                continue;
            }
            const model = this.assets.get("spot:" + attack.spotAnim);
            if (!model) {
                continue;
            }
            const t = clamp01(
                (sim.tick - windup.startTick) / Math.max(1, windup.landTick - windup.startTick),
            );
            const anim = model.anims[0];
            const frame = anim.getFrame(sim.tick);
            const petals = attack.pattern.count * 3;
            const reach = lerp(GATHER_FAR, GATHER_NEAR, t);
            const options = { scale: (attack.pattern.radius * 128) / Math.max(1, model.radius) };
            for (let i = 0; i < petals; i++) {
                const angle = (i / petals) * Math.PI * 2 + sim.tick * GATHER_SPIN;
                const wx = enemy.x + Math.cos(angle) * reach;
                const wy = enemy.y + Math.sin(angle) * reach;
                actors.draw(
                    model,
                    anim,
                    frame,
                    wx,
                    this.ground(sim, wx, wy) - BULLET_HEIGHT,
                    wy,
                    yawFromVector(-Math.sin(angle), Math.cos(angle)),
                    options,
                );
            }
        }
    }

    // What's on the player: the ice of being held, or the parasite in them
    private drawPlayerMarks(actors: ActorRenderer, sim: Sim, alpha: number): void {
        const player = sim.player;
        const x = lerp(player.prevX, player.x, alpha);
        const y = lerp(player.prevY, player.y, alpha);
        const height = this.ground(sim, x, y);
        const mark = (key: string, up: number, loop: boolean, start: number) => {
            const model = this.assets.get(key);
            if (model) {
                const anim = model.anims[0];
                const frame = anim.getFrame(sim.tick - start, loop);
                actors.draw(model, anim, frame, x, height - up, y, 0);
            }
        };
        if (sim.hold) {
            mark("spot:" + FREEZE_SPOTANIM, 0, true, 0);
        }
        if (sim.parasite) {
            mark("spot:" + sim.parasite.attack.spotAnim, PARASITE_HEIGHT, true, 0);
        }
    }

    // Along the four lines, white on the two beside the safe quarter
    private drawFlowers(actors: ActorRenderer, sim: Sim, quarters: BossQuarters): void {
        const def = quarters.attack.quarters!;
        const safe = this.assets.get("loc:" + def.safeLocId);
        const hurt = this.assets.get("loc:" + def.hurtLocId);
        const arena = sim.bossArena;
        const { x: cx, y: cy, safe: quarter } = quarters;
        const east = (quarter & 1) === 1;
        const north = (quarter & 2) === 2;
        const line = (dx: number, dy: number, white: boolean) => {
            const model = white ? safe : hurt;
            if (!model) {
                return;
            }
            const anim = model.anims[0];
            const frame = anim.getFrame(sim.tick - quarters.startTick);
            for (let along = 0; along <= VIEW_REACH; along += def.spacing) {
                const x = cx + dx * along;
                const y = cy + dy * along;
                if (x < arena.minX || x > arena.maxX || y < arena.minY || y > arena.maxY) {
                    return;
                }
                actors.draw(model, anim, frame, x, this.ground(sim, x, y), y, 0, options);
            }
        };
        const growth = clamp01(
            (sim.tick - quarters.startTick) / Math.max(1, quarters.hurtTick - quarters.startTick),
        );
        const options = { scale: lerp(FLOWER_SCALE * 0.4, FLOWER_SCALE, growth) };
        line(1, 0, east);
        line(-1, 0, !east);
        line(0, 1, north);
        line(0, -1, !north);
    }

    // ---- On the ground ----

    drawGround(overlay: Overlay, sim: Sim, alpha: number, now: number, scale: number): void {
        this.drawSquareEdge(overlay, sim, scale);
        for (const enemy of sim.enemies) {
            const state = enemy.bossState;
            if (!state || enemy.dead) {
                continue;
            }
            const windup = state.windup;
            if (windup) {
                const t = clamp01(
                    (sim.tick + alpha - windup.startTick) /
                        Math.max(1, windup.landTick - windup.startTick),
                );
                if (windup.lane) {
                    this.drawLane(overlay, sim, windup.lane, t, now, scale);
                } else if (windup.attack.cone !== undefined) {
                    this.drawCone(overlay, sim, enemy, windup, t, scale);
                } else if (windup.attack.pattern) {
                    this.drawAim(overlay, sim, enemy, windup, t, scale);
                }
            }
            const surge = state.surge;
            if (surge) {
                this.drawLane(overlay, sim, surge.lane, 1, now, scale);
            }
        }
    }

    // Traces a shape on the ground, each edge split up to follow it. Corners
    // behind the camera are left out: only a shape well off the screen has any.
    private traceGround(overlay: Overlay, sim: Sim, corners: { x: number; y: number }[]): void {
        const ctx = overlay.ctx;
        ctx.beginPath();
        let first = true;
        const point = (x: number, y: number) => {
            const p = overlay.project(x, this.ground(sim, x, y) - 0.1, y, this.a);
            if (p.behind) {
                return;
            }
            if (first) {
                ctx.moveTo(p.x, p.y);
                first = false;
            } else {
                ctx.lineTo(p.x, p.y);
            }
        };
        for (let i = 0; i < corners.length; i++) {
            const from = corners[i];
            const to = corners[(i + 1) % corners.length];
            const steps = Math.max(
                1,
                Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / GROUND_STEP),
            );
            for (let step = 0; step < steps; step++) {
                point(lerp(from.x, to.x, step / steps), lerp(from.y, to.y, step / steps));
            }
        }
        ctx.closePath();
    }

    private traceCircle(
        overlay: Overlay,
        sim: Sim,
        cx: number,
        cy: number,
        radius: number,
        steps = 20,
    ): void {
        const ctx = overlay.ctx;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            const p = overlay.project(x, this.ground(sim, x, y) - 0.1, y, this.a);
            if (i === 0) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        }
    }

    // A fight in a set square (MapDef.bossArena) can't be walked out of, and on
    // open ground nothing else says why the player has stopped
    private drawSquareEdge(overlay: Overlay, sim: Sim, scale: number): void {
        const boss = sim.shownBoss;
        if (!sim.map.bossArena || !boss?.def.boss?.phases || boss.dead) {
            return;
        }
        const { minX, minY, maxX, maxY } = sim.bossArena;
        this.traceGround(overlay, sim, [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
        ]);
        const ctx = overlay.ctx;
        ctx.lineWidth = Math.max(2, 4 * scale);
        ctx.strokeStyle = "rgba(255, 110, 215, 0.8)";
        ctx.stroke();
    }

    // The whole lane, there from the start, red, with arrows running the way
    // she'll come and a bright front closing down it as the moment nears
    private drawLane(
        overlay: Overlay,
        sim: Sim,
        lane: SurgeLane,
        t: number,
        now: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        const player = sim.player;
        const dx = lane.toX - lane.fromX;
        const dy = lane.toY - lane.fromY;
        const length = Math.max(0.001, Math.hypot(dx, dy));
        const dirX = dx / length;
        const dirY = dy / length;
        const sideX = -dirY * lane.halfWidth;
        const sideY = dirX * lane.halfWidth;
        // What's in view of the player, so a long lane doesn't reach behind the camera
        const middle = (player.x - lane.fromX) * dirX + (player.y - lane.fromY) * dirY;
        const start = Math.max(0, middle - VIEW_REACH);
        const end = Math.min(length, middle + VIEW_REACH);
        const at = (along: number, side: number) => ({
            x: lane.fromX + dirX * along + sideX * side,
            y: lane.fromY + dirY * along + sideY * side,
        });
        const strip = (from: number, to: number) => {
            this.traceGround(overlay, sim, [at(from, -1), at(to, -1), at(to, 1), at(from, 1)]);
        };

        strip(start, end);
        ctx.fillStyle = `rgba(255, 20, 50, ${0.22 + 0.2 * t})`;
        ctx.fill();
        ctx.lineWidth = Math.max(2, 4 * scale);
        ctx.strokeStyle = `rgba(255, 90, 90, ${0.75 + 0.25 * t})`;
        ctx.stroke();

        // The time left, as how far down the lane it's filled
        const front = lerp(0, length, t);
        if (front > start) {
            strip(start, Math.min(end, front));
            ctx.fillStyle = `rgba(255, 60, 60, ${0.14 + 0.16 * t})`;
            ctx.fill();
        }

        // Which way she's coming
        const travel = ((now / 1000) * 10) % LANE_CHEVRON_GAP;
        ctx.lineWidth = Math.max(2, 3 * scale);
        ctx.strokeStyle = `rgba(255, 235, 235, ${0.55 + 0.4 * t})`;
        const first = Math.floor(start / LANE_CHEVRON_GAP) * LANE_CHEVRON_GAP + travel;
        for (let along = first; along < end; along += LANE_CHEVRON_GAP) {
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const spot = at(along + (i === 1 ? 1.2 : 0), (i - 1) * 0.6);
                const p = overlay.project(
                    spot.x,
                    this.ground(sim, spot.x, spot.y) - 0.1,
                    spot.y,
                    this.a,
                );
                if (i === 0) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }
            ctx.stroke();
        }
    }

    // In the way she's facing, and under her
    private drawCone(
        overlay: Overlay,
        sim: Sim,
        enemy: Enemy,
        windup: BossWindup,
        t: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        const attack = windup.attack;
        const radius = attack.radius ?? 2;
        const cone = attack.cone!;
        const base = Math.atan2(windup.dirY, windup.dirX);
        const steps = 8;
        const wedge = (reach: number) => {
            const points = [{ x: enemy.x, y: enemy.y }];
            for (let i = 0; i <= steps; i++) {
                const angle = base - cone / 2 + (cone * i) / steps;
                points.push({
                    x: enemy.x + Math.cos(angle) * reach,
                    y: enemy.y + Math.sin(angle) * reach,
                });
            }
            this.traceGround(overlay, sim, points);
        };
        wedge(radius);
        ctx.fillStyle = `rgba(200, 20, 20, ${0.14 + 0.14 * t})`;
        ctx.fill();
        ctx.lineWidth = Math.max(2, 3 * scale);
        ctx.strokeStyle = `rgba(255, 70, 50, ${0.6 + 0.4 * t})`;
        ctx.stroke();
        wedge(radius * t);
        ctx.fillStyle = `rgba(255, 40, 20, ${0.28 * t})`;
        ctx.fill();
        this.traceCircle(overlay, sim, enemy.x, enemy.y, attack.underRadius ?? 0);
        ctx.fillStyle = `rgba(255, 40, 20, ${0.16 + 0.16 * t})`;
        ctx.fill();
        ctx.stroke();
    }

    // A fan's lines, showing where it's aimed: she's turned to it, but nothing real
    // says how wide it'll go
    private drawAim(
        overlay: Overlay,
        sim: Sim,
        enemy: Enemy,
        windup: BossWindup,
        t: number,
        scale: number,
    ): void {
        const pattern = windup.attack.pattern!;
        if (pattern.shape !== "spread") {
            return;
        }
        const ctx = overlay.ctx;
        const base = Math.atan2(windup.dirY, windup.dirX);
        const arc = pattern.arc ?? 1;
        ctx.strokeStyle = "#ffb060";
        ctx.globalAlpha = 0.3 + 0.5 * t;
        ctx.lineWidth = Math.max(2, 3 * scale);
        for (let i = 0; i < pattern.count; i++) {
            const angle = base - arc / 2 + (arc * i) / Math.max(1, pattern.count - 1);
            const from = overlay.project(
                enemy.x,
                this.ground(sim, enemy.x, enemy.y),
                enemy.y,
                this.a,
            );
            const x = enemy.x + Math.cos(angle) * 12;
            const y = enemy.y + Math.sin(angle) * 12;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            const to = overlay.project(x, this.ground(sim, x, y), y, this.b);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // ---- Over the whole screen ----

    drawScreen(overlay: Overlay, sim: Sim, alpha: number, now: number, scale: number): void {
        this.drawBeams(overlay, sim, now, scale);
        this.drawTotemArrows(overlay, sim, scale);
        const boss = sim.shownBoss;
        const width = overlay.width;
        const height = overlay.height;
        const ctx = overlay.ctx;
        // Still dim around the edges for as long as she's up
        if (boss?.def.boss?.intro && !boss.dead && !sim.intro) {
            this.vignette(ctx, width, height, "rgba(10, 0, 20, 0.5)");
        }
        if (sim.curse) {
            const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * 3);
            this.vignette(ctx, width, height, `rgba(255, 60, 190, ${0.28 + 0.2 * pulse})`);
        }
        this.drawIntro(overlay, sim, alpha, scale);
    }

    private vignette(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        color: string,
    ): void {
        const reach = Math.hypot(width, height) / 2;
        const glow = ctx.createRadialGradient(
            width / 2,
            height / 2,
            reach * 0.55,
            width / 2,
            height / 2,
            reach,
        );
        glow.addColorStop(0, "rgba(0, 0, 0, 0)");
        glow.addColorStop(1, color);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
    }

    // Each totem's blast, across to her
    private drawBeams(overlay: Overlay, sim: Sim, now: number, scale: number): void {
        const ctx = overlay.ctx;
        this.beams = this.beams.filter((beam) => now - beam.start < BEAM_MS);
        for (const beam of this.beams) {
            const t = (now - beam.start) / BEAM_MS;
            const from = overlay.project(
                beam.x,
                this.ground(sim, beam.x, beam.y) - 2,
                beam.y,
                this.a,
            );
            const to = overlay.project(
                beam.toX,
                this.ground(sim, beam.toX, beam.toY) - 2,
                beam.toY,
                this.b,
            );
            if (from.behind || to.behind) {
                continue;
            }
            ctx.lineWidth = 8 * scale * (1 - t) + 1;
            ctx.strokeStyle = `rgba(255, 230, 150, ${1 - t})`;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }
    }

    // Where the totems still to charge are, for those off the screen
    private drawTotemArrows(overlay: Overlay, sim: Sim, scale: number): void {
        const phase = sim.shownBoss?.bossState?.phase;
        if (!phase || phase.stage !== "totems") {
            return;
        }
        const ctx = overlay.ctx;
        const width = overlay.width;
        const height = overlay.height;
        const margin = 40 * scale;
        const size = TOTEM_ARROW * scale;
        const middleX = width / 2;
        const middleY = height / 2;
        const player = sim.player;
        for (const totem of phase.totems) {
            if (totem.hp <= 0) {
                continue;
            }
            const p = overlay.project(totem.x, this.ground(sim, totem.x, totem.y), totem.y, this.a);
            if (!p.behind && p.x > 0 && p.y > 0 && p.x < width && p.y < height) {
                continue;
            }
            // The way there on the ground, as it's on the screen: north is up
            const dx = totem.x - player.x;
            const dy = -(totem.y - player.y);
            const length = Math.max(0.001, Math.hypot(dx, dy));
            const dirX = dx / length;
            const dirY = dy / length;
            const reach = Math.min(
                (middleX - margin) / Math.max(Math.abs(dirX), 0.001),
                (middleY - margin) / Math.max(Math.abs(dirY), 0.001),
            );
            const x = middleX + dirX * reach;
            const y = middleY + dirY * reach;
            ctx.beginPath();
            ctx.moveTo(x + dirX * size, y + dirY * size);
            ctx.lineTo(x - dirX * size - dirY * size * 0.8, y - dirY * size + dirX * size * 0.8);
            ctx.lineTo(x - dirX * size + dirY * size * 0.8, y - dirY * size - dirX * size * 0.8);
            ctx.closePath();
            ctx.fillStyle = "#ffd76a";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#000000";
            ctx.stroke();
        }
    }

    // The dark coming down, a light left on her as she rises, and her name
    private drawIntro(overlay: Overlay, sim: Sim, alpha: number, scale: number): void {
        const intro = sim.intro;
        if (!intro) {
            return;
        }
        const ctx = overlay.ctx;
        const width = overlay.width;
        const height = overlay.height;
        const tick = sim.tick + alpha;
        const fade = clamp01(
            Math.min((tick - intro.startTick) / FADE_TICKS, (intro.endTick - tick) / FADE_TICKS),
        );
        const spot = intro.boss ?? sim.player;
        const p = overlay.project(spot.x, this.ground(sim, spot.x, spot.y) - 2, spot.y, this.a);
        const cx = p.behind ? width / 2 : p.x;
        const cy = p.behind ? height / 2 : p.y;
        const reach = Math.hypot(width, height);
        // A wide light, as she's a big thing, and it reaches the player beside her
        const dark = ctx.createRadialGradient(cx, cy, height * 0.2, cx, cy, reach * 0.62);
        dark.addColorStop(0, `rgba(8, 0, 18, ${0.12 * fade})`);
        dark.addColorStop(0.45, `rgba(8, 0, 18, ${0.5 * fade})`);
        dark.addColorStop(1, `rgba(8, 0, 18, ${DARK * fade})`);
        ctx.fillStyle = dark;
        ctx.fillRect(0, 0, width, height);

        const title = clamp01((tick - intro.riseTick) / FADE_TICKS);
        const titleFade = Math.min(title, clamp01((intro.endTick - tick) / FADE_TICKS));
        if (titleFade <= 0) {
            return;
        }
        const def = intro.def.boss!.intro!;
        const pixel = Math.max(1, Math.round(scale * 2));
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = titleFade;
        ctx.font = `${24 * pixel}px "OSRS Bold", sans-serif`;
        // The lower third: the bar and what's under it are above, and on a phone
        // anything nearer the middle is on top of the player
        const y = height * 0.72;
        ctx.fillStyle = "#000000";
        ctx.fillText(def.title, width / 2 + pixel, y + pixel);
        ctx.fillStyle = "#ff9ae6";
        ctx.fillText(def.title, width / 2, y);
        if (def.subtitle) {
            ctx.font = `${12 * pixel}px "OSRS Bold", sans-serif`;
            ctx.fillStyle = "#000000";
            ctx.fillText(def.subtitle, width / 2 + pixel, y + 18 * pixel + pixel);
            ctx.fillStyle = "#e8d0ff";
            ctx.fillText(def.subtitle, width / 2, y + 18 * pixel);
        }
        ctx.globalAlpha = 1;
    }
}
