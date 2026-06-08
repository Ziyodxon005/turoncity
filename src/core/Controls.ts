import { clamp } from './math';
import { Input } from './Input';
import { GamepadInput, GP } from './gamepad';
import { TouchControls } from '../ui/TouchControls';
import type { DeliveryPhase } from '../systems/Delivery';

/**
 * The single source of player intent, merging keyboard, touch and (on PC)
 * mouse pointer-lock for free-look camera.
 */
export class Controls {
  private readonly kb = new Input();
  private readonly pad = new GamepadInput();
  private readonly touch?: TouchControls;

  // ── Pointer-lock / mouse-look state ──────────────────────────────────────
  private _locked = false;
  private _mdx = 0; // accumulated mouse delta X this frame
  private _mdy = 0; // accumulated mouse delta Y this frame
  private _onLockChange?: (locked: boolean) => void;

  constructor(touchRoot?: HTMLElement) {
    if (touchRoot) this.touch = new TouchControls(touchRoot);
  }

  // ─── Pointer Lock ────────────────────────────────────────────────────────

  /** Call once to wire up pointer-lock listeners on a canvas/element. */
  initPointerLock(
    element: HTMLElement,
    onLockChange?: (locked: boolean) => void,
  ): void {
    this._onLockChange = onLockChange;

    element.addEventListener('click', () => {
      if (!this._locked) element.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === element;
      this._onLockChange?.(this._locked);
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this._locked) return;
      this._mdx += e.movementX;
      this._mdy += e.movementY;
    });
  }

  /** Release pointer lock (e.g. when pausing). */
  exitPointerLock(): void {
    if (this._locked) document.exitPointerLock();
  }

  isPointerLocked(): boolean {
    return this._locked;
  }

  /**
   * Consume accumulated mouse deltas for this frame.
   * Call once per render frame; returns {dx, dy} and resets accumulators.
   */
  consumeMouseDelta(): { dx: number; dy: number } {
    const result = { dx: this._mdx, dy: this._mdy };
    this._mdx = 0;
    this._mdy = 0;
    return result;
  }

  // ─── Movement / actions (unchanged) ─────────────────────────────────────

  move(onFoot = false): { x: number; y: number } {
    let x = this.kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let y = this.kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    if (this.touch) {
      const t = this.touch.stick();
      x += t.x;
      y += t.y;
    }
    const g = this.pad.move(onFoot);
    x += g.x;
    y += g.y;
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  handbrake(): boolean {
    return this.kb.isDown('Space') || (this.touch?.handbrake ?? false) || this.pad.handbrake();
  }

  sprint(onFoot = false): boolean {
    return (
      this.kb.isDown('ShiftLeft') ||
      this.kb.isDown('ShiftRight') ||
      (this.touch?.sprint ?? false) ||
      this.pad.sprint(onFoot)
    );
  }

  enterExitPressed(): boolean {
    const key = this.kb.wasPressed('KeyF') || this.kb.wasPressed('KeyE');
    const tap = this.touch?.consumeEnter() ?? false;
    const btn = this.pad.wasPressed(GP.A);
    return key || tap || btn;
  }

  resetPressed(): boolean {
    const key = this.kb.wasPressed('KeyR');
    const tap = this.touch?.consumeReset() ?? false;
    return key || tap || this.pad.wasPressed(GP.Y);
  }

  punchPressed(): boolean {
    const key = this.kb.wasPressed('Space');
    const tap = this.touch?.consumePunch() ?? false;
    return key || tap || this.pad.wasPressed(GP.X);
  }

  radioStep(): number {
    const next = this.kb.wasPressed('BracketRight') || this.pad.wasPressed(GP.RB);
    const prev = this.kb.wasPressed('BracketLeft') || this.pad.wasPressed(GP.LB);
    const tap = this.touch?.consumeRadio() ?? false;
    if (next || tap) return 1;
    if (prev) return -1;
    return 0;
  }

  /** Mobile only: update delivery button label/visibility for current phase. */
  setDeliveryPhase(phase: DeliveryPhase): void {
    this.touch?.setDeliveryPhase(phase);
  }

  /** Consume delivery action button (pickup or dropoff) from touch controls. */
  consumeDeliveryAction(): boolean {
    return this.touch?.consumeDeliveryAction() ?? false;
  }

  endFrame(): void {
    this.kb.endFrame();
    this.pad.endFrame();
  }
}
