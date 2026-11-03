// Settings for how the game looks and behaves, kept in the browser like the
// sound ones
export type DisplaySettings = {
    // The camera circles the character on the title screen and the menus
    menuSpin: boolean;
    // A run pauses when the window loses focus or the tab is hidden
    pauseOnBlur: boolean;
    // The quest tracker on the HUD is open (Q, or its title, opens and shuts it)
    questTracker: boolean;
    // The damage panel under the HUD's DPS is open (Tab, or the DPS, opens
    // and shuts it)
    damagePanel: boolean;
    // Caskets are high alched as they're opened, with no casket screen
    autoAlch: boolean;
    // Joining a co-op game, your own movement shows before the host confirms
    // it. A trial for now, so it's off until a player turns it on.
    movePrediction: boolean;
    // Frames a second at most (frameCap)
    frameRate: FrameRate;
};

// auto: 60 on a touch screen, every frame the screen shows otherwise
export const FRAME_RATES = ["auto", "30", "60", "unlimited"] as const;
export type FrameRate = (typeof FRAME_RATES)[number];

// The title screen and a solo run stopped for a menu: only the scenery moves
export const MENU_FPS = 30;

// Frames a second at most for the renderer (Renderer.fpsLimit), 0 for every frame
// the browser offers. A phone's screen can refresh at 90 or 120 Hz, which is twice
// the drawing for a run that ticks 50 times a second, and heat, hence auto's 60.
// stopped: behind a solo run's menus or on the title screen (never co-op's,
// whose run goes on), where it's 30 at most.
export function frameCap(rate: FrameRate, touch: boolean, stopped: boolean): number {
    const cap = rate === "auto" ? (touch ? 60 : 0) : rate === "unlimited" ? 0 : parseInt(rate, 10);
    if (!stopped) {
        return cap;
    }
    return cap === 0 ? MENU_FPS : Math.min(cap, MENU_FPS);
}

const SETTINGS_KEY = "rune-survivors-display";

// The menu camera stands still for anyone who's asked for less motion
function getDefaults(): DisplaySettings {
    let reducedMotion = false;
    try {
        reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    return {
        menuSpin: !reducedMotion,
        pauseOnBlur: true,
        questTracker: true,
        damagePanel: false,
        autoAlch: false,
        movePrediction: false,
        frameRate: "auto",
    };
}

export function loadDisplaySettings(): DisplaySettings {
    const settings = getDefaults();
    try {
        const json = window.localStorage.getItem(SETTINGS_KEY);
        if (json) {
            const data = JSON.parse(json);
            if (typeof data.menuSpin === "boolean") {
                settings.menuSpin = data.menuSpin;
            }
            if (typeof data.pauseOnBlur === "boolean") {
                settings.pauseOnBlur = data.pauseOnBlur;
            }
            if (typeof data.questTracker === "boolean") {
                settings.questTracker = data.questTracker;
            }
            if (typeof data.damagePanel === "boolean") {
                settings.damagePanel = data.damagePanel;
            }
            if (typeof data.autoAlch === "boolean") {
                settings.autoAlch = data.autoAlch;
            }
            if (typeof data.movePrediction === "boolean") {
                settings.movePrediction = data.movePrediction;
            }
            // Saved before there was a choice: auto
            if (FRAME_RATES.includes(data.frameRate)) {
                settings.frameRate = data.frameRate;
            }
        }
    } catch (e) {}
    return settings;
}

export function saveDisplaySettings(settings: DisplaySettings): void {
    try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
}
