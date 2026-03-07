// =====================================================================
// Shared Materials
// =====================================================================

import * as THREE from 'three';
import { COLORS } from '../config.js';

export function makeMat(color, roughness = 0.8) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

export const ROAD_MAT = makeMat(COLORS.ROAD, 0.95);
export const SIDEWALK_MAT = makeMat(COLORS.SIDEWALK, 0.9);
export const GRASS_MAT = makeMat(COLORS.GRASS, 0.85);

export const WINDOW_MAT = new THREE.MeshStandardMaterial({
    color: COLORS.WINDOW, emissive: 0x223344, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5,
});
export const WINDOW_LIT_MAT = new THREE.MeshStandardMaterial({
    color: COLORS.WINDOW_LIT, emissive: 0xffcc44, emissiveIntensity: 1.5, roughness: 0.3,
});
