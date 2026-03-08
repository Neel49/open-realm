// =====================================================================
// Shared Materials
// =====================================================================

import * as THREE from 'three';
import { COLORS } from '../config.js';

const textureLoader = new THREE.TextureLoader();

function loadTilingTexture(path) {
    const tex = textureLoader.load(path);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    return tex;
}

export function makeMat(color, roughness = 0.8) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

export const ROAD_MAT = new THREE.MeshStandardMaterial({
    map: loadTilingTexture('assets/textures/road.png'),
    roughness: 0.95, metalness: 0.05,
});
export const SIDEWALK_MAT = new THREE.MeshStandardMaterial({
    map: loadTilingTexture('assets/textures/pavement.png'),
    roughness: 0.9, metalness: 0.05,
});
export const GRASS_MAT = new THREE.MeshStandardMaterial({
    map: loadTilingTexture('assets/textures/grass.png'),
    roughness: 0.85, metalness: 0.05,
});

export const WINDOW_MAT = new THREE.MeshStandardMaterial({
    color: COLORS.WINDOW, emissive: 0x223344, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5,
});
export const WINDOW_LIT_MAT = new THREE.MeshStandardMaterial({
    color: COLORS.WINDOW_LIT, emissive: 0xffcc44, emissiveIntensity: 1.5, roughness: 0.3,
});
