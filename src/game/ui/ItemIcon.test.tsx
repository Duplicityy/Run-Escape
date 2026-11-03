// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";

import { IconCache, ItemIcon, iconCache } from "./ItemIcon";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ItemIcon", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    test("keeps the coin icon visible while a new stack size loads", () => {
        expect.hasAssertions();
        const previous = "data:image/png;base64,previous";
        const next = "data:image/png;base64,next";
        vi.spyOn(iconCache, "get").mockImplementation((objId, count) =>
            objId === 995 && count === 1 ? previous : undefined,
        );
        let loaded: ((url: string) => void) | undefined;
        vi.spyOn(iconCache, "request").mockImplementation((_objId, count, callback) => {
            if (count === 1000) {
                loaded = callback;
            }
        });
        const { container, rerender } = render(<ItemIcon objId={995} count={1} />);
        expect(container.querySelector("img")).toHaveAttribute("src", previous);
        rerender(<ItemIcon objId={995} count={1000} />);
        expect(container.querySelector("img")).toHaveAttribute("src", previous);
        act(() => loaded!(next));
        expect(container.querySelector("img")).toHaveAttribute("src", next);
    });

    test("does not keep a coin icon when the item changes", () => {
        expect.hasAssertions();
        vi.spyOn(iconCache, "get").mockImplementation((objId) =>
            objId === 995 ? "data:image/png;base64,coins" : undefined,
        );
        vi.spyOn(iconCache, "request").mockImplementation(() => {});
        const { container, rerender } = render(<ItemIcon objId={995} />);
        expect(container.querySelector("img")).not.toBeNull();
        rerender(<ItemIcon objId={4151} />);
        expect(container.querySelector("img")).toBeNull();
    });
});

describe("IconCache", () => {
    test("icons whose load failed are asked for again next time", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        // The first batch's worker fails; later ones are still drawing
        const queueLoad = vi
            .fn()
            .mockRejectedValueOnce(new Error("worker gone"))
            .mockReturnValue(new Promise(() => {}));
        const cache = new IconCache();
        cache.setWorkerPool({ queueLoad } as never);
        const callback = vi.fn();
        cache.request(4151, 1, callback);
        cache.requestSprite(7, callback);
        await tick();
        await tick();
        // Items and sprites each went to the worker once
        expect(queueLoad).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledTimes(1);
        expect(callback).not.toHaveBeenCalled();
        expect(cache.get(4151, 1)).toBeUndefined();

        cache.request(4151, 1, callback);
        cache.requestSprite(7, callback);
        await tick();
        expect(queueLoad).toHaveBeenCalledTimes(4);
        error.mockRestore();
    });

    test("a sprite's frames are asked for with the frame, and kept apart from its icon", async () => {
        const blank = (id: number) => ({ id, width: 0, height: 0, pixels: new Int32Array(0) });
        const queueLoad = vi.fn().mockResolvedValue([blank(815), blank(815)]);
        const cache = new IconCache();
        cache.setWorkerPool({ queueLoad } as never);
        const flag = vi.fn();
        cache.requestFrame(815, 6, flag);
        cache.requestFrame(815, 7, vi.fn());
        await tick();
        await tick();
        expect(queueLoad).toHaveBeenCalledTimes(1);
        expect(queueLoad.mock.calls[0][1]).toEqual({ spriteIds: [815, 815], frames: [6, 7] });
        // A frame the cache hasn't got is "", for the flag's letters instead
        expect(flag).toHaveBeenCalledWith("");
        expect(cache.getFrame(815, 6)).toBe("");
        expect(cache.getSprite(815)).toBeUndefined();
    });

    test("icons on screen when a load failed are asked for again in a moment", async () => {
        vi.useFakeTimers();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const queueLoad = vi
            .fn()
            .mockRejectedValueOnce(new Error("worker gone"))
            .mockReturnValue(new Promise(() => {}));
        const cache = new IconCache();
        cache.setWorkerPool({ queueLoad } as never);
        cache.request(4151, 1, vi.fn());
        await vi.advanceTimersByTimeAsync(1);
        expect(queueLoad).toHaveBeenCalledTimes(1);
        // Nothing asked for it again, and the worker still hears of it
        await vi.advanceTimersByTimeAsync(1100);
        expect(queueLoad).toHaveBeenCalledTimes(2);
        error.mockRestore();
        vi.useRealTimers();
    });
});
