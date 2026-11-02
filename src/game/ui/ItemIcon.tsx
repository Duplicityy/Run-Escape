import { useEffect, useState } from "react";

import {
    ICON_HEIGHT,
    ICON_WIDTH,
    ItemIcon as ItemIconData,
    ItemIconInput,
    ItemIconLoader,
} from "../../mapviewer/worker/ItemIconLoader";
import { RenderDataWorkerPool } from "../../mapviewer/worker/RenderDataWorkerPool";
import {
    SpriteDataInput,
    SpriteDataLoader,
    SpriteImage,
} from "../../mapviewer/worker/SpriteDataLoader";
import { pixelRatio } from "../../util/DeviceUtil";

// Item icons are drawn in a worker from the item's model and kept as data
// URLs. Requests made in the same frame go to the worker together. Some icons
// are interface sprites instead (Piety's prayer icon), padded out to an item
// icon's size so they line up with the rest.
export class IconCache {
    private workerPool?: RenderDataWorkerPool;
    private readonly urls = new Map<string, string>();
    private readonly waiting = new Map<string, ((url: string) => void)[]>();
    private queued: { objId: number; count: number }[] = [];
    private queuedSprites: number[] = [];
    private flushScheduled = false;

    setWorkerPool(workerPool: RenderDataWorkerPool): void {
        this.workerPool = workerPool;
        this.scheduleFlush();
    }

    // Coins and other stackables have a model per stack size
    static key(objId: number, count: number): string {
        return `${objId}:${count}`;
    }

    static spriteKey(spriteId: number): string {
        return `sprite:${spriteId}`;
    }

    get(objId: number, count: number): string | undefined {
        return this.urls.get(IconCache.key(objId, count));
    }

    getSprite(spriteId: number): string | undefined {
        return this.urls.get(IconCache.spriteKey(spriteId));
    }

    request(objId: number, count: number, callback: (url: string) => void): void {
        if (this.wait(IconCache.key(objId, count), callback)) {
            this.queued.push({ objId, count });
            this.scheduleFlush();
        }
    }

    requestSprite(spriteId: number, callback: (url: string) => void): void {
        if (this.wait(IconCache.spriteKey(spriteId), callback)) {
            this.queuedSprites.push(spriteId);
            this.scheduleFlush();
        }
    }

    // Calls back now if the icon is drawn already. Otherwise whether it still
    // has to be asked for (it hasn't been yet).
    private wait(key: string, callback: (url: string) => void): boolean {
        const url = this.urls.get(key);
        if (url !== undefined) {
            callback(url);
            return false;
        }
        const callbacks = this.waiting.get(key);
        if (callbacks) {
            callbacks.push(callback);
            return false;
        }
        this.waiting.set(key, [callback]);
        return true;
    }

    private resolve(key: string, url: string): void {
        this.urls.set(key, url);
        for (const callback of this.waiting.get(key) ?? []) {
            callback(url);
        }
        this.waiting.delete(key);
    }

    private scheduleFlush(): void {
        if (
            this.flushScheduled ||
            !this.workerPool ||
            (this.queued.length === 0 && this.queuedSprites.length === 0)
        ) {
            return;
        }
        this.flushScheduled = true;
        setTimeout(() => this.flush(), 0);
    }

    private async flush(): Promise<void> {
        this.flushScheduled = false;
        const workerPool = this.workerPool;
        if (!workerPool) {
            return;
        }
        const requests = this.queued;
        this.queued = [];
        const spriteIds = this.queuedSprites;
        this.queuedSprites = [];
        let icons: ItemIconData[];
        let sprites: SpriteImage[];
        try {
            [icons, sprites] = await Promise.all([
                requests.length > 0
                    ? workerPool.queueLoad<ItemIconInput, ItemIconData[], ItemIconLoader>(
                          new ItemIconLoader(),
                          { requests },
                      )
                    : [],
                spriteIds.length > 0
                    ? workerPool.queueLoad<SpriteDataInput, SpriteImage[], SpriteDataLoader>(
                          new SpriteDataLoader(),
                          { spriteIds },
                      )
                    : [],
            ]);
        } catch (e) {
            // Nothing's left waiting on this batch (a worker that failed), so
            // the next render asks for its icons again
            console.error("Loading icons failed", e);
            for (const { objId, count } of requests) {
                this.waiting.delete(IconCache.key(objId, count));
            }
            for (const id of spriteIds) {
                this.waiting.delete(IconCache.spriteKey(id));
            }
            return;
        }
        for (const icon of icons) {
            this.resolve(IconCache.key(icon.objId, icon.count), toDataUrl(icon.pixels));
        }
        for (const sprite of sprites) {
            this.resolve(IconCache.spriteKey(sprite.id), spriteToDataUrl(sprite));
        }
    }
}

function toDataUrl(argb: Int32Array): string {
    const canvas = document.createElement("canvas");
    canvas.width = ICON_WIDTH;
    canvas.height = ICON_HEIGHT;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(ICON_WIDTH, ICON_HEIGHT);
    for (let i = 0; i < argb.length; i++) {
        const pixel = argb[i];
        image.data[i * 4] = (pixel >> 16) & 0xff;
        image.data[i * 4 + 1] = (pixel >> 8) & 0xff;
        image.data[i * 4 + 2] = pixel & 0xff;
        image.data[i * 4 + 3] = (pixel >>> 24) & 0xff;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
}

// An interface sprite in the middle of an item icon sized canvas (a missing
// sprite comes out blank)
function spriteToDataUrl(sprite: SpriteImage): string {
    const argb = new Int32Array(ICON_WIDTH * ICON_HEIGHT);
    const offsetX = Math.floor((ICON_WIDTH - sprite.width) / 2);
    const offsetY = Math.floor((ICON_HEIGHT - sprite.height) / 2);
    for (let y = 0; y < sprite.height; y++) {
        for (let x = 0; x < sprite.width; x++) {
            const toX = x + offsetX;
            const toY = y + offsetY;
            if (toX >= 0 && toX < ICON_WIDTH && toY >= 0 && toY < ICON_HEIGHT) {
                argb[toX + toY * ICON_WIDTH] = sprite.pixels[x + y * sprite.width];
            }
        }
    }
    return toDataUrl(argb);
}

export const iconCache = new IconCache();

// The stack model shown for a coin amount, like the client's
function coinStackCount(count: number): number {
    if (count >= 10000) return 10000;
    if (count >= 1000) return 1000;
    if (count >= 250) return 250;
    if (count >= 100) return 100;
    if (count >= 25) return 25;
    if (count >= 5) return 5;
    return Math.max(count, 1);
}

type Props = {
    objId: number;
    // An interface sprite to show instead of the item (Piety's prayer icon)
    spriteId?: number;
    // Display height in pixels (icons are 36x32)
    size?: number;
    count?: number;
};

export function ItemIcon({ objId, spriteId, size = 32, count = 1 }: Props): JSX.Element {
    const stack = objId === 995 ? coinStackCount(count) : 1;
    const key =
        spriteId !== undefined ? IconCache.spriteKey(spriteId) : IconCache.key(objId, stack);
    const cached = (): string | undefined =>
        spriteId !== undefined ? iconCache.getSprite(spriteId) : iconCache.get(objId, stack);
    const [loaded, setLoaded] = useState(() => ({ key, url: cached() }));
    // When the item changes (a reroll), never the last item's icon while the
    // new one is drawn
    const url = loaded.key === key ? loaded.url : cached();
    useEffect(() => {
        let cancelled = false;
        const callback = (url: string) => {
            if (!cancelled) {
                setLoaded({ key, url });
            }
        };
        if (spriteId !== undefined) {
            iconCache.requestSprite(spriteId, callback);
        } else {
            iconCache.request(objId, stack, callback);
        }
        return () => {
            cancelled = true;
        };
    }, [key, objId, stack, spriteId]);
    const width = Math.round((size * ICON_WIDTH) / ICON_HEIGHT);
    // Nearest neighbour keeps the client's crisp pixels when scaling up, but
    // scaling down that way drops whole rows and columns (and with them bits of
    // the outline), so icons shown smaller than they are get smoothed instead
    const smooth = size * pixelRatio < ICON_HEIGHT;
    return url ? (
        <img
            className={smooth ? "ui-icon ui-icon-smooth" : "ui-icon"}
            src={url}
            width={width}
            height={size}
            alt=""
            draggable={false}
        />
    ) : (
        <span className="ui-icon" style={{ width, height: size, display: "inline-block" }} />
    );
}
