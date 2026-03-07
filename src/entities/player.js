// =====================================================================
// Player Controller — first-person movement, grab/throw, driving
// =====================================================================

import * as THREE from 'three';
import { PLAYER, PHYSICS } from '../config.js';
import { notify } from '../ui/hud.js';

export const playerPos = new THREE.Vector3(0, PLAYER.HEIGHT, 0);
export const playerVel = new THREE.Vector3();
export let yaw = 0, pitch = 0;

let grounded = false;
export let heldObject = null;
export let inVehicle = null;
const keys = {};

// ---- Input Binding ----

export function initInput(camera, renderer) {
    document.addEventListener('keydown', e => { keys[e.code] = true; });
    document.addEventListener('keyup', e => { keys[e.code] = false; });
    document.addEventListener('mousemove', e => {
        if (!document.pointerLockElement) return;
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.4, Math.min(1.4, pitch));
    });
    document.addEventListener('mousedown', e => {
        if (e.button === 0 && heldObject) throwHeldObject(camera);
    });
}

export function isKeyDown(code) { return !!keys[code]; }

// ---- Update ----

export function updatePlayer(dt, camera, scene) {
    if (inVehicle) { updateDriving(dt, camera); return; }

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? PLAYER.RUN_SPEED : PLAYER.WALK_SPEED;

    const move = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) move.add(forward);
    if (keys['KeyS'] || keys['ArrowDown']) move.sub(forward);
    if (keys['KeyA'] || keys['ArrowLeft']) move.sub(right);
    if (keys['KeyD'] || keys['ArrowRight']) move.add(right);

    if (move.length() > 0) {
        move.normalize().multiplyScalar(speed);
        playerVel.x = move.x;
        playerVel.z = move.z;
    } else {
        playerVel.x *= 0.8;
        playerVel.z *= 0.8;
    }

    if (grounded && keys['Space']) { playerVel.y = PLAYER.JUMP_VEL; grounded = false; }
    playerVel.y += PHYSICS.GRAVITY * dt;
    playerPos.add(playerVel.clone().multiplyScalar(dt));

    if (playerPos.y <= PLAYER.HEIGHT) {
        playerPos.y = PLAYER.HEIGHT;
        playerVel.y = 0;
        grounded = true;
    }

    // Building collision
    scene.traverse(child => {
        if (!child.userData.collidable) return;
        const wp = new THREE.Vector3();
        child.getWorldPosition(wp);
        const hw = (child.userData.w || 2) / 2 + PLAYER.RADIUS;
        const hd = (child.userData.d || 2) / 2 + PLAYER.RADIUS;
        const dx = playerPos.x - wp.x, dz = playerPos.z - wp.z;
        if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
            const ox = hw - Math.abs(dx), oz = hd - Math.abs(dz);
            if (ox < oz) { playerPos.x += Math.sign(dx) * ox; playerVel.x = 0; }
            else { playerPos.z += Math.sign(dz) * oz; playerVel.z = 0; }
        }
    });

    // Camera
    camera.position.set(playerPos.x, playerPos.y + 0.1, playerPos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    // Held object
    if (heldObject) {
        const holdPos = new THREE.Vector3(0, -0.3, -1.5).applyQuaternion(camera.quaternion).add(camera.position);
        heldObject.position.lerp(holdPos, 12 * dt);
        heldObject.rotation.y += dt * 2;
    }
}

// ---- Driving ----

function updateDriving(dt, camera) {
    const v = inVehicle, d = v.userData;
    if (keys['KeyW']) d.speed = Math.min(d.speed + 15 * dt, 25);
    else if (keys['KeyS']) d.speed = Math.max(d.speed - 20 * dt, -8);
    else d.speed *= 0.97;
    if (keys['KeyA']) d.steer += 2.5 * dt;
    if (keys['KeyD']) d.steer -= 2.5 * dt;
    d.steer *= 0.9;
    v.rotation.y += d.steer * dt * (Math.abs(d.speed) / 15);
    const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.rotation.y);
    v.position.add(dir.multiplyScalar(d.speed * dt));
    playerPos.copy(v.position);
    playerPos.y = PLAYER.HEIGHT;
    const camOff = new THREE.Vector3(0, 4, -8).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.rotation.y);
    camera.position.lerp(v.position.clone().add(camOff), 5 * dt);
    camera.lookAt(v.position.x, v.position.y + 1, v.position.z);
}

// ---- Grab / Throw ----

export function grabObject(obj, scene) {
    if (heldObject) dropHeldObject();
    heldObject = obj;
    scene.attach(obj);
    document.getElementById('held-item').textContent = `Holding: ${obj.userData.label}`;
    document.getElementById('held-item').style.display = 'block';
    document.getElementById('crosshair').className = 'grab';
    notify(`Grabbed ${obj.userData.label}`);
}

export function dropHeldObject() {
    if (!heldObject) return;
    document.getElementById('held-item').style.display = 'none';
    document.getElementById('crosshair').className = '';
    heldObject = null;
}

export function throwHeldObject(camera) {
    if (!heldObject) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    heldObject.userData.velocity = dir.multiplyScalar(PHYSICS.THROW_FORCE);
    heldObject.userData.airborne = true;
    notify(`Threw ${heldObject.userData.label}!`);
    dropHeldObject();
}

export function enterVehicle(vehicle) {
    inVehicle = vehicle;
    vehicle.userData.driving = true;
    vehicle.userData.speed = 0;
    vehicle.userData.steer = 0;
    document.getElementById('vehicle-hud').style.display = 'block';
    notify('Entered vehicle — WASD to drive');
}

export function exitVehicle() {
    if (!inVehicle) return;
    inVehicle.userData.driving = false;
    inVehicle.userData.speed = 0;
    inVehicle = null;
    document.getElementById('vehicle-hud').style.display = 'none';
    playerPos.x += 2;
    notify('Exited vehicle');
}
