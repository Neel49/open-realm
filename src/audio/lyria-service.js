// =====================================================================
// Lyria Service — requests AI-generated music from the backend
// =====================================================================

import { API_BASE } from '../config.js';

export async function generateMusicPrompt(environment, eventLog) {
    const res = await fetch(`${API_BASE}/api/generate-music-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, event_log: eventLog }),
    });
    const data = await res.json();
    return data.prompt;
}

export async function requestMusic(environment, prompt) {
    const res = await fetch(`${API_BASE}/api/generate-music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, prompt }),
    });
    return await res.json();
}

export async function pollMusicStatus(jobId) {
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await fetch(`${API_BASE}/api/music-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId }),
        });
        const data = await res.json();
        if (data.status === 'done') return data.path;
        if (data.status === 'failed') return null;
    }
    return null;
}
