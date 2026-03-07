// =====================================================================
// Open Realm — Main Entry Point
// =====================================================================

import * as THREE from 'three';
import { PLAYER, COLORS } from './config.js';
import { getAIStatus } from './ai/claude-service.js';
import { updateChunks } from './world/chunk-manager.js';
import { createAmbientParticles } from './world/environment.js';
import { npcs, updateNPCs, spawnStoryNPC } from './entities/npc.js';
import { Player } from './entities/player.js';
import { updatePhysicsObjects, updateExplosions } from './entities/physics.js';
import { updateInteraction, handleInteractKey, handleGrabKey, handleVehicleKey } from './systems/interaction.js';
import { processWorldEvent } from './systems/world-events.js';
import { initChat, isChatOpen, closeChat } from './ui/chat.js';
import { initExamine, isExamineOpen, closeExamine } from './ui/examine.js';
import { updateInfoBar } from './ui/hud.js';
import { MusicManager } from './audio/music-manager.js';
import { Scribe } from './systems/scribe.js';

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
const player = new Player();
const scribe = new Scribe();
const music = new MusicManager(scribe);

player.initInput(camera);

const relockPointer = () => renderer.domElement.requestPointerLock();

initChat(relockPointer, (npc, activity, playerMessage) => {
    processWorldEvent(npc, activity, playerMessage, scene, player, scribe);
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
    if (e.code === 'KeyG') handleGrabKey(player, scene, scribe);
    if (e.code === 'KeyV') handleVehicleKey(player, scene, scribe);
});

// =====================================================================
// GAME LOOP
// =====================================================================
function update() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!gameStarted) return;

    if (!isChatOpen() && !isExamineOpen()) player.update(dt, camera, scene);
    updateChunks(player.pos, scene, npcs, sun, purpleGlow);
    updateNPCs(dt, player.pos, scene);
    updatePhysicsObjects(dt);
    updateExplosions(dt, scene);

    // Particles follow player
    ambientParticles.position.set(player.pos.x, 0, player.pos.z);
    ambientParticles.rotation.y += 0.0003;

    music.update(dt, player.pos);

    if (!isChatOpen() && !isExamineOpen()) updateInteraction(camera, scene, player);
    updateInfoBar(player.pos, getAIStatus());
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
    music.init(player.pos);
    music.resume();
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

// Story NPCs
spawnStoryNPC({
    name: 'Rosa',
    occupation: 'florist',
    personality: 'A warm, curious florist who loves asking people about their favourite flowers. After chatting for a bit, she always invites them to come check out her flower shop.',
    greeting: "Oh hi! I love meeting new people. So tell me — what are your favourite types of flowers?",
    hair_color: [0.6, 0.2, 0.1],
    shirt_color: [0.3, 0.7, 0.4],
    pants_color: [0.25, 0.2, 0.15],
}, 5, 8, scene);

spawnStoryNPC({
    name: 'Bruce Wayne',
    occupation: 'billionaire philanthropist',
    personality: 'The Dark Knight himself, disguised as a billionaire. Speaks in a gravelly, cryptic tone. Knows the city is crawling with criminals and is always ready to take action. Will offer the player a ride in the Batmobile if they seem brave enough.',
    greeting: "Crime never sleeps in this city... neither do I. You look like someone who can handle themselves. How about we take the Batmobile for a spin?",
    voice: 'Charon',
    hair_color: [0.05, 0.05, 0.05],
    shirt_color: [0.1, 0.1, 0.12],
    pants_color: [0.08, 0.08, 0.1],
}, -8, 5, scene);

// Bootstrap
updateChunks(player.pos, scene, npcs, sun, purpleGlow);
camera.position.set(0, PLAYER.HEIGHT, 0);
animate();
