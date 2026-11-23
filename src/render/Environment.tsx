import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { engine } from '../game/engine';
import { H2_STORM_RADIUS } from '../sim/config';
import { gasGiantPos } from '../sim/state';
import {
  asteroidGeometry,
  DEBRIS_SHELL_FRAG,
  FRESNEL_VERT,
  GAS_FRAG,
  GAS_VERT,
  NEBULA_FRAG,
  NEBULA_VERT,
  RADIATION_FRAG,
  STORM_FRAG,
} from './geometry';

/** Re-renders only when the system changes, not on every 5 Hz UI tick. */
export function useSystemId(): number {
  return useSyncExternalStore(engine.subscribe, () => engine.view.systemId);
}

const STAR_COUNT = 4000;
const STAR_RADIUS = 500;
const STAR_DEPTH = 200;

function Starfield() {
  const points = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    // Deterministic LCG so star positions stay stable across mounts without touching sim RNG.
    let seed = 0x51a7f1d;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = STAR_RADIUS + next() * STAR_DEPTH;
      const theta = next() * Math.PI * 2;
      const phi = Math.acos(2 * next() - 1);
      const sp = Math.sin(phi);
      pos[i * 3] = r * sp * Math.cos(theta);
      pos[i * 3 + 1] = r * sp * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const tint = 0.75 + next() * 0.25;
      col[i * 3] = tint;
      col[i * 3 + 1] = tint;
      col[i * 3 + 2] = 0.85 + next() * 0.15;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((st) => {
    if (points.current) points.current.rotation.y = st.clock.elapsedTime * 0.005;
  });
  return (
    <points ref={points} geometry={geo}>
      <pointsMaterial
        size={1.6}
        sizeAttenuation={false}
        vertexColors
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </points>
  );
}

const CHUNKS_PER_DEBRIS = 32;
const MAX_DEBRIS_CHUNKS = 512;
const DEBRIS_COLORS = ['#8c6d4e', '#6e7680', '#b88248', '#525862'];
const chunkDummy = new THREE.Object3D();
const chunkCol = new THREE.Color();

export const Hazards = memo(function Hazards() {
  const systemId = useSystemId();
  const chunksRef = useRef<THREE.InstancedMesh>(null);
  const unitSphere = useMemo(() => new THREE.SphereGeometry(1, 24, 16), []);
  const chunkGeo = useMemo(() => asteroidGeometry(0), []);
  const chunkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.75,
        metalness: 0.45,
        flatShading: true,
      }),
    [],
  );
  const debrisMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#ffb347') } },
        vertexShader: FRESNEL_VERT,
        fragmentShader: DEBRIS_SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const radMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color('#b6ff4a') },
        },
        vertexShader: FRESNEL_VERT,
        fragmentShader: RADIATION_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      unitSphere.dispose();
      chunkGeo.dispose();
      chunkMat.dispose();
      debrisMat.dispose();
      radMat.dispose();
    },
    [unitSphere, chunkGeo, chunkMat, debrisMat, radMat],
  );

  // Preallocated chunk descriptors so tumbling needs zero per-frame allocations.
  const chunkBuf = useMemo(
    () => ({
      pos: new Float32Array(MAX_DEBRIS_CHUNKS * 3),
      scale: new Float32Array(MAX_DEBRIS_CHUNKS * 3),
      rot: new Float32Array(MAX_DEBRIS_CHUNKS * 3),
      spin: new Float32Array(MAX_DEBRIS_CHUNKS * 2),
      count: 0,
      hazards: null as typeof engine.view.hazards | null,
      systemId: -1,
      ready: false,
      spinTime: 0,
    }),
    [],
  );

  useFrame((st, dt) => {
    radMat.uniforms.uTime.value = st.clock.elapsedTime;
    const m = chunksRef.current;
    if (!m) return;
    const s = engine.view;
    if (s.hazards !== chunkBuf.hazards || s.systemId !== chunkBuf.systemId) {
      chunkBuf.hazards = s.hazards;
      chunkBuf.systemId = s.systemId;
      chunkBuf.ready = false;
      let debrisCount = 0;
      for (const h of s.hazards) if (h.kind === 'debris') debrisCount++;
      const perHazard =
        debrisCount > 0
          ? Math.min(CHUNKS_PER_DEBRIS, Math.floor(MAX_DEBRIS_CHUNKS / debrisCount))
          : 0;
      let n = 0;
      for (let hi = 0; hi < s.hazards.length && n < MAX_DEBRIS_CHUNKS; hi++) {
        const h = s.hazards[hi];
        if (h.kind !== 'debris') continue;
        let seed = (Math.imul(s.systemId + 1, 2654435761) ^ Math.imul(hi + 1, 374761393)) >>> 0;
        const next = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 0x100000000;
        };
        for (let j = 0; j < perHazard && n < MAX_DEBRIS_CHUNKS; j++) {
          const r = h.radius * Math.cbrt(next()) * 0.9;
          const theta = next() * Math.PI * 2;
          const cz = next() * 2 - 1;
          const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
          const o = n * 3;
          chunkBuf.pos[o] = h.pos.x + r * sz * Math.cos(theta);
          chunkBuf.pos[o + 1] = h.pos.y + r * cz;
          chunkBuf.pos[o + 2] = h.pos.z + r * sz * Math.sin(theta);
          const base = 0.45 + next() * 0.95;
          chunkBuf.scale[o] = base * (0.65 + next() * 0.75);
          chunkBuf.scale[o + 1] = base * (0.45 + next() * 0.6);
          chunkBuf.scale[o + 2] = base * (0.65 + next() * 0.75);
          chunkBuf.rot[o] = next() * Math.PI * 2;
          chunkBuf.rot[o + 1] = next() * Math.PI * 2;
          chunkBuf.rot[o + 2] = next() * Math.PI * 2;
          chunkBuf.spin[n * 2] = (next() - 0.5) * 0.4;
          chunkBuf.spin[n * 2 + 1] = (next() - 0.5) * 0.4;
          m.setColorAt(n, chunkCol.set(DEBRIS_COLORS[n % DEBRIS_COLORS.length]));
          n++;
        }
      }
      chunkBuf.count = n;
      if (n > 0 && m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    if (chunkBuf.count === 0) {
      m.visible = false;
      return;
    }
    if (engine.paused && chunkBuf.ready) return;
    if (!engine.paused) chunkBuf.spinTime += Math.min(dt, 0.1);
    const t = chunkBuf.spinTime;
    for (let i = 0; i < chunkBuf.count; i++) {
      const o = i * 3;
      chunkDummy.position.set(chunkBuf.pos[o], chunkBuf.pos[o + 1], chunkBuf.pos[o + 2]);
      chunkDummy.rotation.set(
        chunkBuf.rot[o] + t * chunkBuf.spin[i * 2],
        chunkBuf.rot[o + 1] + t * chunkBuf.spin[i * 2 + 1],
        chunkBuf.rot[o + 2],
      );
      chunkDummy.scale.set(chunkBuf.scale[o], chunkBuf.scale[o + 1], chunkBuf.scale[o + 2]);
      chunkDummy.updateMatrix();
      m.setMatrixAt(i, chunkDummy.matrix);
    }
    chunkDummy.scale.setScalar(1);
    m.count = chunkBuf.count;
    m.visible = true;
    m.instanceMatrix.needsUpdate = true;
    chunkBuf.ready = true;
  });

  return (
    <>
      {engine.view.hazards.map((h, i) => (
        <mesh
          key={`${systemId}-${i}`}
          position={[h.pos.x, h.pos.y, h.pos.z]}
          scale={h.radius}
          geometry={unitSphere}
          material={h.kind === 'debris' ? debrisMat : radMat}
          raycast={() => null}
        />
      ))}
      <instancedMesh
        ref={chunksRef}
        args={[chunkGeo, chunkMat, MAX_DEBRIS_CHUNKS]}
        frustumCulled={false}
        raycast={() => null}
        visible={false}
      />
    </>
  );
});

export const GasGiant = memo(function GasGiant() {
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
  const stormMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: FRESNEL_VERT,
        fragmentShader: STORM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      mat.dispose();
      stormMat.dispose();
    },
    [mat, stormMat],
  );
  const storm = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    // H2 storm: one swirling Fresnel plasma shell, hidden (no draw call) when calm.
    const m = storm.current;
    if (m) {
      m.visible = engine.view.storm.active > 0;
      if (m.visible) {
        stormMat.uniforms.uTime.value = st.clock.elapsedTime;
        m.rotation.y = st.clock.elapsedTime * 0.25;
      }
    }
  });
  if (!sys.gasGiant) return null;
  const p = gasGiantPos(sys);
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh material={mat}>
        <sphereGeometry args={[25, 48, 32]} />
      </mesh>
      <mesh ref={storm} material={stormMat} visible={false} raycast={() => null}>
        <sphereGeometry args={[H2_STORM_RADIUS, 36, 24]} />
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

const SUN_POS: [number, number, number] = [400, 150, -500];
const RIM_POS: [number, number, number] = [-450, 90, -200];

const NEBULA_W = 1024;
const NEBULA_H = 512;

export const Sky = memo(function Sky() {
  const sys = engine.view.systems[useSystemId()];
  const tier = sys.tier;
  const gl = useThree((s) => s.gl);
  const skyMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const bakerRef = useRef<{
    rt: THREE.WebGLRenderTarget;
    geo: THREE.PlaneGeometry;
    mat: THREE.ShaderMaterial;
    scene: THREE.Scene;
    cam: THREE.OrthographicCamera;
  } | null>(null);

  // Bake the static 5-octave fBm nebula once per tier into an equirectangular target (#238).
  useLayoutEffect(() => {
    const halfFloat =
      gl.extensions.has('EXT_color_buffer_half_float') ||
      gl.extensions.has('EXT_color_buffer_float');
    const rt = new THREE.WebGLRenderTarget(NEBULA_W, NEBULA_H, {
      type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() } },
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geo, mat));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    bakerRef.current = { rt, geo, mat, scene, cam };
    skyMat.map = rt.texture;
    skyMat.needsUpdate = true;
    return () => {
      bakerRef.current = null;
      rt.dispose();
      geo.dispose();
      mat.dispose();
      skyMat.dispose();
    };
  }, [gl, skyMat]);

  useLayoutEffect(() => {
    const baker = bakerRef.current;
    if (!baker) return;
    baker.mat.uniforms.uA.value.set(TIER_SKY[tier][0]);
    baker.mat.uniforms.uB.value.set(TIER_SKY[tier][1]);
    const prevTarget = gl.getRenderTarget();
    const prevXr = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(baker.rt);
    gl.render(baker.scene, baker.cam);
    gl.setRenderTarget(prevTarget);
    gl.xr.enabled = prevXr;
  }, [gl, tier]);

  const bright = sys.brightness;
  const sunColor = useMemo(
    () => new THREE.Color('#fff2c8').multiplyScalar(2 + bright * 2),
    [bright],
  );
  return (
    <>
      <mesh material={skyMat}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      <Starfield />
      <mesh position={SUN_POS}>
        <sphereGeometry args={[18 + bright * 10, 24, 16]} />
        <meshBasicMaterial color={sunColor} toneMapped={false} />
      </mesh>
      {/* Warm key from the star, cool rim from the far side to pick out silhouettes. */}
      <directionalLight position={SUN_POS} intensity={1.4 + bright} color="#ffe4bd" />
      <directionalLight position={RIM_POS} intensity={1.1} color="#8fb2ff" />
      <ambientLight intensity={0.45} color="#8fa8ff" />
      <hemisphereLight args={['#6f8cff', '#1a0f20', 0.35]} />
    </>
  );
});
