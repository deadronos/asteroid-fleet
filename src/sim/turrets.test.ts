import { describe, expect, it } from "vitest";
import { carrierTurrets } from "./combat";
import { HULLS, HULL_IDS, PIRATE_BASE, TURRETS } from "./config";
import { game } from "./testing";
import type { Sim } from "./types";

function pirate(s: Sim, dx: number, hull = PIRATE_BASE.hull) {
  const p = {
    id: s.nextId++,
    pos: { x: s.carrier.pos.x + dx, y: s.carrier.pos.y, z: s.carrier.pos.z },
    hull,
    maxHull: hull,
    damage: PIRATE_BASE.damage,
    speed: PIRATE_BASE.speed,
    targetId: -1,
    fireCooldown: 0,
  };
  s.pirates.push(p);
  return p;
}

describe("carrier turrets (#160)", () => {
  it("every hull has at least one turret, and the Bastion carries a heavy battery", () => {
    for (const id of HULL_IDS)
      expect(HULLS[id].turrets.length).toBeGreaterThan(0);
    expect(HULLS.bastion.turrets).toContain("heavy");
  });

  it("point-defense hits a pirate in range and ignores one out of range", () => {
    const s = game(5);
    const near = pirate(s, TURRETS.pd.range - 1);
    const far = pirate(s, TURRETS.pd.range + 5);
    carrierTurrets(s, 1);
    expect(near.hull).toBeCloseTo(PIRATE_BASE.hull - TURRETS.pd.damage);
    expect(far.hull).toBe(PIRATE_BASE.hull);
  });

  it("research scales damage and range", () => {
    const s = game(5);
    s.researchLevels.turretDamage = 2;
    s.researchLevels.turretRange = 1;
    const p = pirate(s, TURRETS.pd.range * 1.1);
    carrierTurrets(s, 1);
    expect(p.hull).toBeCloseTo(PIRATE_BASE.hull - TURRETS.pd.damage * 1.3);
  });

  it("the heavy battery picks the toughest pirate", () => {
    const s = game(5);
    s.carrier.hullClass = "bastion";
    const weak = pirate(s, TURRETS.heavy.range - 1, 10);
    const tough = pirate(s, TURRETS.heavy.range - 2, 200);
    carrierTurrets(s, 1);
    expect(tough.hull).toBeCloseTo(200 - TURRETS.heavy.damage);
    expect(weak.hull).toBe(10);
  });
});
