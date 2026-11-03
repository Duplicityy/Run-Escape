export const checkIphone = () => {
    const u = navigator.userAgent;
    return !!u.match(/iPhone/i);
};
export const checkAndroid = () => {
    const u = navigator.userAgent;
    return !!u.match(/Android/i);
};
export const checkIpad = () => {
    const u = navigator.userAgent;
    return !!u.match(/iPad/i);
};
export const checkMobile = () => {
    const u = navigator.userAgent;
    return !!u.match(/Android/i) || !!u.match(/iPhone/i);
};

export function checkIos() {
    // iPad on iOS 13 detection
    const isIpad = navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints >= 1;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || isIpad;
}

export const isIos = checkIos();

export const isWallpaperEngine = !!window.wallpaperRegisterAudioListener;

export const isTouchDevice = !!(
    navigator.maxTouchPoints || "ontouchstart" in document.documentElement
);

export const isWebGL2Supported = !!document.createElement("canvas").getContext("webgl2");

export const isWebGPUSupported = "gpu" in navigator;

// A finger is the main pointer: a phone or tablet, not a laptop with a touch screen
export const isCoarsePointer = !!window.matchMedia?.("(pointer: coarse)").matches;

// Phones report 3 or so, and filling that many pixels costs far more than it
// shows on a screen this small
const MAX_TOUCH_PIXEL_RATIO = 1.5;
// A desktop at 250% (a 4K laptop) would fill 9 million pixels a frame, often on
// a laptop's own GPU, for little that shows over twice a CSS pixel
const MAX_PIXEL_RATIO = 2;

export const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    isCoarsePointer ? MAX_TOUCH_PIXEL_RATIO : MAX_PIXEL_RATIO,
);
