import { pixelRatio } from "../../util/DeviceUtil";
import { RenderStats } from "./RenderStats";

function resizeCanvas(canvas: HTMLCanvasElement) {
    const devicePixelRatio = pixelRatio;
    // Rounded, or a fractional ratio never matches and it resizes every frame
    const width = Math.round(canvas.offsetWidth * devicePixelRatio);
    const height = Math.round(canvas.offsetHeight * devicePixelRatio);

    if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }

    return false;
}

// How early a capped frame can be and still be drawn, for timestamps that wobble
// around the screen's refresh
const FRAME_TOLERANCE_MS = 2;

export abstract class Renderer {
    canvas: HTMLCanvasElement;
    animationId: number | undefined;
    running: boolean = false;

    // Frames a second at most; 0 for every frame the browser offers
    fpsLimit: number = 999;
    // When the next capped frame is due
    private nextFrameTime: DOMHighResTimeStamp | undefined;

    stats: RenderStats = new RenderStats();

    constructor() {
        this.canvas = document.createElement("canvas");
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.tabIndex = 0;
    }

    abstract init(): Promise<void>;

    abstract cleanUp(): void;

    start() {
        this.running = true;
        this.animationId = requestAnimationFrame(this.frameCallback);
    }

    stop() {
        this.running = false;
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        this.cleanUp();
    }

    onResize(width: number, height: number) {}

    frameCallback = (time: DOMHighResTimeStamp) => {
        try {
            const resized = resizeCanvas(this.canvas);
            if (resized) {
                this.onResize(this.canvas.width, this.canvas.height);
            }

            if (this.skipFrame(time)) {
                return;
            }

            const deltaTime = this.stats.getDeltaTime(time);

            this.stats.update(time);

            this.render(time, deltaTime, resized);

            this.onFrameEnd();
        } finally {
            if (this.running) {
                this.animationId = requestAnimationFrame(this.frameCallback);
            }
        }
    };

    // Keeps to fpsLimit on average. Frames are due on a fixed schedule rather than
    // a gap since the last one, so a 90 Hz screen capped at 60 draws two frames in
    // three (60 a second), not every other one (45).
    private skipFrame(time: DOMHighResTimeStamp): boolean {
        if (!this.fpsLimit || this.fpsLimit >= 999) {
            this.nextFrameTime = undefined;
            return false;
        }
        const interval = 1000 / this.fpsLimit;
        const next = this.nextFrameTime;
        if (next !== undefined && time < next - FRAME_TOLERANCE_MS) {
            return true;
        }
        // Behind by more than a frame (a slow frame, or a lower rate): start again
        // from now, rather than drawing a burst of frames to catch up
        this.nextFrameTime =
            next === undefined || time - next > interval ? time + interval : next + interval;
        return false;
    }

    abstract render(
        time: DOMHighResTimeStamp,
        deltaTime: DOMHighResTimeStamp,
        resized: boolean,
    ): void;

    onFrameEnd() {
        this.stats.onFrameEnd();
    }
}
