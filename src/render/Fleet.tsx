import { useGLTF } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SHIP_STATS } from '../sim/config';
import { shipGeometry } from './geometry';
import { focus } from './focus';
import { CLASSES, fleetFrame } from './frameState';
import { SHIP_LENGTH, SHIP_MODEL, bakeModel, modelUrl, type ModelClass } from './models';

// Sized for the 1000-ship sim cap; the buffers are allocated once per layer.
const MAX_PER_CLASS = 1000;
const MAX_TRAILS = 2048;
const URLS = CLASSES.map((c) => modelUrl(SHIP_MODEL[c]));

const dummy = new THREE.Object3D();
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

  const ci = CLASSES.indexOf(cls);
  useFrame(({ camera }) => {
    const nm = near.current;
    const fm = far.current;
    if (!fm) return;
    const f = fleetFrame;
    const lod2 = model ? lodDistance * lodDistance : -1;
    camPos.copy(camera.position);
    const list = f.bucket[ci];
    const total = Math.min(f.bucketLen[ci], MAX_PER_CLASS);
    let nn = 0;
    let nf = 0;
    for (let k = 0; k < total; k++) {
      const i = list[k];
      const o = i * 3;
      const x = f.pos[o];
      const y = f.pos[o + 1];
      const z = f.pos[o + 2];
      dummy.position.set(x, y, z);
      dummy.lookAt(x + f.hdg[o], y + f.hdg[o + 1], z + f.hdg[o + 2]);
      dummy.updateMatrix();
      const d2 = camPos.distanceToSquared(dummy.position);
      if (nm && d2 < lod2) {
        nearIds[nn] = f.ids[i];
        nm.setMatrixAt(nn++, dummy.matrix);
      } else {
        farIds[nf] = f.ids[i];
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
    const f = fleetFrame;
    const n = Math.min(f.count, MAX_TRAILS);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const cls = CLASSES[f.cls[i]];
      const half = SHIP_LENGTH[cls] * 0.5;
      const hx = f.hdg[o];
      const hy = f.hdg[o + 1];
      const hz = f.hdg[o + 2];
      // Length follows speed; a short stub stays as the idle engine glow.
      const len = Math.min(half * 4, 0.4 + f.step[i] * 4);
      const w = half * 0.22;
      dummy.position.set(f.pos[o] - hx * half, f.pos[o + 1] - hy * half, f.pos[o + 2] - hz * half);
      dummy.lookAt(dummy.position.x + hx, dummy.position.y + hy, dummy.position.z + hz);
      dummy.scale.set(w, w, len);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, TRAIL_COLOR[cls]);
    }
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
