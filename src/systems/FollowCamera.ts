import * as THREE from 'three';
import { damp } from '../core/math';
import { followDistance, lookLead, type FollowParams } from '../core/followCam';

export type { FollowParams };

export const CAR_CAM: FollowParams = { distance: 9, height: 4.2, lookHeight: 1.4, stiffness: 4, speedPull: 0.16, slideSwing: 0.3, maxSwing: 2 };
export const FOOT_CAM: FollowParams = { distance: 5, height: 3, lookHeight: 1.4, stiffness: 7 };

const PI2 = Math.PI * 2;
const PITCH_MIN = -0.25; // radians, look down limit
const PITCH_MAX = 0.6;   // radians, look up limit
const MOUSE_SENSITIVITY = 0.0022; // radians per pixel

/**
 * Smoothed chase camera with optional mouse-look override for PC mode.
 *
 * In auto mode (mobile): original spring-follow behaviour.
 * In mouse mode (PC): player can freely orbit the camera with the mouse
 *   while still following the target. Yaw offset is accumlated from
 *   mouseDelta() calls each frame and blended with the heading.
 */
export class FollowCamera {
  private readonly look = new THREE.Vector3();

  // Mouse-look state
  private _yawOffset = 0;   // extra rotation added on top of heading
  private _pitch = 0.12;    // vertical tilt (radians)
  private _mouseLook = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) { }

  /** Enable/disable free-mouse camera. */
  setMouseLook(enabled: boolean): void {
    this._mouseLook = enabled;
    if (!enabled) {
      this._yawOffset = 0;
      this._pitch = 0.12;
    }
  }

  /**
   * Accumulate mouse deltas from pointer-lock events (call every frame before update).
   * dx = pixels moved right, dy = pixels moved down.
   */
  applyMouseDelta(dx: number, dy: number): void {
    if (!this._mouseLook) return;
    this._yawOffset -= dx * MOUSE_SENSITIVITY;
    this._pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this._pitch + dy * MOUSE_SENSITIVITY));
    // Keep yaw in [-π, π]
    if (this._yawOffset > Math.PI) this._yawOffset -= PI2;
    if (this._yawOffset < -Math.PI) this._yawOffset += PI2;
  }

  /**
   * Heading convention: forward = (cos h, 0, -sin h).
   * Mouse look offsets are applied on top so the camera orbits the target.
   * `ignoreHeading`: when true (foot mode), the camera yaw comes purely from
   * _yawOffset and is NOT coupled to the avatar's heading — eliminates the
   * feedback loop where heading→camera→yaw→movement→heading.
   */
  update(x: number, z: number, heading: number, p: FollowParams, dt: number, vx = 0, vz = 0, ignoreHeading = false): void {
    // In mouse-look foot mode: camera yaw = pure offset (no heading coupling).
    // In driving mode or auto mode: yaw = heading + offset as before.
    const baseHeading = (this._mouseLook && ignoreHeading) ? 0 : heading;
    const effectiveHeading = this._mouseLook ? baseHeading + this._yawOffset : heading;
    const fx = Math.cos(effectiveHeading);
    const fz = -Math.sin(effectiveHeading);
    const speed = Math.hypot(vx, vz);

    const dist = followDistance(p, speed);

    // In mouse-look mode height is driven by pitch; otherwise use profile height.
    const pitchHeight = this._mouseLook
      ? p.height + Math.sin(this._pitch) * dist * 0.9
      : p.height;
    const pitchBack = this._mouseLook
      ? dist * Math.cos(this._pitch)
      : dist;

    const desiredX = x - fx * pitchBack;
    const desiredZ = z - fz * pitchBack;

    this.camera.position.x = damp(this.camera.position.x, desiredX, p.stiffness, dt);
    this.camera.position.y = damp(this.camera.position.y, pitchHeight, p.stiffness, dt);
    this.camera.position.z = damp(this.camera.position.z, desiredZ, p.stiffness, dt);

    // Look-at: in mouse mode aim at actor height; otherwise use spring lead.
    if (this._mouseLook) {
      this.look.x = damp(this.look.x, x, p.stiffness * 1.5, dt);
      this.look.y = damp(this.look.y, p.lookHeight, p.stiffness * 1.5, dt);
      this.look.z = damp(this.look.z, z, p.stiffness * 1.5, dt);
    } else {
      const rx = Math.sin(heading);
      const rz = Math.cos(heading);
      const vForward = vx * fx + vz * fz;
      const vLateral = vx * rx + vz * rz;
      const lead = lookLead(p, vForward, vLateral);
      const leadX = fx * lead.forward + rx * lead.lateral;
      const leadZ = fz * lead.forward + rz * lead.lateral;
      this.look.x = damp(this.look.x, x + leadX, p.stiffness, dt);
      this.look.y = damp(this.look.y, p.lookHeight, p.stiffness, dt);
      this.look.z = damp(this.look.z, z + leadZ, p.stiffness, dt);
    }
    this.camera.lookAt(this.look);
  }

  /** Yaw the camera is currently looking along — used for camera-relative walking. */
  get yaw(): number {
    // In mouse-look mode return the effective yaw directly (avoids numerical
    // drift from computing angle between two dampened vectors).
    if (this._mouseLook) return this._yawOffset;
    const dx = this.look.x - this.camera.position.x;
    const dz = this.look.z - this.camera.position.z;
    return Math.atan2(-dz, dx);
  }

  /** Reset the yaw offset back to behind the player (e.g. after exiting a car). */
  resetYaw(): void {
    this._yawOffset = 0;
  }
}
