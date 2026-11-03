import { CHARACTERS } from "./characters";
import { getEnemy } from "./enemies";
import { ITEMS } from "./items";
import { getMap } from "./maps";
import { PASSIVES } from "./passives";
import { UnlockTask } from "./types";
import { WEAPONS, getWeapon } from "./weapons";

// Weapons, passives and casket items that a task on a map brings in, the way
// adventurers come in. Everything without an unlock is there from the start.
export type LockableItem = {
    id: string;
    name: string;
    kind: "weapon" | "passive" | "item";
    iconObjId: number;
    unlock: UnlockTask;
};

export const LOCKABLE_ITEMS: LockableItem[] = [
    ...WEAPONS.flatMap((w): LockableItem[] =>
        w.unlock
            ? [{ id: w.id, name: w.name, kind: "weapon", iconObjId: w.iconObjId, unlock: w.unlock }]
            : [],
    ),
    ...PASSIVES.flatMap((p): LockableItem[] =>
        p.unlock
            ? [
                  {
                      id: p.id,
                      name: p.name,
                      kind: "passive",
                      iconObjId: p.iconObjId,
                      unlock: p.unlock,
                  },
              ]
            : [],
    ),
    ...ITEMS.flatMap((i): LockableItem[] =>
        i.unlock
            ? [{ id: i.id, name: i.name, kind: "item", iconObjId: i.objId, unlock: i.unlock }]
            : [],
    ),
];

export const LOCKABLE_ITEM_BY_ID: Map<string, LockableItem> = new Map(
    LOCKABLE_ITEMS.map((i) => [i.id, i]),
);

// Whether a weapon, passive or casket item can turn up in a run: always when
// it has no unlock, otherwise once it's been unlocked. Everything can when
// there's no unlocked set (tests, and the balancing bot by default).
export function isAvailable(
    def: { id: string; unlock?: UnlockTask },
    unlocked: ReadonlySet<string> | undefined,
): boolean {
    return !def.unlock || !unlocked || unlocked.has(def.id);
}

// "10 minutes", or "6:06" when rounding would promise an unlock too soon
function describeSurvival(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes} minutes` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

// "Beat Barrows", "Kill Count Draynor in Lumbridge" (or just "Kill Count
// Draynor" where it's clear which map it's on)
export function describeUnlockTask(task: UnlockTask, withMap = true): string {
    const map = getMap(task.mapId).name;
    const where = withMap ? ` in ${map}` : "";
    switch (task.kind) {
        case "beatMap":
            return task.hard ? `Beat ${map} on hard` : `Beat ${map}`;
        case "killBoss":
            return `Kill ${getEnemy(task.enemyId).name}${where}`;
        case "survive":
            return `Survive ${describeSurvival(task.seconds)}${where}`;
    }
}

// What a task on a map brings in, for its card: adventurers (shown with their
// starting weapon) and items
export type MapReward = {
    kind: "character" | LockableItem["kind"];
    id: string;
    name: string;
    iconObjId: number;
    unlock: UnlockTask;
};

export function getMapRewards(mapId: string): MapReward[] {
    const characters = CHARACTERS.flatMap((c): MapReward[] => {
        if (c.unlock?.mapId !== mapId) {
            return [];
        }
        const weapon = getWeapon(c.startingWeapon);
        return [
            {
                kind: "character",
                id: c.id,
                name: c.name,
                iconObjId: weapon.levels[0].objId ?? weapon.iconObjId,
                unlock: c.unlock,
            },
        ];
    });
    const items = LOCKABLE_ITEMS.filter((i) => i.unlock.mapId === mapId);
    return [...characters, ...items];
}
