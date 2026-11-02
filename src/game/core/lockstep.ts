// Co-op runs in lockstep: every player's browser runs the same Sim, and only
// what the players do goes over the network. The host numbers the ticks
// (frames) and says what happened at each: who changed what they're pressing,
// who chose what. Everyone applies the same events at the same frames, so
// their copies of the run stay the same to the bit (see fmath.ts). No DOM
// here; client/coop sends the frames about.
import { ChestAction } from "./Loot";
import { Sim } from "./Sim";

// What a player can do besides moving
export type CoopAction =
    | { kind: "choose"; index: number }
    | { kind: "reroll" }
    | { kind: "skip" }
    | { kind: "chest"; action: ChestAction }
    | { kind: "item"; index: number }
    // A random event's offer: take one of its options, or walk away
    | { kind: "event"; index: number }
    | { kind: "leaveEvent" };

// Something that happens to a hero just before frame `frame` is stepped:
// what they're pressing now (as whole numbers, -127 to 127), what they did,
// or that they've left the game. auto: the host did it for them, as they'd
// kept everyone waiting.
export type FrameEvent = {
    frame: number;
    hero: number;
    move?: [number, number];
    // Echoed for the sender's visual prediction. Never used by the sim.
    moveSeq?: number;
    action?: CoopAction;
    auto?: true;
    leave?: true;
};

const CHEST_ACTIONS: readonly ChestAction[] = ["take", "use", "alch"];
// More than any list of choices, options or inventory slots
const MAX_INDEX = 64;

// An action as a guest sent it, made into a clean one, or undefined for
// anything that isn't one (it's applied on every copy, so nothing odd gets in)
export function cleanAction(value: unknown): CoopAction | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const { kind, index, action } = value as Record<string, unknown>;
    const isIndex = typeof index === "number" && Number.isInteger(index) && index >= 0;
    switch (kind) {
        case "choose":
        case "item":
        case "event":
            return isIndex && index < MAX_INDEX ? { kind, index } : undefined;
        case "reroll":
        case "skip":
        case "leaveEvent":
            return { kind };
        case "chest":
            return CHEST_ACTIONS.includes(action as ChestAction)
                ? { kind, action: action as ChestAction }
                : undefined;
        default:
            return undefined;
    }
}

// A move as a guest sent it, or undefined for one that isn't two numbers
export function cleanMove(value: unknown): [number, number] | undefined {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
        return undefined;
    }
    // No faster than a full stick. A real diagonal rounds a little over.
    const length = Math.sqrt(value[0] * value[0] + value[1] * value[1]);
    const scale = length > MOVE_STEPS + 2 ? MOVE_STEPS / length : 1;
    return quantizeMove((value[0] * scale) / MOVE_STEPS, (value[1] * scale) / MOVE_STEPS);
}

// An event as the host sent it, made into a clean one, or undefined for
// anything that isn't one. The host checks its guests, and each guest checks
// the host: a modified game could send anything.
export function cleanFrameEvent(value: unknown, heroCount: number): FrameEvent | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const { frame, hero, move, moveSeq, action, auto, leave } = value as Record<string, unknown>;
    if (
        !Number.isSafeInteger(frame) ||
        !Number.isInteger(hero) ||
        (hero as number) < 0 ||
        (hero as number) >= heroCount
    ) {
        return undefined;
    }
    const cleanedMove = move !== undefined ? cleanMove(move) : undefined;
    const cleanedAction = action !== undefined ? cleanAction(action) : undefined;
    if ((move !== undefined && !cleanedMove) || (action !== undefined && !cleanedAction)) {
        return undefined;
    }
    return {
        frame: frame as number,
        hero: hero as number,
        ...(cleanedMove && { move: cleanedMove }),
        ...(cleanedMove && cleanMoveSeq(moveSeq) !== undefined && { moveSeq: moveSeq as number }),
        ...(cleanedAction && { action: cleanedAction }),
        ...(auto === true && { auto }),
        ...(leave === true && { leave }),
    };
}

export function cleanMoveSeq(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

// Whether a run's result has a number that isn't one, which a save can't hold
export function hasBadNumber(value: unknown): boolean {
    if (typeof value === "number") {
        return !Number.isFinite(value);
    }
    if (value instanceof Set || value instanceof Map) {
        return [...value.values()].some(hasBadNumber);
    }
    return !!value && typeof value === "object" && Object.values(value).some(hasBadNumber);
}

const MOVE_STEPS = 127;

// A move vector as the network carries it. Everyone's copy (the host's too)
// uses this rather than what was pressed, so they all move alike.
export function quantizeMove(x: number, y: number): [number, number] {
    const q = (v: number) =>
        Math.max(-MOVE_STEPS, Math.min(MOVE_STEPS, Math.round(v * MOVE_STEPS)));
    return [q(x), q(y)];
}

export function applyFrameEvent(sim: Sim, event: FrameEvent): void {
    const { hero, move, action } = event;
    if (move) {
        sim.setInput(hero, move[0] / MOVE_STEPS, move[1] / MOVE_STEPS);
    }
    if (action) {
        sim.as(hero, () => applyAction(sim, action));
    }
    if (event.leave) {
        sim.leave(hero);
    }
}

// Returns whether it did anything (a reroll with none left doesn't)
export function applyAction(sim: Sim, action: CoopAction): boolean {
    switch (action.kind) {
        case "choose":
            if (!sim.isChoosing() || !sim.choices[action.index]) {
                return false;
            }
            sim.choose(action.index);
            return true;
        case "reroll":
            return sim.reroll();
        case "skip":
            return sim.skip();
        case "chest":
            if (sim.state !== "chest" || !sim.chest) {
                return false;
            }
            sim.resolveChest(action.action);
            return true;
        case "item":
            return sim.useItem(action.index);
        case "event":
            return sim.chooseEventOption(action.index);
        case "leaveEvent":
            if (sim.state !== "event") {
                return false;
            }
            sim.leaveEvent();
            return true;
    }
}

// A number that changes with nearly anything in the run, for the copies to
// check they still agree
export function syncHash(sim: Sim): number {
    const values = [
        sim.tick,
        sim.xp,
        sim.kills,
        sim.coins,
        sim.level,
        sim.enemies.length,
        sim.rng.position,
        sim.eventRng.position,
    ];
    for (const hero of sim.heroes) {
        values.push(
            hero.player.x,
            hero.player.y,
            hero.player.hp,
            hero.weapons.length,
            hero.buffs.length,
            hero.debuffs.length,
            hero.inventory.filter((slot) => slot).length,
            hero.chests.length,
            hero.pendingLevelUps,
            // What's in them, not only how many: two copies that picked
            // different rewards differ here
            fold([
                hero.choices,
                hero.weapons.map((weapon) => [weapon.def.id, weapon.level]),
                hero.passives,
                hero.gear,
                hero.inventory,
                hero.buffs,
            ]),
        );
    }
    let x = 0;
    let y = 0;
    let hp = 0;
    for (const enemy of sim.enemies) {
        x += enemy.x;
        y += enemy.y;
        hp += enemy.hp;
    }
    values.push(x, y, hp, sim.projectiles.length, sim.pickups.length);
    const words = new Uint32Array(new Float64Array(values).buffer);
    // FNV-1a
    let hash = 0x811c9dc5;
    for (const word of words) {
        hash = Math.imul(hash ^ word, 0x01000193) >>> 0;
    }
    return hash;
}

// FNV-1a of something as JSON, built the same way on every copy
function fold(value: unknown): number {
    const text = JSON.stringify(value) ?? "";
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
    return hash;
}
