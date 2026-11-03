import { CollisionData } from "../../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";

export type SdMapData = {
    mapX: number;
    mapY: number;

    cacheName: string;

    minLevel: number;
    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;
    cullCellSize: number;
    keepArea?: number[];

    borderSize: number;

    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];

    minimapBlob?: Blob;

    vertices: Uint8Array;
    indices: Int32Array;

    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;

    modelTextureDataLod: Uint16Array;
    modelTextureDataLodAlpha: Uint16Array;

    modelTextureDataInteract: Uint16Array;
    modelTextureDataInteractAlpha: Uint16Array;

    modelTextureDataInteractLod: Uint16Array;
    modelTextureDataInteractLodAlpha: Uint16Array;

    heightMapTextureData: Int16Array;

    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];

    drawRangesLod: DrawRange[];
    drawRangesLodAlpha: DrawRange[];

    drawRangesInteract: DrawRange[];
    drawRangesInteractAlpha: DrawRange[];

    drawRangesInteractLod: DrawRange[];
    drawRangesInteractLodAlpha: DrawRange[];

    // With cullCellSize: bounding boxes (world tiles, FLOATS_PER_BOX each), and
    // which one each of drawRanges and drawRangesAlpha is in
    cullBoxes?: Float32Array;
    drawRangeBoxes?: Uint16Array;
    drawRangeAlphaBoxes?: Uint16Array;

    locsAnimated: LocAnimatedData[];
    npcs: NpcData[];

    loadedTextures: Map<number, Int32Array>;
};
