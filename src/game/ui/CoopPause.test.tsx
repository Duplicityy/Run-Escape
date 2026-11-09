// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import { GameStore, HudView, UiSnapshot } from "../client/GameStore";
import { CoopPauseView } from "../client/coop/protocol";
import { createSave } from "../core/save";
import { CoopPauseControls, GameUi } from "./GameUi";

afterEach(cleanup);

const ids = ["alice", "bob", "charlie", "dana"];

function pause(changes: Partial<CoopPauseView> = {}): CoopPauseView {
    return {
        mode: "host",
        phase: "running",
        atFrame: 12,
        requests: [],
        eligible: ids,
        ready: [],
        cooldownRemainingMs: 0,
        ...changes,
    };
}

function setup(you = "bob", changes: Partial<UiSnapshot> = {}) {
    const store = new GameStore(createSave());
    const ui = store.getSnapshot();
    store.set({
        screen: "run",
        coop: {
            ...ui.coop,
            status: "online",
            you,
            anyMap: true,
            room: {
                code: "TESTROOM",
                name: "Party",
                open: false,
                hostId: "alice",
                mapId: "lumbridge",
                endless: false,
                hard: false,
                started: true,
                pauseMode: "host",
                members: ids.map((id) => ({
                    id,
                    name: id[0].toUpperCase() + id.slice(1),
                    characterId: "warrior",
                    ready: true,
                })),
            },
        },
        coopPause: pause(),
        ...changes,
    });
    const actions = {
        requestCoopPause: vi.fn(),
        voteCoopPause: vi.fn(),
        setCoopReady: vi.fn(),
        resumeCoopEveryone: vi.fn(),
        setCoopPauseMode: vi.fn(),
        playClick: vi.fn(),
        choose: vi.fn(),
        setMinimapCanvas: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
    };
    const client = { ...actions, store } as unknown as GameClient;
    return { store, actions, client };
}

test("a guest requests a host-controlled pause instead of pausing the run locally", () => {
    const { store, client, actions } = setup();
    render(<CoopPauseControls ui={store.getSnapshot()} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Request pause" }));
    expect(actions.requestCoopPause).toHaveBeenCalledOnce();
    expect(actions.pause).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Pause run" })).toBeNull();
});

test("the host can pause directly in host-controlled mode", () => {
    const { store, client, actions } = setup("alice");
    render(<CoopPauseControls ui={store.getSnapshot()} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    expect(actions.requestCoopPause).toHaveBeenCalledOnce();
});

test("a pause vote leaves the run visible and lets a guest vote yes or no", () => {
    const { store, client, actions } = setup("bob", {
        coopPause: pause({
            mode: "vote",
            vote: {
                requestedBy: "alice",
                yes: ["alice"],
                no: [],
                required: 3,
                remainingMs: 9000,
            },
        }),
    });
    render(<GameUi store={store} client={client} />);
    expect(screen.getByText(/Alice requested a pause/)).toHaveTextContent("1/3 approvals");
    expect(screen.getByText("The run continues until the vote passes.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Vote yes" }));
    expect(actions.voteCoopPause).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Vote no" }));
    expect(actions.voteCoopPause).toHaveBeenLastCalledWith(false);
});

test("a submitted vote cannot be sent again from the banner", () => {
    const { store, client, actions } = setup("bob", {
        coopPause: pause({
            mode: "vote",
            vote: {
                requestedBy: "alice",
                yes: ["alice", "bob"],
                no: [],
                required: 3,
                remainingMs: 5000,
            },
        }),
    });
    render(<GameUi store={store} client={client} />);
    const yes = screen.getByRole("button", { name: "Vote yes" });
    const no = screen.getByRole("button", { name: "Vote no" });
    expect(yes).toBeDisabled();
    expect(no).toBeDisabled();
    fireEvent.click(yes);
    fireEvent.click(no);
    expect(actions.voteCoopPause).not.toHaveBeenCalled();
});

test("a failed-vote cooldown disables another vote and shows its remaining wait", () => {
    const { store, client, actions } = setup("bob", {
        coopPause: pause({ mode: "vote", cooldownRemainingMs: 8200 }),
    });
    render(<CoopPauseControls ui={store.getSnapshot()} client={client} />);
    const button = screen.getByRole("button", { name: "Vote to pause" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Vote available in 9s")).toBeInTheDocument();
    fireEvent.click(button);
    expect(actions.requestCoopPause).not.toHaveBeenCalled();
});

test("the shared pause overrides a level-up choice and restores it when play resumes", () => {
    const choice = {
        title: "Test reward",
        text: "A reward waiting for this player.",
        iconObjId: 1,
        isNew: true,
        isEvolution: false,
        isHilt: false,
        isSpell: false,
        banishable: false,
        banished: false,
    };
    const { store, client, actions } = setup("bob", {
        overlay: "levelUp",
        choices: [choice],
        coopPause: pause({ phase: "paused", requestedBy: "alice" }),
    });
    render(<GameUi store={store} client={client} />);
    const dialog = screen.getByRole("dialog", { name: "Run paused" });
    expect(within(dialog).getByText("Paused by Alice.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test reward/ })).toBeNull();
    expect(store.getSnapshot().choices).toEqual([choice]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ready to resume" }));
    expect(actions.setCoopReady).toHaveBeenCalledExactlyOnceWith(true);
    expect(actions.resume).not.toHaveBeenCalled();
    act(() => store.set({ coopPause: pause() }));
    expect(screen.queryByRole("dialog", { name: "Run paused" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Test reward/ }));
    expect(actions.choose).toHaveBeenCalledExactlyOnceWith(0);
});

test("readiness can be withdrawn and only the host sees the resume override", () => {
    const { store, client, actions } = setup("bob", {
        coopPause: pause({ phase: "paused", ready: ["alice", "bob"] }),
    });
    render(<GameUi store={store} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Not ready" }));
    expect(actions.setCoopReady).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("button", { name: "Resume everyone" })).toBeNull();
    act(() => store.set({ coop: { ...store.getSnapshot().coop, you: "alice" } }));
    fireEvent.click(screen.getByRole("button", { name: "Resume everyone" }));
    expect(actions.resumeCoopEveryone).toHaveBeenCalledOnce();
});

test("the resume countdown keeps gameplay choices hidden", () => {
    const { store, client } = setup("alice", {
        overlay: "levelUp",
        coopPause: pause({ phase: "resuming", resumeRemainingMs: 2100 }),
    });
    render(<GameUi store={store} client={client} />);
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
        "Resuming in 3...",
    );
    expect(screen.queryByText(/Congratulations, you've advanced/)).toBeNull();
    expect(screen.getByRole("button", { name: "Ready to resume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume everyone" })).toBeDisabled();
});

test("a ready player can withdraw readiness during the resume countdown", () => {
    const { store, client, actions } = setup("bob", {
        coopPause: pause({
            phase: "resuming",
            resumeRemainingMs: 2100,
            ready: ["alice", "bob", "charlie", "dana"],
        }),
    });
    render(<GameUi store={store} client={client} />);
    const notReady = screen.getByRole("button", { name: "Not ready" });
    expect(notReady).toBeEnabled();
    fireEvent.click(notReady);
    expect(actions.setCoopReady).toHaveBeenCalledExactlyOnceWith(false);
});

test("the lobby lets only its host change the pause policy before a run", () => {
    const { store, client, actions } = setup("alice");
    const coop = store.getSnapshot().coop;
    store.set({ screen: "coop", coop: { ...coop, room: { ...coop.room!, started: false } } });
    render(<GameUi store={store} client={client} />);
    const host = screen.getByRole("button", { name: "Host controlled" });
    expect(host).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Majority vote" }));
    expect(actions.setCoopPauseMode).toHaveBeenCalledExactlyOnceWith("vote");
    actions.setCoopPauseMode.mockClear();
    act(() => store.set({ coop: { ...store.getSnapshot().coop, you: "bob" } }));
    const guestVote = screen.queryByRole("button", { name: "Majority vote" });
    if (guestVote) {
        expect(guestVote).toBeDisabled();
        fireEvent.click(guestVote);
    }
    expect(actions.setCoopPauseMode).not.toHaveBeenCalled();
});

test("shared pause settings stay available without returning to gameplay", () => {
    const hud: HudView = {
        mapId: "lumbridge",
        level: 1,
        maxWeapons: 6,
        maxPassives: 6,
        weapons: [],
        passives: [],
        stats: [],
        gear: [],
        inventory: [null, null, null, null],
        rerolls: 0,
        banishes: 0,
    };
    const { store, client, actions } = setup("bob", {
        hud,
        coopPause: pause({ phase: "paused" }),
    });
    render(<GameUi store={store} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Menu & settings" }));
    expect(actions.pause).toHaveBeenCalledOnce();
    expect(actions.resumeCoopEveryone).not.toHaveBeenCalled();
    expect(actions.resume).not.toHaveBeenCalled();
});
