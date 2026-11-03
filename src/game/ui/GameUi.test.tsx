// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import { GameStore } from "../client/GameStore";
import { CombatStyle } from "../content/types";
import { buyUpgrade, createSave, refundUpgrade, refundUpgrades } from "../core/save";
import { GameUi } from "./GameUi";

afterEach(cleanup);

function renderShop(upgrades: Record<string, number>, coins = 0, characterId = "warrior") {
    const save = createSave();
    save.coins = coins;
    save.skillPages.melee.upgrades = upgrades;
    const store = new GameStore(save);
    store.set({ screen: "shop", characterId });
    const refresh = () => store.set({ save: { ...save } });
    const actions = {
        buyUpgrade: vi.fn((id: string, style: CombatStyle) => {
            buyUpgrade(save, id, style);
            refresh();
        }),
        refundUpgrade: vi.fn((id: string, style: CombatStyle) => {
            refundUpgrade(save, id, style);
            refresh();
        }),
        refundUpgrades: vi.fn((style: CombatStyle) => {
            refundUpgrades(save, style);
            refresh();
        }),
        playClick: vi.fn(),
    };
    render(<GameUi store={store} client={actions as unknown as GameClient} />);
    return { ...actions, save };
}

test("switching class pages keeps purchases and single-rank refunds isolated", () => {
    expect.hasAssertions();
    const actions = renderShop({}, 50000);
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    const melee = structuredClone(actions.save.skillPages.melee);
    fireEvent.click(screen.getByRole("tab", { name: "Ranged" }));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Ranged");
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    const ranged = structuredClone(actions.save.skillPages.ranged);
    fireEvent.click(screen.getByRole("tab", { name: "Magic" }));
    expect(screen.getByRole("button", { name: "Refund all" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Strength\b/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Strength\b/ }));
    expect(actions.refundUpgrade).toHaveBeenLastCalledWith("strength", "magic");
    expect(actions.save.skillPages.magic.upgrades).toEqual({});
    expect(actions.save.skillPages.melee).toEqual(melee);
    expect(actions.save.skillPages.ranged).toEqual(ranged);
    fireEvent.click(screen.getByRole("tab", { name: "Ranged" }));
    fireEvent.click(screen.getByRole("button", { name: "Refund all" }));
    expect(actions.refundUpgrades).toHaveBeenLastCalledWith("ranged");
    expect(actions.save.skillPages.melee).toEqual(melee);
    fireEvent.click(screen.getByRole("tab", { name: "Melee" }));
    expect(screen.getByRole("button", { name: "Refund all" })).toBeEnabled();
}, 30000);

test("each page can afford the full gold budget after another class spends it", () => {
    expect.hasAssertions();
    const actions = renderShop({}, 10000);
    for (const label of ["Melee", "Ranged", "Magic"]) {
        fireEvent.click(screen.getByRole("tab", { name: label }));
        const card = screen.getByRole("button", { name: /^Ring of life\b/ });
        expect(card).not.toHaveClass("ui-card-dim");
        expect(document.querySelector(".ui-shop > .ui-row:last-child .ui-coins")).toHaveTextContent(
            "10",
        );
        fireEvent.click(card);
        expect(actions.save.coins).toBe(0);
    }
    for (const page of Object.values(actions.save.skillPages)) {
        expect(page.upgrades.ring_of_life).toBe(1);
        expect(page.upgradesSpent).toBe(10000);
    }
}, 30000);

test.each([
    ["warrior", "Melee"],
    ["ranger", "Ranged"],
    ["wizard", "Magic"],
])("skills open on %s's class page", (characterId, label) => {
    expect.hasAssertions();
    renderShop({}, 0, characterId);
    expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
});

test("class tabs support arrow keys and wrap without changing any skill pages", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 1 }, 50000);
    const before = structuredClone(actions.save);
    const melee = screen.getByRole("tab", { name: "Melee" });
    melee.focus();
    fireEvent.keyDown(melee, { key: "ArrowLeft" });
    const magic = screen.getByRole("tab", { name: "Magic" });
    expect(magic).toHaveFocus();
    expect(magic).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(magic, { key: "ArrowRight" });
    expect(melee).toHaveFocus();
    expect(actions.save).toEqual(before);
});

test("right-clicking a bought skill refunds one rank even without coins", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2, hitpoints: 1 });
    const card = screen.getByRole("button", { name: /^Strength\b/ });
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
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
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
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
    expect(actions.buyUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.refundUpgrade).not.toHaveBeenCalled();
});
