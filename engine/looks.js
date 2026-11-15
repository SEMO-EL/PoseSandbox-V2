// engine/looks.js
// How the picture is drawn: Shaded (the plain render), Values (a few flat tones, for studying light), Ink (line art
// over a light tone) and Silhouette (the pose as one black shape).
//
// Shaded renders straight to the canvas, exactly as before. The other looks render the scene into a texture and
// redraw it through one shader; the helpers (gizmo, grid, bulbs, the floor ring, the reference image) are then
// drawn on top untouched. Helpers are told apart by layer: they are moved to layer 1 the first time a look needs it.

import * as THREE from "three";

export const LOOKS = { shaded: "Shaded", values: "Values", ink: "Ink", silhouette: "Silhouette" };
const ID = { values: 1, ink: 2, silhouette: 3 };
const HELPERS = 1; // layer

const FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform sampler2D tDepth;
  uniform int uLook; uniform vec2 uTexel; uniform float uNear; uniform float uLine; uniform float uPix;
  varying vec2 vUv;
  float depthAt(vec2 uv) { return texture2D(tDepth, uv).r; }
  void main() {
    vec4 c = texture2D(tColor, vUv);
    #ifdef TONE_MAPPING
      c.rgb = toneMapping(c.rgb);
    #endif
    c = linearToOutputTexel(c);                      // from here on: what the screen shows
    float d = depthAt(vUv);
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float thing = step(d, 0.99999);                  // 1 where something was drawn, 0 on the backdrop
    if (uLook == 1) {
      // four tones with thin soft steps between them (hard steps would shimmer along the edges)
      float v = 0.06 + 0.24 * smoothstep(0.085, 0.105, lum) + 0.30 * smoothstep(0.30, 0.33, lum) + 0.34 * smoothstep(0.60, 0.63, lum);
      c.rgb = vec3(v);
    } else if (uLook == 2) {
      // line art: where the depth bends or breaks. The raw depth is linear in 1/z, so flat surfaces give zero.
      vec2 o = uTexel * uLine;
      float lap = abs(depthAt(vUv + vec2(o.x, 0.0)) + depthAt(vUv - vec2(o.x, 0.0)) + depthAt(vUv + vec2(0.0, o.y)) + depthAt(vUv - vec2(0.0, o.y)) - 4.0 * d);
      float z = uNear / max(1.0 - d, 1e-6);            // distance (near is tiny next to far)
      // the bend, as a share of the distance, in units of one pixel's width out there: a 45-degree crease is about 1
      float edge = smoothstep(0.35, 0.9, lap * z / uNear / (uPix * uLine));
      float tone = mix(1.0, 0.86, thing * (1.0 - smoothstep(0.16, 0.2, lum)));
      c.a = max(c.a, edge);
      c.rgb = vec3(tone) * (1.0 - edge) * c.a;
    } else if (uLook == 3) {
      c.rgb = vec3(1.0 - thing) * c.a;
    }
    gl_FragColor = c;
    gl_FragDepth = d;                                // so the helpers drawn next are hidden behind the figure
  }`;

export function createLooks(renderer) {
  const ok = renderer.capabilities.isWebGL2 !== false && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
  let look = "shaded";
  let rt = null;
  const size = new THREE.Vector2();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: null }, uLook: { value: 0 }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.03 }, uLine: { value: 1 }, uPix: { value: 0.001 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: FRAG,
    depthFunc: THREE.AlwaysDepth, transparent: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;

  function target(w, h) {
    const samples = w * h > 6e6 ? 0 : 4; // a big export is already supersampled; multisampling it would cost a lot of memory
    if (rt && (rt.samples !== samples)) { rt.depthTexture.dispose(); rt.dispose(); rt = null; }
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
      rt.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    return rt;
  }

  /** hide: objects left out of line art and silhouettes (the floor). grid: gone in a silhouette, faint under line art. */
  function render(scene, camera, { hide = [], grid = null } = {}) {
    if (look === "shaded" || !ok) return renderer.render(scene, camera);
    scene.traverse((o) => { if ((o.userData.helper || o.userData.reference) && !o.layers.isEnabled(HELPERS)) o.traverse((c) => c.layers.set(HELPERS)); });
    renderer.getDrawingBufferSize(size);
    const t = target(size.x, size.y);
    const flat = look !== "values";
    const hidden = flat ? hide.filter((o) => o && o.visible) : [];
    hidden.forEach((o) => (o.visible = false));
    const gridWas = grid && flat ? [grid.visible, grid.material.transparent, grid.material.opacity] : null;
    if (gridWas) { grid.visible = gridWas[0] && look === "ink"; grid.material.transparent = true; grid.material.opacity = 0.28; }
    const bg = scene.background, fog = scene.fog;
    if (flat) scene.fog = null;
    if (flat && bg) scene.background = null; // paper or white comes from the shader
    const mask = camera.layers.mask, auto = renderer.autoClear;
    try {
      camera.layers.set(0);
      renderer.setRenderTarget(t);
      renderer.setClearColor(bg ? 0xffffff : 0x000000, bg ? 1 : 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      hidden.forEach((o) => (o.visible = true));
      mat.uniforms.tColor.value = t.texture;
      mat.uniforms.tDepth.value = t.depthTexture;
      mat.uniforms.uLook.value = ID[look];
      mat.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
      mat.uniforms.uNear.value = camera.near;
      mat.uniforms.uLine.value = Math.max(1, size.y / 800);
      mat.uniforms.uPix.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / size.y;
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(quad, quadCam);
      renderer.autoClear = false;
      camera.layers.set(HELPERS);
      scene.background = null;
      renderer.render(scene, camera);
    } finally {
      hidden.forEach((o) => (o.visible = true));
      if (gridWas) [grid.visible, grid.material.transparent, grid.material.opacity] = gridWas;
      renderer.setRenderTarget(null);
      renderer.autoClear = auto;
      camera.layers.mask = mask;
      scene.background = bg; scene.fog = fog;
    }
  }

  return {
    available: ok,
    get: () => look,
    set: (name) => { look = LOOKS[name] && ok ? name : "shaded"; return look; },
    render,
    HELPERS
  };
}
