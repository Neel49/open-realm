// =====================================================================
// Examine Panel — AI-powered object inspection
// =====================================================================

import { examineObject, resolveAction } from '../ai/claude-service.js';
import { createExplosion } from '../entities/physics.js';
import { notify } from './hud.js';
import * as THREE from 'three';

let examineOpen = false;
let onClose = null;

export function isExamineOpen() { return examineOpen; }

export function initExamine(closeCb) {
    onClose = closeCb;
}

export async function openExamine(obj, nearbyContext, scene) {
    examineOpen = true;
    document.exitPointerLock();
    const panel = document.getElementById('examine-panel');
    panel.style.display = 'block';
    document.getElementById('examine-title').textContent = obj.userData.label || obj.userData.type;
    document.getElementById('examine-desc').textContent = 'AI is examining this...';
    document.getElementById('examine-actions').innerHTML = '';

    const label = obj.userData.label || obj.userData.type;
    const result = await examineObject(label, nearbyContext);
    document.getElementById('examine-desc').textContent = result.description;

    const actionsDiv = document.getElementById('examine-actions');
    for (const action of (result.interactions || [])) {
        const btn = document.createElement('button');
        btn.textContent = action;
        btn.addEventListener('click', async () => {
            btn.textContent = 'Doing...';
            btn.disabled = true;
            const outcome = await resolveAction(label, action);
            notify(outcome.result);

            if (outcome.effect === 'disappear') obj.visible = false;
            else if (outcome.effect === 'glow') {
                obj.traverse(c => {
                    if (c.isMesh) {
                        c.material = c.material.clone();
                        c.material.emissive = new THREE.Color(0xaa55ff);
                        c.material.emissiveIntensity = 2;
                    }
                });
            } else if (outcome.effect === 'explode') {
                createExplosion(obj.position.clone(), scene);
                obj.visible = false;
            }
            if (outcome.item_found) notify(`Found: ${outcome.item_found}`);
            closeExamine();
        });
        actionsDiv.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Leave';
    closeBtn.style.color = 'rgba(255,255,255,0.4)';
    closeBtn.addEventListener('click', closeExamine);
    actionsDiv.appendChild(closeBtn);
}

export function closeExamine() {
    examineOpen = false;
    document.getElementById('examine-panel').style.display = 'none';
    if (onClose) onClose();
}
