import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
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
import { AudioBridge } from './AudioBridge';
import { CameraRig } from './CameraRig';
import { ASTEROID_LOD, CAMERA_OFFSET, FLEET_LOD } from './constants';
import { Containers } from './Containers';
import { GasGiant, Hazards, Sky } from './Environment';
import { Fleet } from './Fleet';
import { easeFactor, focus, isDoubleMiss, shortestArc } from './focus';
import { FleetPass } from './frameState';
import { Beams, Explosions, FocusReticle, MiningSparks, SurveyPings } from './Fx';
import { FRESNEL_VERT, SHIELD_FRAG } from './geometry';
import { CARRIER_MODEL, carrierModel, disposeCarrierModel, modelUrl } from './models';
import { FrameCap, RenderStats } from './RenderLoop';
import { ICON_COLORS, Tactical } from './Tactical';
import { PanelViewOffset } from './viewOffset';

const Effects = lazy(() => import('./Effects'));

export interface ViewOptions {
  tactical: boolean;
  quality: 'high' | 'low';
  bloom: boolean;
  /** Frame-rate cap applied in low quality; 0 is uncapped. */
  fpsCap: number;
  onAutoTactical: (on: boolean) => void;
}

const BAY_COLOR = new THREE.Color('#ffd27a').multiplyScalar(3);
const ENGINE_COLOR = new THREE.Color('#58b8ff').multiplyScalar(5);
const WARP_RING_COLOR = new THREE.Color('#9b7bff').multiplyScalar(4);

/** Soft round sprites for distant ships of other carriers, replacing square 4px dots (#235). */
const DOT_VERT = /* glsl */ `
uniform float uPx;
attribute vec3 color;
varying vec3 vColor;
void main() {
  vColor = color;
  gl_PointSize = 6.0 * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DOT_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.55, 1.0, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;
/** How fast the hull turns toward its heading, per second (see `easeFactor`). */
const TURN_RATE = 0.8;
const SHIELD_FLASH_DECAY = 0.35;

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
  const shieldState = useRef({ opId: -1, systemId: -1, prev: -1, flash: 0 });
  const shieldMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uShield: { value: 1 },
          uHitFlash: { value: 0 },
          uColor: { value: new THREE.Color('#5ab4ff') },
        },
        vertexShader: FRESNEL_VERT,
        fragmentShader: SHIELD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => shieldMat.dispose(), [shieldMat]);

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
      const shState = shieldState.current;
      if (shState.opId !== s.id || shState.systemId !== s.systemId) {
        shState.opId = s.id;
        shState.systemId = s.systemId;
        shState.prev = s.carrier.shield;
        shState.flash = 0;
      } else {
        if (s.carrier.shield < shState.prev - 1e-4) shState.flash = 1;
        shState.prev = s.carrier.shield;
        shState.flash = Math.max(0, shState.flash - Math.min(dt, 0.1) / SHIELD_FLASH_DECAY);
      }
      const threatened = s.pirates.length > 0;
      shield.current.visible = (threatened && s.carrier.shield > 0) || shState.flash > 0.01;
      if (shield.current.visible) {
        shieldMat.uniforms.uTime.value = st.clock.elapsedTime;
        shieldMat.uniforms.uShield.value = s.carrier.shield;
        shieldMat.uniforms.uHitFlash.value = shState.flash;
      }
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
      <mesh ref={shield} material={shieldMat} visible={false} raycast={() => null}>
        <sphereGeometry args={[14, 32, 16]} />
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
  const dpr = useThree((st) => st.viewport.dpr);
  const key = useSyncExternalStore(engine.subscribe, () => engine.others.map((o) => o.id).join());
  const ids = key ? key.split(',').map(Number) : [];
  const groups = useRef(new Map<number, THREE.Group>());
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1024 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(1024 * 3), 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
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
      <points geometry={geo} frustumCulled={false} raycast={() => null}>
        <shaderMaterial
          vertexShader={DOT_VERT}
          fragmentShader={DOT_FRAG}
          uniforms={{ uPx: { value: dpr } }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
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
  const paused = useSyncExternalStore(engine.subscribe, () => engine.paused);
  const lqFps = quality === 'low' ? fpsCap : 0;
  const onAuto = (on: boolean) => {
    setAuto(on);
    onAutoTactical(on);
  };
  return (
    <Canvas
      camera={{ position: CAMERA_OFFSET, fov: 55, near: 0.5, far: 3000 }}
      dpr={quality === 'high' ? [1, 1.5] : 1}
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
      <MiningSparks />
      <SurveyPings />
      <FocusReticle />
      <Tactical on={tactical || auto} />
      <RenderStats />
      {(paused || lqFps > 0) && <FrameCap fps={lqFps} paused={paused} />}
      <CameraRig tactical={tactical} onAutoTactical={onAuto} />
      <AudioBridge />
      <PanelViewOffset />
      {quality === 'high' && bloom && (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      )}
    </Canvas>
  );
});
