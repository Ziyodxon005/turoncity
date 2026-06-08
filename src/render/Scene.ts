import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { daylightFactor, sunPosition } from '../core/math';
import { makeGlowTexture, makeRoadTexture, makeRoadTextureV, makeNightSkyTexture } from './textures';
import type { City } from '../world/City';

export interface SceneQuality {
  maxPixelRatio?: number;
  shadowMapSize?: number;
  streaming?: boolean;
}

const STREAM_SHADOW_HALF = 90;

const NIGHT = {
  sky: 0x08091a,
  ambient: { color: 0x2a3060, intensity: 0.5 },
  hemiSky: 0x2d3a6a,
  sun: { color: 0xaac0ff, intensity: 1.2 },
  fogDensity: 0.007,
  bloom: { strength: 0.14, radius: 0.40, threshold: 0.42 },
};
const DAY = {
  sky: 0x9ec3e6,
  ambient: { color: 0x9fb3d0, intensity: 0.95 },
  hemiSky: 0x87b5e0,
  sun: { color: 0xfff4e0, intensity: 2.6 },
  fogDensity: 0.003,
  bloom: { strength: 0.08, radius: 0.3, threshold: 0.7 },
};

export class SceneEnv {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private ambient!: THREE.AmbientLight;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private sunDisc!: THREE.Sprite;
  private sunRadius = 0;
  private ground!: THREE.Mesh;
  private stars!: THREE.Points;
  // Cache the sky texture so setTimeOfDay never reallocates it each frame.
  private readonly nightSkyTex: THREE.CanvasTexture;
  private readonly streaming: boolean;
  private followX = 0;
  private followZ = 0;
  private readonly shadowHalf: number;

  constructor(container: HTMLElement, city: City, quality: SceneQuality = {}) {
    const maxPixelRatio = quality.maxPixelRatio ?? 2;
    const shadowMapSize = quality.shadowMapSize ?? 2048;
    this.streaming = !!quality.streaming;
    this.shadowHalf = this.streaming ? STREAM_SHADOW_HALF : city.half;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    // Portrait modeda CSS rotate qo'llaniladi — renderer landscape o'lchamda bo'lishi kerak
    const initW = Math.max(window.innerWidth, window.innerHeight);
    const initH = Math.min(window.innerWidth, window.innerHeight);
    this.renderer.setSize(initW, initH);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Night sky texture — built ONCE here, never rebuilt in setTimeOfDay
    this.nightSkyTex = makeNightSkyTexture(512);

    this.scene = new THREE.Scene();
    this.scene.background = this.nightSkyTex;
    this.scene.fog = new THREE.FogExp2(NIGHT.sky, NIGHT.fogDensity);

    this.camera = new THREE.PerspectiveCamera(
      62,
      initW / initH,
      0.5,
      city.extent * 1.5,
    );
    this.camera.position.set(0, 30, 30);

    // ── Post-processing: Bloom ─────────────────────────────────────────────
    const renderPass = new RenderPass(this.scene, this.camera);
    const resolution = new THREE.Vector2(initW, initH);
    this.bloomPass = new UnrealBloomPass(
      resolution,
      NIGHT.bloom.strength,
      NIGHT.bloom.radius,
      NIGHT.bloom.threshold,
    );
    const outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(outputPass);

    this.addLights(city, shadowMapSize);
    this.addGround(city);
    this.addStars();
    if (!this.streaming) this.addRoads(city);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onOrientationChange);
    // screen.orientation API (modern browsers)
    screen.orientation?.addEventListener?.('change', this.onOrientationChange);
    // visualViewport fires on iOS when the keyboard or rotation happens
    window.visualViewport?.addEventListener('resize', this.onResize);
  }

  private addStars(): void {
    const count = 600;
    const positions = new Float32Array(count * 3);
    const R = 700;
    // Use a seeded-style loop so stars don't jump on hot-reload
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = rand() * Math.PI * 0.5;
      positions[i * 3] = R * Math.cos(phi) * Math.cos(theta);
      positions[i * 3 + 1] = R * Math.sin(phi) + 40;
      positions[i * 3 + 2] = R * Math.cos(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xfff5e0,
        size: 1.3,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.85,
        fog: false,
      }),
    );
    this.scene.add(this.stars);
  }

  private addLights(city: City, shadowMapSize: number): void {
    this.ambient = new THREE.AmbientLight(NIGHT.ambient.color, NIGHT.ambient.intensity);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(NIGHT.hemiSky, 0x080a10, 0.65);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(NIGHT.sun.color, NIGHT.sun.intensity);
    sun.position.set(city.half * 0.6, city.half * 1.2, city.half * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -this.shadowHalf;
    cam.right = this.shadowHalf;
    cam.top = this.shadowHalf;
    cam.bottom = -this.shadowHalf;
    cam.near = 1;
    cam.far = city.extent * 2.5;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.sunRadius = city.extent * 1.1;
    const disc = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    disc.scale.setScalar(city.extent * 0.22);
    this.scene.add(disc);
    this.sunDisc = disc;
    this.setTimeOfDay(0);
  }

  setTimeOfDay(t: number): void {
    const d = daylightFactor(t);
    const mix = (a: number, b: number): THREE.Color =>
      new THREE.Color(a).lerp(new THREE.Color(b), d);
    const lerpN = (a: number, b: number): number => a + (b - a) * d;

    // Sky: use the cached night texture at night, switch to solid colour by day.
    // Never allocate a new texture here — that was causing the per-frame freeze.
    if (d <= 0.1) {
      this.scene.background = this.nightSkyTex;
    } else {
      this.scene.background = mix(NIGHT.sky, DAY.sky);
    }

    // Stars fade out at dawn
    if (this.stars) this.stars.visible = d < 0.25;

    // Fog (exponential)
    (this.scene.fog as THREE.FogExp2).density = lerpN(NIGHT.fogDensity, DAY.fogDensity);
    (this.scene.fog as THREE.FogExp2).color.copy(mix(NIGHT.sky, DAY.sky));

    this.ambient.color.copy(mix(NIGHT.ambient.color, DAY.ambient.color));
    this.ambient.intensity = lerpN(NIGHT.ambient.intensity, DAY.ambient.intensity);
    this.hemi.color.copy(mix(NIGHT.hemiSky, DAY.hemiSky));
    this.sun.color.copy(mix(NIGHT.sun.color, DAY.sun.color));
    this.sun.intensity = lerpN(NIGHT.sun.intensity, DAY.sun.intensity);

    const dir = sunPosition(t);
    this.sun.position.set(
      this.followX + dir.x * this.sunRadius,
      dir.y * this.sunRadius,
      this.followZ + dir.z * this.sunRadius,
    );
    this.sun.target.position.set(this.followX, 0, this.followZ);
    this.sun.target.updateMatrixWorld();
    this.sunDisc.position.copy(this.sun.position);
    this.sunDisc.material.color.copy(mix(0xaec6ff, 0xfff1c4));
    this.sunDisc.material.opacity = 0.45 + 0.4 * d;

    // Bloom: meaningful glow at night, barely noticeable by day
    this.bloomPass.strength = lerpN(NIGHT.bloom.strength, DAY.bloom.strength);
    this.bloomPass.radius = lerpN(NIGHT.bloom.radius, DAY.bloom.radius);
    this.bloomPass.threshold = lerpN(NIGHT.bloom.threshold, DAY.bloom.threshold);
  }

  private addGround(city: City): void {
    const size = city.extent * 2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        color: this.streaming ? 0x181b22 : 0x0c0e14,
        roughness: 0.95,
        metalness: 0.0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
  }

  follow(x: number, z: number): void {
    if (!this.streaming) return;
    this.followX = x;
    this.followZ = z;
    this.ground.position.set(x, 0, z);
  }

  private addRoads(city: City): void {
    // Road texture: built once, shared across all road meshes
    const roadTex = makeRoadTexture(512);
    // Tile based on road width: ~1 tile per road-width segment gives natural dash spacing.
    // city.roadCenters spacing ≈ roadWidth + blockSize; we want ~4-6 dashes visible per block.
    const rwUnits = city.config.roadWidth; // world units
    const tilesPerRoad = Math.max(4, Math.round(city.extent / (rwUnits * 3)));

    // Horizontal roads (along world X axis).
    // PlaneGeometry(extent, roadWidth) rotated -PI/2:
    //   UV.U → world X (road length), UV.V → world Z (road width).
    // Tile along U so dashes/edge-lines run along road length.
    const texH = roadTex.clone();
    texH.repeat.set(tilesPerRoad, 1);
    texH.needsUpdate = true;

    // Vertical roads (along world Z axis).
    // PlaneGeometry(roadWidth, extent) rotated -PI/2:
    //   UV.U → world X (road width), UV.V → world Z (road length).
    // makeRoadTextureV draws lines along X (constant-X columns) so they
    // appear as edge/centre lines across road width. Tile along V (road length).
    // NO texture rotation needed — avoids the many-thin-lines glitch.
    const roadTexV = makeRoadTextureV(512);
    const texV = roadTexV;
    texV.repeat.set(1, tilesPerRoad);
    texV.needsUpdate = true;

    const matH = new THREE.MeshStandardMaterial({ map: texH, roughness: 0.88, metalness: 0.02 });
    const matV = new THREE.MeshStandardMaterial({ map: texV, roughness: 0.88, metalness: 0.02 });

    for (const mat of [matH, matV]) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -1;
    }

    const roadGeoH = new THREE.PlaneGeometry(city.extent, city.config.roadWidth);
    const roadGeoV = new THREE.PlaneGeometry(city.config.roadWidth, city.extent);

    for (const c of city.roadCenters) {
      const h = new THREE.Mesh(roadGeoH, matH);
      h.rotation.x = -Math.PI / 2;
      h.position.set(0, 0.01, c);
      h.receiveShadow = true;
      this.scene.add(h);

      const v = new THREE.Mesh(roadGeoV, matV);
      v.rotation.x = -Math.PI / 2;
      v.position.set(c, 0.01, 0);
      v.receiveShadow = true;
      this.scene.add(v);
    }

    // Plain asphalt squares at every intersection — sit slightly above the road
    // meshes (y=0.02) to cover the overlapping painted lines and keep crossings clean.
    const rw = city.config.roadWidth;
    const intGeo = new THREE.PlaneGeometry(rw, rw);
    const intMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d25,
      roughness: 0.92,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    for (const cx of city.roadCenters) {
      for (const cz of city.roadCenters) {
        const cap = new THREE.Mesh(intGeo, intMat);
        cap.rotation.x = -Math.PI / 2;
        cap.position.set(cx, 0.02, cz);
        cap.receiveShadow = true;
        this.scene.add(cap);
      }
    }
  }

  render(): void {
    this.composer.render();
  }

  /**
   * Portrait modeda CSS rotate(90deg) qo'llanilganda innerWidth < innerHeight bo'ladi.
   * Lekin renderer doim landscape tartibda ishlashi kerak:
   *   w = ekranning uzun tomoni, h = qisqa tomoni.
   */
  private viewportSize(): { w: number; h: number } {
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    // CSS portrait rotation aktiv bo'lganda vizual landscape
    if (window.matchMedia('(orientation: portrait) and (pointer: coarse)').matches) {
      return { w: Math.max(iw, ih), h: Math.min(iw, ih) };
    }
    return { w: iw, h: ih };
  }

  private onResize = (): void => {
    const { w, h } = this.viewportSize();
    if (w === 0 || h === 0) return; // guard against transient zero sizes
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
  };

  /** orientationchange fires before the browser has relaid; wait for it to settle. */
  private onOrientationChange = (): void => {
    // First pass — catches most cases.
    this.onResize();
    // Second pass after 300 ms — iOS/Android redraw completes by then.
    setTimeout(() => this.onResize(), 300);
    // Belt-and-suspenders: one more at 700 ms for slow devices.
    setTimeout(() => this.onResize(), 700);
  };
}
