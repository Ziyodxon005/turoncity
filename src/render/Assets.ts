import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building, Streetlight, Prop } from '../world/City';
import type { FacadeStyle, PropType } from '../world/biome';
import { makeFacadeTexture, makeGlowTexture } from './textures';

const LAMP_HEIGHT = 5.2;

const UV_TILE = 24; // world units per full facade-texture tile (~3 units/window)

/**
 * Mesh factories. Buildings share a small pool of facade textures and a cached
 * material-per-(texture x tint) set, so hundreds of towers cost only a handful
 * of materials. Per-building geometry carries custom UV scaling so window rows
 * track each tower's real height.
 */
const FACADE_STYLES: FacadeStyle[] = ['glass', 'brick', 'concrete'];

export class CityAssets {
  private readonly facadesByStyle: Record<FacadeStyle, THREE.CanvasTexture[]>;
  private readonly sideCache = new Map<string, THREE.Material>();
  private readonly roofMat: THREE.Material;

  // Shared across every streetlight so the whole grid of lamps costs a handful
  // of GPU resources, not one set per pole.
  private readonly poleGeo = new THREE.CylinderGeometry(0.13, 0.18, LAMP_HEIGHT, 8);
  private readonly headGeo = new THREE.SphereGeometry(0.42, 12, 10);
  private readonly poolGeo = new THREE.PlaneGeometry(11, 11);
  private readonly poleMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7, metalness: 0.4 });
  private readonly headMat = new THREE.MeshStandardMaterial({
    color: 0xffe6bf,
    emissive: 0xffd9a0,
    emissiveIntensity: 3,
  });
  private readonly poolMat: THREE.Material;

  // Shared prototype geometry+material per prop type; each geometry is shifted so
  // its base sits at y=0, so an instance matrix only needs world x/z + rotation.
  private readonly propProto: Record<PropType, { geo: THREE.BufferGeometry; mat: THREE.Material }>;

  constructor(seed: number, variants = 3) {
    // A small pool of texture variants per facade style; buildings draw from the
    // pool matching their biome-assigned style, so the skyline isn't all glass.
    this.facadesByStyle = { glass: [], brick: [], concrete: [] };
    FACADE_STYLES.forEach((style, s) => {
      for (let i = 0; i < variants; i++) {
        this.facadesByStyle[style].push(makeFacadeTexture(seed + s * 1000 + i * 101, style));
      }
    });
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.95 });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });

    // Each prop is several primitives merged into ONE vertex-coloured geometry,
    // so a whole prop type still renders as a single InstancedMesh while looking
    // like an actual tree / hydrant / bench instead of a bare cone or box.
    const vc = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.propProto = {
      tree: { geo: makeTreeGeometry(), mat: vc() },
      hydrant: { geo: makeHydrantGeometry(), mat: vc() },
      bench: { geo: makeBenchGeometry(), mat: vc() },
    };
  }

  /** One InstancedMesh per prop type (a few draw calls for the whole map). */
  makeProps(props: Prop[]): THREE.Group {
    const group = new THREE.Group();
    const byType: Record<PropType, Prop[]> = { tree: [], hydrant: [], bench: [] };
    for (const p of props) byType[p.type].push(p);

    const dummy = new THREE.Object3D();
    for (const type of Object.keys(byType) as PropType[]) {
      const list = byType[type];
      if (list.length === 0) continue;
      const { geo, mat } = this.propProto[type];
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.castShadow = true;
      list.forEach((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
    return group;
  }

  makeStreetlight(s: Streetlight): THREE.Group {
    const g = new THREE.Group();

    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = LAMP_HEIGHT / 2;
    pole.castShadow = true;
    g.add(pole);

    const head = new THREE.Mesh(this.headGeo, this.headMat);
    head.position.y = LAMP_HEIGHT;
    g.add(head);

    const pool = new THREE.Mesh(this.poolGeo, this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.05; // hover just above the road to avoid z-fighting
    g.add(pool);

    g.position.set(s.x, 0, s.z);
    return g;
  }

  makeBuilding(b: Building, index: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(b.width, b.height, b.depth);
    scaleFacadeUvs(geo, b.width, b.height, b.depth);

    const pool = this.facadesByStyle[b.style];
    const facade = pool[index % pool.length];
    const side = this.sideMaterial(facade, b.color);
    // Face order: +X, -X, +Y(roof), -Y(floor), +Z, -Z.
    const mesh = new THREE.Mesh(geo, [side, side, this.roofMat, this.roofMat, side, side]);
    mesh.position.set(b.cx, b.height / 2, b.cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Day/night: lit windows and lamp heads shouldn't glow in daylight, so scale
   * their emissive by the daylight factor (`d`: 0 night → 1 noon). By day the
   * facades also turn glassier (lower roughness, higher metalness) so windows
   * read as reflective glass instead of dark holes.
   */
  setDaylight(d: number): void {
    const lit = 1 - 0.92 * d; // full glow at night → nearly off at noon
    for (const m of this.sideCache.values()) {
      const sm = m as THREE.MeshStandardMaterial;
      sm.emissiveIntensity = 1.1 * lit;
      sm.roughness = 0.75 - 0.5 * d;
      sm.metalness = 0.05 + 0.5 * d;
    }
    this.headMat.emissiveIntensity = 3 * lit;
    (this.poolMat as THREE.MeshBasicMaterial).opacity = 0.9 * lit;
  }

  private sideMaterial(facade: THREE.CanvasTexture, tint: number): THREE.Material {
    const key = `${facade.uuid}:${tint}`;
    let mat = this.sideCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: tint,
        map: facade,
        emissive: 0xffffff,
        emissiveMap: facade,
        emissiveIntensity: 1.1,
        roughness: 0.75,
        metalness: 0.05,
      });
      this.sideCache.set(key, mat);
    }
    return mat;
  }
}

// ── TURON Logo Sign ────────────────────────────────────────────────────────────

/**
 * Places a Turon logo sign on all 4 sides of the building so it's visible
 * from any direction. Signs are larger and brighter for clear readability.
 */
export function makeTuronSign(
  bx: number, bz: number, bWidth: number, bDepth: number, bHeight: number,
): THREE.Group {
  const group = new THREE.Group();

  const loader = new THREE.TextureLoader();
  const logoTex = loader.load('/turon.png');
  logoTex.colorSpace = THREE.SRGBColorSpace;
  logoTex.minFilter = THREE.LinearMipmapLinearFilter;
  logoTex.magFilter = THREE.LinearFilter;
  logoTex.anisotropy = 4;
  logoTex.generateMipmaps = true;

  const signY = bHeight * 0.65;
  const GAP = 0.12; // gap between sign face and building wall

  // Helper: add one sign face (backing + logo plane) at the given position + Y-rotation
  function addFace(wallWidth: number, wallHeight: number, px: number, pz: number, rotY: number): void {
    const sw = Math.min(wallWidth * 0.88, 20);   // wider — more visible
    const sh = Math.min(wallHeight * 0.5, 14);   // taller — more visible

    const backGeo = new THREE.PlaneGeometry(sw + 1.2, sh + 1.2);
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x05050f,
      roughness: 0.95,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.set(px, signY, pz);
    back.rotation.y = rotY;
    back.renderOrder = 1;

    const logoGeo = new THREE.PlaneGeometry(sw, sh);
    // MeshBasicMaterial ishlatamiz: lighting hisob-kitoblarisiz bo'lgani uchun
    // emissive flickering va z-fighting bo'lmaydi. Color o'rniga texture to'g'ridan-to'g'ri
    // ko'rsatiladi, shuning uchun logo har doim bir xil yorqinlikda turadi.
    const logoMat = new THREE.MeshBasicMaterial({
      map: logoTex,
      transparent: true,
      alphaTest: 0.1,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const logo = new THREE.Mesh(logoGeo, logoMat);
    logo.position.set(px, signY, pz);
    logo.rotation.y = rotY;
    logo.renderOrder = 2;

    group.add(back, logo);
  }

  // +Z face (south / front)
  addFace(bWidth, bHeight, bx, bz + bDepth / 2 + GAP, 0);
  // -Z face (north / back)
  addFace(bWidth, bHeight, bx, bz - bDepth / 2 - GAP, Math.PI);
  // +X face (east)
  addFace(bDepth, bHeight, bx + bWidth / 2 + GAP, bz, Math.PI / 2);
  // -X face (west)
  addFace(bDepth, bHeight, bx - bWidth / 2 - GAP, bz, -Math.PI / 2);

  return group;
}

/** Scale per-face UVs so windows tile by real dimensions; roof/floor collapse to the dark texel. */
function scaleFacadeUvs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const set = (face: number, su: number, sv: number): void => {
    const base = face * 8;
    for (let i = 0; i < 4; i++) {
      uv.array[base + i * 2] *= su;
      uv.array[base + i * 2 + 1] *= sv;
    }
  };
  // Repeat a WHOLE number of tiles per face: a fractional repeat leaves a
  // partial tile at the seam that slices windows in half (worst on the big,
  // sparse brick facades). Rounding to integer tiles keeps every window intact;
  // window size then varies slightly per building, which reads fine.
  const ru = (n: number) => Math.max(1, Math.round(n / UV_TILE));
  set(0, ru(d), ru(h)); // +X
  set(1, ru(d), ru(h)); // -X
  set(2, 0, 0); // +Y roof
  set(3, 0, 0); // -Y floor
  set(4, ru(w), ru(h)); // +Z
  set(5, ru(w), ru(h)); // -Z
  uv.needsUpdate = true;
}

export interface CarMesh {
  group: THREE.Group;
  /** Front wheels, rotated for a visual steering cue. */
  steerWheels: THREE.Object3D[];
}

/** Give every vertex of a geometry the same colour (for merged, vertex-coloured props). */
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(parts) as THREE.BufferGeometry;

/** A little conifer: brown trunk + green canopy, base at y=0. */
function makeTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 6);
  trunk.translate(0, 0.6, 0);
  const canopy = new THREE.ConeGeometry(1.1, 2.6, 8);
  canopy.translate(0, 2.5, 0);
  return merge([paint(trunk, 0x6b4a2f), paint(canopy, 0x2f5d3a)]);
}

/** A fire hydrant: stout body, domed cap, two side nozzles. */
function makeHydrantGeometry(): THREE.BufferGeometry {
  const red = 0xb5402f;
  const body = new THREE.CylinderGeometry(0.2, 0.24, 0.7, 8);
  body.translate(0, 0.35, 0);
  const dome = new THREE.SphereGeometry(0.2, 8, 6);
  dome.translate(0, 0.7, 0);
  const noz = new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6);
  noz.rotateZ(Math.PI / 2);
  const left = noz.clone();
  left.translate(-0.26, 0.42, 0);
  const right = noz.clone();
  right.translate(0.26, 0.42, 0);
  return merge([body, dome, left, right].map((g) => paint(g, red)));
}

/** A park bench: seat, backrest, two legs. */
function makeBenchGeometry(): THREE.BufferGeometry {
  const dark = 0x33363d;
  const seat = new THREE.BoxGeometry(1.5, 0.12, 0.5);
  seat.translate(0, 0.45, 0);
  const back = new THREE.BoxGeometry(1.5, 0.4, 0.1);
  back.translate(0, 0.66, -0.2);
  const legGeo = new THREE.BoxGeometry(0.12, 0.45, 0.45);
  const legL = legGeo.clone();
  legL.translate(-0.65, 0.22, 0);
  const legR = legGeo.clone();
  legR.translate(0.65, 0.22, 0);
  return merge([seat, back, legL, legR].map((g) => paint(g, dark)));
}

/**
 * Car shape profile used by the supercar mesh factory.
 * Physics collision is handled separately; these are purely visual proportions.
 */
export interface CarShape {
  id: string;
  length: number;
  width: number;
  bodyH: number;   // body slab height
  bodyY: number;   // body centre Y (ride height)
  cabinLen: number;
  cabinH: number;
  cabinX: number;  // cabin fore/aft offset
  wheelR: number;
}

export const CAR_SHAPES: CarShape[] = [
  // bodyY is set so rideH = bodyY - bodyH/2 >= wheelR (body bottom clears wheel top)
  { id: 'sedan', length: 4.2, width: 1.92, bodyH: 0.60, bodyY: 0.68, cabinLen: 2.0, cabinH: 0.62, cabinX: -0.18, wheelR: 0.36 },
  { id: 'compact', length: 3.6, width: 1.82, bodyH: 0.58, bodyY: 0.64, cabinLen: 1.55, cabinH: 0.66, cabinX: -0.08, wheelR: 0.33 },
  { id: 'sports', length: 4.5, width: 2.02, bodyH: 0.42, bodyY: 0.60, cabinLen: 1.62, cabinH: 0.42, cabinX: -0.44, wheelR: 0.36 },
  { id: 'van', length: 4.6, width: 2.10, bodyH: 1.05, bodyY: 0.96, cabinLen: 2.8, cabinH: 1.05, cabinX: 0.12, wheelR: 0.40 },
  { id: 'pickup', length: 4.6, width: 2.00, bodyH: 0.72, bodyY: 0.80, cabinLen: 1.45, cabinH: 0.88, cabinX: 0.58, wheelR: 0.42 },
];

// ── Supercar-grade mesh factory ────────────────────────────────────────────────
export function makeCar(color: number, shape: CarShape = CAR_SHAPES[0]): CarMesh {
  const group = new THREE.Group();
  const hl = shape.length / 2;
  const hw = shape.width / 2;
  const isSports = shape.id === 'sports';
  const isVan = shape.id === 'van';
  const isPickup = shape.id === 'pickup';

  // ── Shared materials ────────────────────────────────────────────────────────
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.75, roughness: 0.14,
    clearcoat: 1.0, clearcoatRoughness: 0.05, reflectivity: 1.0,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x7ab0cc, metalness: 0.0, roughness: 0.05,
    transmission: 0.78, transparent: true, opacity: 0.42, clearcoat: 1.0,
  });
  const blackMat = new THREE.MeshPhysicalMaterial({
    color: 0x080c10, metalness: 0.25, roughness: 0.50, clearcoat: 0.25,
  });
  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xd0dae8, metalness: 1.0, roughness: 0.03, clearcoat: 1.0, reflectivity: 1.0,
  });
  const calliperMat = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.45, metalness: 0.3 });

  // ── Extruded body shell (side profile) ─────────────────────────────────────
  const rideH = shape.bodyY - shape.bodyH / 2;
  const topH = shape.bodyY + shape.bodyH / 2;

  const bodyProfile = new THREE.Shape();
  bodyProfile.moveTo(-hl, rideH);
  bodyProfile.lineTo(hl * 0.88, rideH);
  bodyProfile.quadraticCurveTo(hl, rideH + shape.bodyH * 0.2, hl, rideH + shape.bodyH * 0.38); // nose curve
  bodyProfile.lineTo(hl * 0.58, topH);
  bodyProfile.lineTo(-hl * 0.50, topH);
  bodyProfile.quadraticCurveTo(-hl, topH - shape.bodyH * 0.08, -hl, topH - shape.bodyH * 0.20); // Kamm tail
  bodyProfile.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(bodyProfile, {
    depth: shape.width, bevelEnabled: true,
    bevelThickness: 0.07, bevelSize: 0.09, bevelSegments: 5,
  });
  // ExtrudeGeometry: profile in XY (X=length, Y=height), extrudes along +Z.
  // Car length is along X, width along Z — no rotation needed, just centre Z.
  bodyGeo.translate(0, 0, -hw);

  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // ── Cabin greenhouse ────────────────────────────────────────────────────────
  const cabinW = shape.width - 0.20;
  const cabinBot = topH;
  const cabinTop = cabinBot + shape.cabinH;
  const cx = shape.cabinX;
  const chl = shape.cabinLen / 2;

  const cabinProfile = new THREE.Shape();
  cabinProfile.moveTo(cx - chl, cabinBot);
  cabinProfile.lineTo(cx + chl, cabinBot);
  cabinProfile.lineTo(cx + chl - 0.58, cabinTop); // raked windscreen
  cabinProfile.lineTo(cx - chl + 0.12, cabinTop); // rear glass
  cabinProfile.closePath();

  const cabinGeo = new THREE.ExtrudeGeometry(cabinProfile, {
    depth: cabinW, bevelEnabled: true,
    bevelThickness: 0.045, bevelSize: 0.055, bevelSegments: 3,
  });
  // Same orientation as body: extrudes along +Z, centre it.
  cabinGeo.translate(0, 0, -cabinW / 2);

  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.castShadow = true;
  group.add(cabinMesh);

  // B-pillar trim
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, shape.cabinH * 0.82, 0.055), blackMat);
    pillar.position.set(cx - chl + 0.11, cabinBot + shape.cabinH * 0.42, side * (cabinW / 2 - 0.04));
    group.add(pillar);
  }

  // ── Side skirts ─────────────────────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(shape.length * 0.72, 0.07, 0.10), blackMat);
    skirt.position.set(0, rideH + 0.055, side * (hw + 0.04));
    group.add(skirt);
  }

  // ── Front splitter ──────────────────────────────────────────────────────────
  const splitter = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.05, shape.width * 0.84), blackMat);
  splitter.position.set(hl + 0.04, rideH + 0.03, 0);
  group.add(splitter);

  // ── Rear diffuser ───────────────────────────────────────────────────────────
  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.12, shape.width * 0.70), blackMat);
  diffuser.position.set(-hl - 0.06, rideH + 0.09, 0);
  diffuser.rotation.z = 0.26;
  group.add(diffuser);

  // ── Rear wing (sports + pickup) ─────────────────────────────────────────────
  if (isSports || isPickup) {
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.045, shape.width * 0.84), bodyMat);
    wing.position.set(-hl + 0.16, cabinTop + 0.13, 0);
    wing.rotation.z = -0.07;
    group.add(wing);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.045), chromeMat);
      leg.position.set(-hl + 0.16, cabinTop, side * (shape.width * 0.37));
      group.add(leg);
    }
  }

  // ── Hood vents (sports) ─────────────────────────────────────────────────────
  if (isSports) {
    for (const side of [-1, 1]) {
      const vent = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.04, 0.17), blackMat);
      vent.position.set(hl * 0.54, topH + 0.025, side * 0.29);
      vent.rotation.z = -0.04;
      group.add(vent);
    }
  }

  // ── 8-spoke supercar wheels ─────────────────────────────────────────────────
  const WR = shape.wheelR;
  const axle = shape.length * 0.318;
  // Track must clear the body bevel (bevelSize 0.09) + tire tube radius for clean separation
  const track = hw + 0.22;
  const steerWheels: THREE.Object3D[] = [];

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x080b0f, roughness: 0.92, metalness: 0.05 });
  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xc8d0de, metalness: 0.95, roughness: 0.06, clearcoat: 1.0 });
  const dkRimMat = new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.6, metalness: 0.4 });

  for (const wx of [axle, -axle]) {
    for (const wz of [track, -track]) {
      const wg = new THREE.Group();

      // Tyre — TorusGeometry default: ring in XY plane, axle = Z. No rotation needed.
      const tireGeo = new THREE.TorusGeometry(WR - WR * 0.33, WR * 0.36, 16, 32);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      wg.add(tire);

      // Rim dish
      const dish = new THREE.Mesh(
        new THREE.CylinderGeometry(WR * 0.66, WR * 0.66, WR * 0.18, 32), rimMat);
      dish.rotation.x = Math.PI / 2;
      wg.add(dish);

      // 8 spokes
      for (let s = 0; s < 8; s++) {
        const ang = (s / 8) * Math.PI * 2;
        const sLen = WR * 0.72;
        const spoke = new THREE.Mesh(
          new THREE.BoxGeometry(sLen, WR * 0.13, 0.06), rimMat);
        spoke.position.set(Math.cos(ang) * sLen / 2, Math.sin(ang) * sLen / 2, 0);
        spoke.rotation.z = ang;
        wg.add(spoke);
      }

      // Chrome rim lip ring — same orientation as tire (XY plane)
      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(WR * 0.66, 0.042, 8, 32), chromeMat);
      wg.add(lip);

      // Red brake calliper
      const calliper = new THREE.Mesh(
        new THREE.BoxGeometry(0.20, 0.13, 0.08), calliperMat);
      calliper.position.set(0, WR * 0.52, WR * 0.18 * (wz > 0 ? -1 : 1));
      wg.add(calliper);

      // Brake disc
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(WR * 0.60, WR * 0.60, 0.032, 24), dkRimMat);
      disc.rotation.x = Math.PI / 2;
      disc.position.z = WR * 0.055 * (wz > 0 ? -1 : 1);
      wg.add(disc);

      wg.position.set(wx, WR, wz);
      group.add(wg);
      if (wx > 0) steerWheels.push(wg);
    }
  }

  // ── LED headlights ──────────────────────────────────────────────────────────
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeef8ff, emissiveIntensity: 5.0, roughness: 0.04 });
  const drlMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffd080, emissiveIntensity: 4.0, roughness: 0.04 });
  const tailLedMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 6.0, roughness: 0.05 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x220008, emissive: 0xff0822, emissiveIntensity: 4.5, roughness: 0.10 });

  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.14, 0.32), ledMat);
    lens.position.set(hl + 0.01, rideH + shape.bodyH * 0.55, side * (hw - 0.22));
    group.add(lens);
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.44), drlMat);
    drl.position.set(hl - 0.02, rideH + shape.bodyH * 0.74, side * (hw - 0.22));
    group.add(drl);
  }

  // Full-width rear LED bar
  const tailStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.065, shape.width * 0.78), tailLedMat);
  tailStrip.position.set(-hl - 0.01, rideH + shape.bodyH * 0.62, 0);
  group.add(tailStrip);

  for (const side of [-1, 1]) {
    const tc = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 0.22), tailMat);
    tc.position.set(-hl - 0.01, rideH + shape.bodyH * 0.55, side * (hw - 0.18));
    group.add(tc);
  }

  // ── Exhaust pipes ────────────────────────────────────────────────────────────
  const nPipes = isSports ? 4 : isVan ? 1 : 2;
  const pSpacing = isSports ? 0.21 : 0.27;
  for (let i = 0; i < nPipes; i++) {
    const offset = (i - (nPipes - 1) / 2) * pSpacing;
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.17, 12), chromeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-hl - 0.07, rideH + shape.bodyH * 0.22, offset);
    group.add(pipe);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, 0.13, 10), blackMat);
    inner.rotation.z = Math.PI / 2;
    inner.position.set(-hl - 0.11, rideH + shape.bodyH * 0.22, offset);
    group.add(inner);
  }

  // ── Door handles ─────────────────────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.038, 0.028), chromeMat);
    handle.position.set(cx * 0.28, cabinBot - 0.11, side * (hw + 0.015));
    group.add(handle);
  }

  return { group, steerWheels };
}

export function makePed(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.7 }),
  );
  head.position.y = 1.45;
  head.castShadow = true;
  group.add(head);
  return group;
}
