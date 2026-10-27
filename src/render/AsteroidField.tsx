import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engine } from '../game/engine';
import { asteroidGeometry } from './geometry';
import { ASTEROID_MODEL, bakeModel, modelUrl } from './models';

const MAX_ASTEROIDS = 1000;
const dummy = new THREE.Object3D();
const colorDirty = [false, false];
const camPos = new THREE.Vector3();

const ORE_COLORS = [
  new THREE.Color('#8b7d6b'),
  new THREE.Color('#7f8fa3'),
  new THREE.Color('#5fb3c9'),
  new THREE.Color('#b77be0'),
  new THREE.Color('#ff7df0'),
];

/** Near asteroids use the glTF meteor; far ones a 20-triangle icosahedron. */
function Field({
  model,
  lodDistance,
}: {
  model: THREE.BufferGeometry | null;
  lodDistance: number;
}) {
  const near = useRef<THREE.InstancedMesh>(null);
  const far = useRef<THREE.InstancedMesh>(null);
  const farGeo = useMemo(() => asteroidGeometry(0), []);
  // Ore tier last written to each instance slot, so unchanged colours aren't re-uploaded.
  const nearTier = useMemo(() => new Uint8Array(MAX_ASTEROIDS).fill(255), []);
  const farTier = useMemo(() => new Uint8Array(MAX_ASTEROIDS).fill(255), []);
  useFrame((st) => {
    const nm = near.current;
    const fm = far.current;
    if (!fm) return;
    const t = st.clock.elapsedTime;
    const hasNear = nm !== null;
    camPos.copy(st.camera.position);
    let nn = 0;
    let nf = 0;
    colorDirty[0] = colorDirty[1] = false;
    for (const a of engine.view.asteroids) {
      if (a.ore <= 0) continue;
      if (nn + nf >= MAX_ASTEROIDS) break;
      const k = 0.45 + 0.55 * (a.ore / a.maxOre);
      dummy.position.set(a.pos.x, a.pos.y, a.pos.z);
      dummy.rotation.set(a.id * 0.7 + t * 0.05 * ((a.id % 3) - 1), a.id * 1.3 + t * 0.03, 0);
      dummy.scale.setScalar(a.radius * k);
      dummy.updateMatrix();
      const tier = a.value < 2 ? 0 : a.value < 5 ? 1 : a.value < 15 ? 2 : a.value < 40 ? 3 : 4;
      // Allow for the asteroid's size, so big rocks switch later.
      const reach = lodDistance + a.radius * 4;
      const isNear = hasNear && camPos.distanceToSquared(dummy.position) < reach * reach;
      const m = isNear ? nm : fm;
      const tiers = isNear ? nearTier : farTier;
      const i = isNear ? nn++ : nf++;
      m.setMatrixAt(i, dummy.matrix);
      if (tiers[i] !== tier) {
        tiers[i] = tier;
        m.setColorAt(i, ORE_COLORS[tier]);
        colorDirty[isNear ? 1 : 0] = true;
      }
    }
    fm.count = nf;
    fm.instanceMatrix.needsUpdate = true;
    if (colorDirty[0] && fm.instanceColor) fm.instanceColor.needsUpdate = true;
    if (nm) {
      nm.count = nn;
      nm.instanceMatrix.needsUpdate = true;
      if (colorDirty[1] && nm.instanceColor) nm.instanceColor.needsUpdate = true;
    }
  });
  return (
    <>
      {model && (
        <instancedMesh ref={near} args={[model, undefined, MAX_ASTEROIDS]} frustumCulled={false}>
          <meshStandardMaterial roughness={0.95} metalness={0.05} flatShading />
        </instancedMesh>
      )}
      <instancedMesh ref={far} args={[farGeo, undefined, MAX_ASTEROIDS]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.95} metalness={0.05} flatShading />
      </instancedMesh>
    </>
  );
}

function ModelField({ lodDistance }: { lodDistance: number }) {
  const gltf = useGLTF(modelUrl(ASTEROID_MODEL), false, false);
  const model = useMemo(() => {
    const g = bakeModel(gltf.scene);
    // Instance colours carry the ore tier; drop the kit's baked rock colour.
    g.deleteAttribute('color');
    return g;
  }, [gltf]);
  return <Field model={model} lodDistance={lodDistance} />;
}

export function AsteroidField({ lodDistance }: { lodDistance: number }) {
  return (
    <Suspense fallback={<Field model={null} lodDistance={lodDistance} />}>
      <ModelField lodDistance={lodDistance} />
    </Suspense>
  );
}
