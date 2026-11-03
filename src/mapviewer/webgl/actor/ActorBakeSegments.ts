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
export class Segments {
    // First vertex and first index of each segment
    readonly vertexStarts: number[] = [0];
    readonly indexStarts: number[] = [0];
    wide = false;

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
        const indexStart = sceneBuf.indices.length;
        let ranges = this.add(model);
        if (this.wide) {
            return ranges;
        }
        const vertices = sceneBuf.vertexBuf.offset - vertexStart;
        const used = vertexStart - this.vertexStarts[this.current];
        const whole = vertices * framesAhead;
        const full =
            used + vertices > SEGMENT_VERTICES ||
            (used > 0 && whole <= SEGMENT_VERTICES && used + whole > SEGMENT_VERTICES);
        if (full && used > 0) {
            // Again, at the start of a new segment
            sceneBuf.vertexBuf.offset = vertexStart;
            sceneBuf.indices.length = indexStart;
            this.vertexStarts.push(vertexStart);
            this.indexStarts.push(indexStart);
            ranges = this.add(model);
        }
        if (vertices > SEGMENT_VERTICES) {
            this.wide = true;
        }
        return ranges;
    }

    private add(model: Model): number[] {
        const sceneBuf = this.sceneBuf;
        // Posed vertices are rarely shared between frames, so don't let the
        // dedupe map grow over the whole bake.
        sceneBuf.vertexBuf.vertexIndices.clear();
        const opaque = sceneBuf.addModelAnimFrame(model, false);
        const alpha = sceneBuf.addModelAnimFrame(model, true);
        // Byte offsets of 32-bit indices, till the bake knows what it's in
        return [opaque[0] / 4, opaque[1], alpha[0] / 4, alpha[1]];
    }

    // The index buffer, and each anim's ranges in bytes of it
    finish(sets: BakedSet[]): { indices: Uint16Array | Uint32Array; segmentStarts: Int32Array } {
        const source = this.sceneBuf.indices;
        let indices: Uint16Array | Uint32Array;
        let segmentStarts: Int32Array;
        if (this.wide) {
            indices = new Uint32Array(source);
            segmentStarts = new Int32Array(1);
        } else {
            indices = new Uint16Array(source.length);
            const count = this.vertexStarts.length;
            for (let s = 0; s < count; s++) {
                const base = this.vertexStarts[s];
                const end = s + 1 < count ? this.indexStarts[s + 1] : source.length;
                for (let i = this.indexStarts[s]; i < end; i++) {
                    indices[i] = source[i] - base;
                }
            }
            segmentStarts = new Int32Array(this.vertexStarts);
        }
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
