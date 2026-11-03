import { IndexType } from "../../rs/cache/IndexType";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { RenderDataLoader, RenderDataResult } from "./RenderDataLoader";
import { WorkerState } from "./RenderDataWorker";

// Interface sprites from the cache (hitsplats and the like) as ARGB images, the
// first frame of each sprite id unless another's asked for (a flag of the world
// list's).

export type SpriteImage = {
    id: number;
    width: number;
    height: number;
    // ARGB, width x height; empty when the sprite isn't in the cache
    pixels: Int32Array;
};

// frames: the frame of each sprite id, in the same order (the first, without)
export type SpriteDataInput = { spriteIds: number[]; frames?: number[] };

export function loadSpriteImage(state: WorkerState, id: number, frame: number = 0): SpriteImage {
    const empty = { id, width: 0, height: 0, pixels: new Int32Array(0) };
    const spriteIndex = state.cacheSystem.getIndex(IndexType.DAT2.sprites);
    const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, id, frame);
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) {
        return empty;
    }
    const { width, height, subWidth, subHeight, xOffset, yOffset, palette, alphas } = sprite;
    const pixels = new Int32Array(width * height);
    for (let y = 0; y < subHeight; y++) {
        for (let x = 0; x < subWidth; x++) {
            const i = x + y * subWidth;
            const index = sprite.pixels[i];
            if (index === 0) {
                continue;
            }
            const alpha = alphas ? alphas[i] : 0xff;
            pixels[x + xOffset + (y + yOffset) * width] =
                (alpha << 24) | (palette[index] & 0xffffff);
        }
    }
    return { id, width, height, pixels };
}

export class SpriteDataLoader implements RenderDataLoader<SpriteDataInput, SpriteImage[]> {
    __type = "spriteDataLoader" as const;

    init(): void {}

    async load(
        state: WorkerState,
        input: SpriteDataInput,
    ): Promise<RenderDataResult<SpriteImage[]>> {
        const sprites = input.spriteIds.map((id, i) => {
            try {
                return loadSpriteImage(state, id, input.frames?.[i] ?? 0);
            } catch (e) {
                console.error("Failed loading sprite", id, e);
                return { id, width: 0, height: 0, pixels: new Int32Array(0) };
            }
        });
        return { data: sprites, transferables: sprites.map((sprite) => sprite.pixels.buffer) };
    }

    reset(): void {}
}
