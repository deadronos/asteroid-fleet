// Render-only tuning constants.

/** Capacity of the tactical icon buffers (points drawn per frame). */
export const MAX_ICONS = 2048;
/** Distance within which asteroids / ships draw at full detail, per quality setting. */
export const ASTEROID_LOD = { high: 140, low: 80 };
export const FLEET_LOD = { high: 120, low: 70 };
/**
 * Default camera offset from the carrier, the initial canvas camera position and the
 * Tactical-off reset (#117). Close enough that the carrier and nearby drones read (#124).
 */
export const CAMERA_OFFSET: [number, number, number] = [26, 32, 36];
/** Far-LOD ships scale up with distance so they stay at least this many pixels long. */
export const FAR_SHIP_MIN_PX = 5;
