// landing.js — the home page is a photo studio in WebGL: the mannequin on a turntable under a spotlight, a giant word
// on the backdrop, and a camera that flies to a new shot for every chapter you scroll to. three.js loads after first
// paint; without WebGL the poster stays. Under reduced motion the camera cuts instead of flying and nothing drifts.
const canvas = document.getElementById("scene");
const chapters = [...document.querySelectorAll("[data-chapter]")];
const tries = [...document.querySelectorAll("[data-try]")];
const caption = document.getElementById("poseName");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = matchMedia("(max-width: 760px)");

// each chapter: pose, the word on the wall, the lighting, and the camera [azimuth deg, elevation deg, distance x, figure x-offset]
const SHOTS = {
  hero:    { pose: "contrapposto", word: "POSE",  look: "studio", cam: [-8, 3, 1.04, 0.42] },
  form:    { pose: "contrapposto", word: "FORM",  look: "studio", cam: [-38, 9, 1.0, 0.45] },
  reach:   { pose: "reach",        word: "REACH", look: "studio", cam: [32, 16, 1.04, -0.45] },
  light:   { pose: "fight",        word: "LIGHT", look: "lights", cam: [-58, 6, 1.0, 0.45] },
  library: { pose: "library",      word: "POSES", look: "studio", cam: [22, 8, 1.04, -0.45] },
  export:  { pose: "point",        word: "PNG",   look: "white",  cam: [-18, 10, 1.0, 0.45] },
  save:    { pose: "wave",         word: "SAVE",  look: "studio", cam: [38, 6, 1.02, -0.45] }
};
const HERO = ["contrapposto", "walk", "wave", "jump", "fight", "run", "kneel"];
const LIBRARY = ["run", "sit", "kneel", "jump", "squat", "bow"];

let api = null, active = "", heroIdx = 0, libIdx = 0, holdUntil = 0, pos = 0, storyOn = true;

/** Where the reader is: chapter index + progress through it (at mid-screen). */
function readScroll() {
  const mid = innerHeight / 2;
  let i = 0;
  chapters.forEach((c, k) => { if (c.getBoundingClientRect().top <= mid) i = k; });
  const r = chapters[i].getBoundingClientRect();
  pos = i + Math.min(1, Math.max(0, (mid - r.top) / r.height));
  storyOn = chapters.at(-1).getBoundingClientRect().bottom > 0;
  document.body.classList.toggle("is-past", chapters.at(-1).getBoundingClientRect().bottom < innerHeight * 0.9);
  document.body.classList.toggle("is-scrolled", scrollY > 24);
  const name = chapters[i].dataset.chapter;
  if (name !== active) { active = name; api?.enter(name); }
  api?.kick();
}
addEventListener("scroll", readScroll, { passive: true });
addEventListener("resize", readScroll);
readScroll();

for (const b of tries) b.addEventListener("click", () => {
  if (!api) return;
  holdUntil = performance.now() + 12000; // the visitor chose: stop cycling for a while
  api.pose(b.dataset.try);
});

setInterval(() => {
  if (!api || reduce || document.hidden || !storyOn || performance.now() < holdUntil) return;
  if (active === "hero") api.pose(HERO[heroIdx = (heroIdx + 1) % HERO.length]);
  if (active === "library") api.pose(LIBRARY[libIdx = (libIdx + 1) % LIBRARY.length]);
}, 3400);

const start = () => boot().catch((err) => console.warn("3D studio unavailable, keeping the picture:", err));
if (document.readyState === "complete") requestAnimationFrame(start); else addEventListener("load", start, { once: true });

async function boot() {
  const [THREE, { Mannequin, loadSculpt }, { PRESETS, applyPreset }] = await Promise.all([
    import("three"), import("./character/character.js"), import("./poses/presets.js")
  ]);
  await document.fonts.load("900 200px Inter").catch(() => {});
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0x0b0f17);
  scene.background = fogColor;
  scene.fog = new THREE.Fog(fogColor, 10, 26);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

  // ---- the studio: a seamless cyclorama (floor curving up into the back wall)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x141a2a, roughness: 0.92, metalness: 0 });
  {
    const prof = [];
    for (let z = 14; z > -2.5; z -= 0.5) prof.push([z, 0]);
    for (let a = 0; a <= 16; a++) { const t = (a / 16) * Math.PI / 2; prof.push([-2.5 - 3.5 * Math.sin(t), 3.5 - 3.5 * Math.cos(t)]); }
    for (let y = 4; y <= 16; y += 1) prof.push([-6, y]);
    const W = 40, cols = 2, pos = [], idx = [];
    prof.forEach(([z, y]) => { for (let c = 0; c <= cols; c++) pos.push(-W / 2 + (W * c) / cols, y, z); });
    for (let r = 0; r < prof.length - 1; r++) for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const cyc = new THREE.Mesh(g, wallMat);
    cyc.receiveShadow = true;
    scene.add(cyc);
  }

  // ---- the turntable: a dark plinth with a glowing rim
  const PLINTH = 0.09;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, PLINTH, 96),
    new THREE.MeshStandardMaterial({ color: 0x07090f, roughness: 0.95, metalness: 0 }));
  plinth.position.y = PLINTH / 2;
  plinth.receiveShadow = true;
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.805, 0.007, 12, 160),
    new THREE.MeshBasicMaterial({ color: 0x8f74ff }));
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = PLINTH;
  scene.add(plinth, rimRing);

  // ---- lights: a key spot (with a visible beam), violet and cyan rims, a warm spot for the lighting chapter
  const hemi = new THREE.HemisphereLight(0xa9b6ff, 0x0a0d16, 0.35);
  const key = new THREE.SpotLight(0xffffff, 0, 0, THREE.MathUtils.degToRad(24), 0.75, 1.4);
  key.position.set(2.3, 6.6, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  const rimV = new THREE.SpotLight(0x7c5cff, 0, 0, THREE.MathUtils.degToRad(30), 0.8, 1.3);
  rimV.position.set(-3.6, 3.2, -2.8);
  const rimC = new THREE.SpotLight(0x24d2ff, 0, 0, THREE.MathUtils.degToRad(30), 0.8, 1.3);
  rimC.position.set(3.8, 2.6, -2.6);
  const warm = new THREE.SpotLight(0xff9a4d, 0, 0, THREE.MathUtils.degToRad(26), 0.6, 1.3);
  warm.position.set(-2.8, 1.6, 2.8);
  warm.castShadow = true;
  warm.shadow.mapSize.set(1024, 1024);
  for (const s of [key, rimV, rimC, warm]) { s.target.position.set(0, s === key ? 0.9 : 1.35, 0); scene.add(s, s.target); }
  scene.add(hemi);

  // the key light's beam: an open cone, brightest near the lamp, soft at its edges
  const beamLen = key.position.distanceTo(new THREE.Vector3(0, 0, 0)); // the beam runs from the lamp to the plinth centre
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uStrength: { value: 1 }, uColor: { value: new THREE.Color(0xdfe6ff) } },
    vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() { vAlong = 1.0 - (position.y / ${beamLen.toFixed(3)} + 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() { float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float a = smoothstep(0.0, 0.12, vAlong) * (1.0 - smoothstep(0.8, 1.0, vAlong)) * edge * 0.5 * uStrength;
        gl_FragColor = vec4(uColor * a, a); }`
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.15, beamLen, 64, 1, true), beamMat); // narrower than the light: a readable shaft
  beam.position.copy(key.position).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), key.position.clone().normalize());
  scene.add(beam);

  // dust drifting through the beam
  const DUST = 340, dustPos = new Float32Array(DUST * 3), dustSpeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    const t = Math.random(), r = Math.sqrt(Math.random()) * Math.tan(key.angle) * beamLen * 0.8 * (1 - t), a = Math.random() * 6.283;
    const p = key.position.clone().multiplyScalar(t);
    dustPos.set([p.x + r * Math.cos(a), p.y + r * Math.sin(a) * 0.4, p.z + r * Math.sin(a)], i * 3);
    dustSpeed[i] = 0.02 + Math.random() * 0.05;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dot = document.createElement("canvas"); dot.width = dot.height = 32;
  { const c = dot.getContext("2d"), g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 32, 32); }
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.035, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xdfe6ff
  }));
  scene.add(dust);

  // ---- the giant word on the backdrop (two planes, cross-faded when the chapter changes)
  function wordTexture(text) {
    const c = document.createElement("canvas"); c.width = 2048; c.height = 640;
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    let size = 560;
    x.font = `900 ${size}px Inter, system-ui, sans-serif`;
    const w = x.measureText(text).width;
    if (w > 1960) { size *= 1960 / w; x.font = `900 ${size}px Inter, system-ui, sans-serif`; }
    x.fillText(text, 1024, 340);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    return t;
  }
  const words = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2), new THREE.MeshStandardMaterial({
      color: 0xd4dbf0, roughness: 0.8, transparent: true, opacity: 0, depthWrite: false
    }));
    scene.add(m);
    return m;
  });
  let wordFront = 0, wordText = "", wordFade = 1;
  function setWord(text) {
    if (text === wordText) return;
    wordText = text;
    wordFront = 1 - wordFront;
    const m = words[wordFront];
    m.material.alphaMap?.dispose();
    m.material.alphaMap = wordTexture(text);
    m.material.needsUpdate = true;
    wordFade = reduce ? 1 : 0;
  }

  // ---- the figure
  await loadSculpt("./assets/models/mannequin.glb");
  const fig = new Mannequin(scene).create("sculpted");
  fig.root.traverse((o) => { if (o.userData.helper) o.visible = false; if (o.isMesh) o.castShadow = true; });
  const turn = new THREE.Group();
  turn.position.y = PLINTH;
  turn.add(fig.root);
  scene.add(turn);
  const hips = fig.joint("hips");
  const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
  const size = { h: 1.8, base: 0 };

  let anim = null, current = "";
  function pose(id, instant = reduce) {
    const p = byId[id];
    if (!p || id === current) return;
    current = id;
    const from = fig.joints.map((j) => j.quaternion.clone()), fromH = hips.position.clone();
    applyPreset(fig, p);
    fig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().expandByObject(fig.skinned, true);
    size.base = Math.min(box.min.y, PLINTH);
    size.h = Math.max(box.max.y - size.base, 1.75); // crouched poses don't zoom in
    caption.textContent = p.name;
    for (const b of tries) b.setAttribute("aria-pressed", String(b.dataset.try === id));
    if (!instant) {
      const to = fig.joints.map((j) => j.quaternion.clone()), toH = hips.position.clone();
      fig.joints.forEach((j, i) => j.quaternion.copy(from[i]));
      hips.position.copy(fromH);
      anim = { from, to, fromH, toH, t0: performance.now() };
    }
    kick();
  }

  // ---- lighting looks, eased between chapters
  const LOOKS = {
    studio: { key: 95, rimV: 75, rimC: 55, warm: 0, hemi: 0.3, beam: 1, wall: 0x141a2a, bg: 0x0b0f17, word: 0x8a96bb },
    lights: { key: 10, rimV: 120, rimC: 95, warm: 80, hemi: 0.08, beam: 0.25, wall: 0x0e1220, bg: 0x07090f, word: 0x4a5372 },
    white:  { key: 60, rimV: 10, rimC: 10, warm: 0, hemi: 2.4, beam: 0, wall: 0xe7eaf2, bg: 0xeef0f6, word: 0xb9c0d0 }
  };
  const num = ["key", "rimV", "rimC", "warm", "hemi", "beam"];
  const cur = { ...LOOKS.studio, wall: new THREE.Color(LOOKS.studio.wall), bg: new THREE.Color(LOOKS.studio.bg), word: new THREE.Color(LOOKS.studio.word) };
  let goal = LOOKS.studio;
  const tmp = new THREE.Color();
  function stepLook(k) {
    let moving = false;
    for (const n of num) { const d = goal[n] - cur[n]; if (Math.abs(d) > 0.01) { cur[n] += d * k; moving = true; } else cur[n] = goal[n]; }
    for (const n of ["wall", "bg", "word"]) { tmp.set(goal[n]); if (!cur[n].equals(tmp)) { cur[n].lerp(tmp, k); moving = true; if (Math.abs(cur[n].r - tmp.r) + Math.abs(cur[n].g - tmp.g) + Math.abs(cur[n].b - tmp.b) < 0.003) cur[n].copy(tmp); } }
    key.intensity = cur.key; rimV.intensity = cur.rimV; rimC.intensity = cur.rimC; warm.intensity = cur.warm; hemi.intensity = cur.hemi;
    beamMat.uniforms.uStrength.value = cur.beam; dust.material.opacity = 0.55 * cur.beam;
    wallMat.color.copy(cur.wall); fogColor.copy(cur.bg);
    for (const w of words) { w.material.color.copy(cur.word); w.material.emissive.copy(cur.word).multiplyScalar(0.22); }
    return moving;
  }

  // ---- turning the figure: drag a horizontal swipe on the scene, or the arrow keys
  let yaw = 0, vel = 0, dragging = false, lastX = 0, still = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; vel = 0; canvas.setPointerCapture(e.pointerId); kick(); });
  canvas.addEventListener("pointermove", (e) => { if (!dragging) return; vel = (e.clientX - lastX) * 0.008; yaw += vel; lastX = e.clientX; kick(); });
  const release = () => { dragging = false; kick(); };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  addEventListener("keydown", (e) => {
    if (!storyOn || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.target.closest?.("input, textarea, select")) return;
    yaw += e.key === "ArrowLeft" ? -0.25 : 0.25;
    kick();
  });

  // ---- the camera: a shot per chapter, flown between as you scroll (cut under reduced motion)
  const camNow = SHOTS.hero.cam.slice();
  const target = new THREE.Vector3();
  const lerpCam = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function camGoal() {
    const i = Math.min(Math.floor(pos), chapters.length - 1), f = pos - i;
    const a = SHOTS[chapters[i].dataset.chapter].cam, b = SHOTS[(chapters[i + 1] || chapters[i]).dataset.chapter].cam;
    const t = reduce ? 0 : Math.min(1, Math.max(0, (f - 0.45) / 0.55));
    return lerpCam(a, b, t * t * (3 - 2 * t));
  }
  function placeCamera(w, h) {
    const [az, el, df, off] = camNow;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const fitH = (size.h * 1.42) / 2 / tanH, fitW = 1.6 / 2 / (tanH * Math.min(camera.aspect, 1.2));
    const D = Math.max(fitH, fitW) * df * (narrow.matches ? 1.3 : 1); // phones: smaller, above the text
    target.set(0, size.base + size.h * 0.5, 0);
    const A = THREE.MathUtils.degToRad(az), E = THREE.MathUtils.degToRad(el);
    camera.position.set(Math.sin(A) * Math.cos(E) * D, target.y + Math.sin(E) * D, Math.cos(A) * Math.cos(E) * D);
    camera.lookAt(target);
    for (const w of words) { w.position.set(-Math.sin(A) * 5, 1.4, -Math.cos(A) * 5); w.rotation.y = A; } // the word stays behind the figure
    // wide screens: the figure stands beside the text; phones: it stands above it
    if (narrow.matches) camera.setViewOffset(w, h, 0, h * 0.22, w, h);
    else camera.setViewOffset(w, h, -off * w * 0.22, 0, w, h);
  }

  // ---- render loop: only while the story is on screen and the tab is visible
  let raf = 0, W = 0, H = 0;
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", () => { resize(); kick(); });
  resize();
  document.addEventListener("visibilitychange", kick);

  let last = performance.now();
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / 900), e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      fig.joints.forEach((j, i) => j.quaternion.slerpQuaternions(anim.from[i], anim.to[i], e));
      hips.position.lerpVectors(anim.fromH, anim.toH, e);
      if (t === 1) anim = null;
    }
    if (!dragging) { vel *= 0.93; if (Math.abs(vel) < 1e-4) vel = 0; yaw += vel; }
    turn.rotation.y = yaw + (reduce || still ? 0 : Math.sin(now / 3200) * 0.18);
    const g = camGoal(), k = reduce ? 1 : 1 - Math.exp(-dt * 4);
    let flying = false;
    for (let i = 0; i < 4; i++) { const d = g[i] - camNow[i]; if (Math.abs(d) > 1e-3) flying = true; camNow[i] += d * k; }
    placeCamera(W, H);
    const lighting = stepLook(reduce ? 1 : 1 - Math.exp(-dt * 3));
    if (wordFade < 1) wordFade = Math.min(1, wordFade + dt * 1.6);
    words[wordFront].material.opacity = 0.9 * wordFade;
    words[1 - wordFront].material.opacity = 0.9 * (1 - wordFade);
    if (!reduce) {
      const a = dustGeo.attributes.position;
      for (let i = 0; i < DUST; i++) { let y = a.getY(i) + dustSpeed[i] * dt; if (y > key.position.y * 0.9) y = 0.2; a.setY(i, y); }
      a.needsUpdate = true;
    }
    renderer.render(scene, camera);
    if (anim || dragging || vel || flying || lighting || wordFade < 1 || !reduce) kick();
  }
  function kick() { if (!raf && storyOn && !document.hidden) raf = requestAnimationFrame(frame); }

  function enter(name) {
    const s = SHOTS[name];
    if (!s) return;
    goal = LOOKS[s.look];
    document.body.dataset.look = s.look;
    setWord(s.word);
    if (s.pose === "library") pose(LIBRARY[libIdx]);
    else if (name !== "hero" || performance.now() > holdUntil) pose(name === "hero" ? HERO[heroIdx] : s.pose);
  }

  enter(active || "hero");
  pose(SHOTS[active || "hero"].pose === "library" ? LIBRARY[0] : (active === "hero" ? HERO[0] : SHOTS[active].pose), true);
  Object.assign(camNow, camGoal());
  stepLook(1);
  wordFade = 1;
  api = { pose: (id) => pose(id), enter, kick };
  // for tools/landing_shots.py: a fixed view with no sway or cycling
  window.__stage = { pose: (id) => pose(id, true), hold(y = 0) { holdUntil = Infinity; still = true; yaw = y; vel = 0; kick(); }, word: (t) => { setWord(t); wordFade = 1; kick(); } };
  requestAnimationFrame(() => document.body.classList.add("is-live"));
  kick();
}
