import { FlightGrid } from "./FlightGrid";
import { FlowField, StepGrid, canStep, canWalkStraight } from "./FlowField";
import { makeGrid } from "./testGrid";

describe("canWalkStraight", () => {
    const grid = makeGrid([
        //
        ".......",
        ".|.....",
        "...#...",
        ".......",
    ]);

    test("across open ground, any way round", () => {
        expect(canWalkStraight(grid, 100.5, 200.5, 106.5, 200.5)).toBe(true);
        expect(canWalkStraight(grid, 106.5, 200.5, 100.5, 200.5)).toBe(true);
        expect(canWalkStraight(grid, 104.5, 200.5, 106.5, 203.5)).toBe(true);
        expect(canWalkStraight(grid, 102.2, 200.7, 102.2, 200.1)).toBe(true);
    });

    test("not through something solid", () => {
        expect(canWalkStraight(grid, 100.5, 201.5, 106.5, 201.5)).toBe(false);
        expect(canWalkStraight(grid, 106.5, 201.5, 100.5, 201.5)).toBe(false);
        expect(canWalkStraight(grid, 103.5, 200.5, 103.5, 203.5)).toBe(false);
    });

    test("not through a wall, from either side", () => {
        expect(canWalkStraight(grid, 100.5, 202.5, 103.5, 202.5)).toBe(false);
        expect(canWalkStraight(grid, 103.5, 202.5, 100.5, 202.5)).toBe(false);
    });

    test("not by a corner it can't get round", () => {
        expect(canWalkStraight(grid, 102.5, 200.5, 103.5, 201.5)).toBe(false);
        expect(canWalkStraight(grid, 102.5, 201.5, 103.5, 200.5)).toBe(false);
    });
});

describe("canStep", () => {
    const grid = makeGrid([".....", ".|...", "....."]);

    test("walls block both ways", () => {
        expect(canStep(grid, 101, 201, 1, 0)).toBe(false);
        expect(canStep(grid, 102, 201, -1, 0)).toBe(false);
        expect(canStep(grid, 101, 201, 0, 1)).toBe(true);
    });

    test("diagonals need both corners open", () => {
        expect(canStep(grid, 101, 200, 1, 1)).toBe(false);
        expect(canStep(grid, 101, 202, 1, -1)).toBe(false);
        expect(canStep(grid, 102, 202, 1, -1)).toBe(true);
    });
});

describe("FlowField", () => {
    test("routes around a wall", () => {
        // Target on the right; a wall with a gap at the top
        const grid = makeGrid([
            "...........",
            "....#......",
            "....#......",
            "....#......",
            "....#......",
        ]);
        const field = new FlowField(16);
        field.update(grid, 108, 202);
        expect(field.getCost(108, 202)).toBe(0);
        // Straight right is walled off, so the route goes up through the gap
        const step = { x: 0, y: 0 };
        expect(field.getStep(grid, 103, 202, step)).toBe(true);
        expect(step.y).toBe(1);
        expect(field.getCost(103, 202)).toBeGreaterThan(field.getCost(105, 202) + 20);
    });

    test("water is unreachable", () => {
        const grid = makeGrid(["..~..", "..~..", "..~.."]);
        const field = new FlowField(16);
        field.update(grid, 104, 201);
        expect(field.isReachable(103, 201)).toBe(true);
        expect(field.isReachable(100, 201)).toBe(false);
        const step = { x: 0, y: 0 };
        expect(field.getStep(grid, 100, 201, step)).toBe(false);
    });

    test("steps always lead downhill to the target", () => {
        const grid = makeGrid([
            "..........",
            ".###.####.",
            ".#......#.",
            ".#.####.#.",
            ".#......#.",
            ".####.###.",
            "..........",
        ]);
        const field = new FlowField(32);
        field.update(grid, 104, 202);
        const step = { x: 0, y: 0 };
        let x = 100;
        let y = 200;
        for (let i = 0; i < 64 && !(x === 104 && y === 202); i++) {
            expect(field.getStep(grid, x, y, step)).toBe(true);
            const before = field.getCost(x, y);
            x += step.x;
            y += step.y;
            expect(field.getCost(x, y)).toBeLessThan(before);
        }
        expect([x, y]).toEqual([104, 202]);
    });

    test("jumps a ditch straight across, both ways", () => {
        // A ditch two rows deep, its south row at y 202, all the way across
        const grid = makeGrid([".....", ".....", "#####", "#####", ".....", "....."]);
        const field = new FlowField(16);
        field.ditchY = 202;
        field.update(grid, 102, 205);
        const step = { x: 0, y: 0 };
        expect(field.isReachable(102, 200)).toBe(true);
        expect(field.getStep(grid, 102, 201, step)).toBe(true);
        expect(step).toEqual({ x: 0, y: 3 });
        // Coming back the other way
        field.update(grid, 102, 200);
        expect(field.getStep(grid, 102, 204, step)).toBe(true);
        expect(step).toEqual({ x: 0, y: -3 });
        // Away from the edge it walks up to it first
        expect(field.getStep(grid, 102, 205, step)).toBe(true);
        expect(step.y).toBe(-1);
    });

    test("walks round a ditch's end when that's quicker than jumping", () => {
        // A gap at the east end of the ditch
        const grid = makeGrid([
            "..........",
            "..........",
            "########..",
            "########..",
            "..........",
            "..........",
        ]);
        const field = new FlowField(32);
        field.ditchY = 202;
        field.update(grid, 100, 205);
        const step = { x: 0, y: 0 };
        // Right below the target: over
        expect(field.getStep(grid, 100, 201, step)).toBe(true);
        expect(step).toEqual({ x: 0, y: 3 });
        // At the gap: through it
        expect(field.getStep(grid, 109, 201, step)).toBe(true);
        expect(Math.abs(step.y)).toBe(1);
    });

    test("nothing jumps without a ditch", () => {
        const grid = makeGrid([".....", "#####", "#####", "....."]);
        const field = new FlowField(16);
        field.update(grid, 102, 203);
        expect(field.isReachable(102, 200)).toBe(false);
    });
});

describe("Steps", () => {
    // Every step out of every tile, and the ring of tiles round the grid
    function expectCanStep(grid: StepGrid & { steps: NonNullable<StepGrid["steps"]> }) {
        const DIRS = [
            [0, 1],
            [1, 0],
            [0, -1],
            [-1, 0],
            [1, 1],
            [1, -1],
            [-1, -1],
            [-1, 1],
        ];
        for (let y = 199; y <= 207; y++) {
            for (let x = 99; x <= 108; x++) {
                DIRS.forEach(([dx, dy], d) => {
                    expect(grid.steps.can(x, y, d)).toBe(canStep(grid, x, y, dx, dy));
                });
            }
        }
    }

    const grid = makeGrid([
        //
        "..#.....",
        ".|..~~..",
        "._.o..#.",
        "...|.#..",
        "#..__...",
        "..o..|.#",
    ]);

    test("are canStep's answers", () => {
        expectCanStep(grid);
    });

    test("are canStep's answers for what flies too", () => {
        expectCanStep(new FlightGrid(grid));
    });
});
