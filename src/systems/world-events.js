// =====================================================================
// World Events — AI-driven world changes (spawn buildings, etc.)
// =====================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { triggerWorldEvent, requestAssetGeneration } from '../ai/claude-service.js';
import { notify, showGenerating, updateGenerating, hideGenerating } from '../ui/hud.js';
import { interactables, dynamicAssets } from '../world/chunk-manager.js';
import { createBuilding } from '../world/building.js';
import { spawnNPC } from '../entities/npc.js';
import { getNearbyContext } from '../utils.js';
import { COLORS } from '../config.js';
import { seeded } from '../utils.js';

const gltfLoader = new GLTFLoader();

export async function processWorldEvent(npc, activity, playerMessage, scene, player, scribe) {
    const context = `Player at (${player.pos.x.toFixed(0)}, ${player.pos.z.toFixed(0)}) talking to ${npc.profile.name} (${npc.profile.occupation}). Nearby: ${getNearbyContext(player.pos, scene)}.`;
    const action = `Player said: "${playerMessage}". NPC (${npc.profile.name}) agreed to: ${activity || playerMessage}`;

    showGenerating('Claude is deciding what happens...');
    const result = await triggerWorldEvent(context, action);
    hideGenerating();

    if (result.narrative) {
        notify(result.narrative);
        scribe.log('narrative', result.narrative);
    }
    if (result.npc_dialogue) npc.chatHistory.push({ role: 'NPC', text: result.npc_dialogue });

    scribe.log('npc_chat', `Player talked to ${npc.profile.name} (${npc.profile.occupation}): "${playerMessage}"`);

    if (result.world_changes) {
        for (const change of result.world_changes) {
            await processChange(change, npc, scene, player, scribe);
        }
    }
}

async function processChange(change, npc, scene, player, scribe) {
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const spawnPos = player.pos.clone().add(forward.multiplyScalar(15));
    spawnPos.y = 0;

    if (change.type === 'spawn_building' || change.type === 'spawn_object') {
        const assetId = `gen_${Date.now()}`;

        showGenerating(`Blender is creating: ${(change.label || change.description).slice(0, 40)}...`);
        const assetPath = await requestAssetGeneration(change.description, assetId);
        hideGenerating();

        if (assetPath) {
            try {
                const gltf = await new Promise((resolve, reject) => {
                    gltfLoader.load(assetPath, resolve, undefined, reject);
                });
                const model = gltf.scene;
                model.position.copy(spawnPos);
                model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
                model.userData = {
                    type: 'generated', label: change.label || 'Generated area',
                    interactable: true, collidable: true, w: 8, d: 8,
                };

                // Label sign
                const canvas = document.createElement('canvas');
                canvas.width = 512; canvas.height = 64;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(0, 0, 512, 64);
                ctx.fillStyle = '#22d3ee';
                ctx.font = 'bold 28px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(change.label || 'New Location', 256, 42);
                const tex = new THREE.CanvasTexture(canvas);
                const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
                sprite.position.y = 8;
                sprite.scale.set(5, 0.7, 1);
                model.add(sprite);

                scene.add(model);
                dynamicAssets.push(model);
                interactables.push(model);
                notify(`${change.label} has appeared!`);
                scribe.log('spawn', `${change.label} appeared nearby`);
                return;
            } catch (e) {
                console.error('Failed to load generated asset:', e);
            }
        }

        // Fallback placeholder
        placePlaceholder(spawnPos, change, scene);

    } else if (change.type === 'spawn_npc') {
        const fakeChunk = new THREE.Group();
        fakeChunk.userData = { chunkKey: 'dynamic' };
        scene.add(fakeChunk);
        spawnNPC(spawnPos.x, spawnPos.z, Date.now(), fakeChunk, scene);
        notify(`A new person appears: ${change.label || 'someone'}`);
        scribe.log('spawn_npc', `New NPC appeared: ${change.label || 'someone'}`);

    } else if (change.type === 'teleport_player') {
        player.pos.add(forward.multiplyScalar(10));
        notify(`You travel to ${change.label || 'a new area'}`);
        scribe.log('teleport', `Player traveled to ${change.label || 'a new area'}`);

    } else if (change.type === 'weather_change' || change.type === 'modify_area') {
        notify(change.description || change.label);
        scribe.log(change.type, change.description || change.label);
    }
}

function placePlaceholder(pos, change, scene) {
    const rng = seeded(Date.now());
    const color = COLORS.BUILDING[Math.floor(rng() * COLORS.BUILDING.length)];
    const { group } = createBuilding(pos.x, pos.z, 8, 6, 8, color, rng);
    group.userData.label = change.label || 'New building';
    group.userData.interactable = true;
    scene.add(group);
    interactables.push(group);
    notify(`${change.label || 'New building'} appeared nearby!`);
}
