export type SdMapLoaderInput = {
    mapX: number;
    mapY: number;

    // Planes below minLevel aren't drawn (the game draws only its arena's
    // plane, so a dungeon's lower floors don't show through), and the minimap
    // image is of minLevel
    minLevel: number;
    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    minimizeDrawCalls: boolean;

    // Tiles a side of the cells a square's draws are cut into so they can be
    // culled one by one (leaves out the LOD and interact draws). 0 for one lot
    // per square, what the map viewer needs.
    cullCellSize?: number;

    // Leaves out the minimap image of the square, which only the viewer shows
    skipMinimap?: boolean;

    // World tiles (x0, z0, x1, z1): geometry wholly outside is left out of the
    // square. The game's play area grown past its fade (GameWebGLRenderer), as
    // nothing out there can be seen. Unset keeps everything, as the viewer does.
    keepArea?: number[];

    loadedTextureIds: Set<number>;
};
