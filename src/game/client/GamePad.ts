// Controllers, through the browser's Gamepad API. It's the same in every
// browser and in the desktop game (Electron's Chromium), so nothing here is
// one browser's.
//
// A pad the browser knows the layout of reports mapping "standard": button 0
// is the bottom face button, 12 to 15 the d-pad and so on, whoever made it
// (https://w3c.github.io/gamepad/#remapping). Its buttons are only trusted
// then; on any other pad the left stick still moves, but the buttons could be
// anything, so they do nothing rather than the wrong thing. Who made it is only
// for the labels: Xbox's A is PlayStation's cross and a Switch pad's B, all in
// the same place.
//
// The buttons are turned into the keys the game already answers (see
// GameInput), so a pad can do everything the keyboard can and nothing else.
import { MoveVector } from "./GameTouch";

export type PadKind = "xbox" | "playstation" | "nintendo" | "generic";

export type PadInfo = {
    kind: PadKind;
    // Whether the buttons are on the standard layout (see above)
    standard: boolean;
    // Its name, without the browser's vendor and product numbers
    name: string;
};

// The standard layout's buttons
export const PAD = {
    south: 0,
    east: 1,
    west: 2,
    north: 3,
    leftBumper: 4,
    rightBumper: 5,
    leftTrigger: 6,
    rightTrigger: 7,
    back: 8,
    start: 9,
    leftStick: 10,
    rightStick: 11,
    up: 12,
    down: 13,
    left: 14,
    right: 15,
} as const;

export type PadButton = keyof typeof PAD;

const VENDORS: Record<string, PadKind> = {
    "045e": "xbox",
    "054c": "playstation",
    "057e": "nintendo",
};

// Chrome and Electron name a pad "DualSense Wireless Controller (STANDARD
// GAMEPAD Vendor: 054c Product: 0ce6)", Firefox "054c-0ce6-DualSense Wireless
// Controller", and an Xbox pad on Windows is "Xbox 360 Controller (XInput
// STANDARD GAMEPAD)" with no numbers at all
export function identifyPad(pad: { id: string; mapping: string }): PadInfo {
    const id = pad.id;
    const vendor = (/Vendor:\s*([0-9a-f]{4})/i.exec(id) ??
        /^([0-9a-f]{4})-[0-9a-f]{4}-/i.exec(id))?.[1];
    let kind = (vendor && VENDORS[vendor.toLowerCase()]) || undefined;
    if (!kind) {
        if (/xbox|xinput/i.test(id)) {
            kind = "xbox";
        } else if (/playstation|dualsense|dualshock|^wireless controller/i.test(id)) {
            kind = "playstation";
        } else if (/nintendo|pro controller|joy-con/i.test(id)) {
            kind = "nintendo";
        } else {
            kind = "generic";
        }
    }
    const name =
        id
            .replace(/\s*\([^)]*\)\s*$/, "")
            .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "")
            .trim() || "Controller";
    return { kind, standard: pad.mapping === "standard", name };
}

// What's printed on each button, by who made the pad. A pad that isn't one of
// the three gets Xbox's, which most other pads copy.
const LABELS: Record<PadKind, Record<PadButton, string>> = {
    xbox: {
        south: "A",
        east: "B",
        west: "X",
        north: "Y",
        leftBumper: "LB",
        rightBumper: "RB",
        leftTrigger: "LT",
        rightTrigger: "RT",
        back: "View",
        start: "Menu",
        leftStick: "LS",
        rightStick: "RS",
        up: "Up",
        down: "Down",
        left: "Left",
        right: "Right",
    },
    playstation: {
        south: "✕",
        east: "○",
        west: "□",
        north: "△",
        leftBumper: "L1",
        rightBumper: "R1",
        leftTrigger: "L2",
        rightTrigger: "R2",
        back: "Share",
        start: "Options",
        leftStick: "L3",
        rightStick: "R3",
        up: "Up",
        down: "Down",
        left: "Left",
        right: "Right",
    },
    nintendo: {
        south: "B",
        east: "A",
        west: "Y",
        north: "X",
        leftBumper: "L",
        rightBumper: "R",
        leftTrigger: "ZL",
        rightTrigger: "ZR",
        back: "−",
        start: "+",
        leftStick: "LS",
        rightStick: "RS",
        up: "Up",
        down: "Down",
        left: "Left",
        right: "Right",
    },
    generic: undefined as unknown as Record<PadButton, string>,
};
LABELS.generic = LABELS.xbox;

export function padLabel(kind: PadKind, button: PadButton): string {
    return LABELS[kind][button];
}

// During a run: the keys each button stands for. The items take the four
// shoulder buttons, as there are four slots.
const RUN_KEYS: Partial<Record<PadButton, string>> = {
    leftBumper: "Digit1",
    rightBumper: "Digit2",
    leftTrigger: "Digit3",
    rightTrigger: "Digit4",
    start: "KeyP",
    back: "Tab",
    leftStick: "KeyQ",
};

// Anywhere else (a level up, a casket, the pause menu, the menus): south
// presses the highlighted button (see the focus below), start the window's
// main one (Enter the map, Resume, a casket's best choice) wherever the
// highlight is, and these
const MENU_KEYS: Partial<Record<PadButton, string>> = {
    east: "Escape",
    west: "KeyR",
    north: "KeyX",
};

// A worn stick rests a little off centre, so more dead zone than a thumb on
// glass gets (STICK_DEAD_ZONE)
export const PAD_DEAD_ZONE = 0.25;
// A trigger counts as pressed this far down
const TRIGGER_PRESSED = 0.5;
// Moving the highlight: once at once, then after REPEAT_DELAY_MS held, every
// REPEAT_MS
const NAV_THRESHOLD = 0.6;
const REPEAT_DELAY_MS = 400;
const REPEAT_MS = 150;

// The stick as a move like the keys': length 0 or 1, x east and y north (a
// pad's y is down). Full speed in any direction outside the dead zone, as
// with the touch stick, so the sim sees nothing a keyboard couldn't give it.
export function padToMove(
    ax: number,
    ay: number,
    out: MoveVector,
    deadZone = PAD_DEAD_ZONE,
): MoveVector {
    const distance = Math.hypot(ax, ay);
    if (!(distance > deadZone)) {
        out.x = 0;
        out.y = 0;
    } else {
        out.x = ax / distance;
        out.y = ay === 0 ? 0 : -ay / distance;
    }
    return out;
}

export type Direction = "up" | "down" | "left" | "right";

type Rect = { left: number; top: number; width: number; height: number };

// Which of the rects is next in a direction from one: the nearest whose centre
// is that way, counting distance off to the side double, so going down a
// column beats jumping across. -1 when there's none.
export function nearestInDirection(from: Rect, direction: Direction, rects: Rect[]): number {
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    let best = -1;
    let bestScore = Infinity;
    rects.forEach((rect, i) => {
        const dx = rect.left + rect.width / 2 - fx;
        const dy = rect.top + rect.height / 2 - fy;
        const along =
            direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
        const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        if (along <= 1) {
            return;
        }
        const score = along + across * 2;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    });
    return best;
}

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

// What the highlight moves among: the buttons of the top window if one's
// open (a level up over the run, a notice over a menu), else the screen's
function focusLayer(): ParentNode {
    const modals = document.querySelectorAll(".ui-modal");
    return modals[modals.length - 1] ?? document;
}

function focusables(root: ParentNode): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
        if ((el as HTMLButtonElement).disabled || el.closest("[aria-hidden='true'], [inert]")) {
            return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });
}

function focusOn(el: HTMLElement): void {
    el.focus({ preventScroll: true });
    // Optional in jsdom
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

export type PadMode = "run" | "menu";

// Which pad's buttons the hints show (see PadHint.tsx): the pad in use while
// the player's on it, and only if its buttons work
let hintKind: PadKind | undefined;
const hintListeners = new Set<() => void>();
export const padHints = {
    get: (): PadKind | undefined => hintKind,
    subscribe(listener: () => void): () => void {
        hintListeners.add(listener);
        return () => hintListeners.delete(listener);
    },
};
function showHints(kind: PadKind | undefined): void {
    if (kind !== hintKind) {
        hintKind = kind;
        hintListeners.forEach((listener) => listener());
    }
}

// Reads the pads each frame. One pad's used at a time: whichever was pressed
// last, so a second pad lying there doesn't fight the one in hand.
export class GamePads {
    // The pad in use, if any
    info?: PadInfo;
    // Whether the player's on the pad now, rather than the keyboard or mouse:
    // the hints show its buttons then
    active = false;

    // Told when a pad's first used, and when the one in use goes
    onConnect?: (info: PadInfo) => void;
    onDisconnect?: (info: PadInfo) => void;
    // Told when active changes
    onActive?: (active: boolean) => void;
    // A button pressed, as the key it stands for (released with up)
    onKeyDown?: (code: string) => void;
    onKeyUp?: (code: string) => void;

    private index?: number;
    private readonly held = new Set<PadButton>();
    // Keys sent down, to send up when the button's let go (or the mode changes)
    private readonly sent = new Map<PadButton, string>();
    private readonly move: MoveVector = { x: 0, y: 0 };
    private nav?: { direction: Direction; next: number };

    constructor() {
        window.addEventListener("gamepaddisconnected", this.onPadGone);
        window.addEventListener("keydown", this.onOtherInput, true);
        window.addEventListener("pointerdown", this.onOtherInput, true);
    }

    dispose(): void {
        window.removeEventListener("gamepaddisconnected", this.onPadGone);
        window.removeEventListener("keydown", this.onOtherInput, true);
        window.removeEventListener("pointerdown", this.onOtherInput, true);
    }

    // The left stick's move (in a run), or none
    getMove(out: MoveVector): MoveVector {
        out.x = this.move.x;
        out.y = this.move.y;
        return out;
    }

    poll(now: number, mode: PadMode): void {
        const pads =
            typeof navigator !== "undefined" && navigator.getGamepads
                ? navigator.getGamepads()
                : [];
        let pad = this.index !== undefined ? pads[this.index] : null;
        // Take up whichever pad has something pressed
        for (const other of pads) {
            if (other && other.index !== this.index && other.connected && this.touched(other)) {
                this.use(other);
                pad = other;
                break;
            }
        }
        if (!pad || !pad.connected || !this.info) {
            this.move.x = 0;
            this.move.y = 0;
            return;
        }
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        const standard = this.info.standard;
        const pressed = (button: PadButton) => {
            const b = pad!.buttons[PAD[button]];
            return !!b && (b.pressed || b.value > TRIGGER_PRESSED);
        };
        const dpad = standard
            ? {
                  x: (pressed("right") ? 1 : 0) - (pressed("left") ? 1 : 0),
                  y: (pressed("down") ? 1 : 0) - (pressed("up") ? 1 : 0),
              }
            : { x: 0, y: 0 };
        if (this.touched(pad)) {
            this.setActive(true);
            // A second pad of another make taken up
            showHints(standard ? this.info.kind : undefined);
        }

        if (mode === "run") {
            this.nav = undefined;
            if (dpad.x !== 0 || dpad.y !== 0) {
                padToMove(dpad.x, dpad.y, this.move, 0);
            } else {
                padToMove(ax, ay, this.move);
            }
        } else {
            this.move.x = 0;
            this.move.y = 0;
            this.navigate(
                now,
                dpad.x || (Math.abs(ax) > NAV_THRESHOLD ? Math.sign(ax) : 0),
                dpad.y || (Math.abs(ay) > NAV_THRESHOLD ? Math.sign(ay) : 0),
            );
        }

        if (!standard) {
            return;
        }
        const keys = mode === "run" ? RUN_KEYS : MENU_KEYS;
        for (const button of Object.keys(PAD) as PadButton[]) {
            const down = pressed(button);
            if (down && !this.held.has(button)) {
                this.held.add(button);
                if (button === "south" && mode === "menu") {
                    this.confirm();
                }
                // With no main button (a level up), start is P as in a run
                const code =
                    button === "start" && mode === "menu"
                        ? this.pressMain()
                            ? undefined
                            : "KeyP"
                        : keys[button];
                if (code) {
                    this.sent.set(button, code);
                    this.onKeyDown?.(code);
                }
            } else if (!down && this.held.has(button)) {
                this.held.delete(button);
                const code = this.sent.get(button);
                if (code) {
                    this.sent.delete(button);
                    this.onKeyUp?.(code);
                }
            }
        }
    }

    // South in a menu: presses the highlighted button. With nothing
    // highlighted it's Enter (a casket's recommended choice, closing a
    // notice), and the highlight goes to the window's main button.
    private confirm(): void {
        const layer = focusLayer();
        const focused = document.activeElement;
        if (
            focused instanceof HTMLElement &&
            focused !== document.body &&
            layer.contains(focused) &&
            focusables(layer).includes(focused)
        ) {
            focused.click();
            return;
        }
        this.onKeyDown?.("Enter");
        this.onKeyUp?.("Enter");
        const items = focusables(layer);
        const main = items.find((el) => el.classList.contains("ui-button-go")) ?? items[0];
        if (main && main.isConnected) {
            focusOn(main);
        }
    }

    // Clicks the top window's main button, if it has one
    private pressMain(): boolean {
        const main = focusables(focusLayer()).find((el) => el.classList.contains("ui-button-go"));
        if (!main) {
            return false;
        }
        main.click();
        return true;
    }

    private navigate(now: number, x: number, y: number): void {
        const direction: Direction | undefined =
            y < 0 ? "up" : y > 0 ? "down" : x < 0 ? "left" : x > 0 ? "right" : undefined;
        if (!direction) {
            this.nav = undefined;
            return;
        }
        if (this.nav?.direction === direction && now < this.nav.next) {
            return;
        }
        const repeat = this.nav?.direction === direction;
        this.nav = { direction, next: now + (repeat ? REPEAT_MS : REPEAT_DELAY_MS) };
        const layer = focusLayer();
        const items = focusables(layer);
        if (items.length === 0) {
            return;
        }
        const focused = document.activeElement;
        const at = focused instanceof HTMLElement ? items.indexOf(focused) : -1;
        if (at < 0) {
            focusOn(items.find((el) => el.classList.contains("ui-button-go")) ?? items[0]);
            return;
        }
        const rects = items.map((el) => el.getBoundingClientRect());
        const next = nearestInDirection(rects[at], direction, rects);
        if (next >= 0) {
            focusOn(items[next]);
        }
    }

    // A mode change lets go of the keys held down (a trigger held as the
    // level up came stays a trigger, not a choice)
    release(): void {
        for (const code of this.sent.values()) {
            this.onKeyUp?.(code);
        }
        this.sent.clear();
    }

    private touched(pad: Gamepad): boolean {
        return (
            pad.buttons.some((b) => b.pressed || b.value > TRIGGER_PRESSED) ||
            Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > PAD_DEAD_ZONE
        );
    }

    private use(pad: Gamepad): void {
        this.release();
        // The press that wakes the first pad counts (a browser shows no pad
        // until one), but what's held on a second as it takes over doesn't
        const switching = this.index !== undefined;
        this.index = pad.index;
        this.info = identifyPad(pad);
        this.held.clear();
        for (const button of switching ? (Object.keys(PAD) as PadButton[]) : []) {
            const b = pad.buttons[PAD[button]];
            if (b && (b.pressed || b.value > TRIGGER_PRESSED)) {
                this.held.add(button);
            }
        }
        this.onConnect?.(this.info);
    }

    private setActive(active: boolean): void {
        if (this.active !== active) {
            this.active = active;
            document.documentElement.dataset.input = active ? "pad" : "";
            showHints(active && this.info?.standard ? this.info.kind : undefined);
            this.onActive?.(active);
        }
    }

    private onPadGone = (event: GamepadEvent) => {
        if (event.gamepad.index !== this.index || !this.info) {
            return;
        }
        const info = this.info;
        this.release();
        this.index = undefined;
        this.info = undefined;
        this.held.clear();
        this.move.x = 0;
        this.move.y = 0;
        this.setActive(false);
        this.onDisconnect?.(info);
    };

    // The keyboard or mouse taking over (not the keys the pad sends itself)
    private onOtherInput = (event: Event) => {
        if (event.isTrusted) {
            this.setActive(false);
        }
    };
}
