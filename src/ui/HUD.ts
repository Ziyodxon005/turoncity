import type { City } from '../world/City';

export type Mode = 'driving' | 'foot';

const MAP_SIZE = 190;
// Streamed world: the minimap is a player-centred radar spanning this many metres
// (the finite precomputed road/footprint map doesn't apply to an unbounded world).
const STREAM_VIEW_METERS = 320;

// Shared HUD design tokens so the widgets read as one designed overlay.
const ACCENT = '#54a0ff';
const CHIP =
  'padding:6px 12px;background:rgba(12,16,26,.55);border:1px solid rgba(255,255,255,.07);' +
  'border-radius:8px;backdrop-filter:blur(6px);';

/**
 * DOM overlay: speedometer, current mode, control legend, and a live minimap.
 * The static map (roads + footprints) is rendered once to an offscreen canvas
 * in the constructor; each frame only the dynamic dots are composited on top.
 */
export class HUD {
  private readonly speedEl: HTMLElement;
  private readonly speedBox: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D;
  private readonly staticMap: HTMLCanvasElement;
  private readonly toWorld: number;
  private readonly healthFill: HTMLElement;
  private readonly healthTrack: HTMLElement;
  private readonly wastedEl: HTMLElement;
  private readonly bustedEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly radioEl: HTMLElement;
  private readonly carEl: HTMLElement;
  private readonly wantedEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private viewX = 0;
  private viewZ = 0;

  constructor(
    container: HTMLElement,
    private readonly city: City,
    touch = false,
    private readonly streaming = false,
  ) {
    this.toWorld = streaming ? MAP_SIZE / STREAM_VIEW_METERS : MAP_SIZE / city.extent;

    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;color:#e8ecf5;' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;text-shadow:0 1px 3px #000;';
    container.appendChild(root);

    const speedBox = document.createElement('div');
    // On desktop the speed box is bottom-right; on touch it moves to top-right.
    speedBox.style.cssText = touch
      ? 'position:absolute;right:clamp(10px,2.5vmin,18px);top:clamp(8px,2vmin,12px);text-align:right;line-height:1;'
      : 'position:absolute;right:20px;bottom:20px;text-align:right;line-height:1;';
    this.speedEl = document.createElement('div');
    this.speedEl.style.cssText = touch
      ? 'font-size:clamp(18px,4vmin,28px);font-weight:700;letter-spacing:-1px;'
      : 'font-size:46px;font-weight:700;letter-spacing:-1px;';
    const unit = document.createElement('div');
    unit.textContent = 'KM/S';
    unit.style.cssText = `font-size:clamp(9px,2vmin,13px);opacity:.7;margin-top:2px;color:${ACCENT};letter-spacing:2px;`;
    speedBox.append(this.speedEl, unit);
    speedBox.style.cssText += CHIP;
    root.appendChild(speedBox);
    this.speedBox = speedBox;

    this.modeEl = document.createElement('div');
    this.modeEl.style.cssText = touch
      ? 'position:absolute;left:clamp(8px,2vmin,20px);top:clamp(10px,2vmin,18px);font-size:clamp(9px,2vmin,14px);font-weight:700;letter-spacing:1px;' + CHIP
      : 'position:absolute;left:20px;top:18px;font-size:14px;font-weight:700;letter-spacing:1px;' + CHIP;
    root.appendChild(this.modeEl);

    this.wantedEl = document.createElement('div');
    this.wantedEl.style.cssText = touch
      ? 'position:absolute;left:clamp(8px,2vmin,20px);top:clamp(48px,9vmin,74px);font-size:clamp(11px,2.5vmin,18px);letter-spacing:2px;color:#ffd24a;text-shadow:0 1px 4px #000;'
      : 'position:absolute;left:20px;top:74px;font-size:18px;letter-spacing:3px;color:#ffd24a;text-shadow:0 1px 4px #000;';
    const wantedStyle = document.createElement('style');
    wantedStyle.textContent = '@keyframes wantedFlash{0%{opacity:1}100%{opacity:.25}}';
    root.append(wantedStyle, this.wantedEl);

    const healthTrack = document.createElement('div');
    healthTrack.style.cssText = touch
      ? `position:absolute;left:clamp(8px,2vmin,20px);top:clamp(34px,6.5vmin,58px);width:clamp(100px,25vmin,182px);height:clamp(7px,1.5vmin,13px);` +
      'background:rgba(12,16,26,.6);border:1px solid rgba(255,255,255,.07);border-radius:7px;overflow:hidden;backdrop-filter:blur(6px);'
      : 'position:absolute;left:20px;top:58px;width:182px;height:13px;' +
      'background:rgba(12,16,26,.6);border:1px solid rgba(255,255,255,.07);border-radius:7px;overflow:hidden;backdrop-filter:blur(6px);';
    this.healthFill = document.createElement('div');
    this.healthFill.style.cssText =
      'height:100%;width:100%;background:linear-gradient(90deg,#3ad17a,#7dffa6);transition:width .1s linear;';
    healthTrack.appendChild(this.healthFill);
    root.appendChild(healthTrack);
    this.healthTrack = healthTrack;

    this.scoreEl = document.createElement('div');
    this.scoreEl.style.cssText = touch
      ? 'position:absolute;left:50%;top:clamp(6px,1.5vmin,12px);transform:translateX(-50%);font-size:clamp(9px,2vmin,13px);font-weight:700;' + CHIP
      : 'position:absolute;left:50%;top:12px;transform:translateX(-50%);font-size:13px;font-weight:700;' + CHIP;
    this.scoreEl.textContent = '🚶 0';
    root.appendChild(this.scoreEl);

    this.radioEl = document.createElement('div');
    this.radioEl.style.cssText = touch
      ? 'position:absolute;left:50%;top:clamp(28px,5vmin,48px);transform:translateX(-50%);font-size:clamp(8px,1.8vmin,12px);' +
      'max-width:50vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + CHIP
      : 'position:absolute;left:50%;top:48px;transform:translateX(-50%);font-size:12px;' +
      'max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + CHIP;
    this.radioEl.textContent = '📻 O\'CHIQ';
    root.appendChild(this.radioEl);

    // Clock: on touch goes to RIGHT side below the minimap so it doesn't
    // collide with the left delivery panel; on desktop it's top-right corner.
    this.clockEl = document.createElement('div');
    this.clockEl.style.cssText = touch
      ? 'position:absolute;right:clamp(8px,2vmin,18px);top:clamp(138px,26vmin,200px);' +
      'font-size:clamp(8px,1.8vmin,12px);font-weight:700;letter-spacing:1px;opacity:0.75;' + CHIP
      : 'position:absolute;right:20px;top:16px;font-size:14px;font-weight:700;letter-spacing:1px;' + CHIP;
    root.appendChild(this.clockEl);

    // Car name: hidden on touch (no screen space; user doesn't need it there).
    this.carEl = document.createElement('div');
    this.carEl.style.cssText = touch
      ? 'display:none;'
      : 'position:absolute;right:20px;bottom:92px;font-size:13px;opacity:.7;text-align:right;';
    root.appendChild(this.carEl);

    const bigText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
      'font-size:13vw;font-weight:800;letter-spacing:6px;' +
      'text-shadow:0 4px 24px #000;font-family:Georgia,"Times New Roman",serif;';
    this.wastedEl = document.createElement('div');
    this.wastedEl.textContent = 'HALOK BO\'LDINGIZ';
    this.wastedEl.style.cssText =
      bigText + 'color:#c0202a;background:radial-gradient(circle,rgba(40,0,0,.35),rgba(0,0,0,.85));';
    root.appendChild(this.wastedEl);

    this.bustedEl = document.createElement('div');
    this.bustedEl.textContent = 'USHLANDI!';
    this.bustedEl.style.cssText =
      bigText + 'color:#3aa0ff;background:radial-gradient(circle,rgba(0,16,40,.4),rgba(0,0,0,.85));';
    root.appendChild(this.bustedEl);

    // (Control legend now lives in the title/pause menu — keep the HUD clean.)

    // (Decorative wordmark dropped — the splash/title menu carry the name; the
    // top-right corner is the clock now.)

    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = this.mapCanvas.height = MAP_SIZE;
    if (touch) {
      // On mobile: top-right corner, compact size, below the speed readout
      this.mapCanvas.style.cssText =
        'position:absolute;right:clamp(8px,2vmin,18px);top:clamp(68px,13vmin,100px);' +
        'width:clamp(72px,16vmin,110px);height:clamp(72px,16vmin,110px);' +
        'border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(8,10,16,.55);' +
        'opacity:0.88;';
    } else {
      this.mapCanvas.style.cssText =
        'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);' +
        'border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(8,10,16,.55);';
    }
    root.appendChild(this.mapCanvas);
    this.mapCtx = this.mapCanvas.getContext('2d')!;

    this.staticMap = this.buildStaticMap();
  }

  private mapX(wx: number): number {
    return this.streaming ? MAP_SIZE / 2 + (wx - this.viewX) * this.toWorld : (wx + this.city.half) * this.toWorld;
  }
  private mapY(wz: number): number {
    return this.streaming ? MAP_SIZE / 2 + (wz - this.viewZ) * this.toWorld : (wz + this.city.half) * this.toWorld;
  }

  private buildStaticMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE;
    // Streamed world: nothing precomputed — the radar redraws live each frame
    // around the player (see update()).
    if (this.streaming) return c;
    const ctx = c.getContext('2d')!;

    ctx.strokeStyle = 'rgba(120,140,180,.55)';
    ctx.lineWidth = Math.max(1, this.city.config.roadWidth * this.toWorld * 0.6);
    for (const rc of this.city.roadCenters) {
      const p = this.mapX(rc);
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, MAP_SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(MAP_SIZE, p);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(180,200,235,.32)';
    for (const b of this.city.buildings) {
      ctx.fillRect(
        this.mapX(b.cx - b.width / 2),
        this.mapY(b.cz - b.depth / 2),
        b.width * this.toWorld,
        b.depth * this.toWorld,
      );
    }
    return c;
  }

  update(
    speedKmh: number,
    mode: Mode,
    player: { x: number; z: number; heading: number },
    cars: ReadonlyArray<{ x: number; z: number }>,
    health: number,
    wasted: boolean,
    deliveryMarkers?: {
      restaurant?: { x: number; z: number };
      customer?: { x: number; z: number } | null;
    },
  ): void {
    this.speedEl.textContent = String(Math.round(speedKmh));
    this.modeEl.textContent = mode === 'driving' ? '🚗 HAYDAMOQDA' : '🚶 PIYODA';

    const h = Math.max(0, Math.min(100, health));
    this.healthFill.style.width = `${h}%`;
    this.healthFill.style.background = h > 50 ? '#54ff84' : h > 20 ? '#ffd24a' : '#ff5a4a';
    this.wastedEl.style.display = wasted ? 'flex' : 'none';

    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    if (this.streaming) {
      this.viewX = player.x;
      this.viewZ = player.z;
    }
    ctx.drawImage(this.staticMap, 0, 0);

    // Traffic cars — small yellow squares
    ctx.fillStyle = '#ffd24a';
    for (const car of cars) {
      ctx.fillRect(this.mapX(car.x) - 1.5, this.mapY(car.z) - 1.5, 3, 3);
    }

    // ── Delivery markers ────────────────────────────────────────────────────
    if (deliveryMarkers?.restaurant) {
      this._drawMapPin(
        ctx,
        this.mapX(deliveryMarkers.restaurant.x),
        this.mapY(deliveryMarkers.restaurant.z),
        '#ffd24a', // yellow — restaurant
        '🍕',
      );
    }
    if (deliveryMarkers?.customer) {
      this._drawMapPin(
        ctx,
        this.mapX(deliveryMarkers.customer.x),
        this.mapY(deliveryMarkers.customer.z),
        '#3ad17a', // green — customer
        '🏠',
      );
    }

    // Player as a heading arrow (drawn last so it's always on top)
    const px = this.mapX(player.x);
    const py = this.mapY(player.z);
    const fx = Math.cos(player.heading);
    const fz = -Math.sin(player.heading);
    ctx.fillStyle = mode === 'driving' ? '#54ff84' : '#54c8ff';
    ctx.beginPath();
    ctx.moveTo(px + fx * 6, py + fz * 6);
    ctx.lineTo(px - fz * 4 - fx * 3, py + fx * 4 - fz * 3);
    ctx.lineTo(px + fz * 4 - fx * 3, py - fx * 4 - fz * 3);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draw a coloured diamond pin + pulsed glow on the minimap.
   * The emoji label is a canvas `fillText` so no DOM nodes are needed.
   */
  private _drawMapPin(
    ctx: CanvasRenderingContext2D,
    mx: number,
    my: number,
    color: string,
    _emoji: string,
  ): void {
    // Glow halo
    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 8);
    grad.addColorStop(0, color + 'cc');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fill();

    // Diamond shape
    const S = 5;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, my - S);   // top
    ctx.lineTo(mx + S, my);   // right
    ctx.lineTo(mx, my + S);   // bottom
    ctx.lineTo(mx - S, my);   // left
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  setRunOverCount(n: number): void {
    this.scoreEl.textContent = `🚶 ${n}`;
  }

  setCarName(name: string | null): void {
    this.carEl.textContent = name ?? '';
  }

  setRadio(label: string): void {
    this.radioEl.textContent = label;
  }

  /** Time-of-day clock from `t` in [0,1) (0 = midnight) → 🕐 HH:MM (24h). */
  setClock(t: number): void {
    const mins = Math.floor(t * 24 * 60) % (24 * 60);
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    this.clockEl.textContent = `🕐 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  setWanted(stars: number, cooling = false): void {
    this.wantedEl.textContent = stars > 0 ? '★'.repeat(stars) : '';
    // Flash the stars while you're shaking the cops (wanted cooling off).
    this.wantedEl.style.animation = cooling ? 'wantedFlash .5s steps(2) infinite' : 'none';
  }

  setBusted(on: boolean): void {
    this.bustedEl.style.display = on ? 'flex' : 'none';
  }

  /**
   * Force mobile HUD layout — called when the user explicitly picks "Mobile"
   * on the platform-select screen, even if isTouchDevice() returned false.
   *
   * Layout:
   *   LEFT column  — mode badge → health bar → [delivery panel via DeliveryHUD]
   *                            → minimap (compact, below delivery)
   *   RIGHT column — speed (small) → clock (below speed)
   *   HIDDEN       — car name (Crown Vantage etc.)
   */
  applyTouchLayout(): void {
    const CHIP_BASE =
      'padding:clamp(4px,1vmin,8px) clamp(6px,1.5vmin,14px);' +
      'background:rgba(12,16,26,.55);border:1px solid rgba(255,255,255,.07);' +
      'border-radius:8px;backdrop-filter:blur(6px);';

    // Clock — RIGHT TOP (above speed), so restart btn can go below minimap
    this.clockEl.style.cssText =
      'position:absolute;right:clamp(10px,2.5vmin,18px);top:clamp(8px,2vmin,12px);' +
      'font-size:clamp(8px,1.8vmin,12px);font-weight:700;letter-spacing:1px;opacity:0.85;' + CHIP_BASE;

    // Speed box — right side, below clock
    this.speedBox.style.cssText =
      'position:absolute;right:clamp(10px,2.5vmin,18px);top:clamp(32px,6vmin,52px);' +
      'text-align:right;line-height:1;' + CHIP_BASE;
    this.speedEl.style.cssText =
      'font-size:clamp(14px,3.2vmin,22px);font-weight:700;letter-spacing:-1px;';

    // Mode badge — top-left
    this.modeEl.style.cssText =
      'position:absolute;left:clamp(8px,2vmin,18px);top:clamp(8px,2vmin,12px);' +
      'font-size:clamp(9px,2vmin,13px);font-weight:700;letter-spacing:1px;' + CHIP_BASE;

    // Health bar — below mode badge
    this.healthTrack.style.cssText =
      'position:absolute;left:clamp(8px,2vmin,18px);top:clamp(30px,6vmin,48px);' +
      'width:clamp(90px,22vmin,160px);height:clamp(6px,1.3vmin,10px);' +
      'background:rgba(12,16,26,.6);border:1px solid rgba(255,255,255,.07);' +
      'border-radius:6px;overflow:hidden;backdrop-filter:blur(6px);';

    // Wanted stars — below health
    this.wantedEl.style.cssText =
      'position:absolute;left:clamp(8px,2vmin,18px);top:clamp(44px,8.5vmin,68px);' +
      'font-size:clamp(10px,2.2vmin,16px);letter-spacing:2px;' +
      'color:#ffd24a;text-shadow:0 1px 4px #000;';

    // Score (run-over counter) — top-centre, tiny
    this.scoreEl.style.cssText =
      'position:absolute;left:50%;top:clamp(6px,1.5vmin,10px);transform:translateX(-50%);' +
      'font-size:clamp(8px,1.8vmin,11px);font-weight:700;' + CHIP_BASE;

    // Radio — top-centre below score, very compact
    this.radioEl.style.cssText =
      'position:absolute;left:50%;top:clamp(24px,4.5vmin,38px);transform:translateX(-50%);' +
      'font-size:clamp(7px,1.5vmin,10px);max-width:40vw;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;' + CHIP_BASE;



    // Car name — hidden on mobile
    this.carEl.style.display = 'none';

    // Minimap — RIGHT side, below speed box
    this.mapCanvas.style.cssText =
      'position:absolute;right:clamp(10px,2.5vmin,18px);top:clamp(72px,14vmin,110px);' +
      'width:clamp(90px,22vmin,150px);height:clamp(90px,22vmin,150px);' +
      'border:1px solid rgba(255,255,255,.15);border-radius:8px;' +
      'background:rgba(8,10,16,.6);opacity:0.88;';
  }
}
