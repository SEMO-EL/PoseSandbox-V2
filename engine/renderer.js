// engine/renderer.js
// WebGL renderer sized to its canvas. alpha:true so PNG export can be transparent.
// No preserveDrawingBuffer: exports read the canvas in the same task as the render, which is enough.

import * as THREE from "three";

export function createRenderer(canvas, { maxPixelRatio = 2 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r18x removed PCFSoftShadowMap; shadow.radius softens instead

  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, maxPixelRatio);

  function resize(camera) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(w, h, false);
    return true;
  }

  return { renderer, resize, pixelRatio };
}
