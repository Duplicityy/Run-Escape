// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import { GameStore, PlayerResultView, UiSnapshot } from "../client/GameStore";
import { createSave } from "../core/save";
import { ResultModal } from "./GameUi";

function createUi(solo = false, hard = false): UiSnapshot {
    const players: PlayerResultView[] = ["Alice", "Bob", "Charlie", "Dana"].map((name, i) => ({
        name,
        characterName: ["Warrior", "Wizard", "Ranger", "Monk"][i],
        isLocal: i === 1,
        down: i === 2,
        left: i === 3,
        kills: i + 1,
        damageDealt: (i + 1) * 100,
        caskets: i,
        highestHit: i + 30,
        damageTaken: i + 10,
        healed: i + 20,
        rerollsUsed: i,
        skips: i,
        damage: [{ name: `${name}'s weapon`, damage: (i + 1) * 100, kills: i + 1, perSecond: 5 }],
    }));
    const ui = new GameStore(createSave()).getSnapshot();
    return {
        ...ui,
        screen: "run",
        overlay: "dead",
        coop: {
            ...ui.coop,
            room: solo
                ? undefined
                : {
                      code: "TESTROOM",
                      name: "Party",
                      open: true,
                      hostId: "alice",
                      mapId: "lumbridge",
                      endless: false,
                      hard: false,
                      started: true,
                      members: [],
                  },
        },
        result: {
            mapId: "lumbridge",
            endless: false,
            hard,
            expert: false,
            round: 1,
            victory: false,
            seconds: 123,
            level: 10,
            kills: solo ? 2 : 10,
            coins: 250,
            bossesKilled: [],
            gearFound: [],
            evolutionsMade: [],
            trophies: [],
            enemyKills: {},
            caskets: solo ? 1 : 6,
            stats: {
                sources: [],
                damageTaken: 11,
                healed: 21,
                highestHit: 31,
                rerollsUsed: 1,
                skips: 1,
                bossKills: [],
            },
            players: solo ? [players[1]] : players,
            bossKills: [],
            endlessRecord: false,
            firstHardWin: false,
            unlockedCharacters: [],
            unlockedItems: [],
            newGear: ["Rune platebody"],
            newTrophies: [],
            quests: [],
        },
    };
}

function stat(table: string, label: string): string | null {
    const row = within(screen.getByRole("table", { name: table }))
        .getByText(label)
        .closest("tr")!;
    return within(row).getAllByRole("cell")[1].textContent;
}

const client = { leaveRun: vi.fn() } as unknown as GameClient;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

test("starts on your own stats and cycles every player with themed buttons and arrow keys", () => {
    render(<ResultModal ui={createUi()} client={client} />);
    expect(screen.getByText("Bob (you)")).toBeInTheDocument();
    expect(stat("Individual stats", "Kills")).toBe("2");
    expect(stat("Individual stats", "Damage dealt")).toBe("200");
    expect(stat("Party totals", "Kills")).toBe("10");
    expect(stat("Party totals", "Damage dealt")).toBe("1,000");

    fireEvent.click(screen.getByRole("button", { name: "Next player's stats" }));
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Player 3 of 4 · Down")).toBeInTheDocument();
    expect(stat("Individual stats", "Kills")).toBe("3");
    expect(stat("Individual stats", "Biggest hit")).toBe("32");
    expect(stat("Individual stats", "Damage taken")).toBe("12");
    expect(stat("Individual stats", "Hitpoints healed")).toBe("22");
    expect(stat("Individual stats", "Caskets opened")).toBe("2");
    expect(screen.getByRole("table", { name: "Damage breakdown" })).toHaveTextContent(
        "Charlie's weapon",
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Player 4 of 4 · Left the run")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Dana")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous player's stats" }));
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(stat("Party totals", "Kills")).toBe("10");
    expect(stat("Party totals", "Coins banked")).toBe("250");
    expect(screen.getByText("New in the Armoury: Rune platebody")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to the party" }));
    expect(client.leaveRun).toHaveBeenCalledOnce();
});

test("does not navigate while typing or holding a key, and starts a new result on you", () => {
    const { unmount } = render(<ResultModal ui={createUi()} client={client} />);
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    input.remove();
    expect(screen.getByText("Bob (you)")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    unmount();
    render(<ResultModal ui={createUi()} client={client} />);
    expect(screen.getByText("Bob (you)")).toBeInTheDocument();
});

test("solo results show personal totals without player navigation", () => {
    render(<ResultModal ui={createUi(true)} client={client} />);
    expect(
        screen.queryByRole("group", { name: "Player stats navigation" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(stat("Individual stats", "Kills")).toBe("2");
    expect(stat("Run totals", "Run time")).toBe("2:03");
    expect(screen.getByRole("button", { name: "Back to the title" })).toBeInTheDocument();
});

test("hard mode shows with the run's totals", () => {
    render(<ResultModal ui={createUi(true, true)} client={client} />);
    expect(stat("Run totals", "Difficulty")).toBe("Hard");
    cleanup();
    render(<ResultModal ui={createUi(false, true)} client={client} />);
    expect(stat("Party totals", "Difficulty")).toBe("Hard");
    const individual = screen.getByRole("table", { name: "Individual stats" });
    expect(within(individual).queryByText("Difficulty")).toBeNull();
});
