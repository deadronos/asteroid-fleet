/** Shared non-ship colours and tactical icon shapes (#136, #125). Ship colours live in SHIP_STATS. */
export const PALETTE = {
  pirate: '#ff3b3b',
  carrier: '#ffffff',
  container: '#f2b632',
  hazard: '#ff5a1f',
  vein: '#5affef',
  tier: { 1: '#6fc8ff', 2: '#ffc861', 3: '#ff6b7a' },
  undiscovered: '#35425a',
} as const;

/** Tactical icon shapes. The index is the `shape` attribute read by the point shader. */
export const SHAPES = ['circle', 'triangle', 'diamond', 'cross', 'square', 'down'] as const;
export type Shape = (typeof SHAPES)[number];

/** Shape per entity kind, so colour is never the only cue (#125). */
export const ICON_SHAPE: Record<string, Shape> = {
  drone: 'circle',
  barge: 'circle',
  harvester: 'circle',
  hauler: 'square',
  repair: 'square',
  fighter: 'triangle',
  scout: 'circle',
  pirate: 'down',
  carrier: 'diamond',
  container: 'square',
  hazard: 'cross',
  vein: 'circle',
};
