// engine/loop.js
// Render on demand: a frame is drawn only when something asked for it (invalidate) or the camera is still moving
// (orbit damping / smooth zoom). An idle editor costs nothing — no fans, no battery drain.

export function createLoop({ renderer, scene, camera, orbit }) {
  let dirty = true;
  const stats = { ms: 0, calls: 0, tris: 0 };

  function frame() {
    requestAnimationFrame(frame);
    const moved = orbit.update(); // true while damping is still moving the camera
    if (!dirty && !moved) return;
    dirty = false;
    const t0 = performance.now();
    renderer.render(scene, camera);
    stats.ms = performance.now() - t0;
    stats.calls = renderer.info.render.calls;
    stats.tris = renderer.info.render.triangles;
  }

  return {
    start: () => requestAnimationFrame(frame),
    invalidate: () => { dirty = true; },
    renderNow: () => renderer.render(scene, camera),
    stats
  };
}
