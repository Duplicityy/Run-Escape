import { useSyncExternalStore } from "react";

import { PadButton, PadKind, padHints, padLabel } from "../client/GamePad";

// The controller in use, while the player's on it (and its buttons work)
export function usePadKind(): PadKind | undefined {
    return useSyncExternalStore(padHints.subscribe, padHints.get);
}

// A key's hint, or the controller button that does the same while one's in
// use. With no button (the numbered choices: the d-pad picks those), nothing;
// with no key (a button only a controller has a shortcut for), nothing until
// one's in use.
export function KeyHint({
    keyLabel,
    pad,
    className = "ui-choice-key",
}: {
    keyLabel?: string;
    pad?: PadButton;
    className?: string;
}): JSX.Element | null {
    const kind = usePadKind();
    if (!kind) {
        return keyLabel ? <span className={className}>{keyLabel}</span> : null;
    }
    if (!pad) {
        return null;
    }
    return (
        <span className={className + " ui-pad-key"} data-pad={kind}>
            <PadIcon kind={kind} icon={pad} label={padLabel(kind, pad)} />
        </span>
    );
}

// Kenney's Input Prompts (CC0, public/input-prompts), named by our buttons,
// and "move" for the left stick. A pad of another make has Xbox's, as it has
// Xbox's labels.
export function PadIcon({
    kind,
    icon,
    label,
}: {
    kind: PadKind;
    icon: PadButton | "move";
    label: string;
}): JSX.Element {
    const folder = kind === "generic" ? "xbox" : kind;
    return (
        <img
            className="ui-pad-icon"
            src={`input-prompts/${folder}/${icon}.svg`}
            alt={label}
            title={label}
            draggable={false}
        />
    );
}

// What each button does, for the pause menu and settings while a controller's
// in use. Keep it in step with RUN_KEYS and MENU_KEYS in GamePad.ts.
const PAD_CONTROLS: { icons: (PadButton | "move")[]; text: string }[] = [
    { icons: ["move"], text: "Move (the d-pad too)" },
    {
        icons: ["leftBumper", "rightBumper", "leftTrigger", "rightTrigger"],
        text: "Use items 1 to 4",
    },
    { icons: ["start"], text: "Pause and resume; on the map screen, enter the map" },
    { icons: ["back"], text: "Show or hide the damage panel" },
    { icons: ["leftStick"], text: "Show or hide the quest tracker" },
    { icons: ["up", "down", "left", "right"], text: "Move the highlight, on menus and level ups" },
    { icons: ["south"], text: "Press what's highlighted" },
    { icons: ["east"], text: "Back, or close" },
    { icons: ["west"], text: "Reroll" },
    { icons: ["north"], text: "Skip" },
];

export function PadControls(): JSX.Element | null {
    const kind = usePadKind();
    if (!kind) {
        return null;
    }
    return (
        <div className="ui-pad-controls">
            {PAD_CONTROLS.map((row) => (
                <div key={row.text} className="ui-pad-control">
                    <span className="ui-pad-control-icons">
                        {row.icons.map((icon) => (
                            <PadIcon
                                key={icon}
                                kind={kind}
                                icon={icon}
                                label={icon === "move" ? "Left stick" : padLabel(kind, icon)}
                            />
                        ))}
                    </span>
                    <span className="ui-pad-control-text">{row.text}</span>
                </div>
            ))}
        </div>
    );
}
