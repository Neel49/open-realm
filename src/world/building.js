// =====================================================================
// Building Generator
// =====================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COLORS } from '../config.js';
import { makeMat, WINDOW_MAT, WINDOW_LIT_MAT } from './materials.js';

const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

export function createBuilding(x, z, w, h, d, color, rng) {
    const group = new THREE.Group();
    group.userData = { type: 'building', label: `${Math.floor(h)}m tall building`, collidable: true, w, d };
    group.position.set(x, 0, z);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color, 0.7));
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Windows
    const winGeo = new THREE.PlaneGeometry(1, 1.4);
    for (let row = 0; row < Math.floor(h / 3); row++) {
        const wy = 2 + row * 3;
        for (let col = 0; col < Math.floor(w / 2.5); col++) {
            const wx = -w / 2 + 1.5 + col * 2.5;
            const wMat = rng() < 0.4 ? WINDOW_LIT_MAT : WINDOW_MAT;
            const wf = new THREE.Mesh(winGeo, wMat);
            wf.position.set(wx, wy, d / 2 + 0.01);
            group.add(wf);
            const wb = new THREE.Mesh(winGeo, wMat);
            wb.position.set(wx, wy, -d / 2 - 0.01);
            wb.rotation.y = Math.PI;
            group.add(wb);
        }
    }

    // Door
    const door = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 2.5),
        makeMat(0x443322, 0.6)
    );
    door.position.set(0, 1.25, d / 2 + 0.02);
    door.userData = { type: 'door', label: 'Building entrance', interactable: true };
    group.add(door);

    return { group, door };
}

export function createBank(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.userData = { type: 'building', label: 'Gotham National Bank', collidable: true, w: 10, d: 10 };

    const bankTex = textureLoader.load('assets/textures/gen_1772920989704_tex.webp');
    bankTex.flipY = false;
    bankTex.colorSpace = THREE.SRGBColorSpace;

    const brickTex = textureLoader.load('assets/textures/tex_a052b9cf.webp');
    brickTex.flipY = false;
    brickTex.colorSpace = THREE.SRGBColorSpace;
    brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;

    gltfLoader.load('assets/generated/gen_1772920989704.glb', (gltf) => {
        const model = gltf.scene;

        // Scale to ~10m tall
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0.01) model.scale.multiplyScalar(10 / maxDim);

        // Ground the model
        const scaledBox = new THREE.Box3().setFromObject(model);
        model.position.y = -scaledBox.min.y;

        model.traverse(c => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
                c.material = new THREE.MeshStandardMaterial({
                    map: bankTex,
                    roughness: 0.7,
                    metalness: 0.2,
                });
            }
        });

        g.add(model);
    });

    return g;
}
