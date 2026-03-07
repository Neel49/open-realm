// =====================================================================
// Scribe — rolling event log that tracks what's happening in the world
// =====================================================================

const MAX_EVENTS = 30;

export class Scribe {
    constructor() {
        this.events = [];
        this.log('atmosphere', 'Mysterious night-time city — neon-lit streets, shadows between skyscrapers, distant sirens, an eerie calm in the air');
    }

    log(type, detail) {
        this.events.push({ type, detail, time: Date.now() });
        if (this.events.length > MAX_EVENTS) this.events.shift();
    }

    getSummary() {
        return this.events.map(e => `[${e.type}] ${e.detail}`).join('\n');
    }

    getRecent(n = 10) {
        return this.events.slice(-n);
    }
}
