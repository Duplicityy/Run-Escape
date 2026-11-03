import { vec3 } from "gl-matrix";

import { Model, computeTextureCoords } from "../../../rs/model/Model";
import { Scene } from "../../../rs/scene/Scene";
import { SceneTile } from "../../../rs/scene/SceneTile";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { clamp } from "../../../util/MathUtil";
import { DrawRange, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { isTileDrawn } from "../loc/UpperLevels";
import type { CullGrid } from "./CullGrid";
import { VertexBuffer } from "./VertexBuffer";

export enum ContourGroundType {
    CENTER_TILE = 0,
    VERTEX = 1,
    NONE = 2,
}

export type ModelInfo = {
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    contourGround: ContourGroundType;
    priority: number;
    interactType: InteractType;
    interactId: number;
};

export type DrawCommand = {
    offset: number;
    elements: number;
    instances: ModelInfo[];
    // Which of the CullGrid's boxes it's in
    box?: number;
};

export type SceneModel = {
    model: Model;
    sceneHeight: number;
    lowDetail: boolean;
    forceMerge: boolean;
} & ModelInfo;

export type ModelMergeGroup = {
    transparent: boolean;
    lowDetail: boolean;
    level: number;
    priority: number;
    models: SceneModel[];
};

type FaceCallback = (
    index0: number,
    index1: number,
    index2: number,
    // x, y, z of each corner
    corners: number[],
) => void;

const corners = new Array<number>(9).fill(0);

export class SceneBuffer {
    vertexBuf: VertexBuffer;
    indices: number[] = [];

    drawCommands: DrawCommand[] = [];
    drawCommandsAlpha: DrawCommand[] = [];

    drawCommandsLod: DrawCommand[] = [];
    drawCommandsLodAlpha: DrawCommand[] = [];

    drawCommandsInteract: DrawCommand[] = [];
    drawCommandsInteractAlpha: DrawCommand[] = [];

    drawCommandsInteractLod: DrawCommand[] = [];
    drawCommandsInteractLodAlpha: DrawCommand[] = [];

    usedTextureIds = new Set<number>();

    // Square-local model units (x0, z0, x1, z1): geometry placed in the scene
    // that's wholly outside isn't added (SdMapLoaderInput.keepArea)
    keepBox?: number[];

    constructor(
        readonly textureLoader: TextureLoader,
        readonly textureIdIndexMap: Map<number, number>,
        initVertexCount: number,
        // Cuts draws up by where they are, for culling. Draws then only go in
        // the normal lists: there's no LOD or interact lists to keep in step.
        readonly grid?: CullGrid,
    ) {
        this.vertexBuf = new VertexBuffer(initVertexCount);
    }

    // Whether anything in this stretch of the square (model units) is kept
    keeps(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
        const box = this.keepBox;
        return !box || (maxX >= box[0] && minX <= box[2] && maxZ >= box[1] && minZ <= box[3]);
    }

    private keepsTile(tileX: number, tileY: number): boolean {
        return this.keeps(tileX * 128, tileY * 128, tileX * 128 + 128, tileY * 128 + 128);
    }

    vertexCount(): number {
        return this.vertexBuf.offset;
    }

    indexByteOffset(): number {
        return this.indices.length * 4;
    }

    addTerrainTile(tile: SceneTile, offsetX: number, offsetY: number): void {
        const tileModel = tile.tileModel;
        if (!tileModel) {
            return;
        }
        for (const face of tileModel.faces) {
            for (const vertex of face.vertices) {
                const textureIndex = this.textureIdIndexMap.get(vertex.textureId) ?? -1;

                if (textureIndex !== -1) {
                    this.usedTextureIds.add(vertex.textureId);
                }

                const index = this.vertexBuf.addVertex(
                    vertex.x + offsetX,
                    vertex.y,
                    vertex.z + offsetY,
                    vertex.hsl,
                    0xff,
                    vertex.u,
                    vertex.v,
                    textureIndex,
                    0,
                );

                this.indices.push(index);
            }
        }
    }

    // A draw per cell, per level
    private addTerrainCells(
        grid: CullGrid,
        scene: Scene,
        borderSize: number,
        minLevel: number,
        maxLevel: number,
    ): void {
        const vertexOffset = borderSize * -128;
        const size = grid.cellSize;
        for (let level = minLevel; level < scene.levels; level++) {
            for (let cellX = 0; cellX < grid.perSide; cellX++) {
                for (let cellY = 0; cellY < grid.perSide; cellY++) {
                    const indexOffset = this.indexByteOffset();
                    const box = grid.cellBox(cellX * size * 128, cellY * size * 128);
                    const endX = Math.min((cellX + 1) * size, Scene.MAP_SQUARE_SIZE) + borderSize;
                    const endY = Math.min((cellY + 1) * size, Scene.MAP_SQUARE_SIZE) + borderSize;
                    for (let x = cellX * size + borderSize; x < endX; x++) {
                        for (let y = cellY * size + borderSize; y < endY; y++) {
                            const tile = scene.tiles[level][x][y];
                            if (
                                !tile ||
                                !isTileDrawn(scene, tile.minLevel, level, x, y, maxLevel) ||
                                !this.keepsTile(x - borderSize, y - borderSize)
                            ) {
                                continue;
                            }
                            this.addTerrainTile(tile, vertexOffset, vertexOffset);
                            for (const face of tile.tileModel?.faces ?? []) {
                                for (const vertex of face.vertices) {
                                    const vx = vertex.x + vertexOffset;
                                    const vz = vertex.z + vertexOffset;
                                    grid.extend(box, vx, vertex.y, vz, vx, vertex.y, vz);
                                }
                            }
                        }
                    }
                    const elements = (this.indexByteOffset() - indexOffset) / 4;
                    if (elements > 0) {
                        this.drawCommands.push({
                            offset: indexOffset,
                            elements,
                            box,
                            instances: [
                                {
                                    sceneX: 0,
                                    sceneZ: 0,
                                    heightOffset: 0,
                                    level,
                                    contourGround: ContourGroundType.NONE,
                                    priority: 0,
                                    interactType: InteractType.NONE,
                                    interactId: 0xffff,
                                },
                            ],
                        });
                    }
                }
            }
        }
    }

    addTerrain(scene: Scene, borderSize: number, minLevel: number, maxLevel: number): number {
        const terrainStart = this.vertexCount();
        if (this.grid) {
            this.addTerrainCells(this.grid, scene, borderSize, minLevel, maxLevel);
            return this.vertexCount() - terrainStart;
        }

        const startX = borderSize;
        const startY = borderSize;
        const endX = borderSize + Scene.MAP_SQUARE_SIZE;
        const endY = borderSize + Scene.MAP_SQUARE_SIZE;

        const vertexOffset = borderSize * -128;

        const terrainStartVertexCount = this.vertexCount();
        for (let level = minLevel; level < scene.levels; level++) {
            const indexOffset = this.indexByteOffset();
            for (let x = startX; x < endX; x++) {
                for (let y = startY; y < endY; y++) {
                    const tile = scene.tiles[level][x][y];
                    if (
                        !tile ||
                        !isTileDrawn(scene, tile.minLevel, level, x, y, maxLevel) ||
                        !this.keepsTile(x - borderSize, y - borderSize)
                    ) {
                        continue;
                    }
                    this.addTerrainTile(tile, vertexOffset, vertexOffset);
                }
            }

            const levelVertexCount = (this.indexByteOffset() - indexOffset) / 4;

            if (levelVertexCount > 0) {
                const command: DrawCommand = {
                    offset: indexOffset,
                    elements: levelVertexCount,
                    instances: [
                        {
                            sceneX: 0,
                            sceneZ: 0,
                            heightOffset: 0,
                            level,
                            contourGround: ContourGroundType.NONE,
                            priority: 0,
                            interactType: InteractType.NONE,
                            interactId: 0xffff,
                        },
                    ],
                };

                this.drawCommands.push(command);
                this.drawCommandsLod.push(command);
                this.drawCommandsInteract.push(command);
                this.drawCommandsInteractLod.push(command);
            }
        }

        return this.vertexCount() - terrainStartVertexCount;
    }

    addModelAnimFrame(model: Model, transparent: boolean): DrawRange {
        const faces = getModelFaces(model).filter(
            (face) => isModelFaceTransparent(this.textureLoader, face) === transparent,
        );

        const offset = this.indexByteOffset();
        this.addModel(model, faces);
        const elements = (this.indexByteOffset() - offset) / 4;

        return newDrawRange(offset, elements, 1);
    }

    addLocAnimatedGroups(groups: Iterable<LocAnimatedGroup>): LocAnimatedData[] {
        const locsAnimated: LocAnimatedData[] = [];

        for (const group of groups) {
            const bounds = group.anim.bounds;
            for (const loc of group.locs) {
                if (
                    bounds &&
                    !this.keeps(
                        loc.sceneX + bounds.minX,
                        loc.sceneZ + bounds.minZ,
                        loc.sceneX + bounds.maxX,
                        loc.sceneZ + bounds.maxZ,
                    )
                ) {
                    continue;
                }
                locsAnimated.push(this.addLocAnimated(group, loc));
            }
        }

        return locsAnimated;
    }

    private addLocAnimatedCulled(
        grid: CullGrid,
        group: LocAnimatedGroup,
        loc: SceneLocEntity,
    ): LocAnimatedData {
        const anim = group.anim;
        const box = grid.addInstance(loc, anim.bounds!);
        const drawRangeIndex = this.drawCommands.length;
        this.drawCommands.push({ offset: 0, elements: 0, instances: [loc], box });
        const drawRangeAlphaIndex = this.drawCommandsAlpha.length;
        if (anim.framesAlpha) {
            this.drawCommandsAlpha.push({ offset: 0, elements: 0, instances: [loc], box });
        }
        return {
            drawRangeIndex,
            drawRangeAlphaIndex,

            drawRangeLodIndex: -1,
            drawRangeLodAlphaIndex: -1,

            drawRangeInteractIndex: -1,
            drawRangeInteractAlphaIndex: -1,

            drawRangeInteractLodIndex: -1,
            drawRangeInteractLodAlphaIndex: -1,

            anim,
            seqId: loc.entity.seqId,
            randomStart: loc.entity.seqRandomStart,
        };
    }

    addLocAnimated(group: LocAnimatedGroup, loc: SceneLocEntity): LocAnimatedData {
        if (this.grid) {
            return this.addLocAnimatedCulled(this.grid, group, loc);
        }

        const anim = group.anim;

        // Normal (merged)
        const drawRangeIndex = this.drawCommands.length;
        this.drawCommands.push({
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeAlphaIndex = this.drawCommandsAlpha.length;
        if (anim.framesAlpha) {
            this.drawCommandsAlpha.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }
        // Lod (merged)
        let drawRangeLodIndex = -1;
        let drawRangeLodAlphaIndex = -1;
        if (!loc.lowDetail) {
            drawRangeLodIndex = this.drawCommandsLod.length;
            this.drawCommandsLod.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
            if (anim.framesAlpha) {
                drawRangeLodAlphaIndex = this.drawCommandsLodAlpha.length;
                this.drawCommandsLodAlpha.push({
                    offset: 0,
                    elements: 0,
                    instances: [loc],
                });
            }
        }

        // Interact (non merged)
        const drawRangeInteractIndex = this.drawCommandsInteract.length;
        this.drawCommandsInteract.push({
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeInteractAlphaIndex = this.drawCommandsInteractAlpha.length;
        if (anim.framesAlpha) {
            this.drawCommandsInteractAlpha.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }

        // Interact Lod (non merged)
        let drawRangeInteractLodIndex = -1;
        let drawRangeInteractLodAlphaIndex = -1;
        if (!loc.lowDetail) {
            drawRangeInteractLodIndex = this.drawCommandsInteractLod.length;
            this.drawCommandsInteractLod.push({
                offset: 0,
                elements: 0,
                instances: [loc],
            });
            if (anim.framesAlpha) {
                drawRangeInteractLodAlphaIndex = this.drawCommandsInteractLodAlpha.length;
                this.drawCommandsInteractLodAlpha.push({
                    offset: 0,
                    elements: 0,
                    instances: [loc],
                });
            }
        }
        return {
            drawRangeIndex,
            drawRangeAlphaIndex,

            drawRangeLodIndex,
            drawRangeLodAlphaIndex,

            drawRangeInteractIndex,
            drawRangeInteractAlphaIndex,

            drawRangeInteractLodIndex,
            drawRangeInteractLodAlphaIndex,

            anim,
            seqId: loc.entity.seqId,
            randomStart: loc.entity.seqRandomStart,
        };
    }

    // Merged models are plain triangles, so they're cut up by the triangle, and
    // a model bigger than a cell doesn't stretch any box by more than a triangle.
    private addModelGroupCells(grid: CullGrid, group: ModelMergeGroup): void {
        const cells = new Map<number, number[]>();
        for (const sceneModel of group.models) {
            const model = sceneModel.model;
            const faces = getModelFaces(model).filter(
                (face) => isModelFaceTransparent(this.textureLoader, face) === group.transparent,
            );
            const vertexOffset: vec3 = [
                sceneModel.sceneX,
                sceneModel.sceneHeight,
                sceneModel.sceneZ,
            ];
            if (sceneModel.heightOffset !== 0) {
                vertexOffset[1] = -sceneModel.heightOffset;
            }
            this.addModel(model, faces, vertexOffset, true, (i0, i1, i2, p) => {
                const box = grid.cellBox((p[0] + p[3] + p[6]) / 3, (p[2] + p[5] + p[8]) / 3);
                grid.extend(
                    box,
                    Math.min(p[0], p[3], p[6]),
                    Math.min(p[1], p[4], p[7]),
                    Math.min(p[2], p[5], p[8]),
                    Math.max(p[0], p[3], p[6]),
                    Math.max(p[1], p[4], p[7]),
                    Math.max(p[2], p[5], p[8]),
                );
                const cell = cells.get(box);
                if (cell) {
                    cell.push(i0, i1, i2);
                } else {
                    cells.set(box, [i0, i1, i2]);
                }
            });
        }

        const commands = group.transparent ? this.drawCommandsAlpha : this.drawCommands;
        for (const [box, indices] of cells) {
            const offset = this.indexByteOffset();
            for (const index of indices) {
                this.indices.push(index);
            }
            commands.push({
                offset,
                elements: indices.length,
                box,
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: InteractType.NONE,
                        interactId: 0xffff,
                    },
                ],
            });
        }
    }

    addModelGroup(group: ModelMergeGroup): void {
        if (this.grid) {
            this.addModelGroupCells(this.grid, group);
            return;
        }

        const groupOffset = this.indexByteOffset();

        for (const sceneModel of group.models) {
            const model = sceneModel.model;

            const faces = getModelFaces(model).filter(
                (face) => isModelFaceTransparent(this.textureLoader, face) === group.transparent,
            );

            const vertexOffset: vec3 = [
                sceneModel.sceneX,
                sceneModel.sceneHeight,
                sceneModel.sceneZ,
            ];
            if (sceneModel.heightOffset !== 0) {
                vertexOffset[1] = -sceneModel.heightOffset;
            }
            const offset = this.indexByteOffset();
            this.addModel(model, faces, vertexOffset);
            const elements = (this.indexByteOffset() - offset) / 4;

            const drawCommand: DrawCommand = {
                offset: offset,
                elements: elements,
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: sceneModel.interactType,
                        interactId: sceneModel.interactId,
                    },
                ],
            };
            if (group.transparent) {
                this.drawCommandsInteractAlpha.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsInteractLodAlpha.push(drawCommand);
                }
            } else {
                this.drawCommandsInteract.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsInteractLod.push(drawCommand);
                }
            }
        }

        const groupElements = (this.indexByteOffset() - groupOffset) / 4;

        if (groupElements > 0) {
            const drawCommand: DrawCommand = {
                offset: groupOffset,
                elements: groupElements,
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: InteractType.NONE,
                        interactId: 0xffff,
                    },
                ],
            };

            if (group.transparent) {
                this.drawCommandsAlpha.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsLodAlpha.push(drawCommand);
                }
            } else {
                this.drawCommands.push(drawCommand);
                if (!group.lowDetail) {
                    this.drawCommandsLod.push(drawCommand);
                }
            }
        }
    }

    // Takes each face's vertex indices and corners instead of adding it to the
    // index buffer, when onFace is given
    addModel(
        model: Model,
        faces: ModelFace[],
        offset?: vec3,
        reuseVertices: boolean = true,
        onFace?: FaceCallback,
    ): void {
        if (faces.length === 0) {
            return;
        }

        const verticesX = model.verticesX;
        let verticesY = model.verticesY;
        const verticesZ = model.verticesZ;

        let sceneX = 0;
        let sceneZ = 0;
        let sceneHeight = 0;
        if (offset) {
            sceneX = offset[0];
            sceneHeight = offset[1];
            sceneZ = offset[2];
            if (model.contourVerticesY) {
                verticesY = model.contourVerticesY;
            }
        }

        const facesA = model.indices1;
        const facesB = model.indices2;
        const facesC = model.indices3;

        // const modelTexCoords = computeTextureCoords(model);
        const modelTexCoords = model.uvs;

        if (model.faceTextures && !modelTexCoords) {
            throw new Error("Model has face textures but no texture coordinates");
        }

        for (const face of faces) {
            const index = face.index;
            const alpha = face.alpha;
            const priority = face.priority;
            const textureId = face.textureId;
            const textureIndex = this.textureIdIndexMap.get(textureId) ?? -1;

            let hslA = model.faceColors1[index];
            let hslB = model.faceColors2[index];
            let hslC = model.faceColors3[index];

            if (hslC === -1) {
                hslC = hslB = hslA;
            }

            let u0: number = 0;
            let v0: number = 0;
            let u1: number = 0;
            let v1: number = 0;
            let u2: number = 0;
            let v2: number = 0;

            if (modelTexCoords) {
                const texCoordIdx = index * 6;
                u0 = modelTexCoords[texCoordIdx];
                v0 = modelTexCoords[texCoordIdx + 1];
                u1 = modelTexCoords[texCoordIdx + 2];
                v1 = modelTexCoords[texCoordIdx + 3];
                u2 = modelTexCoords[texCoordIdx + 4];
                v2 = modelTexCoords[texCoordIdx + 5];

                // emulate wrapS: PicoGL.CLAMP_TO_EDGE
                // u0 = clamp(u0, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u1 = clamp(u1, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u2 = clamp(u2, 0.00390625 * 3, 1 - 0.00390625 * 3);
            }

            const fa = facesA[index];
            const fb = facesB[index];
            const fc = facesC[index];

            const vxa = sceneX + verticesX[fa];
            const vxb = sceneX + verticesX[fb];
            const vxc = sceneX + verticesX[fc];

            const vya = sceneHeight + verticesY[fa];
            const vyb = sceneHeight + verticesY[fb];
            const vyc = sceneHeight + verticesY[fc];

            const vza = sceneZ + verticesZ[fa];
            const vzb = sceneZ + verticesZ[fb];
            const vzc = sceneZ + verticesZ[fc];

            // Placed in the scene, a triangle can be wholly outside what's kept
            if (
                offset &&
                this.keepBox &&
                !this.keeps(
                    Math.min(vxa, vxb, vxc),
                    Math.min(vza, vzb, vzc),
                    Math.max(vxa, vxb, vxc),
                    Math.max(vza, vzb, vzc),
                )
            ) {
                continue;
            }

            if (textureIndex !== -1) {
                this.usedTextureIds.add(textureId);
            }

            const index0 = this.vertexBuf.addVertex(
                vxa,
                vya,
                vza,
                hslA,
                alpha,
                u0,
                v0,
                textureIndex,
                priority + 1,
                reuseVertices,
            );
            const index1 = this.vertexBuf.addVertex(
                vxb,
                vyb,
                vzb,
                hslB,
                alpha,
                u1,
                v1,
                textureIndex,
                priority + 1,
                reuseVertices,
            );
            const index2 = this.vertexBuf.addVertex(
                vxc,
                vyc,
                vzc,
                hslC,
                alpha,
                u2,
                v2,
                textureIndex,
                priority + 1,
                reuseVertices,
            );

            if (onFace) {
                corners[0] = vxa;
                corners[1] = vya;
                corners[2] = vza;
                corners[3] = vxb;
                corners[4] = vyb;
                corners[5] = vzb;
                corners[6] = vxc;
                corners[7] = vyc;
                corners[8] = vzc;
                onFace(index0, index1, index2, corners);
            } else {
                this.indices.push(index0, index1, index2);
            }
        }
    }
}

export type ModelFace = {
    index: number;
    alpha: number;
    priority: number;
    textureId: number;
};

export function isModelFaceTransparent(textureLoader: TextureLoader, face: ModelFace): boolean {
    return (
        face.alpha < 0xff || (face.textureId !== -1 && textureLoader.isTransparent(face.textureId))
    );
}

export function getModelFaces(model: Model): ModelFace[] {
    const faces: ModelFace[] = [];

    const faceTransparencies = model.faceAlphas;

    const priorities = model.faceRenderPriorities;

    for (let index = 0; index < model.faceCount; index++) {
        let hslC = model.faceColors3[index];

        if (hslC === -2) {
            continue;
        }

        let textureId = -1;
        if (model.faceTextures) {
            textureId = model.faceTextures[index];
        }

        let alpha = 0xff;
        if (faceTransparencies && textureId === -1) {
            alpha = 0xff - (faceTransparencies[index] & 0xff);
        }
        // if (faceTransparencies) {
        //     alpha = 0xff - (faceTransparencies[index] & 0xff);
        // }

        if (alpha === 0 || alpha === 0x1) {
            continue;
        }

        let priority = 0;
        if (priorities) {
            priority = priorities[index];
        }

        faces.push({
            index,
            alpha,
            priority,
            textureId,
        });
    }

    return faces;
}

export function createModelInfoTextureData(drawCommands: DrawCommand[]): Uint16Array {
    const instances: ModelInfo[] = [];
    for (const cmd of drawCommands) {
        instances.push(...cmd.instances);
    }
    const instanceCount = instances.length;

    const dataLength = Math.ceil((drawCommands.length * 4 + instanceCount) / 16) * 16;
    const textureData = new Uint16Array(Math.max(dataLength, 16) * 4);
    let dataOffset = 0;
    drawCommands.forEach((cmd, index) => {
        textureData[index * 4] = drawCommands.length + dataOffset;

        dataOffset += cmd.instances.length;
    });

    instances.forEach((data, index) => {
        let offset = drawCommands.length * 4 + index * 4;

        const contourGround = data.contourGround;

        const height = data.heightOffset;

        textureData[offset++] = data.sceneX | (data.level << 14);
        textureData[offset++] = data.sceneZ | (contourGround << 14);
        textureData[offset++] =
            (data.priority & 0x7) |
            ((data.interactId >> 16) << 3) |
            (data.interactType << 4) |
            (Math.round(height / 8) << 6);
        textureData[offset++] = data.interactId;
    });

    return textureData;
}
