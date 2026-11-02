import { ArmouryUpgrades, getUpgradedGear } from "../content/armoury";
import { GEAR_UPGRADE, getGearStats } from "../content/endless";
import {
    CASKETS,
    CASKET_GEAR,
    CASKET_TIERS,
    UTILITY,
    getGear,
    getItem,
    getVariantScale,
} from "../content/items";
import { RARITIES, RARITY_ORDER, Rarity, rollRarityFrom } from "../content/rarity";
import { SETS, countSetPieces, getItemSet, getSetPieces } from "../content/sets";
import { formatStats } from "../content/stats";
import { CasketTier, GearSlot, ItemDef, SetDef } from "../content/types";
import { isAvailable } from "../content/unlocks";
import { Rng } from "./Rng";

// What's in a reward casket, and what the player does with it.

// Utility items carried at once (used with 1-4); copies stack in one slot
export const MAX_INVENTORY = 4;

// Chance a normal enemy drops a casket (luck makes it likelier)
export const CASKET_DROP_CHANCE = 0.0012;
// Chance a boss's casket is a master one rather than elite (luck makes it
// likelier)
export const MASTER_CASKET_CHANCE = 0.1;

// Relative chance of a utility item next to a piece of gear for an open slot
const UTILITY_WEIGHT = 1.2;
// A Prayer cape (an extra co-op revive) among the rare items, in co-op only
const REVIVE_CASKET_WEIGHT = 0.3;
// Gear no better than what's already worn in its slot turns up less
const SIDEGRADE_WEIGHT = 0.35;
// Chance a casket's item is one of the missing pieces of a set the player has
// started (has a piece of, but not the bonus yet), so those pieces are a little
// likelier than other items. Only a piece the casket's tier could hold (no very
// rare piece from an easy casket), none commoner than the rarity it rolled, and
// none from a set the player's turned a piece of down.
export const SET_PIECE_CHANCE = 0.15;
// How many rarities above the casket's roll that piece can be, so a very rare
// set stays rare in the caskets that seldom hold one
export const SET_PIECE_REACH = 1;

// What a casket's item is picked from (the Armoury's variants are only made
// there)
const CASKET_ITEMS: ItemDef[] = [...CASKET_GEAR, ...UTILITY];

export type InventorySlot = { itemId: string; count: number };

// An opened casket waiting for the player's decision
export type ChestOffer = {
    uid: number;
    tier: CasketTier;
    itemId: string;
    // Gear: times it's upgraded (an endless run's later rounds), 0 otherwise
    upgrades: number;
    // Gear: the piece that came out of the casket, when the Armoury has
    // upgraded it into this one
    upgradedFrom?: string;
    // Already added to the run's coins
    coins: number;
};

// take: wear the gear (the piece it replaces is alched) or put the utility
// item in the inventory; use: use the utility item now; alch: turn it into
// coins
export type ChestAction = "take" | "use" | "alch";

// Elites drop better caskets as the run goes on; the odd casket from a normal
// enemy is a step below. Luck can bump either up a tier, up to elite (master
// caskets only come from bosses).
export function rollCasketTier(
    rng: Rng,
    seconds: number,
    elite: boolean,
    luck: number,
): CasketTier {
    const eliteIndex = CASKET_TIERS.indexOf("elite");
    let index: number;
    if (elite) {
        index = seconds < 300 ? 1 : seconds < 600 ? 2 : eliteIndex;
    } else {
        index = seconds < 450 ? 0 : 1;
    }
    if (index < eliteIndex && rng.chance(Math.max(luck, 0) * 0.5)) {
        index++;
    }
    return CASKET_TIERS[index];
}

// A boss always drops an elite casket, now and then a master one
export function rollBossCasketTier(rng: Rng, luck: number): CasketTier {
    return rng.chance(MASTER_CASKET_CHANCE * (1 + Math.max(luck, 0))) ? "master" : "elite";
}

// Endless runs' gear upgrades: how many times a casket's gear comes upgraded,
// and how many the gear worn has
export type GearUpgrades = { offered: number; worn: Partial<Record<GearSlot, number>> };

// What a piece of gear is worth, for comparing two: its rarity's power (more
// for an Armoury variant), and half that again for each upgrade (so without
// upgrades, the rarer is better)
function gearWorth(item: ItemDef, upgrades: number): number {
    return RARITIES[item.rarity].power * getVariantScale(item) * (1 + upgrades * GEAR_UPGRADE);
}

// Whether a piece of gear (upgraded so many times) beats another
export function isBetterGear(
    item: ItemDef,
    upgrades: number,
    than: ItemDef,
    thanUpgrades: number,
): boolean {
    return gearWorth(item, upgrades) > gearWorth(than, thanUpgrades);
}

// What wearing a piece does for the worn gear's sets: 1 when it's another
// piece of a set started but without its bonus yet, -1 when it takes off a
// piece of a set whose bonus would go, 0 otherwise
export function setChange(gear: Partial<Record<GearSlot, string>>, item: ItemDef): number {
    if (item.kind !== "gear") {
        return 0;
    }
    const worn = gear[item.slot];
    const wornSet = worn !== undefined ? getItemSet(getItem(worn)) : undefined;
    const set = getItemSet(item);
    if (set?.id === wornSet?.id) {
        return 0;
    }
    if (wornSet && countSetPieces(gear, wornSet.id) === wornSet.needed) {
        return -1;
    }
    if (set) {
        const count = countSetPieces(gear, set.id);
        if (count > 0 && count < set.needed) {
            return 1;
        }
    }
    return 0;
}

// Whether a casket's piece of gear should go on over what's worn: when it
// brings a set closer to its bonus, not when it would break a set's bonus,
// otherwise when it's better
export function shouldWear(
    gear: Partial<Record<GearSlot, string>>,
    gearUpgrades: Partial<Record<GearSlot, number>>,
    item: ItemDef,
    upgrades: number,
): boolean {
    if (item.kind !== "gear") {
        return false;
    }
    const change = setChange(gear, item);
    if (change !== 0) {
        return change > 0;
    }
    const worn = gear[item.slot];
    return (
        worn === undefined ||
        !isBetterGear(getItem(worn), gearUpgrades[item.slot] ?? 0, item, upgrades)
    );
}

// The set this item is a piece of, if the player has started it (a piece but
// not the bonus yet)
export function getStartedSet(
    gear: Partial<Record<GearSlot, string>>,
    item: ItemDef,
): SetDef | undefined {
    const set = getItemSet(item);
    if (!set) {
        return undefined;
    }
    const count = countSetPieces(gear, set.id);
    return count > 0 && count < set.needed ? set : undefined;
}

// The missing pieces of the sets the player has started and hasn't turned down
// that a casket of this tier could hold, as caskets give them (before the
// Armoury's upgrades)
function missingSetPieces(
    tier: CasketTier,
    gear: Partial<Record<GearSlot, string>>,
    exclude: string | undefined,
    unlocked: ReadonlySet<string> | undefined,
    armoury: ArmouryUpgrades | undefined,
    declinedSets: ReadonlySet<string> | undefined,
): ItemDef[] {
    const weights = CASKETS[tier].rarityWeights;
    return SETS.flatMap((set) => {
        const count = countSetPieces(gear, set.id);
        if (count === 0 || count >= set.needed || declinedSets?.has(set.id)) {
            return [];
        }
        return getSetPieces(set.id).filter((piece) => {
            const worn = gear[piece.slot];
            return (
                weights[piece.rarity] > 0 &&
                isAvailable(piece, unlocked) &&
                (worn === undefined || getGear(worn).set !== set.id) &&
                getUpgradedGear(piece.id, armoury) !== exclude
            );
        });
    });
}

// How likely an item is to be in a casket for this player: never the piece
// they're already wearing (unless it would come more upgraded), gear that
// would be an upgrade (or another piece of a set they've started) over a
// sidegrade, and antipoisons only on a map with poison. Gear is weighed as
// what the Armoury has upgraded it into. Never an item still locked behind a
// map task.
function itemWeight(
    item: ItemDef,
    gear: Partial<Record<GearSlot, string>>,
    poison: boolean,
    exclude: string | undefined,
    unlocked: ReadonlySet<string> | undefined,
    upgrades: GearUpgrades | undefined,
    armoury: ArmouryUpgrades | undefined,
    party: boolean,
): number {
    if (!isAvailable(item, unlocked)) {
        return 0;
    }
    if (item.kind === "utility") {
        if (item.id === exclude || (item.use.kind === "cure" && !poison)) {
            return 0;
        }
        if (item.use.kind === "revive") {
            return party ? REVIVE_CASKET_WEIGHT : 0;
        }
        return UTILITY_WEIGHT;
    }
    const piece = getItem(getUpgradedGear(item.id, armoury));
    if (piece.id === exclude) {
        return 0;
    }
    const worn = gear[item.slot];
    if (worn === undefined) {
        return 1;
    }
    const offered = upgrades?.offered ?? 0;
    const wornUpgrades = upgrades?.worn[item.slot] ?? 0;
    if (worn === piece.id) {
        return offered > wornUpgrades ? 1 : 0;
    }
    return isBetterGear(piece, offered, getItem(worn), wornUpgrades) || setChange(gear, piece) > 0
        ? 1
        : SIDEGRADE_WEIGHT;
}

// Rolls the casket's rarity from its tier, then an item of that rarity. If
// nothing of that rarity can be given, the nearest rarity below (then above)
// that can. Now and then it's a missing piece of a set the player has
// started instead (SET_PIECE_CHANCE), one that rare or a little rarer
// (SET_PIECE_REACH). poison: whether anything on the map poisons (see
// hasPoison).
// exclude: an item it mustn't come out as (the one a reroll replaces).
// unlocked: the items brought in by map tasks (everything when unset).
// upgrades: what gear comes with and what's worn has (none when unset).
// armoury: the pieces upgraded in the Armoury (none when unset).
// declinedSets: sets the player has turned a piece of down this run (see
// getStartedSet), which stop being brought (none when unset).
// party: a co-op run, the only place an extra revive turns up. Returns the item
// as it's found, before the Armoury's upgrades (see getUpgradedGear).
export function rollCasketItem(
    rng: Rng,
    tier: CasketTier,
    luck: number,
    gear: Partial<Record<GearSlot, string>>,
    poison: boolean,
    exclude?: string,
    unlocked?: ReadonlySet<string>,
    upgrades?: GearUpgrades,
    armoury?: ArmouryUpgrades,
    declinedSets?: ReadonlySet<string>,
    party = false,
): string {
    const rarity = rollRarityFrom(CASKETS[tier].rarityWeights, () => rng.next(), luck);
    const index = RARITY_ORDER.indexOf(rarity);
    // The rarity is rolled first, so a set piece never takes the place of a
    // rarer item (a master casket's very rare roll isn't an uncommon Void
    // piece), though it can stand in for one a little commoner
    const missing = missingSetPieces(tier, gear, exclude, unlocked, armoury, declinedSets).filter(
        (piece) => {
            const above = RARITY_ORDER.indexOf(piece.rarity) - index;
            return above >= 0 && above <= SET_PIECE_REACH;
        },
    );
    if (missing.length > 0 && rng.chance(SET_PIECE_CHANCE)) {
        return missing[rng.int(missing.length)].id;
    }
    const order: Rarity[] = [
        rarity,
        ...RARITY_ORDER.slice(0, index).reverse(),
        ...RARITY_ORDER.slice(index + 1),
    ];
    for (const r of order) {
        const pool = CASKET_ITEMS.filter((item) => item.rarity === r);
        const pick = rng.weightedIndex(
            pool.map((item) =>
                itemWeight(item, gear, poison, exclude, unlocked, upgrades, armoury, party),
            ),
        );
        if (pick !== -1) {
            return pool[pick].id;
        }
    }
    // Utility items always have weight, so this can't happen
    return UTILITY[0].id;
}

// Coins for high alching an item (upgraded gear, and the Armoury's variants,
// are worth more)
export function getAlchValue(item: ItemDef, greed: number, upgrades = 0): number {
    return Math.round(
        RARITIES[item.rarity].alchValue *
            getVariantScale(item) *
            (1 + upgrades * GEAR_UPGRADE) *
            (1 + greed),
    );
}

// What an item does, a line per stat or effect
export function describeItem(item: ItemDef, upgrades = 0): string[] {
    return item.kind === "gear" ? formatStats(getGearStats(item, upgrades)) : [item.description];
}

// The slot a utility item would go in: its own stack, else the first empty one
export function findInventorySlot(
    inventory: readonly (InventorySlot | null)[],
    itemId: string,
): number {
    const stack = inventory.findIndex((slot) => slot?.itemId === itemId);
    return stack !== -1 ? stack : inventory.findIndex((slot) => slot === null);
}
