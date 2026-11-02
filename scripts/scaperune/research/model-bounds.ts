// How big a loc's models really are, in height units over and under its origin, and how far
// they reach past its tiles. Finds hidden geometry: skirts below ground, tall backdrops, floors
// with a drop built in.
//
//   npx tsx scripts/scaperune/research/model-bounds.ts 45881 48332 ...
import { openWorld } from "./lib";

const w = openWorld();
const models = w.factory.getModelLoader();
for (const arg of process.argv.slice(2)) {
    const id = Number(arg);
    const type = w.locTypes.load(id);
    const ids = type.models?.flat() ?? [];
    let minY = 1e9;
    let maxY = -1e9;
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    let faces = 0;
    let vertices = 0;
    for (const modelId of ids) {
        const model = models.getModel(modelId);
        if (!model) continue;
        faces += model.faceCount;
        vertices += model.verticesCount;
        for (let v = 0; v < model.verticesCount; v++) {
            minX = Math.min(minX, model.verticesX[v]);
            maxX = Math.max(maxX, model.verticesX[v]);
            // Up's negative in a model
            minY = Math.min(minY, -model.verticesY[v]);
            maxY = Math.max(maxY, -model.verticesY[v]);
            minZ = Math.min(minZ, model.verticesZ[v]);
            maxZ = Math.max(maxZ, model.verticesZ[v]);
        }
    }
    const sx = type.modelSizeX / 128;
    const sy = type.modelSizeHeight / 128;
    const sz = type.modelSizeY / 128;
    const tiles = (v: number) => Math.round((v * 10) / 128) / 10;
    console.log(
        `${id} ${type.name} ${type.sizeX}x${type.sizeY} clip${type.clipType} contour ${type.contouredGround} seq ${type.seqId}` +
            ` models ${ids.length} tris ${faces} verts ${vertices}` +
            ` | height tiles ${tiles(minY * sy)}..${tiles(maxY * sy)}` +
            ` | x ${tiles(minX * sx)}..${tiles(maxX * sx)} z ${tiles(minZ * sz)}..${tiles(maxZ * sz)}` +
            ` | scale ${sx},${sy},${sz} recolor ${type.retextureFrom?.length ?? 0}/${type.recolorFrom?.length ?? 0} offsets ${type.offsetX},${type.offsetHeight},${type.offsetY} actions ${(type.actions ?? []).filter(Boolean).join("|")} types ${(type.types ?? []).join(",")}`,
    );
}
