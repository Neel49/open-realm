// =====================================================================
// Environment — trees, street lights, particles
// =====================================================================

import * as THREE from 'three';
import { makeMat } from './materials.js';

export function createTree(x, z, rng) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.userData = { type: 'tree', label: 'Tree' };

    const trunkH = 2 + rng() * 2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, trunkH, 6), makeMat(0x4a3520, 0.9));
    trunk.position.y = trunkH / 2; trunk.castShadow = true;
    g.add(trunk);

    const leafR = 1 + rng() * 1.5;
    const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(leafR, 8, 6),
        makeMat(0x2d7a30 + Math.floor(rng() * 0x102000), 0.7)
    );
    leaves.position.y = trunkH + leafR * 0.5; leaves.castShadow = true;
    g.add(leaves);

    return g;
}

export function createStreetLight(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.userData = { type: 'streetlight', label: 'Street light', collidable: true, w: 0.3, d: 0.3 };

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), makeMat(0x555555, 0.7));
    pole.position.y = 2.5; pole.castShadow = true;
    g.add(pole);

    const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffeedd, emissive: 0xffcc88, emissiveIntensity: 2 })
    );
    lamp.position.y = 5.2;
    g.add(lamp);

    const light = new THREE.PointLight(0xffddaa, 3, 15);
    light.position.y = 5;
    g.add(light);

    return g;
}

export function createAmbientParticles() {
    const count = 300;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 80;
        pos[i * 3 + 1] = Math.random() * 20 + 2;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.04, color: 0xaa88ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
    }));
}
