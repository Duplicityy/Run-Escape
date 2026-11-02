import { describeUnlockTask } from "./unlocks";

describe("describeUnlockTask", () => {
    it("gives a survive task in minutes when it's whole minutes", () => {
        const task = { kind: "survive", mapId: "wilderness", seconds: 600 } as const;
        expect(describeUnlockTask(task)).toBe("Survive 10 minutes in Wilderness");
    });

    it("gives the exact time when it isn't, so it doesn't promise it too soon", () => {
        const task = { kind: "survive", mapId: "falador", seconds: 366 } as const;
        expect(describeUnlockTask(task)).toBe("Survive 6:06 in Falador");
        expect(describeUnlockTask(task, false)).toBe("Survive 6:06");
    });
});
