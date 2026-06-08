/**
 * DeliveryAssets.ts — Three.js meshes for delivery markers:
 *   - Restaurant marker (pulsing yellow column + pizza emoji billboard)
 *   - Customer marker  (pulsing green column)
 *   - Floating coin    (animated pickup reward)
 *   - Cargo box        (pizza box on the player's car roof)
 */

import * as THREE from 'three';
import { makePed } from './Assets';

const TAU = Math.PI * 2;

// ─── Marker column ───────────────────────────────────────────────────────────

function makeColumnMarker(color: number): THREE.Group {
    const g = new THREE.Group();

    // Vertical beam
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 14, 8),
        new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 1.8,
            transparent: true,
            opacity: 0.55,
        }),
    );
    beam.position.y = 7;
    g.add(beam);

    // Ground disc
    const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 2.5, 0.08, 32),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.28,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    disc.position.y = 0.04;
    g.add(disc);

    // Floating diamond at top
    const diamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3 }),
    );
    diamond.position.y = 15;
    g.add(diamond);
    (g as any)._diamond = diamond;

    g.visible = false;
    return g;
}

// ─── Cargo box (pizza box on car roof) ───────────────────────────────────────

function makeCargoBox(): THREE.Mesh {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.22, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xe8b84b, roughness: 0.8, metalness: 0 }),
    );
    mesh.castShadow = true;
    mesh.visible = false;
    return mesh;
}

// ─── Floating coin ────────────────────────────────────────────────────────────

class FloatingCoin {
    readonly mesh: THREE.Group;
    private age = 0;
    private readonly duration = 1.4;
    alive = false;

    constructor() {
        const g = new THREE.Group();
        const coin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16),
            new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 2 }),
        );
        coin.rotation.x = Math.PI / 2;
        g.add(coin);
        this.mesh = g;
        g.visible = false;
    }

    spawn(x: number, y: number, z: number): void {
        this.mesh.position.set(x, y + 1.2, z);
        this.age = 0;
        this.alive = true;
        this.mesh.visible = true;
    }

    update(dt: number): void {
        if (!this.alive) return;
        this.age += dt;
        this.mesh.position.y += dt * 2.5;
        this.mesh.rotation.y += dt * 4;
        const t = this.age / this.duration;
        const scale = Math.max(0, 1 - t * t);
        this.mesh.scale.setScalar(scale);
        if (this.age >= this.duration) {
            this.alive = false;
            this.mesh.visible = false;
        }
    }
}

// ─── DeliveryAssets ──────────────────────────────────────────────────────────

export class DeliveryAssets {
    readonly restaurantMarker: THREE.Group;
    readonly customerMarker: THREE.Group;
    readonly cargoBox: THREE.Mesh;
    private readonly coins: FloatingCoin[];
    private readonly waitingNPC: THREE.Group;
    private _animTime = 0;

    constructor(scene: THREE.Scene) {
        this.restaurantMarker = makeColumnMarker(0xffd24a); // yellow
        this.customerMarker = makeColumnMarker(0x3ad17a);   // green

        this.cargoBox = makeCargoBox();

        // Waiting customer NPC — distinct warm teal colour so they stand out
        this.waitingNPC = makePed(0x2ecc71);
        this.waitingNPC.visible = false;
        // Lift slightly so they don't clip the ground disc
        this.waitingNPC.position.y = 0;

        // Coin pool (8 slots — more than enough for rapid deliveries)
        this.coins = Array.from({ length: 8 }, () => {
            const c = new FloatingCoin();
            scene.add(c.mesh);
            return c;
        });

        scene.add(this.restaurantMarker, this.customerMarker, this.cargoBox, this.waitingNPC);
    }

    /** Place the restaurant marker at world position. */
    setRestaurant(x: number, z: number, visible: boolean): void {
        this.restaurantMarker.position.set(x, 0, z);
        this.restaurantMarker.visible = visible;
    }

    /** Place the customer marker at world position. */
    setCustomer(x: number, z: number, visible: boolean): void {
        this.customerMarker.position.set(x, 0, z);
        this.customerMarker.visible = visible;
        // Show/move the waiting NPC at the same spot, offset slightly to the side
        this.waitingNPC.position.set(x + 1.8, 0, z + 1.8);
        this.waitingNPC.visible = visible;
    }

    /** Show/hide the cargo box riding on top of the player's car. */
    setCargoVisible(visible: boolean, px = 0, py = 0, pz = 0): void {
        this.cargoBox.position.set(px, py, pz);
        this.cargoBox.visible = visible;
    }

    /** Spawn a floating coin burst at the delivery point. */
    spawnCoin(x: number, y: number, z: number): void {
        const slot = this.coins.find((c) => !c.alive);
        if (slot) slot.spawn(x, y, z);
    }

    /** Call every render frame with delta-time (seconds). */
    update(dt: number): void {
        this._animTime += dt;
        const t = this._animTime;

        // Diamond bobs up and down
        for (const marker of [this.restaurantMarker, this.customerMarker]) {
            const d = (marker as any)._diamond as THREE.Mesh | undefined;
            if (d && marker.visible) {
                d.position.y = 15 + Math.sin(t * 2.2) * 0.6;
                d.rotation.y = t * 1.4;
            }
        }

        // Pulse ground disc opacity
        const pulse = 0.18 + 0.12 * Math.sin(t * TAU * 0.8);
        for (const marker of [this.restaurantMarker, this.customerMarker]) {
            const disc = (marker.children[1] as THREE.Mesh)?.material as THREE.MeshBasicMaterial;
            if (disc && marker.visible) disc.opacity = pulse;
        }

        // Waiting NPC slow idle rotation (looks alive)
        if (this.waitingNPC.visible) {
            this.waitingNPC.rotation.y = Math.sin(t * 0.6) * 0.6;
        }

        // Update coins
        for (const c of this.coins) c.update(dt);
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.restaurantMarker, this.customerMarker, this.cargoBox, this.waitingNPC);
        for (const c of this.coins) scene.remove(c.mesh);
    }
}
