import {
    ActorAnim,
    ActorModel,
    ActorRenderer,
    NO_TINT,
} from "../../mapviewer/webgl/actor/ActorRenderer";
import { getEnemy } from "../content/enemies";
import { CASKETS } from "../content/items";
import { POWER_UP_BLINK, POWER_UP_COLOR, POWER_UP_LIFETIME, getPowerUp } from "../content/powerups";
import { VISITOR_BLINK, VISITOR_COLOR } from "../content/randomEvents";
import {
    DEATH_SINK_TICKS,
    Hero,
    MAX_DEATH_ANIM_TICKS,
    RAMPAGE_FADE_TICKS,
    Sim,
    TICKS_PER_SECOND,
    yawFromVector,
} from "../core/Sim";
import {
    Enemy,
    FairyRing,
    FallingRock,
    Glyph,
    GroundFire,
    GroundPool,
    Pickup,
    Rampage,
    SimEvent,
    Thrall,
    Visitor,
} from "../core/entities";
import { BossFightView } from "./BossFightView";
import {
    CANNON_MODEL_KEY,
    GameAssets,
    HITSPLAT_SPRITES,
    PLAYER_SEQS,
    getEnemyModelKey,
    getPickupModelKey,
    getPileLook,
    getShieldedModelKey,
} from "./GameAssets";
import { Overlay, ScreenPoint } from "./Overlay";
import { PlayerPose, getPlayerPose } from "./PlayerPose";

const FROZEN_TINT = 0xa8d8ff;
// Co-op teammates' names and arrows, like a friend's name in the client, and
// the name of one who's down (out of the run)
export const TEAMMATE_COLOR = "#00ff80";
const TEAMMATE_DOWN_COLOR = "#9a9a9a";
// Shielded enemies (that can't be hurt yet) are washed in lilac
const SHIELDED_TINT = 0xd0b8ff;
// A blockable attack winding up shows the shelter behind the glyph out this
// far from the boss, in tiles
const SHELTER_LENGTH = 30;
const CANNON_SCALE = 0.75;
// From this many tiles' radius, a dev map stands something on more than its middle
const BIG_ACTOR_RADIUS = 0.95;
const BIG_ACTOR_LIFT = 0.6;
// Yaws face the way NPC models do (south at 0); the cannon's barrel points
// north in its model, so it's turned half a turn to aim where it shoots
const CANNON_YAW_OFFSET = 1024;
const PLAYER_HIT_TINT = 0xff9090;
// Burning ground's flames are drawn this much bigger than a camp fire's, to
// read as a patch of fire from the game's camera, and are this far out of step
// and turned this far from each other (of 2048)
const FLAME_SCALE = 2;
const FLAME_STEP_TICKS = 7;
const FLAME_TURN = 683;

// What's running from a boss's entrance fades out this many ticks before it goes
const LEAVING_FADE_TICKS = 20;

// Heights above the ground, in tiles
const PROJECTILE_HEIGHT = 0.9;
// Runes circling the player are small ground items; bigger reads better
const RUNE_SCALE = 1.6;
// Enemy and boss projectiles smaller than a tile across (radius in model
// units, 128 a tile) are drawn up to this much bigger than in OSRS, and all
// of them with an outline this thick (model units), flat orange behind them
const ENEMY_PROJECTILE_SCALE = 1.8;
const PROJECTILE_MIN_RADIUS = 64;
const PROJECTILE_OUTLINE = 12;
// ...and a soft glow round them this many pixels across (at the UI's scale)
const PROJECTILE_GLOW = 20;
// Health bars sit 15 units over the head, like the client's
const HEALTH_BAR_GAP = 15 / 128;

const HITSPLAT_MS = 900;
const MAX_HITSPLATS = 120;
// The splat a little smaller than the client draws it; the number stays at
// the font's own size, where it's crisp
const HITSPLAT_SPRITE_SCALE = 0.85;
const SLASH_MS = 180;
// A disguised boss's beam, once it's shaking
const DISGUISE_COLOR = "#ff3020";
// Bosses' pools: ticks they take to spread and to dry up, and the model's
// scale for each tile of radius
const POOL_GROW_TICKS = 12;
const POOL_DRY_TICKS = 50;
const POOL_SCALE = 2.2;
// Swooshes are white, apart from these weapons' (r, g, b)
const SLASH_COLORS: Record<string, string> = {
    abyssal_whip: "180, 60, 60",
    scythe_of_vitur: "150, 20, 40",
    thunder_khopesh: "150, 200, 255",
    dinhs_bulwark: "210, 180, 110",
    sanguine_scythe: "150, 20, 40",
    ancient_godsword: "150, 20, 40",
    burning_claws: "240, 130, 40",
    inquisitors_mace: "230, 200, 120",
    dinhs_blazing_bulwark: "240, 130, 40",
};
const AURA_MS = 320;
const BLAST_MS = 480;
const SWING_MS = 260;
// Overhead chat stays up this long (the client's is 150 cycles, 3 seconds)
const SHOUT_MS = 3000;

// A casket thrown out of an elite: up and down, then a little bounce
const CASKET_HOP_TICKS = 28;
const CASKET_HOP_HEIGHT = 1.6;
// Loot beams on caskets lying on the ground (like RuneLite's), in tiles
const LOOT_BEAM_HEIGHT = 4;
// Power-ups are drawn bigger than other ground items and bob up and down
const POWER_UP_SCALE = 1.3;
const POWER_UP_LOC_SCALE = 0.45;
const POWER_UP_BOB = 0.15;
// A power-up's flash over the screen fades out over this long
const FLASH_MS = 700;
// A rock's size, and how far up it starts (tiles)
const ROCK_SCALE = 5;
const ROCK_FALL_HEIGHT = 14;
const ROCK_FADE_TICKS = TICKS_PER_SECOND;
// How long a fairy ring takes to open
const RING_OPEN_TICKS = 20;
// A charging NPC's legs go this much faster than its walk, and it's lit up so
// a black cat shows on the darker maps
const RAMPAGE_ANIM_SPEED = 2;
const RAMPAGE_FLASH = 0.25;
// Thralls are small next to a top-down player; they fade out over their last
// second
const THRALL_SCALE = 1.5;
const THRALL_FADE_TICKS = TICKS_PER_SECOND;

type HitsplatKind = keyof typeof HITSPLAT_SPRITES;

type Hitsplat = {
    kind: HitsplatKind;
    x: number;
    y: number;
    amount: number;
    start: number;
    // Follows this enemy, or this hero (Sim.heroes, -1 for none)
    enemyUid: number;
    hero: number;
    height: number;
};
type SlashFx = {
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    reach: number;
    // Half the angle it covers, radians
    arc: number;
    start: number;
    // r, g, b; white when unset
    color?: string;
    // Whose swing it is, which it follows
    hero: number;
};
type AuraFx = { x: number; y: number; radius: number; start: number; hero: number };
type BlastFx = { x: number; y: number; radius: number; start: number };
type SwingFx = { x: number; y: number; radius: number; start: number };
// enemyUid 0 or less: a hero, -enemyUid (enemies' uids start at 1), or
// VISITOR_SHOUT for a random event's visitor
type Shout = { enemyUid: number; text: string; start: number };
const VISITOR_SHOUT = -1000;
// Random events' visitors stand out from the crowd
const VISITOR_SCALE = 1.5;
type FlashFx = { color: string; start: number };

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// Draws a run: everything in the sim as 3D actors, and hitsplats, health bars
// and weapon swooshes on the 2D overlay.
export class GameView {
    localPlayerPose?: PlayerPose;
    private hitsplats: Hitsplat[] = [];
    private slashes: SlashFx[] = [];
    auras: AuraFx[] = [];
    private blasts: BlastFx[] = [];
    private swings: SwingFx[] = [];
    private shouts: Shout[] = [];
    private flash?: FlashFx;
    private readonly screen: ScreenPoint = { x: 0, y: 0, visible: false };
    private readonly screen2: ScreenPoint = { x: 0, y: 0, visible: false };
    private enemiesByUid = new Map<number, Enemy>();
    // The hero the camera's on: the focus, or in co-op while they're down, a
    // teammate (GameClient sets it)
    viewHero = 0;

    private readonly fight: BossFightView;

    constructor(readonly assets: GameAssets) {
        this.fight = new BossFightView(assets);
    }

    reset(): void {
        this.localPlayerPose = undefined;
        this.fight.reset();
        this.hitsplats = [];
        this.slashes = [];
        this.auras = [];
        this.blasts = [];
        this.swings = [];
        this.shouts = [];
        this.flash = undefined;
    }

    private addHitsplat(hitsplat: Omit<Hitsplat, "start">): void {
        if (this.hitsplats.length >= MAX_HITSPLATS) {
            this.hitsplats.shift();
        }
        this.hitsplats.push({ ...hitsplat, start: performance.now() + this.rngDelay() });
    }

    // Where hitsplats on a hero go, in tiles above the ground
    private playerHitsplatHeight(hero: number): number {
        return ((this.assets.getPlayer(hero)?.height ?? 200) / 128) * 0.6;
    }

    onEvents(sim: Sim, events: SimEvent[]): void {
        const now = performance.now();
        for (const event of events) {
            this.fight.onEvent(event, now);
            switch (event.type) {
                case "damage": {
                    const enemy = sim.enemies.find((e) => e.uid === event.enemyUid);
                    const model =
                        enemy && this.assets.get(getEnemyModelKey(enemy.def, enemy.variant));
                    const height = model ? (model.height * enemy.scale) / 128 : 1;
                    this.addHitsplat({
                        kind: event.blocked ? "block" : event.poison ? "poison" : "damage",
                        x: event.x,
                        y: event.y,
                        amount: event.amount,
                        enemyUid: event.enemyUid,
                        hero: -1,
                        height: height * 0.6,
                    });
                    break;
                }
                case "playerHit":
                case "playerPoisoned": {
                    const hero = event.hero ?? sim.focus;
                    const player = sim.heroes[hero].player;
                    this.addHitsplat({
                        kind: event.type === "playerHit" ? "damage" : "poison",
                        x: player.x,
                        y: player.y,
                        amount: event.amount,
                        enemyUid: 0,
                        hero,
                        height: this.playerHitsplatHeight(hero),
                    });
                    break;
                }
                case "bossSwing":
                    this.swings.push({ x: event.x, y: event.y, radius: event.radius, start: now });
                    break;
                case "bossShout":
                    // A new line replaces what it was saying
                    this.shouts = this.shouts.filter((s) => s.enemyUid !== event.enemyUid);
                    this.shouts.push({ enemyUid: event.enemyUid, text: event.text, start: now });
                    break;
                case "playerShout": {
                    const key = -(event.hero ?? sim.focus);
                    this.shouts = this.shouts.filter((s) => s.enemyUid !== key);
                    this.shouts.push({ enemyUid: key, text: event.text, start: now });
                    break;
                }
                case "visitorShout":
                    this.shouts = this.shouts.filter((s) => s.enemyUid !== VISITOR_SHOUT);
                    this.shouts.push({ enemyUid: VISITOR_SHOUT, text: event.text, start: now });
                    break;
                case "slash":
                    this.slashes.push({
                        x: event.x,
                        y: event.y,
                        dirX: event.dirX,
                        dirY: event.dirY,
                        reach: event.reach,
                        arc: event.arc,
                        start: now,
                        color: SLASH_COLORS[event.weaponId],
                        hero: event.hero ?? sim.focus,
                    });
                    break;
                case "aura":
                    this.auras.push({
                        x: event.x,
                        y: event.y,
                        radius: event.radius,
                        start: now,
                        hero: event.hero ?? sim.focus,
                    });
                    break;
                case "blast":
                    this.blasts.push({ x: event.x, y: event.y, radius: event.radius, start: now });
                    break;
                case "bossAbsorbBlast":
                    // Everywhere: there's no getting out of it
                    this.flash = { color: "#ff40c0", start: now };
                    break;
                case "powerUp": {
                    const powerUp = getPowerUp(event.id);
                    if (powerUp.flash) {
                        this.flash = { color: powerUp.flash, start: now };
                    }
                    if (powerUp.effect.kind === "nuke") {
                        this.blasts.push({ x: event.x, y: event.y, radius: 16, start: now });
                    }
                    break;
                }
            }
        }
    }

    // Spreads hitsplats landing on the same tick a little, like the client does
    private rngDelay(): number {
        return Math.random() * 60;
    }

    private ground(sim: Sim, x: number, y: number): number {
        return sim.grid.getHeight(x, y) / 128;
    }

    // The ground for something big on a ScapeRune map, whose slopes are too steep to stand it by its
    // middle alone: it'd sink into the hill on one side. It's lifted part of the way to the
    // highest ground under it.
    private groundUnder(sim: Sim, x: number, y: number, radius: number): number {
        const middle = this.ground(sim, x, y);
        if (!sim.map.scaperune || radius < BIG_ACTOR_RADIUS) {
            return middle;
        }
        const reach = radius * 0.7;
        // Negative is up
        const top = Math.min(
            this.ground(sim, x - reach, y - reach),
            this.ground(sim, x + reach, y - reach),
            this.ground(sim, x - reach, y + reach),
            this.ground(sim, x + reach, y + reach),
        );
        return middle + Math.min(top - middle, 0) * BIG_ACTOR_LIFT;
    }

    submitActors(actors: ActorRenderer, sim: Sim, alpha: number): void {
        const tick = sim.tick;
        for (const hero of sim.heroes) {
            if (!hero.left) {
                this.drawPlayer(actors, sim, hero.index, alpha);
            }
        }

        for (const enemy of sim.enemies) {
            this.drawEnemy(actors, sim, enemy, alpha);
        }

        for (const thrall of sim.thralls) {
            this.drawThrall(actors, sim, thrall, alpha);
        }

        if (sim.visitor) {
            this.drawVisitor(actors, sim, sim.visitor);
        }

        for (const turret of sim.turrets) {
            const model = this.assets.get(CANNON_MODEL_KEY);
            if (model) {
                const anim = model.anims[0];
                // The real cannon takes up 3x3 tiles; smaller reads better next to the player
                actors.draw(
                    model,
                    anim,
                    0,
                    turret.x,
                    this.ground(sim, turret.x, turret.y),
                    turret.y,
                    (turret.yaw + CANNON_YAW_OFFSET) & 2047,
                    {
                        scale: CANNON_SCALE,
                    },
                );
            }
        }

        for (const projectile of sim.enemyProjectiles) {
            const spotAnim = projectile.attack.spotAnim;
            const model = spotAnim !== undefined ? this.assets.get("spot:" + spotAnim) : undefined;
            if (!model || !hasGeometry(model)) {
                // Drawn as a glow on the overlay instead
                continue;
            }
            const x = lerp(projectile.prevX, projectile.x, alpha);
            const y = lerp(projectile.prevY, projectile.y, alpha);
            const anim = model.anims[0];
            const frame = anim.getFrame(tick - projectile.startTick);
            const height = this.ground(sim, x, y) - PROJECTILE_HEIGHT;
            // Bigger than in OSRS: most are a few pixels across from up here
            // Small ones drawn bigger, up to a tile across, and all outlined
            // the same thickness
            const scale = Math.min(
                ENEMY_PROJECTILE_SCALE,
                Math.max(1, PROJECTILE_MIN_RADIUS / Math.max(1, model.radius)),
            );
            actors.draw(model, anim, frame, x, height, y, projectile.yaw, {
                scale,
                outline: 1 + PROJECTILE_OUTLINE / (model.radius * scale + 1),
            });
        }

        for (const projectile of sim.projectiles) {
            const x = lerp(projectile.prevX, projectile.x, alpha);
            const y = lerp(projectile.prevY, projectile.y, alpha);
            const height = this.ground(sim, x, y) - PROJECTILE_HEIGHT;
            let model: ActorModel | undefined;
            if (projectile.objId !== -1) {
                model = this.assets.get("obj:" + projectile.objId);
            } else if (projectile.spotAnim !== -1) {
                model = this.assets.get("spot:" + projectile.spotAnim);
            }
            if (!model) {
                continue;
            }
            const anim = model.anims[0];
            const frame = anim.getFrame(tick - projectile.startTick);
            actors.draw(model, anim, frame, x, height, y, projectile.yaw, {
                scale: projectile.kind === "rune" ? RUNE_SCALE : 1,
            });
        }

        for (const pickup of sim.pickups) {
            const model = this.assets.get(getPickupModelKey(pickup));
            if (!model) {
                continue;
            }
            const x = lerp(pickup.prevX, pickup.x, alpha);
            const y = lerp(pickup.prevY, pickup.y, alpha);
            // Ground items turn slowly so they catch the eye
            let yaw = (pickup.uid * 331 + tick * 6) & 2047;
            let height = this.ground(sim, x, y);
            // Ground item models are big next to a top-down player; bigger
            // piles of bones and coins show a little bigger
            const pile = getPileLook(pickup);
            let scale = 0.85;
            if (pile) {
                scale = pile.scale;
            } else if (pickup.kind === "food") {
                scale = 1.1;
            } else if (pickup.kind === "casket") {
                scale = 1.3;
                const t = (tick - pickup.spawnTick) / CASKET_HOP_TICKS;
                height -= casketHop(t);
                // Tumbling while it's in the air
                if (t < 1) {
                    yaw = (yaw + Math.round(t * 2048)) & 2047;
                }
                // A boss in disguise, about to come out: rattling on the spot
                const opening = pickup.disguise && pickup.disguise.openTick !== -1;
                if (opening) {
                    yaw = (yaw + Math.round(Math.sin(tick * 1.4) * 120)) & 2047;
                    height -= 0.12 * Math.abs(Math.sin(tick * 0.9));
                    scale = 1.5;
                }
            } else if (pickup.kind === "powerUp") {
                // Blinks when it's about to go
                const age = (tick - pickup.spawnTick) / TICKS_PER_SECOND;
                if (age > POWER_UP_LIFETIME - POWER_UP_BLINK && Math.floor(tick / 6) % 2 === 0) {
                    continue;
                }
                scale = model.key.startsWith("loc:") ? POWER_UP_LOC_SCALE : POWER_UP_SCALE;
                height -= POWER_UP_BOB * (1 + Math.sin((tick + pickup.uid * 13) / 8));
            }
            actors.draw(model, model.anims[0], 0, x, height, y, yaw, { scale });
        }

        for (const rock of sim.rocks) {
            this.drawRock(actors, sim, rock);
        }

        for (const rampage of sim.rampages) {
            this.drawRampage(actors, sim, rampage, alpha);
        }

        for (const ring of sim.rings) {
            this.drawRing(actors, sim, ring);
        }

        for (const fire of sim.fires) {
            this.drawFire(actors, sim, fire);
        }

        for (const pool of sim.pools) {
            this.drawPool(actors, sim, pool);
        }

        for (const glyph of sim.glyphs) {
            this.drawGlyph(actors, sim, glyph, alpha);
        }

        this.fight.submitActors(actors, sim, alpha);

        for (const effect of sim.effects) {
            const model = this.assets.get("spot:" + effect.spotAnim);
            if (!model) {
                continue;
            }
            const anim = model.anims[0];
            const frame = anim.getFrame(tick - effect.startTick, effect.loop ?? false);
            const height = this.ground(sim, effect.x, effect.y) - effect.height;
            actors.draw(model, anim, frame, effect.x, height, effect.y, 0);
        }
    }

    // Falling faster and faster, then fading away where it landed
    private drawRock(actors: ActorRenderer, sim: Sim, rock: FallingRock): void {
        const model = this.assets.get("loc:" + rock.locId);
        if (!model) {
            return;
        }
        const t = Math.min(1, (sim.tick - rock.startTick) / (rock.landTick - rock.startTick));
        const height = this.ground(sim, rock.x, rock.y) - ROCK_FALL_HEIGHT * (1 - t * t);
        const fade = Math.min(1, (rock.endTick - sim.tick) / ROCK_FADE_TICKS);
        actors.draw(model, model.anims[0], 0, rock.x, height, rock.y, (rock.uid * 331) & 2047, {
            scale: ROCK_SCALE,
            alpha: Math.max(0, fade),
        });
    }

    // Black cats are lost on the darker maps, so always with the silhouette and
    // lit up a little
    private drawRampage(actors: ActorRenderer, sim: Sim, rampage: Rampage, alpha: number): void {
        const model = this.assets.get("rampage:" + rampage.powerUpId);
        // The clock runs on when the run's over, but nothing moves
        if (!model || sim.runOver) {
            return;
        }
        const anim = model.getAnim(rampage.walkSeq);
        const x = lerp(rampage.prevX, rampage.x, alpha);
        const y = lerp(rampage.prevY, rampage.y, alpha);
        const faded =
            rampage.doneTick === -1 ? 0 : (sim.tick - rampage.doneTick) / RAMPAGE_FADE_TICKS;
        actors.draw(
            model,
            anim,
            anim.getFrame((sim.tick - rampage.startTick) * RAMPAGE_ANIM_SPEED),
            x,
            this.ground(sim, x, y),
            y,
            rampage.yaw,
            {
                scale: rampage.scale,
                alpha: Math.max(0, 1 - faded),
                silhouette: true,
                flash: RAMPAGE_FLASH,
            },
        );
    }

    // Opening and closing quickly, at either end of its time
    private drawRing(actors: ActorRenderer, sim: Sim, ring: FairyRing): void {
        const model = this.assets.get("loc:" + ring.locId);
        // The clock runs on past its end when the run's over
        if (!model || sim.tick >= ring.endTick) {
            return;
        }
        const open = Math.min(sim.tick - ring.startTick, ring.endTick - sim.tick);
        const height = this.ground(sim, ring.x, ring.y);
        actors.draw(model, model.anims[0], 0, ring.x, height, ring.y, 0, {
            scale: ring.scale * Math.min(1, 0.4 + open / RING_OPEN_TICKS),
        });
    }

    // Each flame turned and a little out of step with the next, so they don't
    // flicker as one
    private drawFire(actors: ActorRenderer, sim: Sim, fire: GroundFire): void {
        const model = this.assets.get("loc:" + fire.locId);
        // The clock runs on past its end when the run's over
        if (!model || sim.tick >= fire.endTick) {
            return;
        }
        const anim = model.anims[0];
        fire.flames.forEach(({ x, y }, i) => {
            const frame = anim.getFrame(sim.tick + i * FLAME_STEP_TICKS);
            actors.draw(model, anim, frame, x, this.ground(sim, x, y), y, i * FLAME_TURN, {
                scale: FLAME_SCALE,
            });
        });
    }

    // A boss's pool: the real thing on the ground, spreading as it lands and
    // fading as it dries up, each one turned its own way
    private drawPool(actors: ActorRenderer, sim: Sim, pool: GroundPool): void {
        const model = this.assets.get("loc:" + pool.locId);
        // The clock runs on past its end when the run's over
        if (!model || sim.tick >= pool.endTick) {
            return;
        }
        const size = Math.min(1, (sim.tick - pool.startTick) / POOL_GROW_TICKS);
        const height = this.ground(sim, pool.x, pool.y);
        actors.draw(model, model.anims[0], 0, pool.x, height, pool.y, (pool.uid * 331) & 2047, {
            scale: pool.radius * POOL_SCALE * size,
            alpha: Math.min(1, (pool.endTick - sim.tick) / POOL_DRY_TICKS),
        });
    }

    // A boss's glyph, idling as it slides, facing the boss
    private drawGlyph(actors: ActorRenderer, sim: Sim, glyph: Glyph, alpha: number): void {
        const model = this.assets.get(getEnemyModelKey(glyph.look, 0));
        if (!model) {
            return;
        }
        const anim = model.getAnim(glyph.look.idleSeq);
        const x = lerp(glyph.prevX, glyph.x, alpha);
        const y = lerp(glyph.prevY, glyph.y, alpha);
        actors.draw(
            model,
            anim,
            anim.getFrame(sim.tick),
            x,
            this.ground(sim, x, y),
            y,
            yawFromVector(-glyph.dirX, -glyph.dirY),
            { scale: glyph.look.scale ?? 1, silhouette: true },
        );
    }

    private drawThrall(actors: ActorRenderer, sim: Sim, thrall: Thrall, alpha: number): void {
        const def = thrall.def;
        const model = this.assets.get("thrall:" + def.id);
        if (!model) {
            return;
        }
        const tick = sim.tick;
        let anim = model.getAnim(def.attackSeq);
        let frame: number;
        if (thrall.attackStart !== -1 && tick - thrall.attackStart < anim.totalTicks) {
            frame = anim.getFrame(tick - thrall.attackStart, false);
        } else {
            anim = model.getAnim(thrall.moving ? def.walkSeq : def.idleSeq);
            frame = anim.getFrame(tick + thrall.uid * 7);
        }
        const x = lerp(thrall.prevX, thrall.x, alpha);
        const y = lerp(thrall.prevY, thrall.y, alpha);
        const fade = Math.min(1, (thrall.endTick - tick) / THRALL_FADE_TICKS);
        actors.draw(model, anim, frame, x, this.ground(sim, x, y), y, thrall.yaw, {
            scale: THRALL_SCALE,
            alpha: Math.max(0, fade),
        });
    }

    // Facing the player, and blinking when they're about to go
    private drawVisitor(actors: ActorRenderer, sim: Sim, visitor: Visitor): void {
        const { def, x, y } = visitor;
        const model = this.assets.get("visitor:" + def.id);
        const left = (visitor.endTick - sim.tick) / TICKS_PER_SECOND;
        if (
            !model ||
            def.idleSeq === undefined ||
            (left < VISITOR_BLINK && Math.floor(sim.tick / 6) % 2 === 0)
        ) {
            return;
        }
        const anim = model.getAnim(def.idleSeq);
        const player = sim.player;
        actors.draw(
            model,
            anim,
            anim.getFrame(sim.tick),
            x,
            this.ground(sim, x, y),
            y,
            yawFromVector(player.x - x, player.y - y),
            { scale: VISITOR_SCALE, silhouette: true },
        );
    }

    private drawPlayer(actors: ActorRenderer, sim: Sim, hero: number, alpha: number): void {
        const pose = getPlayerPose(sim, hero, alpha, this.localPlayerPose);
        // A power-up's look replaces the player's usual model and everything it does
        const powerUp = sim.as(hero, () => sim.wornPowerUp);
        const look = powerUp?.look;
        const lookModel = powerUp && this.assets.getPlayerLook(powerUp.id, hero);
        const model = lookModel ?? this.assets.getPlayer(hero);
        if (!model) {
            return;
        }
        const player = sim.heroes[hero].player;
        const tick = sim.tick;
        let anim: ActorAnim;
        let frame: number;
        const attack = player.attackSeq !== -1 ? model.getAnim(player.attackSeq) : undefined;
        if (look && lookModel) {
            anim = model.getAnim(pose.moving ? look.moveSeq : look.idleSeq);
            frame = anim.getFrame(pose.moveTicks);
        } else if (player.deathTick !== -1) {
            // The death animation holds its last frame (lying down)
            anim = model.getAnim(PLAYER_SEQS.death);
            frame = anim.getFrame(Math.min(tick - player.deathTick, MAX_DEATH_ANIM_TICKS), false);
        } else if (
            attack &&
            attack.seqId === player.attackSeq &&
            !pose.moving &&
            tick - player.attackStart < attack.totalTicks
        ) {
            anim = attack;
            frame = anim.getFrame(tick - player.attackStart, false);
        } else {
            const stance = this.assets.getPlayerStance(hero);
            anim = model.getAnim(pose.moving ? stance.run : stance.idle);
            frame = anim.getFrame(pose.moveTicks);
        }
        const { x, y } = pose;
        let tint = NO_TINT;
        let flash = 0;
        if (player.flash > 0) {
            tint = PLAYER_HIT_TINT;
        }
        if (player.frozen > 0) {
            tint = FROZEN_TINT;
        }
        if (player.invulnerable > 30 && Math.floor(tick / 5) % 2 === 0) {
            flash = 0.5;
        }
        actors.draw(model, anim, frame, x, this.ground(sim, x, y), y, pose.yaw, {
            silhouette: true,
            tint,
            flash,
        });
    }

    private drawEnemy(actors: ActorRenderer, sim: Sim, enemy: Enemy, alpha: number): void {
        const def = enemy.def;
        const tick = sim.tick;
        // Drawn as its shielded version while it's shielded, if it has one
        const shielded = !enemy.dead && enemy.shieldEnd > tick ? def.shield?.look : undefined;
        const model = this.assets.get(
            shielded ? getShieldedModelKey(def) : getEnemyModelKey(def, enemy.variant),
        );
        if (!model) {
            this.assets.requestEnemy(def);
            return;
        }
        const x = lerp(enemy.prevX, enemy.x, alpha);
        const y = lerp(enemy.prevY, enemy.y, alpha);
        let anim: ActorAnim;
        let frame: number;
        let sink = 0;
        if (enemy.dead) {
            const t = tick - enemy.deathTick;
            if (def.deathSeq !== -1) {
                anim = model.getAnim(def.deathSeq);
                const length = Math.min(anim.totalTicks, MAX_DEATH_ANIM_TICKS);
                frame = anim.getFrame(Math.min(t, length - 1), false);
                if (t > length) {
                    sink = (t - length) / DEATH_SINK_TICKS;
                }
            } else {
                anim = model.getAnim(def.idleSeq);
                frame = 0;
                sink = t / DEATH_SINK_TICKS;
            }
        } else if (shielded) {
            anim = model.getAnim(shielded.idleSeq);
            frame = anim.getFrame(tick + enemy.uid * 7);
        } else if (enemy.anim === "jump" && def.jumpSeq !== undefined) {
            anim = model.getAnim(def.jumpSeq);
            frame = anim.getFrame(tick - enemy.animStart, false);
        } else if (enemy.anim === "attack" && enemy.attackSeq !== -1) {
            anim = model.getAnim(enemy.attackSeq);
            frame = anim.getFrame(tick - enemy.animStart, false);
        } else {
            const moving =
                Math.abs(enemy.x - enemy.prevX) + Math.abs(enemy.y - enemy.prevY) > 0.002;
            anim = model.getAnim(moving && enemy.frozen === 0 ? def.walkSeq : def.idleSeq);
            // Offset by uid so a crowd doesn't move in lockstep
            frame = anim.getFrame(tick + enemy.uid * 7);
        }
        const height =
            this.groundUnder(sim, x, y, (model.radius * enemy.scale) / 128) +
            (sink * model.height * enemy.scale) / 128;
        let tint = enemy.tint;
        if (enemy.frozen > 0 && !enemy.dead) {
            tint = FROZEN_TINT;
        } else if (
            enemy.shieldEnd > tick &&
            !enemy.leaving &&
            !enemy.totemOf &&
            enemy.risingEnd === 0
        ) {
            tint = SHIELDED_TINT;
        }
        // Fading out as it reaches the edge
        const leaving = enemy.leaving;
        const fade = leaving ? Math.min(1, (leaving.endTick - tick) / LEAVING_FADE_TICKS) : 1;
        // The boss is hit all the time; a full flash would leave him white
        const flash = enemy.flash > 0 ? (enemy.boss ? 0.2 : 0.55) : 0;
        actors.draw(model, anim, frame, x, height, y, enemy.yaw, {
            scale: enemy.scale,
            tint,
            flash,
            silhouette: enemy.boss,
            alpha: Math.max(0, fade),
        });
    }

    drawOverlay(overlay: Overlay, sim: Sim, alpha: number): void {
        const ctx = overlay.ctx;
        const now = performance.now();
        const scale = Math.max(overlay.height / 900, 0.75);

        this.enemiesByUid.clear();
        for (const enemy of sim.enemies) {
            this.enemiesByUid.set(enemy.uid, enemy);
        }

        this.drawLootBeams(overlay, sim, alpha, now, scale);
        this.drawBossWindups(overlay, sim, alpha);
        this.fight.drawGround(overlay, sim, alpha, now, scale);
        this.drawAuras(overlay, sim, alpha, now);
        this.drawBlasts(overlay, sim, now, scale);
        this.drawRockTargets(overlay, sim, now, scale);
        this.drawRingReach(overlay, sim, now, scale);
        this.drawSwings(overlay, sim, now, scale);
        this.drawSlashes(overlay, sim, alpha, now, scale);
        this.drawEnemyProjectileGlows(overlay, sim, alpha, scale);

        // Health bars over hurt elites; with hundreds of enemies bars on all of
        // them are just noise (hitsplats show the damage), and the boss has his
        // bar at the top of the screen
        for (const enemy of sim.enemies) {
            if (enemy.dead || enemy.hp >= enemy.maxHp || !enemy.elite) {
                continue;
            }
            const model = this.assets.get(getEnemyModelKey(enemy.def, enemy.variant));
            const x = lerp(enemy.prevX, enemy.x, alpha);
            const y = lerp(enemy.prevY, enemy.y, alpha);
            const top =
                this.ground(sim, x, y) -
                ((model?.height ?? 128) * enemy.scale) / 128 -
                HEALTH_BAR_GAP;
            const p = overlay.project(x, top, y, this.screen);
            if (p.visible) {
                drawHealthBar(ctx, p.x, p.y, scale, enemy.hp / enemy.maxHp);
            }
        }

        // The players' bars over their heads, gone when they die like in the
        // game; co-op's others have their names over them too
        for (const hero of sim.heroes) {
            this.drawHeroBar(overlay, sim, hero, alpha, scale);
        }

        this.drawHitsplats(overlay, sim, alpha, now, scale);
        if (sim.heroes.length > 1) {
            this.drawTeammateArrows(overlay, sim, alpha, now, scale);
        }
        this.drawShouts(overlay, sim, alpha, now, scale);
        this.fight.drawScreen(overlay, sim, alpha, now, scale);
        this.drawFlash(overlay, now);
    }

    // A power-up's flash: the whole screen, fading out
    private drawFlash(overlay: Overlay, now: number): void {
        const flash = this.flash;
        if (!flash) {
            return;
        }
        const t = (now - flash.start) / FLASH_MS;
        if (t >= 1) {
            this.flash = undefined;
            return;
        }
        overlay.ctx.fillStyle = withAlpha(flash.color, 0.75 * (1 - t) * (1 - t));
        overlay.ctx.fillRect(0, 0, overlay.width, overlay.height);
    }

    // Overhead chat: yellow text over the speaker's head, like the client's
    private drawShouts(
        overlay: Overlay,
        sim: Sim,
        alpha: number,
        now: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        this.shouts = this.shouts.filter((s) => now - s.start < SHOUT_MS);
        const pixel = Math.max(1, Math.round(scale));
        ctx.font = `${16 * pixel}px "OSRS Bold", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        for (const shout of this.shouts) {
            let x: number;
            let y: number;
            let height: number;
            if (shout.enemyUid === VISITOR_SHOUT) {
                const visitor = sim.visitor;
                if (!visitor) {
                    continue;
                }
                x = visitor.x;
                y = visitor.y;
                const model = this.assets.get("visitor:" + visitor.def.id);
                height = (model?.height ?? 200) * VISITOR_SCALE;
            } else if (shout.enemyUid <= 0) {
                const hero = -shout.enemyUid;
                const player = sim.heroes[hero]?.player;
                if (!player) {
                    continue;
                }
                ({ x, y } = getPlayerPose(sim, hero, alpha, this.localPlayerPose));
                height = this.assets.getPlayer(hero)?.height ?? 200;
            } else {
                const enemy = this.enemiesByUid.get(shout.enemyUid);
                if (!enemy || enemy.dead) {
                    continue;
                }
                const model = this.assets.get(getEnemyModelKey(enemy.def, enemy.variant));
                x = lerp(enemy.prevX, enemy.x, alpha);
                y = lerp(enemy.prevY, enemy.y, alpha);
                height = (model?.height ?? 200) * enemy.scale;
            }
            const top = this.ground(sim, x, y) - height / 128;
            const p = overlay.project(x, top, y, this.screen);
            if (!p.visible) {
                continue;
            }
            ctx.fillStyle = "#000000";
            ctx.fillText(shout.text, p.x + pixel, p.y - 4 * pixel + pixel);
            ctx.fillStyle = "#ffff00";
            ctx.fillText(shout.text, p.x, p.y - 4 * pixel);
        }
    }

    private drawHitsplats(
        overlay: Overlay,
        sim: Sim,
        alpha: number,
        now: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        this.hitsplats = this.hitsplats.filter((h) => now - h.start < HITSPLAT_MS);
        // The font at a whole number of screen pixels per font pixel, so the
        // numbers stay crisp; the client's splats scale along with it
        const pixel = Math.max(1, Math.round(scale));
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = `${16 * pixel}px "OSRS Small", sans-serif`;
        // The splat is scaled down a little, so smooth it
        ctx.imageSmoothingQuality = "high";
        for (const hitsplat of this.hitsplats) {
            const t = (now - hitsplat.start) / HITSPLAT_MS;
            if (t < 0) {
                continue;
            }
            const enemy = this.enemiesByUid.get(hitsplat.enemyUid);
            const player = sim.heroes[hitsplat.hero]?.player;
            if (player) {
                const pose = getPlayerPose(sim, hitsplat.hero, alpha, this.localPlayerPose);
                hitsplat.x = pose.x;
                hitsplat.y = pose.y;
            } else if (enemy) {
                hitsplat.x = enemy.x;
                hitsplat.y = enemy.y;
            }
            const height = this.ground(sim, hitsplat.x, hitsplat.y) - hitsplat.height - t * 0.4;
            const p = overlay.project(hitsplat.x, height, hitsplat.y, this.screen);
            if (!p.visible) {
                continue;
            }
            ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
            const sprite = this.assets.getSprite(HITSPLAT_SPRITES[hitsplat.kind]);
            drawHitsplat(ctx, sprite, p.x, p.y, pixel, hitsplat.amount, hitsplat.kind);
        }
        ctx.globalAlpha = 1;
    }

    // A boss winding up: a red circle filling in over the ground a swing or
    // blast will hit, or a ring closing in at its feet before anything else
    private drawBossWindups(overlay: Overlay, sim: Sim, alpha: number): void {
        const ctx = overlay.ctx;
        for (const enemy of sim.enemies) {
            const windup = enemy.bossState?.windup;
            if (!windup || enemy.dead) {
                continue;
            }
            const t = Math.min(
                1,
                Math.max(
                    0,
                    (sim.tick + alpha - windup.startTick) /
                        Math.max(1, windup.landTick - windup.startTick),
                ),
            );
            const kind = windup.attack.kind;
            // Those that mark the ground themselves (BossFightView)
            if (
                kind === "ground" ||
                kind === "quarters" ||
                kind === "surge" ||
                kind === "pattern" ||
                windup.attack.cone !== undefined
            ) {
                continue;
            }
            if (windup.attack.blockable && this.drawShelter(overlay, sim, enemy, t)) {
                // Where to hide instead of where it hits (it hits everywhere else)
                continue;
            }
            if (kind === "swing" || kind === "blast") {
                // Around the boss, or on the spots a blast lands on
                const spots =
                    kind === "blast"
                        ? windup.targets
                        : [
                              {
                                  x: lerp(enemy.prevX, enemy.x, alpha),
                                  y: lerp(enemy.prevY, enemy.y, alpha),
                              },
                          ];
                const radius = windup.attack.radius ?? 2;
                for (const { x, y } of spots) {
                    this.traceGroundCircle(overlay, sim, x, y, radius);
                    ctx.fillStyle = `rgba(200, 20, 20, ${0.1 + 0.12 * t})`;
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = `rgba(255, 60, 40, ${0.5 + 0.4 * t})`;
                    ctx.stroke();
                    this.traceGroundCircle(overlay, sim, x, y, radius * t);
                    ctx.fillStyle = `rgba(255, 40, 20, ${0.25 * t})`;
                    ctx.fill();
                }
            } else {
                const x = lerp(enemy.prevX, enemy.x, alpha);
                const y = lerp(enemy.prevY, enemy.y, alpha);
                this.traceGroundCircle(overlay, sim, x, y, 1.6 - t);
                ctx.lineWidth = 3;
                ctx.strokeStyle = `rgba(255, 200, 80, ${0.3 + 0.6 * t})`;
                ctx.stroke();
            }
        }
    }

    // The ground the boss's glyph shelters from a blockable attack: from the
    // glyph's edges away from the boss, green, while a red ring closes in on
    // the boss. False if it has no glyph.
    private drawShelter(overlay: Overlay, sim: Sim, enemy: Enemy, t: number): boolean {
        const glyph = sim.glyphs.find((g) => g.bossUid === enemy.uid);
        const width = enemy.def.boss?.glyph?.width;
        if (!glyph || width === undefined) {
            return false;
        }
        const ctx = overlay.ctx;
        // Where the glyph's edges are, and where the rays from the boss past
        // them end
        const edge = (side: number) => {
            const ex = glyph.x + glyph.acrossX * width * side;
            const ey = glyph.y + glyph.acrossY * width * side;
            const dx = ex - enemy.x;
            const dy = ey - enemy.y;
            const length = Math.max(0.001, Math.hypot(dx, dy));
            const far = SHELTER_LENGTH / length;
            return { x: ex, y: ey, farX: enemy.x + dx * far, farY: enemy.y + dy * far };
        };
        const left = edge(-1);
        const right = edge(1);
        const steps = 12;
        ctx.beginPath();
        const point = (wx: number, wy: number, first: boolean) => {
            const p = overlay.project(wx, this.ground(sim, wx, wy) - 0.1, wy, this.screen2);
            if (first) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        };
        for (let i = 0; i <= steps; i++) {
            const f = i / steps;
            point(lerp(left.x, left.farX, f), lerp(left.y, left.farY, f), i === 0);
        }
        for (let i = steps; i >= 0; i--) {
            const f = i / steps;
            point(lerp(right.x, right.farX, f), lerp(right.y, right.farY, f), false);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(40, 220, 90, ${0.12 + 0.18 * t})`;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(120, 255, 150, ${0.5 + 0.4 * t})`;
        ctx.stroke();
        this.traceGroundCircle(overlay, sim, enemy.x, enemy.y, 1 + 3 * (1 - t));
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(255, 60, 40, ${0.4 + 0.6 * t})`;
        ctx.stroke();
        return true;
    }

    // A boss's swing landing
    private drawSwings(overlay: Overlay, sim: Sim, now: number, scale: number): void {
        const ctx = overlay.ctx;
        this.swings = this.swings.filter((s) => now - s.start < SWING_MS);
        for (const swing of this.swings) {
            const t = (now - swing.start) / SWING_MS;
            this.traceGroundCircle(overlay, sim, swing.x, swing.y, swing.radius * (0.7 + 0.3 * t));
            ctx.fillStyle = `rgba(255, 40, 20, ${0.35 * (1 - t)})`;
            ctx.fill();
            ctx.lineWidth = 6 * scale * (1 - t) + 1;
            ctx.strokeStyle = `rgba(255, 230, 200, ${0.9 * (1 - t)})`;
            ctx.stroke();
        }
    }

    // A soft glow round every enemy projectile, so a thin one (an arrow, a
    // bolt) can be made out at the camera's height; one without a model to
    // draw (or whose model didn't load) is drawn as a bright glow instead
    private drawEnemyProjectileGlows(
        overlay: Overlay,
        sim: Sim,
        alpha: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        for (const projectile of sim.enemyProjectiles) {
            const x = lerp(projectile.prevX, projectile.x, alpha);
            const y = lerp(projectile.prevY, projectile.y, alpha);
            const p = overlay.project(
                x,
                this.ground(sim, x, y) - PROJECTILE_HEIGHT,
                y,
                this.screen,
            );
            if (!p.visible) {
                continue;
            }
            const spotAnim = projectile.attack.spotAnim;
            const model = spotAnim !== undefined ? this.assets.get("spot:" + spotAnim) : undefined;
            const drawn = model !== undefined && hasGeometry(model);
            const radius = (drawn ? PROJECTILE_GLOW : 9) * scale;
            const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
            if (drawn) {
                glow.addColorStop(0, "rgba(255, 170, 60, 0.5)");
                glow.addColorStop(0.5, "rgba(255, 120, 20, 0.28)");
                glow.addColorStop(1, "rgba(255, 90, 0, 0)");
            } else {
                glow.addColorStop(0, "rgba(255, 255, 220, 0.95)");
                glow.addColorStop(0.4, "rgba(255, 140, 40, 0.8)");
                glow.addColorStop(1, "rgba(255, 60, 0, 0)");
            }
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    private drawSlashes(
        overlay: Overlay,
        sim: Sim,
        alpha: number,
        now: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        this.slashes = this.slashes.filter((s) => now - s.start < SLASH_MS);
        for (const slash of this.slashes) {
            const t = (now - slash.start) / SLASH_MS;
            // Follows the player, like the weapon does
            const { x: cx, y: cy } = getPlayerPose(sim, slash.hero, alpha, this.localPlayerPose);
            const base = Math.atan2(slash.dirY, slash.dirX);
            const sweep = slash.arc;
            // Enough points for a wide sweep to stay round
            const steps = Math.max(10, Math.ceil(sweep * 9));
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const a = base - sweep + ((2 * sweep * i) / steps) * Math.min(t * 2, 1);
                const r = slash.reach * 0.8;
                const wx = cx + Math.cos(a) * r;
                const wy = cy + Math.sin(a) * r;
                const p = overlay.project(wx, this.ground(sim, wx, wy) - 0.7, wy, this.screen);
                if (i === 0) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }
            ctx.lineCap = "round";
            ctx.lineWidth = 14 * scale * (1 - t * 0.6);
            ctx.strokeStyle = slash.color
                ? `rgba(${slash.color}, ${0.75 * (1 - t)})`
                : `rgba(255, 255, 255, ${0.6 * (1 - t)})`;
            ctx.stroke();
        }
    }

    // A circle on the ground, as the current canvas path
    private traceGroundCircle(
        overlay: Overlay,
        sim: Sim,
        cx: number,
        cy: number,
        radius: number,
    ): void {
        const ctx = overlay.ctx;
        const steps = 32;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            const wx = cx + Math.cos(a) * radius;
            const wy = cy + Math.sin(a) * radius;
            const p = overlay.project(wx, this.ground(sim, wx, wy) - 0.1, wy, this.screen2);
            if (i === 0) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        }
        ctx.closePath();
    }

    private drawAuras(overlay: Overlay, sim: Sim, alpha: number, now: number): void {
        const ctx = overlay.ctx;
        this.auras = this.auras.filter((a) => now - a.start < AURA_MS);
        for (const aura of this.auras) {
            const t = (now - aura.start) / AURA_MS;
            const radius = aura.radius * (0.5 + t * 0.5);
            const pose = getPlayerPose(sim, aura.hero, alpha, this.localPlayerPose);
            this.traceGroundCircle(overlay, sim, pose.x, pose.y, radius);
            ctx.fillStyle = `rgba(150, 210, 255, ${0.18 * (1 - t)})`;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = `rgba(200, 235, 255, ${0.8 * (1 - t)})`;
            ctx.stroke();
        }
    }

    // Chinchompa explosions: a fiery ring racing out over the ground
    private drawBlasts(overlay: Overlay, sim: Sim, now: number, scale: number): void {
        const ctx = overlay.ctx;
        this.blasts = this.blasts.filter((b) => now - b.start < BLAST_MS);
        for (const blast of this.blasts) {
            const t = (now - blast.start) / BLAST_MS;
            const eased = 1 - (1 - t) * (1 - t);
            this.traceGroundCircle(overlay, sim, blast.x, blast.y, blast.radius * (0.2 + eased));
            ctx.fillStyle = `rgba(255, 140, 30, ${0.3 * (1 - t)})`;
            ctx.fill();
            ctx.lineWidth = 10 * scale * (1 - t) + 2;
            ctx.strokeStyle = `rgba(255, 220, 120, ${0.9 * (1 - t)})`;
            ctx.stroke();
        }
    }

    // Where a rock's coming down, in the power-up colour so it doesn't read as
    // something to run from
    private drawRockTargets(overlay: Overlay, sim: Sim, now: number, scale: number): void {
        const ctx = overlay.ctx;
        for (const rock of sim.rocks) {
            if (rock.landTick <= sim.tick) {
                continue;
            }
            const pulse = 0.75 + 0.25 * Math.sin(now / 60);
            this.traceGroundCircle(overlay, sim, rock.x, rock.y, rock.radius);
            ctx.fillStyle = withAlpha(POWER_UP_COLOR, 0.15 * pulse);
            ctx.fill();
            ctx.lineWidth = 3 * scale;
            ctx.strokeStyle = withAlpha(POWER_UP_COLOR, 0.9 * pulse);
            ctx.stroke();
        }
    }

    // How far a fairy ring reaches
    private drawRingReach(overlay: Overlay, sim: Sim, now: number, scale: number): void {
        const ctx = overlay.ctx;
        for (const ring of sim.rings) {
            this.traceGroundCircle(overlay, sim, ring.x, ring.y, ring.radius);
            ctx.lineWidth = 2 * scale;
            ctx.strokeStyle = withAlpha(POWER_UP_COLOR, 0.45 + 0.15 * Math.sin(now / 200));
            ctx.stroke();
        }
    }

    // A beam of the casket's tier colour over every casket on the ground (and
    // of the power-up colour over power-ups, and the visitor colour over a
    // random event's visitor), and an arrow at the edge of the screen for ones
    // out of view
    private drawLootBeams(
        overlay: Overlay,
        sim: Sim,
        alpha: number,
        now: number,
        scale: number,
    ): void {
        const pulse = 0.75 + 0.25 * Math.sin(now / 180);
        for (const pickup of sim.pickups) {
            let color: string;
            // The beam shoots up once a casket has landed
            let landTick = pickup.spawnTick;
            if (pickup.kind === "casket" && pickup.tier) {
                color = CASKETS[pickup.tier].color;
                landTick += CASKET_HOP_TICKS;
            } else if (pickup.kind === "powerUp") {
                color = getPowerUp(pickup.powerUp ?? "").color ?? POWER_UP_COLOR;
            } else {
                continue;
            }
            if (pickup.disguise && pickup.disguise.openTick !== -1) {
                color = DISGUISE_COLOR;
            }
            this.drawBeam(overlay, sim, pickup, landTick, color, alpha, pulse, scale);
        }
        const visitor = sim.visitor;
        if (visitor) {
            this.drawBeam(
                overlay,
                sim,
                visitor,
                visitor.startTick,
                VISITOR_COLOR,
                alpha,
                pulse,
                scale,
            );
        }
    }

    private drawBeam(
        overlay: Overlay,
        sim: Sim,
        target: { x: number; y: number },
        landTick: number,
        color: string,
        alpha: number,
        pulse: number,
        scale: number,
    ): void {
        const ctx = overlay.ctx;
        const ground = this.ground(sim, target.x, target.y);
        const base = overlay.project(target.x, ground, target.y, this.screen);
        if (!base.visible) {
            const distance = this.drawEdgeArrow(overlay, sim, target, alpha, color, pulse, scale);
            this.drawArrowLabel(overlay, `${Math.round(distance)}`, color, scale);
            return;
        }
        const grow = Math.min(1, Math.max(0, (sim.tick - landTick) / 20));
        const bx = base.x;
        const by = base.y;
        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 30 * scale);
        glow.addColorStop(0, withAlpha(color, 0.55 * pulse));
        glow.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(bx, by, 30 * scale, 13 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        if (grow <= 0) {
            return;
        }
        const top = overlay.project(
            target.x,
            ground - LOOT_BEAM_HEIGHT * grow,
            target.y,
            this.screen2,
        );
        ctx.lineCap = "round";
        const beam = ctx.createLinearGradient(bx, by, top.x, top.y);
        beam.addColorStop(0, withAlpha(color, 0.7 * pulse));
        beam.addColorStop(1, withAlpha(color, 0));
        ctx.strokeStyle = beam;
        ctx.lineWidth = 18 * scale;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        const core = ctx.createLinearGradient(bx, by, top.x, top.y);
        core.addColorStop(0, `rgba(255, 255, 255, ${0.8 * pulse})`);
        core.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.strokeStyle = core;
        ctx.lineWidth = 5 * scale;
        ctx.stroke();
    }

    // An arrow at the edge of the screen pointing at something out of view,
    // from the hero the camera's on. Returns how far away it is, and leaves
    // where to put a label for drawArrowLabel.
    private drawEdgeArrow(
        overlay: Overlay,
        sim: Sim,
        target: { x: number; y: number },
        alpha: number,
        color: string,
        pulse: number,
        scale: number,
    ): number {
        const ctx = overlay.ctx;
        const { x: px, y: py } = getPlayerPose(sim, this.viewHero, alpha, this.localPlayerPose);
        const dx = target.x - px;
        const dy = target.y - py;
        const distance = Math.hypot(dx, dy);
        this.arrowLabel = undefined;
        if (distance < 0.001) {
            return distance;
        }
        // Which way it is on screen: from the player towards it, a couple of
        // tiles along (both ends stay on screen, unlike the casket itself)
        const from = overlay.project(px, this.ground(sim, px, py), py, this.screen);
        const fromX = from.x;
        const fromY = from.y;
        const ax = px + (dx / distance) * 2;
        const ay = py + (dy / distance) * 2;
        const to = overlay.project(ax, this.ground(sim, ax, ay), ay, this.screen2);
        let dirX = to.x - fromX;
        let dirY = to.y - fromY;
        const len = Math.hypot(dirX, dirY);
        if (!from.visible || len < 0.001) {
            return distance;
        }
        dirX /= len;
        dirY /= len;
        // Out from the player to the edge of the screen, kept a little inside
        const margin = 34 * scale;
        const edgeX = dirX > 0 ? overlay.width - margin : margin;
        const edgeY = dirY > 0 ? overlay.height - margin : margin;
        const t = Math.min(
            Math.abs(dirX) > 0.001 ? (edgeX - fromX) / dirX : Infinity,
            Math.abs(dirY) > 0.001 ? (edgeY - fromY) / dirY : Infinity,
        );
        const x = fromX + dirX * t;
        const y = fromY + dirY * t;
        const size = 16 * scale * (0.9 + 0.1 * pulse);
        const angle = Math.atan2(dirY, dirX);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.7, size * 0.75);
        ctx.lineTo(-size * 0.35, 0);
        ctx.lineTo(-size * 0.7, -size * 0.75);
        ctx.closePath();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14 * scale * pulse;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000000";
        ctx.stroke();
        ctx.restore();
        this.arrowLabel = { x: x - dirX * size * 1.9, y: y - dirY * size * 1.9 };
        return distance;
    }

    // Where the last edge arrow wants its label, if it drew one
    private arrowLabel?: { x: number; y: number };

    private drawArrowLabel(overlay: Overlay, text: string, color: string, scale: number): void {
        const label = this.arrowLabel;
        if (!label) {
            return;
        }
        const ctx = overlay.ctx;
        ctx.font = `${Math.round(14 * scale)}px "OSRS Small", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#000000";
        ctx.fillText(text, label.x + 1, label.y + 1);
        ctx.fillStyle = color;
        ctx.fillText(text, label.x, label.y);
    }

    // A hero's health bar over their head, and in co-op a teammate's name
    // over that; a downed teammate just has their name, greyed
    private drawHeroBar(
        overlay: Overlay,
        sim: Sim,
        hero: Hero,
        alpha: number,
        scale: number,
    ): void {
        const player = hero.player;
        const teammate = sim.heroes.length > 1 && hero.index !== sim.focus;
        if (hero.left || (player.deathTick !== -1 && !teammate)) {
            return;
        }
        const ctx = overlay.ctx;
        const model = this.assets.getPlayer(hero.index);
        const { x: px, y: py } = getPlayerPose(sim, hero.index, alpha, this.localPlayerPose);
        // Lying down, the bar goes lower
        const height = hero.down ? 0.8 : (model?.height ?? 200) / 128;
        const top = this.ground(sim, px, py) - height - HEALTH_BAR_GAP;
        const p = overlay.project(px, top, py, this.screen);
        if (!p.visible) {
            return;
        }
        if (!hero.down) {
            drawHealthBar(ctx, p.x, p.y, scale, player.hp / player.maxHp);
        }
        if (!teammate) {
            return;
        }
        const pixel = Math.max(1, Math.round(scale));
        ctx.font = `${16 * pixel}px "OSRS Small", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const text = hero.down ? `${hero.name} (down)` : hero.name;
        const y = p.y - 7 * pixel;
        ctx.fillStyle = "#000000";
        ctx.fillText(text, p.x + pixel, y + pixel);
        ctx.fillStyle = hero.down ? TEAMMATE_DOWN_COLOR : TEAMMATE_COLOR;
        ctx.fillText(text, p.x, y);
    }

    // An arrow at the edge of the screen for each teammate still in the fight
    // and out of view, with their name
    private drawTeammateArrows(
        overlay: Overlay,
        sim: Sim,
        alpha: number,
        now: number,
        scale: number,
    ): void {
        const pulse = 0.75 + 0.25 * Math.sin(now / 180);
        for (const hero of sim.heroes) {
            if (hero.left || hero.down || hero.index === this.viewHero) {
                continue;
            }
            const { x, y } = getPlayerPose(sim, hero.index, alpha, this.localPlayerPose);
            const p = overlay.project(x, this.ground(sim, x, y), y, this.screen);
            const margin = 20 * scale;
            if (
                p.visible &&
                p.x > margin &&
                p.y > margin &&
                p.x < overlay.width - margin &&
                p.y < overlay.height - margin
            ) {
                continue;
            }
            this.drawEdgeArrow(overlay, sim, { x, y }, alpha, TEAMMATE_COLOR, pulse, scale);
            this.drawArrowLabel(overlay, hero.name, TEAMMATE_COLOR, scale);
        }
    }
}

// The client's health bar: 30 by 5 pixels, green for what's left and red for
// what's gone, no border, its top 3 pixels above the point over the head
export function drawHealthBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    fraction: number,
): void {
    const width = Math.round(30 * scale);
    const height = Math.round(5 * scale);
    const left = Math.round(x - width / 2);
    const top = Math.round(y - height * 0.6);
    let green = Math.floor(width * Math.max(0, Math.min(1, fraction)));
    // Anything left shows, however little
    if (green === 0 && fraction > 0) {
        green = 1;
    }
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(left, top, green, height);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(left + green, top, width - green, height);
}

// A hitsplat: the client's sprite with the number on it in white. If the
// sprite didn't load, a blob of its colour stands in.
function drawHitsplat(
    ctx: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement | undefined,
    x: number,
    y: number,
    pixel: number,
    amount: number,
    kind: HitsplatKind,
): void {
    // The digits themselves (not the space around them) on whole pixels so
    // they stay sharp, and the splat (scaled, so smoothed anyway) centred on
    // them
    const text = String(amount);
    const ink = ctx.measureText(text);
    const inkWidth = ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight;
    const inkHeight = ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent;
    const inkLeft = Math.round(x - inkWidth / 2);
    const inkTop = Math.round(y - inkHeight / 2);
    const centerX = inkLeft + inkWidth / 2;
    const centerY = inkTop + inkHeight / 2;
    const width = (sprite?.width ?? 24) * pixel * HITSPLAT_SPRITE_SCALE;
    const height = (sprite?.height ?? 23) * pixel * HITSPLAT_SPRITE_SCALE;
    if (sprite) {
        ctx.drawImage(sprite, centerX - width / 2, centerY - height / 2, width, height);
    } else {
        drawHitsplatBlob(ctx, centerX, centerY, width / 2, kind);
    }
    const textX = inkLeft + ink.actualBoundingBoxLeft;
    const textY = inkTop + ink.actualBoundingBoxAscent;
    ctx.fillStyle = "#000000";
    ctx.fillText(text, textX + pixel, textY + pixel);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, textX, textY);
}

// Fill and edge of the blob that stands in for a splat that didn't load
const HITSPLAT_BLOB_COLORS: Record<HitsplatKind, [string, string]> = {
    damage: ["#b0120c", "#3a0402"],
    poison: ["#1f8a12", "#063a02"],
    block: ["#1c5fd0", "#061a3a"],
};

function drawHitsplatBlob(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    kind: HitsplatKind,
): void {
    ctx.beginPath();
    const points = 9;
    for (let i = 0; i <= points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? radius : radius * 0.82;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r * 0.9;
        if (i === 0) {
            ctx.moveTo(px, py);
        } else {
            ctx.lineTo(px, py);
        }
    }
    ctx.closePath();
    ctx.fillStyle = HITSPLAT_BLOB_COLORS[kind][0];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = HITSPLAT_BLOB_COLORS[kind][1];
    ctx.stroke();
}

// Baked models are empty when the cache had nothing to draw
function hasGeometry(model: ActorModel): boolean {
    return model.height > 0 || model.radius > 0;
}

// Height above the ground (tiles) of a casket t hops into its throw
function casketHop(t: number): number {
    if (t < 0 || t >= 1.5) {
        return 0;
    }
    if (t < 1) {
        return CASKET_HOP_HEIGHT * Math.sin(Math.PI * t);
    }
    return CASKET_HOP_HEIGHT * 0.22 * Math.sin(Math.PI * (t - 1) * 2);
}

// "#rrggbb" with an alpha, for canvas gradients
function withAlpha(hex: string, alpha: number): string {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function formatTime(seconds: number): string {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export { TICKS_PER_SECOND };
