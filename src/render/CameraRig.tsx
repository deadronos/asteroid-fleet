import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { engine } from '../game/engine';
import { fleetFrame } from './frameState';
import type { Vec3 } from '../sim/types';
import { easeFactor, focus, resolveFocus, stepTactical } from './focus';

const FOCUS_DISTANCE = 45;
const FOLLOW_RATE = 7;
const tmp: Vec3 = { x: 0, y: 0, z: 0 };
const goal = new THREE.Vector3();
const delta = new THREE.Vector3();
const dir = new THREE.Vector3();

/** Orbit camera that tracks the carrier, or the focused ship with eased, interpolated motion. */
export function CameraRig({
  tactical,
  onAutoTactical,
}: {
  tactical: boolean;
  onAutoTactical: (on: boolean) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const anchor = useRef(new THREE.Vector3());
  const started = useRef(false);
  const system = useRef(-1);
  const carrierId = useRef(-1);
  const lastFocus = useRef<number | null>(null);
  const autoOn = useRef(false);
  const wasTactical = useRef(tactical);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && focus.set(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const s = engine.view;
    const a = engine.alpha();

    const id = resolveFocus(s, focus.get());
    if (id !== focus.get()) focus.set(id); // docked or destroyed: back to the carrier
    const ei = id === null ? -1 : fleetFrame.entityOf(id);
    if (ei >= 0) {
      tmp.x = fleetFrame.pos[ei * 3];
      tmp.y = fleetFrame.pos[ei * 3 + 1];
      tmp.z = fleetFrame.pos[ei * 3 + 2];
    } else carrierPos(a);
    goal.set(tmp.x, tmp.y, tmp.z);

    const jumped = !started.current || system.current !== s.systemId || carrierId.current !== s.id;
    if (jumped) {
      delta.copy(goal).sub(anchor.current);
      anchor.current.copy(goal);
      c.target.add(delta);
      camera.position.add(delta);
      started.current = true;
      system.current = s.systemId;
      carrierId.current = s.id;
    } else {
      // Ease toward the followed point; the carrier is slow enough that this is imperceptible.
      delta.copy(goal).sub(anchor.current).multiplyScalar(easeFactor(dt, FOLLOW_RATE));
      anchor.current.add(delta);
      c.target.add(delta);
      camera.position.add(delta);
    }

    if (id !== lastFocus.current) {
      if (id !== null) {
        // Pull in so a focused ship is not a speck from tactical distance.
        dir.copy(camera.position).sub(c.target);
        if (dir.length() > FOCUS_DISTANCE)
          camera.position.copy(c.target).addScaledVector(dir.normalize(), FOCUS_DISTANCE);
      }
      lastFocus.current = id;
    }

    if (tactical && !wasTactical.current) {
      camera.position.set(c.target.x, c.target.y + 230, c.target.z + 1);
    }
    const step = stepTactical({
      wasTactical: wasTactical.current,
      tactical,
      auto: autoOn.current,
      dist: camera.position.distanceTo(c.target),
    });
    if (step.resetCamera) camera.position.set(c.target.x + 40, c.target.y + 28, c.target.z + 55);
    wasTactical.current = tactical;
    if (step.auto !== autoOn.current) {
      autoOn.current = step.auto;
      onAutoTactical(step.auto);
    }
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={360}
    />
  );
}

/** Carrier position uses its own previous-tick snapshot rather than the per-id map. */
function carrierPos(a: number) {
  const p = engine.prevCarrier;
  const cur = engine.view.carrier.pos;
  tmp.x = p.x + (cur.x - p.x) * a;
  tmp.y = p.y + (cur.y - p.y) * a;
  tmp.z = p.z + (cur.z - p.z) * a;
}
