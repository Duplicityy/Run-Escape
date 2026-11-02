// Prints a SHA-256 of what a recipe writes, square by square and for the whole map, so that a
// change meant to leave a map alone can prove it did. `halloween` ships: its hash mustn't move.
//
//   npx tsx scripts/scaperune/grid-hash.ts halloween [scaperune_ysmar ...]
//   VERBOSE=1 npx tsx scripts/scaperune/grid-hash.ts halloween    # each square's too
import crypto from "node:crypto";

import {
    buildRecipeSquares,
    createBuildContext,
    getRecipe,
} from "../../src/game/scaperune/squares";
import { createSceneBuilder, loadGameCache } from "../cache/scene-util";

const ids = process.argv.slice(2);
if (ids.length === 0) {
    ids.push("halloween");
}
const { mapFileLoader, locTypeLoader } = createSceneBuilder(loadGameCache());
const context = createBuildContext(mapFileLoader, locTypeLoader);
for (const id of ids) {
    const recipe = getRecipe(id);
    if (!recipe) {
        throw new Error(`No recipe called ${id}`);
    }
    const squares = buildRecipeSquares(recipe, context);
    const whole = crypto.createHash("sha256");
    for (const [square, { terrain, locs }] of [...squares].sort((a, b) => a[0] - b[0])) {
        const one = crypto.createHash("sha256").update(terrain).update(locs).digest("hex");
        whole.update(one);
        if (process.env.VERBOSE) {
            console.log(`  ${square}: ${one}`);
        }
    }
    console.log(`${id}: ${whole.digest("hex")}`);
}
