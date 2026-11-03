// Requests and results for baking actor models (player, enemies, spot anims,
// pickups) into one vertex buffer. Each animation frame is a fully posed copy
// of the model, drawn by picking its draw range, the same way the map square
// loader bakes NPCs. Unlike map square NPCs, baked actors aren't tied to a map
// square, so any number of them can be drawn anywhere in the world.
//
// Indices are 16-bit where they can be: the vertices are cut into segments of
// up to 65,536, no frame crosses from one into the next, and each frame's
// indices count from its segment's first vertex.
import type { PlayerAppearance } from "../../../rs/model/player/PlayerModelLoader";

// Stand-ins in an NPC request's seqIds for the NPC's own idle and walk
// animations (from its type), for NPCs whose animations aren't known up front.
// The baked animations keep these as their seqIds.
export const NPC_IDLE_SEQ = -2;
export const NPC_WALK_SEQ = -3;

export type NpcBakeRequest = {
    kind: "npc";
    key: string;
    npcId: number;
    seqIds: number[];
};

export type PlayerBakeRequest = {
    kind: "player";
    key: string;
    appearance: PlayerAppearance;
    seqIds: number[];
};

// One animation: the spot anim's own sequence
export type SpotAnimBakeRequest = {
    kind: "spotanim";
    key: string;
    spotAnimId: number;
};

// A static ground item model (stack models are picked by count)
export type ObjBakeRequest = {
    kind: "obj";
    key: string;
    objId: number;
    count: number;
};

// A scenery model (e.g. the dwarf multicannon), static unless animated asks for
// its own animation (e.g. a fire's flicker), which it then has as its one anim
export type LocBakeRequest = {
    kind: "loc";
    key: string;
    locId: number;
    animated?: boolean;
};

export type BakeRequest =
    | NpcBakeRequest
    | PlayerBakeRequest
    | SpotAnimBakeRequest
    | ObjBakeRequest
    | LocBakeRequest;

export type ActorBakeInput = {
    requests: BakeRequest[];
    loadedTextureIds: Set<number>;
};

export type BakedAnim = {
    seqId: number;
    // Per frame: [opaqueByteOffset, opaqueCount, alphaByteOffset, alphaCount]
    ranges: Int32Array;
    // Per frame: the segment its vertices are in
    segments: Uint16Array;
    // Length of each frame in client ticks (20ms)
    frameLengths: Uint16Array;
    looping: boolean;
};

export type BakedSet = {
    key: string;
    // Model height and footprint radius in model units (1/128 tile), from the
    // first frame of the first animation
    height: number;
    radius: number;
    // Furthest any vertex gets from the model's origin in any frame of any of
    // its animations, in model units: what its culling goes by
    reach: number;
    anims: BakedAnim[];
};

export type ActorBakeResult = {
    vertices: Uint8Array;
    // 32-bit only for a model with more vertices in one frame than 16 bits reach
    indices: Uint16Array | Uint32Array;
    // The first vertex of each segment ([0] with 32-bit indices)
    segmentStarts: Int32Array;
    sets: BakedSet[];
    loadedTextures: Map<number, Int32Array>;
};
