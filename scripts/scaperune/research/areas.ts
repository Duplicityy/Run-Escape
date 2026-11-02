// The real places measured, in world tiles: [x, y, sizeX, sizeY]. Taken from the wiki's map
// links and checked by eye on overview.ts's pictures. A map square is 64 tiles.
export type Area = { name: string; rect: [number, number, number, number]; kind: string };

export const AREAS: Area[] = [
    { name: "Auburnvale", rect: [1376, 3312, 96, 96], kind: "town" },
    { name: "Hosidius town", rect: [1712, 3560, 96, 80], kind: "town" },
    { name: "Hosidius farmland", rect: [1728, 3480, 96, 80], kind: "country" },
    { name: "Arceuus", rect: [1616, 3728, 112, 112], kind: "town" },
    { name: "Lovakengj", rect: [1456, 3752, 96, 96], kind: "town" },
    { name: "Port Piscarilius", rect: [1768, 3704, 80, 96], kind: "town" },
    { name: "Shayzien", rect: [1472, 3552, 96, 88], kind: "town" },
    { name: "Civitas illa Fortis", rect: [1660, 3064, 128, 128], kind: "town" },
    { name: "Farming Guild", rect: [1208, 3696, 80, 80], kind: "country" },
    { name: "Karuulm foot", rect: [1272, 3768, 80, 72], kind: "mountain" },
    { name: "Kebos Swamp", rect: [1224, 3576, 96, 80], kind: "country" },
    { name: "Falador", rect: [2936, 3304, 112, 104], kind: "town" },
    { name: "Varrock", rect: [3160, 3392, 112, 112], kind: "town" },
    { name: "Lumbridge", rect: [3168, 3168, 80, 96], kind: "town" },
    { name: "Lumbridge fields", rect: [3160, 3264, 80, 72], kind: "country" },
];
