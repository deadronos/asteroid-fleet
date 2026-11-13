import { Canvas, useFrame, useLoader } from '@react-three/fiber';
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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { engine, lerpCarrier } from '../game/engine';
import { OTHER_ROW } from '../game/snapshot';
import { SHIP_CLASSES, type Vec3 } from '../sim/types';
import { AsteroidField } from './AsteroidField';
import { CameraRig } from './CameraRig';
import { ASTEROID_LOD, CAMERA_OFFSET, FLEET_LOD } from './constants';
import { Containers } from './Containers';
import { GasGiant, Hazards, Sky } from './Environment';
import { Fleet } from './Fleet';
import { easeFactor, focus, isDoubleMiss, shortestArc } from './focus';
import { FleetPass, MAX_ENTITIES, asteroidById, fleetFrame } from './frameState';
import { CARRIER_MODEL, carrierModel, disposeCarrierModel, modelUrl } from './models';
import { FrameCap, RenderStats } from './RenderLoop';
import { ICON_COLORS, Tactical } from './Tactical';
import { PanelViewOffset } from './viewOffset';

const Effects = lazy(() => import('./Effects'));

const dummy = new THREE.Object3D();

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
  turretLaser: new THREE.Color('#ffd27a').multiplyScalar(3),
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
/** Multiplies another carrier's ochre hull toward grey-blue, so yours stands out. */
const OTHER_HULL_TINT = '#a9b6d6';

/** The glTF carrier, with the old box hull as the fallback while it loads. */
function CarrierHull({ other = false }: { other?: boolean }) {
  return (
    <Suspense fallback={<BoxHull hull={other ? OTHER_HULL_COLOR : HULL_COLOR} />}>
      <CarrierModel tint={other ? OTHER_HULL_TINT : undefined} />
    </Suspense>
  );
}

function CarrierModel({ tint }: { tint?: string }) {
  const gltf = useLoader(GLTFLoader, modelUrl(CARRIER_MODEL));
  const model = useMemo(() => carrierModel(gltf.scene, tint), [gltf, tint]);
  useEffect(() => () => disposeCarrierModel(model), [model]);
  return <primitive object={model} />;
}

function BoxHull({ hull }: { hull: string }) {
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
      const total = s.warp ? s.warp.total : 1;
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
        const c = ICON_COLORS[SHIP_CLASSES[o.ships[i + 1]]];
        const x = o.ships[i + 2];
        const y = o.ships[i + 3];
        const z = o.ships[i + 4];
        // New ships have no previous position and appear where they are.
        const q = engine.othersPrevShips.get(o.ships[i]);
        if (q) pos.setXYZ(n, q[0] + (x - q[0]) * a, q[1] + (y - q[1]) * a, q[2] + (z - q[2]) * a);
        else pos.setXYZ(n, x, y, z);
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
          <CarrierHull other />
        </group>
      ))}
      <points geometry={geo} frustumCulled={false}>
        <pointsMaterial size={4} sizeAttenuation={false} vertexColors toneMapped={false} />
      </points>
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
      camera={{ position: CAMERA_OFFSET, fov: 55, near: 0.5, far: 3000 }}
      dpr={quality === 'high' ? [1, 2] : 1}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      frameloop="always"
      onPointerMissed={() => isDoubleMiss(performance.now()) && focus.set(null)}
    >
      <color attach="background" args={['#020308']} />
      <Sky />
      <GasGiant />
      <AsteroidField lodDistance={ASTEROID_LOD[quality]} />
      <Hazards />
      <Containers />
      <Carrier />
      <OtherCarriers />
      <FleetPass />
      <Fleet lodDistance={FLEET_LOD[quality]} />
      <Beams />
      <Explosions />
      <Tactical on={tactical || auto} />
      <RenderStats />
      {quality === 'low' && <FrameCap fps={fpsCap} />}
      <CameraRig tactical={tactical} onAutoTactical={onAuto} />
      <PanelViewOffset />
      {quality === 'high' && bloom && (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      )}
    </Canvas>
  );
});
