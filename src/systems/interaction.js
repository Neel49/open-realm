// =====================================================================
// Interaction System — raycast detection, input routing
// =====================================================================

import * as THREE from 'three';
import { interactables } from '../world/chunk-manager.js';
import { npcs, findNPCByMesh } from '../entities/npc.js';
import { heldObject, grabObject, dropHeldObject, enterVehicle, exitVehicle, inVehicle } from '../entities/player.js';
import { openChat, isChatOpen } from '../ui/chat.js';
import { openExamine, isExamineOpen } from '../ui/examine.js';
import { getNearbyContext } from '../utils.js';

const raycaster = new THREE.Raycaster();
raycaster.far = 8;
let lookedAtObject = null;

export function updateInteraction(camera, scene) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const targets = [...interactables];
    for (const npc of npcs) targets.push(npc.mesh);

    const intersects = raycaster.intersectObjects(targets, true);
    lookedAtObject = null;
    const prompt = document.getElementById('prompt');
    const crosshair = document.getElementById('crosshair');

    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.interactable && !obj.userData.type) obj = obj.parent;
        if (obj && obj.userData.type) {
            lookedAtObject = obj;
            if (!heldObject) crosshair.className = 'active';
            const type = obj.userData.type;
            let text = '';
            if (type === 'npc') text = `<kbd>E</kbd> Talk to ${obj.userData.label}`;
            else if (type === 'vehicle') text = `<kbd>V</kbd> Enter ${obj.userData.label}`;
            else if (obj.userData.grabbable) text = `<kbd>E</kbd> Examine &nbsp; <kbd>G</kbd> Grab`;
            else text = `<kbd>E</kbd> Examine ${obj.userData.label}`;
            prompt.innerHTML = text;
            prompt.style.display = 'block';
            return;
        }
    }
    prompt.style.display = 'none';
    if (!heldObject) crosshair.className = '';
}

export function handleInteractKey(scene) {
    if (!lookedAtObject) return;
    if (lookedAtObject.userData.type === 'npc') {
        const npc = findNPCByMesh(lookedAtObject);
        if (npc) openChat(npc);
    } else {
        const ctx = getNearbyContext(lookedAtObject.position, scene);
        openExamine(lookedAtObject, ctx, scene);
    }
}

export function handleGrabKey(scene) {
    if (heldObject) { dropHeldObject(); return; }
    if (lookedAtObject?.userData.grabbable) grabObject(lookedAtObject, scene);
}

export function handleVehicleKey() {
    if (inVehicle) { exitVehicle(); return; }
    if (lookedAtObject?.userData.drivable) enterVehicle(lookedAtObject);
}
