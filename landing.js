// landing.js — the home page's live stage: the real sculpted mannequin, posed by the hero's buttons and by each
// feature as it scrolls past. three.js loads only once the stage is on screen; if WebGL is missing the poster stays.
const stage = document.getElementById("stage");
const canvas = document.getElementById("stageCanvas");
const caption = document.getElementById("stageName");
const tries = [...document.querySelectorAll("[data-try]")];
const feats = [...document.querySelectorAll(".feat[data-pose]")];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = matchMedia("(max-width: 900px)");

const HERO = ["contrapposto", "walk", "wave", "jump", "fight", "run", "kneel", "bow"];
const LIBRARY = ["run", "sit", "kneel", "jump", "squat", "bow"];
const LOOKS = {
  studio: { hemi: 1.0, key: 2.4, rim: 1.1, spot: 0 },
  lights: { hemi: 0.15, key: 0.2, rim: 3.0, spot: 34 },
  export: { hemi: 1.7, key: 2.0, rim: 0.25, spot: 0 }
};
const BASE_YAW = -0.42;

let api = null;            // set once the figure is on stage
let mode = "hero", heroIdx = 0, libIdx = 0, holdUntil = 0;

/** The feature nearest the middle of the screen, or null in the hero. */
function activeFeature() {
  const vh = innerHeight, top = 0, mid = vh / 2;
  let best = null, bd = Infinity;
  for (const f of feats) {
    const b = f.getBoundingClientRect();
    const d = Math.abs((b.top + b.bottom) / 2 - mid);
    if (d < bd) { bd = d; best = f; }
  }
  return best && bd < (vh - top) * 0.4 ? best : null;
}

function onScroll() {
  const f = phone.matches ? null : activeFeature(); // on phones the figure is not beside the features
  feats.forEach((x) => x.classList.toggle("is-on", x === f));
  const key = f ? f.dataset.pose : "hero";
  if (key === mode || !api) { mode = key; return; }
  mode = key;
  api.look(f?.dataset.look || "studio");
  if (key === "hero" && performance.now() < holdUntil) return; // keep the pose the visitor just picked
  api.pose(key === "hero" ? HERO[heroIdx] : key === "library" ? LIBRARY[libIdx] : key);
}
let ticking = false;
addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });
onScroll();

for (const b of tries) b.addEventListener("click", () => {
  if (!api) return;
  holdUntil = performance.now() + 12000; // the visitor chose: stop cycling for a while
  api.pose(b.dataset.try);
  if (phone.matches && stage.getBoundingClientRect().bottom < 80) stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
});

// the hero and the library feature cycle on their own (not under reduced motion)
setInterval(() => {
  if (!api || reduce || document.hidden || !api.visible() || performance.now() < holdUntil) return;
  if (mode === "hero") api.pose(HERO[heroIdx = (heroIdx + 1) % HERO.length]);
  if (mode === "library") api.pose(LIBRARY[libIdx = (libIdx + 1) % LIBRARY.length]);
}, 3400);

const seen = new IntersectionObserver(([e]) => {
  if (!e.isIntersecting) return;
  seen.disconnect();
  boot().catch((err) => { console.warn("3D stage unavailable, keeping the picture:", err); });
}, { rootMargin: "200px" });
seen.observe(stage);

async function boot() {
  const [THREE, { Mannequin, loadSculpt }, { PRESETS, applyPreset }] = await Promise.all([
    import("three"), import("./character/character.js"), import("./poses/presets.js")
  ]);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const cam = { y: 1, d: 6 }, camT = { y: 1, d: 6 }, size = { h: 1.8, w: 1, base: 0 };
  /** Frame the posed figure as large as the stage allows (it grows for a jump, comes closer for a squat). */
  function frameTarget() {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const h = size.h * 1.16, w = size.w * 1.3;
    camT.d = Math.max(h / 2 / t, w / 2 / (t * camera.aspect)) + 0.25;
    camT.y = size.base + size.h / 2 - 0.04;
  }

  const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x1a1f2b, 1);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.4, 4.2, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 2.6, bottom: -0.4, near: 0.5, far: 12 });
  const rim = new THREE.DirectionalLight(0x24d2ff, 1.1);
  rim.position.set(-3, 2.6, -2.4);
  const spot = new THREE.SpotLight(0xffa860, 0, 0, THREE.MathUtils.degToRad(28), 0.45, 2);
  spot.position.set(1.7, 2.9, 1.9);
  spot.target.position.set(0, 1.1, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  scene.add(hemi, key, rim, spot, spot.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.38 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 64), new THREE.MeshBasicMaterial({ color: 0x1c2638 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.002;
  scene.add(disc, floor);

  await loadSculpt("./assets/models/mannequin.glb");
  const fig = new Mannequin(scene).create("sculpted");
  fig.root.traverse((o) => { if (o.userData.helper) o.visible = false; });
  const turn = new THREE.Group();
  turn.add(fig.root);
  scene.add(turn);
  const hips = fig.joint("hips");
  const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

  // ---- posing: slerp every joint from where it is to the preset (instant under reduced motion)
  let anim = null, current = "";
  function pose(id, instant = reduce) {
    const p = byId[id];
    if (!p || id === current) return;
    current = id;
    const from = fig.joints.map((j) => j.quaternion.clone()), fromH = hips.position.clone();
    applyPreset(fig, p);
    fig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().expandByObject(fig.skinned, true);
    size.base = Math.min(box.min.y, 0);
    size.h = box.max.y - size.base;
    size.w = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * 0.85; // it turns: allow for the diagonal
    frameTarget();
    if (instant) Object.assign(cam, camT);
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

  // ---- lighting looks, eased
  const lk = { ...LOOKS.studio }; let target = LOOKS.studio;
  function look(name) { target = LOOKS[name] || LOOKS.studio; if (reduce) Object.assign(lk, target); kick(); }
  function applyLook() {
    let moving = false;
    for (const k in lk) { const d = target[k] - lk[k]; if (Math.abs(d) > 0.01) { lk[k] += d * 0.08; moving = true; } else lk[k] = target[k]; }
    hemi.intensity = lk.hemi; key.intensity = lk.key; rim.intensity = lk.rim; spot.intensity = lk.spot;
    return moving;
  }

  // ---- turning: drag (a horizontal swipe on phones; vertical swipes still scroll) or arrow keys
  let yaw = 0, vel = 0, dragging = false, lastX = 0, still = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; vel = 0; canvas.setPointerCapture(e.pointerId); stage.classList.add("is-drag"); kick(); });
  canvas.addEventListener("pointermove", (e) => { if (!dragging) return; vel = (e.clientX - lastX) * 0.01; yaw += vel; lastX = e.clientX; kick(); });
  const release = () => { dragging = false; stage.classList.remove("is-drag"); kick(); };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  stage.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    yaw += e.key === "ArrowLeft" ? -0.2 : 0.2;
    kick();
  });

  // ---- size and visibility
  let visible = true, raf = 0;
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frameTarget();
    Object.assign(cam, camT);
    kick();
  }).observe(stage);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(stage);
  document.addEventListener("visibilitychange", kick);

  function frame(now) {
    raf = 0;
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / 900), e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      fig.joints.forEach((j, i) => j.quaternion.slerpQuaternions(anim.from[i], anim.to[i], e));
      hips.position.lerpVectors(anim.fromH, anim.toH, e);
      if (t === 1) anim = null;
    }
    if (!dragging) { vel *= 0.92; if (Math.abs(vel) < 1e-4) vel = 0; yaw += vel; }
    const sway = reduce || still ? 0 : Math.sin(now / 2600) * 0.22;
    turn.rotation.y = BASE_YAW + yaw + sway;
    const lighting = applyLook();
    const framing = Math.abs(camT.d - cam.d) + Math.abs(camT.y - cam.y) > 1e-3;
    cam.d += (camT.d - cam.d) * 0.06; cam.y += (camT.y - cam.y) * 0.06;
    camera.position.set(0, cam.y + 0.12, cam.d);
    camera.lookAt(0, cam.y, 0);
    renderer.render(scene, camera);
    const busy = anim || dragging || vel || lighting || framing || (!reduce && !still);
    if (busy) kick();
  }
  function kick() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }

  pose(mode === "hero" ? HERO[0] : mode === "library" ? LIBRARY[0] : mode, true);
  look(feats.find((f) => f.dataset.pose === mode)?.dataset.look || "studio");
  Object.assign(lk, target);
  api = { pose: (id) => pose(id), look, visible: () => visible };
  // for tools/landing_shots.py: a fixed view with no sway or cycling
  window.__stage = { pose: (id) => pose(id, true), look: (n) => { look(n); Object.assign(lk, target); }, hold(y = 0) { holdUntil = Infinity; still = true; yaw = y; vel = 0; kick(); } };
  requestAnimationFrame(() => {
    stage.classList.add("is-live");
    document.getElementById("try").hidden = false;
  });
}
