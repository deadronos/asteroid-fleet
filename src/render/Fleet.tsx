import { useGLTF } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engine, lerpPos } from '../game/engine';
import { SHIP_STATS } from '../sim/config';
import { SHIP_CLASSES, type Vec3 } from '../sim/types';
import { shipGeometry } from './geometry';
import { focus } from './focus';
import { heading, pruneHeadings, stepLength } from './heading';
import { SHIP_LENGTH, SHIP_MODEL, bakeModel, modelUrl, type ModelClass } from './models';

// Sized for the 1000-ship sim cap; the buffers are allocated once per layer.
const MAX_PER_CLASS = 1000;
const MAX_TRAILS = 2048;
const CLASSES: ModelClass[] = [...SHIP_CLASSES, 'pirate'];
const URLS = CLASSES.map((c) => modelUrl(SHIP_MODEL[c]));

const dummy = new THREE.Object3D();
const tmp: Vec3 = { x: 0, y: 0, z: 0 };
const camPos = new THREE.Vector3();

const classColor = (cls: ModelClass) => (cls === 'pirate' ? '#ff3b3b' : SHIP_STATS[cls].color);

/**
 * Ships beyond `lodDistance` from the camera draw as the cheap placeholder
 * shape; nearer ones use the glTF model. Both are instanced, one draw call each.
 */
function ShipLayer({
  cls,
  model,
  lodDistance,
}: {
  cls: ModelClass;
  model: THREE.BufferGeometry | null;
  lodDistance: number;
}) {
  const near = useRef<THREE.InstancedMesh>(null);
  const far = useRef<THREE.InstancedMesh>(null);
  // Ship id per instance, so a click can focus the camera on it.
  const nearIds = useMemo(() => new Int32Array(MAX_PER_CLASS), []);
  const farIds = useMemo(() => new Int32Array(MAX_PER_CLASS), []);
  const farGeo = useMemo(() => shipGeometry(cls), [cls]);
  const color = classColor(cls);

  useFrame(({ camera }) => {
    const nm = near.current;
    const fm = far.current;
    if (!fm) return;
    const s = engine.view;
    const a = engine.alpha();
    const lod2 = model ? lodDistance * lodDistance : -1;
    camPos.copy(camera.position);
    let nn = 0;
    let nf = 0;
    const list = cls === 'pirate' ? s.pirates : s.ships;
    for (const e of list) {
      if (cls !== 'pirate') {
        const sh = e as (typeof s.ships)[number];
        if (sh.cls !== cls || sh.mode === 'docked') continue;
      }
      if (nn + nf >= MAX_PER_CLASS) break;
      lerpPos(e.id, e.pos, a, tmp);
      const h = heading(e.id, e.pos);
      dummy.position.set(tmp.x, tmp.y, tmp.z);
      dummy.lookAt(tmp.x + h.x, tmp.y + h.y, tmp.z + h.z);
      dummy.updateMatrix();
      const d2 = camPos.distanceToSquared(dummy.position);
      if (nm && d2 < lod2) {
        nearIds[nn] = e.id;
        nm.setMatrixAt(nn++, dummy.matrix);
      } else {
        farIds[nf] = e.id;
        fm.setMatrixAt(nf++, dummy.matrix);
      }
    }
    fm.count = nf;
    fm.instanceMatrix.needsUpdate = true;
    if (nm) {
      nm.count = nn;
      nm.instanceMatrix.needsUpdate = true;
    }
  });

  const onClick = (ids: Int32Array) => (e: ThreeEvent<MouseEvent>) => {
    if (cls === 'pirate' || e.instanceId === undefined) return;
    e.stopPropagation();
    focus.set(ids[e.instanceId]);
  };

  return (
    <>
      {model && (
        <instancedMesh
          ref={near}
          args={[model, undefined, MAX_PER_CLASS]}
          frustumCulled={false}
          onClick={onClick(nearIds)}
        >
          <meshStandardMaterial
            vertexColors
            emissive={color}
            emissiveIntensity={0.18}
            metalness={0.35}
            roughness={0.5}
            flatShading
          />
        </instancedMesh>
      )}
      <instancedMesh
        ref={far}
        args={[farGeo, undefined, MAX_PER_CLASS]}
        frustumCulled={false}
        onClick={onClick(farIds)}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          metalness={0.4}
          roughness={0.45}
          flatShading
        />
      </instancedMesh>
    </>
  );
}

const TRAIL_COLOR: Record<ModelClass, THREE.Color> = Object.fromEntries(
  CLASSES.map((c) => [
    c,
    new THREE.Color(c === 'pirate' ? '#ff4020' : '#6fc8ff').multiplyScalar(
      c === 'pirate' ? 3 : 2.5,
    ),
  ]),
) as Record<ModelClass, THREE.Color>;

/** Tapered cone from the engine (z = 0, bright) back to a dark tip (z = -1). */
function trailGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 6, 1, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.fill(1 + pos.getZ(i), i * 3, i * 3 + 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Engine trails for every ship and pirate in a single additive instanced draw. */
function Trails() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => trailGeometry(), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const s = engine.view;
    const a = engine.alpha();
    pruneHeadings();
    let n = 0;
    const put = (id: number, pos: Vec3, cls: ModelClass) => {
      if (n >= MAX_TRAILS) return;
      lerpPos(id, pos, a, tmp);
      const h = heading(id, pos);
      const half = SHIP_LENGTH[cls] * 0.5;
      // Length follows speed; a short stub stays as the idle engine glow.
      const len = Math.min(half * 4, 0.4 + stepLength(id, pos) * 4);
      const w = half * 0.22;
      dummy.position.set(tmp.x - h.x * half, tmp.y - h.y * half, tmp.z - h.z * half);
      dummy.lookAt(dummy.position.x + h.x, dummy.position.y + h.y, dummy.position.z + h.z);
      dummy.scale.set(w, w, len);
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      m.setColorAt(n, TRAIL_COLOR[cls]);
      n++;
    };
    for (const sh of s.ships) if (sh.mode !== 'docked') put(sh.id, sh.pos, sh.cls);
    for (const p of s.pirates) put(p.id, p.pos, 'pirate');
    dummy.scale.setScalar(1);
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[geo, undefined, MAX_TRAILS]}
      frustumCulled={false}
      raycast={() => null}
    >
      <meshBasicMaterial
        vertexColors
        toneMapped={false}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

function Layers({
  models,
  lodDistance,
}: {
  models: THREE.BufferGeometry[] | null;
  lodDistance: number;
}) {
  return (
    <>
      {CLASSES.map((c, i) => (
        <ShipLayer key={c} cls={c} model={models?.[i] ?? null} lodDistance={lodDistance} />
      ))}
    </>
  );
}

function ModelLayers({ lodDistance }: { lodDistance: number }) {
  const gltfs = useGLTF(URLS, false, false);
  const models = useMemo(
    () => gltfs.map((g, i) => bakeModel(g.scene, classColor(CLASSES[i]), SHIP_LENGTH[CLASSES[i]])),
    [gltfs],
  );
  return <Layers models={models} lodDistance={lodDistance} />;
}

/** All ship classes plus trails. Placeholder shapes render until the models load. */
export function Fleet({ lodDistance }: { lodDistance: number }) {
  return (
    <>
      <Suspense fallback={<Layers models={null} lodDistance={lodDistance} />}>
        <ModelLayers lodDistance={lodDistance} />
      </Suspense>
      <Trails />
    </>
  );
}
