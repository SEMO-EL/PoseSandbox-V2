// engine/reference.js
// A reference image pinned to the camera: either over the figure (trace mode) or behind it (backdrop mode).
// Size and offsets are fractions of the view, so the image keeps its place when the lens or window changes.

import * as THREE from "three";

export function createReference(camera) {
  const state = { enabled: false, behind: false, opacity: 0.6, size: 0.8, offsetX: 0, offsetY: 0, flipX: false, aspect: 1 };

  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = "reference_image";
  mesh.visible = false;
  mesh.userData.reference = true;
  camera.add(mesh);

  function update() {
    const d = state.behind ? camera.far * 0.9 : Math.max(camera.near * 4, 0.2);
    const viewH = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const h = viewH * state.size;
    mesh.scale.set(h * state.aspect * (state.flipX ? -1 : 1), h, 1);
    mesh.position.set(state.offsetX * viewH, state.offsetY * viewH, -d);
    // over: transparent, drawn last on top of everything. behind: opaque and drawn first, so the figure covers it
    // (opaque objects always draw before transparent ones); there "opacity" dims the image instead.
    if (mat.transparent === state.behind) { mat.transparent = !state.behind; mat.needsUpdate = true; }
    mat.opacity = state.behind ? 1 : state.opacity;
    mat.color.setScalar(state.behind ? state.opacity : 1);
    mat.depthTest = false;
    mesh.renderOrder = state.behind ? -10 : 9999;
    mesh.visible = state.enabled && !!mat.map;
  }

  async function load(file) {
    const url = URL.createObjectURL(file);
    try {
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map?.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
      state.aspect = (tex.image.width || 1) / (tex.image.height || 1);
      state.enabled = true;
      update();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function clear() {
    mat.map?.dispose();
    mat.map = null;
    mat.needsUpdate = true;
    state.enabled = false;
    update();
  }

  return { state, mesh, update, load, clear, hasImage: () => !!mat.map };
}
