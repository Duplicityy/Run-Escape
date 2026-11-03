// Stands in for cloudflare:workers in unit tests (vite.config.ts), so the
// room's own code runs under Node
export class DurableObject {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
    }
}
