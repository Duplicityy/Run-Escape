import { GameClient } from "../client/GameClient";
import { GameWebGLRenderer } from "./GameWebGLRenderer";

// Dev only (GameApp imports it behind import.meta.env.DEV): what each frame asks
// of the GPU and how long the CPU takes over it. In the console, or from a
// headless script: await frameProbe.sample(60). It counts at the GL calls, so it
// sees exactly what's sent, whichever code path sent it. Frame rates in headless
// Chromium come from software rendering; triangles, draws and CPU time carry over
// to a real GPU.
export type FrameSample = {
    frames: number;
    // Per frame, on average
    glCalls: number;
    subDraws: number;
    triangles: number;
    worldTriangles: number;
    actorTriangles: number;
    actors: number;
    visibleSquares: number;
    // Milliseconds of main thread time per frame
    cpu: {
        frame: number;
        update: number;
        mapManager: number;
        tick: number;
        passes: number;
        overlay: number;
    };
    memory: FrameMemory;
};

export type FrameMemory = {
    squares: number;
    geometryBytes: number;
    modelInfoBytes: number;
    actorPages: number;
    actorBytes: number;
    textureArrayBytes: number;
};

type Counters = {
    glCalls: number;
    subDraws: number;
    triangles: number;
    worldTriangles: number;
    actorTriangles: number;
    actors: number;
    visibleSquares: number;
    frame: number;
    update: number;
    mapManager: number;
    tick: number;
    passes: number;
    overlay: number;
};

function emptyCounters(): Counters {
    return {
        glCalls: 0,
        subDraws: 0,
        triangles: 0,
        worldTriangles: 0,
        actorTriangles: 0,
        actors: 0,
        visibleSquares: 0,
        frame: 0,
        update: 0,
        mapManager: 0,
        tick: 0,
        passes: 0,
        overlay: 0,
    };
}

export class FrameProbe {
    private totals = emptyCounters();
    private frames = 0;
    private onFrame?: () => void;
    // Actors draw through the actor passes, the map through the rest
    private inActors = false;

    constructor(
        readonly renderer: GameWebGLRenderer,
        readonly client: GameClient,
    ) {
        this.wrapGl();
        this.wrapRenderer();
    }

    private count(triangles: number, subDraws: number): void {
        const totals = this.totals;
        totals.glCalls++;
        totals.subDraws += subDraws;
        totals.triangles += triangles;
        if (this.inActors) {
            totals.actorTriangles += triangles;
        } else {
            totals.worldTriangles += triangles;
        }
    }

    private wrapGl(): void {
        const gl = this.renderer.gl as any;
        const elementsInstanced = gl.drawElementsInstanced.bind(gl);
        gl.drawElementsInstanced = (
            mode: number,
            count: number,
            type: number,
            offset: number,
            instances: number,
        ) => {
            if (count > 0 && instances > 0) {
                this.count((count / 3) * instances, 1);
            }
            elementsInstanced(mode, count, type, offset, instances);
        };
        const multiDraw = gl.getExtension("WEBGL_multi_draw");
        if (multiDraw) {
            const draw = multiDraw.multiDrawElementsInstancedWEBGL.bind(multiDraw);
            multiDraw.multiDrawElementsInstancedWEBGL = (
                mode: number,
                counts: Int32Array,
                countsOffset: number,
                type: number,
                offsets: Int32Array,
                offsetsOffset: number,
                instances: Int32Array,
                instancesOffset: number,
                drawCount: number,
            ) => {
                let triangles = 0;
                let subDraws = 0;
                for (let i = 0; i < drawCount; i++) {
                    const elements = counts[countsOffset + i] * instances[instancesOffset + i];
                    if (elements > 0) {
                        triangles += elements / 3;
                        subDraws++;
                    }
                }
                this.count(triangles, subDraws);
                draw(
                    mode,
                    counts,
                    countsOffset,
                    type,
                    offsets,
                    offsetsOffset,
                    instances,
                    instancesOffset,
                    drawCount,
                );
            };
        }
    }

    private timed<K extends "update" | "mapManager" | "tick" | "passes" | "overlay">(
        target: any,
        method: string,
        key: K,
    ): void {
        const original = target[method].bind(target);
        target[method] = (...args: unknown[]) => {
            const start = performance.now();
            const result = original(...args);
            this.totals[key] += performance.now() - start;
            return result;
        };
    }

    private wrapRenderer(): void {
        const renderer = this.renderer as any;
        const client = this.client as any;
        this.timed(client, "update", "update");
        this.timed(client, "drawOverlay", "overlay");
        this.timed(renderer.mapManager, "update", "mapManager");
        this.timed(renderer, "tickPass", "tick");
        for (const pass of [
            "renderOpaquePass",
            "renderOpaqueNpcPass",
            "renderTransparentPass",
            "renderTransparentNpcPass",
        ]) {
            this.timed(renderer, pass, "passes");
        }
        for (const pass of ["renderOpaqueNpcPass", "renderTransparentNpcPass"]) {
            const original = renderer[pass].bind(renderer);
            renderer[pass] = (...args: unknown[]) => {
                this.inActors = true;
                original(...args);
                this.inActors = false;
            };
        }
        const render = renderer.render.bind(renderer);
        renderer.render = (...args: unknown[]) => {
            const start = performance.now();
            render(...args);
            const totals = this.totals;
            totals.frame += performance.now() - start;
            totals.visibleSquares += renderer.mapManager.visibleMapCount;
            for (const page of renderer.actorRenderer?.pages ?? []) {
                totals.actors += page.instanceCount;
            }
            this.frames++;
            this.onFrame?.();
        };
    }

    reset(): void {
        this.totals = emptyCounters();
        this.frames = 0;
    }

    // Averages over the next `frames` frames
    sample(frames: number): Promise<FrameSample> {
        this.reset();
        return new Promise((resolve) => {
            this.onFrame = () => {
                if (this.frames < frames) {
                    return;
                }
                this.onFrame = undefined;
                resolve(this.read());
            };
        });
    }

    // What's been counted since reset(), per frame
    read(): FrameSample {
        const n = Math.max(this.frames, 1);
        const t = this.totals;
        return {
            frames: this.frames,
            glCalls: t.glCalls / n,
            subDraws: t.subDraws / n,
            triangles: t.triangles / n,
            worldTriangles: t.worldTriangles / n,
            actorTriangles: t.actorTriangles / n,
            actors: t.actors / n,
            visibleSquares: t.visibleSquares / n,
            cpu: {
                frame: t.frame / n,
                update: t.update / n,
                mapManager: t.mapManager / n,
                tick: t.tick / n,
                passes: t.passes / n,
                overlay: t.overlay / n,
            },
            memory: this.memory(),
        };
    }

    // Bytes the loaded map squares and baked actors hold on the GPU
    memory(): FrameMemory {
        const renderer = this.renderer as any;
        const memory: FrameMemory = {
            squares: 0,
            geometryBytes: 0,
            modelInfoBytes: 0,
            actorPages: 0,
            actorBytes: 0,
            textureArrayBytes: renderer.textureArray
                ? renderer.textureArray.width *
                  renderer.textureArray.height *
                  4 *
                  (renderer.textureIds.length + 1) *
                  1.33
                : 0,
        };
        for (const map of renderer.mapManager.mapSquares.values()) {
            memory.squares++;
            memory.geometryBytes += map.interleavedBuffer.byteLength + map.indexBuffer.byteLength;
            for (const key of Object.keys(map)) {
                const texture = map[key];
                if (key.startsWith("modelInfoTexture") && texture) {
                    memory.modelInfoBytes += texture.width * texture.height * 8;
                }
            }
        }
        for (const page of renderer.actorRenderer?.pages ?? []) {
            memory.actorPages++;
            memory.actorBytes += page.vertexBuffer.byteLength + page.indexBuffer.byteLength;
        }
        return memory;
    }
}
