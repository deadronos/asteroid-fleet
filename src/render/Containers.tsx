import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engine } from '../game/engine';
import { CONTAINER_TTL } from '../sim/mining';

const MAX_CONTAINERS = 64;
const dummy = new THREE.Object3D();

/** Salvage containers from destroyed barges: one instanced box, one draw call (none when empty). */
export function Containers() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1.2, 0.8, 0.8), []);
  useFrame((st) => {
    const m = mesh.current;
    if (!m) return;
    const t = st.clock.elapsedTime;
    let n = 0;
    for (const c of engine.view.containers) {
      if (n >= MAX_CONTAINERS) break;
      dummy.position.set(c.pos.x, c.pos.y, c.pos.z);
      dummy.rotation.set(t * 0.4 + c.id, t * 0.3, 0);
      // Shrinks as it decays.
      dummy.scale.setScalar(0.5 + 0.5 * Math.min(1, c.ttl / CONTAINER_TTL));
      dummy.updateMatrix();
      m.setMatrixAt(n++, dummy.matrix);
    }
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[geo, undefined, MAX_CONTAINERS]} frustumCulled={false}>
      <meshStandardMaterial
        color="#f2b632"
        emissive="#f2b632"
        emissiveIntensity={0.4}
        roughness={0.6}
        metalness={0.4}
        flatShading
      />
    </instancedMesh>
  );
}
