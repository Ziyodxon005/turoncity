import { stickVector } from '../core/math';
import {
  createElement, type IconNode,
  Car, RotateCcw, Swords, Maximize, Minimize, Package, PackageCheck,
} from 'lucide';
import type { DeliveryPhase } from '../systems/Delivery';

function requestLandscape(): void {
  try {
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    so.lock?.('landscape').catch(() => { });
  } catch { /* not supported */ }
}

/** Inject responsive CSS custom-property scale system (once). */
function injectScaleVars(): void {
  if (document.getElementById('tc-scale-style')) return;
  const s = document.createElement('style');
  s.id = 'tc-scale-style';
  // --tc-u  = 1% of the smaller viewport dimension (like vmin but always current)
  // All controls scale proportionally so they look identical on any screen size.
  s.textContent = `
    :root {
      --tc-u: min(1vw, 1vh);
      --tc-stick:   clamp(52px, 22vmin, 160px);
      --tc-knob:    calc(var(--tc-stick) * 0.45);
      --tc-wheel:   clamp(72px, 28vmin, 200px);
      --tc-btn:     clamp(34px, 11vmin,  80px);
      --tc-btn-sm:  clamp(26px,  8vmin,  56px);
      --tc-pedal-w: clamp(54px, 20vmin, 130px);
      --tc-pedal-h-gas: clamp(74px, 26vmin, 160px);
      --tc-pedal-h-brk: clamp(54px, 20vmin, 130px);
      --tc-gap-edge: clamp(6px,  2vmin,  28px);
      --tc-exit-btn: clamp(28px,  7vmin,  48px);
      --tc-steer-ind-h: calc(var(--tc-wheel) * 0.375);
    }
    /* Portrait fallback: rotate entire body to landscape */
    @media (orientation: portrait) and (pointer: coarse) {
      body {
        transform: rotate(90deg);
        transform-origin: left top;
        width: 100dvh !important;
        height: 100dvw !important;
        position: fixed !important;
        top: 100%;
        left: 0;
        overflow: hidden;
      }
    }
  `;
  document.head.appendChild(s);
}

function icon(node: IconNode, size = 28): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.pointerEvents = 'none';
  return svg;
}

function el(tag: string, css: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (parent) parent.appendChild(e);
  return e;
}

function div(parent: HTMLElement, id: string, css: string): HTMLElement {
  const e = el('div', css, parent);
  if (id) e.id = id;
  return e;
}

/**
 * GTA-style touch controls with two modes:
 *   'foot'    — analog joystick (left) + action diamond (right)
 *   'driving' — steering wheel (left) + gas/brake pedals (right)
 *
 * Call `setMode('driving')` when player enters a car and
 * `setMode('foot')` when they exit.
 */
export class TouchControls {
  // ── Foot state ────────────────────────────────────────────────────────────
  private readonly vec = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;

  private brakeHeld = false;
  private sprintHeld = false;
  private enterEdge = false;
  private resetEdge = false;
  private radioEdge = false;
  private punchEdge = false;

  // ── Drive state ───────────────────────────────────────────────────────────
  private steerVal = 0;          // −1 … +1
  private gasHeld = false;
  private brakeHeldDrive = false;
  private enterEdgeDrive = false; // exit car button
  private steerPointer: number | null = null;

  // ── Delivery state ────────────────────────────────────────────────────────
  private deliveryActionEdge = false;
  private readonly deliveryBtnFoot!: HTMLElement;
  private readonly deliveryBtnDrive!: HTMLElement;
  private steerStartX = 0;
  // Dynamic steer range: 15% of viewport width so drag feels natural on any screen
  private get STEER_RANGE(): number { return window.innerWidth * 0.15; }

  // ── Look-drag state (camera orbit) ────────────────────────────────────────
  private lookPointer: number | null = null;
  private lookPrevX = 0;
  private lookPrevY = 0;
  private lookDx = 0; // accumulated pixels — consumed each frame
  private lookDy = 0;

  // ── Drive elements (declared at top, assigned in constructor) ────────────
  private readonly steerWheel!: HTMLElement;
  private readonly steerIndicator!: HTMLElement;

  // ── Panels ────────────────────────────────────────────────────────────────
  private readonly footPanel: HTMLElement;
  private readonly drivePanel: HTMLElement;
  private currentMode: 'foot' | 'driving' = 'foot';

  constructor(root: HTMLElement) {
    injectScaleVars();
    requestLandscape();

    // Re-lock to landscape on every orientation change (needed for iOS)
    window.addEventListener('orientationchange', () => {
      setTimeout(requestLandscape, 100);
    });

    window.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'dblclick'].forEach(ev =>
      document.addEventListener(ev, (e) => e.preventDefault()));

    root.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:5;' +
      'touch-action:none;user-select:none;-webkit-user-select:none;';

    if (!document.getElementById('tc-style')) {
      const s = document.createElement('style');
      s.id = 'tc-style';
      s.textContent = `
        .tc-btn{display:flex;align-items:center;justify-content:center;border-radius:50%;
          pointer-events:auto;touch-action:none;
          background:rgba(10,16,32,0.62);border:2px solid rgba(255,255,255,0.22);
          color:#e8ecf5;box-shadow:0 4px 18px rgba(0,0,0,0.45);
          -webkit-tap-highlight-color:transparent;}
        .tc-btn.pressed{background:rgba(84,160,255,0.55)!important;transform:scale(0.90);}
        .tc-lbl{position:absolute;font-size:clamp(7px,1.6vmin,9px);font-family:ui-monospace,monospace;
          color:rgba(255,255,255,0.45);bottom:-16px;left:50%;transform:translateX(-50%);
          white-space:nowrap;pointer-events:none;}
        .tc-pedal{display:flex;align-items:center;justify-content:center;
          border-radius:18px;pointer-events:auto;touch-action:none;
          box-shadow:0 6px 24px rgba(0,0,0,0.55);
          -webkit-tap-highlight-color:transparent;
          transition:transform 0.07s,filter 0.07s;}
        .tc-pedal.pressed{transform:scale(0.93) translateY(4px);filter:brightness(1.35);}
      `;
      document.head.appendChild(s);
    }

    // ── LOOK-DRAG ZONE (full screen, lowest z, behind all controls) ─────────
    const lookZone = div(root, 'tc-look-zone',
      'position:absolute;inset:0;pointer-events:auto;touch-action:none;z-index:-1;');
    lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lookPrevX = e.clientX;
      this.lookPrevY = e.clientY;
      lookZone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookDx += e.clientX - this.lookPrevX;
      this.lookDy += e.clientY - this.lookPrevY;
      this.lookPrevX = e.clientX;
      this.lookPrevY = e.clientY;
    });
    const releaseLook = (e: PointerEvent): void => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookPointer = null;
    };
    lookZone.addEventListener('pointerup', releaseLook);
    lookZone.addEventListener('pointercancel', releaseLook);

    // ── FOOT PANEL ────────────────────────────────────────────────────────
    // Both panels start hidden; setMode() makes the correct one visible.
    this.footPanel = div(root, 'tc-foot-panel', 'position:absolute;inset:0;pointer-events:none;display:none;');

    // Joystick – size driven by CSS var
    this.stickBase = div(this.footPanel, 'tc-stick',
      'position:absolute;left:calc(var(--tc-gap-edge) + env(safe-area-inset-left));' +
      'bottom:calc(var(--tc-gap-edge) + env(safe-area-inset-bottom) + 4px);' +
      'width:var(--tc-stick);height:var(--tc-stick);border-radius:50%;' +
      'background:rgba(10,16,32,0.45);border:2px solid rgba(255,255,255,0.15);' +
      'box-shadow:0 0 32px rgba(84,160,255,0.1);pointer-events:auto;touch-action:none;');

    this.stickKnob = div(this.stickBase, 'tc-knob',
      'position:absolute;left:50%;top:50%;' +
      'width:var(--tc-knob);height:var(--tc-knob);' +
      'margin:calc(var(--tc-knob) * -0.5) 0 0 calc(var(--tc-knob) * -0.5);' +
      'border-radius:50%;pointer-events:none;' +
      'background:radial-gradient(circle at 38% 35%, rgba(130,170,255,0.75) 0%, rgba(60,100,200,0.55) 100%);' +
      'border:2px solid rgba(255,255,255,0.55);box-shadow:0 4px 16px rgba(0,0,0,0.5);');

    this.stickBase.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) this.moveStick(e.clientX, e.clientY);
    });
    const releaseStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.vec.x = 0; this.vec.y = 0;
      this.stickKnob.style.transform = 'translate(0,0)';
    };
    window.addEventListener('pointerup', releaseStick);
    window.addEventListener('pointercancel', releaseStick);

    // Right FOOT buttons — vertical stack: Enter car (top) + Punch (bottom)
    const rArea = div(this.footPanel, 'tc-right',
      'position:absolute;right:calc(var(--tc-gap-edge) + env(safe-area-inset-right));' +
      'bottom:calc(var(--tc-gap-edge) + env(safe-area-inset-bottom));' +
      'display:flex;flex-direction:column;gap:clamp(8px,2vmin,14px);align-items:center;pointer-events:none;');

    this.makeActionBtn(rArea, 'tc-enter', Car, 'Minish', 0, 0, 'var(--tc-btn)', '#54a0ff', () => (this.enterEdge = true), undefined, true);
    this.makeActionBtn(rArea, 'tc-punch', Swords, 'Urish', 0, 0, 'var(--tc-btn)', '#ffa502', () => (this.punchEdge = true), undefined, true);

    // Extra buttons (Reset + Radio) are only in the DRIVE panel, not here.
    // On foot the player doesn't need them cluttering the screen.

    // ── DRIVE PANEL ───────────────────────────────────────────────────────
    this.drivePanel = div(root, 'tc-drive-panel',
      'position:absolute;inset:0;pointer-events:none;display:none;');

    // Steering wheel (left) – responsive size
    this.steerWheel = div(this.drivePanel, 'tc-wheel',
      'position:absolute;left:calc(var(--tc-gap-edge) + env(safe-area-inset-left));' +
      'bottom:calc(var(--tc-gap-edge) + env(safe-area-inset-bottom) + 4px);' +
      'width:var(--tc-wheel);height:var(--tc-wheel);border-radius:50%;' +
      'background:radial-gradient(circle at 40% 35%, rgba(50,60,80,0.85) 0%, rgba(15,20,35,0.92) 100%);' +
      'border:3px solid rgba(255,255,255,0.18);' +
      'box-shadow:0 0 40px rgba(84,160,255,0.12),inset 0 2px 8px rgba(255,255,255,0.06);' +
      'pointer-events:auto;touch-action:none;overflow:hidden;');

    // Centre hub
    div(this.steerWheel, '',
      'position:absolute;left:50%;top:50%;width:clamp(24px,5vmin,40px);height:clamp(24px,5vmin,40px);' +
      'margin:calc(clamp(24px,5vmin,40px) * -0.5) 0 0 calc(clamp(24px,5vmin,40px) * -0.5);border-radius:50%;' +
      'background:rgba(84,160,255,0.2);border:2px solid rgba(84,160,255,0.4);' +
      'pointer-events:none;');

    // Steering indicator bar (rotates)
    this.steerIndicator = div(this.steerWheel, 'tc-steer-ind',
      'position:absolute;left:50%;top:50%;' +
      'width:4px;height:var(--tc-steer-ind-h);margin-left:-2px;margin-top:calc(var(--tc-steer-ind-h) * -1);' +
      'background:linear-gradient(to bottom, rgba(84,160,255,0.9), transparent);' +
      'border-radius:2px;transform-origin:center bottom;pointer-events:none;');

    // Steering label
    const steerLbl = el('div',
      'position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);' +
      'font-size:clamp(8px,1.8vmin,10px);font-family:ui-monospace,monospace;color:rgba(255,255,255,0.4);' +
      'white-space:nowrap;', this.steerWheel.parentElement!);
    steerLbl.textContent = 'RUL';
    void steerLbl;

    this.steerWheel.addEventListener('pointerdown', (e) => {
      if (this.steerPointer !== null) return;
      this.steerPointer = e.pointerId;
      this.steerStartX = e.clientX;
      this.steerWheel.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.steerWheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer) return;
      const dx = e.clientX - this.steerStartX;
      this.steerVal = Math.max(-1, Math.min(1, dx / this.STEER_RANGE));
      const deg = this.steerVal * 90;
      this.steerIndicator.style.transform = `rotate(${deg}deg)`;
    });
    const releaseSteer = (e: PointerEvent): void => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = null;
      this.steerVal = 0;
      this.steerIndicator.style.transform = 'rotate(0deg)';
    };
    this.steerWheel.addEventListener('pointerup', releaseSteer);
    this.steerWheel.addEventListener('pointercancel', releaseSteer);

    // GAS pedal (right bottom) – responsive, slightly larger
    const gasBtn = this.makePedal(this.drivePanel, 'tc-gas', 'GAS ⬆', '#1a7a3a',
      'position:absolute;right:calc(var(--tc-gap-edge) + env(safe-area-inset-right));' +
      'bottom:calc(var(--tc-gap-edge) + env(safe-area-inset-bottom));' +
      'width:var(--tc-pedal-w);height:var(--tc-pedal-h-gas);',
      () => (this.gasHeld = true), () => (this.gasHeld = false));
    void gasBtn;

    // BRAKE pedal (left of gas) – responsive
    const brakeBtn = this.makePedal(this.drivePanel, 'tc-brake-drive', 'TORMOZ ⬇', '#8b1a1a',
      'position:absolute;right:calc(var(--tc-gap-edge) + var(--tc-pedal-w) + clamp(8px,2vmin,14px) + env(safe-area-inset-right));' +
      'bottom:calc(var(--tc-gap-edge) + env(safe-area-inset-bottom));' +
      'width:var(--tc-pedal-w);height:var(--tc-pedal-h-brk);',
      () => (this.brakeHeldDrive = true), () => (this.brakeHeldDrive = false));
    void brakeBtn;

    // EXIT button – positioned LEFT side, small, above steering wheel
    const exitBtn = div(this.drivePanel, 'tc-exit-car',
      'position:absolute;' +
      'left:calc(var(--tc-gap-edge) + env(safe-area-inset-left));' +
      'bottom:calc(var(--tc-gap-edge) + var(--tc-wheel) + clamp(6px,1.5vmin,10px) + env(safe-area-inset-bottom));' +
      'width:var(--tc-exit-btn);height:var(--tc-exit-btn);border-radius:50%;pointer-events:auto;touch-action:none;' +
      'display:flex;align-items:center;justify-content:center;gap:2px;flex-direction:column;' +
      'background:rgba(10,16,32,0.72);border:2px solid rgba(255,100,100,0.4);color:#ffaaaa;' +
      'box-shadow:0 4px 18px rgba(0,0,0,0.45);');
    exitBtn.appendChild(icon(Car, 14));
    const exitLbl = el('span',
      'font-size:clamp(6px,1.2vmin,8px);font-family:ui-monospace,monospace;color:rgba(255,160,160,0.85);line-height:1;');
    exitLbl.textContent = 'CHIQ';
    exitBtn.appendChild(exitLbl);
    exitBtn.addEventListener('pointerdown', (e) => {
      this.enterEdgeDrive = true;
      exitBtn.style.background = 'rgba(84,160,255,0.55)';
      e.preventDefault();
    });
    exitBtn.addEventListener('pointerup', () => { exitBtn.style.background = ''; });
    exitBtn.addEventListener('pointercancel', () => { exitBtn.style.background = ''; });

    // ── DELIVERY button (drive panel) – RIGHT NEXT TO CHIQ btn ──
    const driveDlBtn = div(this.drivePanel, 'tc-delivery-drive',
      'position:absolute;' +
      'left:calc(var(--tc-gap-edge) + var(--tc-exit-btn) + clamp(8px,2vmin,14px) + env(safe-area-inset-left));' +
      'bottom:calc(var(--tc-gap-edge) + var(--tc-wheel) + clamp(6px,1.5vmin,10px) + env(safe-area-inset-bottom));' +
      'width:var(--tc-exit-btn);height:var(--tc-exit-btn);border-radius:50%;pointer-events:auto;touch-action:none;' +
      'display:none;align-items:center;justify-content:center;flex-direction:column;gap:2px;' +
      'background:rgba(10,16,32,0.72);border:2.5px solid rgba(255,200,50,0.7);color:#ffd24a;' +
      'box-shadow:0 4px 18px rgba(0,0,0,0.55);');
    (this as unknown as { deliveryBtnDrive: HTMLElement }).deliveryBtnDrive = driveDlBtn;
    driveDlBtn.appendChild(icon(Package, 20));
    const dlDriveLbl = el('span',
      'font-size:clamp(6px,1.4vmin,9px);font-family:ui-monospace,monospace;color:rgba(255,210,74,0.9);line-height:1;font-weight:700;');
    dlDriveLbl.textContent = 'OLISH';
    driveDlBtn.appendChild(dlDriveLbl);
    driveDlBtn.addEventListener('pointerdown', (e) => {
      this.deliveryActionEdge = true;
      driveDlBtn.style.background = 'rgba(255,200,50,0.45)';
      driveDlBtn.style.transform = 'scale(0.90)';
      e.preventDefault();
    });
    driveDlBtn.addEventListener('pointerup', () => { driveDlBtn.style.background = ''; driveDlBtn.style.transform = ''; });
    driveDlBtn.addEventListener('pointercancel', () => { driveDlBtn.style.background = ''; driveDlBtn.style.transform = ''; });

    // Reset (driving) – RIGHT side, BELOW the minimap so it doesn't overlap speed/clock
    const driveReset = div(this.drivePanel, 'tc-drive-reset',
      'position:absolute;' +
      'top:clamp(170px,38vmin,275px);' +
      'right:calc(var(--tc-gap-edge) + env(safe-area-inset-right));' +
      'width:clamp(28px,6vmin,40px);height:clamp(28px,6vmin,40px);border-radius:50%;pointer-events:auto;touch-action:none;' +
      'display:flex;align-items:center;justify-content:center;' +
      'background:rgba(10,16,32,0.55);border:2px solid rgba(255,255,255,0.15);color:#e8ecf5;');
    driveReset.appendChild(icon(RotateCcw, 16));
    driveReset.addEventListener('pointerdown', (e) => {
      this.resetEdge = true; e.preventDefault();
    });

    // ── DELIVERY button (foot panel) – RIGHT SIDE, above enter/punch buttons ──
    const footDlBtn = div(this.footPanel, 'tc-delivery-foot',
      'position:absolute;' +
      'right:calc(var(--tc-gap-edge) + env(safe-area-inset-right));' +
      'bottom:calc(var(--tc-gap-edge) + var(--tc-btn) * 2 + clamp(8px,2vmin,14px) * 2 + env(safe-area-inset-bottom));' +
      'width:var(--tc-btn);height:var(--tc-btn);border-radius:50%;pointer-events:auto;touch-action:none;' +
      'display:none;align-items:center;justify-content:center;flex-direction:column;gap:2px;' +
      'background:rgba(10,16,32,0.72);border:2.5px solid rgba(255,200,50,0.7);color:#ffd24a;' +
      'box-shadow:0 4px 18px rgba(0,0,0,0.55);');
    (this as unknown as { deliveryBtnFoot: HTMLElement }).deliveryBtnFoot = footDlBtn;
    footDlBtn.appendChild(icon(Package, 20));
    const dlFootLbl = el('span',
      'font-size:clamp(6px,1.4vmin,9px);font-family:ui-monospace,monospace;color:rgba(255,210,74,0.9);line-height:1;font-weight:700;');
    dlFootLbl.textContent = 'OLISH';
    footDlBtn.appendChild(dlFootLbl);
    footDlBtn.addEventListener('pointerdown', (e) => {
      this.deliveryActionEdge = true;
      footDlBtn.style.background = 'rgba(255,200,50,0.45)';
      footDlBtn.style.transform = 'scale(0.90)';
      e.preventDefault();
    });
    footDlBtn.addEventListener('pointerup', () => { footDlBtn.style.background = ''; footDlBtn.style.transform = ''; });
    footDlBtn.addEventListener('pointercancel', () => { footDlBtn.style.background = ''; footDlBtn.style.transform = ''; });

    // Fullscreen (both panels)
    this.addFullscreenButton(root);
  }

  // ── Mode switch ──────────────────────────────────────────────────────────

  setMode(mode: 'foot' | 'driving'): void {
    this.currentMode = mode;
    // Explicitly hide/show both panels so they never overlap
    this.footPanel.style.display = 'none';
    this.drivePanel.style.display = 'none';
    if (mode === 'foot') {
      this.footPanel.style.display = 'block';
      this.steerVal = 0;
      this.vec.x = 0; this.vec.y = 0;
    } else {
      this.drivePanel.style.display = 'block';
    }
  }

  /**
   * Update delivery action button visibility based on current delivery phase.
   * Call each frame from main.ts (or on phase change).
   * @param phase 'idle' hides buttons, 'pickup' shows OLISH, 'carrying' shows BERISH
   */
  setDeliveryPhase(phase: DeliveryPhase): void {
    const active = phase !== 'idle';
    const isCarrying = phase === 'carrying';
    const label = isCarrying ? 'BERISH' : 'OLISH';
    const borderColor = isCarrying ? 'rgba(58,209,122,0.6)' : 'rgba(255,200,50,0.5)';
    const color = isCarrying ? '#3ad17a' : '#ffd24a';
    const displayVal = active ? 'flex' : 'none';

    // Update foot btn
    this.deliveryBtnFoot.style.display = displayVal;
    this.deliveryBtnFoot.style.borderColor = borderColor;
    this.deliveryBtnFoot.style.color = color;
    const footIco = this.deliveryBtnFoot.querySelector('svg');
    if (footIco) footIco.replaceWith(icon(isCarrying ? PackageCheck : Package, 14));
    const footLbl = this.deliveryBtnFoot.querySelector('span');
    if (footLbl) footLbl.textContent = label;

    // Update drive btn
    this.deliveryBtnDrive.style.display = displayVal;
    this.deliveryBtnDrive.style.borderColor = borderColor;
    this.deliveryBtnDrive.style.color = color;
    const driveIco = this.deliveryBtnDrive.querySelector('svg');
    if (driveIco) driveIco.replaceWith(icon(isCarrying ? PackageCheck : Package, 14));
    const driveLbl = this.deliveryBtnDrive.querySelector('span');
    if (driveLbl) driveLbl.textContent = label;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private moveStick(clientX: number, clientY: number): void {
    const r = this.stickBase.getBoundingClientRect();
    const radius = r.width / 2;
    const v = stickVector(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), radius);
    this.vec.x = v.x; this.vec.y = v.y;
    this.stickKnob.style.transform = `translate(${v.x * radius}px,${-v.y * radius}px)`;
  }

  private makeActionBtn(
    parent: HTMLElement, id: string, glyph: IconNode, label: string,
    x: number, y: number, size: string | number, accent: string,
    onDown: () => void, onUp?: () => void, inline = false,
  ): HTMLElement {
    const sizeStr = typeof size === 'number' ? `${size}px` : size;
    const b = document.createElement('div');
    b.id = id;
    b.className = 'tc-btn';
    b.style.cssText = inline
      ? `width:${sizeStr};height:${sizeStr};position:relative;pointer-events:auto;touch-action:none;flex-shrink:0;`
      : `width:${sizeStr};height:${sizeStr};position:absolute;left:${x}px;top:${y}px;pointer-events:auto;touch-action:none;`;
    b.setAttribute('aria-label', label);
    // Icon scales with button – use ~42% of computed size
    b.appendChild(icon(glyph, 24));
    const lbl = el('span', 'position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:clamp(7px,1.6vmin,9px);font-family:ui-monospace,monospace;color:rgba(255,255,255,0.4);white-space:nowrap;pointer-events:none;');
    lbl.textContent = label;
    b.appendChild(lbl);
    b.addEventListener('pointerdown', (e) => {
      onDown(); b.style.background = `${accent}88`; b.style.borderColor = accent;
      b.style.transform = 'scale(0.90)'; e.preventDefault();
    });
    const up = (e: PointerEvent): void => {
      onUp?.(); b.style.background = ''; b.style.borderColor = ''; b.style.transform = ''; e.preventDefault();
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    parent.appendChild(b);
    return b;
  }

  private makePedal(
    parent: HTMLElement, id: string, label: string, color: string, css: string,
    onDown: () => void, onUp: () => void,
  ): HTMLElement {
    const b = div(parent, id,
      css + `background:${color};border:none;border-radius:18px;` +
      'pointer-events:auto;touch-action:none;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;' +
      'box-shadow:0 6px 24px rgba(0,0,0,0.55);');
    const txt = el('div',
      'font-size:clamp(9px,2vmin,11px);font-weight:800;font-family:ui-monospace,monospace;' +
      'color:rgba(255,255,255,0.85);text-align:center;line-height:1.3;pointer-events:none;');
    txt.textContent = label;
    b.appendChild(txt);
    b.addEventListener('pointerdown', (e) => {
      onDown(); b.style.filter = 'brightness(1.4)'; b.style.transform = 'scale(0.93) translateY(3px)'; e.preventDefault();
    });
    const up = (e: PointerEvent): void => {
      onUp(); b.style.filter = ''; b.style.transform = ''; e.preventDefault();
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    return b;
  }



  private addFullscreenButton(root: HTMLElement): void {
    const el2 = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const btn = div(root, 'tc-fullscreen',
      'position:absolute;bottom:calc(clamp(6px,2vmin,14px) + env(safe-area-inset-bottom));' +
      'left:50%;transform:translateX(-50%);' +
      'width:clamp(28px,5vmin,38px);height:clamp(28px,5vmin,38px);border-radius:50%;' +
      'pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(10,16,32,0.45);border:1px solid rgba(255,255,255,0.12);color:#e8ecf5;');
    const isFull = (): boolean => !!(document.fullscreenElement || doc.webkitFullscreenElement);
    const paint = (): void => { btn.replaceChildren(icon(isFull() ? Minimize : Maximize, 18)); };
    paint();
    document.addEventListener('fullscreenchange', paint);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (isFull()) (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      else (el2.requestFullscreen ?? el2.webkitRequestFullscreen)?.call(el2);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Foot mode: joystick vector */
  stick(): { x: number; y: number } { return this.vec; }

  /** Drive mode: steer value (−1 left … +1 right) */
  steer(): number { return this.steerVal; }

  /** Drive mode: gas pedal held */
  get gas(): boolean { return this.gasHeld; }

  get handbrake(): boolean {
    return this.currentMode === 'driving' ? this.brakeHeldDrive : this.brakeHeld;
  }
  get sprint(): boolean { return this.sprintHeld; }

  consumeEnter(): boolean {
    if (this.currentMode === 'driving') {
      const v = this.enterEdgeDrive; this.enterEdgeDrive = false; return v;
    }
    const v = this.enterEdge; this.enterEdge = false; return v;
  }
  consumeReset(): boolean { const v = this.resetEdge; this.resetEdge = false; return v; }

  /** Look-drag: accumulated camera delta pixels since last call (resets on read). */
  consumeLookDelta(): { dx: number; dy: number } {
    const result = { dx: this.lookDx, dy: this.lookDy };
    this.lookDx = 0;
    this.lookDy = 0;
    return result;
  }

  consumeRadio(): boolean { const v = this.radioEdge; this.radioEdge = false; return v; }
  consumePunch(): boolean { const v = this.punchEdge; this.punchEdge = false; return v; }

  /** Consume the delivery action button press (pickup or dropoff). */
  consumeDeliveryAction(): boolean { const v = this.deliveryActionEdge; this.deliveryActionEdge = false; return v; }
}
