import { ENEMIES, getEnemy } from "../content/enemies";
import { getItem } from "../content/items";
import { POWER_UPS, THRALLS, getPowerUp } from "../content/powerups";
import { RANDOM_EVENTS, VISITOR_SOUND } from "../content/randomEvents";
import { Rarity } from "../content/rarity";
import { SOUNDS } from "../content/sounds";
import { ItemUse } from "../content/types";
import { WEAPONS } from "../content/weapons";
import { Sim } from "../core/Sim";
import { SimEvent } from "../core/entities";
import { GameAudio } from "./GameAudio";

// Moments in the casket opening animation: it lands, rattles, bursts open
// (with a sting for the item's rarity) and spills its coins
export type ChestCue = "land" | "rattle" | "open" | "coins";

const REVEAL_SOUNDS: Record<Rarity, number> = {
    common: SOUNDS.revealCommon,
    uncommon: SOUNDS.revealUncommon,
    rare: SOUNDS.revealRare,
    veryRare: SOUNDS.revealVeryRare,
};

const USE_SOUNDS: Record<ItemUse["kind"], number> = {
    heal: SOUNDS.food,
    buff: SOUNDS.potion,
    cure: SOUNDS.potion,
    bones: SOUNDS.bonecrusher,
    blast: SOUNDS.chinchompa,
    xp: SOUNDS.lamp,
};

// Every sound effect a run can play, to synthesize up front
export function getGameSoundIds(): number[] {
    const ids: number[] = [];
    for (const enemy of ENEMIES) {
        ids.push(enemy.sounds.attack, enemy.sounds.hit, enemy.sounds.death);
        ids.push(enemy.spawnSound ?? -1, enemy.explodes?.sound ?? -1, enemy.blinks?.sound ?? -1);
        for (const attack of enemy.boss?.attacks ?? []) {
            ids.push(attack.windupSound ?? -1, attack.sound ?? -1, attack.hitSound ?? -1);
        }
        const boss = enemy.boss;
        ids.push(boss?.intro?.darkSound ?? -1, boss?.intro?.sound ?? -1);
        ids.push(boss?.phases?.totems.blastSound ?? -1, boss?.phases?.totems.chargedSound ?? -1);
        ids.push(enemy.shot?.sound ?? -1, enemy.shot?.hitSound ?? -1);
    }
    for (const weapon of WEAPONS) {
        ids.push(weapon.sound, weapon.hitSound, weapon.special?.sound ?? -1);
        for (const level of weapon.levels) {
            ids.push(level.sound ?? -1, level.hitSound ?? -1);
        }
    }
    for (const powerUp of POWER_UPS) {
        ids.push(powerUp.sound, powerUp.endSound ?? -1, powerUp.hitSound ?? -1);
    }
    for (const thrall of THRALLS) {
        ids.push(thrall.sound);
    }
    ids.push(VISITOR_SOUND);
    for (const { effect } of RANDOM_EVENTS) {
        ids.push("sound" in effect ? effect.sound : -1);
    }
    for (const value of Object.values(SOUNDS)) {
        ids.push(...(Array.isArray(value) ? value : [value]));
    }
    return [...new Set(ids.filter((id) => id >= 0))];
}

// Turns what happened in a tick into sounds. With hundreds of enemies the
// frequent ones (hits, bones) are quiet and rate limited so the important ones
// (your weapons, deaths, level ups) still come through.
export class GameSounds {
    constructor(readonly audio: GameAudio) {}

    // viewHero: where to hear from (the camera's hero)
    onEvents(sim: Sim, events: SimEvent[], viewHero = sim.focus): void {
        const audio = this.audio;
        const listener = sim.heroes[viewHero]?.player ?? sim.player;
        const px = listener.x;
        const py = listener.y;
        for (const event of events) {
            // Co-op: what happens to a teammate is theirs to hear, but for
            // their weapons, heard from where they are, and power-ups (which
            // mostly do something to everyone)
            if (event.hero !== undefined && event.hero !== sim.focus) {
                if (event.type === "weapon") {
                    audio.playAt(event.sound, event.x, event.y, px, py, {
                        volume: 0.3,
                        minGap: 60,
                    });
                } else if (event.type === "powerUp") {
                    audio.playAt(getPowerUp(event.id).sound, event.x, event.y, px, py, {
                        volume: 0.8,
                        minGap: 0,
                    });
                }
                continue;
            }
            switch (event.type) {
                case "weapon":
                    audio.play(event.sound, { volume: 0.5, minGap: 60 });
                    break;
                case "cannonSetup":
                    audio.playAt(SOUNDS.cannonSetup, event.x, event.y, px, py, { volume: 0.8 });
                    break;
                case "cannonFire":
                    audio.playAt(SOUNDS.cannonFire, event.x, event.y, px, py, {
                        volume: 0.45,
                        minGap: 120,
                    });
                    break;
                case "thrallAttack":
                    audio.playAt(event.sound, event.x, event.y, px, py, {
                        volume: 0.4,
                        minGap: 120,
                    });
                    break;
                case "powerUp":
                    audio.play(getPowerUp(event.id).sound, { volume: 1, minGap: 0 });
                    break;
                case "powerUpHit":
                    audio.playAt(getPowerUp(event.id).hitSound ?? -1, event.x, event.y, px, py, {
                        volume: 0.9,
                    });
                    break;
                case "visitor":
                    audio.play(event.sound, { volume: 1, minGap: 0 });
                    break;
                case "powerUpEnded":
                    audio.play(getPowerUp(event.id).endSound ?? -1, { volume: 1, minGap: 0 });
                    break;
                case "impact":
                    audio.playAt(event.sound, event.x, event.y, px, py, {
                        volume: 0.35,
                        minGap: 80,
                    });
                    break;
                case "damage":
                    audio.playAt(getEnemy(event.enemyId).sounds.hit, event.x, event.y, px, py, {
                        volume: 0.22,
                        minGap: 90,
                    });
                    break;
                case "kill": {
                    const enemy = getEnemy(event.enemyId);
                    audio.playAt(enemy.sounds.death, event.x, event.y, px, py, {
                        volume: event.boss ? 1 : 0.4,
                        minGap: event.boss ? 0 : 90,
                    });
                    break;
                }
                case "bossAttack":
                    audio.playAt(event.sound, event.x, event.y, px, py, { volume: 0.8 });
                    break;
                case "playerHit": {
                    // A boss attack has its own sound (played when it was used)
                    const sound = event.sound ?? getEnemy(event.enemyId).sounds.attack;
                    audio.play(sound, { volume: 0.35, minGap: 150 });
                    const hit =
                        SOUNDS.playerHit[Math.floor(Math.random() * SOUNDS.playerHit.length)];
                    audio.play(hit, { volume: 0.55, minGap: 200 });
                    break;
                }
                case "pickup":
                    switch (event.kind) {
                        case "bones":
                            audio.play(SOUNDS.bones, { volume: 0.1, minGap: 70 });
                            break;
                        case "coins":
                            audio.play(SOUNDS.coins, { volume: 0.5 });
                            break;
                        case "food":
                            audio.play(SOUNDS.food, { volume: 0.8 });
                            break;
                        case "casket":
                            audio.play(SOUNDS.casketPickup, { volume: 0.8 });
                            break;
                    }
                    break;
                case "casketDropped":
                    audio.playAt(SOUNDS.casketDrop, event.x, event.y, px, py, { volume: 1 });
                    break;
                case "equip":
                case "stash":
                    audio.play(SOUNDS.casketPickup, { volume: 0.7 });
                    break;
                case "alch":
                    audio.play(SOUNDS.alch, { volume: 0.7 });
                    break;
                case "itemUsed": {
                    const item = getItem(event.itemId);
                    if (item.kind === "utility") {
                        audio.play(USE_SOUNDS[item.use.kind], { volume: 0.9, minGap: 0 });
                    }
                    break;
                }
                case "bossSpawned":
                    audio.play(getEnemy(event.enemyId).spawnSound ?? SOUNDS.bossSpawn, {
                        volume: 1,
                    });
                    break;
                case "bossRose":
                case "bossEnraged":
                case "roundStarted":
                    audio.play(SOUNDS.bossSpawn, { volume: 1 });
                    break;
                case "bossIntro":
                case "bossRising":
                case "totemBlast":
                    if (event.sound !== -1) {
                        audio.play(event.sound, { volume: 1 });
                    }
                    break;
                case "bossStage":
                    audio.play(SOUNDS.bossSpawn, { volume: 0.8 });
                    break;
                case "coinsStolen":
                case "coinsReturned":
                    audio.play(SOUNDS.coins, { volume: 0.8 });
                    break;
                case "revive":
                case "heroRevived":
                    audio.play(SOUNDS.revive, { volume: 1 });
                    break;
                case "evolved":
                    audio.play(SOUNDS.evolve, { volume: 1 });
                    break;
            }
        }
    }

    chest(cue: ChestCue, rarity: Rarity): void {
        const audio = this.audio;
        switch (cue) {
            case "land":
                audio.play(SOUNDS.casketDrop, { volume: 1, minGap: 0 });
                break;
            case "rattle":
                audio.play(SOUNDS.casketRattle, { volume: 0.35, minGap: 0 });
                break;
            case "open":
                audio.play(SOUNDS.casket, { volume: 1, minGap: 0 });
                audio.play(REVEAL_SOUNDS[rarity], { volume: 0.9, minGap: 0 });
                if (rarity === "veryRare") {
                    audio.play(SOUNDS.levelUp, { volume: 0.7, minGap: 0 });
                }
                break;
            case "coins":
                audio.play(SOUNDS.coinShower, { volume: 0.6, minGap: 0 });
                break;
        }
    }

    levelUp(): void {
        this.audio.play(SOUNDS.levelUp, { volume: 0.7, minGap: 0 });
    }

    reroll(): void {
        this.audio.play(SOUNDS.reroll, { volume: 0.7, minGap: 0 });
    }

    taskDone(): void {
        this.audio.play(SOUNDS.taskDone, { volume: 0.8, minGap: 0 });
    }

    playerDied(): void {
        this.audio.play(SOUNDS.playerDeath, { volume: 0.9, minGap: 0 });
    }

    click(): void {
        this.audio.play(SOUNDS.click, { volume: 0.6, minGap: 30 });
    }

    buy(): void {
        this.audio.play(SOUNDS.buy, { volume: 0.6 });
    }

    denied(): void {
        this.audio.play(SOUNDS.denied, { volume: 0.5 });
    }
}
