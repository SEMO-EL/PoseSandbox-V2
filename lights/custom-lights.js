// lights/custom-lights.js
// User-placed lights. Each is a Group holding the light, a clickable bulb and (for spots) a cone guide.
// Move the group to place the light; rotate it to aim a spot (it shines along its local +Z).
// Brightness is the light's intensity in candela with physical falloff (decay 2): 8 is a lamp ~2 m away.

import * as THREE from "three";

export const MAX_LIGHTS = 8;

export const LIGHT_DEFAULTS = {
  point: { color: "#ffd9a8", intensity: 5, range: 0, castShadow: false, showBulb: true },
  spot:  { color: "#ffffff", intensity: 24, range: 0, angle: 28, penumbra: 0.35, castShadow: true, showBulb: true }
};

const CONE_LEN = 0.55;

export function createCustomLight(type, params = {}) {
  const t = type === "spot" ? "spot" : "point";
  const g = new THREE.Group();
  g.name = t === "spot" ? "Spot light" : "Point light";
  g.userData.kind = "light";
  g.userData.lightType = t;

  const light = t === "spot" ? new THREE.SpotLight() : new THREE.PointLight();
  light.decay = 2;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  light.shadow.radius = 2;
  light.shadow.camera.near = 0.05;
  light.shadow.camera.far = 25;
  light.shadow.mapSize.set(t === "spot" ? 1024 : 512, t === "spot" ? 1024 : 512);
  if (t === "spot") {
    light.target.position.set(0, 0, 1); // a child, so it turns with the group
    g.add(light.target);
  }
  g.add(light);
  g.userData.light = light;

  const helperMat = (opts) => new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, ...opts });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), helperMat({}));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 10), helperMat({ wireframe: true, transparent: true, opacity: 0.3, depthWrite: false }));
  for (const m of [bulb, halo]) {
    m.userData.helper = true;
    m.userData.pickable = true;
    m.userData.selectRoot = g;
    g.add(m);
  }
  g.userData.bulb = bulb;
  g.userData.halo = halo;

  if (t === "spot") {
    const cone = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, fog: false, toneMapped: false }));
    cone.userData.helper = true;
    g.add(cone);
    g.userData.cone = cone;
  }

  applyLightParams(g, { ...LIGHT_DEFAULTS[t], ...params });
  return g;
}

function coneGeometry(angleDeg) {
  const r = CONE_LEN * Math.tan(THREE.MathUtils.degToRad(angleDeg));
  const pts = [];
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    pts.push(Math.cos(a0) * r, Math.sin(a0) * r, CONE_LEN, Math.cos(a1) * r, Math.sin(a1) * r, CONE_LEN);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pts.push(0, 0, 0, Math.cos(a) * r, Math.sin(a) * r, CONE_LEN);
  }
  return new THREE.Float32BufferAttribute(pts, 3);
}

export function applyLightParams(g, patch) {
  const p = { ...(g.userData.params || {}), ...patch };
  g.userData.params = p;
  const L = g.userData.light;
  L.color.set(p.color);
  L.intensity = Math.max(0, Number(p.intensity) || 0);
  L.distance = Math.max(0, Number(p.range) || 0);
  L.castShadow = !!p.castShadow;
  if (L.isSpotLight) {
    L.angle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(p.angle) || 28, 2, 85));
    L.penumbra = THREE.MathUtils.clamp(Number(p.penumbra) || 0, 0, 1);
    g.userData.cone.geometry.setAttribute("position", coneGeometry(THREE.MathUtils.radToDeg(L.angle)));
    g.userData.cone.material.color.set(p.color);
  }
  g.userData.bulb.material.color.set(p.color);
  g.userData.halo.material.color.set(p.color);
  for (const h of [g.userData.bulb, g.userData.halo, g.userData.cone]) if (h) h.visible = p.showBulb !== false;
  return p;
}

export function lightParams(g) {
  return { ...g.userData.params };
}
