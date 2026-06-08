/**
 * PedModels — async FBX model pool for pedestrians.
 *
 * Loads all 8 FBX variants once, clones them per pedestrian, and manages one
 * AnimationMixer per instance so each ped plays its walking clip.
 *
 * Usage:
 *   const pool = new PedModelPool(scene);
 *   await pool.load();                     // call once at startup
 *   const instance = pool.spawn(x, z);     // returns { group, mixer, update }
 *   // each frame: instance.mixer.update(dt)
 *   pool.despawn(instance);               // hides it; call respawn to reuse
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// All 8 FBX files in public/models/FBX/
const FBX_FILES = [
    'Male_Casual.fbx',
    'Male_LongSleeve.fbx',
    'Male_Shirt.fbx',
    'Male_Suit.fbx',
    'Smooth_Male_Casual.fbx',
    'Smooth_Male_LongSleeve.fbx',
    'Smooth_Male_Shirt.fbx',
    'Smooth_Male_Suit.fbx',
];

// Mixamo models are often very large (100x scale) — auto-scaled to ~1.75 m.
const TARGET_HEIGHT = 1.75;

export interface PedInstance {
    group: THREE.Group;
    mixer: THREE.AnimationMixer;
}

export class PedModelPool {
    /** Loaded template models (one per FBX file). Cloned per ped. */
    private templates: THREE.Group[] = [];
    private clips: Map<THREE.Group, THREE.AnimationClip[]> = new Map();
    private loaded = false;

    constructor(private readonly scene: THREE.Scene) { }

    /** Load all FBX variants. Returns true if at least one loaded OK. */
    async load(): Promise<boolean> {
        const loader = new FBXLoader();
        const base = `${import.meta.env.BASE_URL}models/FBX/`;

        const results = await Promise.allSettled(
            FBX_FILES.map((f) =>
                loader.loadAsync(base + f).then((grp) => {
                    // Auto-scale: measure bounding box height and normalise to target.
                    const box = new THREE.Box3().setFromObject(grp);
                    const h = box.max.y - box.min.y;
                    if (h > 0) grp.scale.setScalar(TARGET_HEIGHT / h);

                    // Shadow casting on all child meshes.
                    grp.traverse((obj) => {
                        if ((obj as THREE.Mesh).isMesh) {
                            obj.castShadow = true;
                            obj.receiveShadow = false;
                        }
                    });

                    grp.visible = false; // templates stay hidden
                    this.templates.push(grp);
                    this.clips.set(grp, grp.animations);
                }),
            ),
        );

        const ok = results.filter((r) => r.status === 'fulfilled').length;
        console.log(`[PedModels] Loaded ${ok}/${FBX_FILES.length} FBX variants.`);
        this.loaded = ok > 0;
        return this.loaded;
    }

    get isLoaded(): boolean {
        return this.loaded;
    }

    /**
     * Clone a random template and return a live PedInstance.
     * The caller is responsible for calling `mixer.update(dt)` every frame.
     */
    spawn(variantIndex: number): PedInstance {
        const template = this.templates[variantIndex % this.templates.length];
        const group = template.clone(true);
        group.visible = true;

        const mixer = new THREE.AnimationMixer(group);

        // Pick the first animation clip (usually the walk clip from Mixamo).
        const clips = this.clips.get(template) ?? [];
        if (clips.length > 0) {
            // Prefer a clip named "walk" or "walking"; fall back to index 0.
            const clip =
                clips.find((c) => /walk/i.test(c.name)) ?? clips[0];
            const action = mixer.clipAction(clip);
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
        }

        this.scene.add(group);
        return { group, mixer };
    }

    /** Hide and remove from scene (call on gib / permanent removal). */
    despawn(inst: PedInstance): void {
        inst.group.visible = false;
        this.scene.remove(inst.group);
        inst.mixer.stopAllAction();
    }
}
