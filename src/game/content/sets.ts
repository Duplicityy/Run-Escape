import { CASKET_GEAR, getGear } from "./items";
import { GearDef, GearSlot, ItemDef, SetDef } from "./types";

// Gear sets: pieces that give a bonus when enough of them are worn together.
// The bonus comes before the whole set (3 of the Void knight's 4 pieces, 2 of
// the others' 3), and once a piece is worn, caskets can bring the set's
// missing pieces (see Loot's SET_PIECE_CHANCE), so a set started in a run is a
// little likelier to be finished in it. Which piece is in which set is in
// items.ts.
export const SETS: SetDef[] = [
    {
        id: "void_knight",
        name: "Void knight",
        needed: 3,
        bonus: "+10% damage",
        stats: { might: 0.1 },
    },
    {
        id: "inquisitors",
        name: "Inquisitor's",
        needed: 2,
        bonus: "slashes and sweeps hit 15% harder",
        weapons: { kinds: ["slash", "sweep"], damage: 0.15 },
    },
    {
        id: "crystal_armour",
        name: "Crystal armour",
        needed: 2,
        bonus: "crystal bows and staves hit 20% harder and are 15% faster",
        weapons: {
            ids: ["crystal_bow", "corrupted_bow", "bow_of_faerdhinen", "crystal_staff"],
            damage: 0.2,
            cooldown: 0.15,
        },
    },
    {
        id: "torva",
        name: "Torva",
        needed: 2,
        bonus: "+20% max hitpoints and +1 armour",
        stats: { maxHp: 0.2, armor: 1 },
    },
    {
        id: "virtus",
        name: "Virtus",
        needed: 2,
        bonus: "auras and Ancient spells cover 20% more area",
        weapons: { kinds: ["aura"], area: 0.2 },
    },
];

export const SET_BY_ID: Map<string, SetDef> = new Map(SETS.map((s) => [s.id, s]));

export function getSet(id: string): SetDef {
    const set = SET_BY_ID.get(id);
    if (!set) {
        throw new Error("Unknown set " + id);
    }
    return set;
}

// The set a piece of gear is part of, if any
export function getItemSet(item: ItemDef): SetDef | undefined {
    return item.kind === "gear" && item.set !== undefined ? getSet(item.set) : undefined;
}

// The pieces caskets give of a set (the Armoury's upgrades of them count as
// them when worn)
export function getSetPieces(setId: string): GearDef[] {
    return CASKET_GEAR.filter((g) => g.set === setId);
}

// How many of a set's pieces are worn
export function countSetPieces(worn: Partial<Record<GearSlot, string>>, setId: string): number {
    let count = 0;
    for (const itemId of Object.values(worn)) {
        if (itemId !== undefined && getGear(itemId).set === setId) {
            count++;
        }
    }
    return count;
}

// The sets whose bonus the worn gear gives
export function getActiveSets(worn: Partial<Record<GearSlot, string>>): SetDef[] {
    return SETS.filter((set) => countSetPieces(worn, set.id) >= set.needed);
}

// A set piece's line for the UI. With how many of the set are worn: "Void
// knight 2/4: 3 worn give +10% damage", or once they do, "Void knight 3/4:
// set bonus on, +10% damage". Without: what the set takes.
export function describeSetProgress(set: SetDef, worn?: number): string {
    const total = getSetPieces(set.id).length;
    if (worn === undefined) {
        return `Part of the ${set.name} set: ${set.needed} of its ${total} pieces worn give ${set.bonus}.`;
    }
    if (worn >= set.needed) {
        return `${set.name} ${worn}/${total}: set bonus on, ${set.bonus}.`;
    }
    return `${set.name} ${worn}/${total}: ${set.needed} worn give ${set.bonus}.`;
}
