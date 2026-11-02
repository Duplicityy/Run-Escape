import { DPS_WINDOW_SECONDS, TICKS_PER_SECOND } from "../core/Sim";

const WINDOW_TICKS = DPS_WINDOW_SECONDS * TICKS_PER_SECOND;

// Damage a second by source for the damage panel, over the same few seconds
// as the HUD's DPS. It reads the run's damage totals (Sim.damageBySource)
// once a second of the run, so it never touches the sim, and the panel's
// numbers change once a second rather than flickering.
export class DamageMeter {
    // The totals as they were, a second apart, oldest first: the oldest is
    // the window's start
    private samples: { tick: number; totals: Record<string, number> }[] = [];

    reset(): void {
        this.samples = [];
    }

    sample(tick: number, totals: Readonly<Record<string, number>>): void {
        const last = this.samples[this.samples.length - 1];
        if (last && tick < last.tick) {
            // Another run
            this.samples = [];
        } else if (last && tick - last.tick < TICKS_PER_SECOND) {
            return;
        }
        this.samples.push({ tick, totals: { ...totals } });
        while (this.samples.length > 2 && tick - this.samples[1].tick >= WINDOW_TICKS) {
            this.samples.shift();
        }
    }

    // Each source's damage a second over the window (as much of it as the run
    // has had), and its damage this run, both as of the last sample
    read(): { perSecond: Record<string, number>; totals: Record<string, number> } {
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        if (!first || !last || last.tick <= first.tick) {
            return { perSecond: {}, totals: last ? { ...last.totals } : {} };
        }
        const seconds = (last.tick - first.tick) / TICKS_PER_SECOND;
        const perSecond: Record<string, number> = {};
        for (const [source, damage] of Object.entries(last.totals)) {
            const dealt = damage - (first.totals[source] ?? 0);
            if (dealt > 0) {
                perSecond[source] = dealt / seconds;
            }
        }
        return { perSecond, totals: { ...last.totals } };
    }
}
