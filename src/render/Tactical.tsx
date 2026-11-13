import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engine, lerpCarrier } from '../game/engine';
import { COVER_RADIUS, SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES, type Vec3 } from '../sim/types';
import { ICON_SHAPE, PALETTE, SHAPES } from '../ui/palette';
import { MAX_ICONS } from './constants';
import { CLASSES, asteroidById, fleetFrame } from './frameState';

export const ICON_COLORS: Record<string, THREE.Color> = {
  ...Object.fromEntries(
    SHIP_CLASSES.map((c) => [c, new THREE.Color(SHIP_STATS[c].color).multiplyScalar(1.6)]),
  ),
  pirate: new THREE.Color(PALETTE.pirate).multiplyScalar(2),
  carrier: new THREE.Color(PALETTE.carrier).multiplyScalar(2),
  container: new THREE.Color(PALETTE.container).multiplyScalar(2),
  hazard: new THREE.Color(PALETTE.hazard).multiplyScalar(2),
  vein: new THREE.Color(PALETTE.vein).multiplyScalar(2.2),
};

/** Icon colour and shape per render class index, in `CLASSES` order. */
const CLASS_ICON = CLASSES.map((c) => ICON_COLORS[c]);
const CLASS_SHAPE = CLASSES.map((c) => SHAPES.indexOf(ICON_SHAPE[c]));
const shapeOf = (k: string) => SHAPES.indexOf(ICON_SHAPE[k]);

function icon(
  pos: THREE.BufferAttribute,
  col: THREE.BufferAttribute,
  shp: THREE.BufferAttribute,
  n: number,
  p: Vec3,
  kind: string,
): number {
  const c = ICON_COLORS[kind];
  pos.setXYZ(n, p.x, p.y, p.z);
  col.setXYZ(n, c.r, c.g, c.b);
  shp.setX(n, shapeOf(kind));
  return n + 1;
}

const ICON_VERT = /* glsl */ `
uniform float uPx;
attribute vec3 color;
attribute float shape;
varying vec3 vColor;
varying float vShape;
void main() {
  vColor = color;
  vShape = shape;
  gl_PointSize = 11.0 * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Shapes in SHAPES order: circle, triangle, diamond, cross, square, down-triangle.
const ICON_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vShape;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0;
  float r = length(p), a = abs(p.x), b = abs(p.y), s = vShape;
  float t = s > 4.5 ? 0.9 - p.y : p.y + 0.9;
  bool k = s < 0.5 ? r < 0.9
    : s < 1.5 || s > 4.5 && s < 5.5 ? a < t * 0.5 && abs(p.y) < 0.9
    : s < 2.5 ? a + b < 1.0
    : s < 3.5 ? abs(a - b) < 0.28
    : a < 0.75 && b < 0.75;
  if (!k) discard;
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}`;

const carrierAt: Vec3 = { x: 0, y: 0, z: 0 };

/** Tactical overlay: shape-coded ship/hazard/vein icons, cover rings, and reference grid. */
export function Tactical({ on }: { on: boolean }) {
  const dpr = useThree((st) => st.viewport.dpr);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_ICONS * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_ICONS * 3), 3));
    g.setAttribute('shape', new THREE.BufferAttribute(new Float32Array(MAX_ICONS), 1));
    return g;
  }, []);
  const ring = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!on) return;
    const s = engine.view;
    const f = fleetFrame;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const shp = geo.getAttribute('shape') as THREE.BufferAttribute;
    lerpCarrier(engine.alpha(), carrierAt);
    let n = icon(pos, col, shp, 0, carrierAt, 'carrier');
    for (let i = 0; i < f.count && n < MAX_ICONS; i++) {
      const c = CLASS_ICON[f.cls[i]];
      pos.setXYZ(n, f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]);
      shp.setX(n, CLASS_SHAPE[f.cls[i]]);
      col.setXYZ(n++, c.r, c.g, c.b);
    }
    for (const c of s.containers) if (n < MAX_ICONS) n = icon(pos, col, shp, n, c.pos, 'container');
    // Scout reconnaissance: charted hazards and rich veins.
    for (const i of s.recon.hazards) {
      const h = s.hazards[i];
      if (h && n < MAX_ICONS) n = icon(pos, col, shp, n, h.pos, 'hazard');
    }
    const rocks = asteroidById(s.asteroids);
    for (const id of s.recon.veins) {
      const v = rocks.get(id);
      if (v && v.ore > 0 && n < MAX_ICONS) n = icon(pos, col, shp, n, v.pos, 'vein');
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    shp.needsUpdate = true;
    ring.current?.position.set(carrierAt.x, carrierAt.y, carrierAt.z);
  });
  if (!on) return null;
  return (
    <>
      <points geometry={geo} frustumCulled={false}>
        <shaderMaterial
          vertexShader={ICON_VERT}
          fragmentShader={ICON_FRAG}
          uniforms={{ uPx: { value: dpr } }}
        />
      </points>
      <group ref={ring}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[COVER_RADIUS - 0.4, COVER_RADIUS, 96]} />
          <meshBasicMaterial color="#5ab4ff" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[44.6, 45, 96]} />
          <meshBasicMaterial color="#5ab4ff" transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <gridHelper args={[400, 40, '#1d3a5c', '#10243a']} position={[0, -12, 0]} />
    </>
  );
}
