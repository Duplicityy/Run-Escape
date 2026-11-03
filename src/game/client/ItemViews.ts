import { EXTRA_REVIVE_ITEM } from "../content/coop";
import { getGearStats, upgradedName } from "../content/endless";
import { CASKETS, GEAR_SLOTS, GEAR_SLOT_BY_ID, getItem } from "../content/items";
import { getPowerUp } from "../content/powerups";
import { getRaidSupply } from "../content/raids";
import { RARITIES } from "../content/rarity";
import { countSetPieces, describeSetProgress, getItemSet } from "../content/sets";
import { diffStats } from "../content/stats";
import { GearSlot, ItemDef } from "../content/types";
import { describeItem, shouldWear } from "../core/Loot";
import { Sim, TICKS_PER_SECOND } from "../core/Sim";
import {
    BuffView,
    ChestView,
    EventView,
    GearSlotView,
    InventorySlotView,
    ItemView,
} from "./GameStore";

// Items as the UI shows them

// upgrades: gear from an endless run's later rounds ("Slayer helmet +2").
// setWorn: for a set piece, how many of its set are worn (counting it)
export function getItemView(item: ItemDef, upgrades = 0, setWorn?: number): ItemView {
    const rarity = RARITIES[item.rarity];
    const set = getItemSet(item);
    return {
        id: item.id,
        name: upgradedName(item.name, upgrades),
        objId: item.objId,
        rarity: { name: rarity.name, color: rarity.color },
        kindLabel:
            item.kind === "gear" ? `${GEAR_SLOT_BY_ID.get(item.slot)!.name} slot` : "Utility",
        lines: describeItem(item, upgrades),
        ...(set && {
            set: {
                text: describeSetProgress(set, setWorn),
                active: setWorn !== undefined && setWorn >= set.needed,
            },
        }),
    };
}

// An endless run's later rounds make heals and blasts bigger, which the item's
// own description doesn't say
function getRoundLines(sim: Sim, item: ItemDef): string[] {
    if (item.kind !== "utility" || sim.round === 1) {
        return [];
    }
    const times = (n: number) => `${Math.round(n * 10) / 10}x`;
    const use = item.use;
    if (use.kind === "heal" || (use.kind === "cure" && use.heal)) {
        return [`Heals ${times(sim.roundDamage)} as much in round ${sim.round}.`];
    }
    if (use.kind === "blast") {
        return [`Hits ${times(sim.roundHp)} as hard in round ${sim.round}.`];
    }
    return [];
}

// worn: the gear it's counted with for its set (what's worn, or that with
// it on)
function getRunItemView(
    sim: Sim,
    item: ItemDef,
    upgrades = 0,
    worn: Partial<Record<GearSlot, string>> = sim.gear,
): ItemView {
    const set = getItemSet(item);
    const view = getItemView(item, upgrades, set && countSetPieces(worn, set.id));
    return { ...view, lines: [...view.lines, ...getRoundLines(sim, item)] };
}

// The casket at the front of the queue, undefined when there's none
export function getChestView(sim: Sim): ChestView | undefined {
    const chest = sim.chest;
    if (!chest) {
        return undefined;
    }
    const casket = CASKETS[chest.tier];
    const item = getItem(chest.itemId);
    let replaces: ChestView["replaces"];
    let changes: ChestView["changes"] = [];
    let carried = 0;
    let recommended: ChestView["recommended"] = "take";
    // The gear it's counted with for its set: what's worn, with it on
    let withIt = sim.gear;
    if (item.kind === "gear") {
        withIt = { ...sim.gear, [item.slot]: item.id };
        const wornId = sim.gear[item.slot];
        const worn = wornId !== undefined ? getItem(wornId) : undefined;
        const wornUpgrades = sim.gearUpgrades[item.slot] ?? 0;
        if (worn?.kind === "gear") {
            replaces = {
                item: getItemView(worn, wornUpgrades),
                alchCoins: sim.alchValue(worn.id, wornUpgrades),
            };
            changes = diffStats(
                getGearStats(worn, wornUpgrades),
                getGearStats(item, chest.upgrades),
            ).map((d) => ({
                text: d.text,
                good: d.delta > 0,
            }));
            if (!shouldWear(sim.gear, sim.gearUpgrades, item, chest.upgrades)) {
                recommended = "alch";
            }
        }
    } else {
        carried = sim.inventory.find((slot) => slot?.itemId === item.id)?.count ?? 0;
        if (!sim.canStash(item.id) || item.use.kind === "revive") {
            recommended = "use";
        }
    }
    return {
        uid: chest.uid,
        casketName: casket.name,
        casketObjId: casket.objId,
        tierColor: casket.color,
        rarity: item.rarity,
        coins: chest.coins,
        item: getRunItemView(sim, item, chest.upgrades, withIt),
        upgradedFrom:
            chest.upgradedFrom !== undefined ? getItem(chest.upgradedFrom).name : undefined,
        isGear: item.kind === "gear",
        replaces,
        changes,
        canStash: item.kind === "utility" && sim.canStash(item.id),
        instant: item.kind === "utility" && item.use.kind === "revive",
        carried,
        alchCoins: sim.alchValue(item.id, chest.upgrades),
        recommended,
        queued: sim.chests.length - 1,
        banish: sim.canBanishChest
            ? { set: getItemSet(getItem(chest.upgradedFrom ?? chest.itemId))?.name }
            : undefined,
    };
}

export function getGearViews(sim: Sim): GearSlotView[] {
    return GEAR_SLOTS.map((slot) => {
        const itemId = sim.gear[slot.id];
        return {
            slot: slot.id,
            name: slot.name,
            item:
                itemId !== undefined
                    ? getRunItemView(sim, getItem(itemId), sim.gearUpgrades[slot.id] ?? 0)
                    : undefined,
        };
    });
}

export function getInventoryViews(sim: Sim): InventorySlotView[] {
    return sim.inventory.map((slot) =>
        slot ? { item: getRunItemView(sim, getItem(slot.itemId)), count: slot.count } : null,
    );
}

// What a random event's visitor has on offer, for the screen they open
export function getEventView(sim: Sim): EventView | undefined {
    const offer = sim.offer;
    const effect = offer?.def.effect;
    if (!offer || !effect || (effect.kind !== "shop" && effect.kind !== "quiz")) {
        return undefined;
    }
    const forPoints = offer.options.some((option) => option.kind === "supply");
    return {
        uid: offer.uid,
        name: offer.def.name,
        speech: offer.def.speech ?? "",
        leaveLabel: effect.leaveLabel,
        points: forPoints ? sim.raidPoints : undefined,
        options: offer.options.map((option) => {
            if (option.kind === "answer") {
                const item = getItem(option.itemId);
                return { title: item.name, iconObjId: item.objId, enabled: true };
            }
            if (option.kind === "revive") {
                const item = getItem(EXTRA_REVIVE_ITEM);
                return {
                    title: "Extra revive",
                    text: item.kind === "utility" ? item.description : "",
                    iconObjId: item.objId,
                    price: option.price,
                    sold: option.sold,
                    enabled: !option.sold && sim.coins >= option.price,
                };
            }
            if (option.kind === "teleport") {
                return {
                    title: "Teleport",
                    text: "Uses one of this raid's teleports.",
                    // A teleport tablet
                    iconObjId: 8013,
                    enabled: true,
                };
            }
            if (option.kind === "supply") {
                const supply = getRaidSupply(option.supplyId);
                return {
                    title: supply.name,
                    text: supply.description,
                    iconObjId: supply.objId,
                    price: option.price,
                    sold: option.sold,
                    enabled: !option.sold && sim.raidPoints >= option.price,
                };
            }
            const powerUp = getPowerUp(option.powerUpId);
            return {
                title: powerUp.name,
                text: powerUp.description,
                iconObjId: powerUp.objId,
                price: option.price,
                sold: option.sold,
                enabled: !option.sold && sim.coins >= option.price,
            };
        }),
    };
}

export function getBuffViews(sim: Sim): BuffView[] {
    const timer = (startTick: number, endTick: number) => {
        const ticksLeft = Math.max(0, endTick - sim.tick);
        return {
            secondsLeft: Math.ceil(ticksLeft / TICKS_PER_SECOND),
            fraction: ticksLeft / Math.max(1, endTick - startTick),
        };
    };
    const buffs: BuffView[] = sim.buffs.map((buff) => {
        const { name, objId } = buff.look ?? getItem(buff.itemId);
        return {
            id: buff.itemId,
            name,
            objId,
            ...timer(buff.startTick, buff.endTick),
            harmful: false,
        };
    });
    for (const active of sim.powerUps) {
        const powerUp = getPowerUp(active.id);
        buffs.push({
            id: "powerUp:" + active.uid,
            name: powerUp.name,
            objId: powerUp.objId,
            ...timer(active.startTick, active.endTick),
            harmful: false,
        });
    }
    for (const debuff of sim.debuffs) {
        buffs.push({
            id: debuff.id,
            name: debuff.name,
            objId: debuff.iconObjId,
            ...timer(debuff.startTick, debuff.endTick),
            harmful: true,
        });
    }
    return buffs;
}
