// =====================================================================
// Shared Utilities
// =====================================================================

import * as THREE from 'three';

export function seeded(seed) {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

export function addLabel(obj, text, height, color = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = color;
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 40);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8 }));
    sprite.position.y = height;
    sprite.scale.set(2, 0.5, 1);
    obj.add(sprite);
}

export function getNearbyContext(pos, scene) {
    const nearby = [];
    scene.traverse(child => {
        if (child.userData.type && child.position.distanceTo(pos) < 10) {
            nearby.push(child.userData.label || child.userData.type);
        }
    });
    return nearby.slice(0, 5).join(', ') || 'empty street';
}
