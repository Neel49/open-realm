// =====================================================================
// Player Class — first-person movement, grab/throw, driving
// =====================================================================

import * as THREE from 'three';
import { PLAYER, PHYSICS } from '../config.js';
import { notify } from '../ui/hud.js';

export class Player {
    constructor() {
        this.pos = new THREE.Vector3(0, PLAYER.HEIGHT, 0);
        this.vel = new THREE.Vector3();
        this.yaw = 0;
        this.pitch = 0;
        this.grounded = false;
        this.heldObject = null;
        this.inVehicle = null;
        this.keys = {};
    }

    // ---- Input Binding ----

    initInput(camera) {
        document.addEventListener('keydown', e => { this.keys[e.code] = true; });
        document.addEventListener('keyup', e => { this.keys[e.code] = false; });
        document.addEventListener('mousemove', e => {
            if (!document.pointerLockElement) return;
            this.yaw -= e.movementX * 0.002;
            this.pitch -= e.movementY * 0.002;
            this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
        });
        document.addEventListener('mousedown', e => {
            if (e.button === 0 && this.heldObject) this.throwHeldObject(camera);
        });
    }

    isKeyDown(code) { return !!this.keys[code]; }

    // ---- Update ----

    update(dt, camera, scene) {
        if (this.inVehicle) { this._updateDriving(dt, camera); return; }

        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const speed = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? PLAYER.RUN_SPEED : PLAYER.WALK_SPEED;

        const move = new THREE.Vector3();
        if (this.keys['KeyW'] || this.keys['ArrowUp']) move.add(forward);
        if (this.keys['KeyS'] || this.keys['ArrowDown']) move.sub(forward);
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) move.sub(right);
        if (this.keys['KeyD'] || this.keys['ArrowRight']) move.add(right);

        if (move.length() > 0) {
            move.normalize().multiplyScalar(speed);
            this.vel.x = move.x;
            this.vel.z = move.z;
        } else {
            this.vel.x *= 0.8;
            this.vel.z *= 0.8;
        }

        if (this.grounded && this.keys['Space']) { this.vel.y = PLAYER.JUMP_VEL; this.grounded = false; }
        this.vel.y += PHYSICS.GRAVITY * dt;
        this.pos.add(this.vel.clone().multiplyScalar(dt));

        if (this.pos.y <= PLAYER.HEIGHT) {
            this.pos.y = PLAYER.HEIGHT;
            this.vel.y = 0;
            this.grounded = true;
        }

        // Building collision
        scene.traverse(child => {
            if (!child.userData.collidable) return;
            const wp = new THREE.Vector3();
            child.getWorldPosition(wp);
            const hw = (child.userData.w || 2) / 2 + PLAYER.RADIUS;
            const hd = (child.userData.d || 2) / 2 + PLAYER.RADIUS;
            const dx = this.pos.x - wp.x, dz = this.pos.z - wp.z;
            if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
                const ox = hw - Math.abs(dx), oz = hd - Math.abs(dz);
                if (ox < oz) { this.pos.x += Math.sign(dx) * ox; this.vel.x = 0; }
                else { this.pos.z += Math.sign(dz) * oz; this.vel.z = 0; }
            }
        });

        // Camera
        camera.position.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = this.yaw;
        camera.rotation.x = this.pitch;

        // Held object
        if (this.heldObject) {
            const holdPos = new THREE.Vector3(0, -0.3, -1.5).applyQuaternion(camera.quaternion).add(camera.position);
            this.heldObject.position.lerp(holdPos, 12 * dt);
            this.heldObject.rotation.y += dt * 2;
        }
    }

    // ---- Driving ----

    _updateDriving(dt, camera) {
        const v = this.inVehicle, d = v.userData;
        if (this.keys['KeyW']) d.speed = Math.min(d.speed + 15 * dt, 25);
        else if (this.keys['KeyS']) d.speed = Math.max(d.speed - 20 * dt, -8);
        else d.speed *= 0.97;
        if (this.keys['KeyA']) d.steer += 2.5 * dt;
        if (this.keys['KeyD']) d.steer -= 2.5 * dt;
        d.steer *= 0.9;
        v.rotation.y += d.steer * dt * (Math.abs(d.speed) / 15);
        const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.rotation.y);
        v.position.add(dir.multiplyScalar(d.speed * dt));
        this.pos.copy(v.position);
        this.pos.y = PLAYER.HEIGHT;
        const camOff = new THREE.Vector3(0, 4, -8).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.rotation.y);
        camera.position.lerp(v.position.clone().add(camOff), 5 * dt);
        camera.lookAt(v.position.x, v.position.y + 1, v.position.z);
    }

    // ---- Grab / Throw ----

    grabObject(obj, scene) {
        if (this.heldObject) this.dropHeldObject();
        this.heldObject = obj;
        scene.attach(obj);
        document.getElementById('held-item').textContent = `Holding: ${obj.userData.label}`;
        document.getElementById('held-item').style.display = 'block';
        document.getElementById('crosshair').className = 'grab';
        notify(`Grabbed ${obj.userData.label}`);
    }

    dropHeldObject() {
        if (!this.heldObject) return;
        document.getElementById('held-item').style.display = 'none';
        document.getElementById('crosshair').className = '';
        this.heldObject = null;
    }

    throwHeldObject(camera) {
        if (!this.heldObject) return;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        this.heldObject.userData.velocity = dir.multiplyScalar(PHYSICS.THROW_FORCE);
        this.heldObject.userData.airborne = true;
        notify(`Threw ${this.heldObject.userData.label}!`);
        this.dropHeldObject();
    }

    enterVehicle(vehicle) {
        this.inVehicle = vehicle;
        vehicle.userData.driving = true;
        vehicle.userData.speed = 0;
        vehicle.userData.steer = 0;
        document.getElementById('vehicle-hud').style.display = 'block';
        notify('Entered vehicle — WASD to drive');
    }

    exitVehicle() {
        if (!this.inVehicle) return;
        this.inVehicle.userData.driving = false;
        this.inVehicle.userData.speed = 0;
        this.inVehicle = null;
        document.getElementById('vehicle-hud').style.display = 'none';
        this.pos.x += 2;
        notify('Exited vehicle');
    }
}
