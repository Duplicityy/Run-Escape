import { getCharacter } from "../content/characters";
import { upgradedName } from "../content/endless";
import { getEnemy } from "../content/enemies";
import { getItem } from "../content/items";
import { getPowerUp } from "../content/powerups";
import { RARITIES } from "../content/rarity";
import { getWeapon } from "../content/weapons";
import { RunStats, Sim } from "../core/Sim";
import { DamageSource } from "../core/entities";
import { BossKillView, DamageView, PlayerResultView } from "./GameStore";

export function getPlayerResultViews(sim: Sim): PlayerResultView[] {
    return sim.heroes.map((hero) =>
        sim.as(hero.index, () => {
            const stats = sim.getRunStats();
            return {
                name: hero.name,
                characterName: getCharacter(hero.characterId).name,
                isLocal: hero.index === sim.focus,
                down: hero.down,
                left: hero.left,
                kills: stats.sources.reduce((total, source) => total + source.kills, 0),
                damageDealt: stats.sources.reduce((total, source) => total + source.damage, 0),
                caskets: hero.casketsOpened,
                highestHit: stats.highestHit,
                damageTaken: stats.damageTaken,
                healed: stats.healed,
                rerollsUsed: stats.rerollsUsed,
                skips: stats.skips,
                // Weapon names and tiers come from this hero's own loadout
                damage: getDamageViews(sim, stats),
            };
        }),
    );
}

// The stats screen's rows: what dealt the run's damage, most first, by the
// names and icons the player knows them by (a weapon by its tier at the end)
export function getDamageViews(sim: Sim, stats: RunStats): DamageView[] {
    return stats.sources.map(({ source, damage, kills, seconds }) => ({
        ...describeSource(sim, source),
        damage,
        kills,
        ...(seconds !== undefined && seconds > 0 && { perSecond: damage / seconds }),
    }));
}

export function getBossKillViews(stats: RunStats): BossKillView[] {
    return stats.bossKills.map(({ enemyId, seconds }) => ({
        name: getEnemy(enemyId).name,
        seconds,
    }));
}

function describeSource(
    sim: Sim,
    source: DamageSource,
): { name: string; iconObjId?: number; iconSpriteId?: number; color?: string } {
    const [kind, id] = source.split(":");
    switch (kind) {
        case "weapon": {
            const def = getWeapon(id);
            const owned = sim.weapons.find((w) => w.def.id === id);
            // The tier it ended on, or the weapon's own name if it's gone
            // (evolved, or a godsword's blade before its hilt)
            const last = def.levels.length;
            const level = owned ? def.levels[Math.min(owned.level, last) - 1] : undefined;
            return {
                name: owned ? upgradedName(level?.name ?? def.name, owned.level - last) : def.name,
                iconObjId: level?.objId ?? def.iconObjId,
                color: RARITIES[def.rarity].color,
            };
        }
        case "item": {
            const item = getItem(id);
            return { name: item.name, iconObjId: item.objId, color: RARITIES[item.rarity].color };
        }
        case "powerUp": {
            const powerUp = getPowerUp(id);
            return { name: powerUp.name, iconObjId: powerUp.objId };
        }
        case "recoil":
            return { name: "Recoil", iconObjId: getItem("ring_of_recoil").objId };
        default:
            return { name: "Other" };
    }
}
