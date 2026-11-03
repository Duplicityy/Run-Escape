import { CSSProperties, memo, useCallback, useEffect, useRef } from "react";

import { isCoarsePointer } from "../../util/DeviceUtil";
import { GameClient } from "../client/GameClient";
import { InventorySlotView, UiSnapshot } from "../client/GameStore";
import { STICK_RADIUS, SharedTaps } from "../client/GameTouch";
import { ItemIcon } from "./ItemIcon";
import "./Mobile.css";

// Too narrow for the game's layouts. Mobile.css has the same one.
const ROTATE_QUERY = "(pointer: coarse) and (orientation: portrait) and (max-width: 700px)";

// How long after clicking a tap by hand the browser's own click for it is
// ignored, for any browser that does make one
const OWN_CLICK_MS = 400;

// Clicks the taps a browser won't, as a second finger's (see SharedTaps), so a
// level up can be picked with the thumb still on the stick
function clickSharedTaps(): void {
    const taps = new SharedTaps<EventTarget>();
    let clickedAt = -Infinity;
    const isTouch = (event: PointerEvent) => event.pointerType === "touch" && event.target;
    window.addEventListener(
        "pointerdown",
        (event) => {
            if (isTouch(event)) {
                taps.down(event.pointerId, event.target!, event.clientX, event.clientY);
            }
        },
        true,
    );
    window.addEventListener("pointerup", (event) => {
        if (isTouch(event)) {
            const tapped = taps.up(event.pointerId, event.target!, event.clientX, event.clientY);
            if (tapped instanceof HTMLElement) {
                clickedAt = performance.now();
                tapped.click();
            }
        }
    });
    window.addEventListener("pointercancel", (event) => taps.cancel(event.pointerId));
    window.addEventListener(
        "click",
        (event) => {
            if (event.isTrusted && performance.now() - clickedAt < OWN_CLICK_MS) {
                event.stopPropagation();
                event.preventDefault();
            }
        },
        true,
    );
}

// Phones and tablets: no pinch or long press menu over the game. iOS ignores the
// viewport's zoom settings and needs telling.
if (isCoarsePointer) {
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("contextmenu", prevent);
    clickSharedTaps();
}

// Opened from the home screen, public/manifest.webmanifest has already done this
const INSTALLED_QUERY = "(display-mode: fullscreen), (display-mode: standalone)";

// Full screen and held sideways where the browser allows it (Android's does,
// an iPhone's doesn't). Has to be called from a tap.
export function enterFullscreen(): void {
    const page = document.documentElement;
    if (
        !isCoarsePointer ||
        document.fullscreenElement ||
        !page.requestFullscreen ||
        window.matchMedia(INSTALLED_QUERY).matches
    ) {
        return;
    }
    page.requestFullscreen({ navigationUI: "hide" })
        .then(() =>
            (screen.orientation as unknown as { lock(type: string): Promise<void> }).lock(
                "landscape",
            ),
        )
        .catch(() => {});
}

type Props = {
    inventory: InventorySlotView[];
    overlay: UiSnapshot["overlay"];
    client: GameClient;
};

// What a run needs on a touch screen. The whole screen is the stick, with the
// buttons on top. Fingers go by pointer events on the zone, so the thumb stays
// on the stick while another finger taps (a click wouldn't fire for that one,
// which is why the buttons act on the press too).
export const TouchControls = memo(function TouchControls({
    inventory,
    overlay,
    client,
}: Props): JSX.Element {
    const base = useRef<HTMLDivElement>(null);
    const knob = useRef<HTMLDivElement>(null);
    const stick = client.input.stick;

    // Every move a finger makes, so straight to the page rather than by React.
    // The UI's zoom scales this too, and pointers are in the window's pixels.
    const draw = useCallback(() => {
        if (!base.current || !knob.current) {
            return;
        }
        const style = base.current.style;
        base.current.classList.toggle("ui-stick-on", stick.active);
        style.left = stick.active ? `calc(${stick.centerX}px / var(--ui-scale))` : "";
        style.top = stick.active ? `calc(${stick.centerY}px / var(--ui-scale))` : "";
        const dx = stick.thumbX - stick.centerX;
        const dy = stick.thumbY - stick.centerY;
        knob.current.style.transform =
            `translate(calc(${dx}px / var(--ui-scale)), ` + `calc(${dy}px / var(--ui-scale)))`;
    }, [stick]);

    useEffect(() => {
        const letGo = () => {
            stick.clear();
            draw();
        };
        window.addEventListener("blur", letGo);
        return () => {
            window.removeEventListener("blur", letGo);
            letGo();
        };
    }, [stick, draw]);

    // Turned upright mid-run the game's behind the rotate notice, so it waits
    useEffect(() => {
        const upright = window.matchMedia(ROTATE_QUERY);
        const onChange = () => {
            if (upright.matches && overlay === "none") {
                client.pause();
            }
        };
        onChange();
        upright.addEventListener("change", onChange);
        return () => upright.removeEventListener("change", onChange);
    }, [client, overlay]);

    return (
        <div className="ui-touch">
            <div
                className="ui-touch-zone"
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    stick.down(e.pointerId, e.clientX, e.clientY);
                    draw();
                }}
                onPointerMove={(e) => {
                    stick.move(e.pointerId, e.clientX, e.clientY);
                    draw();
                }}
                onPointerUp={(e) => {
                    stick.up(e.pointerId);
                    draw();
                }}
                onPointerCancel={(e) => {
                    stick.up(e.pointerId);
                    draw();
                }}
            />
            <div
                ref={base}
                className="ui-stick"
                style={{ "--stick": `${STICK_RADIUS}px` } as CSSProperties}
            >
                <div ref={knob} className="ui-stick-knob" />
            </div>
            <button
                data-silent
                className="ui-touch-pause"
                aria-label="Pause"
                onPointerDown={() => {
                    client.playClick();
                    client.pause();
                }}
            />
            <div className="ui-touch-items">
                {inventory.map((slot, i) => (
                    <div key={i} className="ui-touch-item-place">
                        {slot && (
                            <button
                                data-silent
                                className="ui-touch-item"
                                style={{ borderColor: slot.item.rarity.color }}
                                aria-label={slot.item.name}
                                onPointerDown={() => client.useItem(i)}
                            >
                                <ItemIcon objId={slot.item.objId} size={36} />
                                {slot.count > 1 && (
                                    <span className="ui-inv-count">{slot.count}</span>
                                )}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});

// Shown by Mobile.css while a phone's held upright: the screens are laid out for
// a wide window, and a run shows too little to either side to be played
export function RotateNotice(): JSX.Element {
    return (
        <div className="ui-rotate">
            <div className="ui-rotate-phone" />
            <p>Turn your phone sideways to play</p>
        </div>
    );
}
