import { DPS_WINDOW_SECONDS, TICKS_PER_SECOND } from "../core/Sim";

const WINDOW_TICKS = DPS_WINDOW_SECONDS * TICKS_PER_SECOND;

// What the meter last worked out: each source's damage a second over the
// window (as much of it as the run has had), its damage this run, and the
// damage a second of everything that isn't a weapon (items, power-ups,
// recoil), all as of the last sample
export type DamageReading = {
    perSecond: Readonly<Record<string, number>>;
    totals: Readonly<Record<string, number>>;
    otherPerSecond: number;
};

const NOTHING: DamageReading = { perSecond: {}, totals: {}, otherPerSecond: 0 };

// Damage a second by source for the damage panel, over the same few seconds
// as the HUD's DPS. It reads the run's damage totals (Sim.damageBySource)
// once a second of the run, so it never touches the sim, and the panel's
// numbers change once a second rather than flickering.
export class DamageMeter {
    // The totals as they were, a second apart, oldest first: the oldest is
    // the window's start
    private samples: { tick: number; totals: Record<string, number> }[] = [];
    // Worked out when a sample's taken, and the same object until the next
    private reading: DamageReading = NOTHING;

    reset(): void {
        this.samples = [];
        this.reading = NOTHING;
    }

    sample(tick: number, totals: Readonly<Record<string, number>>): void {
        const last = this.samples[this.samples.length - 1];
        if (last && tick < last.tick) {
            // Another run
            this.reset();
        } else if (last && tick - last.tick < TICKS_PER_SECOND) {
            return;
        }
        this.samples.push({ tick, totals: { ...totals } });
        while (this.samples.length > 2 && tick - this.samples[1].tick >= WINDOW_TICKS) {
            this.samples.shift();
        }
        this.reading = this.work();
    }

    read(): DamageReading {
        return this.reading;
    }

    private work(): DamageReading {
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        if (last.tick <= first.tick) {
            return { ...NOTHING, totals: last.totals };
        }
        const seconds = (last.tick - first.tick) / TICKS_PER_SECOND;
        const perSecond: Record<string, number> = {};
        let otherPerSecond = 0;
        for (const [source, damage] of Object.entries(last.totals)) {
            const dealt = damage - (first.totals[source] ?? 0);
            if (dealt > 0) {
                perSecond[source] = dealt / seconds;
                // A weapon that's gone (evolved, or a godsword's blade given
                // its hilt) is still a weapon, not "Other": it drops out
                if (!source.startsWith("weapon:")) {
                    otherPerSecond += dealt / seconds;
                }
            }
        }
        return { perSecond, totals: last.totals, otherPerSecond };
    }
}
