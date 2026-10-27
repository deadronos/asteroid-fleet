import { describe, expect, it } from 'vitest';
import { order, shipCost } from './actions';
import { AUTOMATION_INTERVAL, automation, rebuildQueueCap } from './automation';
import { destroyShip } from './ctx';
import { ZONE_RULE_UNLOCKS } from './config';
import { buyResearch } from './research';
import { stepSim } from './tick';
import type { Sim, ShipClass } from './types';
import { stateOf } from './state';
import { game } from './testing';

const pass = (s: Sim) => automation(s, AUTOMATION_INTERVAL);
const count = (s: Sim, cls: ShipClass, hangarId?: number) =>
  s.ships.filter((x) => x.cls === cls && (hangarId === undefined || x.hangarId === hangarId))
    .length;
const lose = (s: Sim, cls: ShipClass) => {
  const ship = s.ships.find((x) => x.cls === cls)!;
  s.ships = s.ships.filter((x) => x !== ship);
  destroyShip(s, ship, 'destroyed');
  return ship;
};

const setup = () => {
  const s = game(3);
  s.researchLevels.autoRebuild = 1;
  s.researchLevels.autoBuy = 1;
  expect(order(s, { type: 'setAutomation', patch: { autoBuy: true } })).toBeNull();
  order(s, { type: 'setHangarTarget', hangarId: 2, cls: 'hauler', count: 2 });
  return s;
};

const make = () => {
  const s = game(9);
  s.researchLevels.autoRebuild = 1;
  s.researchLevels.autoBuy = 1;
  order(s, { type: 'setAutomation', patch: { autoBuy: true, autoRebuild: true } });
  order(s, { type: 'setHangarTarget', hangarId: 1, cls: 'drone', count: 6 });
  for (let i = 0; i < 1200; i++) stepSim(s);
  return JSON.stringify({ ...stateOf(s), savedAt: 0 });
};

describe('auto-buy', () => {
  it('is locked until researched', () => {
    const s = game(3);
    expect(order(s, { type: 'setAutomation', patch: { autoBuy: true } })).not.toBeNull();
    expect(s.automation.autoBuy).toBe(false);
  });

  it('buys toward the hangar target into that hangar', () => {
    const s = setup();
    s.credits = 1e5;
    for (let i = 0; i < 5; i++) pass(s);
    expect(count(s, 'hauler', 2)).toBe(2);
  });

  it('never spends below the credit floor', () => {
    const s = setup();
    const cost = shipCost(s, 'hauler');
    order(s, { type: 'setAutomation', patch: { creditFloor: 1000 } });
    s.credits = 1000 + cost - 1;
    pass(s);
    expect(count(s, 'hauler')).toBe(0);
    s.credits = 1000 + cost;
    pass(s);
    expect(count(s, 'hauler')).toBe(1);
    expect(s.credits).toBeGreaterThanOrEqual(1000);
    pass(s);
    expect(s.credits).toBeGreaterThanOrEqual(1000);
  });

  it('stays off when disabled', () => {
    const s = setup();
    order(s, { type: 'setAutomation', patch: { autoBuy: false } });
    s.credits = 1e5;
    pass(s);
    expect(count(s, 'hauler')).toBe(0);
  });
});

describe('auto-rebuild', () => {
  it('pays to rebuild a lost ship of any class into its hangar', () => {
    const s = game(3);
    buyResearchFree(s, 'autoRebuild');
    order(s, { type: 'setAutomation', patch: { autoRebuild: true } });
    s.credits = 1e5;
    order(s, { type: 'buyShip', cls: 'barge', hangarId: 2 });
    lose(s, 'barge');
    const before = s.credits;
    const cost = shipCost(s, 'barge');
    pass(s);
    expect(count(s, 'barge', 2)).toBe(1);
    expect(before - s.credits).toBe(cost);
    expect(s.automation.rebuildQueue).toHaveLength(0);
  });

  it('waits above the credit floor, then rebuilds', () => {
    const s = game(3);
    buyResearchFree(s, 'autoRebuild');
    order(s, { type: 'setAutomation', patch: { autoRebuild: true, creditFloor: 500 } });
    lose(s, 'drone');
    s.credits = 500;
    pass(s);
    expect(count(s, 'drone')).toBe(3);
    s.credits = 5000;
    pass(s);
    expect(count(s, 'drone')).toBe(4);
  });

  it('does not queue losses while the toggle is off', () => {
    const s = game(3);
    buyResearchFree(s, 'autoRebuild');
    lose(s, 'drone');
    expect(s.automation.rebuildQueue).toHaveLength(0);
  });

  it('clears the queue when switched off and caps it at hangar capacity', () => {
    const s = game(3);
    buyResearchFree(s, 'autoRebuild');
    order(s, { type: 'setAutomation', patch: { autoRebuild: true } });
    const cap = rebuildQueueCap(s);
    for (let i = 0; i < cap + 20; i++) {
      s.automation.rebuildQueue.push({ cls: 'drone', hangarId: 1 });
    }
    pass(s);
    expect(s.automation.rebuildQueue.length).toBeLessThanOrEqual(cap);
    lose(s, 'drone');
    expect(s.automation.rebuildQueue.length).toBeLessThanOrEqual(cap);
    order(s, { type: 'setAutomation', patch: { autoRebuild: false } });
    expect(s.automation.rebuildQueue).toHaveLength(0);
  });

  it('does not queue losses before the research', () => {
    const s = game(3);
    lose(s, 'drone');
    expect(s.automation.rebuildQueue).toHaveLength(0);
  });
});

describe('research unlocks', () => {
  it('tactical doctrine unlocks frontier rules and engagement stances', () => {
    const s = game(3);
    expect(
      order(s, { type: 'setStance', scope: 'fleet', patch: { engagement: 'aggressive' } }),
    ).not.toBeNull();
    s.research = 10;
    expect(buyResearch(s, 'tactics')).toBe(true);
    for (const id of ZONE_RULE_UNLOCKS[2]) expect(s.unlockedRules).toContain(id);
    expect(
      order(s, { type: 'setStance', scope: 'fleet', patch: { engagement: 'aggressive' } }),
    ).toBeNull();
  });
});

describe('automation determinism', () => {
  it('runs the same for the same seed', () => {
    expect(make()).toEqual(make());
  });
});

function buyResearchFree(s: Sim, id: string) {
  s.research += 100;
  expect(buyResearch(s, id)).toBe(true);
}

describe('alert orders (#79)', () => {
  it('sets and clears fleet and carrier alert modes', () => {
    const s = game(3);
    expect(
      order(s, { type: 'setAlert', scope: 'fleet', kind: 'Warped', mode: 'pause' }),
    ).toBeNull();
    expect(s.alerts.fleet.Warped).toBe('pause');
    expect(order(s, { type: 'setAlert', scope: 0, kind: 'Warped', mode: 'off' })).toBeNull();
    expect(s.alerts.byCarrier[0]).toEqual({ Warped: 'off' });
    order(s, { type: 'setAlert', scope: 0, kind: 'Warped', mode: null });
    expect(s.alerts.byCarrier[0]).toBeUndefined();
    order(s, { type: 'setAlert', scope: 'fleet', kind: 'Warped', mode: null });
    expect(s.alerts.fleet.Warped).toBeUndefined();
    expect(
      order(s, { type: 'setAlert', scope: 'fleet', kind: 'Legacy', mode: 'toast' }),
    ).not.toBeNull();
  });
});
