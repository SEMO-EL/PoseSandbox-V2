// controls/grab.js
// Drag a body part to pose it: no gizmo, no mode. This file is only the pointer plumbing — it finds what was
// pressed, follows the pointer on a plane through that point (facing the camera, or the floor), and hands each new
// point to the `apply` function that `start` returned. What a drag does to the figure lives in app.js.
//
// A press that doesn't move is still a click (Selection handles it); a press on the gizmo belongs to the gizmo.

import * as THREE from "three";

export function createGrab({ canvas, camera, orbit, gizmo, selection, start, end }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane();
  const n = new THREE.Vector3(), p = new THREE.Vector3();
  let g = null;

  // registered after the gizmo's and the orbit's own listeners, so gizmo.axis is already known for this press
  canvas.addEventListener("pointerdown", (e) => {
    if (g || !e.isPrimary || e.button !== 0 || gizmo.axis !== null || gizmo.dragging) return;
    const hit = selection.pickHit(e.clientX, e.clientY);
    if (!hit?.target?.userData.isJoint) return;
    const s = start(hit.target, hit.point);
    if (!s) return;
    plane.setFromNormalAndCoplanarPoint(s.normal || camera.getWorldDirection(n), hit.point);
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, apply: s.apply, joint: s.joint || hit.target, live: false };
    orbit.enabled = false; // the orbit has seen this press too; it ignores the moves while disabled
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.live) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
      g.live = true;
      selection.set(g.joint);
    }
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, p)) g.apply(p);
  });

  const stop = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const live = g.live;
    g = null;
    orbit.enabled = true;
    end(live);
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  return { active: () => !!g?.live };
}
