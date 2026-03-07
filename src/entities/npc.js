// =====================================================================
// NPC System
// =====================================================================

import * as THREE from 'three';
import { makeMat } from '../world/materials.js';
import { generateNPCProfile } from '../ai/claude-service.js';
import { addLabel } from '../utils.js';
import { interactables } from '../world/chunk-manager.js';
import { getChatNPC } from '../ui/chat.js';

export const npcs = [];

function createHumanoid(colors) {
    const g = new THREE.Group();
    const skinMat = makeMat(0xe8c9a0, 0.5);
    const hairMat = makeMat(new THREE.Color(...(colors.hair_color || [0.1, 0.08, 0.05])), 0.6);
    const shirtMat = makeMat(new THREE.Color(...(colors.shirt_color || [0.3, 0.3, 0.6])), 0.6);
    const pantsMat = makeMat(new THREE.Color(...(colors.pants_color || [0.2, 0.2, 0.25])), 0.7);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), skinMat);
    head.position.y = 1.55; g.add(head);
    // Hair
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), hairMat);
    hair.position.y = 1.62; hair.scale.set(1, 0.7, 1); g.add(hair);
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.25), shirtMat);
    body.position.y = 1.15; g.add(body);
    // Legs
    for (const side of [-0.1, 0.1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), pantsMat);
        leg.position.set(side, 0.55, 0); g.add(leg);
    }
    // Arms
    for (const side of [-0.27, 0.27]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 6), shirtMat);
        arm.position.set(side, 1.1, 0); g.add(arm);
    }
    // Shoes
    for (const side of [-0.1, 0.1]) {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.16), makeMat(0x222222));
        shoe.position.set(side, 0.22, 0.02); g.add(shoe);
    }

    g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    return g;
}

export async function spawnNPC(x, z, seed, chunkGroup, scene) {
    const profile = await generateNPCProfile(seed);
    const mesh = createHumanoid(profile);
    mesh.position.set(x, 0, z);
    mesh.userData = { type: 'npc', label: profile.name, interactable: true };

    addLabel(mesh, profile.name, 2.0);

    const npc = {
        mesh, profile, seed,
        chatHistory: [],
        chunkKey: chunkGroup.userData.chunkKey,
        originX: x, originZ: z,
        walkTarget: new THREE.Vector3(x, 0, z),
        walkTimer: 0,
        emotion: 'neutral',
        following: false,
    };

    chunkGroup.add(mesh);
    npcs.push(npc);
    interactables.push(mesh);
}

export function updateNPCs(dt, playerPos) {
    const talkingTo = getChatNPC();
    for (const npc of npcs) {
        // Freeze NPC in conversation — face the player and stay still
        if (talkingTo === npc) {
            const dir = new THREE.Vector3().subVectors(playerPos, npc.mesh.position);
            dir.y = 0;
            if (dir.length() > 0.1) npc.mesh.rotation.y = Math.atan2(dir.x, dir.z);
            npc.mesh.position.y = 0;
            continue;
        }
        if (npc.following) {
            const dir = new THREE.Vector3().subVectors(playerPos, npc.mesh.position);
            dir.y = 0;
            if (dir.length() > 3) {
                dir.normalize().multiplyScalar(4 * dt);
                npc.mesh.position.add(dir);
                npc.mesh.rotation.y = Math.atan2(dir.x, dir.z);
                npc.mesh.position.y = Math.sin(Date.now() * 0.008) * 0.04;
            }
            continue;
        }

        npc.walkTimer -= dt;
        if (npc.walkTimer <= 0) {
            npc.walkTarget.set(
                npc.originX + (Math.random() - 0.5) * 10, 0,
                npc.originZ + (Math.random() - 0.5) * 10
            );
            npc.walkTimer = 3 + Math.random() * 5;
        }

        const dir = new THREE.Vector3().subVectors(npc.walkTarget, npc.mesh.position);
        dir.y = 0;
        if (dir.length() > 0.5) {
            dir.normalize().multiplyScalar(1.2 * dt);
            npc.mesh.position.add(dir);
            npc.mesh.rotation.y = Math.atan2(dir.x, dir.z);
            npc.mesh.position.y = Math.sin(Date.now() * 0.008) * 0.04;
        }
    }
}

export function findNPCByMesh(mesh) {
    return npcs.find(n => n.mesh === mesh);
}
