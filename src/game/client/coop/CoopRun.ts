import { Sim } from "../../core/Sim";
import {
    CoopAction,
    FrameEvent,
    applyFrameEvent,
    cleanAction,
    cleanFrameEvent,
    cleanMove,
    cleanMoveSeq,
    quantizeMove,
    syncHash,
} from "../../core/lockstep";
import { MovementPrediction } from "./MovementPrediction";
import { DownMessage, UpMessage } from "./protocol";

// How often the host sends a check of its run, in frames
const HASH_FRAMES = 50;
// The host sends the frames that pass with nothing in them this many at a
// time (25 messages a second instead of 50), and anything with an event in
// it straight away
const QUIET_FRAMES = 2;
// A guest keeps about this many frames in hand, so a late message from the
// host doesn't stop it; with more than that it catches up
export const GUEST_BUFFER_FRAMES = 4;
// The host waits this long at most for everyone's map to load
const LOAD_WAIT_MS = 20_000;
// A move goes out this often at most: a touch stick changes nearly every
// frame, and each one sent is a message from the host to everyone
const MOVE_INTERVAL_MS = 66;
// Someone the run's waited on this long (a hidden tab, gone to make tea) has
// it decided for them: the first reward, taking the casket, or walking away
export const DECIDE_AFTER_MS = 20_000;
// The most a hero's actions can queue for one frame. It's more than a player
// can do, and with moves kept to the latest it keeps what the host sends small
// however much a guest sends while it waits.
const MAX_QUEUED_ACTIONS = 8;

export type CoopLink = {
    sendUp(message: UpMessage): void;
    sendDown(message: DownMessage): void;
};

// Plays a co-op run in lockstep (see core/lockstep.ts). The host steps when
// it likes and says what happened at each frame; a guest steps only as far as
// the host has said, sending what its player does to the host to go in.
export class CoopRun {
    // A guest's, while it's turned on (setPrediction)
    prediction?: MovementPrediction;
    // Frames stepped
    frame = 0;
    // The frames that are out (for a guest, what the host has sent so far)
    private upTo = 0;
    // A guest's events from the host still to apply, in order
    private incoming: FrameEvent[] = [];
    // The host's events for the next frame, and those to send
    private next: FrameEvent[] = [];
    private outgoing: FrameEvent[] = [];
    private outgoingHash?: [number, number];
    // The host's: the frames it's said are out
    private sentUpTo = 0;
    // A guest's checks from the host still to compare
    private hashes = new Map<number, number>();
    private lastMove: [number, number] = [0, 0];
    private moveSentAt = -Infinity;
    private moveSeqSent = 0;
    // The host's: since when the run's been waiting on each hero
    private readonly waitingSince = new Map<number, number>();
    // The copies have gone apart (it's said once)
    desynced = false;
    // The host's: the guests whose map is still loading, and since when
    private readonly loading: Set<string>;
    private readonly loadStart: number;

    constructor(
        readonly sim: Sim,
        readonly isHost: boolean,
        private readonly link: CoopLink,
        // Hero index by player id
        private readonly heroes: Map<string, number>,
        // The host's own id
        hostId: string,
        private readonly now: () => number = Date.now,
    ) {
        this.loading = new Set(isHost ? [...heroes.keys()].filter((id) => id !== hostId) : []);
        this.loadStart = now();
        if (!isHost) {
            this.prediction = new MovementPrediction(sim, now);
        }
    }

    // A guest's: whether its own movement is predicted on screen. Off, it sends
    // and shows only what the host confirms. Back on, it starts afresh.
    setPrediction(on: boolean): void {
        if (this.isHost || on === (this.prediction !== undefined)) {
            return;
        }
        this.prediction = on ? new MovementPrediction(this.sim, this.now) : undefined;
        this.moveSeqSent = 0;
    }

    // The host's: this hero's move or action for the next frame, with the
    // latest move replacing one that's waiting
    private queue(event: FrameEvent): void {
        if (event.move) {
            const waiting = this.next.find((e) => e.hero === event.hero && e.move);
            if (waiting) {
                waiting.move = event.move;
                waiting.moveSeq = event.moveSeq;
                return;
            }
        } else if (
            this.next.filter((e) => e.hero === event.hero && e.action).length >= MAX_QUEUED_ACTIONS
        ) {
            return;
        }
        this.next.push(event);
    }

    // The host's: whether it's still waiting for someone's map to load
    get waitingForLoad(): boolean {
        if (this.loading.size > 0 && this.now() - this.loadStart > LOAD_WAIT_MS) {
            this.loading.clear();
        }
        return this.loading.size > 0;
    }

    // What the local player's pressing, sent on when it changes
    setMove(x: number, y: number): void {
        const move = quantizeMove(x, y);
        const moveSeq = this.prediction?.sample(move);
        const now = this.now();
        if (
            (move[0] === this.lastMove[0] &&
                move[1] === this.lastMove[1] &&
                (moveSeq === undefined || moveSeq === this.moveSeqSent)) ||
            now - this.moveSentAt < MOVE_INTERVAL_MS
        ) {
            return;
        }
        this.lastMove = move;
        this.moveSentAt = now;
        this.moveSeqSent = moveSeq ?? 0;
        if (this.isHost) {
            this.queue({ frame: 0, hero: this.sim.focus, move });
        } else {
            this.link.sendUp({ move, ...(moveSeq && { moveSeq }) });
        }
    }

    // Something the local player did, applied when the frame it's in comes
    act(action: CoopAction): void {
        if (this.isHost) {
            this.queue({ frame: 0, hero: this.sim.focus, action });
        } else {
            this.link.sendUp({ action });
        }
    }

    // The host's: a guest's input, checked before it goes in, as every
    // copy applies it
    receiveUp(from: string, message: UpMessage): void {
        const hero = this.heroes.get(from);
        if (!this.isHost || hero === undefined || !message || typeof message !== "object") {
            return;
        }
        const move = "move" in message ? cleanMove(message.move) : undefined;
        const action = "action" in message ? cleanAction(message.action) : undefined;
        if ("loaded" in message) {
            this.loading.delete(from);
        } else if (move) {
            const moveSeq = "moveSeq" in message ? cleanMoveSeq(message.moveSeq) : undefined;
            this.queue({ frame: 0, hero, move, ...(moveSeq !== undefined && { moveSeq }) });
        } else if (action) {
            this.queue({ frame: 0, hero, action });
        }
    }

    // The host's: anyone the run's waited on for DECIDE_AFTER_MS has it
    // decided for them, and again each time after that
    private decideForTheSlow(): void {
        const sim = this.sim;
        const now = this.now();
        const waiting = new Set(sim.waitingOn.map((hero) => hero.index));
        for (const index of this.waitingSince.keys()) {
            if (!waiting.has(index)) {
                this.waitingSince.delete(index);
            }
        }
        for (const index of waiting) {
            const since = this.waitingSince.get(index) ?? now;
            this.waitingSince.set(index, since);
            if (now - since < DECIDE_AFTER_MS) {
                continue;
            }
            this.waitingSince.set(index, now);
            const action: CoopAction =
                sim.state === "levelUp"
                    ? { kind: "choose", index: 0 }
                    : sim.state === "chest"
                      ? { kind: "chest", action: "take" }
                      : { kind: "leaveEvent" };
            this.next.push({ frame: 0, hero: index, action, auto: true });
        }
    }

    // The host's: a guest left the game
    playerLeft(id: string): void {
        this.loading.delete(id);
        const hero = this.heroes.get(id);
        if (this.isHost && hero !== undefined) {
            this.next.push({ frame: 0, hero, leave: true });
        }
    }

    // A guest's: the host's frames
    receiveDown(message: DownMessage): void {
        if (
            this.isHost ||
            !message ||
            !Array.isArray(message.events) ||
            !Number.isSafeInteger(message.upTo)
        ) {
            return;
        }
        for (const raw of message.events) {
            const event = cleanFrameEvent(raw, this.sim.heroes.length);
            if (event) {
                this.incoming.push(event);
            }
        }
        const hash: unknown = message.hash;
        if (Array.isArray(hash) && Number.isSafeInteger(hash[0]) && Number.isFinite(hash[1])) {
            this.hashes.set(hash[0], hash[1]);
        }
        this.upTo = Math.max(this.upTo, message.upTo);
    }

    // Whether the next frame can be stepped: always for the host, and for a
    // guest once the host has sent it
    canStep(): boolean {
        return this.isHost ? !this.waitingForLoad : this.frame < this.upTo;
    }

    // A guest's frames in hand
    get behind(): number {
        return this.upTo - this.frame;
    }

    // Steps a frame, applying what happened at it first. Returns the events
    // applied, for the client to follow up the local player's.
    stepFrame(): FrameEvent[] {
        const frame = this.frame + 1;
        let events: FrameEvent[];
        if (this.isHost) {
            this.decideForTheSlow();
            events = this.next.map((event) => ({ ...event, frame }));
            this.next = [];
            this.outgoing.push(...events);
        } else {
            let count = 0;
            while (count < this.incoming.length && this.incoming[count].frame <= frame) {
                count++;
            }
            events = this.incoming.splice(0, count);
        }
        for (const event of events) {
            applyFrameEvent(this.sim, event);
        }
        this.sim.step();
        this.prediction?.confirm(events);
        this.frame = frame;
        if (this.isHost) {
            this.upTo = frame;
            if (frame % HASH_FRAMES === 0) {
                this.outgoingHash = [frame, syncHash(this.sim)];
            }
        } else {
            const expected = this.hashes.get(frame);
            if (expected !== undefined) {
                this.hashes.delete(frame);
                if (expected !== syncHash(this.sim) && !this.desynced) {
                    this.desynced = true;
                    console.warn(`Co-op run out of step with the host at frame ${frame}`);
                }
            }
        }
        return events;
    }

    // The host's: sends the frames stepped since last time (quiet ones once
    // there are a couple, unless everything's to go now)
    flush(everything = false): void {
        if (
            !this.isHost ||
            this.upTo === this.sentUpTo ||
            (!everything && this.outgoing.length === 0 && this.upTo - this.sentUpTo < QUIET_FRAMES)
        ) {
            return;
        }
        this.link.sendDown({
            upTo: this.upTo,
            events: this.outgoing,
            ...(this.outgoingHash && { hash: this.outgoingHash }),
        });
        this.outgoing = [];
        this.outgoingHash = undefined;
        this.sentUpTo = this.upTo;
    }
}
