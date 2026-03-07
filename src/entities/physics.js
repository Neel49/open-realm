// =====================================================================
// Simple Physics — airborne objects, explosions
// =====================================================================

import * as THREE from 'three';
import { PHYSICS } from '../config.js';
import { physicsObjects } from '../world/chunk-manager.js';

const explosions = [];

export function updatePhysicsObjects(dt) {
    for (const obj of physicsObjects) {
        if (!obj.userData.airborne) continue;
        const v = obj.userData.velocity;
        v.y += PHYSICS.GRAVITY * dt;
        obj.position.add(v.clone().multiplyScalar(dt));
        obj.rotation.x += dt * 5;
        obj.rotation.z += dt * 3;
        if (obj.position.y <= 0.4) {
            obj.position.y = 0.4;
            v.set(0, 0, 0);
            obj.userData.airborne = false;
        }
    }
}

export function createExplosion(pos, scene) {
    const count = 30;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y + 0.5;
        positions[i * 3 + 2] = pos.z;
        velocities.push(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6 + 2, (Math.random() - 0.5) * 8));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        size: 0.15, color: 0xff8844,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const p = new THREE.Points(geo, mat);
    scene.add(p);
    explosions.push({ particles: p, velocities, life: 1.5 });
}

export function updateExplosions(dt, scene) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        e.life -= dt;
        if (e.life <= 0) { scene.remove(e.particles); explosions.splice(i, 1); continue; }
        const pos = e.particles.geometry.attributes.position.array;
        for (let j = 0; j < e.velocities.length; j++) {
            e.velocities[j].y += PHYSICS.GRAVITY * dt * 0.3;
            pos[j * 3] += e.velocities[j].x * dt;
            pos[j * 3 + 1] += e.velocities[j].y * dt;
            pos[j * 3 + 2] += e.velocities[j].z * dt;
        }
        e.particles.geometry.attributes.position.needsUpdate = true;
        e.particles.material.opacity = e.life / 1.5;
    }
}
