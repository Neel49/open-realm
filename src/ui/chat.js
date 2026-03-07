// =====================================================================
// Chat Panel — NPC conversation UI
// =====================================================================

import { chatWithNPC } from '../ai/claude-service.js';
import { API_BASE } from '../config.js';
import { notify } from './hud.js';

const TTS_VOICES = ['Kore', 'Charon', 'Fenrir', 'Aoede', 'Puck', 'Leda', 'Orus', 'Zephyr'];

let chatOpen = false;
let chatNPC = null;
let onClose = null;
let onWorldEvent = null;
let recognition = null;
let isRecording = false;
let ttsAudio = null;

export function isChatOpen() { return chatOpen; }
export function getChatNPC() { return chatNPC; }

export function initChat(closeCb, worldEventCb) {
    onClose = closeCb;
    onWorldEvent = worldEventCb;

    document.getElementById('chat-send').addEventListener('click', sendChat);
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') sendChat();
    });
    chatInput.addEventListener('keyup', e => e.stopPropagation());
    document.getElementById('chat-close').addEventListener('click', closeChat);
    document.getElementById('chat-mic').addEventListener('click', toggleMic);
    initSpeechRecognition();
}

export function openChat(npc) {
    chatNPC = npc;
    chatOpen = true;
    const panel = document.getElementById('chat-panel');
    panel.style.display = 'flex';
    document.getElementById('chat-npc-name').textContent = `${npc.profile.name} — ${npc.profile.occupation}`;
    document.getElementById('chat-messages').innerHTML = '';
    document.exitPointerLock();

    if (npc.chatHistory.length === 0) {
        addMsg('npc', npc.profile.greeting);
        npc.chatHistory.push({ role: 'NPC', text: npc.profile.greeting });
        speakNPC(npc.profile.greeting);
    } else {
        for (const msg of npc.chatHistory) addMsg(msg.role === 'NPC' ? 'npc' : 'player', msg.text);
    }
    setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

export function closeChat() {
    chatOpen = false;
    chatNPC = null;
    if (isRecording && recognition) { recognition.stop(); }
    if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    document.getElementById('chat-panel').style.display = 'none';
    if (onClose) onClose();
}

function addMsg(type, text) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
}

async function sendChat() {
    if (!chatNPC) return;
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    addMsg('player', text);
    chatNPC.chatHistory.push({ role: 'Player', text });

    const thinkingDiv = addMsg('npc', '...');
    thinkingDiv.classList.add('thinking');

    const response = await chatWithNPC(chatNPC, text);

    thinkingDiv.textContent = response.dialogue;
    thinkingDiv.classList.remove('thinking');
    chatNPC.chatHistory.push({ role: 'NPC', text: response.dialogue });
    chatNPC.emotion = response.emotion || 'neutral';
    speakNPC(response.dialogue);

    if (response.action && response.action !== 'none') {
        handleNPCAction(chatNPC, response.action, response.activity, text);
    }
}

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        document.getElementById('chat-mic').style.display = 'none';
        return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
        const transcript = Array.from(e.results)
            .map(r => r[0].transcript)
            .join('');
        document.getElementById('chat-input').value = transcript;
    };

    recognition.onend = () => {
        isRecording = false;
        document.getElementById('chat-mic').classList.remove('recording');
        // Auto-send if we got text
        const input = document.getElementById('chat-input');
        if (input.value.trim()) sendChat();
    };

    recognition.onerror = (e) => {
        isRecording = false;
        document.getElementById('chat-mic').classList.remove('recording');
        if (e.error !== 'no-speech') notify('Mic error: ' + e.error);
    };
}

function npcVoice() {
    if (!chatNPC) return TTS_VOICES[0];
    let hash = 0;
    for (const ch of chatNPC.profile.name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return TTS_VOICES[Math.abs(hash) % TTS_VOICES.length];
}

async function speakNPC(text) {
    if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    try {
        const res = await fetch(`${API_BASE}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: npcVoice() }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        ttsAudio = new Audio(URL.createObjectURL(blob));
        ttsAudio.play();
    } catch (e) {
        console.warn('[TTS]', e);
    }
}

function toggleMic() {
    if (!recognition) return;
    if (isRecording) {
        recognition.stop();
    } else {
        isRecording = true;
        document.getElementById('chat-mic').classList.add('recording');
        document.getElementById('chat-input').value = '';
        recognition.start();
    }
}

async function handleNPCAction(npc, action, activity, playerMessage) {
    if (action === 'follow') {
        npc.following = true;
        addMsg('system', `${npc.profile.name} starts following you`);
        notify(`${npc.profile.name} is following you`);
    } else if (action === 'run_away') {
        addMsg('system', `${npc.profile.name} runs away!`);
    } else if (['wave', 'laugh', 'point'].includes(action)) {
        addMsg('system', `${npc.profile.name} ${action}s`);
    } else if (action === 'give_item') {
        addMsg('system', `${npc.profile.name} gives you something`);
        notify('Received an item!');
    } else if (action === 'world_event') {
        addMsg('system', 'Something is about to happen...');
        closeChat();
        npc.following = true;
        if (onWorldEvent) onWorldEvent(npc, activity, playerMessage);
    }
}
