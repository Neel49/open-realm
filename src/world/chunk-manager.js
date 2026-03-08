// =====================================================================
// Chunk Manager — procedural infinite world
// =====================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WORLD, COLORS } from '../config.js';
import { ROAD_MAT, SIDEWALK_MAT, GRASS_MAT } from './materials.js';
import { createBuilding } from './building.js';
import { createProp, PROP_TYPES } from './props.js';
import { createVehicle } from './vehicles.js';
import { createTree, createStreetLight } from './environment.js';
import { spawnNPC } from '../entities/npc.js';
import { seeded } from '../utils.js';

const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

const LANDMARK_MODELS = [
    'assets/generated/gen_1772922054799.glb',
    'assets/generated/gen_1772922648492.glb',
];

function loadLandmarkTex(path) {
    const tex = textureLoader.load(path);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
}

const LANDMARK_TEX = {
    darkStone: loadLandmarkTex('assets/textures/dark_stone.png'),
    slate:     loadLandmarkTex('assets/textures/slate_roof.png'),
    oak:       loadLandmarkTex('assets/textures/oak_wood.png'),
};

const LANDMARK_MAT_MAP = {
    DarkStone:    { map: LANDMARK_TEX.darkStone, roughness: 0.85, metalness: 0.05 },
    Stone:        { map: LANDMARK_TEX.darkStone, color: 0x999999, roughness: 0.8, metalness: 0.05 },
    GroundStone:  { map: LANDMARK_TEX.darkStone, color: 0x777777, roughness: 0.9, metalness: 0.05 },
    Slate:        { map: LANDMARK_TEX.slate, roughness: 0.7, metalness: 0.1 },
    DarkRoof:     { map: LANDMARK_TEX.slate, roughness: 0.7, metalness: 0.1 },
    ChimneyBrick: { map: LANDMARK_TEX.darkStone, color: 0x884433, roughness: 0.85, metalness: 0.05 },
    Oak:          { map: LANDMARK_TEX.oak, roughness: 0.75, metalness: 0.05 },
    Iron:         { color: 0x222222, roughness: 0.4, metalness: 0.85 },
    WroughtIron:  { color: 0x1a1a1a, roughness: 0.35, metalness: 0.9 },
    Gargoyle:     { map: LANDMARK_TEX.darkStone, color: 0x666666, roughness: 0.9, metalness: 0.05 },
    GlassRed:     { color: 0xcc2222, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 },
    GlassBlue:    { color: 0x2244cc, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 },
    StainedGlass: { color: 0x8833aa, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.6 },
    GlassPane:    { color: 0x88aacc, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5 },
    Ivy:          { color: 0x2d6b30, roughness: 0.9, metalness: 0.0 },
    Gravel:       { color: 0x888080, roughness: 0.95, metalness: 0.0 },
    CaveDark:     { color: 0x111111, roughness: 0.95, metalness: 0.0 },
    ClockFace:    { color: 0xddddcc, roughness: 0.5, metalness: 0.3 },
};

function spawnLandmark(x, z, rng, parent) {
    const path = LANDMARK_MODELS[Math.floor(rng() * LANDMARK_MODELS.length)];
    const g = new THREE.Group();
    g.position.set(x, -0.5, z);
    g.userData = { type: 'landmark', label: 'Landmark', collidable: true, w: 20, d: 20 };
    gltfLoader.load(path, (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0.01) model.scale.multiplyScalar(20 / maxDim);
        const scaledBox = new THREE.Box3().setFromObject(model);
        model.position.y = -scaledBox.min.y;
        const toRemove = [];
        model.traverse(c => {
            if (!c.isMesh) return;
            const name = c.parent?.name || c.name || '';
            if (/^(Ground|Driveway)$/i.test(name)) { toRemove.push(c); return; }
            c.castShadow = true;
            c.receiveShadow = true;
            const props = LANDMARK_MAT_MAP[c.material?.name];
            if (props) c.material = new THREE.MeshStandardMaterial(props);
        });
        toRemove.forEach(c => c.removeFromParent());
        g.add(model);
        console.log('[Landmark] Loaded', path, 'at', x, z);
    }, undefined, (err) => {
        console.error('[Landmark] Failed to load', path, err);
    });
    parent.add(g);
}

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
    const isSpawnArea = cx === 0 && cz === 0;
    const isNearSpawn = Math.abs(cx) <= 1 && Math.abs(cz) <= 1;
    const isRoadX = !isNearSpawn && Math.abs(cx) % 3 === 0;
    const isRoadZ = !isNearSpawn && Math.abs(cz) % 3 === 0;
    const isPark = isSpawnArea || (!isRoadX && !isRoadZ && rng() < 0.15);
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

    // Landmarks (GLB models) — decide first so we can skip normal buildings
    const hasLandmark = !isRoadX && !isRoadZ && !isPark && rng() < 0.25;
    if (hasLandmark) {
        spawnLandmark(ox, oz, rng, group);
    }

    // Buildings (skip if a landmark is in this chunk)
    if (!isRoadX && !isRoadZ && !isPark && !hasLandmark) {
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
