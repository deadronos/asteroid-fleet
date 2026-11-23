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

/** Shared vertex shader for Fresnel rim shells (carrier shield, hazard bounds, H2 storm). */
export const FRESNEL_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vLocalPos;
void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPos.xyz);
  vLocalPos = normalize(position);
  gl_Position = projectionMatrix * mvPos;
}`;

export const SHIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uShield;
uniform float uHitFlash;
uniform vec3 uColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vLocalPos;
void main() {
  float ndotv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float fresnel = pow(max(1.0 - ndotv, 0.001), 2.5);
  float band = 0.85 + 0.15 * sin(vLocalPos.y * 18.0 - uTime * 3.0);
  float lowMask = 1.0 - smoothstep(0.05, 0.25, uShield);
  float flicker = mix(1.0, 0.45 + 0.55 * sin(uTime * 28.0) * sin(uTime * 11.0), lowMask);
  vec3 col = mix(uColor, vec3(0.85, 0.96, 1.0), uHitFlash * 0.7) * (1.25 + uHitFlash * 2.2);
  float alpha = clamp(
    fresnel * (0.58 * (0.25 + 0.75 * uShield) * flicker + uHitFlash * 1.15) * band + uHitFlash * 0.18,
    0.0,
    1.0
  );
  gl_FragColor = vec4(col, alpha);
}`;

export const DEBRIS_SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vLocalPos;
void main() {
  float ndotv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float fresnel = pow(max(1.0 - ndotv, 0.001), 2.6);
  float ring = 0.8 + 0.2 * sin(vLocalPos.y * 10.0);
  float alpha = clamp(fresnel * 0.34 * ring + 0.02, 0.0, 0.5);
  gl_FragColor = vec4(uColor, alpha);
}`;

export const RADIATION_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vLocalPos;
void main() {
  float ndotv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float fresnel = pow(max(1.0 - ndotv, 0.001), 2.0);
  vec3 p = vLocalPos * 4.5;
  float w1 = sin(p.x + uTime * 0.9) * cos(p.y - uTime * 0.7) + sin(p.z + uTime * 0.6);
  float w2 = sin(p.y * 2.1 - uTime * 1.4) * cos(p.z * 2.1 + uTime * 1.1);
  float wave = clamp(0.55 + 0.25 * w1 + 0.2 * w2, 0.25, 1.35);
  float pulse = 0.8 + 0.2 * sin(uTime * 2.2);
  float alpha = clamp((fresnel * 0.65 + 0.08) * wave * pulse, 0.0, 0.85);
  gl_FragColor = vec4(uColor * (1.1 + fresnel * 0.9), alpha);
}`;

export const STORM_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vLocalPos;
void main() {
  float ndotv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float fresnel = pow(max(1.0 - ndotv, 0.001), 1.8);
  float t = uTime * 0.7 + vLocalPos.y * 2.4;
  float c = cos(t);
  float s = sin(t);
  vec3 q = vec3(vLocalPos.x * c - vLocalPos.z * s, vLocalPos.y, vLocalPos.x * s + vLocalPos.z * c);
  float w1 = sin(q.x * 5.0 + q.y * 4.0) * cos(q.z * 5.0 - uTime * 0.9);
  float w2 = sin((q.x + q.z) * 7.0 - q.y * 6.0 + uTime * 1.4);
  float bands = smoothstep(-0.25, 0.85, w1 * 0.6 + w2 * 0.4);
  vec3 col = mix(vec3(1.0, 0.52, 0.22), vec3(0.75, 0.92, 1.0), bands * 0.55);
  float alpha = clamp((fresnel * 0.55 + 0.12) * (0.35 + 0.65 * bands), 0.0, 0.85);
  gl_FragColor = vec4(col * (1.2 + fresnel * 0.8), alpha);
}`;
