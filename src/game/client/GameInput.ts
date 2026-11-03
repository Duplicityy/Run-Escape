import { GamePads, PadMode } from "./GamePad";
import { TouchStick } from "./GameTouch";

// Keyboard, controller and wheel input for the game. Listens on the window, so the canvas
// doesn't need focus; keys are dropped when the window loses focus.
export class GameInput {
    // Fed by TouchControls, on touch screens
    readonly stick = new TouchStick();
    // Controllers: their buttons come in as the keys they stand for (see GamePad)
    readonly pads = new GamePads();
    private padMode?: PadMode;

    private readonly down = new Set<string>();
    private wheel = 0;

    // Called once per press (not repeated while held)
    onPress?: (code: string) => void;
    // Keys the game uses that the browser would otherwise act on too (Tab
    // moving the focus, during a run)
    takesKey?: (code: string) => boolean;
    // Called when the window loses focus or the tab is hidden
    onBlur?: () => void;

    constructor(private readonly wheelTarget: HTMLElement) {
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
        window.addEventListener("blur", this.onWindowBlur);
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        wheelTarget.addEventListener("wheel", this.onWheel, { passive: false });
        this.pads.onKeyDown = (code) => this.sendKey("keydown", code);
        this.pads.onKeyUp = (code) => this.sendKey("keyup", code);
    }

    // Reads the controllers, once a frame. "run" while the player's moving,
    // "menu" with anything over the run or no run at all.
    pollPads(now: number, mode: PadMode): void {
        if (mode !== this.padMode) {
            this.padMode = mode;
            this.pads.release();
        }
        this.pads.poll(now, mode);
    }

    // As a key: the game and every screen's own keys (Escape
    // closing a window, Enter on a casket) answer it as they would the keyboard
    // From the page, not the window: handlers look at the target's closest()
    private sendKey(type: "keydown" | "keyup", code: string): void {
        document.body.dispatchEvent(
            new KeyboardEvent(type, { code, key: keyName(code), bubbles: true, cancelable: true }),
        );
    }

    dispose(): void {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        window.removeEventListener("blur", this.onWindowBlur);
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.wheelTarget.removeEventListener("wheel", this.onWheel);
        this.pads.dispose();
    }

    isDown(code: string): boolean {
        return this.down.has(code);
    }

    // Movement from WASD / arrow keys, or else a controller, or else the touch stick, as a vector of
    // length 0 or 1, x east and y north.
    getMoveVector(out: { x: number; y: number }): { x: number; y: number } {
        let x = 0;
        let y = 0;
        if (this.isDown("KeyW") || this.isDown("ArrowUp")) y += 1;
        if (this.isDown("KeyS") || this.isDown("ArrowDown")) y -= 1;
        if (this.isDown("KeyD") || this.isDown("ArrowRight")) x += 1;
        if (this.isDown("KeyA") || this.isDown("ArrowLeft")) x -= 1;
        const len = Math.hypot(x, y);
        if (len === 0) {
            this.pads.getMove(out);
            return out.x !== 0 || out.y !== 0 ? out : this.stick.getMove(out);
        }
        out.x = x / len;
        out.y = y / len;
        return out;
    }

    // Wheel steps since the last call (positive is zooming out)
    takeWheel(): number {
        const wheel = this.wheel;
        this.wheel = 0;
        return wheel;
    }

    private isTyping(event: KeyboardEvent): boolean {
        const target = event.target as HTMLElement | null;
        return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    }

    private onKeyDown = (event: KeyboardEvent) => {
        if (this.isTyping(event)) {
            return;
        }
        if (
            event.code.startsWith("Arrow") ||
            event.code === "Space" ||
            event.code === "F3" ||
            this.takesKey?.(event.code)
        ) {
            event.preventDefault();
        }
        if (!this.down.has(event.code)) {
            this.down.add(event.code);
            this.onPress?.(event.code);
        }
    };

    private onKeyUp = (event: KeyboardEvent) => {
        this.down.delete(event.code);
    };

    private onWindowBlur = () => {
        this.down.clear();
        this.onBlur?.();
    };

    private onVisibilityChange = () => {
        if (document.hidden) {
            this.down.clear();
            this.onBlur?.();
        }
    };

    private onWheel = (event: WheelEvent) => {
        event.preventDefault();
        this.wheel += Math.sign(event.deltaY);
    };
}

function keyName(code: string): string {
    if (code.startsWith("Key")) {
        return code.slice(3).toLowerCase();
    }
    if (code.startsWith("Digit")) {
        return code.slice(5);
    }
    return code;
}
