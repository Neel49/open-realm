// =====================================================================
// Open Realm — Main Entry Point
// =====================================================================

import * as THREE from 'three';
import { PLAYER, COLORS } from './config.js';
import { getAIStatus } from './ai/claude-service.js';
import { updateChunks } from './world/chunk-manager.js';
import { createAmbientParticles } from './world/environment.js';
import { npcs, updateNPCs } from './entities/npc.js';
import { playerPos, updatePlayer, initInput } from './entities/player.js';
import { updatePhysicsObjects, updateExplosions } from './entities/physics.js';
import { updateInteraction, handleInteractKey, handleGrabKey, handleVehicleKey } from './systems/interaction.js';
import { processWorldEvent } from './systems/world-events.js';
import { initChat, isChatOpen, closeChat } from './ui/chat.js';
import { initExamine, isExamineOpen, closeExamine } from './ui/examine.js';
import { updateInfoBar } from './ui/hud.js';

// =====================================================================
// RENDERER SETUP
// =====================================================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

scene.background = new THREE.Color(COLORS.SKY);
scene.fog = new THREE.FogExp2(COLORS.SKY, 0.008);

// =====================================================================
// LIGHTING
// =====================================================================
const sun = new THREE.DirectionalLight(0xffeedd, 2.5);
sun.position.set(50, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6644aa, 0.5));
scene.add(new THREE.HemisphereLight(0x9977cc, 0x334422, 0.4));

const purpleGlow = new THREE.PointLight(0x8844ff, 2, 40);
purpleGlow.position.set(0, 8, 0);
scene.add(purpleGlow);

// =====================================================================
// AMBIENT PARTICLES
// =====================================================================
const ambientParticles = createAmbientParticles();
scene.add(ambientParticles);

// =====================================================================
// INIT SYSTEMS
// =====================================================================
let gameStarted = false;
const clock = new THREE.Clock();

initInput(camera, renderer);

const relockPointer = () => renderer.domElement.requestPointerLock();

initChat(relockPointer, (npc, activity, playerMessage) => {
    processWorldEvent(npc, activity, playerMessage, scene);
});

initExamine(relockPointer);

// Keybindings
document.addEventListener('keydown', e => {
    if (!gameStarted) return;
    if (e.code === 'Escape') {
        if (isChatOpen()) closeChat();
        else if (isExamineOpen()) closeExamine();
    }
    if (e.code === 'KeyE' && !isChatOpen() && !isExamineOpen()) handleInteractKey(scene);
    if (e.code === 'KeyG') handleGrabKey(scene);
    if (e.code === 'KeyV') handleVehicleKey();
});

// =====================================================================
// GAME LOOP
// =====================================================================
function update() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!gameStarted) return;

    updatePlayer(dt, camera, scene);
    updateChunks(playerPos, scene, npcs, sun, purpleGlow);
    updateNPCs(dt, playerPos);
    updatePhysicsObjects(dt);
    updateExplosions(dt, scene);

    // Particles follow player
    ambientParticles.position.set(playerPos.x, 0, playerPos.z);
    ambientParticles.rotation.y += 0.0003;

    if (!isChatOpen() && !isExamineOpen()) updateInteraction(camera, scene);
    updateInfoBar(playerPos, getAIStatus());
}

function animate() {
    requestAnimationFrame(animate);
    update();
    renderer.render(scene, camera);
}

// =====================================================================
// START
// =====================================================================
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('start-screen').style.display = 'none';
    renderer.domElement.requestPointerLock();
    gameStarted = true;
    clock.start();
});

renderer.domElement.addEventListener('click', () => {
    if (gameStarted && !isChatOpen() && !isExamineOpen() && !document.pointerLockElement) {
        renderer.domElement.requestPointerLock();
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Bootstrap
updateChunks(playerPos, scene, npcs, sun, purpleGlow);
camera.position.set(0, PLAYER.HEIGHT, 0);
animate();
