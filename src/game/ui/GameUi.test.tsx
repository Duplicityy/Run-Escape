// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import { GameStore } from "../client/GameStore";
import { createSave } from "../core/save";
import { GameUi } from "./GameUi";

const device = vi.hoisted(() => ({ coarse: false }));

vi.mock("../../util/DeviceUtil", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../util/DeviceUtil")>()),
    get isCoarsePointer() {
        return device.coarse;
    },
}));

afterEach(() => {
    cleanup();
    device.coarse = false;
});

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
    expect(card).toHaveAttribute("aria-disabled", "true");
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

test("the visible refund button refunds one bought rank without purchasing", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2 });
    const refund = screen.getByRole("button", { name: "Refund one Strength rank" });
    expect(refund).toHaveAttribute("title", "Refund one Strength rank");
    expect(refund.closest(".ui-shop-card")).toBeNull();
    fireEvent.click(refund);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(actions.refundUpgrades).not.toHaveBeenCalled();
});

test("maxed skills retain their visible refund button", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
});

test("unbought skills have no refund button", () => {
    expect.hasAssertions();
    renderShop({});
    expect(screen.queryByRole("button", { name: "Refund one Strength rank" })).toBeNull();
});

test("touch long presses do not refund, but the refund button still works", () => {
    expect.hasAssertions();
    device.coarse = true;
    const actions = renderShop({ strength: 2 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
});

test("bought cards expose the desktop right-click shortcut in a tooltip", () => {
    expect.hasAssertions();
    renderShop({ strength: 1 });
    expect(screen.getByRole("button", { name: /^Strength\b/ })).toHaveAttribute(
        "title",
        "Right-click to refund one rank",
    );
});

test("unaffordable skills cannot purchase but can refund a bought rank", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 1 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(card).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(card);
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength");
});
