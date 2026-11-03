import { describe, expect, test } from "vitest";

import { EquipSlot, createAppearance } from "../../rs/model/player/PlayerModelLoader";
import { ENEMIES } from "../content/enemies";
import { POWER_UPS, getPowerUp } from "../content/powerups";
import { RANDOM_EVENTS, VISITOR_SPOTANIM } from "../content/randomEvents";
import { getWeapon } from "../content/weapons";
import {
    GameAssets,
    getEnemyModelKey,
    getPowerUpLookRequests,
    getShieldedModelKey,
} from "./GameAssets";
import { getGameSoundIds } from "./GameSounds";

describe("enemy bakes", () => {
    test("have every model GameView asks for", () => {
        for (const enemy of ENEMIES) {
            const keys = GameAssets.getEnemyRequests([enemy]).map((r) => r.key);
            const variants = enemy.outfits?.length ?? 1;
            for (let variant = 0; variant < variants; variant++) {
                expect(keys).toContain(getEnemyModelKey(enemy, variant));
            }
            if (enemy.shield?.look) {
                expect(keys).toContain(getShieldedModelKey(enemy));
            }
        }
    });

    test("every spot animation a boss attack shows is in the base bake", () => {
        const keys = GameAssets.getBaseRequests().map((r) => r.key);
        for (const enemy of ENEMIES) {
            for (const attack of enemy.boss?.attacks ?? []) {
                for (const id of attack.impactSpotAnims ?? []) {
                    expect(keys).toContain("spot:" + id);
                }
                if (attack.pool) {
                    expect(keys).toContain("loc:" + attack.pool.locId);
                }
            }
            for (const id of enemy.disguise?.warning?.spotAnims ?? []) {
                expect(keys).toContain("spot:" + id);
            }
        }
    });

    test("aren't in the base bake", () => {
        const keys = GameAssets.getBaseRequests().map((r) => r.key);
        expect(keys).not.toContain("npc:goblin");
    });
});

describe("bake tasks", () => {
    test("have every request once, an NPC or player model to a task", () => {
        const requests = [...GameAssets.getBaseRequests(), ...GameAssets.getEnemyRequests(ENEMIES)];
        const tasks = GameAssets.getBakeTasks(requests);
        expect(tasks.flat()).toHaveLength(requests.length);
        expect(new Set(tasks.flat())).toEqual(new Set(requests));
        for (const task of tasks) {
            if (task.some((r) => r.kind === "npc" || r.kind === "player")) {
                expect(task).toHaveLength(1);
            }
        }
    });
});

describe("power-ups in the cache", () => {
    test("a look puts its item in hand, takes the shield off and leaves the rest", () => {
        const appearance = createAppearance({
            [EquipSlot.WEAPON]: 1277,
            [EquipSlot.SHIELD]: 1171,
            [EquipSlot.HEAD]: 1153,
        });
        const [request] = getPowerUpLookRequests(appearance);
        const { look } = getPowerUp("sled");
        expect(request).toMatchObject({
            kind: "player",
            key: "player:sled",
            seqIds: [look!.idleSeq, look!.moveSeq],
        });
        const worn = request.kind === "player" ? request.appearance.equipment : [];
        expect(worn[EquipSlot.WEAPON]).toBe(look!.objId);
        expect(worn[EquipSlot.SHIELD]).toBe(-1);
        expect(worn[EquipSlot.HEAD]).toBe(1153);
        // The player's own look is left as it was
        expect(appearance.equipment[EquipSlot.WEAPON]).toBe(1277);
    });

    test("what their effects draw is baked, so the slim cache gets it", () => {
        const keys = new Set(GameAssets.getBaseRequests().map((r) => r.key));
        for (const { id, effect, objId, locId } of POWER_UPS) {
            expect(keys).toContain(locId !== undefined ? "loc:" + locId : "obj:" + objId);
            if ("locId" in effect) {
                expect(keys).toContain("loc:" + effect.locId);
            }
            if ("spotAnim" in effect) {
                expect(keys).toContain("spot:" + effect.spotAnim);
            }
            if (effect.kind === "rampage") {
                expect(keys).toContain("rampage:" + id);
            }
        }
    });

    test("random events' visitors are baked", () => {
        const keys = GameAssets.getBaseRequests().map((request) => request.key);
        for (const { id, npcId } of RANDOM_EVENTS) {
            if (npcId !== undefined) {
                expect(keys).toContain("visitor:" + id);
            }
        }
        expect(keys).toContain("spot:" + VISITOR_SPOTANIM);
    });

    test("Toktz-mej-tal's fire is baked with its animation", () => {
        const { burns } = getWeapon("toktz_mej_tal");
        const request = GameAssets.getBaseRequests().find((r) => r.key === "loc:" + burns!.locId);
        expect(request).toEqual({
            kind: "loc",
            key: "loc:" + burns!.locId,
            locId: burns!.locId,
            animated: true,
        });
    });

    test("their sounds are all loaded", () => {
        const sounds = getGameSoundIds();
        for (const { sound, endSound, hitSound } of POWER_UPS) {
            for (const id of [sound, endSound, hitSound]) {
                if (id !== undefined && id !== -1) {
                    expect(sounds).toContain(id);
                }
            }
        }
    });
});
