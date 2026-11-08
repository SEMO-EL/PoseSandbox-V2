// controls/selection.js
// Picking, hover and selection highlight. A click (press + release without dragging) selects; a drag orbits.
// The selected part glows in the accent colour (emissive) instead of the old axis-aligned box.

import * as THREE from "three";

const ACCENT = new THREE.Color(0x7c5cff);
const LEVEL = { hover: 0.16, selected: 0.42 };

export class Selection {
  constructor({ camera, canvas, gizmo, getRoots, onChange, onHoverChange, resolveHit, paintJoints }) {
    this.resolveHit = resolveHit;   // skinned figure: hit -> joint
    this.paintJoints = paintJoints; // skinned figure: its shader draws the glow
    this.camera = camera;
    this.canvas = canvas;
    this.gizmo = gizmo;
    this.getRoots = getRoots;
    this.onChange = onChange;
    this.onHoverChange = onHoverChange;
    this.selected = null;
    this.hovered = null;
    this.enabled = true;     // highlight on/off (user setting)
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this._painted = new Map(); // mesh -> level currently applied

    let down = null;
    canvas.addEventListener("pointerdown", (e) => {
      // a press on the gizmo belongs to the gizmo
      down = e.isPrimary && e.button === 0 && this.gizmo.axis === null ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved < 6 && quick && !this.gizmo.dragging) this.set(this.pick(e.clientX, e.clientY));
    });
    let raf = 0, last = null;
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      last = e;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.setHover(this.gizmo.axis ? null : this.pick(last.clientX, last.clientY)); });
    });
    canvas.addEventListener("pointerleave", () => this.setHover(null));
  }

  get() {
    return this.selected;
  }

  /** The thing a click selects: a joint for body meshes, the item root for props, lights and imports. */
  resolve(mesh) {
    return mesh.userData.joint || mesh.userData.selectRoot || null;
  }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const meshes = [];
    for (const root of this.getRoots()) {
      root.traverseVisible((o) => { if (o.isMesh && o.userData.pickable) meshes.push(o); });
    }
    const hit = this.ray.intersectObjects(meshes, false)[0];
    return hit ? this.resolveHit?.(hit) || this.resolve(hit.object) : null;
  }

  set(target) {
    if (target === this.selected) return;
    this.selected = target || null;
    this.repaint();
    this.onChange?.(this.selected);
  }

  setHover(target) {
    if (target === this.hovered) return;
    this.hovered = target || null;
    this.repaint();
    this.onHoverChange?.(this.hovered);
  }

  meshesOf(target) {
    const out = [];
    if (!target) return out;
    const root = target.userData.isJoint ? target.userData.segment : target;
    root.traverse((o) => { if (o.isMesh) out.push(o); });
    return out;
  }

  /** Re-apply highlights (after a rebuild, an undo, or the setting changed). */
  repaint() {
    const want = new Map();
    if (this.enabled) {
      for (const m of this.meshesOf(this.hovered)) want.set(m, LEVEL.hover);
      for (const m of this.meshesOf(this.selected)) want.set(m, LEVEL.selected);
    }
    for (const [m] of this._painted) if (!want.has(m)) paint(m, 0);
    for (const [m, lvl] of want) paint(m, lvl);
    this._painted = want;
    const j = (x) => (this.enabled && x?.userData.isJoint ? x : null);
    this.paintJoints?.(j(this.selected), j(this.hovered));
  }

  /** Run fn with every highlight removed (exports, thumbnails). */
  withoutHighlights(fn) {
    for (const [m] of this._painted) paint(m, 0);
    this.paintJoints?.(null, null);
    try { return fn(); } finally { this.repaint(); }
  }
}

function paint(mesh, level) {
  for (const mat of [].concat(mesh.material)) {
    if (!mat) continue;
    const ud = mat.userData;
    if (mat.emissive) {
      if (ud.emissive === undefined) { ud.emissive = mat.emissive.getHex(); ud.emissiveIntensity = mat.emissiveIntensity; }
      if (level) { mat.emissive.copy(ACCENT).multiplyScalar(level); mat.emissiveIntensity = 1; }
      else { mat.emissive.setHex(ud.emissive); mat.emissiveIntensity = ud.emissiveIntensity; }
    } else if (mat.transparent) { // helpers: the floor ring, a light's halo
      if (ud.opacity === undefined) ud.opacity = mat.opacity;
      mat.opacity = level ? Math.min(1, ud.opacity + level * 1.6) : ud.opacity;
    }
  }
}
