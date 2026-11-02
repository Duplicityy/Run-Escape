// @vitest-environment jsdom
import { IconCache } from "./ItemIcon";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
});
