// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { GameClient } from "../client/GameClient";
import { GameStore } from "../client/GameStore";
import { CombatStyle } from "../content/types";
import { buyUpgrade, createSave, refundUpgrade, refundUpgrades } from "../core/save";
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
    expect(card).toHaveAttribute("aria-disabled", "true");
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

test("the visible refund button refunds one bought rank without purchasing", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 2 });
    const refund = screen.getByRole("button", { name: "Refund one Strength rank" });
    expect(refund).toHaveAttribute("title", "Refund one Strength rank");
    expect(refund.closest(".ui-shop-card")).toBeNull();
    fireEvent.click(refund);
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
    expect(actions.buyUpgrade).not.toHaveBeenCalled();
    expect(actions.refundUpgrades).not.toHaveBeenCalled();
});

test("maxed skills retain their visible refund button", () => {
    expect.hasAssertions();
    const actions = renderShop({ strength: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Refund one Strength rank" }));
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
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
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
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
    expect(actions.refundUpgrade).toHaveBeenCalledExactlyOnceWith("strength", "melee");
});

function renderMaps(mapId = "lumbridge") {
    const store = new GameStore(createSave());
    store.set({ screen: "characters", mapId });
    const actions = {
        selectMap: vi.fn((id: string) => store.set({ mapId: id })),
        selectCharacter: vi.fn(),
        playClick: vi.fn(),
    };
    render(<GameUi store={store} client={actions as unknown as GameClient} />);
    return actions;
}

test("the map screen opens on the picked map's tab, and a map on another tab can be picked", () => {
    expect.hasAssertions();
    const actions = renderMaps();
    expect(screen.getByRole("tab", { name: "Campaign" })).toHaveAttribute("aria-selected", "true");
    // The other tabs' maps are laid out, but out of reach
    expect(screen.getByRole("button", { name: "Lumbridge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Theatre of Blood" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Bosses" }));
    expect(screen.queryByRole("button", { name: "Lumbridge" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Theatre of Blood" }));
    expect(actions.selectMap).toHaveBeenCalledExactlyOnceWith("theatre_of_blood");
    expect(screen.getByRole("button", { name: /Enter Theatre of Blood/ })).toBeInTheDocument();
    cleanup();
    renderMaps("theatre_of_blood");
    expect(screen.getByRole("tab", { name: "Bosses" })).toHaveAttribute("aria-selected", "true");
}, 30000);

test("map tabs support arrow keys and wrap", () => {
    expect.hasAssertions();
    renderMaps();
    const campaign = screen.getByRole("tab", { name: "Campaign" });
    campaign.focus();
    fireEvent.keyDown(campaign, { key: "ArrowRight" });
    const bosses = screen.getByRole("tab", { name: "Bosses" });
    expect(bosses).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Bosses");
    fireEvent.keyDown(bosses, { key: "ArrowLeft" });
    fireEvent.keyDown(campaign, { key: "ArrowLeft" });
    expect(screen.getAllByRole("tab").at(-1)).toHaveFocus();
});
