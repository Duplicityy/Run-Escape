import { describe, expect, test } from "vitest";

import type { Model } from "../../../rs/model/Model";
import { newDrawRange } from "../DrawRange";
import { FrameBuffer, SEGMENT_VERTICES, Segments } from "./ActorBakeSegments";
import { BakedSet } from "./ActorBakeTypes";

// A frame of so many vertices, as triangles of new ones, opaque then alpha
type FakeFrame = { opaque: number; alpha: number };

function fakeBuffer(): FrameBuffer & { cleared: number } {
    const buffer = {
        vertexBuf: { offset: 0, vertexIndices: new Map<number, number>() },
        indices: [] as number[],
        cleared: 0,
        addModelAnimFrame(model: Model, transparent: boolean) {
            const frame = model as unknown as FakeFrame;
            const count = transparent ? frame.alpha : frame.opaque;
            const offset = buffer.indices.length * 4;
            for (let i = 0; i < count; i++) {
                buffer.indices.push(buffer.vertexBuf.offset++);
            }
            return newDrawRange(offset, count, 1);
        },
    };
    const clear = buffer.vertexBuf.vertexIndices.clear.bind(buffer.vertexBuf.vertexIndices);
    buffer.vertexBuf.vertexIndices.clear = () => {
        buffer.cleared++;
        clear();
    };
    return buffer;
}

// Bakes anims of so many frames of these sizes, like bakeAnim does
function bake(anims: { frames: number; size: FakeFrame }[]) {
    const buffer = fakeBuffer();
    const segments = new Segments(buffer);
    const sets: BakedSet[] = [
        {
            key: "test",
            height: 0,
            radius: 0,
            reach: 0,
            anims: anims.map(({ frames, size }, seqId) => {
                const ranges = new Int32Array(frames * 4);
                const frameSegments = new Uint16Array(frames);
                for (let i = 0; i < frames; i++) {
                    ranges.set(segments.addFrame(size as unknown as Model, frames - i), i * 4);
                    frameSegments[i] = segments.current;
                }
                return {
                    seqId,
                    ranges,
                    segments: frameSegments,
                    frameLengths: new Uint16Array(frames).fill(1),
                    looping: true,
                };
            }),
        },
    ];
    // Every frame's vertices are new ones, in order
    const absolute = Array.from({ length: buffer.vertexBuf.offset }, (_, i) => i);
    const result = segments.finish(sets);
    return { ...result, absolute, anims: sets[0].anims, buffer };
}

// Every frame's indices, back as vertex numbers
function decode(result: ReturnType<typeof bake>): number[][] {
    const size = result.indices.BYTES_PER_ELEMENT;
    return result.anims.flatMap((anim) =>
        Array.from(anim.segments, (segment, frame) => {
            const base = result.segmentStarts[segment];
            const vertices: number[] = [];
            for (const part of [0, 2]) {
                const first = anim.ranges[frame * 4 + part] / size;
                const count = anim.ranges[frame * 4 + part + 1];
                for (let i = first; i < first + count; i++) {
                    vertices.push(base + result.indices[i]);
                }
            }
            return vertices;
        }),
    );
}

describe("16-bit actor bakes", () => {
    test("draw every frame's vertices, as 32-bit would", () => {
        const result = bake([
            { frames: 40, size: { opaque: 3000, alpha: 300 } },
            { frames: 7, size: { opaque: 2000, alpha: 0 } },
            { frames: 90, size: { opaque: 1500, alpha: 600 } },
        ]);
        expect(result.indices).toBeInstanceOf(Uint16Array);
        expect(result.segmentStarts.length).toBeGreaterThan(1);
        expect(decode(result).flat()).toEqual(result.absolute);
    });

    test("keep each frame inside its segment", () => {
        const result = bake([{ frames: 200, size: { opaque: 2900, alpha: 100 } }]);
        const frames = decode(result);
        const [anim] = result.anims;
        let outside = 0;
        frames.forEach((vertices, frame) => {
            const start = result.segmentStarts[anim.segments[frame]];
            outside += vertices.filter((v) => v < start || v >= start + SEGMENT_VERTICES).length;
        });
        expect(outside).toBe(0);
        expect(new Set(anim.segments).size).toBeGreaterThan(5);
    });

    test("don't split an animation that fits in a segment of its own", () => {
        const result = bake([
            { frames: 30, size: { opaque: 1500, alpha: 0 } },
            // 25,000 vertices, with 45,000 used: a new segment
            { frames: 10, size: { opaque: 2500, alpha: 0 } },
        ]);
        const walk = result.anims[1];
        expect(new Set(walk.segments).size).toBe(1);
        expect(walk.segments[0]).toBe(1);
        expect(decode(result).flat()).toEqual(result.absolute);
    });

    test("fall back to 32-bit for a frame too big for a segment", () => {
        const result = bake([
            { frames: 3, size: { opaque: 1000, alpha: 0 } },
            { frames: 2, size: { opaque: SEGMENT_VERTICES + 3, alpha: 30 } },
        ]);
        expect(result.indices).toBeInstanceOf(Uint32Array);
        expect(Array.from(result.segmentStarts)).toEqual([0]);
        expect(result.anims.every((anim) => anim.segments.every((s) => s === 0))).toBe(true);
        expect(decode(result).flat()).toEqual(result.absolute);
    });
});
