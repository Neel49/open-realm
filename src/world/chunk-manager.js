// =====================================================================
// Chunk Manager — procedural infinite world
// =====================================================================

import * as THREE from 'three';
import { WORLD, COLORS } from '../config.js';
import { ROAD_MAT, SIDEWALK_MAT, GRASS_MAT } from './materials.js';
import { createBuilding } from './building.js';
import { createProp, PROP_TYPES } from './props.js';
import { createVehicle } from './vehicles.js';
import { createTree, createStreetLight } from './environment.js';
import { spawnNPC } from '../entities/npc.js';
import { inVehicle } from '../entities/player.js';
import { seeded } from '../utils.js';

// Registries — shared with other systems
export const chunks = new Map();
export const interactables = [];
export const physicsObjects = [];
export const dynamicAssets = [];

function chunkKey(cx, cz) { return `${cx},${cz}`; }

export function generateChunk(cx, cz, scene) {
    const key = chunkKey(cx, cz);
    if (chunks.has(key)) return;

    const group = new THREE.Group();
    group.userData.chunkKey = key;
    const rng = seeded(cx * 73856093 ^ cz * 19349663);
    const ox = cx * WORLD.CHUNK_SIZE;
    const oz = cz * WORLD.CHUNK_SIZE;

    // Ground
    const isRoadX = Math.abs(cx) % 3 === 0;
    const isRoadZ = Math.abs(cz) % 3 === 0;
    const isPark = !isRoadX && !isRoadZ && rng() < 0.15;
    const groundMat = (isRoadX || isRoadZ) ? ROAD_MAT : isPark ? GRASS_MAT : SIDEWALK_MAT;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.CHUNK_SIZE, WORLD.CHUNK_SIZE), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(ox, 0, oz);
    ground.receiveShadow = true;
    group.add(ground);

    // Road markings
    if (isRoadX || isRoadZ) {
        const stripe = new THREE.Mesh(
            new THREE.PlaneGeometry(isRoadX ? 0.15 : WORLD.CHUNK_SIZE * 0.8, isRoadZ ? 0.15 : WORLD.CHUNK_SIZE * 0.8),
            new THREE.MeshBasicMaterial({ color: 0xcccc66 })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(ox, 0.01, oz);
        group.add(stripe);
    }

    // Buildings
    if (!isRoadX && !isRoadZ && !isPark) {
        const n = Math.floor(rng() * 3) + 1;
        for (let i = 0; i < n; i++) {
            const bw = 4 + rng() * 8, bd = 4 + rng() * 8, bh = 5 + rng() * 25;
            const bx = ox + (rng() - 0.5) * (WORLD.CHUNK_SIZE - bw - 4);
            const bz = oz + (rng() - 0.5) * (WORLD.CHUNK_SIZE - bd - 4);
            const color = COLORS.BUILDING[Math.floor(rng() * COLORS.BUILDING.length)];
            const { group: bldg, door } = createBuilding(bx, bz, bw, bh, bd, color, rng);
            group.add(bldg);
            interactables.push(door);
        }
    }

    // Parks
    if (isPark) {
        for (let i = 0; i < 3 + Math.floor(rng() * 5); i++) {
            group.add(createTree(ox + (rng() - 0.5) * (WORLD.CHUNK_SIZE - 4), oz + (rng() - 0.5) * (WORLD.CHUNK_SIZE - 4), rng));
        }
        for (let i = 0; i < 2; i++) {
            const b = createProp('bench', ox + (rng() - 0.5) * 15, oz + (rng() - 0.5) * 15, rng);
            group.add(b);
            interactables.push(b);
        }
    }

    // Street props & vehicles
    if (isRoadX || isRoadZ) {
        for (let i = 0; i < 2; i++)
            group.add(createStreetLight(ox + (rng() - 0.5) * 30, oz + (rng() - 0.5) * 30));
        for (let i = 0; i < Math.floor(rng() * 4); i++) {
            const p = createProp(PROP_TYPES[Math.floor(rng() * PROP_TYPES.length)], ox + (rng() - 0.5) * 30, oz + (rng() - 0.5) * 30, rng);
            group.add(p);
            interactables.push(p);
            if (p.userData.grabbable) physicsObjects.push(p);
        }
        if (rng() < 0.35) {
            const car = createVehicle(ox + (rng() - 0.5) * 20, oz + (rng() - 0.5) * 20, rng);
            group.add(car);
            interactables.push(car);
        }
    }

    // NPCs
    if (!isRoadX && !isRoadZ && rng() < 0.6) {
        for (let i = 0; i < Math.floor(rng() * 2) + 1; i++) {
            spawnNPC(ox + (rng() - 0.5) * 20, oz + (rng() - 0.5) * 20, cx * 1000 + cz * 100 + i, group, scene);
        }
    }

    scene.add(group);
    chunks.set(key, group);
}

export function unloadChunk(key, scene, npcs) {
    const group = chunks.get(key);
    if (!group) return;

    // If the player is driving a vehicle in this chunk, reparent it to the scene
    if (inVehicle && inVehicle.parent === group) {
        scene.attach(inVehicle);
    }

    for (let i = npcs.length - 1; i >= 0; i--) {
        if (npcs[i].chunkKey === key) { scene.remove(npcs[i].mesh); npcs.splice(i, 1); }
    }
    group.traverse(child => {
        let idx = interactables.indexOf(child);
        if (idx !== -1) interactables.splice(idx, 1);
        idx = physicsObjects.indexOf(child);
        if (idx !== -1) physicsObjects.splice(idx, 1);
    });
    scene.remove(group);
    chunks.delete(key);
}

export function updateChunks(playerPos, scene, npcs, sun, purpleGlow) {
    const pcx = Math.round(playerPos.x / WORLD.CHUNK_SIZE);
    const pcz = Math.round(playerPos.z / WORLD.CHUNK_SIZE);

    for (let dx = -WORLD.RENDER_DIST; dx <= WORLD.RENDER_DIST; dx++)
        for (let dz = -WORLD.RENDER_DIST; dz <= WORLD.RENDER_DIST; dz++)
            generateChunk(pcx + dx, pcz + dz, scene);

    for (const [key] of chunks) {
        const [cx, cz] = key.split(',').map(Number);
        if (Math.abs(cx - pcx) > WORLD.RENDER_DIST + 1 || Math.abs(cz - pcz) > WORLD.RENDER_DIST + 1)
            unloadChunk(key, scene, npcs);
    }

    sun.position.set(playerPos.x + 50, 80, playerPos.z + 30);
    sun.target.position.copy(playerPos);
    sun.target.updateMatrixWorld();
    purpleGlow.position.set(playerPos.x, 8, playerPos.z);
}
