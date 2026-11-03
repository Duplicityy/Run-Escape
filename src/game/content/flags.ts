// Co-op's flags, for where each player is: the login screen's world list's
// ("sl_flags"), one sprite with a round flag in each frame. Frames 29 on are the
// same flags again with another rim. scripts/cache/slim-cache.ts keeps the sprite
// in the slim cache.
export const FLAG_SPRITE = 815;

// The frame of each country that has one, by ISO 3166's two letters, as the
// relay sends them
export const FLAG_FRAMES: Readonly<Record<string, number>> = {
    US: 0,
    GB: 1,
    CA: 2,
    AU: 3,
    NL: 4,
    SE: 5,
    FI: 6,
    DE: 7,
    BR: 8,
    JP: 9,
    SG: 10,
    AE: 11,
    ZA: 12,
    BH: 13,
    HK: 14,
    IN: 15,
    MY: 16,
    CH: 17,
    IT: 18,
    FR: 19,
    IL: 20,
    MX: 21,
    NZ: 22,
    TW: 23,
    TH: 24,
    CN: 25,
    IE: 26,
    ES: 27,
    KR: 28,
};
