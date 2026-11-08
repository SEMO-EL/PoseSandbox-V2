// engine/scene.js
// Scene, camera (with a real lens in mm), orbit + smooth wheel zoom, gizmo, studio light rig, floor, grid, axes.
// World units are metres; the figure stands on y = 0 and is ~1.8 m tall.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

export const BACKGROUNDS = {
  midnight: { label: "Midnight", bg: 0x0b0f17, floor: 0x131a29, grid: [0x2a3550, 0x1a2234] },
  studio:   { label: "Studio",   bg: 0x10131a, floor: 0x191d27, grid: [0x313848, 0x1f2430] },
  graphite: { label: "Graphite", bg: 0x0b0b10, floor: 0x15151c, grid: [0x2c2c38, 0x1c1c24] },
  dawn:     { label: "Dawn",     bg: 0x111a2b, floor: 0x18243a, grid: [0x34466a, 0x223049] },
  mint:     { label: "Mint",     bg: 0x0b1a18, floor: 0x112521, grid: [0x24493f, 0x18302b] },
  sunset:   { label: "Sunset",   bg: 0x1a0f17, floor: 0x251621, grid: [0x4a2a3e, 0x30202b] },
  white:    { label: "White",    bg: 0xf2f4f8, floor: 0xe4e7ee, grid: [0xb9bfcc, 0xd3d7e0] },
  black:    { label: "Black",    bg: 0x000000, floor: 0x0b0b0d, grid: [0x26262c, 0x16161a] }
};

export const VIEWS = {
  front: [0, 0.08, 1], back: [0, 0.08, -1], right: [-1, 0.08, 0], left: [1, 0.08, 0],
  top: [0, 1, 0.0001], threequarter: [0.75, 0.32, 1]
};

const LENS_SENSOR = 24; // full-frame sensor height (mm): fov = 2·atan(12 / f)
export const fovFromLens = (mm) => THREE.MathUtils.radToDeg(2 * Math.atan(LENS_SENSOR / 2 / mm));

export const LIGHT_PRESETS = {
  studio: { hemi: [0x9bb2ff, 0x151a22, 0.55], ambient: [0xffffff, 0.25], key: [0xffffff, 2.4, "front_right"], fill: [0x88bbff, 0.6], rim: [0xaad9ff, 0.9] },
  flat:   { hemi: [0xffffff, 0xffffff, 0.35], ambient: [0xffffff, 1.4], key: [0xffffff, 0.8, "front"], fill: [0xffffff, 0.6], rim: [0xffffff, 0.1] },
  moody:  { hemi: [0x6a7cff, 0x0b0f17, 0.2], ambient: [0xffffff, 0.08], key: [0xfff1dd, 3.0, "front_left"], fill: [0x5aa0ff, 0.25], rim: [0x9fd7ff, 1.2] },
  rim:    { hemi: [0x9bb2ff, 0x151a22, 0.15], ambient: [0xffffff, 0.08], key: [0xffffff, 1.0, "back_right"], fill: [0x88bbff, 0.2], rim: [0xe6f6ff, 2.6] },
  sunset: { hemi: [0xffb27a, 0x2a1622, 0.45], ambient: [0xffd2b0, 0.15], key: [0xffa05a, 2.6, "left"], fill: [0x6b7dff, 0.5], rim: [0xffd6a0, 1.0] }
};

const KEY_DIRS = {
  front_right: [3, 5, 2.4], front_left: [-3, 5, 2.4], front: [0, 5, 3.6], left: [-4.5, 2.6, 0.6],
  right: [4.5, 2.6, 0.6], top: [0, 6, 0.01], back_right: [3, 4, -3.5], back_left: [-3, 4, -3.5]
};

export function createScene({ renderer, canvas }) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(fovFromLens(35), 1, 0.03, 100);
  camera.position.set(2.1, 1.55, 3.4);
  scene.add(camera); // camera children (reference image) render

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0.92, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.09;
  orbit.minDistance = 0.35;
  orbit.maxDistance = 40;
  orbit.update();

  /* smooth wheel zoom: OrbitControls' wheel steps feel jumpy on mouse wheels, so ease the distance instead */
  let desired = camera.position.distanceTo(orbit.target);
  let zoomRaf = 0;
  const dir = new THREE.Vector3();
  function zoomStep() {
    zoomRaf = 0;
    const cur = camera.position.distanceTo(orbit.target);
    if (Math.abs(cur - desired) <= Math.max(0.0015, desired * 0.001)) return;
    dir.copy(camera.position).sub(orbit.target).normalize();
    camera.position.copy(orbit.target).addScaledVector(dir, THREE.MathUtils.lerp(cur, desired, 0.2));
    orbit.update();
    zoomRaf = requestAnimationFrame(zoomStep);
  }
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 200 : 1);
    const cur = camera.position.distanceTo(orbit.target);
    desired = THREE.MathUtils.clamp(cur * Math.exp(delta * 0.0013), orbit.minDistance, orbit.maxDistance);
    if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
  }, { passive: false, capture: true });

  /* gizmo */
  const gizmo = new TransformControls(camera, canvas);
  gizmo.setMode("rotate");
  gizmo.setSpace("local");
  gizmo.size = 0.9;
  const gizmoHelper = gizmo.getHelper();
  gizmoHelper.userData.helper = true;
  scene.add(gizmoHelper);

  /* studio lights */
  const hemi = new THREE.HemisphereLight(0x9bb2ff, 0x151a22, 0.5);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { near: 0.5, far: 18, left: -3.2, right: 3.2, top: 3.2, bottom: -3.2 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(0x88bbff, 0.6);
  fill.position.set(-4, 2.4, -3);
  const rim = new THREE.DirectionalLight(0xaad9ff, 0.9);
  rim.position.set(-1.2, 2.6, -4.2);
  scene.add(hemi, ambient, key, fill, rim);
  const lights = { hemi, ambient, key, fill, rim };

  /* floor + grid + axes */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.floor = true;
  scene.add(floor);

  let grid = null;
  const axes = new THREE.AxesHelper(0.8);
  axes.visible = false;
  axes.userData.helper = true;
  scene.add(axes);

  function setBackground(name) {
    const b = BACKGROUNDS[name] || BACKGROUNDS.midnight;
    scene.background = new THREE.Color(b.bg);
    scene.fog = new THREE.Fog(b.bg, 9, 26); // the floor melts into the backdrop instead of ending at a hard edge
    floor.material.color.setHex(b.floor);
    const visible = grid ? grid.visible : true;
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(24, 48, b.grid[0], b.grid[1]);
    grid.position.y = 0.002;
    grid.visible = visible;
    grid.userData.helper = true;
    scene.add(grid);
    return b;
  }

  function setKeyDirection(name) {
    key.position.set(...(KEY_DIRS[name] || KEY_DIRS.front_right));
  }

  function applyLightingPreset(name) {
    const p = LIGHT_PRESETS[name] || LIGHT_PRESETS.studio;
    hemi.color.setHex(p.hemi[0]); hemi.groundColor.setHex(p.hemi[1]); hemi.intensity = p.hemi[2];
    ambient.color.setHex(p.ambient[0]); ambient.intensity = p.ambient[1];
    key.color.setHex(p.key[0]); key.intensity = p.key[1]; setKeyDirection(p.key[2]);
    fill.color.setHex(p.fill[0]); fill.intensity = p.fill[1];
    rim.color.setHex(p.rim[0]); rim.intensity = p.rim[1];
    return p.key[2];
  }

  /** Change the lens and dolly so the subject keeps its size on screen (perspective changes, framing doesn't). */
  function setLens(mm) {
    const oldFov = camera.fov;
    camera.fov = fovFromLens(mm);
    camera.updateProjectionMatrix();
    const k = Math.tan(THREE.MathUtils.degToRad(oldFov) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    dir.copy(camera.position).sub(orbit.target);
    const d = THREE.MathUtils.clamp(dir.length() * k, orbit.minDistance, orbit.maxDistance);
    camera.position.copy(orbit.target).addScaledVector(dir.normalize(), d);
    desired = d;
    orbit.update();
  }

  function viewFrom(name) {
    const v = VIEWS[name];
    if (!v) return;
    const d = camera.position.distanceTo(orbit.target);
    camera.position.copy(orbit.target).addScaledVector(new THREE.Vector3(...v).normalize(), d);
    desired = d;
    orbit.update();
  }

  /** Point the camera at a box and back off until it fits. */
  function frameBox(box, pad = 1.25) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const d = THREE.MathUtils.clamp((sphere.radius * pad) / Math.sin(Math.min(fov, fov * camera.aspect) / 2), orbit.minDistance, orbit.maxDistance);
    dir.copy(camera.position).sub(orbit.target).normalize();
    orbit.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, d);
    desired = d;
    orbit.update();
  }

  function cameraState() {
    return { position: camera.position.toArray(), target: orbit.target.toArray(), fov: +camera.fov.toFixed(3) };
  }

  function setCameraState(c) {
    if (!c?.position || !c?.target) return;
    camera.position.fromArray(c.position);
    orbit.target.fromArray(c.target);
    if (c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    desired = camera.position.distanceTo(orbit.target);
    orbit.update();
  }

  setBackground("midnight");
  applyLightingPreset("studio");

  return {
    scene, camera, orbit, gizmo, gizmoHelper, lights, floor, axes,
    grid: () => grid,
    setBackground, setKeyDirection, applyLightingPreset, setLens, viewFrom, frameBox, cameraState, setCameraState
  };
}
