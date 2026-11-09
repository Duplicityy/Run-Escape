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
import {
    CoopPauseSnapshot,
    CoopPauseView,
    DownMessage,
    PauseControl,
    PauseMode,
    UpMessage,
} from "./protocol";

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
// The host keeps what it's sent for this many frames (20 seconds), to send
// again to a guest that missed some. A gap only comes from a dropped
// connection, and the relay gives up on one after 15 seconds
// (RESUME_GRACE_MS in server/cloudflare/src/room.mjs), so this outlasts any
// gap while keeping a resend well inside the relay's limits.
const RESEND_FRAMES = 1000;
// A guest asks for missing frames this often at most, and the host resends
// this often at most whoever asks: one resend covers every guest behind
const RESEND_ASK_MS = 1000;
// A resend goes out in messages of about this many events at most: 20
// seconds of three guests sending all they're let through would otherwise
// come near the relays' biggest message (MAX_MESSAGE_BYTES in shared.mjs)
const RESEND_EVENTS = 1000;
// Someone the run's waited on this long (a hidden tab, gone to make tea) has
// it decided for them: the first reward, taking the casket, or walking away
export const DECIDE_AFTER_MS = 20_000;
// The most a hero's actions can queue for one frame. It's more than a player
// can do, and with moves kept to the latest it keeps what the host sends small
// however much a guest sends while it waits.
const MAX_QUEUED_ACTIONS = 8;
// Actions that answer a decision (a level up, a casket, a random event), sent
// once for each: a double click or a second key press before the host's frame
// comes back is dropped
const DECISIONS: ReadonlySet<CoopAction["kind"]> = new Set([
    "choose",
    "reroll",
    "skip",
    "banish",
    "banishChest",
    "chest",
    "event",
    "leaveEvent",
]);
// After this long with the decision unchanged (the host turned the action
// away, or it was lost), it can be sent again: longer than a host stalls for
// (a tab in the background catching up), so a second answer in the wait
// can't land on the next decision, and well short of DECIDE_AFTER_MS
const DECISION_RESEND_MS = 10_000;
const VOTE_MS = 10_000;
const FAILED_VOTE_COOLDOWN_MS = 15_000;
const RESUME_MS = 3000;

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
    // The host's: the frames it's said are out, and what it's sent lately
    private sentUpTo = 0;
    private sent: DownMessage[] = [];
    // A guest's: when it last asked for frames it missed. The host's: when it
    // last resent, and the earliest frame asked for since
    private askedAt = -Infinity;
    private resendAsked?: number;
    // A guest's checks from the host still to compare
    private hashes = new Map<number, number>();
    private lastMove: [number, number] = [0, 0];
    private moveSentAt = -Infinity;
    private moveSeqSent = 0;
    // The decision the local player last answered, and when
    private sentDecision?: { on: object; step: string | number; at: number };
    // A guest's other actions (using an item) are numbered, and the last
    // MAX_QUEUED_ACTIONS kept until the host's frames show them, to send again
    // after a dropped connection. The host's: the numbers each hero's had
    // within that many of their highest, so one sent twice goes in once,
    // whichever order a reconnect sends them in.
    private actionSeqSent = 0;
    private unconfirmed: { actionSeq: number; action: CoopAction }[] = [];
    private readonly actionSeqs = new Map<number, { top: number; had: Set<number> }>();
    // The host's: since when the run's been waiting on each hero
    private readonly waitingSince = new Map<number, number>();
    // The copies have gone apart (it's said once)
    desynced = false;
    // The host's: the guests whose map is still loading, and since when
    private readonly loading: Set<string>;
    private readonly loadStart: number;
    onPauseChange?: () => void;
    private readonly localId: string;
    private readonly eligible: Set<string>;
    private readonly requests = new Set<string>();
    private readonly ready = new Set<string>();
    private phase: CoopPauseView["phase"] = "running";
    private atFrame = 0;
    private requestedBy?: string;
    private revision = 0;
    private frameRevision = 0;
    private inputEpoch = 0;
    private pauseRevision = 0;
    private vote?: {
        requestedBy: string;
        yes: Set<string>;
        no: Set<string>;
        until: number;
        revision: number;
    };
    private cooldownUntil = 0;
    private resumeAt?: number;
    private forceResume = false;
    private pausedAt?: number;
    private remotePause?: CoopPauseSnapshot;
    private remoteAt = 0;
    private predictionFrozen = false;

    constructor(
        readonly sim: Sim,
        readonly isHost: boolean,
        private readonly link: CoopLink,
        // Hero index by player id
        private readonly heroes: Map<string, number>,
        // The host's own id
        hostId: string,
        private readonly now: () => number = Date.now,
        private readonly pauseMode: PauseMode = "host",
    ) {
        this.loading = new Set(isHost ? [...heroes.keys()].filter((id) => id !== hostId) : []);
        this.loadStart = now();
        this.eligible = new Set(heroes.keys());
        this.localId = [...heroes].find(([, hero]) => hero === sim.focus)?.[0] ?? hostId;
        if (!isHost) {
            this.prediction = new MovementPrediction(sim, now);
        }
    }

    get pause(): CoopPauseView {
        const elapsed = this.now() - this.remoteAt;
        if (!this.isHost && this.remotePause) {
            const state = this.remotePause;
            return {
                ...state,
                requests: [...state.requests],
                eligible: [...state.eligible],
                ready: [...state.ready],
                vote: state.vote && {
                    ...state.vote,
                    yes: [...state.vote.yes],
                    no: [...state.vote.no],
                    remainingMs: Math.max(0, state.vote.remainingMs - elapsed),
                },
                resumeRemainingMs:
                    state.resumeRemainingMs === undefined
                        ? undefined
                        : Math.max(0, state.resumeRemainingMs - elapsed),
                cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - elapsed),
            };
        }
        return {
            mode: this.pauseMode,
            phase: this.phase,
            atFrame: this.atFrame,
            requestedBy: this.requestedBy,
            requests: [...this.requests],
            eligible: [...this.eligible],
            ready: [...this.ready],
            vote: this.vote && {
                requestedBy: this.vote.requestedBy,
                yes: [...this.vote.yes],
                no: [...this.vote.no],
                required: Math.floor(this.eligible.size / 2) + 1,
                remainingMs: Math.max(0, this.vote.until - this.now()),
            },
            resumeRemainingMs:
                this.resumeAt === undefined ? undefined : Math.max(0, this.resumeAt - this.now()),
            cooldownRemainingMs: Math.max(0, this.cooldownUntil - this.now()),
        };
    }

    get matchPaused(): boolean {
        return (this.isHost ? this.phase : (this.remotePause?.phase ?? "running")) !== "running";
    }

    get frozen(): boolean {
        return (
            this.matchPaused &&
            this.frame >= (this.isHost ? this.atFrame : (this.remotePause?.atFrame ?? 0))
        );
    }

    requestPause(): void {
        if (this.isHost) {
            this.requestPauseFrom(this.localId);
        } else if (!this.matchPaused) {
            this.link.sendUp({ control: { kind: "pause", epoch: this.inputEpoch } });
        }
    }

    votePause(yes: boolean): void {
        if (this.isHost) {
            this.recordVote(this.localId, yes);
        } else if (this.pause.vote) {
            this.link.sendUp({ control: { kind: "vote", yes, revision: this.revision } });
        }
    }

    setReadyToResume(ready: boolean): void {
        if (this.isHost) {
            this.recordReady(this.localId, ready);
        } else if (this.matchPaused) {
            this.link.sendUp({ control: { kind: "ready", ready, revision: this.revision } });
        }
    }

    resumeEveryone(): void {
        if (this.isHost && this.phase === "paused") {
            this.beginResume(true);
        }
    }

    // Called even when the simulation is frozen: these are real-time controls.
    updateControl(): void {
        if (this.isHost) {
            if (this.vote && this.now() >= this.vote.until) {
                this.failVote();
            }
            if (this.resumeAt !== undefined && this.now() >= this.resumeAt) {
                const duration = this.now() - (this.pausedAt ?? this.now());
                for (const [hero, since] of this.waitingSince) {
                    this.waitingSince.set(hero, since + duration);
                }
                this.phase = "running";
                this.resumeAt = undefined;
                this.pausedAt = undefined;
                this.requestedBy = undefined;
                this.ready.clear();
                // Inputs stay neutral until a fresh sample arrives after resume.
                for (const id of this.eligible) {
                    this.queue({ frame: 0, hero: this.heroes.get(id)!, move: [0, 0] });
                }
                this.resetLocalInputs();
                this.prediction?.resetForPause();
                this.changed();
            }
        }
        this.updatePredictionBoundary();
    }

    private requestPauseFrom(id: string): void {
        this.updateControl();
        if (this.phase !== "running" || !this.eligible.has(id)) return;
        if (this.pauseMode === "host") {
            if (id === this.localId && this.isHost) {
                this.beginPause(id);
            } else if (!this.requests.has(id)) {
                this.requests.add(id);
                this.changed();
            }
        } else if (!this.vote && this.now() >= this.cooldownUntil) {
            this.vote = {
                requestedBy: id,
                yes: new Set([id]),
                no: new Set(),
                until: this.now() + VOTE_MS,
                revision: this.revision + 1,
            };
            if (this.vote.yes.size > this.eligible.size / 2) {
                this.beginPause(id);
            } else {
                this.changed();
            }
        }
    }

    private recordVote(id: string, yes: boolean): void {
        this.updateControl();
        if (!this.vote || !this.eligible.has(id)) return;
        this.vote.yes.delete(id);
        this.vote.no.delete(id);
        (yes ? this.vote.yes : this.vote.no).add(id);
        if (this.vote.yes.size > this.eligible.size / 2) {
            this.beginPause(this.vote.requestedBy);
        } else {
            this.changed();
        }
    }

    private failVote(): void {
        this.vote = undefined;
        this.cooldownUntil = this.now() + FAILED_VOTE_COOLDOWN_MS;
        this.changed();
    }

    private beginPause(id: string): void {
        this.flush(true);
        this.phase = "paused";
        this.atFrame = this.frame;
        this.requestedBy = id;
        this.pauseRevision = this.revision + 1;
        this.pausedAt = this.now();
        this.inputEpoch++;
        this.next = this.next.filter((event) => event.leave);
        this.vote = undefined;
        this.requests.clear();
        this.ready.clear();
        this.resetLocalInputs();
        this.changed();
        this.updatePredictionBoundary();
    }

    private recordReady(id: string, ready: boolean): void {
        if (this.phase === "running" || !this.eligible.has(id)) return;
        if (ready) this.ready.add(id);
        else this.ready.delete(id);
        if (!ready && this.phase === "resuming" && !this.forceResume) {
            this.phase = "paused";
            this.resumeAt = undefined;
        }
        if (
            this.phase === "paused" &&
            [...this.eligible].every((member) => this.ready.has(member))
        ) {
            this.beginResume(false);
        } else {
            this.changed();
        }
    }

    private beginResume(force: boolean): void {
        this.forceResume = force;
        this.phase = "resuming";
        this.resumeAt = this.now() + RESUME_MS;
        this.changed();
    }

    private resetLocalInputs(): void {
        this.lastMove = [NaN, NaN];
        this.moveSentAt = -Infinity;
        this.unconfirmed = [];
        this.sentDecision = undefined;
    }

    private updatePredictionBoundary(): void {
        if (this.frozen !== this.predictionFrozen) {
            this.prediction?.resetForPause();
            this.predictionFrozen = this.frozen;
            this.onPauseChange?.();
        }
    }

    private changed(): void {
        this.revision++;
        this.sendPauseState();
        this.onPauseChange?.();
    }

    private sendPauseState(): void {
        if (this.isHost) {
            this.link.sendDown({
                from: this.upTo,
                upTo: this.upTo,
                events: [],
                pause: { ...this.pause, revision: this.revision, inputEpoch: this.inputEpoch },
                controlOnly: true,
            });
        }
    }

    private pauseSnapshot(): CoopPauseSnapshot {
        return { ...this.pause, revision: this.revision, inputEpoch: this.inputEpoch };
    }

    private receivePauseState(value: unknown, upTo: number): void {
        if (!value || typeof value !== "object") return;
        const state = value as CoopPauseSnapshot;
        const ids = (list: unknown): list is string[] =>
            Array.isArray(list) &&
            list.length <= this.heroes.size &&
            list.every((id) => typeof id === "string" && this.heroes.has(id)) &&
            new Set(list).size === list.length;
        const remaining = (value: unknown, limit: number): value is number =>
            typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= limit;
        if (
            state.mode !== this.pauseMode ||
            !["running", "paused", "resuming"].includes(state.phase) ||
            !Number.isSafeInteger(state.revision) ||
            state.revision < this.revision ||
            !Number.isSafeInteger(state.inputEpoch) ||
            state.inputEpoch < this.inputEpoch ||
            !Number.isSafeInteger(state.atFrame) ||
            state.atFrame < 0 ||
            state.atFrame > upTo ||
            !ids(state.eligible) ||
            !ids(state.ready) ||
            !ids(state.requests) ||
            state.ready.some((id) => !state.eligible.includes(id)) ||
            state.requests.some((id) => !state.eligible.includes(id)) ||
            (state.requestedBy !== undefined && !this.heroes.has(state.requestedBy)) ||
            !remaining(state.cooldownRemainingMs, FAILED_VOTE_COOLDOWN_MS) ||
            (state.phase === "resuming" && !remaining(state.resumeRemainingMs, RESUME_MS))
        )
            return;
        if (
            state.vote &&
            (state.phase !== "running" ||
                !state.vote ||
                typeof state.vote !== "object" ||
                !state.eligible.includes(state.vote.requestedBy) ||
                !ids(state.vote.yes) ||
                !ids(state.vote.no) ||
                state.vote.yes.some((id) => !state.eligible.includes(id)) ||
                state.vote.no.some(
                    (id) => !state.eligible.includes(id) || state.vote!.yes.includes(id),
                ) ||
                state.vote.required !== Math.floor(state.eligible.length / 2) + 1 ||
                !remaining(state.vote.remainingMs, VOTE_MS))
        )
            return;
        const wasPaused = this.matchPaused;
        if (state.inputEpoch !== this.inputEpoch) this.resetLocalInputs();
        this.inputEpoch = state.inputEpoch;
        this.revision = state.revision;
        this.remotePause = {
            ...state,
            requests: [...state.requests],
            eligible: [...state.eligible],
            ready: [...state.ready],
            vote: state.vote && { ...state.vote, yes: [...state.vote.yes], no: [...state.vote.no] },
        };
        this.remoteAt = this.now();
        if (wasPaused && !this.matchPaused) {
            this.resetLocalInputs();
            this.prediction?.resetForPause();
        }
        this.updatePredictionBoundary();
        this.onPauseChange?.();
        // The last frame may have been lost just before the pause; no later
        // frame packet will arrive to reveal the gap while everyone waits.
        if (this.matchPaused && this.upTo < state.atFrame) {
            this.askedAt = this.now();
            this.link.sendUp({ resend: this.upTo });
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
        if (this.matchPaused) return;
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
            this.link.sendUp({
                move,
                ...(moveSeq && { moveSeq }),
                ...(this.inputEpoch && { epoch: this.inputEpoch }),
            });
        }
    }

    // Something the local player did, applied when the frame it's in comes.
    // False when it's a second answer to a decision already answered: the
    // first resolves it, and the second would land on the next one unseen.
    act(action: CoopAction): boolean {
        if (this.matchPaused) return false;
        if (DECISIONS.has(action.kind)) {
            const decision = this.decision();
            const now = this.now();
            const sent = this.sentDecision;
            if (
                decision &&
                sent &&
                sent.on === decision.on &&
                sent.step === decision.step &&
                now - sent.at < DECISION_RESEND_MS
            ) {
                return false;
            }
            this.sentDecision = decision && { ...decision, at: now };
        }
        if (this.isHost) {
            this.queue({ frame: 0, hero: this.sim.focus, action });
        } else if (DECISIONS.has(action.kind)) {
            this.link.sendUp({ action, ...(this.inputEpoch && { epoch: this.inputEpoch }) });
        } else {
            const actionSeq = ++this.actionSeqSent;
            this.unconfirmed.push({ actionSeq, action });
            if (this.unconfirmed.length > MAX_QUEUED_ACTIONS) {
                this.unconfirmed.shift();
            }
            this.link.sendUp({
                action,
                actionSeq,
                ...(this.inputEpoch && { epoch: this.inputEpoch }),
            });
        }
        return true;
    }

    // What the local player is deciding on now: their level up's choices, the
    // casket in front of them, or a random event's offer. Each is a new object
    // once it's been answered. The step is what changes while it stays open:
    // a banished reward, a rerolled item, or something bought with the rest
    // still for sale.
    private decision(): { on: object; step: string | number } | undefined {
        const sim = this.sim;
        switch (sim.state) {
            case "levelUp":
                return { on: sim.choices, step: sim.banishesLeft };
            case "chest":
                return sim.chest && { on: sim.chest, step: sim.chest.itemId };
            case "event":
                return (
                    sim.offer && {
                        on: sim.offer,
                        step: sim.offer.options.filter((o) => "sold" in o && o.sold).length,
                    }
                );
            default:
                return undefined;
        }
    }

    // The host's: a guest's input, checked before it goes in, as every
    // copy applies it
    receiveUp(from: string, message: UpMessage): void {
        const hero = this.heroes.get(from);
        if (
            !this.isHost ||
            hero === undefined ||
            !this.eligible.has(from) ||
            !message ||
            typeof message !== "object"
        ) {
            return;
        }
        if ("control" in message) {
            this.receiveControl(from, message.control);
            return;
        }
        const move = "move" in message ? cleanMove(message.move) : undefined;
        const action = "action" in message ? cleanAction(message.action) : undefined;
        if ("loaded" in message) {
            this.loading.delete(from);
        } else if ("resend" in message) {
            const after = message.resend;
            // Nobody honest is further behind than what's kept, and an ask from
            // before it would only hold back the rest
            if (
                Number.isSafeInteger(after) &&
                this.sent.length > 0 &&
                (after as number) >= this.sent[0].from!
            ) {
                this.resendAsked = Math.min(this.resendAsked ?? Infinity, after as number);
                this.resendIfDue();
            }
        } else if (move) {
            if (this.matchPaused || ("epoch" in message ? message.epoch : 0) !== this.inputEpoch)
                return;
            const moveSeq = "moveSeq" in message ? cleanMoveSeq(message.moveSeq) : undefined;
            this.queue({ frame: 0, hero, move, ...(moveSeq !== undefined && { moveSeq }) });
        } else if (action) {
            if (this.matchPaused || ("epoch" in message ? message.epoch : 0) !== this.inputEpoch)
                return;
            const actionSeq = "actionSeq" in message ? cleanMoveSeq(message.actionSeq) : undefined;
            if (actionSeq !== undefined) {
                const seqs = this.actionSeqs.get(hero) ?? { top: 0, had: new Set<number>() };
                this.actionSeqs.set(hero, seqs);
                if (seqs.had.has(actionSeq) || actionSeq <= seqs.top - MAX_QUEUED_ACTIONS) {
                    // Sent again after a dropped connection, and it came the first time
                    return;
                }
                seqs.had.add(actionSeq);
                seqs.top = Math.max(seqs.top, actionSeq);
                for (const seq of seqs.had) {
                    if (seq <= seqs.top - MAX_QUEUED_ACTIONS) {
                        seqs.had.delete(seq);
                    }
                }
            }
            this.queue({ frame: 0, hero, action, ...(actionSeq !== undefined && { actionSeq }) });
        }
    }

    private receiveControl(from: string, control: PauseControl): void {
        if (!control || typeof control !== "object") return;
        this.updateControl();
        switch (control.kind) {
            case "pause":
                if (control.epoch === this.inputEpoch) this.requestPauseFrom(from);
                break;
            case "vote":
                if (
                    this.vote &&
                    Number.isSafeInteger(control.revision) &&
                    control.revision >= this.vote.revision &&
                    control.revision <= this.revision &&
                    typeof control.yes === "boolean"
                ) {
                    this.recordVote(from, control.yes);
                }
                break;
            case "ready":
                if (
                    Number.isSafeInteger(control.revision) &&
                    control.revision >= this.pauseRevision &&
                    control.revision <= this.revision &&
                    typeof control.ready === "boolean"
                ) {
                    this.recordReady(from, control.ready);
                }
                break;
            case "resume":
                // Only this browser owns the host's controls.
                break;
            case "sync":
                if (
                    Number.isSafeInteger(control.after) &&
                    control.after >= 0 &&
                    control.after <= this.upTo
                ) {
                    this.flush(true);
                    if (control.after < this.upTo) this.resend(control.after);
                    this.sendPauseState();
                }
                break;
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
                    ? // The first reward they can take: not one they've banished
                      { kind: "choose", index: firstUnbanished(sim, index) }
                    : sim.state === "chest"
                      ? { kind: "chest", action: "take" }
                      : { kind: "leaveEvent" };
            this.next.push({ frame: 0, hero: index, action, auto: true });
        }
    }

    // The host's: a guest left the game
    playerLeft(id: string): void {
        this.loading.delete(id);
        if (!this.eligible.delete(id)) return;
        this.requests.delete(id);
        this.ready.delete(id);
        const hero = this.heroes.get(id);
        if (this.isHost && hero !== undefined) {
            this.next.push({ frame: 0, hero, leave: true });
            if (this.vote) {
                this.vote = undefined;
                this.changed();
            } else if (
                this.phase === "paused" &&
                [...this.eligible].every((member) => this.ready.has(member))
            ) {
                this.beginResume(false);
            } else {
                this.changed();
            }
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
        if (message.pause) this.receivePauseState(message.pause, message.upTo);
        if (message.controlOnly) return;
        if (message.upTo <= this.upTo) {
            // Had it already (sent again for someone else)
            return;
        }
        if (Number.isSafeInteger(message.from) && message.from! > this.upTo) {
            // Some went missing: these come again with them
            const now = this.now();
            if (now - this.askedAt >= RESEND_ASK_MS) {
                this.askedAt = now;
                this.link.sendUp({ resend: this.upTo });
            }
            return;
        }
        for (const raw of message.events) {
            const event = cleanFrameEvent(raw, this.sim.heroes.length);
            // A resend asked for by a guest further behind starts before this
            // one's frames: those it has already (and may have applied)
            if (event && event.frame > this.upTo) {
                this.incoming.push(event);
                if (event.hero === this.sim.focus && event.actionSeq !== undefined) {
                    const confirmed = event.actionSeq;
                    this.unconfirmed = this.unconfirmed.filter((a) => a.actionSeq > confirmed);
                }
            }
        }
        const hash: unknown = message.hash;
        if (Array.isArray(hash) && Number.isSafeInteger(hash[0]) && Number.isFinite(hash[1])) {
            this.hashes.set(hash[0], hash[1]);
        }
        this.upTo = Math.max(this.upTo, message.upTo);
    }

    // The host stops issuing frames while paused. Guests drain issued frames
    // through the pause boundary before stopping too.
    canStep(): boolean {
        return this.isHost
            ? !this.matchPaused && !this.waitingForLoad
            : this.frame < this.upTo && (!this.matchPaused || this.frame < this.pause.atFrame);
    }

    // A guest's frames in hand
    get behind(): number {
        return this.upTo - this.frame;
    }

    // Steps a frame, applying what happened at it first. Returns the events
    // applied, for the client to follow up the local player's.
    stepFrame(): FrameEvent[] {
        if (this.frozen) return [];
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
        this.updatePredictionBoundary();
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
        this.resendIfDue();
        if (
            !this.isHost ||
            this.upTo === this.sentUpTo ||
            (!everything && this.outgoing.length === 0 && this.upTo - this.sentUpTo < QUIET_FRAMES)
        ) {
            return;
        }
        const message: DownMessage = {
            from: this.sentUpTo,
            upTo: this.upTo,
            events: this.outgoing,
            ...(this.outgoingHash && { hash: this.outgoingHash }),
            ...(this.frameRevision !== this.revision && { pause: this.pauseSnapshot() }),
        };
        this.link.sendDown(message);
        this.sent.push(message);
        while (this.sent.length > 0 && this.upTo - this.sent[0].upTo > RESEND_FRAMES) {
            this.sent.shift();
        }
        this.outgoing = [];
        this.outgoingHash = undefined;
        this.sentUpTo = this.upTo;
        this.frameRevision = this.revision;
    }

    // The host's: the frames asked for, once RESEND_ASK_MS has passed since
    // the last resend. However many guests ask, and however often, it's one
    // message a second from the earliest frame asked for.
    private resendIfDue(): void {
        const after = this.resendAsked;
        const now = this.now();
        if (!this.isHost || after === undefined || now - this.askedAt < RESEND_ASK_MS) {
            return;
        }
        this.askedAt = now;
        this.resendAsked = undefined;
        this.resend(after);
    }

    // The host's: everything sent after a frame, again, in as few messages as
    // RESEND_EVENTS allows. Every guest gets them; those that had some
    // already take only the rest.
    private resend(after: number): void {
        // An honest ask is where a message starts. One that isn't still gets the
        // next one on, so that it can't swallow the honest asks made with it.
        const start = this.sent.findIndex((m) => m.from! >= after);
        if (start < 0) {
            return;
        }
        let chunk: DownMessage[] = [];
        let events = 0;
        const send = () => {
            const hash = chunk.findLast((m) => m.hash)?.hash;
            this.link.sendDown({
                from: chunk[0].from,
                upTo: chunk[chunk.length - 1].upTo,
                events: chunk.flatMap((m) => m.events),
                ...(hash && { hash }),
                ...(this.revision > 0 && { pause: this.pauseSnapshot() }),
            });
            chunk = [];
            events = 0;
        };
        for (const message of this.sent.slice(start)) {
            if (chunk.length > 0 && events + message.events.length > RESEND_EVENTS) {
                send();
            }
            chunk.push(message);
            events += message.events.length;
        }
        send();
    }

    // After the connection's come back: the next move goes out whatever it
    // is, in case the last one didn't make it, and so do actions the host's
    // frames haven't shown yet (it takes each only once)
    resumed(): void {
        this.lastMove = [NaN, NaN];
        this.moveSentAt = -Infinity;
        if (this.isHost) {
            this.flush(true);
            this.sendPauseState();
            return;
        }
        this.link.sendUp({ control: { kind: "sync", after: this.upTo } });
        for (const { actionSeq, action } of this.unconfirmed) {
            this.link.sendUp({
                action,
                actionSeq,
                ...(this.inputEpoch && { epoch: this.inputEpoch }),
            });
        }
    }
}

// A hero's first level up reward that hasn't been banished (Firemaking). One
// always is: the last pickable reward can't be banished.
function firstUnbanished(sim: Sim, hero: number): number {
    return sim.as(hero, () => {
        const index = sim.choices.findIndex((_, i) => !sim.isBanishedChoice(i));
        return Math.max(0, index);
    });
}
