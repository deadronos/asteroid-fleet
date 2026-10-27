import { Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Suspense,
  lazy,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import { CameraRig } from './CameraRig';
import { easeFactor, focus, isDoubleMiss, shortestArc } from './focus';
import { engine, lerpCarrier } from '../game/engine';
import { OTHER_ROW } from '../game/snapshot';
import { COVER_RADIUS, H2_STORM_RADIUS, SHIP_STATS, WARP_CHARGE } from '../sim/config';
import { gasGiantPos } from '../sim/state';
import { SHIP_CLASSES, type Vec3 } from '../sim/types';
import { AsteroidField } from './AsteroidField';
import { Containers } from './Containers';
import { Fleet } from './Fleet';
import { CLASSES, FleetPass, MAX_ENTITIES, asteroidById, fleetFrame } from './frameState';
import { GAS_FRAG, GAS_VERT, NEBULA_FRAG, NEBULA_VERT } from './geometry';
import { FrameCap, RenderStats } from './RenderLoop';
import { ICON_SHAPE, PALETTE, SHAPES } from '../ui/palette';

const Effects = lazy(() => import('./Effects'));

const dummy = new THREE.Object3D();
/** Re-renders only when the system changes, not on every 5 Hz UI tick. */
function useSystemId(): number {
  return useSyncExternalStore(engine.subscribe, () => engine.view.systemId);
}

export interface ViewOptions {
  tactical: boolean;
  quality: 'high' | 'low';
  bloom: boolean;
  /** Frame-rate cap applied in low quality; 0 is uncapped. */
  fpsCap: number;
  onAutoTactical: (on: boolean) => void;
}

const MAX_SEG = 1024;
const BEAM_COLORS: Record<string, THREE.Color> = {
  mine: new THREE.Color('#7fe7ff').multiplyScalar(2.2),
  laser: new THREE.Color('#ff8fa0').multiplyScalar(3),
  pirateLaser: new THREE.Color('#ff3020').multiplyScalar(3),
  repair: new THREE.Color('#5affb4').multiplyScalar(2.5),
};

const EXPLOSION_COLOR = new THREE.Color('#ffaa55').multiplyScalar(3);
const BAY_COLOR = new THREE.Color('#ffd27a').multiplyScalar(3);
const ENGINE_COLOR = new THREE.Color('#58b8ff').multiplyScalar(5);
const WARP_RING_COLOR = new THREE.Color('#9b7bff').multiplyScalar(4);
/** How fast the hull turns toward its heading, per second (see `easeFactor`). */
const TURN_RATE = 0.8;

function pushSeg(
  pos: THREE.BufferAttribute,
  col: THREE.BufferAttribute,
  n: number,
  px: number,
  py: number,
  pz: number,
  q: Vec3,
  c: THREE.Color,
) {
  pos.setXYZ(n * 2, px, py, pz);
  pos.setXYZ(n * 2 + 1, q.x, q.y, q.z);
  col.setXYZ(n * 2, c.r, c.g, c.b);
  col.setXYZ(n * 2 + 1, c.r * 0.3, c.g * 0.3, c.b * 0.3);
}

function Beams() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3));
    return g;
  }, []);
  useFrame(() => {
    const s = engine.view;
    const f = fleetFrame;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    const rocks = asteroidById(s.asteroids);
    for (let k = 0; k < s.ships.length && k < MAX_ENTITIES && n < MAX_SEG; k++) {
      const sh = s.ships[k];
      if (sh.mode !== 'mining') continue;
      const r = rocks.get(sh.targetId);
      const i = f.shipEntity[k];
      if (!r || i < 0) continue;
      pushSeg(
        pos,
        col,
        n++,
        f.pos[i * 3],
        f.pos[i * 3 + 1],
        f.pos[i * 3 + 2],
        r.pos,
        BEAM_COLORS.mine,
      );
    }
    for (const fx of s.fx) {
      if (n >= MAX_SEG) break;
      const c = BEAM_COLORS[fx.kind];
      if (c) pushSeg(pos, col, n++, fx.a.x, fx.a.y, fx.a.z, fx.b, c);
    }
    geo.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial vertexColors toneMapped={false} transparent opacity={0.9} />
    </lineSegments>
  );
}

function Explosions() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    for (const f of engine.view.fx) {
      if (f.kind !== 'explosion' && f.kind !== 'warp') continue;
      const life = f.kind === 'warp' ? 1.5 : 0.8;
      const k = 1 - f.ttl / life;
      dummy.position.set(f.a.x, f.a.y, f.a.z);
      dummy.scale.setScalar((f.kind === 'warp' ? 18 : 3) * Math.sin(k * Math.PI) + 0.01);
      dummy.updateMatrix();
      m.setMatrixAt(n++, dummy.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 128]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color={EXPLOSION_COLOR} toneMapped={false} transparent opacity={0.8} />
    </instancedMesh>
  );
}

const HULL_COLOR = '#9aa7b8';
const OTHER_HULL_COLOR = '#b8a08f';

function CarrierHull({ hull = HULL_COLOR }: { hull?: string }) {
  return (
    <>
      <mesh>
        <boxGeometry args={[5, 2.6, 20]} />
        <meshStandardMaterial color={hull} metalness={0.6} roughness={0.4} flatShading />
      </mesh>
      <mesh position={[0, 1.2, 4]}>
        <boxGeometry args={[7.5, 1, 9]} />
        <meshStandardMaterial color="#7d8a9c" metalness={0.6} roughness={0.5} flatShading />
      </mesh>
      <mesh position={[0, 3, -5]}>
        <boxGeometry args={[1.8, 3, 3]} />
        <meshStandardMaterial color="#b9c3cf" metalness={0.5} roughness={0.4} flatShading />
      </mesh>
      {[-3.4, 3.4].map((x) => (
        <mesh key={x} position={[x, -0.4, 1]}>
          <boxGeometry args={[1.8, 2, 13]} />
          <meshStandardMaterial color="#6b7788" metalness={0.6} roughness={0.5} flatShading />
        </mesh>
      ))}
      {[-3.4, 3.4].map((x) => (
        <mesh key={'bay' + x} position={[x, -0.4, 7.6]}>
          <boxGeometry args={[1.2, 1.2, 0.2]} />
          <meshBasicMaterial color={BAY_COLOR} toneMapped={false} />
        </mesh>
      ))}
      {[-1.4, 0, 1.4].map((x) => (
        <mesh key={'eng' + x} position={[x, 0, -10.3]}>
          <cylinderGeometry args={[0.6, 0.8, 0.6, 8]} />
          <meshBasicMaterial color={ENGINE_COLOR} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

const carrierAt: Vec3 = { x: 0, y: 0, z: 0 };

function Carrier() {
  const group = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Mesh>(null);
  const warpRing = useRef<THREE.Mesh>(null);
  useFrame((st, dt) => {
    const s = engine.view;
    const c = s.carrier.pos;
    const g = group.current;
    if (g) {
      lerpCarrier(engine.alpha(), carrierAt);
      g.position.set(carrierAt.x, carrierAt.y, carrierAt.z);
      if (s.carrier.target) {
        const t = s.carrier.target;
        const ang = Math.atan2(t.x - c.x, t.z - c.z);
        g.rotation.y += shortestArc(g.rotation.y, ang) * easeFactor(dt, TURN_RATE);
        g.rotation.y = shortestArc(0, g.rotation.y);
      }
    }
    if (shield.current) {
      const mat = shield.current.material as THREE.MeshBasicMaterial;
      const threatened = s.pirates.length > 0;
      shield.current.visible = threatened && s.carrier.shield > 0;
      mat.opacity = s.carrier.shield * 0.07;
    }
    if (warpRing.current) {
      warpRing.current.visible = !!s.warp;
      warpRing.current.rotation.z = st.clock.elapsedTime * 2;
      const total = s.warp ? s.warp.total || WARP_CHARGE : 1;
      const k = s.warp ? 1 + (1 - Math.min(1, s.warp.charge / total)) * 2 : 1;
      warpRing.current.scale.setScalar(k);
    }
  });
  return (
    <group ref={group}>
      <CarrierHull />
      <mesh ref={shield}>
        <sphereGeometry args={[14, 32, 16]} />
        <meshBasicMaterial
          color="#5ab4ff"
          transparent
          opacity={0.04}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={warpRing} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[12, 0.25, 8, 64]} />
        <meshBasicMaterial color={WARP_RING_COLOR} toneMapped={false} />
      </mesh>
    </group>
  );
}

const otherAt: Vec3 = { x: 0, y: 0, z: 0 };

/** Carriers sharing the viewed system: a tinted hull each, and their ships as far-LOD points. */
function OtherCarriers() {
  const key = useSyncExternalStore(engine.subscribe, () => engine.others.map((o) => o.id).join());
  const ids = key ? key.split(',').map(Number) : [];
  const groups = useRef(new Map<number, THREE.Group>());
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1024 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(1024 * 3), 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    const a = engine.othersAlpha();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    for (const o of engine.others) {
      const p = engine.othersPrev.get(o.id) ?? o.pos;
      otherAt.x = p.x + (o.pos.x - p.x) * a;
      otherAt.y = p.y + (o.pos.y - p.y) * a;
      otherAt.z = p.z + (o.pos.z - p.z) * a;
      const g = groups.current.get(o.id);
      if (g) {
        g.position.set(otherAt.x, otherAt.y, otherAt.z);
        const dx = o.pos.x - p.x;
        const dz = o.pos.z - p.z;
        if (dx * dx + dz * dz > 1e-4) {
          g.rotation.y += shortestArc(g.rotation.y, Math.atan2(dx, dz)) * easeFactor(dt, TURN_RATE);
        }
      }
      for (let i = 0; i < o.ships.length && n < 1024; i += OTHER_ROW) {
        const c = ICON_COLORS[SHIP_CLASSES[o.ships[i]]];
        pos.setXYZ(n, o.ships[i + 1], o.ships[i + 2], o.ships[i + 3]);
        col.setXYZ(n, c.r, c.g, c.b);
        n++;
      }
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <>
      {ids.map((id) => (
        <group
          key={id}
          name="otherCarrier"
          ref={(g) => {
            if (g) groups.current.set(id, g);
            else groups.current.delete(id);
          }}
        >
          <CarrierHull hull={OTHER_HULL_COLOR} />
        </group>
      ))}
      <points geometry={geo} frustumCulled={false}>
        <pointsMaterial size={4} sizeAttenuation={false} vertexColors toneMapped={false} />
      </points>
    </>
  );
}

const Hazards = memo(function Hazards() {
  const systemId = useSystemId();
  return (
    <>
      {engine.view.hazards.map((h, i) => (
        <group key={`${systemId}-${i}`} position={[h.pos.x, h.pos.y, h.pos.z]}>
          <mesh>
            <sphereGeometry args={[h.radius, 24, 16]} />
            <meshBasicMaterial
              color={h.kind === 'debris' ? '#ffb347' : '#b6ff4a'}
              transparent
              opacity={0.06}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[h.radius, 12, 8]} />
            <meshBasicMaterial
              color={h.kind === 'debris' ? '#ffb347' : '#b6ff4a'}
              wireframe
              transparent
              opacity={0.15}
            />
          </mesh>
        </group>
      ))}
    </>
  );
});

const GasGiant = memo(function GasGiant() {
  const sys = engine.view.systems[useSystemId()];
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: GAS_VERT,
        fragmentShader: GAS_FRAG,
      }),
    [],
  );
  const storm = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    // H2 storm: one translucent shell, hidden (no draw call) when calm.
    const m = storm.current;
    if (m) {
      m.visible = engine.view.storm.active > 0;
      if (m.visible) m.rotation.y = st.clock.elapsedTime * 0.4;
    }
  });
  if (!sys.gasGiant) return null;
  const p = gasGiantPos(sys);
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh material={mat}>
        <sphereGeometry args={[25, 48, 32]} />
      </mesh>
      <mesh ref={storm} visible={false}>
        <icosahedronGeometry args={[H2_STORM_RADIUS, 2]} />
        <meshBasicMaterial
          color="#ffb070"
          wireframe
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2.3, 0, 0]}>
        <ringGeometry args={[32, 44, 64]} />
        <meshBasicMaterial
          color="#d6b48a"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
});

const TIER_SKY: Record<number, [string, string]> = {
  1: ['#2a6cff', '#7fd4ff'],
  2: ['#7a3cff', '#ff7bd0'],
  3: ['#ff3d2e', '#ffb35a'],
};

const Sky = memo(function Sky() {
  const sys = engine.view.systems[useSystemId()];
  const tier = sys.tier;
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() } },
        vertexShader: NEBULA_VERT,
        fragmentShader: NEBULA_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => {
    mat.uniforms.uA.value.set(TIER_SKY[tier][0]);
    mat.uniforms.uB.value.set(TIER_SKY[tier][1]);
  }, [tier, mat]);
  const bright = sys.brightness;
  const sunColor = useMemo(
    () => new THREE.Color('#fff2c8').multiplyScalar(2 + bright * 2),
    [bright],
  );
  return (
    <>
      <mesh material={mat}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      <Stars radius={500} depth={200} count={4000} factor={6} fade speed={0.3} />
      <mesh position={[400, 150, -500]}>
        <sphereGeometry args={[18 + bright * 10, 24, 16]} />
        <meshBasicMaterial color={sunColor} toneMapped={false} />
      </mesh>
      <directionalLight position={[400, 150, -500]} intensity={1.2 + bright} color="#fff1dc" />
      <ambientLight intensity={0.55} color="#8fa8ff" />
      <directionalLight position={[-200, 120, 300]} intensity={0.6} color="#9fb8ff" />
      <hemisphereLight args={['#6f8cff', '#1a0f20', 0.35]} />
    </>
  );
});

const ICON_COLORS: Record<string, THREE.Color> = {
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
const MAX_ICONS = 2048;

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

function Tactical({ on }: { on: boolean }) {
  const dpr = useThree((st) => st.viewport.dpr);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2048 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2048 * 3), 3));
    g.setAttribute('shape', new THREE.BufferAttribute(new Float32Array(2048), 1));
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

// Memoised so the parent's 5 Hz UI re-render doesn't re-render the whole scene graph.
export const Scene = memo(function Scene({
  tactical,
  quality,
  bloom,
  fpsCap,
  onAutoTactical,
}: ViewOptions) {
  const [auto, setAuto] = useState(false);
  const onAuto = (on: boolean) => {
    setAuto(on);
    onAutoTactical(on);
  };
  return (
    <Canvas
      camera={{ position: [40, 28, 55], fov: 55, near: 0.5, far: 3000 }}
      dpr={quality === 'high' ? [1, 2] : 1}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      frameloop="always"
      onPointerMissed={() => isDoubleMiss(performance.now()) && focus.set(null)}
    >
      <color attach="background" args={['#020308']} />
      <Sky />
      <GasGiant />
      <AsteroidField lodDistance={quality === 'high' ? 140 : 80} />
      <Hazards />
      <Containers />
      <Carrier />
      <OtherCarriers />
      <FleetPass />
      <Fleet lodDistance={quality === 'high' ? 120 : 70} />
      <Beams />
      <Explosions />
      <Tactical on={tactical || auto} />
      <RenderStats />
      {quality === 'low' && <FrameCap fps={fpsCap} />}
      <CameraRig tactical={tactical} onAutoTactical={onAuto} />
      {quality === 'high' && bloom && (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      )}
    </Canvas>
  );
});
