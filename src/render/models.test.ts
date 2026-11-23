import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bakeShipModel } from './models';

function makeShipScene(includeGlow: boolean) {
  const hullBox = new THREE.BoxGeometry(2, 2, 10).toNonIndexed();
  hullBox.translate(0, 0, 5);
  const accentBox = new THREE.BoxGeometry(1, 0.5, 2).toNonIndexed();
  accentBox.translate(0, 1.25, 4);

  const hullMat = new THREE.MeshStandardMaterial({ name: 'hull', color: '#b89c6c' });
  const accentMat = new THREE.MeshStandardMaterial({ name: 'metalRed', color: '#f0c878' });
  const glowMat = new THREE.MeshStandardMaterial({ name: 'glow', color: '#ffa046' });

  const geoms = [hullBox, accentBox];
  const mats: THREE.Material[] = [hullMat, accentMat];

  if (includeGlow) {
    const glowBox = new THREE.BoxGeometry(0.8, 0.4, 1).toNonIndexed();
    glowBox.translate(0, 0.2, 9.5);
    geoms.push(glowBox);
    mats.push(glowMat);
  }

  const merged = mergeGeometries(geoms, true);
  for (const g of geoms) g.dispose();

  const mesh = new THREE.Mesh(merged, mats);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, merged, mats };
}

describe('bakeShipModel', () => {
  it('splits glow from hull, applies HDR glow scaling, and aligns both transforms (#233)', () => {
    const { root, merged, mats } = makeShipScene(true);
    const { hull, glow } = bakeShipModel(root, '#33ccff', 5);

    expect(glow).not.toBeNull();

    // Combined Z bounds span 0..10 (length 10, center z = 5) -> scaled to length 5, centered at z = 0.
    hull.computeBoundingBox();
    glow!.computeBoundingBox();
    const hullBox = hull.boundingBox!;
    const glowBox = glow!.boundingBox!;

    expect(hullBox.min.z).toBeCloseTo(-2.5, 4);
    expect(hullBox.max.z).toBeCloseTo(2.5, 4);
    // Glow was at z = 9..10 before transform -> centered (4..5) -> scaled 0.5x (2.0..2.5).
    expect(glowBox.min.z).toBeCloseTo(2.0, 4);
    expect(glowBox.max.z).toBeCloseTo(2.5, 4);
    expect(glowBox.min.y).toBeGreaterThan(hullBox.min.y);
    expect(glowBox.max.y).toBeLessThan(hullBox.max.y);

    // Glow vertex colours are multiplied by 3 for HDR bloom.
    const glowColors = glow!.getAttribute('color') as THREE.BufferAttribute;
    expect(glowColors.getX(0)).toBeGreaterThan(1.5);

    // Accent slot was recoloured to '#33ccff' inside hull vertex colours.
    const hullColors = hull.getAttribute('color') as THREE.BufferAttribute;
    const expectedAccent = new THREE.Color('#33ccff');
    const lastIdx = hullColors.count - 1;
    expect(hullColors.getX(lastIdx)).toBeCloseTo(expectedAccent.r, 4);
    expect(hullColors.getY(lastIdx)).toBeCloseTo(expectedAccent.g, 4);
    expect(hullColors.getZ(lastIdx)).toBeCloseTo(expectedAccent.b, 4);

    hull.dispose();
    glow!.dispose();
    merged.dispose();
    for (const m of mats) m.dispose();
  });

  it('returns null glow when the scene has no glow slot', () => {
    const { root, merged, mats } = makeShipScene(false);
    const { hull, glow } = bakeShipModel(root, '#33ccff', 4);

    expect(glow).toBeNull();
    hull.computeBoundingBox();
    expect(hull.boundingBox!.max.z - hull.boundingBox!.min.z).toBeCloseTo(4, 4);

    hull.dispose();
    merged.dispose();
    for (const m of mats) m.dispose();
  });
});
