import * as THREE from 'three';
import { generateCity, DEFAULT_CITY, type City } from './world/City';
import { StreamedWorld } from './world/StreamedWorld';
import { SceneEnv } from './render/Scene';
import { CityAssets, makePed, makeTuronSign } from './render/Assets';
import { Player } from './entities/Player';
import { FollowCamera, CAR_CAM, FOOT_CAM } from './systems/FollowCamera';
import { Vehicles } from './systems/Vehicles';
import { Pedestrians } from './systems/Pedestrians';
import { Debris } from './systems/Debris';
import { World } from './ecs/World';
import { HUD, type Mode } from './ui/HUD';
import { showSplash } from './ui/Splash';
import { showPlatformSelect, type Platform } from './ui/PlatformSelect';
import { Menu } from './ui/Menu';
import { Controls } from './core/Controls';
import { GameLoop } from './core/GameLoop';
import { loadOptions, saveOptions, qualityPixelRatio, type GameOptions } from './core/options';
import { lerp, angleLerp, starsFromHeat, daylightFactor } from './core/math';
import { Radio } from './audio/Radio';
import { Sfx } from './audio/Sfx';
import { toMph, type VehicleInput } from './vehicles/VehicleModel';
import { DeliverySystem } from './systems/Delivery';
import { DeliveryAssets } from './render/DeliveryAssets';
import { DeliveryHUD } from './ui/DeliveryHUD';
import { createRng } from './core/rng';

/** Touch UI + lower quality on coarse-pointer devices; `?touch=1|0` forces it. */
function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

const FOOT_RADIUS = 0.4;
const ENTER_DISTANCE = 6; // generous so curbside parked cars are easy to get into
const ENGINE_HEAR = 28; // on foot, how far a parked car's idle is audible
const STEP_DISTANCE = 1.7; // metres of travel between footstep sounds
let footAccum = 0;

let dayLength = 480; // seconds for a full day/night cycle (overridden by options)
let timeOfDay = 0; // [0,1), 0 = midnight (the original night look)

const container = document.getElementById('app')!;
const touch = isTouchDevice();
const options = loadOptions();
dayLength = options.dayLength;

// New Game picks a seed and reloads with ?seed=; the world is built from it so
// the same seed always regenerates the same city (determinism).
const urlParams = new URLSearchParams(location.search);
const seedParam = Number(urlParams.get('seed'));
const worldSeed = Number.isFinite(seedParam) && urlParams.get('seed') !== null ? seedParam : DEFAULT_CITY.seed;
// The menu has no mode selector — modes (e.g. delivery/racing) are triggered in-game from
// free-roam activities, not chosen at boot. ?mode= still sets the boot mode for testing.
const gameMode = urlParams.get('mode') ?? 'explore';
// `?stream=1` runs the unbounded streamed world (R007); default is the finite city.
const streaming = urlParams.get('stream') === '1';
const config = { ...DEFAULT_CITY, seed: worldSeed };
const assets = new CityAssets(config.seed);

// In stream mode the world is built around the player on demand: each loaded
// chunk becomes a Group of building/prop/streetlight meshes, added when the
// chunk loads and removed when it unloads. Collision + lights read the live
// StreamedWorld via its City facade.
let streamedWorld: StreamedWorld | null = null;
let city: City;
if (streaming) {
  const chunkGroups = new Map<string, THREE.Group>();
  streamedWorld = new StreamedWorld(config, {
    add: (cx, cz, data) => {
      const g = new THREE.Group();
      data.buildings.forEach((b, i) => g.add(assets.makeBuilding(b, i)));
      if (data.props.length) g.add(assets.makeProps(data.props));
      data.streetlights.forEach((s) => g.add(assets.makeStreetlight(s)));
      chunkGroups.set(`${cx}:${cz}`, g);
      env.scene.add(g);
    },
    remove: (cx, cz) => {
      const k = `${cx}:${cz}`;
      const g = chunkGroups.get(k);
      // TODO(R007 follow-up): pool/dispose chunk geometry. For now we only detach
      // (materials are shared via the asset cache; geometry GC's with the Group).
      if (g) {
        env.scene.remove(g);
        chunkGroups.delete(k);
      }
    },
  });
  city = streamedWorld.asCity();
} else {
  city = generateCity(config);
}

const env = new SceneEnv(container, city, {
  ...(touch ? { maxPixelRatio: 1.5, shadowMapSize: 1024 } : {}),
  streaming,
});

// TURON sign building position — set below when the logo is placed, used by delivery system.
let turonHQPoint: { x: number; z: number } = city.center;

if (streamedWorld) {
  // env.scene now exists; load the initial ring around spawn (fires the hooks).
  streamedWorld.update(city.center.x, city.center.z);
} else {
  city.buildings.forEach((b, i) => env.scene.add(assets.makeBuilding(b, i)));
  city.streetlights.forEach((s) => env.scene.add(assets.makeStreetlight(s)));
  env.scene.add(assets.makeProps(city.props));

  // ── TURON logo on the building nearest to city centre ─────────────────────
  const cx = city.center.x, cz = city.center.z;
  const nearest = city.buildings.reduce((best, b) =>
    Math.hypot(b.cx - cx, b.cz - cz) < Math.hypot(best.cx - cx, best.cz - cz) ? b : best
  );
  // Pickup point placed at the left-front corner of the building (+Z face, left side)
  // so it's on the road/pavement and easy to reach without entering the building.
  const pickupOffsetZ = nearest.depth / 2 + 3;   // 3 m in front of the +Z wall
  const pickupOffsetX = -(nearest.width / 2 - 1); // left side (negative X = left when facing +Z)
  turonHQPoint = {
    x: nearest.cx + pickupOffsetX,
    z: nearest.cz + pickupOffsetZ,
  };
  const turonSign = makeTuronSign(nearest.cx, nearest.cz, nearest.width, nearest.depth, nearest.height);
  env.scene.add(turonSign);
}

const avatar = makePed(0x2266dd);
env.scene.add(avatar);

// Warm glow that rides the active actor so the night street reads up close.
const lamp = new THREE.PointLight(0xffd9a8, 28, 40, 2);
env.scene.add(lamp);

// A handful of real point lights hop to the streetlights nearest the player,
// so lamps actually cast pools of light without paying for 81 live lights.
const STREETLIGHT_POOL = 6;
const streetlightPool = Array.from({ length: STREETLIGHT_POOL }, () => {
  const l = new THREE.PointLight(0xffcf9a, 20, 28, 1.6);
  env.scene.add(l);
  return l;
});

// Twin headlight spots on the car you're driving; dark while on foot.
const headlights = [0, 1].map(() => {
  const light = new THREE.SpotLight(0xfff2d0, 0, 42, 0.62, 0.5, 1.1);
  const target = new THREE.Object3D();
  light.target = target;
  env.scene.add(light, target);
  return { light, target };
});

// One shared ECS World holds all dynamic entities (cars, pedestrians, debris),
// and one shared Debris pool serves both car wrecks and pedestrian gibs.
const world = new World();
const debris = new Debris(env.scene, world);
// Stream mode (MVP): no ambient traffic/peds yet — they spawn player-relative in
// a follow-up (Phase C). The player car still spawns at the origin intersection.
const vehicles = new Vehicles(env.scene, city, world, debris, streaming ? 0 : touch ? 24 : 40);
const peds = new Pedestrians(env.scene, city, world, debris, streaming ? 0 : touch ? 28 : 60);
const hud = new HUD(container, city, touch, streaming);

// ── Delivery system ──────────────────────────────────────────────────────────
const deliveryRng = createRng(config.seed ^ 0xdeadbeef);
const delivery = new DeliverySystem(deliveryRng, city.roadCenters, turonHQPoint);
const deliveryAssets = new DeliveryAssets(env.scene);
const deliveryHUD = new DeliveryHUD(container);

// touchRoot is created lazily when mobile platform is selected.
let touchRoot: HTMLElement | undefined;
const controls = new Controls(touchRoot);

// Reference to the active TouchControls instance (set in activateMobile).
let tcRef: {
  setMode: (m: 'foot' | 'driving') => void;
  consumeLookDelta: () => { dx: number; dy: number };
} | null = null;
const follow = new FollowCamera(env.camera);
const player = new Player();

// Platform selection state: 'pc' enables pointer-lock mouse look; 'mobile' uses touch.
let pcMode = false;

// The radio streams one track at a time from a CDN-hosted manifest, so the
// (large) music library is never bundled. It loads asynchronously and stays
// silent until the first user gesture (browser autoplay policy).
let radio: Radio | null = null;
let radioPrimed = false;
let radioCarIndex: number | null = null; // which car's radio is currently loaded
const sfx = new Sfx();
let audioGestured = false;
const markGesture = (): void => {
  audioGestured = true;
  sfx.start(); // create/resume the audio context within the gesture
  primeRadio(); // iOS only lets the <audio> element start from inside a gesture
};
addEventListener('keydown', markGesture);
addEventListener('pointerdown', markGesture);
addEventListener('touchend', markGesture); // some iOS taps surface here, not pointerdown
// A backgrounded tab suspends the context; resume whenever we're focused again.
// This is also why audio "came back after alt-tab" — make it reliable, not luck.
addEventListener('focus', () => sfx.start());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sfx.start();
});

/**
 * Kick the radio off. MUST be reachable from a user-gesture call stack: iOS
 * Safari refuses HTMLAudioElement.play() outside one, so priming from the game
 * loop left the radio silent until the player tapped the radio button. Called
 * from markGesture and retried each gesture until the manifest has loaded.
 */
function primeRadio(): void {
  if (!radio || radioPrimed || mode !== 'driving') return;
  const i = vehicles.playerIndex ?? 0;
  radio.enterCar(i);
  radioCarIndex = i;
  radioPrimed = true;
}

interface RadioManifest {
  baseUrl: string;
  stations: { name: string; tracks: { title: string; file: string }[] }[];
}
fetch('radio.json')
  .then((r) => (r.ok ? (r.json() as Promise<RadioManifest>) : null))
  .then((data) => {
    if (!data?.stations?.length) return;
    radio = new Radio(
      data.stations.map((s) => ({
        name: s.name,
        tracks: s.tracks.map((t) => ({ title: t.title, url: data.baseUrl + t.file })),
      })),
    );
    if (audioGestured) primeRadio(); // gesture already happened, manifest just landed
  })
  .catch(() => { });

let mode: Mode = 'driving';
player.x = city.center.x;
player.z = city.center.z;

const MAX_HEALTH = 100;
const HIT_SPEED = 3; // m/s a car must exceed to injure a pedestrian
const DAMAGE_PER_SPEED = 5; // health lost per m/s of impact
const KNOCKBACK = 1.6;
const WASTED_TIME = 3; // seconds the WASTED screen holds before respawn

let health = MAX_HEALTH;
let wasted = false;
let wastedTimer = 0;
let pedContact = false; // were we in contact with a car last frame (edge-trigger)

// Wanted system: "heat" rises with crimes and decays after a grace period;
// it maps to 0–5 stars, and each star is one chasing police car.
const CRIME_HEAT = 16; // heat added per pedestrian you personally run over
const HEAT_GRACE = 4; // seconds OUT OF POLICE SIGHT before heat starts to cool
const HEAT_DECAY = 11; // heat lost per second once cooling
let heat = 0;
let stars = 0;
let sinceUnseen = 0; // seconds since a cop last had line of sight (the "get away" timer)
let wantedCooling = false; // true while stars are cooling off (HUD flashes them)
let prevRunOver = 0;

// Busted: a chasing cop pins you slow for long enough → arrested, game resets.
const BUST_RADIUS = 7; // a cop this close...
const BUST_SPEED = 5; // ...while you're slower than this (m/s)...
const BUST_FILL_TIME = 1.8; // ...for this long → BUSTED
const BUSTED_TIME = 3; // seconds the BUSTED screen holds before respawn
let busted = false;
let bustedTimer = 0;
let bustFill = 0;

const clampToCity = (p: { x: number; z: number }): void => {
  const b = city.half - 2;
  p.x = Math.max(-b, Math.min(b, p.x));
  p.z = Math.max(-b, Math.min(b, p.z));
};

function toggleVehicle(): void {
  if (mode === 'driving') {
    const pose = vehicles.playerPose()!;
    // Car forward in world XZ = (cos h, -sin h).
    // Left perpendicular (CCW 90°) = (sin h, cos h).
    // Place the player 4 m to the left so they clear the largest car radius (2.5 m).
    player.x = pose.x + Math.sin(pose.heading) * 4.0;
    player.z = pose.z + Math.cos(pose.heading) * 4.0;
    player.heading = pose.heading;
    vehicles.exit();
    follow.resetYaw(); // clear mouse-look offset so foot camera starts clean
    mode = 'foot';
    tcRef?.setMode('foot');
    sfx.exitCar();
  } else {
    const i = vehicles.nearest(player.x, player.z, ENTER_DISTANCE);
    if (i >= 0) {
      vehicles.enter(i);
      mode = 'driving';
      tcRef?.setMode('driving');
      radio?.enterCar(i);
      radioCarIndex = i;
      radioPrimed = true;
      sfx.enterCar();
    }
  }
}

function drivingInput(): VehicleInput {
  const m = controls.move();
  return {
    throttle: m.y, // forward
    steer: -m.x, // +1 = left, so right stick (+x) steers right
    handbrake: controls.handbrake(),
  };
}

function updateFoot(dt: number): void {
  const yaw = follow.yaw;
  const m = controls.move(true);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dirX = cos * m.y + sin * m.x;
  const dirZ = -sin * m.y + cos * m.x;

  player.update(dirX, dirZ, controls.sprint(true), dt);

  const fixed = city.grid.resolve(player.x, player.z, FOOT_RADIUS);
  player.x = fixed.x;
  player.z = fixed.z;
  // Don't walk through cars (parked or otherwise).
  const offCar = vehicles.resolveActor(player.x, player.z, FOOT_RADIUS);
  player.x = offCar.x;
  player.z = offCar.z;
  clampToCity(player);
}

function enterWasted(): void {
  wasted = true;
  wastedTimer = WASTED_TIME;
  health = 0;
}

function respawn(): void {
  wasted = false;
  busted = false;
  bustFill = 0;
  health = MAX_HEALTH;
  pedContact = false;
  heat = 0; // getting WASTED/BUSTED clears your wanted level
  sinceUnseen = 0;
  wantedCooling = false;
  mode = 'foot';
  tcRef?.setMode('foot');
  player.x = city.center.x;
  player.z = city.center.z + 6;
  player.heading = 0;
}

function enterBusted(): void {
  busted = true;
  bustedTimer = BUSTED_TIME;
  bustFill = 0;
}

/** A chasing cop pinning you slow fills the bust meter; sustained → BUSTED. */
function updateBusted(dt: number): void {
  const t = chaseTarget();
  const speed = mode === 'driving' ? Math.abs(vehicles.playerForwardSpeed()) : player.speed;
  const pinned = vehicles.nearestPoliceDistance(t.x, t.z) < BUST_RADIUS && speed < BUST_SPEED;
  bustFill = pinned ? bustFill + dt : Math.max(0, bustFill - 2 * dt); // fills slow, clears fast
  if (bustFill >= BUST_FILL_TIME) enterBusted();
}

/** Active player pose + velocity the police intercept (the car, or the avatar on foot). */
function chaseTarget(): { x: number; z: number; vx: number; vz: number } {
  const pose = vehicles.playerPose();
  if (mode === 'driving' && pose) {
    const v = vehicles.playerVelocity();
    return { x: pose.x, z: pose.z, vx: v.vx, vz: v.vz };
  }
  return {
    x: player.x,
    z: player.z,
    vx: Math.cos(player.heading) * player.speed,
    vz: -Math.sin(player.heading) * player.speed,
  };
}

/**
 * Crimes raise heat → wanted stars → police. You "get away" GTA-style: once no
 * cop has line of sight to you (broke LOS behind a building, or outran their
 * sight range), the heat cools after a short grace and the stars drop.
 */
function updateWanted(dt: number): void {
  const over = peds.runOverCount;
  const t = chaseTarget();
  const seen = stars > 0 && vehicles.anyPoliceSeesTarget(t.x, t.z, city.colliders);
  if (over > prevRunOver) {
    sfx.gib();
    heat = Math.min(100, heat + (over - prevRunOver) * CRIME_HEAT);
    sinceUnseen = 0;
  } else if (seen) {
    sinceUnseen = 0; // they have eyes on you — wanted holds
  } else {
    sinceUnseen += dt;
    if (sinceUnseen > HEAT_GRACE) heat = Math.max(0, heat - HEAT_DECAY * dt);
  }
  prevRunOver = over;
  wantedCooling = stars > 0 && !seen && sinceUnseen > HEAT_GRACE;
  stars = starsFromHeat(heat);
  vehicles.setWanted(stars, t, city);
}

/** While on foot, take damage from cars that hit us; trigger WASTED at zero. */
function checkPedestrianDamage(): void {
  // Exclude police: a cop catching you on foot triggers BUSTED (arrest), it
  // doesn't run you over. Ordinary traffic can still flatten you.
  const hit = vehicles.pedestrianImpact(player.x, player.z, false, false);
  const contact = !!hit && hit.speed > HIT_SPEED;
  if (contact && !pedContact) {
    health -= hit!.speed * DAMAGE_PER_SPEED;
    player.x += hit!.nx * KNOCKBACK;
    player.z += hit!.nz * KNOCKBACK;
    if (health <= 0) enterWasted();
  }
  pedContact = contact;
}

// Any car (including the one you're driving) moving fast enough flattens peds.
const runOverQuery = (x: number, z: number) => vehicles.pedestrianImpact(x, z, true);
// Pedestrians (like the player on foot) get pushed out of cars they'd clip.
const resolveCars = (x: number, z: number, r: number) => vehicles.resolveActor(x, z, r);

/** Sound the car wrecks from this step; a wrecked player car means WASTED. */
function flushCarWrecks(): void {
  const n = vehicles.consumeExplosions();
  for (let k = 0; k < Math.min(n, 3); k++) sfx.explosion();
  if (vehicles.consumePlayerWreck() && !wasted) enterWasted();
}

function update(dt: number): void {
  player.savePrev();
  timeOfDay = (timeOfDay + dt / dayLength) % 1;

  // Stream the world around the active position (car when driving, else avatar).
  if (streamedWorld) {
    const p = vehicles.playerPose();
    const sx = mode === 'driving' && p ? p.x : player.x;
    const sz = mode === 'driving' && p ? p.z : player.z;
    streamedWorld.update(sx, sz);
  }

  if (wasted || busted) {
    if (wasted) wastedTimer -= dt;
    else bustedTimer -= dt;
    vehicles.update(city, dt, null, null);
    flushCarWrecks();
    peds.update(city, dt, runOverQuery, null, resolveCars);
    debris.update(dt); // shared pool, advanced once per frame
    if ((wasted && wastedTimer <= 0) || (busted && bustedTimer <= 0)) respawn();
    controls.endFrame();
    return;
  }

  // Keep mobile delivery buttons in sync with current phase (no-op on PC)
  controls.setDeliveryPhase(delivery.state.phase);

  const enterPressed = controls.enterExitPressed();
  const deliveryBtnPressed = controls.consumeDeliveryAction();

  if (enterPressed || deliveryBtnPressed) {
    // ── Delivery pickup / dropoff check first, then normal vehicle toggle ──
    const px = mode === 'driving' ? (vehicles.playerPose()?.x ?? player.x) : player.x;
    const pz = mode === 'driving' ? (vehicles.playerPose()?.z ?? player.z) : player.z;
    const { phase } = delivery.state;

    if (phase === 'pickup' && !delivery.state.failed) {
      if (delivery.tryPickup(px, pz, city.roadCenters)) {
        deliveryHUD.showPickedUp();
        sfx.enterCar(); // reuse blip sound for pickup feedback
      } else if (!deliveryBtnPressed) {
        // Only toggle vehicle if triggered by keyboard/gamepad, not the delivery btn
        toggleVehicle();
      }
    } else if (phase === 'carrying') {
      const earned = delivery.tryDropoff(px, pz, city.roadCenters);
      if (earned > 0) {
        deliveryHUD.showDelivered(earned);
        // Spawn coin at current player position
        const carPose = vehicles.playerPose();
        const cx = carPose ? carPose.x : player.x;
        const cz = carPose ? carPose.z : player.z;
        deliveryAssets.spawnCoin(cx, 0, cz);
        sfx.exitCar(); // reuse blip for dropoff
      } else if (!deliveryBtnPressed) {
        toggleVehicle();
      }
    } else {
      // 'idle' or fallback: just toggle vehicle (delivery not yet active)
      toggleVehicle();
    }
  }

  updateWanted(dt);
  const chase = stars > 0 ? chaseTarget() : null;

  if (mode === 'driving') {
    if (controls.resetPressed()) vehicles.resetPlayer(city);
    vehicles.update(city, dt, drivingInput(), null, chase);
    flushCarWrecks();
  } else {
    vehicles.update(city, dt, null, { x: player.x, z: player.z }, chase);
    flushCarWrecks();
    updateFoot(dt);
    checkPedestrianDamage();

    // Punch: gib the pedestrian in front of you (scores + raises heat, like a
    // run-over). Forward is the player's heading: (cos h, -sin h).
    if (controls.punchPressed()) {
      peds.punch(player.x, player.z, Math.cos(player.heading), -Math.sin(player.heading));
    }

    // Footsteps cadence with travel distance (faster when sprinting).
    if (player.speed > 0.1) {
      footAccum += player.speed * dt;
      if (footAccum >= STEP_DISTANCE) {
        footAccum = 0;
        sfx.footstep();
      }
    } else {
      footAccum = STEP_DISTANCE; // first move triggers a step promptly
    }
  }

  if (radio) {
    const step = controls.radioStep();
    if (step !== 0) radio.step(step);
  }

  updateBusted(dt);

  // Delivery timer tick
  if (delivery.update(dt)) {
    deliveryHUD.showFailed();
  }

  // Pedestrians fear the CAR only (not the player on foot): proximity, or a fast
  // car on a vector to hit them. Threat carries velocity for the vector trigger.
  peds.update(city, dt, runOverQuery, mode === 'driving' ? chaseTarget() : null, resolveCars);
  debris.update(dt); // shared pool, advanced once per frame
  controls.endFrame();
}

function updateStreetlightPool(ax: number, az: number): void {
  const sl = city.streetlights;
  if (sl.length === 0) return;
  // Nearest-first each call (the streamed set changes as chunks load/unload, so
  // we can't keep a persistent index array).
  const d2 = (i: number): number => (sl[i].x - ax) ** 2 + (sl[i].z - az) ** 2;
  const order = sl.map((_, i) => i).sort((a, b) => d2(a) - d2(b));
  for (let i = 0; i < streetlightPool.length; i++) {
    const s = sl[order[Math.min(i, order.length - 1)]];
    streetlightPool[i].position.set(s.x, 4.8, s.z);
  }
}

function updateHeadlights(pose: { x: number; z: number; heading: number } | null): void {
  if (!pose) {
    for (const h of headlights) h.light.intensity = 0;
    return;
  }
  const fx = Math.cos(pose.heading);
  const fz = -Math.sin(pose.heading);
  const rx = Math.sin(pose.heading);
  const rz = Math.cos(pose.heading);
  for (let i = 0; i < headlights.length; i++) {
    const side = i === 0 ? -0.6 : 0.6;
    const h = headlights[i];
    h.light.position.set(pose.x + fx * 2 + rx * side, 0.7, pose.z + fz * 2 + rz * side);
    h.target.position.set(pose.x + fx * 16, 0.1, pose.z + fz * 16);
    h.light.intensity = 50;
  }
}

function render(alpha: number, frameDt: number): void {
  // PC mouse look: consume accumulated mouse deltas and pass to camera.
  if (pcMode) {
    const md = controls.consumeMouseDelta();
    follow.applyMouseDelta(md.dx, md.dy);
  }
  // Mobile look-drag: swipe anywhere on the empty screen to orbit the camera.
  if (tcRef) {
    const ld = tcRef.consumeLookDelta();
    if (ld.dx !== 0 || ld.dy !== 0) follow.applyMouseDelta(ld.dx, ld.dy);
  }

  // Interpolate every moving thing between its previous and current physics
  // step so motion stays smooth regardless of how steps line up with frames.
  vehicles.render(alpha);
  peds.render(alpha);
  debris.render(alpha); // shared pool, drawn once per frame

  const ax = lerp(player.px, player.x, alpha);
  const az = lerp(player.pz, player.z, alpha);
  const ah = angleLerp(player.ph, player.heading, alpha);
  avatar.position.set(ax, 0, az);
  avatar.rotation.y = ah;
  avatar.visible = mode === 'foot';

  const carPose = vehicles.playerPoseInterp(alpha);
  const active =
    mode === 'driving' && carPose ? carPose : { x: ax, z: az, heading: ah, speed: player.speed };
  env.follow(active.x, active.z);
  lamp.position.set(active.x, 3.5, active.z);
  updateStreetlightPool(active.x, active.z);
  updateHeadlights(mode === 'driving' && carPose ? carPose : null);

  let camVx: number;
  let camVz: number;
  if (mode === 'driving' && carPose) {
    const v = vehicles.playerVelocity();
    camVx = v.vx;
    camVz = v.vz;
  } else {
    camVx = Math.cos(ah) * player.speed;
    camVz = -Math.sin(ah) * player.speed;
  }
  follow.update(active.x, active.z, active.heading, mode === 'driving' ? CAR_CAM : FOOT_CAM, frameDt, camVx, camVz, mode === 'foot');

  const speedMph = mode === 'driving' ? toMph(vehicles.playerForwardSpeed()) : toMph(player.speed);
  // The health bar reads car integrity while driving, avatar health on foot.
  const shownHealth = mode === 'driving' ? vehicles.playerCarHealth() : health;
  const { phase: dPhase, restaurant: dRestaurant, customer: dCustomer } = delivery.state;
  hud.update(speedMph, mode, active, vehicles.positions(), shownHealth, wasted, {
    restaurant: dPhase === 'pickup' ? dRestaurant : undefined,
    customer: dPhase === 'carrying' ? dCustomer : null,
  });
  hud.setRunOverCount(peds.runOverCount);
  hud.setCarName(mode === 'driving' ? vehicles.playerCarName() : null);
  // Radio readout is a dashboard thing — only show it while driving (the audio
  // itself still fades out with distance as you walk away).
  hud.setRadio(mode === 'driving' ? (radio ? radio.label() : '📻 O\'CHIQ') : '');
  hud.setWanted(stars, wantedCooling);
  hud.setClock(timeOfDay);
  hud.setBusted(busted);

  const driving = mode === 'driving';
  if (driving) {
    sfx.setEngine(Math.abs(vehicles.playerForwardSpeed()) / vehicles.playerMaxSpeed(), 1);
    sfx.setScreech(Math.max(0, (vehicles.playerLateralSpeed() - 2) / 8));
    if (radio) radio.updateProximity(true, 0);
  } else {
    sfx.setScreech(0);
    // The car you left keeps idling and playing; both fade as you walk off.
    const dist =
      radioCarIndex !== null
        ? Math.hypot(player.x - vehicles.carPosition(radioCarIndex).x, player.z - vehicles.carPosition(radioCarIndex).z)
        : Infinity;
    const near = Math.max(0, 1 - dist / ENGINE_HEAR);
    sfx.setEngine(0, near * 0.6); // idle, quieter than under throttle
    if (radio) radio.updateProximity(false, dist);
  }

  env.setTimeOfDay(timeOfDay);
  assets.setDaylight(daylightFactor(timeOfDay)); // window/lamp lights off + glassy by day

  // ── Delivery render ────────────────────────────────────────────────────────
  const { phase, restaurant, customer } = delivery.state;
  deliveryAssets.setRestaurant(restaurant.x, restaurant.z, phase === 'pickup');
  deliveryAssets.setCustomer(
    customer?.x ?? 0,
    customer?.z ?? 0,
    phase === 'carrying' && customer !== null,
  );
  // Cargo box floats above the car roof when carrying
  const carrying = phase === 'carrying';
  if (carrying && carPose) {
    deliveryAssets.setCargoVisible(true, carPose.x, 1.6, carPose.z);
  } else {
    deliveryAssets.setCargoVisible(false);
  }
  deliveryAssets.update(frameDt);
  const dpx = carPose ? carPose.x : ax;
  const dpz = carPose ? carPose.z : az;
  const dist = delivery.distanceToTarget(dpx, dpz);
  deliveryHUD.update(delivery.state, dist, frameDt);

  env.render();

  // Perf telemetry (watched in the smoke run; see performance-vigilance memory).
  if (frameDt > 0) perf.frameMs = perf.frameMs === 0 ? frameDt * 1000 : perf.frameMs * 0.9 + frameDt * 1000 * 0.1;
  const info = env.renderer.info;
  perf.drawCalls = info.render.calls;
  perf.triangles = info.render.triangles;
  perf.geometries = info.memory.geometries;
  perf.textures = info.memory.textures;
}

interface Perf {
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}
const perf: Perf = { frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

declare global {
  interface Window {
    __game?: {
      readonly mode: Mode;
      readonly health: number;
      readonly carHealth: number;
      readonly wasted: boolean;
      readonly busted: boolean;
      readonly runOverCount: number;
      readonly radioLabel: string;
      readonly wanted: number;
      readonly wantedCooling: boolean;
      readonly police: number;
      readonly timeOfDay: number;
      readonly paused: boolean;
      readonly radioReady: boolean;
      readonly carModel: string | null;
      readonly perf: Perf;
      vehicles: Vehicles;
      player: Player;
      peds: Pedestrians;
      city: typeof city;
    };
  }
}
window.__game = {
  get mode() {
    return mode;
  },
  get health() {
    return health;
  },
  get carHealth() {
    return vehicles.playerCarHealth();
  },
  get wasted() {
    return wasted;
  },
  get busted() {
    return busted;
  },
  get runOverCount() {
    return peds.runOverCount;
  },
  get radioLabel() {
    return radio ? radio.label() : '📻 O\'CHIQ';
  },
  get wanted() {
    return stars;
  },
  get wantedCooling() {
    return wantedCooling;
  },
  get police() {
    return vehicles.activePoliceCount();
  },
  get timeOfDay() {
    return timeOfDay;
  },
  get paused() {
    return loop.isPaused();
  },
  get radioReady() {
    return radio !== null; // manifest fetched + tuner built
  },
  get carModel() {
    return vehicles.playerCarName();
  },
  get perf() {
    return perf;
  },
  vehicles,
  player,
  peds,
  city,
};

const loop = new GameLoop(update, render);

/** Push the current options everywhere they take live effect. */
function applyOptions(opts: GameOptions): void {
  sfx.setMasterVolume(opts.masterVolume);
  radio?.setMasterVolume(opts.masterVolume);
  env.renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityPixelRatio(opts.quality)));
  dayLength = opts.dayLength;
}
applyOptions(options);

const menu = new Menu(container, options, worldSeed, gameMode, {
  onResume: () => setPaused(false),
  onRestart: () => location.reload(),
  onPlay: () => {
    menu.close();
    loop.setPaused(false);
  },
  onNewGame: (seed) => {
    const p = new URLSearchParams(location.search);
    p.set('seed', String(seed));
    location.search = p.toString(); // reload → world rebuilt from the new seed
  },
  onModeChange: () => { }, // only 'explore' is playable yet (R033)
  onOptionsChange: (opts) => {
    applyOptions(opts);
    saveOptions(opts);
  },
});

function setPaused(p: boolean): void {
  if (p) {
    menu.openAs('pause');
    // Release pointer lock when pausing so the cursor is usable in the menu.
    if (pcMode) controls.exitPointerLock();
  } else {
    menu.close();
  }
  loop.setPaused(p);
}

// Esc: if pointer locked → just exit lock (first press); second press opens pause menu.
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (document.getElementById('splash')) return;
  if (pcMode && controls.isPointerLocked()) {
    controls.exitPointerLock(); // first Esc just unlocks the mouse
    setPaused(true);
  } else {
    setPaused(!menu.isOpen());
  }
});

// Gamepad Start toggles pause. Polled on its own rAF (not the sim loop, which is
// frozen while paused) so the pad can also close the menu.
let padStartDown = false;
const pollPause = (): void => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let start = false;
  for (const p of pads) if (p && p.buttons[9]?.pressed) start = true;
  if (start && !padStartDown && !document.getElementById('splash')) setPaused(!menu.isOpen());
  padStartDown = start;
  requestAnimationFrame(pollPause);
};
requestAnimationFrame(pollPause);

loop.start();
// Splash → on dismiss, unlock audio and raise the title menu (paused) until the
// player hits Play. The e2e harness's __skipSplash bypasses dismissal, so it
// never raises the menu and drops straight into the running game.
/** Activate PC mode: pointer lock + mouse look camera. */
function activatePC(): void {
  pcMode = true;
  follow.setMouseLook(true);
  controls.initPointerLock(env.renderer.domElement, (locked) => {
    if (!locked && !loop.isPaused() && !menu.isOpen()) setPaused(true);
  });
}

/** Activate Mobile mode: create touch overlay. */
function activateMobile(): void {
  // Force compact mobile HUD layout regardless of isTouchDevice() result at boot.
  hud.applyTouchLayout();
  touchRoot = document.createElement('div');
  container.appendChild(touchRoot);
  // Dynamically import and attach TouchControls to the existing controls instance
  import('./ui/TouchControls').then(({ TouchControls }) => {
    const tc = new TouchControls(touchRoot!);
    // Store reference so toggleVehicle / respawn can switch UI panels.
    tcRef = tc;
    // Sync touch UI to the current game mode (starts in 'driving' so wheel shows first).
    tc.setMode(mode as 'foot' | 'driving');
    // Enable camera orbit so look-drag deltas are applied (same system as PC mouse-look).
    follow.setMouseLook(true);

    // Override controls.move(): in driving mode use steering wheel + gas pedal;
    // in foot mode use the analog joystick as before.
    const origMove = controls.move.bind(controls);
    controls.move = (onFoot = false) => {
      const kb = origMove(onFoot);
      if (mode === 'driving') {
        // x → steer (-1 left … +1 right), y → throttle (gas = 1, brake = -1)
        const steer = tc.steer();
        const throttle = tc.gas ? 1 : (tc.handbrake ? -1 : 0);
        return {
          x: Math.max(-1, Math.min(1, kb.x + steer)),
          y: Math.max(-1, Math.min(1, kb.y + throttle)),
        };
      }
      // Foot mode: joystick
      const t = tc.stick();
      return {
        x: Math.max(-1, Math.min(1, kb.x + t.x)),
        y: Math.max(-1, Math.min(1, kb.y + t.y)),
      };
    };

    // handbrake in foot mode = brake button; in driving mode = brake pedal (handled via move.y above)
    const origHandbrake = controls.handbrake.bind(controls);
    controls.handbrake = () => origHandbrake() || tc.handbrake;
    controls.sprint = () => tc.sprint;
    const origEnter = controls.enterExitPressed.bind(controls);
    controls.enterExitPressed = () => origEnter() || tc.consumeEnter();
    const origReset = controls.resetPressed.bind(controls);
    controls.resetPressed = () => origReset() || tc.consumeReset();
    const origRadio = controls.radioStep.bind(controls);
    controls.radioStep = () => { const r = origRadio(); return r !== 0 ? r : tc.consumeRadio() ? 1 : 0; };
    const origPunch = controls.punchPressed.bind(controls);
    controls.punchPressed = () => origPunch() || tc.consumePunch();
    // Delivery button: wire setDeliveryPhase and consumeDeliveryAction to tc
    controls.setDeliveryPhase = (phase) => tc.setDeliveryPhase(phase);
    controls.consumeDeliveryAction = () => tc.consumeDeliveryAction();
    // Sync delivery phase immediately so button appears at game start
    tc.setDeliveryPhase(delivery.state.phase);
  });
}

/** Ekranni landscape (horizontal) rejimiga qulflash. Faqat user gesture ichida ishlaydi. */
function lockLandscape(): void {
  try {
    const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (orient?.lock) {
      orient.lock('landscape').catch(() => {
        // Brauzer ruxsat bermasa jimgina o'tkazib yuboramiz
      });
    }
  } catch {
    // Eski brauzerlar uchun xato e'tiborsiz qoldiriladi
  }
}

showSplash(container, () => {
  markGesture();
  lockLandscape(); // splash yopilganda darhol lock qilish
  showPlatformSelect(container, (platform: Platform) => {
    if (platform === 'pc') activatePC();
    else {
      activateMobile();
      lockLandscape(); // mobile tanlanganda yana bir bor ishonch uchun
    }
    menu.openAs('title');
    loop.setPaused(true);
  });
});
