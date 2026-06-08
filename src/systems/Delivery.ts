/**
 * Delivery.ts — Pure delivery game logic (Three.js-free, unit-testable).
 *
 * State machine:
 *   idle → pickup (go to restaurant) → carrying (go to customer) → idle
 *
 * The render layer polls `state`, `restaurant`, `customer`, and `reward`
 * to position markers and display HUD info. `main.ts` calls `tryPickup` / `tryDropoff`
 * when the player presses F near the relevant marker.
 */

import type { Rng } from '../core/rng';

export type DeliveryPhase = 'idle' | 'pickup' | 'carrying';

export interface OrderPoint {
  x: number;
  z: number;
  label: string;
}

export interface DeliveryState {
  phase: DeliveryPhase;
  restaurant: OrderPoint;
  customer: OrderPoint | null;
  reward: number;         // coins for this order
  totalCoins: number;     // lifetime earnings
  ordersCompleted: number;
  timeLimit: number;      // seconds allowed to deliver (0 = no limit)
  timeLeft: number;       // seconds remaining (counts down while carrying)
  failed: boolean;        // true for one frame when time runs out
}

const INTERACT_RADIUS = 6;   // metres — same as ENTER_DISTANCE in main
const MIN_REWARD = 50;
const MAX_REWARD = 200;
const BASE_TIME = 90;        // seconds to deliver before time penalty
const TIME_PER_METRE = 0.08; // extra seconds per metre of travel distance

/** Pick a random road-aligned point from the city's grid. */
function randomRoadPoint(rng: Rng, roadCenters: readonly number[], label: string): OrderPoint {
  const rc = roadCenters;
  const ix = Math.floor(rng.next() * rc.length);
  const iz = Math.floor(rng.next() * rc.length);
  return { x: rc[ix], z: rc[iz], label };
}

export class DeliverySystem {
  private readonly rng: Rng;
  private readonly hq: { x: number; z: number };
  readonly state: DeliveryState;

  constructor(rng: Rng, roadCenters: readonly number[], hqPoint?: { x: number; z: number }) {
    this.rng = rng;
    this.hq = hqPoint ?? randomRoadPoint(rng, roadCenters, '🏢 TURON HQ');
    const restaurant: OrderPoint = { x: this.hq.x, z: this.hq.z, label: '🏢 TURON HQ' };
    this.state = {
      phase: 'pickup',
      restaurant,
      customer: null,
      reward: 0,
      totalCoins: 0,
      ordersCompleted: 0,
      timeLimit: 0,
      timeLeft: 0,
      failed: false,
    };
  }

  /**
   * Call each frame with delta-time (seconds).
   * Returns true if the order timed out this frame.
   */
  update(dt: number): boolean {
    this.state.failed = false;
    if (this.state.phase === 'carrying' && this.state.timeLimit > 0) {
      this.state.timeLeft -= dt;
      if (this.state.timeLeft <= 0) {
        this.state.timeLeft = 0;
        this.state.failed = true;
        this._nextOrder(); // restart with a new order
        return true;
      }
    }
    return false;
  }

  /**
   * Player pressed F near the restaurant while in pickup phase.
   * Returns true if pickup was accepted.
   */
  tryPickup(px: number, pz: number, roadCenters: readonly number[]): boolean {
    if (this.state.phase !== 'pickup') return false;
    const { restaurant } = this.state;
    if (!this._near(px, pz, restaurant.x, restaurant.z)) return false;

    // Generate customer location — make sure it's not the same road intersection.
    let customer: OrderPoint;
    let attempts = 0;
    do {
      customer = randomRoadPoint(this.rng, roadCenters, '🏠 Mijoz');
      attempts++;
    } while (attempts < 10 && this._near(customer.x, customer.z, restaurant.x, restaurant.z));

    const dist = Math.hypot(customer.x - restaurant.x, customer.z - restaurant.z);
    const reward = MIN_REWARD + Math.floor(this.rng.next() * (MAX_REWARD - MIN_REWARD));
    const timeLimit = Math.round(BASE_TIME + dist * TIME_PER_METRE);

    this.state.customer = customer;
    this.state.reward = reward;
    this.state.timeLimit = timeLimit;
    this.state.timeLeft = timeLimit;
    this.state.phase = 'carrying';
    return true;
  }

  /**
   * Player pressed F near the customer while carrying.
   * Returns the coins earned (>0) or 0 if not close enough / wrong phase.
   */
  tryDropoff(px: number, pz: number, roadCenters: readonly number[]): number {
    if (this.state.phase !== 'carrying' || !this.state.customer) return 0;
    if (!this._near(px, pz, this.state.customer.x, this.state.customer.z)) return 0;

    const earned = this.state.reward;
    this.state.totalCoins += earned;
    this.state.ordersCompleted++;
    this._nextOrder(roadCenters);
    return earned;
  }

  private _nextOrder(_roadCenters?: readonly number[]): void {
    // Har doim TURON HQ ga qaytib kelish - yig'im nuqtasi.
    this.state.restaurant = { x: this.hq.x, z: this.hq.z, label: '🏢 TURON HQ' };
    this.state.customer = null;
    this.state.reward = 0;
    this.state.timeLimit = 0;
    this.state.timeLeft = 0;
    this.state.phase = 'pickup';
  }

  private _near(ax: number, az: number, bx: number, bz: number): boolean {
    return Math.hypot(ax - bx, az - bz) <= INTERACT_RADIUS;
  }

  /** How far the player is from the current target (restaurant or customer). */
  distanceToTarget(px: number, pz: number): number {
    const target =
      this.state.phase === 'pickup'
        ? this.state.restaurant
        : this.state.customer;
    if (!target) return Infinity;
    return Math.hypot(px - target.x, pz - target.z);
  }
}
