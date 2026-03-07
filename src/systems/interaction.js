// =====================================================================
// Interaction System — raycast detection, input routing
// =====================================================================

import * as THREE from 'three';
import { interactables } from '../world/chunk-manager.js';
import { npcs, findNPCByMesh } from '../entities/npc.js';
import { openChat, isChatOpen } from '../ui/chat.js';
import { openExamine, isExamineOpen } from '../ui/examine.js';
import { getNearbyContext } from '../utils.js';

const raycaster = new THREE.Raycaster();
raycaster.far = 8;
let lookedAtObject = null;

export function updateInteraction(camera, scene, player) {
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
            if (!player.heldObject) crosshair.className = 'active';
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
    if (!player.heldObject) crosshair.className = '';
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

export function handleGrabKey(player, scene, scribe) {
    if (player.heldObject) { player.dropHeldObject(); return; }
    if (lookedAtObject?.userData.grabbable) {
        player.grabObject(lookedAtObject, scene);
        scribe.log('grab', `Grabbed ${lookedAtObject.userData.label}`);
    }
}

export function handleVehicleKey(player, scribe) {
    if (player.inVehicle) {
        scribe.log('vehicle', `Exited ${player.inVehicle.userData.label}`);
        player.exitVehicle();
        return;
    }
    if (lookedAtObject?.userData.drivable) {
        player.enterVehicle(lookedAtObject);
        scribe.log('vehicle', `Entered ${lookedAtObject.userData.label}`);
    }
}
