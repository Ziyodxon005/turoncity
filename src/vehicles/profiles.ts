import { DEFAULT_VEHICLE, type VehicleConfig } from './VehicleModel';

/**
 * Hand-tuned car makes/models (NOT procedurally generated — we tune these by
 * feel). A profile is the physics config (the 12 VehicleModel fields) plus
 * identity (manufacturer + model + class) and the body silhouette it drives.
 * `stepVehicle` already takes a config, so the car you're driving just steps
 * with ITS profile — carjack a truck and it's a sluggish barge; a sports car is
 * nimble. GTA-style names so we can talk about them. One source of truth here.
 */
export type VehicleClass =
  | 'sedan'
  | 'compact'
  | 'sports'
  | 'super'
  | 'muscle'
  | 'truck'
  | 'van'
  | 'interceptor';

export interface CarProfile extends VehicleConfig {
  id: string;
  manufacturer: string;
  model: string;
  class: VehicleClass;
  shapeId: string; // a CAR_SHAPES id (the body silhouette)
  mass: number; // kg — drives mass-weighted car-vs-car collision (heavy shoves light)
  radius: number; // collision circle radius (m) — varies by body size
}

/** Spread the baseline sedan config, override the fields that give a model its feel. */
const tune = (over: Partial<VehicleConfig>): VehicleConfig => ({ ...DEFAULT_VEHICLE, ...over });

/** Ko'chalarda uchraydigan yetti xil fuqarolik mashinasi. */
export const PROFILES: CarProfile[] = [
  {
    id: 'gm-nexia', manufacturer: 'GM', model: 'Nexia', class: 'sedan', shapeId: 'sedan', mass: 1400, radius: 1.9,
    ...tune({}), // muvozanatli asosiy model
  },
  {
    id: 'gm-damas', manufacturer: 'GM', model: 'Damas', class: 'compact', shapeId: 'compact', mass: 1000, radius: 1.6,
    ...tune({ enginePower: 12, maxSpeed: 78, turnRate: 3.1, gripNormal: 11 }), // chaqqon, past tezlik chegarasi
  },
  {
    id: 'gm-lacetti', manufacturer: 'GM', model: 'Lacetti', class: 'sports', shapeId: 'sports', mass: 1200, radius: 1.75,
    ...tune({ enginePower: 16, maxSpeed: 102, turnRate: 3.1, gripNormal: 12, gripSpeed: 11 }),
  },
  {
    id: 'gm-cobalt', manufacturer: 'GM', model: 'Cobalt', class: 'super', shapeId: 'sports', mass: 1300, radius: 1.75,
    ...tune({ enginePower: 19, brakePower: 40, maxSpeed: 118, turnRate: 3.0, gripNormal: 12.5, gripSpeed: 12 }),
  },
  {
    id: 'gm-malibu', manufacturer: 'GM', model: 'Malibu', class: 'muscle', shapeId: 'sedan', mass: 1650, radius: 2.0,
    ...tune({ enginePower: 17, maxSpeed: 99, turnRate: 2.4, gripNormal: 8, gripHandbrake: 0.6 }), // kuchli, dum siljishi
  },
  {
    id: 'gm-spark', manufacturer: 'GM', model: 'Spark', class: 'van', shapeId: 'van', mass: 2400, radius: 2.2,
    ...tune({ enginePower: 10, maxSpeed: 74, turnRate: 2.1, gripNormal: 8 }),
  },
  {
    id: 'isuzu-tracker', manufacturer: 'Isuzu', model: 'Tracker', class: 'truck', shapeId: 'pickup', mass: 4500, radius: 2.5,
    ...tune({ enginePower: 8, brakePower: 26, maxSpeed: 62, turnRate: 1.9, gripNormal: 7, gripSpeed: 12 }),
  },
];

/** Militsiya mashinasi — tez va barqaror, patruldagi yoki o'g'irlab olingan rul ostida harakatlanadi. */
export const INTERCEPTOR: CarProfile = {
  id: 'gm-captiva', manufacturer: 'GM', model: 'Captiva', class: 'interceptor', shapeId: 'sports', mass: 1700, radius: 1.85,
  ...tune({ enginePower: 15, maxSpeed: 94, turnRate: 2.9, gripNormal: 11 }),
};

/** The car you spawn in. */
export const PLAYER_PROFILE: CarProfile = PROFILES[0];
