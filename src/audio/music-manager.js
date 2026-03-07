// =====================================================================
// Music Manager — dynamic background music driven by environment
// =====================================================================

import { WORLD } from '../config.js';
import { generateMusicPrompt, requestMusic, pollMusicStatus } from './lyria-service.js';

const CROSSFADE_DURATION = 3; // seconds
const ENVIRONMENT_CHECK_INTERVAL = 2; // seconds

export class MusicManager {
    constructor(scribe) {
        this.scribe = scribe;
        this.audioCtx = null;
        this.currentSource = null;
        this.currentGain = null;
        this.currentEnvironment = null;
        this.lastEventCount = 0;
        this.volume = 0.4;
        this.generating = false;
        this.timeSinceCheck = 0;
    }

    init(playerPos) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const env = this.getEnvironment(playerPos);
        this.currentEnvironment = env;
        this.lastEventCount = this.scribe.events.length;
        this._requestNewTrack(env);
    }

    getEnvironment(playerPos) {
        const cx = Math.round(playerPos.x / WORLD.CHUNK_SIZE);
        const cz = Math.round(playerPos.z / WORLD.CHUNK_SIZE);
        const isRoadX = Math.abs(cx) % 3 === 0;
        const isRoadZ = Math.abs(cz) % 3 === 0;
        if (isRoadX || isRoadZ) return 'road';
        // Park detection uses seeded rng in chunk-manager; approximate with same logic
        const seed = cx * 73856093 ^ cz * 19349663;
        const rng = Math.abs(Math.sin(seed) * 10000) % 1;
        if (rng < 0.15) return 'park';
        return 'city';
    }

    update(dt, playerPos) {
        if (!this.audioCtx) return;
        this.timeSinceCheck += dt;
        if (this.timeSinceCheck < ENVIRONMENT_CHECK_INTERVAL) return;
        this.timeSinceCheck = 0;

        const env = this.getEnvironment(playerPos);
        const eventCount = this.scribe.events.length;
        const envChanged = env !== this.currentEnvironment;
        const significantEvents = eventCount - this.lastEventCount >= 3;

        if ((envChanged || significantEvents) && !this.generating) {
            this.currentEnvironment = env;
            this.lastEventCount = eventCount;
            this._requestNewTrack(env);
        }
    }

    async _requestNewTrack(environment) {
        this.generating = true;
        try {
            const eventLog = this.scribe.getSummary();
            console.log(`[Music] Requesting prompt for env=${environment}, events:\n${eventLog}`);
            const prompt = await generateMusicPrompt(environment, eventLog);
            console.log(`[Music] Prompt: ${prompt}`);
            const result = await requestMusic(environment, prompt);
            if (!result.job_id) { console.warn('[Music] No job_id returned'); return; }

            console.log(`[Music] Polling job ${result.job_id}...`);
            const audioPath = await pollMusicStatus(result.job_id);
            if (!audioPath) { console.warn('[Music] Generation failed or timed out'); return; }

            console.log(`[Music] Fetching audio: ${audioPath}`);
            const response = await fetch(audioPath);
            if (!response.ok) { console.error(`[Music] Fetch failed: ${response.status}`); return; }
            const arrayBuffer = await response.arrayBuffer();
            console.log(`[Music] Decoding ${arrayBuffer.byteLength} bytes...`);
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            console.log(`[Music] Playing! duration=${audioBuffer.duration.toFixed(1)}s, ctxState=${this.audioCtx.state}`);
            this._crossfadeTo(audioBuffer);
        } catch (e) {
            console.error('[Music] Failed:', e);
        } finally {
            this.generating = false;
        }
    }

    _crossfadeTo(newBuffer) {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const now = this.audioCtx.currentTime;

        // Fade out current track
        if (this.currentGain) {
            this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, now);
            this.currentGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_DURATION);
            const oldSource = this.currentSource;
            setTimeout(() => { try { oldSource.stop(); } catch (_) {} }, CROSSFADE_DURATION * 1000);
        }

        // Fade in new track
        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(this.volume, now + CROSSFADE_DURATION);
        gain.connect(this.audioCtx.destination);

        const source = this.audioCtx.createBufferSource();
        source.buffer = newBuffer;
        source.loop = true;
        source.connect(gain);
        source.start(0);

        this.currentSource = source;
        this.currentGain = gain;
    }

    setVolume(v) {
        this.volume = v;
        if (this.currentGain) {
            this.currentGain.gain.setValueAtTime(v, this.audioCtx.currentTime);
        }
    }

    resume() {
        if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
    }
}
