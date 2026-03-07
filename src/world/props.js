// =====================================================================
// Props — interactive objects (crates, barrels, etc.)
// =====================================================================

import * as THREE from 'three';
import { makeMat } from './materials.js';

export function createProp(type, x, z, rng) {
    let mesh;
    const data = { type, interactable: true, grabbable: false };

    switch (type) {
        case 'crate':
            mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), makeMat(0x8b6b3d, 0.9));
            mesh.position.set(x, 0.4, z);
            data.label = 'Wooden crate'; data.grabbable = true;
            break;
        case 'barrel':
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10), makeMat(0x6b4423, 0.85));
            mesh.position.set(x, 0.45, z);
            data.label = 'Barrel'; data.grabbable = true;
            break;
        case 'trashcan':
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.8, 8), makeMat(0x444444, 0.7));
            mesh.position.set(x, 0.4, z);
            data.label = 'Trash can'; data.grabbable = true;
            break;
        case 'cone':
            mesh = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 8), makeMat(0xff6622, 0.6));
            mesh.position.set(x, 0.3, z);
            data.label = 'Traffic cone'; data.grabbable = true;
            break;
        case 'hydrant': {
            const g = new THREE.Group();
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.6, 8), makeMat(0xcc2222, 0.5));
            cyl.position.y = 0.3;
            g.add(cyl);
            g.position.set(x, 0, z);
            mesh = g;
            data.label = 'Fire hydrant'; data.collidable = true; data.w = 0.4; data.d = 0.4;
            break;
        }
        case 'bench': {
            const g = new THREE.Group();
            const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), makeMat(0x6b4423));
            seat.position.y = 0.45;
            g.add(seat);
            const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.06), makeMat(0x6b4423));
            back.position.set(0, 0.7, -0.22);
            g.add(back);
            g.position.set(x, 0, z);
            g.rotation.y = rng() * Math.PI;
            mesh = g;
            data.label = 'Park bench';
            break;
        }
        default:
            mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), makeMat(0x888888));
            mesh.position.set(x, 0.25, z);
            data.label = 'Object';
    }

    mesh.userData = data;
    mesh.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    return mesh;
}

export const PROP_TYPES = ['crate', 'barrel', 'trashcan', 'cone', 'hydrant'];
