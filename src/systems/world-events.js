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

    showGenerating('AI is deciding what happens...');
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

function findClearSpawn(scene, basePos, radius = 12) {
    const existing = [];
    scene.traverse(child => {
        if (child.userData.collidable || child.userData.type === 'generated') {
            const wp = new THREE.Vector3();
            child.getWorldPosition(wp);
            existing.push(wp);
        }
    });
    for (const asset of dynamicAssets) {
        const wp = new THREE.Vector3();
        asset.getWorldPosition(wp);
        existing.push(wp);
    }
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const candidate = basePos.clone();
        if (angle > 0) {
            candidate.x += Math.cos(angle) * 8;
            candidate.z += Math.sin(angle) * 8;
        }
        const tooClose = existing.some(e => {
            const dx = candidate.x - e.x, dz = candidate.z - e.z;
            return Math.sqrt(dx * dx + dz * dz) < radius;
        });
        if (!tooClose) return candidate;
    }
    const away = basePos.clone();
    away.x += (Math.random() - 0.5) * 30;
    away.z += (Math.random() - 0.5) * 30;
    return away;
}

async function processChange(change, npc, scene, player, scribe) {
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const baseSpawn = player.pos.clone().add(forward.multiplyScalar(18));
    baseSpawn.y = 0;
    const spawnPos = findClearSpawn(scene, baseSpawn, 8);

    // Special case: Batmobile — use pre-made asset with fake generation delay
    if (/batmobile/i.test(change.label || change.description || '')) {
        showGenerating('Summoning the Batmobile...');
        await new Promise(r => setTimeout(r, 3000));
        hideGenerating();

        try {
            const gltf = await new Promise((resolve, reject) => {
                gltfLoader.load('assets/generated/batmobile.glb', resolve, undefined, reject);
            });
            const model = gltf.scene;

            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0.01) model.scale.multiplyScalar(5 / maxDim);

            const scaledBox = new THREE.Box3().setFromObject(model);
            model.position.y = -scaledBox.min.y;

            model.rotation.y = -Math.PI / 2;

            model.traverse(c => {
                if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
            });

            const wrapper = new THREE.Group();
            wrapper.add(model);
            wrapper.position.copy(spawnPos);
            wrapper.position.y = 0;
            wrapper.rotation.y = player.yaw;
            wrapper.userData = {
                type: 'vehicle', label: 'Batmobile', interactable: true, drivable: true,
                collidable: true, w: 5, d: 2,
                speed: 0, steer: 0, driving: false,
            };

            scene.add(wrapper);
            interactables.push(wrapper);
            dynamicAssets.push(wrapper);
            notify('The Batmobile has arrived!');
            scribe.log('spawn', 'The Batmobile appeared nearby');
        } catch (e) {
            console.error('Failed to load Batmobile:', e);
            notify('The Batmobile failed to arrive...');
        }
        return;
    }

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

                // Auto-scale to realistic size
                const box = new THREE.Box3().setFromObject(model);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const label = (change.label || change.description || '').toLowerCase();
                let targetHeight;
                if (change.type === 'spawn_building') targetHeight = 10;
                else if (/dog|cat|pet|puppy|kitten|rabbit|chicken|duck|bird/.test(label)) targetHeight = 0.6;
                else if (/horse|cow|deer|bear|lion|tiger|elephant/.test(label)) targetHeight = 2.5;
                else if (/person|human|npc|guard|soldier|zombie/.test(label)) targetHeight = 1.7;
                else if (/car|truck|van|bus|taxi/.test(label)) targetHeight = 1.8;
                else if (/tree|lamp|pole|tower|statue/.test(label)) targetHeight = 5;
                else if (/table|desk|counter|bench|chair|stool/.test(label)) targetHeight = 1;
                else if (/food|cake|bread|pizza|cup|plate|bottle|book|phone/.test(label)) targetHeight = 0.3;
                else if (/shop|store|house|restaurant|cafe|bar|gym|church|school/.test(label)) targetHeight = 10;
                else targetHeight = change.type === 'spawn_building' ? 10 : 2;
                if (maxDim > 0.01) model.scale.multiplyScalar(targetHeight / maxDim);

                const scaledBox = new THREE.Box3().setFromObject(model);
                const offset = -scaledBox.min.y;
                model.position.copy(spawnPos);
                model.position.y = offset;

                model.traverse(c => {
                    if (c.isMesh) {
                        c.castShadow = true;
                        c.receiveShadow = true;
                        if (c.material) {
                            const mat = c.material.clone();
                            if (mat.color) {
                                const hsl = {};
                                mat.color.getHSL(hsl);
                                if (hsl.l < 0.3) mat.color.setHSL(hsl.h, hsl.s, Math.max(0.4, hsl.l * 2));
                            }
                            mat.roughness = Math.min(mat.roughness || 0.5, 0.8);
                            c.material = mat;
                        }
                    }
                });
                model.userData = {
                    type: 'generated', label: change.label || 'Generated area',
                    interactable: true, collidable: false,
                };

                if (change.type === 'spawn_building') {
                    const interiorLight = new THREE.PointLight(0xffeedd, 3, targetHeight * 2);
                    interiorLight.position.set(0, targetHeight * 0.6, 0);
                    model.add(interiorLight);
                    const doorLight = new THREE.PointLight(0xffffcc, 2, targetHeight);
                    doorLight.position.set(0, targetHeight * 0.4, targetHeight * 0.4);
                    model.add(doorLight);
                }

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
                const labelHeight = targetHeight + 2;
                sprite.position.y = labelHeight;
                sprite.scale.set(6, 0.8, 1);
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
