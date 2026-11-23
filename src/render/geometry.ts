import * as THREE from 'three';
import { seeded } from '../sim/math';
import type { ShipClass } from '../sim/types';

/** Low-poly ship shapes, nose pointing +Z so Object3D.lookAt aims them. */
export function shipGeometry(cls: ShipClass | 'pirate'): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (cls) {
    case 'drone':
      g = new THREE.OctahedronGeometry(0.45);
      g.scale(1, 0.6, 1.4);
      break;
    case 'barge':
      g = new THREE.BoxGeometry(2.6, 1.3, 4.4);
      break;
    case 'hauler':
      g = new THREE.BoxGeometry(1.3, 1.1, 2.8);
      break;
    case 'fighter':
      g = new THREE.ConeGeometry(0.55, 2, 4);
      g.rotateX(Math.PI / 2);
      g.scale(1.4, 0.5, 1);
      break;
    case 'scout':
      g = new THREE.ConeGeometry(0.35, 1.8, 3);
      g.rotateX(Math.PI / 2);
      break;
    case 'repair':
      g = new THREE.DodecahedronGeometry(0.55);
      break;
    case 'harvester':
      g = new THREE.CylinderGeometry(0.9, 0.7, 3, 6);
      g.rotateX(Math.PI / 2);
      break;
    case 'pirate':
      g = new THREE.ConeGeometry(0.8, 2.2, 3);
      g.rotateX(Math.PI / 2);
      g.scale(1.6, 0.5, 1);
      break;
  }
  g.scale(1.6, 1.6, 1.6);
  g.computeVertexNormals();
  return g;
}

export function asteroidGeometry(detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const r = seeded(99);
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let f = seen.get(key);
    if (f === undefined) {
      f = 0.75 + r() * 0.5;
      seen.set(key, f);
    }
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.85, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

export const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const NEBULA_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
const float PI = 3.141592653589793;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  // Match Three.js SphereGeometry UV-to-direction mapping so the baked equirectangular map aligns identically.
  float phi = vUv.x * 2.0 * PI;
  float theta = (1.0 - vUv.y) * PI;
  float st = sin(theta);
  vec3 vDir = vec3(-cos(phi) * st, cos(theta), sin(phi) * st);
  float n = fbm(vDir * 2.5);
  float m = smoothstep(0.45, 0.85, n);
  float band = exp(-pow(vDir.y * 3.0, 2.0));
  vec3 col = vec3(0.004, 0.006, 0.014) + uA * m * 0.35 * band + uB * pow(m, 3.0) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`;

export const GAS_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vP;
void main() {
  float b = sin(vP.y * 0.45 + sin(vP.x * 0.08 + uTime * 0.05) * 2.0) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.75, 0.45, 0.22), vec3(0.95, 0.8, 0.55), b);
  float light = clamp(dot(normalize(vN), normalize(vec3(0.6, 0.4, -0.7))), 0.05, 1.0);
  gl_FragColor = vec4(col * light, 1.0);
}`;

export const GAS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vN = normalMatrix * normal;
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
