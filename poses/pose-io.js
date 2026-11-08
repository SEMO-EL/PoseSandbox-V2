// poses/pose-io.js
// Pose files, gallery entries and undo snapshots all use this one format.
//
// v2 stores everything that makes the picture: joint rotations plus moves/scales, the figure's build and skin,
// props (type, colour, transform), custom lights, studio lights + background, imported-model placement, camera.
// v1 files (joints as bare quaternions, props) — including the Starter Pack — still load.

import { counterpartName } from "../character/character.js";
import { createProp, propColor } from "../core/world.js";
import { createCustomLight, applyLightParams, lightParams } from "../lights/custom-lights.js";

const LIGHT_KEYS = ["color", "intensity", "range", "angle", "penumbra", "castShadow", "showBulb"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const r5 = (arr) => arr.map((v) => Math.round(v * 1e5) / 1e5 + 0); // + 0 turns -0 into 0
// files store 5 decimals; re-normalising those would shift the last digit, so only fix quaternions that are really off
const setQ = (q, arr) => { q.fromArray(arr); if (Math.abs(q.length() - 1) > 1e-3) q.normalize(); return q; };
const xform = (o) => ({ position: r5(o.position.toArray()), quaternion: r5(o.quaternion.toArray()), scale: r5(o.scale.toArray()) });

function legacyType(name = "") {
  const n = name.toLowerCase();
  for (const t of ["sphere", "cylinder", "cone", "torus", "ring", "disc", "plane", "icosa", "octa", "dodeca", "tetra"]) if (n.includes(t)) return t;
  return "cube";
}

export function serializeScene({ figure, world, cameraState, envState }, { camera = true, notes = "" } = {}) {
  const joints = {};
  for (const j of figure.joints) {
    const e = { q: r5(j.quaternion.toArray()) };
    if (j.position.distanceToSquared(figure.restPosition(j.name)) > 1e-12) e.p = r5(j.position.toArray());
    const s = j.userData.segment.scale;
    if (Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) > 1e-6) e.s = r5(s.toArray());
    joints[j.name] = e;
  }
  const doc = {
    app: "PoseSandbox",
    version: 2,
    build: figure.build,
    skin: figure.skin,
    notes,
    joints,
    props: world.live("prop").map((p) => ({ uid: p.userData.uid, type: p.userData.type, name: p.name, color: "#" + propColor(p).getHexString(), ...xform(p) })),
    lights: world.live("light").map((l) => ({ uid: l.userData.uid, type: l.userData.lightType, name: l.name, ...lightParams(l), ...xform(l) })),
    imports: world.live("import").map((m) => ({ uid: m.userData.uid, name: m.name, ...xform(m) }))
  };
  if (envState) doc.env = envState(); // studio lights + background
  if (camera) doc.camera = cameraState();
  return doc;
}

/**
 * Apply a pose document. Only the item kinds present in the document are touched (a v1 file has no lights, so
 * your lights stay). Imported models cannot travel inside a pose file: they are matched by name and their
 * placement restored; the names not found are returned in `missing`.
 */
export function applyScene(doc, { figure, world, setCameraState, setEnvState }, { camera = true } = {}) {
  if (!doc || typeof doc !== "object" || !doc.joints || typeof doc.joints !== "object") throw new Error("Not a PoseSandbox pose");

  if (doc.build && doc.build !== figure.build) figure.create(doc.build);
  if (doc.skin && doc.skin !== figure.skin) figure.setSkin(doc.skin);
  figure.resetPose();
  for (const [name, v] of Object.entries(doc.joints)) {
    const j = figure.joint(name);
    if (!j) continue;
    if (Array.isArray(v)) { if (v.length === 4) setQ(j.quaternion, v); continue; } // v1
    if (v?.q?.length === 4) setQ(j.quaternion, v.q);
    if (v?.p?.length === 3) j.position.fromArray(v.p);
    if (v?.s?.length === 3) j.userData.segment.scale.fromArray(v.s);
  }

  const missing = [];
  const keep = new Set();
  const reuse = (d, kind) => {
    const o = d.uid && world.items.get(d.uid);
    return o && o.userData.kind === kind ? o : null;
  };
  const place = (o, d) => {
    if (d.position) o.position.fromArray(d.position);
    if (d.quaternion) setQ(o.quaternion, d.quaternion);
    if (d.scale) o.scale.fromArray(d.scale);
    if (d.name) o.name = d.name;
    if (d.uid) o.userData.uid = d.uid;
    world.add(o);
    keep.add(o);
  };

  for (const d of doc.props || []) {
    const type = d.type || legacyType(d.name);
    let o = reuse(d, "prop");
    if (o && o.userData.type !== type) o = null;
    if (!o) o = createProp(type, { color: d.color });
    else if (d.color) propColor(o).set(d.color);
    place(o, d);
  }
  for (const d of doc.lights || []) {
    let o = reuse(d, "light");
    if (o && o.userData.lightType !== d.type) o = null;
    if (!o) o = createCustomLight(d.type, pick(d, LIGHT_KEYS));
    else applyLightParams(o, pick(d, LIGHT_KEYS));
    place(o, d);
  }
  for (const d of doc.imports || []) {
    const o = reuse(d, "import") || [...world.items.values()].find((x) => x.userData.kind === "import" && x.name === d.name);
    if (!o) { missing.push(d.name); continue; }
    place(o, d);
  }
  for (const kind of ["prop", "light", "import"]) {
    if (!Array.isArray(doc[kind + "s"])) continue;
    for (const o of world.live(kind)) if (!keep.has(o)) world.remove(o);
  }

  if (doc.env && setEnvState) setEnvState(doc.env);
  if (camera && doc.camera && setCameraState) setCameraState(doc.camera);
  return { missing, notes: typeof doc.notes === "string" ? doc.notes : null };
}

/** Reflect a rotation across the figure's mid plane (x → -x). */
export function mirrorQuaternion(q, out) {
  return out.set(q.x, -q.y, -q.z, q.w);
}

/** Swap left and right for the whole figure. */
export function mirrorPose(figure) {
  const snap = new Map(figure.joints.map((j) => [j.name, { q: j.quaternion.clone(), p: j.position.clone(), s: j.userData.segment.scale.clone() }]));
  for (const j of figure.joints) {
    const src = snap.get(counterpartName(j.name) || j.name);
    mirrorQuaternion(src.q, j.quaternion);
    j.userData.segment.scale.copy(src.s);
    if (!counterpartName(j.name)) j.position.set(-src.p.x, src.p.y, src.p.z); // centre joints (root, hips) may be moved
  }
}
