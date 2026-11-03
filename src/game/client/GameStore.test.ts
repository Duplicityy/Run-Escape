import { describe, expect, test } from "vitest";

import { shareUnchanged } from "./GameStore";

describe("shareUnchanged", () => {
    test("is the old object when nothing's changed by value", () => {
        const prev = { a: [1, 2], b: { c: "x" }, d: 3 };
        expect(shareUnchanged(prev, { a: [1, 2], b: { c: "x" }, d: 3 })).toBe(prev);
    });

    test("keeps the fields that are the same, and takes the ones that aren't", () => {
        const prev = { a: [1, 2], b: { c: "x" }, d: 3 };
        const next = { a: [1, 2], b: { c: "y" }, d: 3 };
        const shared = shareUnchanged(prev, next);
        expect(shared).not.toBe(prev);
        expect(shared).toEqual(next);
        expect(shared.a).toBe(prev.a);
        expect(shared.b).toBe(next.b);
    });

    test("keeps the items of a list that haven't changed", () => {
        const prev = { quests: [{ done: 1 }, { done: 2 }, { done: 3 }] };
        const shared = shareUnchanged(prev, { quests: [{ done: 1 }, { done: 5 }, { done: 3 }] });
        expect(shared.quests).not.toBe(prev.quests);
        expect(shared.quests[0]).toBe(prev.quests[0]);
        expect(shared.quests[1]).toEqual({ done: 5 });
        expect(shared.quests[2]).toBe(prev.quests[2]);
    });

    test("sees a field come and go", () => {
        const prev: { a: number; b?: number } = { a: 1 };
        expect(shareUnchanged(prev, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
        expect(shareUnchanged({ a: 1, b: 2 } as typeof prev, { a: 1 })).toEqual({ a: 1 });
        expect(shareUnchanged(undefined, prev)).toBe(prev);
    });
});
