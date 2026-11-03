import { BasTypeLoader } from "../../../rs/config/bastype/BasTypeLoader";
import { ContourGroundInfo, LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocType } from "../../../rs/config/loctype/LocType";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { ObjModelLoader } from "../../../rs/config/objtype/ObjModelLoader";
import { VarManager } from "../../../rs/config/vartype/VarManager";
import { Model } from "../../../rs/model/Model";
import { Scene } from "../../../rs/scene/Scene";
import { LocEntity } from "../../../rs/scene/entity/LocEntity";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { NpcSpawn, getMapNpcSpawns } from "../../data/npc/NpcSpawn";
import { ObjSpawn, getMapObjSpawns } from "../../data/obj/ObjSpawn";
import { loadMinimapBlob } from "../../worker/MinimapData";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import {
    CullGrid,
    ModelBounds,
    addModelBounds,
    getModelBounds,
    newBounds,
} from "../buffer/CullGrid";
import { ModelHashBuffer, getModelHash } from "../buffer/ModelHashBuffer";
import {
    ContourGroundType,
    DrawCommand,
    ModelFace,
    ModelInfo,
    ModelMergeGroup,
    SceneBuffer,
    SceneModel,
    createModelInfoTextureData,
    getModelFaces,
    isModelFaceTransparent,
} from "../buffer/SceneBuffer";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { getSceneLocs, isLowDetail } from "../loc/SceneLocs";
import { createNpcDatas } from "../npc/NpcData";
import { NpcSpawnGroup } from "../npc/NpcSpawnGroup";
import { SdMapData } from "./SdMapData";
import { SdMapLoaderInput } from "./SdMapLoaderInput";
import { createTextureIdIndexMap, getSdTextureIds } from "./TextureIndex";

// keepArea (world tiles) as a box local to the square (model units), or
// undefined if the square and its border are all inside it
function getKeepBox(
    keepArea: number[] | undefined,
    mapX: number,
    mapY: number,
    borderSize: number,
): number[] | undefined {
    if (!keepArea) {
        return undefined;
    }
    const baseX = mapX * Scene.MAP_SQUARE_SIZE;
    const baseZ = mapY * Scene.MAP_SQUARE_SIZE;
    const size = Scene.MAP_SQUARE_SIZE;
    if (
        keepArea[0] <= baseX - borderSize &&
        keepArea[1] <= baseZ - borderSize &&
        keepArea[2] >= baseX + size + borderSize &&
        keepArea[3] >= baseZ + size + borderSize
    ) {
        return undefined;
    }
    return [
        (keepArea[0] - baseX) * 128,
        (keepArea[1] - baseZ) * 128,
        (keepArea[2] - baseX) * 128,
        (keepArea[3] - baseZ) * 128,
    ];
}

// The instances of one model the square keeps: the ones not wholly outside
function keepInstances(sceneBuf: SceneBuffer, model: Model, instances: SceneModel[]): SceneModel[] {
    if (!sceneBuf.keepBox) {
        return instances;
    }
    const bounds = getModelBounds(model);
    return instances.filter(({ sceneX: x, sceneZ: z }) =>
        sceneBuf.keeps(x + bounds.minX, z + bounds.minZ, x + bounds.maxX, z + bounds.maxZ),
    );
}

function loadHeightMapTextureData(scene: Scene): Int16Array {
    const heightMapTextureData = new Int16Array(Scene.MAX_LEVELS * scene.sizeX * scene.sizeY);

    let dataIndex = 0;
    for (let level = 0; level < scene.levels; level++) {
        for (let y = 0; y < scene.sizeY; y++) {
            for (let x = 0; x < scene.sizeX; x++) {
                heightMapTextureData[dataIndex++] =
                    (-scene.tileHeights[level][x][y] / Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
            }
        }
    }

    return heightMapTextureData;
}

function createObjSceneModels(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawns: ObjSpawn[],
): void {
    for (const spawn of spawns) {
        createObjSceneModel(objModelLoader, sceneModels, scene, borderSize, spawn);
    }
}

function createObjSceneModel(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawn: ObjSpawn,
): void {
    const objType = objModelLoader.objTypeLoader.load(spawn.id);
    if (objType.name === "null") {
        return;
    }

    const localX = spawn.x % 64;
    const localY = spawn.y % 64;

    const tileX = localX + borderSize;
    const tileY = localY + borderSize;

    const model = objModelLoader.getModel(spawn.id, spawn.count);
    if (!model) {
        return undefined;
    }

    let renderLevel = spawn.plane;
    if (renderLevel < 3 && (scene.tileRenderFlags[1][tileX][tileY] & 0x2) === 2) {
        renderLevel = spawn.plane + 1;
    }

    const sceneHeight = scene.getCenterHeight(renderLevel, tileX, tileY);

    let heightOffset = 0;
    const tile = scene.tiles[renderLevel][tileX][tileY];
    if (!tile || !tile.tileModel || tile.tileModel.faces.length === 0) {
        return undefined;
    }
    if (tile) {
        for (const loc of tile.locs) {
            if ((loc.flags & 256) === 256 && loc.entity instanceof Model) {
                const model = loc.entity;
                model.calculateBoundsCylinder();
                if (model.contourHeight > heightOffset) {
                    heightOffset = model.contourHeight;
                }
            }
        }
    }

    let contourGround = ContourGroundType.CENTER_TILE;

    if (heightOffset !== 0) {
        heightOffset -= sceneHeight;
        contourGround = ContourGroundType.NONE;
    }

    sceneModels.push({
        model,
        lowDetail: false,
        forceMerge: false,
        sceneHeight,
        sceneX: localX * 128 + 64,
        sceneZ: localY * 128 + 64,
        heightOffset,
        level: renderLevel,
        contourGround,
        priority: 10,
        interactType: InteractType.OBJ,
        interactId: spawn.id,
    });
}

// One draw of the model per box its instances are in, all on the same geometry
function addCulledInstances(
    grid: CullGrid,
    commands: DrawCommand[],
    model: Model,
    offset: number,
    elements: number,
    instances: ModelInfo[],
): void {
    const bounds = getModelBounds(model);
    const byBox = new Map<number, ModelInfo[]>();
    for (const instance of instances) {
        const box = grid.addInstance(instance, bounds);
        const list = byBox.get(box);
        if (list) {
            list.push(instance);
        } else {
            byBox.set(box, [instance]);
        }
    }
    for (const [box, list] of byBox) {
        commands.push({ offset, elements, instances: list, box });
    }
}

function createModelGroups(
    modelGroupMap: Map<number, ModelMergeGroup>,
    sceneModels: SceneModel[],
    transparent: boolean,
    keepLowDetail: boolean,
): void {
    for (const sceneModel of sceneModels) {
        const lowDetail = keepLowDetail && sceneModel.lowDetail;
        const key =
            Number(transparent) |
            ((lowDetail ? 1 : 0) << 1) |
            (sceneModel.level << 2) |
            (sceneModel.priority << 4);

        const group = modelGroupMap.get(key);
        if (group) {
            group.models.push(sceneModel);
        } else {
            modelGroupMap.set(key, {
                transparent,
                lowDetail,
                level: sceneModel.level,
                priority: sceneModel.priority,
                models: [sceneModel],
            });
        }
    }
}

function addSceneModels(
    modelHashBuf: ModelHashBuffer,
    textureLoader: TextureLoader,
    sceneBuf: SceneBuffer,
    sceneModels: SceneModel[],
    minimizeDrawCalls: boolean,
): void {
    const groupedModels = new Map<number, SceneModel[]>();
    for (const sceneModel of sceneModels) {
        const model = sceneModel.model;
        const hash = getModelHash(modelHashBuf, model);
        const locs = groupedModels.get(hash);
        if (locs) {
            locs.push(sceneModel);
        } else {
            groupedModels.set(hash, [sceneModel]);
        }
    }

    const grid = sceneBuf.grid;
    // With a grid there's no LOD draws to tell low detail models apart for
    const keepLowDetail = !grid;

    const modelGroupMap: Map<number, ModelMergeGroup> = new Map();
    for (const sceneModels of groupedModels.values()) {
        const model = sceneModels[0].model;
        const faces = getModelFaces(model);

        const opaqueFaces: ModelFace[] = [];
        const transparentFaces: ModelFace[] = [];
        for (const face of faces) {
            if (isModelFaceTransparent(textureLoader, face)) {
                transparentFaces.push(face);
            } else {
                opaqueFaces.push(face);
            }
        }

        const mergeModels: SceneModel[] = [];
        const instancedModels: SceneModel[] = [];
        const lodModels: SceneModel[] = [];
        for (const sceneModel of sceneModels) {
            if (sceneModel.forceMerge) {
                mergeModels.push(sceneModel);
            } else {
                instancedModels.push(sceneModel);
                if (!sceneModel.lowDetail) {
                    lodModels.push(sceneModel);
                }
            }
        }

        createModelGroups(modelGroupMap, mergeModels, false, keepLowDetail);
        if (transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, mergeModels, true, keepLowDetail);
        }

        const instanceCount = instancedModels.length;
        const mergeOpaque =
            instanceCount === 1 || instanceCount * opaqueFaces.length < 100 || minimizeDrawCalls;
        const mergeTransparent =
            instanceCount === 1 ||
            instanceCount * transparentFaces.length < 100 ||
            minimizeDrawCalls;

        // mergeOpaque = false;
        // mergeTransparent = false;

        // Whether to merge goes by every instance, kept or not, so that what the
        // square keeps is drawn just as it would be. Merged models are cut by
        // the triangle (SceneBuffer.keepBox); these by the instance.
        const keptModels =
            mergeOpaque && mergeTransparent
                ? sceneModels
                : keepInstances(sceneBuf, model, sceneModels);

        if (mergeOpaque) {
            createModelGroups(modelGroupMap, instancedModels, false, keepLowDetail);
        } else if (opaqueFaces.length > 0 && keptModels.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, opaqueFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            if (grid) {
                addCulledInstances(
                    grid,
                    sceneBuf.drawCommands,
                    model,
                    indexOffset,
                    elementCount,
                    keptModels,
                );
            } else {
                const drawCommand: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: sceneModels,
                };

                sceneBuf.drawCommands.push(drawCommand);
                sceneBuf.drawCommandsInteract.push(drawCommand);
                if (lodModels.length > 0) {
                    const drawCommandLod: DrawCommand = {
                        offset: indexOffset,
                        elements: elementCount,
                        instances: lodModels,
                    };
                    sceneBuf.drawCommandsLod.push(drawCommandLod);
                    sceneBuf.drawCommandsInteractLod.push(drawCommandLod);
                }
            }
        }

        if (mergeTransparent && transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, instancedModels, true, keepLowDetail);
        } else if (transparentFaces.length > 0 && keptModels.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, transparentFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            if (grid) {
                addCulledInstances(
                    grid,
                    sceneBuf.drawCommandsAlpha,
                    model,
                    indexOffset,
                    elementCount,
                    keptModels,
                );
            } else {
                const drawCommand: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: sceneModels,
                };

                sceneBuf.drawCommandsAlpha.push(drawCommand);
                sceneBuf.drawCommandsInteractAlpha.push(drawCommand);
                if (lodModels.length > 0) {
                    const drawCommandLod: DrawCommand = {
                        offset: indexOffset,
                        elements: elementCount,
                        instances: lodModels,
                    };
                    sceneBuf.drawCommandsLodAlpha.push(drawCommandLod);
                    sceneBuf.drawCommandsInteractLodAlpha.push(drawCommandLod);
                }
            }
        }
    }

    for (const group of modelGroupMap.values()) {
        sceneBuf.addModelGroup(group);
    }
}

function getLocAnimationFrameCount(locModelLoader: LocModelLoader, entity: LocEntity): number {
    const seqType = locModelLoader.seqTypeLoader.load(entity.seqId);
    if (seqType.isSkeletalSeq()) {
        return seqType.getSkeletalDuration();
    }
    return seqType.frameIds?.length ?? 0;
}

// The extent of every frame of a loc's animation, without adding them
function getLocAnimationBounds(
    locModelLoader: LocModelLoader,
    entity: LocEntity,
    locType: LocType,
): ModelBounds {
    const bounds = newBounds();
    const frameCount = getLocAnimationFrameCount(locModelLoader, entity);
    for (let i = 0; i < frameCount; i++) {
        const model = locModelLoader.getModelAnimated(
            locType,
            entity.type,
            entity.rotation,
            entity.seqId,
            i,
        );
        if (model) {
            addModelBounds(bounds, model);
        }
    }
    return bounds;
}

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    sceneBuf: SceneBuffer,
    entity: LocEntity,
    locType: LocType,
): AnimationFrames | undefined {
    const frameCount = getLocAnimationFrameCount(locModelLoader, entity);
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    const bounds = newBounds();
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = locModelLoader.getModelAnimated(
            locType,
            entity.type,
            entity.rotation,
            entity.seqId,
            i,
        );
        if (model) {
            addModelBounds(bounds, model);
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
        bounds,
    };
}

function addLocEntities(
    centerLocHeightWithSize: boolean,
    locModelLoader: LocModelLoader,
    varManager: VarManager,
    scene: Scene,
    sceneModels: SceneModel[],
    sceneBuf: SceneBuffer,
    locEntities: SceneLocEntity[],
): Iterable<LocAnimatedGroup> {
    // Each animated loc and its model, rotation and type's group: baked once
    // they're all in, so a square that keeps only some of the world can leave
    // out a group none of it keeps
    const animatedGroups = new Map<
        number,
        { entity: LocEntity; locType: LocType; locs: SceneLocEntity[] }
    >();

    for (const sceneLocEntity of locEntities) {
        const entity = sceneLocEntity.entity;
        const id = entity.id;
        const type = entity.type;
        const rotation = entity.rotation;
        const tileX = entity.tileX;
        const tileY = entity.tileY;
        const level = entity.level;

        let locType = locModelLoader.locTypeLoader.load(id);
        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (rotation === 1 || rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }

        if (locType.transforms) {
            const transformed = locType.transform(varManager, locModelLoader.locTypeLoader);
            if (!transformed) {
                continue;
            }
            locType = transformed;
        }

        let startX = (sizeX >> 1) + tileX;
        let endX = ((sizeX + 1) >> 1) + tileX;
        let startY = (sizeY >> 1) + tileY;
        let endY = ((sizeY + 1) >> 1) + tileY;

        if (!centerLocHeightWithSize) {
            startX = tileX;
            endX = tileX + 1;
            startY = tileY;
            endY = tileY + 1;
        }

        const heightMap = scene.tileHeights[level];
        let heightMapAbove: Int32Array[] | undefined;
        if (entity.level < scene.levels - 1) {
            heightMapAbove = scene.tileHeights[level + 1];
        }

        const centerHeight =
            (heightMap[endX][endY] +
                heightMap[startX][endY] +
                heightMap[startX][startY] +
                heightMap[endX][startY]) >>
            2;
        const entityX = (tileX << 7) + (sizeX << 6);
        const entityZ = (tileY << 7) + (sizeY << 6);

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: entityX,
            entityY: centerHeight,
            entityZ: entityZ,
        };
        const lowDetail = isLowDetail(scene, level, tileX, tileY, locType, type);
        if (entity.seqId !== -1) {
            const loc = {
                ...sceneLocEntity,
                lowDetail,
                interactId: locType.id,
            };

            const key = rotation + (type << 3) + (locType.id << 10);
            const group = animatedGroups.get(key);
            if (group) {
                group.locs.push(loc);
            } else {
                animatedGroups.set(key, { entity, locType, locs: [loc] });
            }
        } else {
            const model = locModelLoader.getModelAnimated(
                locType,
                type,
                rotation,
                -1,
                -1,
                contourGroundInfo,
            );
            if (!model) {
                continue;
            }
            sceneModels.push({
                ...sceneLocEntity,

                model,
                sceneHeight: centerHeight,
                lowDetail,
                forceMerge: locType.contourGroundType > 1,
                interactId: locType.id,
            });
        }
    }

    const locAnimatedGroups: LocAnimatedGroup[] = [];
    for (const { entity, locType, locs } of animatedGroups.values()) {
        if (sceneBuf.keepBox) {
            const bounds = getLocAnimationBounds(locModelLoader, entity, locType);
            const kept = locs.some((loc) =>
                sceneBuf.keeps(
                    loc.sceneX + bounds.minX,
                    loc.sceneZ + bounds.minZ,
                    loc.sceneX + bounds.maxX,
                    loc.sceneZ + bounds.maxZ,
                ),
            );
            if (!kept) {
                continue;
            }
        }
        const anim = addLocAnimationFrames(locModelLoader, sceneBuf, entity, locType);
        if (anim) {
            locAnimatedGroups.push({ anim, locs });
        }
    }
    return locAnimatedGroups;
}

function addNpcAnimationFrames(
    npcModelLoader: NpcModelLoader,
    sceneBuf: SceneBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqType = npcModelLoader.seqTypeLoader.load(seqId);
    if (!seqType) {
        return undefined;
    }
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = npcModelLoader.getModel(npcType, seqId, i);
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function createNpcSpawnGroups(
    npcModelLoader: NpcModelLoader,
    basTypeLoader: BasTypeLoader,
    sceneBuf: SceneBuffer,
    npcSpawns: NpcSpawn[],
): NpcSpawnGroup[] {
    const groupedSpawns = new Map<number, NpcSpawn[]>();
    for (const spawn of npcSpawns) {
        const group = groupedSpawns.get(spawn.id);
        if (group) {
            group.push(spawn);
        } else {
            groupedSpawns.set(spawn.id, [spawn]);
        }
    }

    const groups: NpcSpawnGroup[] = [];

    for (const spawns of groupedSpawns.values()) {
        const npcType = npcModelLoader.npcTypeLoader.load(spawns[0].id);

        const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(basTypeLoader);

        if (idleSeqId === -1) {
            continue;
        }

        const idleAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, idleSeqId);
        let walkAnim = idleAnim;
        if (walkSeqId !== -1 && walkSeqId !== idleSeqId) {
            walkAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, walkSeqId);
        }

        if (!idleAnim) {
            continue;
        }

        groups.push({
            idleAnim,
            walkAnim,
            spawns,
        });
    }

    return groups;
}

export class SdMapDataLoader implements RenderDataLoader<SdMapLoaderInput, SdMapData | undefined> {
    __type = "sdMapDataLoader" as const;

    modelHashBuf?: ModelHashBuffer;

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    async load(
        state: WorkerState,
        {
            mapX,
            mapY,
            minLevel,
            maxLevel,
            loadObjs,
            loadNpcs,
            smoothTerrain,
            minimizeDrawCalls,
            cullCellSize = 0,
            skipMinimap = false,
            keepArea,
            loadedTextureIds,
        }: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        console.time(`load map ${mapX},${mapY}`);
        this.init();

        const locTypeLoader = state.locTypeLoader;
        const npcTypeLoader = state.npcTypeLoader;
        const basTypeLoader = state.basTypeLoader;
        const textureLoader = state.textureLoader;

        const locModelLoader = state.locModelLoader;
        const objModelLoader = state.objModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const varManager = state.varManager;

        const textureIdIndexMap = createTextureIdIndexMap(getSdTextureIds(textureLoader));

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        console.time(`build scene ${mapX},${mapY}`);
        const scene = state.sceneBuilder.buildScene(baseX, baseY, mapSize, mapSize, smoothTerrain);
        console.timeEnd(`build scene ${mapX},${mapY}`);

        const grid = cullCellSize > 0 ? new CullGrid(cullCellSize, scene, borderSize) : undefined;
        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000, grid);
        sceneBuf.keepBox = getKeepBox(keepArea, mapX, mapY, borderSize);
        sceneBuf.addTerrain(scene, borderSize, minLevel, maxLevel);

        const sceneLocs = getSceneLocs(locTypeLoader, scene, borderSize, minLevel, maxLevel);
        const sceneModels = sceneLocs.locs;

        // Create loc animated groups and add transformed locs
        const locAnimatedGroups = addLocEntities(
            state.sceneBuilder.centerLocHeightWithSize,
            locModelLoader,
            varManager,
            scene,
            sceneModels,
            sceneBuf,
            sceneLocs.locEntities,
        );

        if (loadObjs) {
            const objSpawns = getMapObjSpawns(state.objSpawns, maxLevel, mapX, mapY);
            createObjSceneModels(objModelLoader, sceneModels, scene, borderSize, objSpawns);
        }

        addSceneModels(this.modelHashBuf!, textureLoader, sceneBuf, sceneModels, minimizeDrawCalls);

        // Animated locs
        const locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
        console.log(`animated locs: ${locsAnimated.length}`);

        // Npcs

        let npcSpawns: NpcSpawn[] = [];
        if (loadNpcs) {
            const cacheNpcSpawns = state.sceneBuilder.decodeNpcSpawns(
                scene,
                borderSize,
                mapX,
                mapY,
            );
            if (cacheNpcSpawns) {
                npcSpawns = cacheNpcSpawns.filter((spawn) => {
                    const npcType = npcTypeLoader.load(spawn.id);
                    return (npcType.loginScreenProps & 0x1) > 0;
                });
            } else {
                npcSpawns = getMapNpcSpawns(state.npcSpawns, maxLevel, mapX, mapY);
                npcSpawns = npcSpawns.filter((spawn) => {
                    return (
                        spawn.name === undefined || spawn.name === npcTypeLoader.load(spawn.id).name
                    );
                });
            }
        }
        const npcSpawnGroups = createNpcSpawnGroups(
            npcModelLoader,
            basTypeLoader,
            sceneBuf,
            npcSpawns,
        );
        const npcs = createNpcDatas(npcSpawnGroups);

        // Draw ranges

        // Normal (merged)
        const drawRanges = sceneBuf.drawCommands.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesAlpha = sceneBuf.drawCommandsAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(
            `draw ranges: ${drawRanges.length}, alpha: ${drawRangesAlpha.length}`,
            mapX,
            mapY,
        );

        // Lod (merged)
        const drawRangesLod = sceneBuf.drawCommandsLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesLodAlpha = sceneBuf.drawCommandsLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(
            `draw ranges lod: ${drawRangesLod.length}, alpha: ${drawRangesLodAlpha.length}`,
            mapX,
            mapY,
        );

        // Interact (non merged)
        const drawRangesInteract = sceneBuf.drawCommandsInteract.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractAlpha = sceneBuf.drawCommandsInteractAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(`draw ranges interact: ${drawRangesInteract.length}`, mapX, mapY);

        // Interact Lod (non merged)
        const drawRangesInteractLod = sceneBuf.drawCommandsInteractLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractLodAlpha = sceneBuf.drawCommandsInteractLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        // Model info textures
        const modelTextureData = createModelInfoTextureData(sceneBuf.drawCommands);
        const modelTextureDataAlpha = createModelInfoTextureData(sceneBuf.drawCommandsAlpha);

        const modelTextureDataLod = createModelInfoTextureData(sceneBuf.drawCommandsLod);
        const modelTextureDataLodAlpha = createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha);

        const modelTextureDataInteract = createModelInfoTextureData(sceneBuf.drawCommandsInteract);
        const modelTextureDataInteractAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractAlpha,
        );

        const modelTextureDataInteractLod = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLod,
        );
        const modelTextureDataInteractLodAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLodAlpha,
        );

        const heightMapTextureData = loadHeightMapTextureData(scene);

        const cullBoxes = grid?.toWorldBoxes(mapX, mapY);
        const getBoxes = (commands: DrawCommand[]) =>
            Uint16Array.from(commands, (cmd) => cmd.box ?? 0);
        const drawRangeBoxes = grid ? getBoxes(sceneBuf.drawCommands) : undefined;
        const drawRangeAlphaBoxes = grid ? getBoxes(sceneBuf.drawCommandsAlpha) : undefined;

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);

        const minimapBlob = skipMinimap
            ? undefined
            : await loadMinimapBlob(state.mapImageRenderer, scene, minLevel, borderSize, false);

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {}
            }
        }

        console.timeEnd(`load map ${mapX},${mapY}`);

        const transferables = [
            ...(cullBoxes && drawRangeBoxes && drawRangeAlphaBoxes
                ? [cullBoxes.buffer, drawRangeBoxes.buffer, drawRangeAlphaBoxes.buffer]
                : []),
            ...scene.tileRenderFlags.flat().map((buf) => buf.buffer),
            ...scene.collisionMaps.map((map) => map.flags.buffer),
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,
            heightMapTextureData.buffer,

            modelTextureData.buffer,
            modelTextureDataAlpha.buffer,

            modelTextureDataLod.buffer,
            modelTextureDataLodAlpha.buffer,

            modelTextureDataInteract.buffer,
            modelTextureDataInteractAlpha.buffer,

            modelTextureDataInteractLod.buffer,
            modelTextureDataInteractLodAlpha.buffer,
        ];

        const totalBytes = transferables.reduce((sum, buf) => sum + buf.byteLength, 0);

        console.log(
            `total bytes: ${totalBytes} ${mapX},${mapY}`,
            sceneBuf.usedTextureIds,
            loadedTextures.size,
        );

        return {
            data: {
                mapX,
                mapY,

                cacheName: state.cache.info.name,

                minLevel,
                maxLevel,
                loadObjs,
                loadNpcs,

                smoothTerrain,
                cullCellSize,
                keepArea,

                borderSize,
                tileRenderFlags: scene.tileRenderFlags,
                collisionDatas: scene.collisionMaps,

                minimapBlob,

                vertices,
                indices,

                modelTextureData,
                modelTextureDataAlpha,

                modelTextureDataLod,
                modelTextureDataLodAlpha,

                modelTextureDataInteract,
                modelTextureDataInteractAlpha,

                modelTextureDataInteractLod,
                modelTextureDataInteractLodAlpha,

                heightMapTextureData,

                drawRanges,
                drawRangesAlpha,

                drawRangesLod,
                drawRangesLodAlpha,

                drawRangesInteract,
                drawRangesInteractAlpha,

                drawRangesInteractLod,
                drawRangesInteractLodAlpha,

                cullBoxes,
                drawRangeBoxes,
                drawRangeAlphaBoxes,

                locsAnimated,
                npcs,

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
    }
}
