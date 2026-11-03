import { CSSProperties, Fragment, useEffect, useRef, useState } from "react";

import { GameClient } from "../client/GameClient";
import { ChestView } from "../client/GameStore";
import { ChestAction } from "../core/Loot";
import { BanishButton } from "./BanishButton";
import "./ChestModal.css";
import { Coins } from "./Coins";
import { ItemIcon } from "./ItemIcon";
import { KeyHint } from "./PadHint";
import { RerollButton } from "./RerollButton";

// Opening a reward casket: it drops in, rattles harder and harder while it
// glows its tier's colour, then bursts open in the item's rarity colour (rays,
// sparks, coins) and the item floats out. Then the player decides what to do
// with it. Space or a click skips ahead.
//
// The phases are timed here (ms after the casket appears) and drive the CSS
// animations through data-phase.

type Phase = "drop" | "shake" | "burst" | "reveal";

const LAND_MS = 380;
const SHAKE_MS = 520;
// The rattles come faster and faster
const RATTLE_MS = [620, 840, 1020, 1170, 1290, 1390, 1470, 1540, 1600];
const BURST_MS = 1650;
const COINS_MS = 1800;
const REVEAL_MS = 2200;
// Skipping still shows the burst, briefly
const SKIP_REVEAL_MS = 380;

// Fixed scatters, so re-renders don't move anything
function scatter(count: number, seed: number, make: (random: () => number, i: number) => object) {
    let state = seed;
    const random = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
    return Array.from({ length: count }, (_, i) => make(random, i) as CSSProperties);
}

const SPARKS = scatter(30, 7, (random, i) => ({
    "--a": `${(i / 30) * 360 + random() * 10}deg`,
    "--d": `${110 + random() * 150}px`,
    "--s": `${4 + random() * 5}px`,
    "--delay": `${Math.round(random() * 90)}ms`,
}));

// The rays behind the opened casket, as wedges from the centre of a 640 box.
// Their fade outwards is in their fill (RaySet), not a mask: a mask over
// turning layers is drawn again offscreen every frame, a big surface on a
// phone.
const RAY_BOX = 640;

// One path of wedges `width` degrees wide, every `step` from `from`, clockwise
// from the top
function rayPath(width: number, step: number, from: number): string {
    const c = RAY_BOX / 2;
    const point = (deg: number) => {
        const rad = (deg * Math.PI) / 180;
        return `${(c + c * Math.sin(rad)).toFixed(1)} ${(c - c * Math.cos(rad)).toFixed(1)}`;
    };
    let d = "";
    for (let a = from; a < from + 360; a += step) {
        d += `M${c} ${c}L${point(a)}A${c} ${c} 0 0 1 ${point(a + width)}Z`;
    }
    return d;
}

const RAYS = rayPath(6, 22.5, 0);
// Rarer items get a second, finer set turning the other way
const FINE_RAYS = rayPath(2, 30, 11);

function RaySet({ id, path, className }: { id: string; path: string; className: string }) {
    const c = RAY_BOX / 2;
    return (
        <svg className={className} viewBox={`0 0 ${RAY_BOX} ${RAY_BOX}`} aria-hidden>
            <defs>
                {/* Solid to 12% of the way to the box's corner, gone by 68% */}
                <radialGradient
                    id={id}
                    gradientUnits="userSpaceOnUse"
                    cx={c}
                    cy={c}
                    r={c * Math.SQRT2}
                >
                    <stop offset="0.12" />
                    <stop offset="0.68" stopOpacity="0" />
                </radialGradient>
            </defs>
            <path d={path} fill={`url(#${id})`} />
        </svg>
    );
}

const COIN_ARCS = scatter(10, 3, (random, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    return {
        "--x": `${side * (50 + random() * 150)}px`,
        "--peak": `${-90 - random() * 80}px`,
        "--fall": `${70 + random() * 70}px`,
        "--r": `${side * (180 + random() * 360)}deg`,
        "--delay": `${80 + Math.round(random() * 160)}ms`,
    };
});

type ActionButton = { action: ChestAction; label: string; disabled?: boolean };

function getActions(chest: ChestView): ActionButton[] {
    const alch = { action: "alch" as const, label: `High alch (${chest.alchCoins} coins)` };
    if (chest.isGear) {
        return [{ action: "take", label: "Equip" }, alch];
    }
    if (chest.instant) {
        return [{ action: "use", label: "Take" }, alch];
    }
    return [
        {
            action: "take",
            label: chest.canStash ? "Keep" : "Inventory full",
            disabled: !chest.canStash,
        },
        { action: "use", label: "Use now" },
        alch,
    ];
}

type Props = { chest: ChestView; rerolls: number; banishes: number; client: GameClient };

// Mount with key={chest.uid} so every casket gets its own animation
export function ChestModal({ chest, rerolls, banishes, client }: Props): JSX.Element {
    const [phase, setPhase] = useState<Phase>("drop");
    // Bumped by each reroll, so the new item bursts out like the first
    const [rolls, setRolls] = useState(0);
    const timers = useRef<number[]>([]);
    const opened = useRef(false);
    const actions = getActions(chest);

    const schedule = (ms: number, fn: () => void) => {
        timers.current.push(window.setTimeout(fn, ms));
    };
    const clearTimers = () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
    };
    const open = () => {
        if (!opened.current) {
            opened.current = true;
            client.playChestSound("open", chest.rarity);
            setPhase("burst");
        }
    };

    useEffect(() => {
        schedule(LAND_MS, () => client.playChestSound("land", chest.rarity));
        for (const ms of RATTLE_MS) {
            schedule(ms, () => client.playChestSound("rattle", chest.rarity));
        }
        schedule(SHAKE_MS, () => setPhase("shake"));
        schedule(BURST_MS, open);
        schedule(COINS_MS, () => client.playChestSound("coins", chest.rarity));
        schedule(REVEAL_MS, () => setPhase("reveal"));
        return clearTimers;
        // Once per casket (the component is keyed by it)
    }, []);

    // Straight to the burst, then the item
    const skip = () => {
        if (phase === "reveal") {
            return;
        }
        clearTimers();
        if (opened.current) {
            setPhase("reveal");
            return;
        }
        open();
        schedule(SKIP_REVEAL_MS, () => setPhase("reveal"));
    };

    const act = (action: ChestAction) => {
        clearTimers();
        client.resolveChest(action);
    };

    // A banished item is alched, which is the casket done
    const banish = () => {
        clearTimers();
        client.banish();
    };

    // Another item from the same casket (the client plays the burst's sound)
    const reroll = () => {
        if (client.reroll()) {
            setRolls((n) => n + 1);
            setPhase("burst");
            schedule(SKIP_REVEAL_MS, () => setPhase("reveal"));
        }
    };

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.repeat) {
                return;
            }
            const confirm = event.code === "Space" || event.code === "Enter";
            // A focused button answers Enter and Space with its own click,
            // so taking the recommended action too would answer twice (and
            // the second would land on the next casket)
            if (confirm && event.target instanceof HTMLButtonElement) {
                return;
            }
            if (phase !== "reveal") {
                if (confirm) {
                    skip();
                }
                return;
            }
            if (confirm) {
                act(chest.recommended);
            } else if (event.code === "KeyR") {
                reroll();
            } else if (event.code.startsWith("Digit")) {
                const button = actions[parseInt(event.code.slice(5)) - 1];
                if (button && !button.disabled) {
                    act(button.action);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const opening = phase === "burst" || phase === "reveal";
    const style = {
        "--tier": chest.tierColor,
        "--rarity": chest.item.rarity.color,
    } as CSSProperties;
    return (
        <div
            className="ui-modal ui-chest"
            data-phase={phase}
            data-rarity={chest.rarity}
            style={style}
            onClick={skip}
        >
            <div className="ui-chest-flash" />
            <div className="ui-chest-scene">
                <div className="ui-chest-rays">
                    <RaySet id="ui-chest-rays-fade" path={RAYS} className="ui-chest-rays-main" />
                    <RaySet
                        id="ui-chest-rays-fine-fade"
                        path={FINE_RAYS}
                        className="ui-chest-rays-fine"
                    />
                </div>
                <div className="ui-chest-halo" />
                <div className="ui-chest-shockwave" />
                <div className="ui-chest-casket">
                    <div className="ui-chest-casket-inner">
                        <ItemIcon objId={chest.casketObjId} size={110} />
                    </div>
                </div>
                {opening && (
                    <>
                        <div key={`sparks-${rolls}`} className="ui-chest-sparks">
                            {SPARKS.map((style, i) => (
                                <span key={i} style={style} />
                            ))}
                        </div>
                        {/* The coins only spill the once: a reroll doesn't add any */}
                        <div className="ui-chest-coins">
                            {COIN_ARCS.map((style, i) => (
                                <span key={i} style={style}>
                                    <ItemIcon objId={995} size={22} />
                                </span>
                            ))}
                        </div>
                        <div key={`item-${rolls}`} className="ui-chest-item">
                            <ItemIcon objId={chest.item.objId} size={92} />
                        </div>
                    </>
                )}
                {/* Drawn ahead of time so it's there when the casket opens */}
                <div className="ui-chest-preload">
                    <ItemIcon objId={chest.item.objId} size={92} />
                    <ItemIcon objId={995} size={22} />
                </div>
            </div>
            <div className="ui-chest-caption">
                {opening ? (
                    <Fragment key={rolls}>
                        <div className="ui-chest-name">{chest.item.name}</div>
                        <div className="ui-chest-rarity">{chest.item.rarity.name}!</div>
                    </Fragment>
                ) : (
                    <div className="ui-chest-casket-name">{chest.casketName}</div>
                )}
            </div>
            {phase === "reveal" && (
                <ChestCard
                    chest={chest}
                    actions={actions}
                    onAction={act}
                    rerolls={rerolls}
                    onReroll={reroll}
                    banishes={banishes}
                    onBanish={banish}
                />
            )}
            {!opening && <div className="ui-chest-hint">Space or click to open</div>}
        </div>
    );
}

function ChestCard({
    chest,
    actions,
    onAction,
    rerolls,
    onReroll,
    banishes,
    onBanish,
}: {
    chest: ChestView;
    actions: ActionButton[];
    onAction: (action: ChestAction) => void;
    rerolls: number;
    onReroll: () => void;
    banishes: number;
    onBanish: () => void;
}): JSX.Element {
    const item = chest.item;
    return (
        <div
            className="ui-panel rs-border rs-background ui-chest-card"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="ui-chest-card-head">
                <ItemIcon objId={item.objId} size={40} />
                <div className="ui-card-body">
                    <div className="ui-card-title" style={{ color: item.rarity.color }}>
                        {item.name}
                    </div>
                    <div className="ui-chest-kind">
                        {item.rarity.name} · {item.kindLabel}
                    </div>
                    {chest.upgradedFrom && (
                        <div className="ui-chest-upgraded">
                            Your {chest.upgradedFrom}, upgraded in the Armoury
                        </div>
                    )}
                </div>
                <div className="ui-chest-found">
                    Found <Coins amount={chest.coins} />
                </div>
            </div>
            <ul className="ui-chest-lines">
                {item.lines.map((line) => (
                    <li key={line}>{line}</li>
                ))}
            </ul>
            {item.set && (
                <div className={"ui-chest-set" + (item.set.active ? " ui-chest-set-on" : "")}>
                    {item.set.text}
                </div>
            )}
            {chest.isGear &&
                (chest.replaces ? (
                    <div className="ui-chest-compare">
                        <div className="ui-chest-replaces">
                            Replaces
                            <ItemIcon objId={chest.replaces.item.objId} size={22} />
                            <span style={{ color: chest.replaces.item.rarity.color }}>
                                {chest.replaces.item.name}
                            </span>
                            (alched for {chest.replaces.alchCoins} coins)
                        </div>
                        <div className="ui-chest-changes">
                            {chest.changes.map((change) => (
                                <span
                                    key={change.text}
                                    className={change.good ? "ui-good" : "ui-bad"}
                                >
                                    {change.text}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="ui-chest-compare">
                        Nothing in your {item.kindLabel.toLowerCase()} yet.
                    </div>
                ))}
            {!chest.isGear && (
                <div className="ui-chest-compare">
                    {chest.instant
                        ? "Yours the moment you take it."
                        : chest.carried > 0
                          ? `You have ${chest.carried} already; they stack.`
                          : "Kept items are used with 1-4."}
                </div>
            )}
            <div className="ui-chest-actions">
                {actions.map((button, i) => (
                    <button
                        key={button.action}
                        data-silent
                        className={
                            "ui-button" +
                            (button.action === chest.recommended ? " ui-button-go" : "")
                        }
                        disabled={button.disabled}
                        onClick={() => onAction(button.action)}
                    >
                        <KeyHint keyLabel={String(i + 1)} /> {button.label}
                    </button>
                ))}
            </div>
            <div className="ui-chest-rolls">
                <RerollButton rerolls={rerolls} onReroll={onReroll} />
                {chest.banish && (
                    <BanishButton
                        label={`Banish (${banishes} left)`}
                        title={
                            chest.banish.set
                                ? `Alch it, and no ${chest.banish.set} pieces in a casket again this run`
                                : `Alch it, and never see it in a casket again this run`
                        }
                        onBanish={onBanish}
                    />
                )}
            </div>
            {chest.queued > 0 && (
                <div className="ui-subtle ui-chest-queued">
                    {chest.queued} more {chest.queued === 1 ? "casket" : "caskets"} to open
                </div>
            )}
        </div>
    );
}
