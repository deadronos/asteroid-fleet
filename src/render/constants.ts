// Render-only tuning constants.

/** Capacity of the tactical icon buffers (points drawn per frame). */
export const MAX_ICONS = 2048;
/** Distance within which asteroids / ships draw at full detail, per quality setting. */
export const ASTEROID_LOD = { high: 140, low: 80 };
export const FLEET_LOD = { high: 120, low: 70 };
/** Default camera offset from the carrier, and the initial canvas camera position. */
export const CAMERA_OFFSET: [number, number, number] = [40, 28, 55];
