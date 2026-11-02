// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import { GameStore } from "../client/GameStore";
import { createSave } from "../core/save";
import { GameUi } from "./GameUi";

afterEach(cleanup);

function renderShop(upgrades: Record<string, number>, coins = 0) {
    const save = { ...createSave(), upgrades, coins };
    const store = new GameStore(save);
    store.set({ screen: "shop" });
    const actions = {
        buyUpgrade: vi.fn(),
        refundUpgrade: vi.fn(),
        refundUpgrades: vi.fn(),
        playClick: vi.fn(),
    };
    render(<GameUi store={store} client={actions as unknown as GameClient} />);
    return actions;
}

test("right-clicking a bought skill refunds one rank even without coins", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2, hitpoints: 1 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(actions.refundUpgrades).not.toHaveBeenCalled();
});

test("maxed skills still accept right-clicks but cannot buy another rank", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 5 }, 50000);
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(card).toBeEnabled();
    expect(card).toHaveTextContent("Maxed");
    fireEvent.click(card);
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
});

test("right-clicking an unbought skill does not refund or purchase it", () => {
    expect.hasAssertions();
    const actions = renderShop({});
    expect(fireEvent.contextMenu(screen.getByRole("button", { name: /^Strength\b/ }))).toBe(true);
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
});

test("left-clicking still buys a rank", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 1 }, 50000);
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    expect(actions.buyUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
});
