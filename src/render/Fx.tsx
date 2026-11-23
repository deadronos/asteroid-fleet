import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engine } from '../game/engine';
import { asteroidById, fleetFrame, MAX_ENTITIES } from './frameState';

const MAX_SEG = 1024;
const MAX_EXPLOSIONS = 128;
const SPARKS_PER_FX = 8;
const MAX_SPARKS = MAX_EXPLOSIONS * SPARKS_PER_FX;

const BEAM_SPECS: Record<string, { color: THREE.Color; radius: number; ttl: number }> = {
  mine: { color: new THREE.Color('#7fe7ff').multiplyScalar(2.2), radius: 0.09, ttl: 0 },
  laser: { color: new THREE.Color('#ff8fa0').multiplyScalar(3.4), radius: 0.085, ttl: 0.15 },
  pirateLaser: { color: new THREE.Color('#ff3020').multiplyScalar(3.4), radius: 0.09, ttl: 0.15 },
  turretLaser: { color: new THREE.Color('#ffd27a').multiplyScalar(3.8), radius: 0.16, ttl: 0.15 },
  repair: { color: new THREE.Color('#5affb4').multiplyScalar(2.5), radius: 0.11, ttl: 0.3 },
};

const CORE_HOT = new THREE.Color('#fff4d8').multiplyScalar(5);
const CORE_COOL = new THREE.Color('#ff6a18').multiplyScalar(2.5);
const RING_ORANGE = new THREE.Color('#ffaa55').multiplyScalar(3.2);
const SPARK_HOT = new THREE.Color('#ffd080').multiplyScalar(3.6);
const SPARK_COOL = new THREE.Color('#ff5520').multiplyScalar(2.8);

const WARP_CYAN = new THREE.Color('#7fe7ff').multiplyScalar(4.5);
const WARP_CORE_HOT = new THREE.Color('#d8f8ff').multiplyScalar(5.5);
const WARP_VIOLET = new THREE.Color('#9b7bff').multiplyScalar(3.8);

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

/** Deterministic 32-bit seed derived from an FX origin so render scatter never touches sim RNG. */
function fxSeed(x: number, y: number, z: number): number {
  let h =
    (Math.imul(Math.round(x * 10), 374761393) +
      Math.imul(Math.round(y * 10), 668265263) +
      Math.imul(Math.round(z * 10), 2147483647)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function nextRand(seed: number): [number, number] {
  const s = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [s, s / 0x100000000];
}

/** Unit open cylinder along +Y from 0..1 with brighter source end fading slightly toward the tip. */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.75, 1, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = 1 - pos.getY(i) * 0.45;
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Tapered 4-sided spark/streak shard oriented along +Y from 0..1. */
function sparkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.02, 0.14, 1, 4, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

function pushBeam(
  m: THREE.InstancedMesh,
  n: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  color: THREE.Color,
  intensity: number,
): number {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  if (len < 1e-4) return n;
  _dir.divideScalar(len);
  _quat.setFromUnitVectors(UP, _dir);
  _scale.set(radius, len, radius);
  _mat.compose(_a, _quat, _scale);
  m.setMatrixAt(n, _mat);
  _col.copy(color).multiplyScalar(intensity);
  m.setColorAt(n, _col);
  return n + 1;
}

/** Volumetric additive beam cylinders for mining, repair, and combat fire (#231). */
export function Beams() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => beamGeometry(), []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame((st) => {
    const m = mesh.current;
    if (!m) return;
    const s = engine.view;
    const f = fleetFrame;
    const t = st.clock.elapsedTime;
    let n = 0;
    const rocks = asteroidById(s.asteroids);
    const mineSpec = BEAM_SPECS.mine;
    for (let k = 0; k < s.ships.length && k < MAX_ENTITIES && n < MAX_SEG; k++) {
      const sh = s.ships[k];
      if (sh.mode !== 'mining') continue;
      const r = rocks.get(sh.targetId);
      const i = f.shipEntity[k];
      if (!r || i < 0) continue;
      const pulse = 0.88 + 0.12 * Math.sin(t * 9 + k * 1.7);
      n = pushBeam(
        m,
        n,
        f.pos[i * 3],
        f.pos[i * 3 + 1],
        f.pos[i * 3 + 2],
        r.pos.x,
        r.pos.y,
        r.pos.z,
        mineSpec.radius * (0.92 + 0.08 * pulse),
        mineSpec.color,
        pulse,
      );
    }
    for (const fx of s.fx) {
      if (n >= MAX_SEG) break;
      const spec = BEAM_SPECS[fx.kind];
      if (!spec) continue;
      const intensity =
        fx.kind === 'repair'
          ? 0.85 + 0.15 * Math.sin(t * 7 + fx.a.x)
          : 0.35 + 0.65 * Math.min(1, fx.ttl / spec.ttl);
      n = pushBeam(
        m,
        n,
        fx.a.x,
        fx.a.y,
        fx.a.z,
        fx.b.x,
        fx.b.y,
        fx.b.z,
        spec.radius,
        spec.color,
        intensity,
      );
    }
    m.visible = n > 0;
    if (n > 0) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geo, mat, MAX_SEG]}
      frustumCulled={false}
      raycast={() => null}
      visible={false}
    />
  );
}

/** Layered core flash, shockwave ring, and radial spark/streak bursts for explosions and warps (#232). */
export function Explosions() {
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const sparkRef = useRef<THREE.InstancedMesh>(null);

  const coreGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const ringGeo = useMemo(() => new THREE.TorusGeometry(1, 0.05, 5, 24), []);
  const sparkGeo = useMemo(() => sparkGeometry(), []);
  const fxMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(
    () => () => {
      coreGeo.dispose();
      ringGeo.dispose();
      sparkGeo.dispose();
      fxMat.dispose();
    },
    [coreGeo, ringGeo, sparkGeo, fxMat],
  );

  useFrame(() => {
    const core = coreRef.current;
    const ring = ringRef.current;
    const spark = sparkRef.current;
    if (!core || !ring || !spark) return;

    let n = 0;
    let sn = 0;
    for (const f of engine.view.fx) {
      if (f.kind !== 'explosion' && f.kind !== 'warp') continue;
      if (n >= MAX_EXPLOSIONS) break;
      const isWarp = f.kind === 'warp';
      const life = isWarp ? 1.5 : 0.8;
      const k = Math.min(1, Math.max(0, 1 - f.ttl / life));
      const fade = (1 - k) * (1 - k);
      const easeOut = 1 - fade;

      let seed = fxSeed(f.a.x, f.a.y, f.a.z);
      let u0 = 0;
      let u1 = 0;
      [seed, u0] = nextRand(seed);
      [seed, u1] = nextRand(seed);

      // Core flash.
      _a.set(f.a.x, f.a.y, f.a.z);
      _quat.identity();
      const coreScale = isWarp
        ? fade * 13 * Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) + 0.01
        : Math.sin(Math.min(1, k * 2.5) * Math.PI * 0.5) * (1 - k) * 3.8 + 0.01;
      _scale.setScalar(coreScale);
      _mat.compose(_a, _quat, _scale);
      core.setMatrixAt(n, _mat);
      _col
        .copy(isWarp ? WARP_CORE_HOT : CORE_HOT)
        .lerp(isWarp ? WARP_VIOLET : CORE_COOL, k)
        .multiplyScalar(fade);
      core.setColorAt(n, _col);

      // Shockwave ring: warp ring lies flat in the orbital XZ plane, explosions tilt deterministically.
      if (isWarp) {
        _euler.set(Math.PI / 2, 0, 0);
      } else {
        _euler.set(Math.PI / 2 + (u0 - 0.5) * 0.9, (u1 - 0.5) * 0.9, 0);
      }
      _quat.setFromEuler(_euler);
      const ringRadius = isWarp ? 2 + easeOut * 32 : 0.4 + easeOut * 8;
      _scale.set(ringRadius, ringRadius, isWarp ? 1.5 : 0.8);
      _mat.compose(_a, _quat, _scale);
      ring.setMatrixAt(n, _mat);
      if (isWarp) {
        _col.copy(WARP_CYAN).lerp(WARP_VIOLET, k).multiplyScalar(fade);
      } else {
        _col.copy(RING_ORANGE).multiplyScalar(fade);
      }
      ring.setColorAt(n, _col);
      n++;

      // Radial spark / warp streak burst.
      for (let j = 0; j < SPARKS_PER_FX && sn < MAX_SPARKS; j++) {
        let theta = 0;
        let zDir = 0;
        let spd = 0;
        [seed, theta] = nextRand(seed);
        [seed, zDir] = nextRand(seed);
        [seed, spd] = nextRand(seed);
        const ang = theta * Math.PI * 2;
        const nz = isWarp ? (zDir * 2 - 1) * 0.35 : zDir * 2 - 1;
        const rXY = Math.sqrt(Math.max(0, 1 - nz * nz));
        _dir.set(rXY * Math.cos(ang), nz, rXY * Math.sin(ang)).normalize();
        const speedScale = 0.65 + spd * 0.7;
        const travel = easeOut * (isWarp ? 22 : 7) * speedScale;
        _b.copy(_a).addScaledVector(_dir, travel);
        _quat.setFromUnitVectors(UP, _dir);
        const len = (1 - k) * (isWarp ? 4.5 : 1.5) * speedScale + 0.08;
        const width = (1 - k) * (isWarp ? 0.9 : 0.75) + 0.12;
        _scale.set(width, len, width);
        _mat.compose(_b, _quat, _scale);
        spark.setMatrixAt(sn, _mat);
        if (isWarp) {
          _col.copy(j % 2 === 0 ? WARP_CYAN : WARP_VIOLET).multiplyScalar(fade);
        } else {
          _col.copy(SPARK_HOT).lerp(SPARK_COOL, k).multiplyScalar(fade);
        }
        spark.setColorAt(sn, _col);
        sn++;
      }
    }

    core.visible = n > 0;
    ring.visible = n > 0;
    spark.visible = sn > 0;
    if (n > 0) {
      core.count = n;
      core.instanceMatrix.needsUpdate = true;
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
      ring.count = n;
      ring.instanceMatrix.needsUpdate = true;
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    }
    if (sn > 0) {
      spark.count = sn;
      spark.instanceMatrix.needsUpdate = true;
      if (spark.instanceColor) spark.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        ref={coreRef}
        args={[coreGeo, fxMat, MAX_EXPLOSIONS]}
        frustumCulled={false}
        raycast={() => null}
        visible={false}
      />
      <instancedMesh
        ref={ringRef}
        args={[ringGeo, fxMat, MAX_EXPLOSIONS]}
        frustumCulled={false}
        raycast={() => null}
        visible={false}
      />
      <instancedMesh
        ref={sparkRef}
        args={[sparkGeo, fxMat, MAX_SPARKS]}
        frustumCulled={false}
        raycast={() => null}
        visible={false}
      />
    </>
  );
}
