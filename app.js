// app.js — the PoseSandbox editor: wires the figure, scene, tools and panels together.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Mannequin, BUILDS, SKINS, CHAINS, chainOf, jointLabel, counterpartName, loadSculpt } from "./character/character.js";
import { createRenderer } from "./engine/renderer.js";
import { createScene, BACKGROUNDS, fovFromLens } from "./engine/scene.js";
import { createLoop } from "./engine/loop.js";
import { createLooks, LOOKS } from "./engine/looks.js";
import { createReference } from "./engine/reference.js";
import { createWorld, createProp, propColor, markImport, PROP_TYPES } from "./core/world.js";
import { createHistory } from "./core/history.js";
import { isTypingTarget, stamp, downloadBlob, makeToast } from "./core/helpers.js";
import { encodeShare, decodeShare } from "./core/share.js";
import { createCustomLight, applyLightParams, lightParams, MAX_LIGHTS } from "./lights/custom-lights.js";
import { solveTwoBone, holdWorldRotation, aim, clampHinge } from "./controls/ik.js";
import { createGrab } from "./controls/grab.js";
import { createPractice } from "./controls/practice.js";
import { Selection } from "./controls/selection.js";
import { serializeScene, applyScene, mirrorPose, mirrorQuaternion } from "./poses/pose-io.js";
import { PRESETS, applyPreset } from "./poses/presets.js";
import { HAND_POSES, applyHandPose } from "./poses/hands.js";
import { Gallery } from "./gallery/gallery.js";

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const toast = makeToast($("toast"));
const SESSION_KEY = "posesandbox_session_v2";
const PROP_BUTTONS = ["cube", "sphere", "cylinder", "cone", "pyramid", "torus", "block", "step", "pole", "wall", "icosa", "plane"];

// the sculpted figure loads first; without it the procedural mannequin is used
loadSculpt().catch((e) => console.warn("Sculpted mannequin unavailable, using the classic one", e)).then(() => {
  try { boot(); } catch (err) { showFatal(err); }
});

function showFatal(err) {
  $("fatalText").textContent = String(err?.stack || err);
  $("fatal").hidden = false;
  console.error(err);
}

function boot() {
  const canvas = $("c");
  const { renderer, resize } = createRenderer(canvas);
  const S = createScene({ renderer, canvas });
  const { scene, camera, orbit, gizmo, floor } = S;
  const looks = createLooks(renderer);
  const draw = () => looks.render(scene, camera, { hide: [floor], grid: S.grid() });
  const loop = createLoop({ renderer, scene, camera, orbit, render: draw });
  camera.layers.enable(looks.HELPERS);
  gizmo.getRaycaster().layers.enable(looks.HELPERS);
  const view = { look: "shaded", flip: false, guide: "none" }; // how the picture is shown; kept per browser, not in pose files
  const invalidate = loop.invalidate;
  // the cast: `figure` is the one the panel edits (the active one); selecting a part of another makes that one active
  const figures = [new Mannequin(scene).create(Mannequin.sculpt ? "sculpted" : "neutral")];
  let figure = figures[0];
  const MAX_FIGURES = 6;
  const world = createWorld(scene);
  const reference = createReference(camera);
  const ikHandle = new THREE.Object3D();
  ikHandle.userData.helper = true;
  scene.add(ikHandle);
  const shadowCatcher = new THREE.ShadowMaterial({ opacity: 0.35 });

  const opts = { mode: "rotate", grab: true, limits: true, symmetry: false, pinFeet: true, space: "local", snap: 15, axes: { x: true, y: true, z: true }, grid: true, floor: true };
  const env = { background: "midnight", preset: "studio", keyDir: "front_right" };
  const drag = { kind: null };
  let history = null;
  let modeHint = "";

  /* ------------------------------------------------------------ environment (studio lights + background) */

  const STUDIO = [
    ["key", "Key", 6], ["fill", "Fill", 3], ["rim", "Rim", 5], ["ambient", "Ambient", 3], ["hemi", "Sky", 3]
  ];

  function envState() {
    const studio = {};
    for (const [k] of STUDIO) {
      const l = S.lights[k];
      studio[k] = { color: "#" + l.color.getHexString(), intensity: Math.round(l.intensity * 1000) / 1000 };
      if (l.groundColor) studio[k].ground = "#" + l.groundColor.getHexString();
    }
    return { background: env.background, preset: env.preset, keyDir: env.keyDir, studio };
  }

  function setEnvState(e) {
    if (e.background) setBackground(e.background);
    if (e.preset) env.preset = e.preset;
    if (e.keyDir) { env.keyDir = e.keyDir; S.setKeyDirection(e.keyDir); }
    for (const [k, v] of Object.entries(e.studio || {})) {
      const l = S.lights[k];
      if (!l) continue;
      l.color.set(v.color);
      l.intensity = v.intensity;
      if (v.ground && l.groundColor) l.groundColor.set(v.ground);
    }
    syncStudioUI();
  }

  function setBackground(name) {
    env.background = BACKGROUNDS[name] ? name : "midnight";
    S.setBackground(env.background);
    $("bgTone").value = env.background;
    applyFloorVisibility();
  }

  function applyFloorVisibility() {
    const backdrop = reference.state.behind && reference.mesh.visible; // a backdrop image replaces the floor
    floor.visible = opts.floor && !backdrop;
    S.grid().visible = opts.grid && !backdrop;
    invalidate();
  }

  /* ------------------------------------------------------------ documents, history, session */

  function addFigure(like = null) {
    const f = new Mannequin(scene);
    f.skin = like ? like.skin : Object.keys(SKINS)[figures.length % Object.keys(SKINS).length]; // tell them apart at a glance
    f.create(like ? like.build : figure.build);
    if (like) f.restore(like.capture());
    f.root.position.x = Math.max(...figures.map((g) => g.root.position.x)) + 0.75;
    figures.push(f);
    return f;
  }
  function removeFigure(f) {
    if (figures.length < 2 || !figures.includes(f)) return;
    figures.splice(figures.indexOf(f), 1);
    f.dispose();
    if (figure === f) figure = figures[0];
  }
  const ctx = { figures, addFigure: () => addFigure(), removeFigure, world, cameraState: S.cameraState, setCameraState: S.setCameraState, envState, setEnvState };
  const notes = () => $("poseNotes").value;
  const snapshot = () => JSON.stringify(serializeScene(ctx, { camera: false }));

  function loadDoc(doc, { camera = true } = {}) {
    const sel = selection.get();
    const selName = sel?.userData.isJoint ? sel.name : null;
    const selFig = selName ? figures.indexOf(sel.userData.figure) : -1;
    const selUid = sel?.userData.uid;
    const res = applyScene(doc, ctx, { camera });
    if (!figures.includes(figure)) figure = figures[0];
    let next = selName ? (figures[selFig] || figure).joint(selName) : selUid ? world.items.get(selUid) : null;
    if (next && !next.userData.isJoint && next.parent !== scene) next = null;
    selection.selected = null; // joints may be new objects after a rebuild
    selection.set(next);
    selection.repaint();
    syncFigureUI();
    syncLensUI();
    renderLightList();
    attachGizmo();
    return res;
  }

  function commit() {
    if (history?.commit()) saveSessionSoon();
  }

  function undo() { if (history.undo()) toast("Undo", 700); }
  function redo() { if (history.redo()) toast("Redo", 700); }

  let saveTimer = 0;
  function saveSessionSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 400);
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(serializeScene(ctx, { notes: notes() }))); } catch { /* storage full or blocked: not fatal */ }
  }

  /* ------------------------------------------------------------ selection + gizmo */

  /* ------------------------------------------------------------ the picture: look, flip, framing guide */

  const GUIDES = { none: ["No guide", 0], thirds: ["Thirds", 0], "1:1": ["Square 1:1", 1], "4:5": ["Portrait 4:5", 4 / 5], "3:4": ["Portrait 3:4", 3 / 4], "2:3": ["Portrait 2:3", 2 / 3], a4: ["A4 portrait", 1 / Math.SQRT2], "9:16": ["Story 9:16", 9 / 16], "3:2": ["Landscape 3:2", 3 / 2], "16:9": ["Wide 16:9", 16 / 9] };

  /** The framing guide's rectangle inside the view (CSS px), or null when the guide has no shape of its own. */
  function frameRect() {
    const ratio = GUIDES[view.guide]?.[1];
    if (!ratio) return null;
    const W = canvas.clientWidth, H = canvas.clientHeight, pad = 0.94;
    let w = W * pad, h = w / ratio;
    if (h > H * pad) { h = H * pad; w = h * ratio; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function applyView() {
    view.look = looks.set(view.look);
    $("lookSelect").value = view.look;
    $("guideSelect").value = GUIDES[view.guide] ? view.guide : (view.guide = "none");
    $("btnFlip").classList.toggle("is-on", view.flip);
    $("btnFlip").setAttribute("aria-pressed", String(view.flip));
    canvas.classList.toggle("is-flipped", view.flip);
    const g = $("guide"), f = frameRect();
    g.hidden = view.guide === "none";
    g.classList.toggle("guide--frame", !!f);
    Object.assign(g.style, f ? { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" } : { left: "0", top: "0", width: "100%", height: "100%" });
    try { localStorage.setItem("posesandbox_view", JSON.stringify(view)); } catch { /* ignore */ }
    invalidate();
  }

  // Flip mirrors the canvas with CSS; the pointer is mirrored to match, so everything under it still lines up.
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    window.addEventListener(type, (e) => {
      if (!view.flip || e.target !== canvas) return;
      const r = canvas.getBoundingClientRect();
      for (const k of ["clientX", "pageX", "x"]) Object.defineProperty(e, k, { value: r.left + r.right - e[k], configurable: true });
    }, true);
  }

  const selection = new Selection({
    camera, canvas, gizmo,
    getRoots: () => [...figures.map((f) => f.root), ...world.live()],
    onChange: (sel) => {
      const f = sel?.userData.figure;
      if (f && f !== figure && figures.includes(f)) { figure = f; syncFigureUI(); }
      updateInspector(); renderLightList(); attachGizmo();
    },
    onHoverChange: (t) => { $("vhint").textContent = t ? labelOf(t) : modeHint; invalidate(); },
    resolveHit: (hit) => { for (const f of figures) { const j = f.jointForHit(hit); if (j) return j; } return null; },
    paintJoints: (sel, hov) => { for (const f of figures) f.paintJoints(sel?.userData.figure === f ? sel : null, hov?.userData.figure === f ? hov : null); }
  });
  selection.ray.layers.enable(looks.HELPERS);

  const fingerName = (n) => (figure.fingerBlock ? n.replace("index finger", "fingers") : n); // one fused finger block on the sculpt
  const figureName = (f) => `Figure ${figures.indexOf(f) + 1}`;
  const labelOf = (o) => (o.userData.isJoint ? (figures.length > 1 ? figureName(o.userData.figure) + " · " : "") + fingerName(jointLabel(o.name)) : o.name);

  function setHint(text) {
    modeHint = text;
    $("vhint").textContent = text;
  }

  function attachGizmo() {
    gizmo.detach();
    drag.kind = null;
    const sel = selection.get();
    const m = opts.mode;
    gizmo.setMode(m === "move" ? "translate" : m === "scale" ? "scale" : "rotate");
    gizmo.setSpace(m === "move" ? "world" : opts.space);
    gizmo.showX = opts.axes.x; gizmo.showY = opts.axes.y; gizmo.showZ = opts.axes.z;
    gizmo.setRotationSnap(m === "rotate" && opts.snap ? THREE.MathUtils.degToRad(opts.snap) : null);

    let target = null;
    let hint = opts.grab ? "Drag a body part to pose it · drag empty space to orbit · scroll to zoom" : "Drag empty space to orbit · right-drag to pan · scroll to zoom";
    if (sel && m === "view") hint = "View mode: the gizmo is hidden — press 1, 2 or 4 to edit";
    else if (sel?.userData.isJoint) {
      const name = sel.name;
      const label = jointLabel(name);
      if (m === "rotate") { target = sel; hint = `Rotate the ${label.toLowerCase()} — drag a ring`; }
      else if (m === "scale") {
        if (name === "char_root") hint = "Pick a body part, prop or model to scale";
        else { target = sel.userData.segment; hint = `Scale the ${label.toLowerCase()}`; }
      } else if (name === "char_root") { target = figure.root; drag.kind = "root"; hint = "Move the whole figure"; }
      else if (chainOf(name)) {
        drag.kind = "ik";
        drag.chain = chainOf(name);
        figure.joint(CHAINS[drag.chain][2]).getWorldPosition(ikHandle.position);
        ikHandle.updateMatrixWorld();
        target = ikHandle;
        hint = drag.chain.endsWith("arm") ? "Drag the hand — the arm follows" : "Drag the foot — the leg follows";
      } else {
        drag.kind = "hips";
        target = figure.joint("hips");
        hint = opts.pinFeet ? "Move the body — the feet stay planted" : "Move the hips";
      }
    } else if (sel) {
      if (m === "scale" && sel.userData.kind === "light") hint = "Lights don't scale — use Brightness and Range in Lighting";
      else { target = sel; hint = m === "move" ? `Move the ${sel.name.toLowerCase()}` : m === "rotate" ? (sel.userData.lightType === "spot" ? "Rotate to aim the spot" : `Rotate the ${sel.name.toLowerCase()}`) : `Scale the ${sel.name.toLowerCase()}`; }
    }
    if (target) gizmo.attach(target);
    setHint(hint);
    invalidate();
  }

  function solveChain(chain, target, endQ, f = figure) {
    const [a, b, e] = CHAINS[chain].map((n) => f.joint(n));
    const pole = new THREE.Vector3(0, 0, chain.endsWith("arm") ? -1 : 1).applyQuaternion(f.root.quaternion);
    solveTwoBone(a, b, e, target, pole, opts.limits ? (chain.endsWith("arm") ? -1 : 1) : 0);
    if (endQ) holdWorldRotation(e, endQ);
  }

  function mirrorJoints(names) {
    for (const n of names) {
      const src = figure.joint(n), dst = figure.joint(counterpartName(n) || "");
      if (!dst) continue;
      if (opts.mode === "scale") dst.userData.segment.scale.copy(src.userData.segment.scale);
      else mirrorQuaternion(src.quaternion, dst.quaternion);
    }
  }

  gizmo.addEventListener("change", invalidate);
  gizmo.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
    if (e.value) {
      if (drag.kind === "ik") drag.endQ = figure.joint(CHAINS[drag.chain][2]).getWorldQuaternion(new THREE.Quaternion());
      drag.feet = drag.kind === "hips" && opts.pinFeet
        ? ["l_leg", "r_leg"].map((c) => { const end = figure.joint(CHAINS[c][2]); return { c, pos: end.getWorldPosition(new THREE.Vector3()), q: end.getWorldQuaternion(new THREE.Quaternion()) }; })
        : null;
    } else {
      if (drag.kind === "ik") { figure.joint(CHAINS[drag.chain][2]).getWorldPosition(ikHandle.position); ikHandle.updateMatrixWorld(); }
      commit();
    }
  });
  gizmo.addEventListener("objectChange", () => {
    const sel = selection.get();
    if (drag.kind === "ik") solveChain(drag.chain, ikHandle.position, drag.endQ);
    else if (drag.kind === "hips" && drag.feet) for (const f of drag.feet) solveChain(f.c, f.pos, f.q);
    // (moving the body solves each planted foot on its own, so there is nothing to mirror then)
    if (opts.symmetry && sel?.userData.isJoint && drag.kind !== "hips" && drag.kind !== "root") mirrorJoints(drag.kind === "ik" ? CHAINS[drag.chain] : [sel.name]);
    invalidate();
  });

  /* Drag a body part to pose it. A hand or foot pulls its limb (IK); the pelvis moves the body over planted feet;
     the floor ring slides the whole figure; anything else swings about its own joint to follow the pointer. */
  function grabStart(joint, point) {
    if (!opts.grab || opts.mode === "view") return null;
    const f = joint.userData.figure;
    // fingers and toes are small targets on a hand or foot: they pull the limb unless that very part is selected
    const fine = joint.name.match(/^([lr])_(thumb|index|middle|ring|pinky|toes)/);
    if (fine && selection.get() !== joint) joint = f.joint(`${fine[1]}_${fine[2] === "toes" ? "ankle" : "wrist"}`);
    const name = joint.name;
    const last = point.clone(), delta = new THREE.Vector3(), tmp = new THREE.Vector3(), pivot = new THREE.Vector3();
    const step = (t) => { delta.subVectors(t, last); last.copy(t); return delta; };
    const mirror = (names) => { if (opts.symmetry) mirrorJoints(names); };
    const feet = () => ["l_leg", "r_leg"].map((c) => { const e = f.joint(CHAINS[c][2]); return { c, pos: e.getWorldPosition(new THREE.Vector3()), q: e.getWorldQuaternion(new THREE.Quaternion()) }; });
    f.root.updateMatrixWorld(true);

    if (name === "char_root") return { joint, normal: new THREE.Vector3(0, 1, 0), apply: (t) => { step(t); f.root.position.x += delta.x; f.root.position.z += delta.z; invalidate(); } };

    if (name === "hips") {
      const planted = opts.pinFeet ? feet() : null;
      const world = joint.getWorldPosition(new THREE.Vector3());
      return { joint, apply: (t) => {
        world.add(step(t));
        joint.position.copy(f.root.worldToLocal(tmp.copy(world)));
        if (planted) for (const p of planted) solveChain(p.c, p.pos, p.q, f);
        invalidate();
      } };
    }

    const chain = chainOf(name);
    if (chain && name === CHAINS[chain][2]) {
      const target = joint.getWorldPosition(new THREE.Vector3()), endQ = joint.getWorldQuaternion(new THREE.Quaternion());
      return { joint, apply: (t) => { solveChain(chain, target.add(step(t)), endQ, f); mirror(CHAINS[chain]); invalidate(); } };
    }

    const local = joint.worldToLocal(point.clone());
    const hinge = opts.limits && (/_elbow$/.test(name) ? [-2.62, 0.05] : /_knee$/.test(name) ? [-0.05, 2.62] : null); // 150 degrees one way
    return { joint, apply: (t) => {
      joint.updateWorldMatrix(true, false);
      aim(joint, joint.getWorldPosition(pivot), joint.localToWorld(tmp.copy(local)), t);
      if (hinge) clampHinge(joint.quaternion, ...hinge);
      mirror([name]);
      invalidate();
    } };
  }
  createGrab({ canvas, camera, orbit, gizmo, selection, start: grabStart, end: (live) => { if (live) { attachGizmo(); commit(); } } });

  function setMode(m) {
    opts.mode = m;
    for (const b of $$("[data-mode]")) {
      const on = b.dataset.mode === m;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    attachGizmo();
  }

  /* ------------------------------------------------------------ inspector */

  function fillJointSelect() {
    const groups = [["Body", ["char_root", "hips", "spine", "chest", "neck", "head"]]];
    for (const [side, label] of [["l", "Right"], ["r", "Left"]]) {
      groups.push([`${label} arm`, ["shoulder", "elbow", "wrist"].map((p) => `${side}_${p}`)]);
      const fingers = figure.fingerBlock ? ["thumb1", "thumb2", "index1", "index2"] : ["thumb1", "thumb2", "index1", "index2", "middle1", "middle2", "ring1", "ring2", "pinky1", "pinky2"];
      groups.push([`${label} hand`, fingers.map((p) => `${side}_${p}`)]);
      groups.push([`${label} leg`, ["hip", "knee", "ankle", "toes"].map((p) => `${side}_${p}`)]);
    }
    const sel = $("jointSelect");
    sel.replaceChildren(new Option("Choose a body part…", ""));
    for (const [label, names] of groups) {
      const g = document.createElement("optgroup");
      g.label = label;
      for (const n of names) g.append(new Option(fingerName(jointLabel(n)), n));
      sel.append(g);
    }
  }

  function updateInspector() {
    const sel = selection.get();
    const isJ = !!sel?.userData.isJoint;
    const kind = sel?.userData.kind;
    $("selKind").textContent = sel ? labelOf(sel) : "None";
    $("jointSelect").value = isJ ? sel.name : "";
    $("inspJoint").hidden = !isJ;
    $("inspItem").hidden = !sel || isJ;
    $("selHint").hidden = !!sel;
    $("propColorRow").hidden = kind !== "prop";
    if (kind === "prop") $("propColor").value = "#" + propColor(sel).getHexString();
    $("btnLightSettings").hidden = kind !== "light";
    $("btnDuplicate").disabled = kind === "import";
  }

  function boxOf(obj) {
    const box = new THREE.Box3();
    obj.updateWorldMatrix(true, true);
    obj.traverseVisible((o) => { if (o.isMesh && !o.userData.helper) box.expandByObject(o, !!o.isSkinnedMesh); }); // skinned: measure the posed skin
    return box;
  }

  function frameFigure() {
    const box = new THREE.Box3();
    for (const f of figures) box.union(boxOf(f.root));
    S.frameBox(box, figures.length > 1 ? 1.2 : 1.45);
    syncLensUI();
  }

  function frameSelection() {
    const sel = selection.get();
    if (!sel || sel.name === "char_root") return frameFigure();
    const box = sel.userData.isJoint ? boxOf(sel.userData.segment) : sel.userData.kind === "light" ? new THREE.Box3().setFromCenterAndSize(sel.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.6, 0.6, 0.6)) : boxOf(sel);
    if (!box.isEmpty()) S.frameBox(box, 2.2);
  }

  function selectRelative(dir) {
    const sel = selection.get();
    if (!sel?.userData.isJoint) return selection.set(figure.joint("hips"));
    const next = dir < 0 ? sel.parent : sel.children.find((c) => c.userData.isJoint);
    if (next?.userData.isJoint) selection.set(next);
  }

  function deleteSelected() {
    const sel = selection.get();
    if (sel?.userData.isJoint && sel.name === "char_root") return dropFigure();
    if (!sel || sel.userData.isJoint) return;
    world.remove(sel);
    selection.set(null);
    commit();
    toast(`${sel.name} deleted — Ctrl+Z brings it back`);
  }

  function newFigure(like = null) {
    if (figures.length >= MAX_FIGURES) return toast(`Up to ${MAX_FIGURES} figures at once`);
    const f = addFigure(like);
    if (!like) applyPreset(f, PRESETS[0]);
    selection.set(f.root);
    setMode("move");
    syncFigureUI();
    commit();
    toast(`${figureName(f)} added — drag the arrows to place it`, 2200);
  }
  function dropFigure() {
    if (figures.length < 2) return toast("This is the only figure");
    const f = figure;
    selection.set(null);
    removeFigure(f);
    syncFigureUI();
    commit();
    toast("Figure removed — Ctrl+Z brings it back");
  }

  function duplicateSelected() {
    const sel = selection.get();
    if (sel?.userData.isJoint) return newFigure(sel.userData.figure);
    if (!sel) return;
    let copy = null;
    if (sel.userData.kind === "prop") copy = createProp(sel.userData.type, { color: propColor(sel).getHex() });
    else if (sel.userData.kind === "light") {
      if (world.live("light").length >= MAX_LIGHTS) return toast(`Up to ${MAX_LIGHTS} lights`);
      copy = createCustomLight(sel.userData.lightType, lightParams(sel));
    } else return toast("Imported models can't be duplicated — import the file again");
    copy.name = sel.name;
    copy.position.copy(sel.position).add(new THREE.Vector3(0.3, 0, 0.3));
    copy.quaternion.copy(sel.quaternion);
    copy.scale.copy(sel.scale);
    world.add(copy);
    selection.set(copy);
    commit();
  }

  /* ------------------------------------------------------------ clean renders: export + thumbnails */

  function cleanRender({ scale = 1, transparent = false, grid = false, floorOn = true, ref = false, styled = false } = {}, read) {
    const look = looks.get();
    if (!styled) looks.set("shaded"); // thumbnails are always plain
    const changed = [];
    const vis = (o, v) => { if (o && o.visible !== v) { changed.push([o, o.visible]); o.visible = v; } };
    const gridShown = S.grid().visible;
    scene.traverse((o) => { if (o.userData.helper) vis(o, false); }); // gizmo, floor ring, bulbs, cones, axes, grid
    vis(S.grid(), grid && gridShown);
    vis(floor, floorOn && floor.visible);
    vis(reference.mesh, ref && reference.mesh.visible);
    const bg = scene.background, fog = scene.fog, floorMat = floor.material;
    if (transparent) { scene.background = null; scene.fog = null; floor.material = shadowCatcher; }
    const pr = renderer.getPixelRatio();
    const w = canvas.clientWidth * pr, h = canvas.clientHeight * pr;
    const k = Math.min(scale, 8192 / Math.max(w, h));
    if (k !== 1) renderer.setPixelRatio(pr * k);
    try {
      return selection.withoutHighlights(() => { draw(); return read(renderer.domElement); });
    } finally {
      looks.set(look);
      if (k !== 1) renderer.setPixelRatio(pr);
      scene.background = bg; scene.fog = fog; floor.material = floorMat;
      for (const [o, v] of changed.reverse()) o.visible = v;
      invalidate();
    }
  }

  function captureThumb(size = 256) {
    return cleanRender({}, (src) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const s = Math.min(src.width, src.height);
      c.getContext("2d").drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
      const webp = c.toDataURL("image/webp", 0.82);
      return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.85);
    });
  }

  function exportOptions() {
    const f = $("exportDialog").querySelector("form");
    return { scale: Number(f.scale.value), transparent: f.transparent.checked, floorOn: f.floor.checked, grid: f.grid.checked, ref: f.reference.checked, styled: true };
  }

  function updateExportSize() {
    const pr = renderer.getPixelRatio();
    const { scale } = exportOptions();
    const w = canvas.clientWidth * pr, h = canvas.clientHeight * pr;
    const k = Math.min(scale, 8192 / Math.max(w, h));
    const f = frameRect();
    const note = [f ? `cropped to ${GUIDES[view.guide][0]}` : "the current view", view.look !== "shaded" ? LOOKS[view.look] : "", view.flip ? "flipped" : ""].filter(Boolean).join(" · ");
    $("exportSize").textContent = `${Math.round((f ? f.w * pr : w) * k)} × ${Math.round((f ? f.h * pr : h) * k)} px · ${note}`;
  }

  /** The exported picture is what you see: cropped to the framing guide and flipped if the view is. */
  function finishExport(src) {
    const f = frameRect();
    if (!f && !view.flip) return src;
    const k = src.width / canvas.clientWidth;
    const r = f ? { x: Math.round(f.x * k), y: Math.round(f.y * k), w: Math.round(f.w * k), h: Math.round(f.h * k) } : { x: 0, y: 0, w: src.width, h: src.height };
    const c = document.createElement("canvas");
    c.width = r.w; c.height = r.h;
    const g = c.getContext("2d");
    if (view.flip) { g.translate(r.w, 0); g.scale(-1, 1); }
    g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return c;
  }

  async function exportBlob() {
    const url = cleanRender(exportOptions(), (c) => finishExport(c).toDataURL("image/png"));
    return (await fetch(url)).blob();
  }

  /* ------------------------------------------------------------ files */

  async function importModel(file) {
    const url = URL.createObjectURL(file);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error("empty");
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      if (maxDim < 0.05 || maxDim > 6) root.scale.setScalar(1.6 / maxDim); // keep real-world (metre) models as they are
      box.setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      root.position.sub(new THREE.Vector3(c.x - 1.1, box.min.y, c.z));
      world.add(markImport(root, file.name.replace(/\.(glb|gltf)$/i, "")));
      selection.set(root);
      commit();
      toast(`Imported ${root.name}`);
    } catch {
      toast("Couldn't read that model. Use a .glb (or a .gltf with embedded data).", 3200);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadReference(file) {
    try {
      await reference.load(file);
      syncReferenceUI();
      applyFloorVisibility();
      $$("details[data-key='reference']").forEach((d) => (d.open = true));
      toast("Reference loaded");
    } catch {
      toast("Couldn't read that image");
    }
  }

  function warnMissing(missing) {
    if (missing?.length) toast(`Re-import to restore: ${missing.join(", ")}`, 3600);
  }

  async function handleFiles(files) {
    const list = [...files];
    const poses = [];
    for (const f of list) {
      const n = f.name.toLowerCase();
      if (f.type.startsWith("image/")) await loadReference(f);
      else if (/\.(glb|gltf)$/.test(n)) await importModel(f);
      else if (n.endsWith(".json")) {
        try { poses.push({ name: f.name.replace(/\.json$/i, ""), data: JSON.parse(await f.text()) }); }
        catch { toast(`${f.name} isn't valid JSON`); }
      }
    }
    if (!poses.length) return;

    // one pose file: open it. Several (a pack) or a gallery export: add them to the gallery.
    if (poses.length === 1 && poses[0].data?.kind !== "gallery") {
      try {
        const r = loadDoc(poses[0].data);
        if (r.notes !== null) $("poseNotes").value = r.notes;
        commit();
        toast(`Opened ${poses[0].name}`);
        warnMissing(r.missing);
      } catch { toast(`${poses[0].name} isn't a PoseSandbox pose`); }
      return;
    }
    const keep = snapshot();
    let added = 0;
    for (const { name, data } of poses) {
      const entries = data?.kind === "gallery" && Array.isArray(data.items) ? data.items : [{ name, pose: data }];
      for (const it of entries) {
        try {
          if (it.thumb) { if (gallery.add({ pose: it.pose, thumb: it.thumb, name: it.name, notes: it.notes || "" })) added++; continue; }
          loadDoc(it.pose, { camera: false });
          if (gallery.add({ pose: it.pose, thumb: captureThumb(256), name: it.name, notes: it.pose.notes || "" })) added++;
        } catch { /* not a pose: skip */ }
      }
    }
    loadDoc(JSON.parse(keep), { camera: false });
    $$("details[data-key='gallery']").forEach((d) => (d.open = true));
    toast(added ? `Added ${added} pose${added > 1 ? "s" : ""} to the gallery` : "No poses found in those files");
  }

  /* ------------------------------------------------------------ gallery */

  const gallery = new Gallery({
    containerEl: $("poseGallery"),
    toast,
    onOpen: (it) => {
      const r = loadDoc(it.pose);
      $("poseNotes").value = it.notes || "";
      commit();
      warnMissing(r.missing);
    }
  });

  function saveToGallery() {
    const item = gallery.add({ pose: serializeScene(ctx, { notes: notes() }), thumb: captureThumb(256), notes: notes() });
    if (item) {
      $$("details[data-key='gallery']").forEach((d) => (d.open = true));
      toast(`Saved “${item.name}”`);
    }
  }

  /* ------------------------------------------------------------ poses */

  function randomPose() {
    const R = (a, b) => THREE.MathUtils.degToRad(a + Math.random() * (b - a));
    const e = new THREE.Euler(0, 0, 0, "ZYX");
    const set = (n, x, y, z) => figure.joint(n).quaternion.setFromEuler(e.set(x, y, z, "ZYX"));
    figure.resetPose({ keepRoot: true });
    set("spine", R(-8, 20), R(-20, 20), R(-8, 8));
    set("chest", R(-8, 15), R(-20, 20), R(-8, 8));
    set("neck", R(-10, 15), R(-25, 25), R(-6, 6));
    set("head", R(-15, 15), R(-20, 20), R(-8, 8));
    for (const [s, k] of [["l", -1], ["r", 1]]) {
      set(`${s}_shoulder`, R(-100, 40), R(-30, 30), k * R(0, 110));
      set(`${s}_elbow`, R(-120, 0), 0, 0);
      set(`${s}_wrist`, R(-20, 20), R(-30, 30), R(-25, 25));
      set(`${s}_hip`, R(-75, 25), R(-15, 15), k * R(0, 25));
      set(`${s}_knee`, R(0, 95), 0, 0);
      set(`${s}_ankle`, R(-15, 25), 0, 0);
    }
    const hands = Object.keys(HAND_POSES);
    applyHandPose(figure, "l", hands[Math.floor(Math.random() * hands.length)]);
    applyHandPose(figure, "r", hands[Math.floor(Math.random() * hands.length)]);
    figure.ground();
  }

  /** A library pose made a little different each time: mirrored half the time, every big joint nudged. */
  function variedPose(f, preset) {
    applyPreset(f, preset);
    const e = new THREE.Euler(), q = new THREE.Quaternion(), R = (d) => THREE.MathUtils.degToRad((Math.random() * 2 - 1) * d);
    for (const j of f.joints) {
      const part = j.name.replace(/^[lr]_/, "");
      const d = { spine: 7, chest: 7, neck: 8, head: 10, shoulder: 12, hip: 8, wrist: 12 }[part];
      if (d) j.quaternion.multiply(q.setFromEuler(e.set(R(d), R(d), R(d))));
      else if (part === "elbow" || part === "knee") j.quaternion.multiply(q.setFromEuler(e.set(R(9), 0, 0)));
    }
    if (Math.random() < 0.5) mirrorPose(f);
    f.root.position.x = 0;
    f.ground();
    if (preset.lift) f.joint("hips").position.y += preset.lift;
  }

  /* ------------------------------------------------------------ gesture practice */

  const session = { keep: null, log: [], last: null, mode: "rotate" };
  const practice = createPractice({
    $, dialog: $("practiceDialog"), overlay: $("practice"), toast,
    begin: (o) => {
      session.keep = JSON.stringify(serializeScene(ctx));
      session.log = [];
      session.o = o;
      session.mode = opts.mode;
      selection.set(null);
      selection.enabled = false; // nothing lights up under the pointer while you draw
      setMode("view");
    },
    show: (n) => {
      let step = session.log[n];
      if (!step) {
        const saved = session.o.source === "saved" && gallery.items.length ? gallery.items : null;
        if (saved) {
          let it; do { it = saved[Math.floor(Math.random() * saved.length)]; } while (saved.length > 1 && it === session.last);
          session.last = it;
          loadDoc(it.pose, { camera: !session.o.angles });
        } else {
          while (figures.length > 1) removeFigure(figures[figures.length - 1]);
          const pool = PRESETS.filter((p) => !p.plain && p !== session.last);
          session.last = pool[Math.floor(Math.random() * pool.length)];
          variedPose(figure, session.last);
        }
        if (session.o.angles) S.orbitTo(Math.random() * Math.PI * 2, THREE.MathUtils.degToRad(-6 + Math.random() * 40));
        frameFigure();
        step = session.log[n] = JSON.stringify(serializeScene(ctx));
      } else loadDoc(JSON.parse(step));
      selection.set(null);
      for (const f of figures) f.ring.visible = false; // the floor ring is a handle, not part of the drawing
      invalidate();
    },
    finish: () => {
      selection.enabled = $("togHighlight").checked;
      loadDoc(JSON.parse(session.keep));
      for (const f of figures) f.ring.visible = true;
      setMode(session.mode);
    }
  });

  function poseAction(fn, msg) {
    fn();
    selection.repaint();
    attachGizmo();
    commit();
    if (msg) toast(msg, 900);
  }

  const GROUPS = ["Standing", "Gesture", "Action", "Seated and floor"];
  function renderPresets() {
    const grid = $("presetGrid");
    $("presetCount").textContent = `· ${PRESETS.length} poses`;
    grid.replaceChildren();
    let group = null;
    for (const p of [...PRESETS].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group))) { // stable: library order within a group
      if (p.group !== group) {
        group = p.group;
        const h = document.createElement("h4");
        h.className = "tiles__head";
        h.textContent = group;
        grid.append(h);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.title = `Apply “${p.name}”`;
      const img = document.createElement("img");
      img.alt = "";
      if (p.thumb) img.src = p.thumb;
      const name = document.createElement("span");
      name.className = "tile__name";
      name.textContent = p.name;
      b.append(img, name);
      b.addEventListener("click", () => poseAction(() => {
        applyPreset(figure, p);
        $("handR").value = p.handsL || p.hands || "relaxed";
        $("handL").value = p.handsR || p.hands || "relaxed";
      }));
      grid.append(b);
    }
  }

  /** Thumbnails of the pose library, rendered once from a fixed camera with props and lights hidden. */
  function makePresetThumbs() {
    const keep = figure.capture();
    const cam = S.cameraState();
    const light = envState(); // thumbnails are lit plainly, whatever the scene's lighting is
    S.setKeyDirection(S.applyLightingPreset("studio"));
    const hidden = [...world.live(), ...figures.filter((f) => f !== figure).map((f) => f.root)].filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    figure.root.position.set(0, 0, 0);
    figure.root.quaternion.identity();
    camera.position.set(1.3, 1.1, 2.3);
    camera.lookAt(0, 0.86, 0);
    try {
      for (const p of PRESETS) {
        applyPreset(figure, p);
        p.thumb = captureThumb(140);
      }
    } finally {
      figure.restore(keep);
      setEnvState(light);
      S.setCameraState(cam);
      hidden.forEach((o) => (o.visible = true));
      invalidate();
    }
    renderPresets();
  }

  /* ------------------------------------------------------------ lights panel */

  function addLight(type) {
    if (world.live("light").length >= MAX_LIGHTS) return toast(`Up to ${MAX_LIGHTS} lights at once`);
    const g = createCustomLight(type);
    const n = world.live("light").filter((l) => l.userData.lightType === type).length + 1;
    g.name = `${type === "spot" ? "Spot" : "Point"} light ${n}`;
    if (type === "spot") { g.position.set(-1.6, 2.6, 1.9); g.lookAt(0, 1.05, 0); }
    else g.position.set(0.9, 1.55, 1.2);
    world.add(g);
    selection.set(g);
    setMode("move");
    $("lightingSection").open = true;
    commit();
    toast("Light added — drag the bulb to place it", 2200);
  }

  function renderLightList() {
    const ul = $("lightList");
    ul.replaceChildren();
    const sel = selection.get();
    for (const g of world.live("light")) {
      const li = document.createElement("li");
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "pick";
      pick.setAttribute("aria-pressed", String(g === sel));
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.color = g.userData.params.color;
      const name = document.createElement("span");
      name.textContent = g.name;
      pick.append(sw, name);
      pick.addEventListener("click", () => selection.set(g));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "iconbtn";
      del.setAttribute("aria-label", `Delete ${g.name}`);
      del.innerHTML = '<svg><use href="#i-trash"/></svg>';
      del.addEventListener("click", () => { world.remove(g); if (selection.get() === g) selection.set(null); renderLightList(); commit(); invalidate(); });
      li.append(pick, del);
      ul.append(li);
    }
    syncLightEditor();
  }

  const LE = { intensity: [(v) => v, (v) => `${v}`], range: [(v) => v, (v) => (v > 0 ? `${v} m` : "∞")], angle: [(v) => v, (v) => `${v}°`], penumbra: [(v) => v, (v) => `${Math.round(v * 100)}%`] };

  function syncLightEditor() {
    const sel = selection.get();
    const isLight = sel?.userData.kind === "light";
    $("lightEditor").hidden = !isLight;
    if (!isLight) return;
    const p = sel.userData.params;
    $("leTitle").textContent = sel.name;
    $("leColor").value = p.color;
    for (const k of Object.keys(LE)) {
      const id = "le" + k[0].toUpperCase() + k.slice(1);
      if (p[k] !== undefined) $(id).value = p[k];
      $(id + "Out").textContent = LE[k][1](Number($(id).value));
    }
    $("leShadow").checked = !!p.castShadow;
    $("leBulb").checked = p.showBulb !== false;
    $$("[data-spot]").forEach((el) => (el.hidden = sel.userData.lightType !== "spot"));
  }

  function editLight(patch, done) {
    const sel = selection.get();
    if (sel?.userData.kind !== "light") return;
    applyLightParams(sel, patch);
    syncLightEditor();
    invalidate();
    if (done) { renderLightList(); commit(); }
  }

  /* ------------------------------------------------------------ UI sync */

  function syncStudioUI() {
    for (const [k] of STUDIO) {
      const l = S.lights[k];
      $(`st_${k}`).value = l.intensity;
      $(`st_${k}_c`).value = "#" + l.color.getHexString();
    }
    $("lightPreset").value = env.preset;
    $("keyDir").value = env.keyDir;
  }

  function syncFigureUI() {
    $("figBuild").value = figure.build;
    $("figSkin").value = figure.skin;
    $("figCount").textContent = figures.length > 1 ? `${figureName(figure)} of ${figures.length} selected` : "One figure";
    $("btnRemoveFigure").disabled = figures.length < 2;
    fillJointSelect();
    fillHandSelects();
  }

  function syncLensUI() {
    const mm = Math.round(12 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    $("lens").value = mm;
    $("lensOut").textContent = `${mm} mm`;
  }

  function syncReferenceUI() {
    const r = reference.state;
    $("refShow").checked = r.enabled;
    $("refBehind").checked = r.behind;
    $("refFlip").checked = r.flipX;
    for (const [id, k] of [["refOpacity", "opacity"], ["refSize", "size"], ["refOffsetX", "offsetX"], ["refOffsetY", "offsetY"]]) {
      $(id).value = r[k];
      $(id).nextElementSibling.textContent = Number(r[k]).toFixed(2);
    }
  }

  /* ------------------------------------------------------------ build the panel */

  fillJointSelect();
  for (const [k, v] of Object.entries(BUILDS)) if (!v.sculpted || Mannequin.sculpt) $("figBuild").append(new Option(v.label, k));
  for (const [k, v] of Object.entries(SKINS)) $("figSkin").append(new Option(v.label, k));
  for (const [k, v] of Object.entries(BACKGROUNDS)) $("bgTone").append(new Option(v.label, k));
  function fillHandSelects() { // a fused finger block can't point or make a V
    for (const sel of [$("handR"), $("handL")]) {
      const keep = sel.value;
      sel.replaceChildren(...Object.entries(HAND_POSES).filter(([k]) => !figure.fingerBlock || !["point", "peace"].includes(k)).map(([k, v]) => new Option(v.label, k)));
      sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "relaxed";
    }
  }
  fillHandSelects();
  for (const t of PROP_BUTTONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = PROP_TYPES[t].label;
    b.addEventListener("click", () => addProp(t));
    $("propButtons").append(b);
  }
  for (const [k, label, max] of STUDIO) {
    const row = document.createElement("div");
    row.className = "studio-row";
    row.innerHTML = `<label class="label" for="st_${k}">${label}</label><input type="range" id="st_${k}" min="0" max="${max}" step="0.05" /><input type="color" id="st_${k}_c" aria-label="${label} colour" />`;
    $("studioRows").append(row);
    row.addEventListener("input", () => { S.lights[k].intensity = Number($(`st_${k}`).value); S.lights[k].color.set($(`st_${k}_c`).value); invalidate(); });
    row.addEventListener("change", commit);
  }

  function addProp(type) {
    const p = createProp(type);
    p.position.set((Math.random() - 0.5) * 1.8, 0, 0.45 + Math.random() * 0.6);
    if (type === "wall") p.position.set(0, 0, -0.9);
    world.add(p);
    selection.set(p);
    commit();
  }

  /* ------------------------------------------------------------ wire events */

  $("btnUndo").addEventListener("click", undo);
  $("btnRedo").addEventListener("click", redo);
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("btnFocusBar").addEventListener("click", frameSelection);
  $("btnFocus").addEventListener("click", frameSelection);
  $("jointSelect").addEventListener("change", (e) => selection.set(figure.joint(e.target.value)));
  $("btnResetPart").addEventListener("click", () => {
    const j = selection.get();
    if (!j?.userData.isJoint) return;
    poseAction(() => { j.quaternion.identity(); j.userData.segment.scale.set(1, 1, 1); j.position.copy(figure.restPosition(j.name)); });
  });
  $("btnDuplicate").addEventListener("click", duplicateSelected);
  $("btnDelete").addEventListener("click", deleteSelected);
  $("propColor").addEventListener("input", (e) => { const s = selection.get(); if (s?.userData.kind === "prop") { propColor(s).set(e.target.value); invalidate(); } });
  $("propColor").addEventListener("change", commit);
  $("btnLightSettings").addEventListener("click", () => { $("lightingSection").open = true; $("lightEditor").scrollIntoView({ behavior: "smooth", block: "nearest" }); });

  $$("[data-axis]").forEach((b) => b.addEventListener("click", () => {
    opts.axes[b.dataset.axis] = !opts.axes[b.dataset.axis];
    b.classList.toggle("is-on", opts.axes[b.dataset.axis]);
    b.setAttribute("aria-pressed", String(opts.axes[b.dataset.axis]));
    attachGizmo();
  }));
  $("rotateSnap").addEventListener("change", (e) => { opts.snap = Number(e.target.value); attachGizmo(); });
  $("btnSpace").addEventListener("click", (e) => {
    opts.space = opts.space === "local" ? "world" : "local";
    e.currentTarget.textContent = opts.space === "local" ? "Local" : "World";
    e.currentTarget.setAttribute("aria-pressed", String(opts.space === "world"));
    attachGizmo();
  });
  const toggleSymmetry = () => { opts.symmetry = !opts.symmetry; $("togSym").checked = opts.symmetry; toast(opts.symmetry ? "Symmetry on" : "Symmetry off", 900); };
  $("togSym").addEventListener("change", (e) => { opts.symmetry = e.target.checked; });
  $("togPin").addEventListener("change", (e) => { opts.pinFeet = e.target.checked; attachGizmo(); });
  $("togGrab").addEventListener("change", (e) => { opts.grab = e.target.checked; attachGizmo(); });
  $("togLimits").addEventListener("change", (e) => { opts.limits = e.target.checked; });
  $("btnResetPose").addEventListener("click", () => poseAction(() => figure.resetPose({ keepRoot: true }), "Pose reset"));
  $("btnMirror").addEventListener("click", () => poseAction(() => mirrorPose(figure), "Mirrored"));
  $("btnRandom").addEventListener("click", () => poseAction(randomPose));
  $("btnGround").addEventListener("click", () => poseAction(() => figure.ground()));
  for (const id of ["handR", "handL"]) $(id).addEventListener("change", (e) => poseAction(() => applyHandPose(figure, e.target.dataset.side, e.target.value)));

  $("figBuild").addEventListener("change", (e) => {
    const name = selection.get()?.userData.isJoint ? selection.get().name : null;
    figure.create(e.target.value);
    selection.selected = null;
    selection.set(name ? figure.joint(name) : selection.get());
    selection.repaint();
    syncFigureUI();
    attachGizmo();
    commit();
  });
  $("figSkin").addEventListener("change", (e) => { figure.setSkin(e.target.value); invalidate(); commit(); });
  $("btnAddFigure").addEventListener("click", () => newFigure());
  $("btnRemoveFigure").addEventListener("click", dropFigure);
  $("bgTone").addEventListener("change", (e) => { setBackground(e.target.value); commit(); });
  $("togGrid").addEventListener("change", (e) => { opts.grid = e.target.checked; applyFloorVisibility(); });
  $("togFloor").addEventListener("change", (e) => { opts.floor = e.target.checked; applyFloorVisibility(); });
  $("togAxes").addEventListener("change", (e) => { S.axes.visible = e.target.checked; invalidate(); });
  $("togHighlight").addEventListener("change", (e) => { selection.enabled = e.target.checked; selection.repaint(); invalidate(); });
  let perfTimer = 0;
  for (const [k, label] of Object.entries(LOOKS)) $("lookSelect").append(new Option(label, k));
  for (const [k, [label]] of Object.entries(GUIDES)) $("guideSelect").append(new Option(label, k));
  $("lookSelect").disabled = !looks.available;
  $("lookSelect").addEventListener("change", (e) => { view.look = e.target.value; applyView(); });
  $("guideSelect").addEventListener("change", (e) => { view.guide = e.target.value; applyView(); });
  const toggleFlip = () => { view.flip = !view.flip; applyView(); toast(view.flip ? "Flipped — a fresh eye on the pose" : "Flip off", 1100); };
  $("btnFlip").addEventListener("click", toggleFlip);
  $("togPerf").addEventListener("change", (e) => {
    $("perf").hidden = !e.target.checked;
    clearInterval(perfTimer);
    if (e.target.checked) perfTimer = setInterval(() => {
      const st = loop.stats;
      $("perf").textContent = `${st.ms.toFixed(1)} ms/frame · ${st.calls} draws · ${(st.tris / 1000).toFixed(1)}k tris`;
    }, 500);
  });

  $("btnScatter").addEventListener("click", () => {
    for (let i = 0; i < 5; i++) {
      const p = createProp(PROP_BUTTONS[Math.floor(Math.random() * 7)]);
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 1.2;
      p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      p.rotation.y = Math.random() * Math.PI;
      world.add(p);
    }
    commit();
    invalidate();
  });
  $("btnClearProps").addEventListener("click", () => {
    const props = world.live("prop");
    if (!props.length) return;
    props.forEach((p) => world.remove(p));
    if (selection.get()?.userData.kind === "prop") selection.set(null);
    commit();
    invalidate();
    toast("Props removed — Ctrl+Z brings them back");
  });

  $("lightPreset").addEventListener("change", (e) => { env.preset = e.target.value; env.keyDir = S.applyLightingPreset(env.preset); syncStudioUI(); invalidate(); commit(); });
  $("keyDir").addEventListener("change", (e) => { env.keyDir = e.target.value; S.setKeyDirection(env.keyDir); invalidate(); commit(); });
  $("btnAddPoint").addEventListener("click", () => addLight("point"));
  $("btnAddSpot").addEventListener("click", () => addLight("spot"));
  $("leColor").addEventListener("input", (e) => editLight({ color: e.target.value }));
  $("leColor").addEventListener("change", (e) => editLight({ color: e.target.value }, true));
  for (const k of Object.keys(LE)) {
    const el = $("le" + k[0].toUpperCase() + k.slice(1));
    el.addEventListener("input", () => editLight({ [k]: Number(el.value) }));
    el.addEventListener("change", () => editLight({ [k]: Number(el.value) }, true));
  }
  $("leShadow").addEventListener("change", (e) => editLight({ castShadow: e.target.checked }, true));
  $("leBulb").addEventListener("change", (e) => editLight({ showBulb: e.target.checked }, true));
  $("leAim").addEventListener("click", () => {
    const sel = selection.get();
    if (sel?.userData.kind !== "light") return;
    sel.lookAt(figure.joint("chest").getWorldPosition(new THREE.Vector3()));
    commit();
    invalidate();
  });
  $("leDelete").addEventListener("click", deleteSelected);

  $("lens").addEventListener("input", (e) => { S.setLens(Number(e.target.value)); $("lensOut").textContent = `${e.target.value} mm`; reference.update(); invalidate(); });
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => S.viewFrom(b.dataset.view)));
  $("btnFrame").addEventListener("click", frameFigure);

  $("btnRefLoad").addEventListener("click", () => $("fileRef").click());
  $("fileRef").addEventListener("change", async (e) => { if (e.target.files[0]) await loadReference(e.target.files[0]); e.target.value = ""; });
  $("btnRefClear").addEventListener("click", () => { reference.clear(); syncReferenceUI(); applyFloorVisibility(); });
  for (const [id, k, type] of [["refShow", "enabled", "bool"], ["refBehind", "behind", "bool"], ["refFlip", "flipX", "bool"], ["refOpacity", "opacity"], ["refSize", "size"], ["refOffsetX", "offsetX"], ["refOffsetY", "offsetY"]]) {
    $(id).addEventListener("input", (e) => {
      reference.state[k] = type === "bool" ? e.target.checked : Number(e.target.value);
      if (type !== "bool") e.target.nextElementSibling.textContent = Number(e.target.value).toFixed(2);
      reference.update();
      applyFloorVisibility();
    });
  }

  $("btnSaveGallery").addEventListener("click", saveToGallery);
  $("btnSaveFile").addEventListener("click", () => {
    downloadBlob(new Blob([JSON.stringify(serializeScene(ctx, { notes: notes() }), null, 2)], { type: "application/json" }), stamp("pose") + ".json");
    toast("Pose file saved");
  });
  $("btnOpenFile").addEventListener("click", () => $("filePose").click());
  $("filePose").addEventListener("change", async (e) => { await handleFiles(e.target.files); e.target.value = ""; });
  $("btnRename").addEventListener("click", () => gallery.rename());
  $("btnDeletePose").addEventListener("click", () => gallery.remove());
  $("btnClearGallery").addEventListener("click", () => gallery.clear());
  $("btnExportGallery").addEventListener("click", () => {
    if (!gallery.items.length) return toast("Nothing to export yet");
    downloadBlob(gallery.exportBlob(), stamp("posesandbox-gallery") + ".json");
  });
  $("poseNotes").addEventListener("input", saveSessionSoon);
  $("btnShare").addEventListener("click", async () => {
    const doc = serializeScene(ctx, { notes: notes() });
    for (const list of [doc.props, doc.lights]) for (const it of list) delete it.uid; // ids only matter for undo
    delete doc.imports;
    const url = location.origin + location.pathname + "#p=" + (await encodeShare(doc));
    try {
      await navigator.clipboard.writeText(url);
      toast(world.live("import").length ? "Link copied — imported models don't travel in links" : "Link copied — anyone who opens it gets this scene", 2600);
    } catch {
      prompt("Copy this link:", url);
    }
  });

  $("btnImport3D").addEventListener("click", () => $("fileModel").click());
  $("fileModel").addEventListener("change", async (e) => { if (e.target.files[0]) await importModel(e.target.files[0]); e.target.value = ""; });

  const exportDialog = $("exportDialog");
  const openExport = () => { updateExportSize(); exportDialog.showModal(); };
  $("btnExport").addEventListener("click", openExport);
  exportDialog.querySelector("form").addEventListener("change", updateExportSize);
  $("btnDownloadPng").addEventListener("click", async () => {
    downloadBlob(await exportBlob(), stamp() + ".png");
    exportDialog.close();
    toast("PNG exported");
  });
  $("btnCopyPng").addEventListener("click", async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": exportBlob() })]);
      exportDialog.close();
      toast("Copied — paste it into your drawing app");
    } catch {
      toast("Your browser blocked copying — use Download instead", 2600);
    }
  });
  const openHelp = () => $("helpDialog").showModal();
  $("btnHelp").addEventListener("click", openHelp);

  // mobile: the panel is a bottom sheet
  $("btnPanel").addEventListener("click", () => {
    const open = $("panel").classList.toggle("is-open");
    $("btnPanel").setAttribute("aria-expanded", String(open));
    $("panelHandleText").textContent = open ? "Hide tools" : "Tools";
  });

  // remember which sections are open
  const openKey = "posesandbox_sections";
  let openState = {};
  try { openState = JSON.parse(localStorage.getItem(openKey) || "{}"); } catch { /* ignore */ }
  for (const d of $$("details[data-key]")) {
    if (d.dataset.key in openState) d.open = openState[d.dataset.key];
    d.addEventListener("toggle", () => { openState[d.dataset.key] = d.open; try { localStorage.setItem(openKey, JSON.stringify(openState)); } catch { /* ignore */ } });
  }

  // drop files on the view
  const vp = $("viewport");
  vp.addEventListener("dragover", (e) => { e.preventDefault(); $("dropzone").hidden = false; });
  vp.addEventListener("dragleave", (e) => { if (!vp.contains(e.relatedTarget)) $("dropzone").hidden = true; });
  vp.addEventListener("drop", (e) => { e.preventDefault(); $("dropzone").hidden = true; handleFiles(e.dataTransfer.files); });

  // keyboard: never while typing in a field or with a dialog open (v1 deleted props when you typed Backspace in Notes)
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target) || document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (practice.active()) { if (!mod && practice.key(k)) e.preventDefault(); if (!["l", "h", "f"].includes(k) || mod) return; }
    if (mod) {
      const act = { z: () => (e.shiftKey ? redo() : undo()), y: redo, s: saveToGallery, e: openExport, m: toggleSymmetry, d: duplicateSelected }[k];
      if (act) { e.preventDefault(); act(); }
      return;
    }
    if (e.altKey) return;
    if (["1", "2", "3", "4"].includes(k)) setMode(["rotate", "move", "view", "scale"][Number(k) - 1]);
    else if (k === "f") frameSelection();
    else if (k === "h") toggleFlip();
    else if (k === "l") { const ks = Object.keys(LOOKS); view.look = ks[(ks.indexOf(view.look) + 1) % ks.length]; applyView(); toast(LOOKS[view.look], 900); }
    else if (k === "escape") selection.set(null);
    else if (k === "delete" || k === "backspace") { if (selection.get() && !selection.get().userData.isJoint) { e.preventDefault(); deleteSelected(); } }
    else if (k === "[") selectRelative(-1);
    else if (k === "]") selectRelative(1);
    else if (k === "?") openHelp();
  });

  // any panel interaction may change the picture
  for (const type of ["input", "change", "click"]) document.addEventListener(type, invalidate, true);
  new ResizeObserver(() => { resize(camera); reference.update(); applyView(); }).observe(vp);
  resize(camera);
  window.addEventListener("pagehide", saveSession);

  /* ------------------------------------------------------------ start */

  try { Object.assign(view, JSON.parse(localStorage.getItem("posesandbox_view") || "{}")); } catch { /* ignore */ }
  applyView();
  syncStudioUI();
  syncReferenceUI();
  gallery.load();
  let restored = false;
  try {
    const doc = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (doc) {
      const r = loadDoc(doc);
      $("poseNotes").value = r.notes || "";
      restored = true;
    }
  } catch { /* a broken session is ignored */ }
  if (!restored) {
    applyPreset(figure, PRESETS[0]);
    frameFigure();
  }
  // a shared link (#p=…) opens over whatever was here; the previous scene stays one Ctrl+Z away
  const openShared = async () => {
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return;
    window.history.replaceState(null, "", location.pathname + location.search); // (`history` here is the undo stack)
    try {
      const r = loadDoc(await decodeShare(m[1]));
      $("poseNotes").value = r.notes || "";
      commit();
      toast("Opened a shared pose — Ctrl+Z goes back to yours", 2600);
    } catch { toast("That link doesn't hold a PoseSandbox pose", 2600); }
  };
  window.addEventListener("hashchange", openShared);
  syncFigureUI();
  syncLensUI();
  renderLightList();
  updateInspector();
  setMode("rotate");
  history = createHistory({
    capture: snapshot,
    restore: (s) => loadDoc(JSON.parse(s), { camera: false }),
    onChange: () => { $("btnUndo").disabled = !history.canUndo(); $("btnRedo").disabled = !history.canRedo(); saveSessionSoon(); }
  });
  renderPresets();
  loop.start();
  // for the tests: where a joint of the active figure is on the canvas (CSS px)
  window.__ps = {
    pose: () => serializeScene(ctx, { camera: false }).joints,
    exportUrl: () => cleanRender(exportOptions(), (c) => finishExport(c).toDataURL("image/png")),
    screenOf: (name) => {
      const v = figure.joint(name).getWorldPosition(new THREE.Vector3()).project(camera);
      return [Math.round((v.x + 1) / 2 * canvas.clientWidth), Math.round((1 - v.y) / 2 * canvas.clientHeight)];
    }
  };
  requestAnimationFrame(() => { makePresetThumbs(); if (location.hash.startsWith("#p=")) openShared(); else if (restored) toast("Welcome back — your last scene is restored", 2200); });
}
