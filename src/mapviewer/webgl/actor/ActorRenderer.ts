import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { Frustum } from "../../Frustum";
import { ActorBakeResult, BakedAnim } from "./ActorBakeTypes";

const DATA_WIDTH = 512;
const TEXELS_PER_INSTANCE = 2;
const FLOATS_PER_INSTANCE = TEXELS_PER_INSTANCE * 4;

// Tiles added to an actor's reach before it's culled, for the depth nudge in its
// shader and rounding
const CULL_MARGIN = 0.25;

export const NO_TINT = 0xffffff;

export class ActorAnim {
    readonly frameCount: number;
    // Client tick each frame starts at, and the total length of one loop
    readonly frameStarts: Uint32Array;
    readonly totalTicks: number;

    constructor(
        readonly seqId: number,
        readonly ranges: Int32Array,
        // Each frame's segment of its page
        readonly segments: Uint16Array,
        readonly frameLengths: Uint16Array,
        readonly looping: boolean,
    ) {
        this.frameCount = frameLengths.length;
        this.frameStarts = new Uint32Array(this.frameCount);
        let ticks = 0;
        for (let i = 0; i < this.frameCount; i++) {
            this.frameStarts[i] = ticks;
            ticks += frameLengths[i];
        }
        this.totalTicks = Math.max(ticks, 1);
    }

    // Frame shown `ticks` client ticks after the animation started. Looping
    // animations wrap; others hold their last frame.
    getFrame(ticks: number, loop: boolean = true): number {
        if (ticks < 0) {
            return 0;
        }
        if (ticks >= this.totalTicks) {
            if (!loop) {
                return this.frameCount - 1;
            }
            ticks %= this.totalTicks;
        }
        // Frames are few, a linear scan is fine
        let frame = 0;
        while (frame + 1 < this.frameCount && this.frameStarts[frame + 1] <= ticks) {
            frame++;
        }
        return frame;
    }
}

export class ActorModel {
    readonly animIndices: Map<number, number> = new Map();

    constructor(
        readonly page: ActorPage,
        readonly key: string,
        // Model units (1/128 tile)
        readonly height: number,
        readonly radius: number,
        // Furthest any frame gets from its origin
        readonly reach: number,
        readonly anims: ActorAnim[],
    ) {
        anims.forEach((anim, i) => {
            if (!this.animIndices.has(anim.seqId)) {
                this.animIndices.set(anim.seqId, i);
            }
        });
    }

    getAnim(seqId: number): ActorAnim {
        return this.anims[this.animIndices.get(seqId) ?? 0];
    }
}

export type ActorDrawOptions = {
    scale?: number;
    flash?: number;
    tint?: number;
    alpha?: number;
    silhouette?: boolean;
    // Drawn with an outline: the model this much bigger in a flat colour
    // (ActorRenderer.outlineColor) behind it
    outline?: number;
};

class InstanceList {
    count = 0;
    // Elements to draw in the alpha pass, over all of them
    alphaElements = 0;
    data = new Float32Array(64 * FLOATS_PER_INSTANCE);
    opaqueOffsets = new Int32Array(64);
    opaqueCounts = new Int32Array(64);
    alphaOffsets = new Int32Array(64);
    alphaCounts = new Int32Array(64);
    // Offset of this list's first instance in the shared data texture
    instanceOffset = 0;

    reset(): void {
        this.count = 0;
        this.alphaElements = 0;
    }

    push(
        ranges: Int32Array,
        frame: number,
        x: number,
        y: number,
        z: number,
        yaw: number,
        scale: number,
        flash: number,
        tint: number,
        alpha: number,
    ): void {
        if (this.count === this.opaqueOffsets.length) {
            this.grow(this.count * 2);
        }
        const i = this.count++;
        const r = frame * 4;
        this.opaqueOffsets[i] = ranges[r];
        this.opaqueCounts[i] = ranges[r + 1];
        this.alphaOffsets[i] = ranges[r + 2];
        this.alphaCounts[i] = ranges[r + 3];
        this.alphaElements += ranges[r + 3];

        const o = i * FLOATS_PER_INSTANCE;
        const data = this.data;
        data[o] = x;
        data[o + 1] = y;
        data[o + 2] = z;
        data[o + 3] = yaw;
        data[o + 4] = scale;
        data[o + 5] = flash;
        data[o + 6] = tint;
        data[o + 7] = alpha;
    }

    grow(capacity: number): void {
        const data = new Float32Array(capacity * FLOATS_PER_INSTANCE);
        data.set(this.data);
        this.data = data;
        const growInt = (arr: Int32Array) => {
            const next = new Int32Array(capacity);
            next.set(arr);
            return next;
        };
        this.opaqueOffsets = growInt(this.opaqueOffsets);
        this.opaqueCounts = growInt(this.opaqueCounts);
        this.alphaOffsets = growInt(this.alphaOffsets);
        this.alphaCounts = growInt(this.alphaCounts);
    }

    // Puts the instances of each frame together, in the order they came, so
    // that without multi draw each frame is one instanced draw: a crowd of one
    // enemy shares a few frames
    sortByFrame(): void {
        const n = this.count;
        if (n < 2) {
            return;
        }
        if (sortOrder.length < n) {
            sortOrder = new Int32Array(this.opaqueOffsets.length);
        }
        const order = sortOrder.subarray(0, n);
        const { opaqueOffsets, opaqueCounts, alphaOffsets, alphaCounts } = this;
        let sorted = true;
        for (let i = 0; i < n; i++) {
            order[i] = i;
            if (i > 0 && compareFrames(this, i - 1, i) > 0) {
                sorted = false;
            }
        }
        if (sorted) {
            return;
        }
        order.sort((a, b) => compareFrames(this, a, b) || a - b);

        if (sortData.length < this.data.length) {
            sortData = new Float32Array(this.data.length);
            sortInts = new Int32Array(this.opaqueOffsets.length * 4);
        }
        const data = this.data;
        for (let i = 0; i < n; i++) {
            const from = order[i];
            for (let f = 0; f < FLOATS_PER_INSTANCE; f++) {
                sortData[i * FLOATS_PER_INSTANCE + f] = data[from * FLOATS_PER_INSTANCE + f];
            }
            sortInts[i * 4] = opaqueOffsets[from];
            sortInts[i * 4 + 1] = opaqueCounts[from];
            sortInts[i * 4 + 2] = alphaOffsets[from];
            sortInts[i * 4 + 3] = alphaCounts[from];
        }
        for (let f = 0; f < n * FLOATS_PER_INSTANCE; f++) {
            data[f] = sortData[f];
        }
        for (let i = 0; i < n; i++) {
            opaqueOffsets[i] = sortInts[i * 4];
            opaqueCounts[i] = sortInts[i * 4 + 1];
            alphaOffsets[i] = sortInts[i * 4 + 2];
            alphaCounts[i] = sortInts[i * 4 + 3];
        }
    }
}

// Scratch space for sorting, shared by every list
let sortOrder = new Int32Array(64);
let sortData = new Float32Array(64 * FLOATS_PER_INSTANCE);
let sortInts = new Int32Array(64 * 4);

function compareFrames(list: InstanceList, a: number, b: number): number {
    return (
        list.opaqueOffsets[a] - list.opaqueOffsets[b] ||
        list.opaqueCounts[a] - list.opaqueCounts[b] ||
        list.alphaOffsets[a] - list.alphaOffsets[b] ||
        list.alphaCounts[a] - list.alphaCounts[b]
    );
}

// The part of a page's vertices that its 16-bit indices reach, with a vertex
// array that starts at its first vertex, and draw calls whose sub-draws are
// rewritten each frame (one per instance, like the map squares' NPC draw calls)
export class ActorSegment {
    readonly instances = new InstanceList();
    readonly silhouettes = new InstanceList();
    readonly outlines = new InstanceList();
    readonly lists = [this.instances, this.silhouettes, this.outlines];

    constructor(
        readonly vertexArray: VertexArray,
        readonly drawCall: DrawCall,
        readonly drawCallSilhouette: DrawCall,
        readonly drawCallOutline: DrawCall,
    ) {}

    setActorData(texture: Texture): void {
        this.drawCall.texture("u_actorData", texture);
        this.drawCallSilhouette.texture("u_actorData", texture);
        this.drawCallOutline.texture("u_actorData", texture);
    }
}

// One bake's geometry
export class ActorPage {
    constructor(
        readonly vertexBuffer: VertexBuffer,
        readonly indexBuffer: VertexBuffer,
        readonly segments: ActorSegment[],
    ) {}

    // Actors drawn this frame
    get instanceCount(): number {
        let count = 0;
        for (const segment of this.segments) {
            count += segment.instances.count;
        }
        return count;
    }

    delete(): void {
        for (const segment of this.segments) {
            segment.vertexArray.delete();
        }
        this.vertexBuffer.delete();
        this.indexBuffer.delete();
    }
}

// The sub-draw ranges are written straight into the draw call's arrays instead
// of going through drawRanges(), which would allocate every frame.
function ensureDrawCapacity(drawCall: DrawCall, count: number): void {
    const dc = drawCall as any;
    // Until drawRanges() is called picogl draws the whole vertex array once, and
    // its arrays start with zero instances.
    if (dc.drawCountsFromVertexArray || dc.offsets.length < count) {
        dc.drawCountsFromVertexArray = false;
        const capacity = Math.max(count, dc.offsets.length * 2, 16);
        dc.offsets = new Int32Array(capacity);
        dc.numElements = new Int32Array(capacity);
        dc.numInstances = new Int32Array(capacity).fill(1);
    }
}

export class ActorRenderer {
    pages: ActorPage[] = [];

    dataTexture: Texture;
    dataArray: Float32Array;

    private frustum?: Frustum;

    silhouetteColor = new Float32Array([0.85, 0.85, 1.0, 0.45]);
    outlineColor = new Float32Array([1.0, 0.55, 0.1, 1.0]);

    constructor(
        readonly app: PicoApp,
        readonly hasMultiDraw: boolean,
        readonly program: Program,
        readonly silhouetteProgram: Program,
        readonly textureArray: Texture,
        readonly textureMaterials: Texture,
        readonly sceneUniformBuffer: UniformBuffer,
    ) {
        this.dataArray = new Float32Array(DATA_WIDTH * 4 * 4);
        this.dataTexture = this.createDataTexture(this.dataArray);
    }

    createDataTexture(data: Float32Array): Texture {
        return this.app.createTexture2D(data, DATA_WIDTH, data.length / 4 / DATA_WIDTH, {
            internalFormat: PicoGL.RGBA32F,
            type: PicoGL.FLOAT,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
    }

    addBake(bake: ActorBakeResult): Map<string, ActorModel> {
        const app = this.app;
        const vertexBuffer = app.createInterleavedBuffer(12, bake.vertices);
        const wide = bake.indices instanceof Uint32Array;
        const indexBuffer = app.createIndexBuffer(
            wide ? PicoGL.UNSIGNED_INT : PicoGL.UNSIGNED_SHORT,
            bake.indices,
        );

        const createDrawCall = (program: Program, vertexArray: VertexArray) =>
            app
                .createDrawCall(program, vertexArray)
                .uniformBlock("SceneUniforms", this.sceneUniformBuffer)
                .texture("u_textures", this.textureArray)
                .texture("u_textureMaterials", this.textureMaterials)
                .texture("u_actorData", this.dataTexture);

        const segments = Array.from(bake.segmentStarts, (start) => {
            const vertexArray = app
                .createVertexArray()
                .vertexAttributeBuffer(0, vertexBuffer, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 3,
                    stride: 12,
                    offset: start * 12,
                    integer: true as any,
                })
                .indexBuffer(indexBuffer);
            return new ActorSegment(
                vertexArray,
                createDrawCall(this.program, vertexArray),
                createDrawCall(this.silhouetteProgram, vertexArray).uniform(
                    "u_silhouetteColor",
                    this.silhouetteColor,
                ),
                createDrawCall(this.silhouetteProgram, vertexArray).uniform(
                    "u_silhouetteColor",
                    this.outlineColor,
                ),
            );
        });
        const page = new ActorPage(vertexBuffer, indexBuffer, segments);
        this.pages.push(page);

        const models = new Map<string, ActorModel>();
        for (const set of bake.sets) {
            const anims = set.anims.map(
                (anim: BakedAnim) =>
                    new ActorAnim(
                        anim.seqId,
                        anim.ranges,
                        anim.segments,
                        anim.frameLengths,
                        anim.looping,
                    ),
            );
            models.set(
                set.key,
                new ActorModel(page, set.key, set.height, set.radius, set.reach, anims),
            );
        }
        return models;
    }

    removePage(page: ActorPage): void {
        const index = this.pages.indexOf(page);
        if (index !== -1) {
            this.pages.splice(index, 1);
            page.delete();
        }
    }

    // Actors outside the frustum aren't drawn. Models are tested as a sphere,
    // which covers every frame at any yaw.
    beginFrame(frustum?: Frustum): void {
        this.frustum = frustum;
        for (const page of this.pages) {
            for (const segment of page.segments) {
                segment.instances.reset();
                segment.silhouettes.reset();
                segment.outlines.reset();
            }
        }
    }

    // x/z in world tiles, y in world tiles with up negative (scene height / 128),
    // yaw in RS units (0 = south, 512 = west, 1024 = north, 1536 = east).
    draw(
        model: ActorModel,
        anim: ActorAnim,
        frame: number,
        x: number,
        y: number,
        z: number,
        yaw: number,
        options?: ActorDrawOptions,
    ): void {
        const scale = options?.scale ?? 1;
        if (this.frustum) {
            const biggest = scale * Math.max(options?.outline ?? 1, 1);
            const reach = (model.reach * biggest) / 128 + CULL_MARGIN;
            if (!this.frustum.intersectsSphere(x, y, z, reach)) {
                return;
            }
        }
        const flash = options?.flash ?? 0;
        const tint = options?.tint ?? NO_TINT;
        const alpha = options?.alpha ?? 1;
        const segment = model.page.segments[anim.segments[frame]];
        segment.instances.push(anim.ranges, frame, x, y, z, yaw, scale, flash, tint, alpha);
        if (options?.silhouette) {
            segment.silhouettes.push(anim.ranges, frame, x, y, z, yaw, scale, 0, NO_TINT, 1);
        }
        if (options?.outline) {
            const outlineScale = scale * options.outline;
            segment.outlines.push(anim.ranges, frame, x, y, z, yaw, outlineScale, 0, NO_TINT, 1);
        }
    }

    upload(): void {
        let total = 0;
        for (const page of this.pages) {
            for (const segment of page.segments) {
                for (const list of segment.lists) {
                    list.instanceOffset = total;
                    total += list.count;
                }
            }
        }

        const requiredFloats = total * FLOATS_PER_INSTANCE;
        if (requiredFloats > this.dataArray.length) {
            const rows = Math.ceil(requiredFloats / 4 / DATA_WIDTH);
            const capacityRows = Math.max(rows, (this.dataArray.length / 4 / DATA_WIDTH) * 2);
            this.dataArray = new Float32Array(capacityRows * DATA_WIDTH * 4);
            this.dataTexture.delete();
            this.dataTexture = this.createDataTexture(this.dataArray);
            for (const page of this.pages) {
                for (const segment of page.segments) {
                    segment.setActorData(this.dataTexture);
                }
            }
        }

        if (total === 0) {
            return;
        }

        for (const page of this.pages) {
            for (const segment of page.segments) {
                for (const list of segment.lists) {
                    if (!this.hasMultiDraw) {
                        list.sortByFrame();
                    }
                    if (list.count > 0) {
                        this.dataArray.set(
                            list.data.subarray(0, list.count * FLOATS_PER_INSTANCE),
                            list.instanceOffset * FLOATS_PER_INSTANCE,
                        );
                    }
                }
            }
        }
        this.dataTexture.data(this.dataArray);
    }

    private drawList(
        drawCall: DrawCall,
        list: InstanceList,
        offsets: Int32Array,
        counts: Int32Array,
    ): void {
        if (list.count === 0) {
            return;
        }
        drawCall.uniform("u_instanceOffset", list.instanceOffset);
        ensureDrawCapacity(drawCall, list.count);
        const dc = drawCall as any;
        if (this.hasMultiDraw) {
            dc.offsets.set(offsets.subarray(0, list.count));
            dc.numElements.set(counts.subarray(0, list.count));
            dc.numDraws = list.count;
            drawCall.draw();
        } else {
            // A real draw call each, so a run of the same frame (sortByFrame) is
            // one, instanced
            dc.numDraws = 1;
            let i = 0;
            while (i < list.count) {
                const offset = offsets[i];
                const count = counts[i];
                let end = i + 1;
                while (end < list.count && offsets[end] === offset && counts[end] === count) {
                    end++;
                }
                if (count > 0) {
                    dc.offsets[0] = offset;
                    dc.numElements[0] = count;
                    dc.numInstances[0] = end - i;
                    drawCall.uniform("u_drawId", i);
                    drawCall.draw();
                }
                i = end;
            }
            dc.numInstances[0] = 1;
        }
    }

    // Expects depth test on, blending off.
    renderOpaque(): void {
        for (const page of this.pages) {
            for (const segment of page.segments) {
                const list = segment.instances;
                this.drawList(segment.drawCall, list, list.opaqueOffsets, list.opaqueCounts);
            }
        }
    }

    // Expects blending on.
    renderAlpha(): void {
        for (const page of this.pages) {
            for (const segment of page.segments) {
                const list = segment.instances;
                if (list.alphaElements > 0) {
                    this.drawList(segment.drawCall, list, list.alphaOffsets, list.alphaCounts);
                }
            }
        }
    }

    // Draw after the opaque world and before the actors themselves: the
    // outlined actors, bigger and in a flat colour, without writing depth, so
    // the actors drawn over them leave a rim of it showing. Leaves the depth
    // state as LEQUAL with writes on.
    renderOutlines(): void {
        if (!this.pages.some((page) => page.segments.some((s) => s.outlines.count > 0))) {
            return;
        }
        this.app.depthMask(false);
        // Only the solid parts: a see-through cloud or glow outlined would be
        // a flat blob
        for (const page of this.pages) {
            for (const segment of page.segments) {
                const list = segment.outlines;
                this.drawList(segment.drawCallOutline, list, list.opaqueOffsets, list.opaqueCounts);
            }
        }
        this.app.depthMask(true);
    }

    // Draw after the opaque world and before the actors themselves: fragments
    // behind world geometry get a flat colour, so the player stays visible under
    // trees. Leaves the depth state as LEQUAL with writes on.
    renderSilhouettes(): void {
        let any = false;
        for (const page of this.pages) {
            for (const segment of page.segments) {
                any ||= segment.silhouettes.count > 0;
            }
        }
        if (!any) {
            return;
        }
        this.app.enable(PicoGL.BLEND);
        this.app.depthFunc(PicoGL.GREATER);
        this.app.depthMask(false);
        for (const page of this.pages) {
            for (const segment of page.segments) {
                const list = segment.silhouettes;
                this.drawList(
                    segment.drawCallSilhouette,
                    list,
                    list.opaqueOffsets,
                    list.opaqueCounts,
                );
            }
        }
        this.app.depthFunc(PicoGL.LEQUAL);
        this.app.depthMask(true);
        this.app.disable(PicoGL.BLEND);
    }

    delete(): void {
        for (const page of this.pages) {
            page.delete();
        }
        this.pages = [];
        this.dataTexture.delete();
    }
}
