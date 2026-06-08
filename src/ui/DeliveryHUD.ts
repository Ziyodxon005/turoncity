/**
 * DeliveryHUD.ts — DOM overlay panel for the food delivery game mode.
 *
 * Shows:
 *   - 💰 Total coins earned
 *   - Current order status (pickup / carrying / completed)
 *   - Distance to target
 *   - Countdown timer (while carrying)
 *   - Big "ORDER FAILED!" flash (on timeout)
 *   - "DELIVERED! +$N" flash (on dropoff)
 */

import type { DeliveryState } from '../systems/Delivery';

const CHIP =
    'padding:clamp(4px,1vmin,8px) clamp(6px,1.5vmin,14px);' +
    'background:rgba(10,14,28,.65);border:1px solid rgba(255,255,255,.08);' +
    'border-radius:8px;backdrop-filter:blur(8px);font-family:ui-monospace,Menlo,Consolas,monospace;' +
    'text-shadow:0 1px 3px #000;color:#e8ecf5;pointer-events:none;';

export class DeliveryHUD {
    private readonly root: HTMLElement;
    private readonly coinsEl: HTMLElement;
    private readonly phaseEl: HTMLElement;
    private readonly distEl: HTMLElement;
    private readonly timerEl: HTMLElement;
    private readonly flashEl: HTMLElement;
    private flashTimer = 0;

    constructor(container: HTMLElement) {
        this.root = document.createElement('div');
        this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
        container.appendChild(this.root);

        // ── Delivery panel (left side, below mode indicator) ──────────────────
        const panel = document.createElement('div');
        panel.style.cssText =
            'position:absolute;left:clamp(10px,2vmin,20px);top:clamp(82px,15vmin,120px);' +
            'display:flex;flex-direction:column;gap:clamp(3px,1vmin,6px);';
        this.root.appendChild(panel);

        // Coin counter
        this.coinsEl = document.createElement('div');
        this.coinsEl.style.cssText = CHIP + 'font-size:clamp(10px,2.5vmin,16px);font-weight:700;color:#ffd24a;';
        this.coinsEl.textContent = '💰 $0';
        panel.appendChild(this.coinsEl);

        // Order phase
        this.phaseEl = document.createElement('div');
        this.phaseEl.style.cssText = CHIP + 'font-size:clamp(9px,2vmin,13px);';
        this.phaseEl.textContent = '';
        panel.appendChild(this.phaseEl);

        // Distance
        this.distEl = document.createElement('div');
        this.distEl.style.cssText = CHIP + 'font-size:clamp(8px,1.8vmin,12px);opacity:.8;';
        this.distEl.textContent = '';
        panel.appendChild(this.distEl);

        // Timer
        this.timerEl = document.createElement('div');
        this.timerEl.style.cssText = CHIP + 'font-size:clamp(10px,2.3vmin,15px);font-weight:700;display:none;';
        this.timerEl.textContent = '';
        panel.appendChild(this.timerEl);

        // ── Flash message (centre screen) ─────────────────────────────────────
        const flashStyle = document.createElement('style');
        flashStyle.textContent = `
      @keyframes deliveryFlash {
        0%   { opacity:0; transform:translateX(-50%) scale(.6); }
        15%  { opacity:1; transform:translateX(-50%) scale(1.08); }
        70%  { opacity:1; transform:translateX(-50%) scale(1); }
        100% { opacity:0; transform:translateX(-50%) scale(.9); }
      }
    `;
        this.root.appendChild(flashStyle);

        this.flashEl = document.createElement('div');
        this.flashEl.style.cssText =
            'position:absolute;left:50%;top:30%;transform:translateX(-50%);' +
            'font-size:5vw;font-weight:800;letter-spacing:4px;' +
            'font-family:Georgia,"Times New Roman",serif;' +
            'text-shadow:0 4px 24px #000;pointer-events:none;display:none;';
        this.root.appendChild(this.flashEl);
    }

    /**
     * Call every render frame.
     * @param state   current delivery state
     * @param dist    metres to current target
     * @param dt      frame delta-time in seconds
     */
    update(state: DeliveryState, dist: number, dt: number): void {
        // Tangalar
        this.coinsEl.textContent = `💰 $${state.totalCoins}`;

        // Buyurtma bosqichi
        if (state.phase === 'pickup') {
            this.phaseEl.textContent = '🍕 Restoranga boring';
            this.phaseEl.style.color = '#ffd24a';
        } else if (state.phase === 'carrying') {
            this.phaseEl.textContent = '🏠 Buyurtmani yetkazing!';
            this.phaseEl.style.color = '#3ad17a';
        } else {
            this.phaseEl.textContent = '';
        }

        // Masofa
        if (dist < Infinity && dist > INTERACT_HIDE_DIST) {
            this.distEl.textContent = `📍 ${Math.round(dist)} m uzoqda`;
        } else if (dist <= INTERACT_HIDE_DIST) {
            this.distEl.textContent = '✅ F tugmasini bosing';
        } else {
            this.distEl.textContent = '';
        }

        // Taymer
        if (state.phase === 'carrying' && state.timeLimit > 0) {
            const left = Math.ceil(state.timeLeft);
            const urgent = left <= 20;
            this.timerEl.textContent = `⏱ ${fmtTime(left)}`;
            this.timerEl.style.display = '';
            this.timerEl.style.color = urgent ? '#ff4a4a' : '#e8ecf5';
            this.timerEl.style.animation = urgent ? 'wantedFlash .4s steps(2) infinite' : 'none';
        } else {
            this.timerEl.style.display = 'none';
            this.timerEl.style.animation = 'none';
        }

        // Flash hisoblagich
        if (this.flashTimer > 0) {
            this.flashTimer -= dt;
            if (this.flashTimer <= 0) this.flashEl.style.display = 'none';
        }
    }

    /** Muvaffaqiyatli yetkazib berish. */
    showDelivered(coins: number): void {
        this._flash(`✅ YETKAZILDI! +$${coins}`, '#3ad17a');
    }

    /** Buyurtma olindi. */
    showPickedUp(): void {
        this._flash('📦 BUYURTMA OLINDI!', '#ffd24a');
    }

    /** Vaqt tugadi. */
    showFailed(): void {
        this._flash('❌ BUYURTMA BAJARILMADI!', '#ff4a4a');
    }

    private _flash(text: string, color: string): void {
        this.flashEl.textContent = text;
        this.flashEl.style.color = color;
        this.flashEl.style.display = 'block';
        this.flashEl.style.animation = 'none';
        // Force reflow to restart animation
        void (this.flashEl as HTMLElement).offsetWidth;
        this.flashEl.style.animation = 'deliveryFlash 2.2s ease-out forwards';
        this.flashTimer = 2.2;
    }

    destroy(): void {
        this.root.remove();
    }
}

const INTERACT_HIDE_DIST = 8; // metres — show "Press F" instead of distance

function fmtTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
