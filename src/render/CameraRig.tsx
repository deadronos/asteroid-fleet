import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { engine } from '../game/engine';
import { CAMERA_OFFSET } from './constants';
import { fleetFrame } from './frameState';
import type { Fx, Vec3 } from '../sim/types';
import { useHotkeys } from '../ui/hotkeys';
import {
  easeFactor,
  focus,
  resolveFocus,
  shakeDecay,
  stepTactical,
  takeTacticalExit,
  tacticalEase,
  warpFov,
} from './focus';

const FOCUS_DISTANCE = 45;
const FOLLOW_RATE = 7;
const TRANS_SECONDS = 0.45;
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
  const { camera, gl, set } = useThree();
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 8;
    c.maxDistance = 360;
    return c;
  }, [camera, gl.domElement]);
  useEffect(() => {
    set({ controls });
    return () => {
      controls.dispose();
    };
  }, [controls, set]);
  const reduceMotion = useMemo(
    () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const anchor = useRef(new THREE.Vector3());
  const started = useRef(false);
  const system = useRef(-1);
  const carrierId = useRef(-1);
  const lastFocus = useRef<number | null>(null);
  const autoOn = useRef(false);
  const wasTactical = useRef(tactical);
  const trans = useRef({ active: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
  const shake = useRef(0);
  const shakeOff = useRef(new THREE.Vector3());
  const fov = useRef(55);
  const hull = useRef(-1);
  const warping = useRef(false);
  const lastBoom = useRef(-Infinity);
  const prevFx = useRef<readonly Fx[]>([]);

  // Taking over the orbit cancels an in-flight tactical move, so the user is never fought.
  useEffect(() => {
    const cancel = () => {
      trans.current.active = false;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useHotkeys([
    {
      keys: ['Escape'],
      label: 'Esc',
      description: 'Close the open dialog, else follow the carrier again',
      group: 'General',
      run: () => focus.set(null),
    },
  ]);

  const startTrans = (x: number, y: number, z: number) => {
    const t = trans.current;
    t.from.copy(camera.position);
    t.to.set(x, y, z);
    t.t = 0;
    t.active = true;
  };

  useFrame((st, dt) => {
    const c = controls;
    const s = engine.view;
    const a = engine.alpha();
    const now = st.clock.elapsedTime;

    // Undo last frame's shake before following, or the offset accumulates into the orbit (#237).
    camera.position.sub(shakeOff.current);

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
      const switched = !started.current || carrierId.current !== s.id;
      trans.current.active = false;
      delta.copy(goal).sub(anchor.current);
      anchor.current.copy(goal);
      c.target.add(delta);
      camera.position.add(delta);
      if (switched) {
        hull.current = s.carrier.hull;
        warping.current = !!s.warp;
        shake.current = 0;
        shakeOff.current.set(0, 0, 0);
        prevFx.current = s.fx;
      }
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

    if (tactical && !wasTactical.current) startTrans(c.target.x, c.target.y + 230, c.target.z + 1);
    // Leaving from auto-tactical: pretend manual tactical was on and is now off.
    const exit = takeTacticalExit();
    const step = stepTactical({
      wasTactical: wasTactical.current || exit,
      tactical,
      auto: autoOn.current,
      dist: camera.position.distanceTo(c.target),
    });
    if (step.resetCamera)
      startTrans(
        c.target.x + CAMERA_OFFSET[0],
        c.target.y + CAMERA_OFFSET[1],
        c.target.z + CAMERA_OFFSET[2],
      );
    wasTactical.current = tactical;
    if (step.auto !== autoOn.current) {
      autoOn.current = step.auto;
      onAutoTactical(step.auto);
    }

    const tr = trans.current;
    if (tr.active) {
      tr.t = Math.min(1, tr.t + Math.min(dt, 0.1) / TRANS_SECONDS);
      camera.position.lerpVectors(tr.from, tr.to, tacticalEase(tr.t));
      if (tr.t >= 1) tr.active = false;
    }
    c.update();

    // Warp charge widens the lens slightly in the final two seconds; eases back to 55 on jump/cancel.
    const targetFov = !reduceMotion && s.warp ? warpFov(s.warp.charge) : 55;
    const nextFov = fov.current + (targetFov - fov.current) * easeFactor(dt, 5);
    if (Math.abs(nextFov - fov.current) > 1e-4) {
      fov.current = nextFov;
      (camera as THREE.PerspectiveCamera).fov = nextFov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }

    if (!reduceMotion) {
      if (hull.current >= 0 && s.carrier.hull < hull.current - 1e-4)
        shake.current = Math.min(1, shake.current + 0.55);
      hull.current = s.carrier.hull;
      if (s.warp && !warping.current) shake.current = Math.min(1, shake.current + 0.35);
      warping.current = !!s.warp;
      if (s.fx !== prevFx.current) {
        if (now - lastBoom.current > 0.12) {
          for (const f of s.fx) {
            if (f.kind !== 'explosion') continue;
            if (
              prevFx.current.some(
                (p) =>
                  p.kind === 'explosion' &&
                  p.a.x === f.a.x &&
                  p.a.y === f.a.y &&
                  p.a.z === f.a.z &&
                  p.ttl >= f.ttl,
              )
            )
              continue;
            const dx = f.a.x - c.target.x;
            const dy = f.a.y - c.target.y;
            const dz = f.a.z - c.target.z;
            if (dx * dx + dy * dy + dz * dz < 3600) {
              shake.current = Math.min(1, shake.current + 0.12);
              lastBoom.current = now;
              break;
            }
          }
        }
        prevFx.current = s.fx;
      }
      shake.current = shakeDecay(shake.current, dt);
      if (shake.current > 0.002) {
        const amp = shake.current * 0.9;
        shakeOff.current.set(
          Math.sin(now * 47.3) * amp,
          Math.sin(now * 61.7) * amp * 0.7,
          Math.sin(now * 53.1) * amp,
        );
      } else shakeOff.current.set(0, 0, 0);
      camera.position.add(shakeOff.current);
    }
  });
  return null;
}

/** Carrier position uses its own previous-tick snapshot rather than the per-id map. */
function carrierPos(a: number) {
  const p = engine.prevCarrier;
  const cur = engine.view.carrier.pos;
  tmp.x = p.x + (cur.x - p.x) * a;
  tmp.y = p.y + (cur.y - p.y) * a;
  tmp.z = p.z + (cur.z - p.z) * a;
}
