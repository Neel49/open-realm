// =====================================================================
// Chat Panel — NPC conversation UI
// =====================================================================

import { chatWithNPC } from '../ai/claude-service.js';
import { notify } from './hud.js';

let chatOpen = false;
let chatNPC = null;
let onClose = null;
let onWorldEvent = null;

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
    } else {
        for (const msg of npc.chatHistory) addMsg(msg.role === 'NPC' ? 'npc' : 'player', msg.text);
    }
    setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

export function closeChat() {
    chatOpen = false;
    chatNPC = null;
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

    if (response.action && response.action !== 'none') {
        handleNPCAction(chatNPC, response.action, response.activity, text);
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
