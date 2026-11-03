import type { Model } from "../../../rs/model/Model";
import type { DrawRange } from "../DrawRange";
import type { BakedSet } from "./ActorBakeTypes";

// What of SceneBuffer a bake adds frames with
export type FrameBuffer = {
    vertexBuf: { offset: number; vertexIndices: Map<number, number> };
    indices: number[];
    addModelAnimFrame(model: Model, transparent: boolean): DrawRange;
};

// How many vertices a segment's 16-bit indices reach
export const SEGMENT_VERTICES = 0x10000;

// Cuts a bake's vertices into segments that 16-bit indices reach, a frame at a
// time: a frame that won't fit in what's left of a segment starts the next one.
// Half the index buffer of 32-bit, which is about half of a bake. A model with
// more vertices in one frame than that has the whole bake fall back to 32-bit.
// Each frame's indices move out of the scene buffer's plain array as soon as
// it's added, so a big model's bake doesn't hold them twice.
export class Segments {
    // First vertex and first index of each segment
    readonly vertexStarts: number[] = [0];
    readonly indexStarts: number[] = [0];
    wide = false;
    // The indices so far: from their segment's first vertex, or from the
    // first vertex once wide
    private indices: Uint16Array | Uint32Array = new Uint16Array(0x10000);
    private count = 0;

    constructor(readonly sceneBuf: FrameBuffer) {}

    get current(): number {
        return this.vertexStarts.length - 1;
    }

    // Adds a frame's opaque and alpha faces, as [first index, index count]
    // each. framesAhead: the frames of its animation still to come, counting
    // this one. An animation that fits in a segment of its own isn't split
    // over two, so a crowd playing it draws from the one segment.
    addFrame(model: Model, framesAhead: number): number[] {
        const sceneBuf = this.sceneBuf;
        const vertexStart = sceneBuf.vertexBuf.offset;
        let ranges = this.add(model);
        const vertices = sceneBuf.vertexBuf.offset - vertexStart;
        if (!this.wide) {
            const used = vertexStart - this.vertexStarts[this.current];
            const whole = vertices * framesAhead;
            const full =
                used + vertices > SEGMENT_VERTICES ||
                (used > 0 && whole <= SEGMENT_VERTICES && used + whole > SEGMENT_VERTICES);
            if (full && used > 0) {
                // Again, at the start of a new segment
                sceneBuf.vertexBuf.offset = vertexStart;
                this.vertexStarts.push(vertexStart);
                this.indexStarts.push(this.count);
                ranges = this.add(model);
            }
            if (vertices > SEGMENT_VERTICES) {
                this.widen();
            }
        }
        this.take(this.wide ? 0 : this.vertexStarts[this.current]);
        return ranges;
    }

    private add(model: Model): number[] {
        const sceneBuf = this.sceneBuf;
        sceneBuf.indices.length = 0;
        // Posed vertices are rarely shared between frames, so don't let the
        // dedupe map grow over the whole bake.
        sceneBuf.vertexBuf.vertexIndices.clear();
        const opaque = sceneBuf.addModelAnimFrame(model, false);
        const alpha = sceneBuf.addModelAnimFrame(model, true);
        // Counted in indices, till the bake knows how big they are
        return [this.count + opaque[0] / 4, opaque[1], this.count + alpha[0] / 4, alpha[1]];
    }

    // Moves the frame's indices out of the scene buffer, counted from base
    private take(base: number): void {
        const source = this.sceneBuf.indices;
        if (this.count + source.length > this.indices.length) {
            const size = Math.max(this.indices.length * 2, this.count + source.length);
            const grown = this.wide ? new Uint32Array(size) : new Uint16Array(size);
            grown.set(this.indices.subarray(0, this.count));
            this.indices = grown;
        }
        for (let i = 0; i < source.length; i++) {
            this.indices[this.count + i] = source[i] - base;
        }
        this.count += source.length;
        source.length = 0;
    }

    // Over to 32-bit, counted from the first vertex
    private widen(): void {
        const wide = new Uint32Array(Math.max(this.indices.length, 0x10000));
        const segments = this.vertexStarts.length;
        for (let s = 0; s < segments; s++) {
            const base = this.vertexStarts[s];
            const end = s + 1 < segments ? this.indexStarts[s + 1] : this.count;
            for (let i = this.indexStarts[s]; i < end; i++) {
                wide[i] = this.indices[i] + base;
            }
        }
        this.indices = wide;
        this.wide = true;
    }

    // The index buffer, and each anim's ranges in bytes of it
    finish(sets: BakedSet[]): { indices: Uint16Array | Uint32Array; segmentStarts: Int32Array } {
        const indices = this.indices.slice(0, this.count);
        const segmentStarts = this.wide ? new Int32Array(1) : new Int32Array(this.vertexStarts);
        const size = indices.BYTES_PER_ELEMENT;
        for (const set of sets) {
            for (const anim of set.anims) {
                for (let i = 0; i < anim.ranges.length; i += 2) {
                    anim.ranges[i] *= size;
                }
                if (this.wide) {
                    anim.segments.fill(0);
                }
            }
        }
        return { indices, segmentStarts };
    }
}
