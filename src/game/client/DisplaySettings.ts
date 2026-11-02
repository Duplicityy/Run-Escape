// Settings for how the game looks and behaves, kept in the browser like the
// sound ones
export type DisplaySettings = {
    // The camera circles the character on the title screen and the menus
    menuSpin: boolean;
    // A run pauses when the window loses focus or the tab is hidden
    pauseOnBlur: boolean;
    // The quest tracker on the HUD is open (Q, or its title, opens and shuts it)
    questTracker: boolean;
    // Caskets are high alched as they're opened, with no casket screen
    autoAlch: boolean;
    // Joining a co-op game, your own movement shows before the host confirms
    // it. A trial for now, so it's off until a player turns it on.
    movePrediction: boolean;
};

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
        autoAlch: false,
        movePrediction: false,
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
            if (typeof data.autoAlch === "boolean") {
                settings.autoAlch = data.autoAlch;
            }
            if (typeof data.movePrediction === "boolean") {
                settings.movePrediction = data.movePrediction;
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
