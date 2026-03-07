// =====================================================================
// Vehicle Generator
// =====================================================================

import * as THREE from 'three';
import { makeMat } from './materials.js';

const CAR_COLORS = [0xcc3333, 0x3333cc, 0x33aa33, 0xcccc33, 0xeeeeee, 0x222222];

export function createVehicle(x, z, rng) {
    const g = new THREE.Group();
    const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];

    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4), makeMat(color, 0.4));
    body.position.y = 0.6; body.castShadow = true;
    g.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2), makeMat(color, 0.4));
    roof.position.set(0, 1.3, -0.3); roof.castShadow = true;
    g.add(roof);

    const ws = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x88aacc, transparent: true, opacity: 0.6, roughness: 0.1 })
    );
    ws.position.set(0, 1.2, 0.72); ws.rotation.x = -0.2;
    g.add(ws);

    const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12);
    const wm = makeMat(0x111111, 0.95);
    for (const [wx, wz] of [[-1, 1.2], [1, 1.2], [-1, -1.2], [1, -1.2]]) {
        const w = new THREE.Mesh(wg, wm);
        w.position.set(wx, 0.3, wz);
        w.rotation.z = Math.PI / 2;
        g.add(w);
    }

    g.position.set(x, 0, z);
    g.rotation.y = rng() * Math.PI * 2;
    g.userData = {
        type: 'vehicle', label: 'Car', interactable: true, drivable: true,
        collidable: true, w: 2.2, d: 4.2,
        speed: 0, steer: 0, driving: false,
    };

    return g;
}
