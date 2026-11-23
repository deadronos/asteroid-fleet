// Command facade. Player orders, run resets and offline settlement live in
// focused modules; this barrel keeps every existing import path stable (#250).

export { apply, order } from './orders';
export type { Command, Order } from './orders';
export { admiralty, prestige, startChallenge } from './reset';
export { settleOffline } from './offline';
export type { OfflineReport } from './offline';
export { RETROFIT_COST, marksPayout, researchPayout, shipCost } from './costs';
