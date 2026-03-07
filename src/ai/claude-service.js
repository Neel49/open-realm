// =====================================================================
// Claude AI Service — communicates with local backend → claude CLI
// =====================================================================

import { API_BASE } from '../config.js';

let callsInFlight = 0;
const cache = new Map();

export function getAIStatus() {
    return callsInFlight > 0 ? 'thinking...' : 'ready';
}

async function post(endpoint, body) {
    callsInFlight++;
    try {
        const res = await fetch(`${API_BASE}/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return await res.json();
    } catch (e) {
        console.error(`Claude API error (${endpoint}):`, e);
        return { error: e.message, dialogue: 'Hmm...' };
    } finally {
        callsInFlight--;
    }
}

// ---- NPC Profile Generation ----

const OCCUPATIONS = [
    'baker','mechanic','artist','musician','librarian','detective','chef',
    'botanist','inventor','fisherman','blacksmith','alchemist','tailor',
    'merchant','scholar','guard','healer','bard','explorer','astronomer',
];

export async function generateNPCProfile(seed) {
    const key = `npc_${seed}`;
    if (cache.has(key)) return cache.get(key);

    const occupation = OCCUPATIONS[Math.abs(seed) % OCCUPATIONS.length];
    const result = await post('chat', {
        system: 'You generate game NPC data. Respond ONLY with valid JSON, no markdown, no backticks.',
        prompt: `Create a unique NPC who is a ${occupation} in a fantasy open world city.
Respond ONLY in JSON: {"name":"...","occupation":"...","personality":"one sentence","greeting":"short greeting under 15 words","hair_color":[r,g,b],"shirt_color":[r,g,b],"pants_color":[r,g,b]}
Use color values 0.0-1.0. Be creative.`,
    });

    const profile = result.name ? result : {
        name: `Citizen #${Math.abs(seed) % 1000}`,
        occupation,
        personality: 'A quiet local.',
        greeting: 'Hello there.',
        hair_color: [0.1, 0.08, 0.05],
        shirt_color: [0.3, 0.3, 0.6],
        pants_color: [0.2, 0.2, 0.25],
    };

    cache.set(key, profile);
    return profile;
}

// ---- NPC Chat ----

export async function chatWithNPC(npc, message) {
    const history = npc.chatHistory.map(m => `${m.role}: ${m.text}`).join('\n');
    const result = await post('chat', {
        system: `You are ${npc.profile.name}, a ${npc.profile.occupation}. Personality: ${npc.profile.personality}
You are an NPC in "Open Realm", a living open-world game. Stay in character. Keep responses under 2 sentences.

IMPORTANT: The player can ask you to DO things — bake a cake, go somewhere, build something, fight, trade, explore, etc.
If the player suggests an ACTIVITY, set action to "world_event" so the game engine can make it happen.
If it's just conversation, set action to "none".

Respond ONLY with valid JSON (no markdown): {"dialogue":"your response","emotion":"neutral|happy|angry|scared|excited","action":"none|follow|wave|point|laugh|give_item|run_away|world_event","activity":"description of the activity if action is world_event, else null"}`,
        prompt: `${history}\nPlayer: ${message}`,
    });

    return result.dialogue ? result : { dialogue: "Hmm, I'm not sure what to say.", emotion: 'neutral', action: 'none', activity: null };
}

// ---- Object Examination ----

export async function examineObject(label, nearbyContext) {
    const result = await post('chat', {
        system: 'You are a creative game narrator for "Open Realm". Respond ONLY with valid JSON (no markdown).',
        prompt: `The player examines a ${label} in an open-world city.
Nearby: ${nearbyContext}.
Generate a vivid 2-sentence description and suggest 2-3 unique, creative interactions.
JSON: {"description":"...","interactions":["action1","action2","action3"]}`,
    });
    return result.description ? result : { description: `A ${label}.`, interactions: ['Examine closer', 'Leave'] };
}

// ---- Action Resolution ----

export async function resolveAction(label, action) {
    const result = await post('chat', {
        system: 'You are a creative game narrator. Respond ONLY with valid JSON (no markdown). Be surprising and fun.',
        prompt: `Player chose to "${action}" a ${label}.
What happens? JSON: {"result":"1-2 sentences of what happens","item_found":null or "item name","effect":"none|explode|glow|disappear|transform"}`,
    });
    return result.result ? result : { result: 'Nothing happens.', item_found: null, effect: 'none' };
}

// ---- World Events ----

export async function triggerWorldEvent(context, action) {
    return await post('world-event', { context, action });
}

// ---- Asset Generation (Blender MCP) ----

export async function requestAssetGeneration(description, id) {
    const startResult = await post('generate-asset', { description, id });
    if (!startResult.job_id) return null;

    // Poll until done
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await post('asset-status', { job_id: startResult.job_id });
        if (status.status === 'done') return status.path;
        if (status.status === 'failed') return null;
    }
    return null;
}
