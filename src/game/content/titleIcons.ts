// The title screen's icons: the client's own side tab sprites, and the
// Collection log's item. scripts/cache/slim-cache.ts keeps them in the slim cache.
export const TITLE_TAB_SPRITES = {
    skills: 898,
    quests: 899,
    armoury: 901,
    settings: 908,
} as const;

export const COLLECTION_LOG_OBJ = 22711;

// The client's own back-arrow button, on a bought skill to refund a rank. Also kept in the slim
// cache by scripts/cache/slim-cache.ts.
export const REFUND_SPRITE = 1021;
