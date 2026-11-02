import { MapViewer } from "../../mapviewer/MapViewer";
import { pixelRatio } from "../../util/DeviceUtil";
import { CASKETS } from "../content/items";
import { POWER_UP_COLOR, getPowerUp } from "../content/powerups";
import { VISITOR_COLOR } from "../content/randomEvents";
import { MapDef } from "../content/types";
import { Sim } from "../core/Sim";
import { PlayerPose, getPlayerPose } from "./PlayerPose";

const MAP_SQUARE_SIZE = 64;
// The client's minimap images have this many pixels a tile
const IMAGE_TILE_PIXELS = 4;
// The minimap shows a little more than the client's, out to where enemies
// come from (CSS pixels a tile, before the UI's zoom)
const TILE_PIXELS = 3;
// A map square's image of another plane that didn't come is asked for again
// after this long
const PLANE_IMAGE_RETRY_MS = 2000;
// An arena with more map squares a side than this keeps a coarser picture, and only
// asks for the images near the player: the workers have the scenery to load
const BIG_ARENA_SQUARES = 8;
const BIG_ARENA_TILE_PIXELS = 1;
const BIG_ARENA_IMAGE_REACH = 2;

// Dots: yellow for enemies like the client's NPC dots (orange and bigger for
// elites), red for bosses, white for the player
const ENEMY_COLOR = "#ffff00";
const ELITE_COLOR = "#ffa020";
const BOSS_COLOR = "#ff3030";
const PLAYER_COLOR = "#ffffff";
// Co-op teammates, green like friends on the client's minimap
const TEAMMATE_COLOR = "#00ff80";

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// The OSRS minimap, north up: the map from above (the client's own minimap
// images, which the map viewer renders off the main thread and caches), the
// player in the middle and dots for what's around. Bosses, caskets and
// power-ups further away than it shows sit on its rim, pointing the way.
export class Minimap {
    private map?: MapDef;
    // The whole arena at tilePixels, filled in as map squares come in
    private background?: HTMLCanvasElement;
    private tilePixels = IMAGE_TILE_PIXELS;
    private big = false;
    // The map square the player's on
    private playerMapX = 0;
    private playerMapY = 0;
    private readonly loaded = new Set<number>();
    private readonly loading = new Set<number>();
    // Images of other planes than the ground floor's, which the map viewer
    // doesn't keep (it has plane 0's), by map square
    private readonly planeImages = new Map<number, string>();
    private readonly planeImagesAsked = new Set<number>();

    constructor(readonly mapViewer: MapViewer) {}

    setMap(map: MapDef): void {
        if (this.map === map) {
            return;
        }
        this.map = map;
        const background = document.createElement("canvas");
        const squares = Math.max(map.arena.sizeX, map.arena.sizeY) / MAP_SQUARE_SIZE;
        this.big = squares > BIG_ARENA_SQUARES;
        this.tilePixels = this.big ? BIG_ARENA_TILE_PIXELS : IMAGE_TILE_PIXELS;
        background.width = map.arena.sizeX * this.tilePixels;
        background.height = map.arena.sizeY * this.tilePixels;
        this.background = background;
        this.loaded.clear();
        this.loading.clear();
        for (const url of this.planeImages.values()) {
            URL.revokeObjectURL(url);
        }
        this.planeImages.clear();
        this.planeImagesAsked.clear();
        // Asked for straight away, so they're drawn ahead of the scenery the
        // run is about to load (they share the render workers): asked for at
        // the first frame instead, they queue behind it, and a busy map
        // (Prifddinas) shows a black minimap for the run's first seconds
        this.loadImages();
    }

    // A map square's image, as the map's plane looks from above; undefined
    // while it's on its way
    private getImageUrl(mapX: number, mapY: number, id: number): string | undefined {
        const plane = this.map?.plane ?? 0;
        if (plane === 0) {
            return this.mapViewer.getMapImageUrl(mapX, mapY, false);
        }
        if (!this.planeImagesAsked.has(id)) {
            this.planeImagesAsked.add(id);
            // Each setMap makes a new background, so this tells an answer for
            // the map shown from one for an earlier visit to it
            const background = this.background;
            const failed = () => {
                // Asked again a little later
                setTimeout(() => {
                    if (this.background === background) {
                        this.planeImagesAsked.delete(id);
                    }
                }, PLANE_IMAGE_RETRY_MS);
            };
            this.mapViewer.workerPool.queueMapImage(mapX, mapY, plane, true).then(
                (data) => {
                    if (this.background !== background) {
                        return;
                    }
                    if (!data) {
                        failed();
                        return;
                    }
                    const old = this.planeImages.get(id);
                    if (old) {
                        URL.revokeObjectURL(old);
                    }
                    this.planeImages.set(id, URL.createObjectURL(data.minimapBlob));
                },
                (e) => {
                    console.error("Failed to draw the map image of", mapX, mapY, plane, e);
                    failed();
                },
            );
        }
        return this.planeImages.get(id);
    }

    // Asks for the arena's map square images until they're all in
    private loadImages(): void {
        const map = this.map;
        const background = this.background;
        if (!map || !background) {
            return;
        }
        const { baseX, baseY, sizeX, sizeY } = map.arena;
        const firstX = Math.floor(baseX / MAP_SQUARE_SIZE);
        const firstY = Math.floor(baseY / MAP_SQUARE_SIZE);
        const lastX = Math.ceil((baseX + sizeX) / MAP_SQUARE_SIZE) - 1;
        const lastY = Math.ceil((baseY + sizeY) / MAP_SQUARE_SIZE) - 1;
        if (this.loaded.size === (lastX - firstX + 1) * (lastY - firstY + 1)) {
            return;
        }
        for (let mapX = firstX; mapX <= lastX; mapX++) {
            for (let mapY = firstY; mapY <= lastY; mapY++) {
                const id = (mapX << 8) | mapY;
                if (this.loaded.has(id) || this.loading.has(id)) {
                    continue;
                }
                const away = Math.max(
                    Math.abs(mapX - this.playerMapX),
                    Math.abs(mapY - this.playerMapY),
                );
                if (this.big && away > BIG_ARENA_IMAGE_REACH) {
                    continue;
                }
                const url = this.getImageUrl(mapX, mapY, id);
                if (!url) {
                    continue;
                }
                this.loading.add(id);
                const image = new Image();
                image.onload = () => {
                    if (this.background !== background) {
                        // Gone to another map meanwhile
                        return;
                    }
                    // The images have north at the top
                    const pixels = this.tilePixels;
                    background
                        .getContext("2d")!
                        .drawImage(
                            image,
                            (mapX * MAP_SQUARE_SIZE - baseX) * pixels,
                            (baseY + sizeY - (mapY + 1) * MAP_SQUARE_SIZE) * pixels,
                            MAP_SQUARE_SIZE * pixels,
                            MAP_SQUARE_SIZE * pixels,
                        );
                    this.loaded.add(id);
                    this.loading.delete(id);
                };
                image.onerror = () => this.loading.delete(id);
                image.src = url;
            }
        }
    }

    // Centred on this hero (the camera's)
    draw(
        canvas: HTMLCanvasElement,
        sim: Sim,
        alpha: number,
        viewHero = sim.focus,
        predicted?: PlayerPose,
    ): void {
        const viewed = getPlayerPose(sim, viewHero, alpha, predicted);
        this.playerMapX = Math.floor(viewed.x / MAP_SQUARE_SIZE);
        this.playerMapY = Math.floor(viewed.y / MAP_SQUARE_SIZE);
        this.loadImages();
        // Its size on screen, after the UI's zoom (clientWidth is before it)
        const size = Math.round(canvas.getBoundingClientRect().width * pixelRatio);
        if (size === 0 || canvas.clientWidth === 0) {
            return;
        }
        // Screen pixels to a CSS pixel of the minimap
        const pixel = size / canvas.clientWidth;
        if (canvas.width !== size || canvas.height !== size) {
            canvas.width = size;
            canvas.height = size;
        }
        const ctx = canvas.getContext("2d")!;
        const half = size / 2;
        const scale = TILE_PIXELS * pixel;
        const { x: px, y: py } = viewed;
        // World tiles to minimap pixels
        const toX = (x: number) => half + (x - px) * scale;
        const toY = (y: number) => half - (y - py) * scale;

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, size, size);
        const map = this.map;
        if (map && this.background) {
            const { baseX, baseY, sizeX, sizeY } = map.arena;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(
                this.background,
                toX(baseX),
                toY(baseY + sizeY),
                sizeX * scale,
                sizeY * scale,
            );
        }

        // A tile's worth, at least a couple of pixels
        const dot = Math.max(2, Math.round(scale));
        const outline = Math.max(1, Math.round(pixel));
        const bosses = [];
        for (const enemy of sim.enemies) {
            if (enemy.dead) {
                continue;
            }
            if (enemy.boss) {
                bosses.push(enemy);
                continue;
            }
            const x = toX(lerp(enemy.prevX, enemy.x, alpha));
            const y = toY(lerp(enemy.prevY, enemy.y, alpha));
            if (enemy.elite) {
                drawDot(ctx, x, y, Math.round(dot * 1.6), outline, ELITE_COLOR);
            } else {
                drawDot(ctx, x, y, dot, outline, ENEMY_COLOR);
            }
        }
        for (const pickup of sim.pickups) {
            let color: string;
            if (pickup.kind === "casket" && pickup.tier) {
                color = CASKETS[pickup.tier].color;
            } else if (pickup.kind === "powerUp") {
                color = getPowerUp(pickup.powerUp ?? "").color ?? POWER_UP_COLOR;
            } else {
                continue;
            }
            const marker = Math.round(dot * 1.6);
            const [x, y] = onRim(half, toX(pickup.x), toY(pickup.y), marker + outline * 2);
            drawDot(ctx, x, y, marker, outline, color);
        }
        if (sim.visitor) {
            const marker = Math.round(dot * 1.6);
            const { x: vx, y: vy } = sim.visitor;
            const [x, y] = onRim(half, toX(vx), toY(vy), marker + outline * 2);
            drawDot(ctx, x, y, marker, outline, VISITOR_COLOR);
        }
        for (const boss of bosses) {
            const marker = Math.round(dot * 2.4);
            const [x, y] = onRim(
                half,
                toX(lerp(boss.prevX, boss.x, alpha)),
                toY(lerp(boss.prevY, boss.y, alpha)),
                marker + outline * 2,
            );
            drawDot(ctx, x, y, marker, outline, BOSS_COLOR);
        }
        for (const hero of sim.heroes) {
            if (hero.index === viewHero || hero.left) {
                continue;
            }
            const marker = Math.round(dot * 1.4);
            const [x, y] = onRim(
                half,
                toX(lerp(hero.player.prevX, hero.player.x, alpha)),
                toY(lerp(hero.player.prevY, hero.player.y, alpha)),
                marker + outline * 2,
            );
            drawDot(ctx, x, y, marker, outline, TEAMMATE_COLOR);
        }
        drawDot(ctx, half, half, Math.round(dot * 1.4), outline, PLAYER_COLOR);
    }
}

// A square dot with a dark edge, on whole pixels
function drawDot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    outline: number,
    color: string,
): void {
    const left = Math.round(x - size / 2);
    const top = Math.round(y - size / 2);
    ctx.fillStyle = "#000000";
    ctx.fillRect(left - outline, top - outline, size + outline * 2, size + outline * 2);
    ctx.fillStyle = color;
    ctx.fillRect(left, top, size, size);
}

// Where to draw something: where it is, or on the rim of the round minimap
// (inset by margin) in its direction when it's further out
function onRim(half: number, x: number, y: number, margin: number): [number, number] {
    const dx = x - half;
    const dy = y - half;
    const distance = Math.hypot(dx, dy);
    const max = half - margin;
    if (distance <= max) {
        return [x, y];
    }
    return [half + (dx / distance) * max, half + (dy / distance) * max];
}
