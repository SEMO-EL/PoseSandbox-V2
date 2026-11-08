// character/character.js
// The artist's mannequin: tapered limbs, ball joints, a waist, hands with fingers and feet with toes.
// Metres, Y up, the figure faces +Z and stands on y = 0. Every joint rests at identity rotation.
//
// Joint names are kept from v1 so old pose files and the Starter Pack still load. The legacy "l_" joints sit
// at -X, which is the figure's anatomical RIGHT side (it faces +Z) — jointLabel() names them for the user.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const BUILDS = {
  neutral:   { label: "Neutral",   sh: 0.18,  chest: [0.155, 0.16, 0.105], waist: [0.118, 0.09, 0.085], pelvis: [0.15, 0.1, 0.1],     hipX: 0.088, limb: 1 },
  feminine:  { label: "Feminine",  sh: 0.165, chest: [0.138, 0.15, 0.1],   waist: [0.1, 0.088, 0.078],  pelvis: [0.165, 0.105, 0.105], hipX: 0.096, limb: 0.9 },
  masculine: { label: "Masculine", sh: 0.2,   chest: [0.178, 0.172, 0.118], waist: [0.13, 0.095, 0.092], pelvis: [0.152, 0.1, 0.1],   hipX: 0.088, limb: 1.13 }
};

export const SKINS = {
  clay:  { label: "Clay",  color: 0xcdc6bb },
  wood:  { label: "Wood",  color: 0xc49a6c },
  slate: { label: "Slate", color: 0x8c95ab }
};

export const FINGERS = ["index", "middle", "ring", "pinky"];
const FINGER = { // z along the palm (thumb side is +Z), segment lengths, radius
  index:  { z: 0.03,  len: [0.042, 0.034], r: 0.0088 },
  middle: { z: 0.01,  len: [0.046, 0.037], r: 0.009 },
  ring:   { z: -0.01, len: [0.043, 0.034], r: 0.0085 },
  pinky:  { z: -0.029, len: [0.033, 0.027], r: 0.0075 }
};

/** Mirror pairs: "l_elbow" <-> "r_elbow". */
export function counterpartName(name) {
  if (name.startsWith("l_")) return "r_" + name.slice(2);
  if (name.startsWith("r_")) return "l_" + name.slice(2);
  return null;
}

const PART = {
  char_root: "Whole figure", hips: "Pelvis", spine: "Waist", chest: "Chest", neck: "Neck", head: "Head",
  shoulder: "upper arm", elbow: "forearm", wrist: "hand", hip: "thigh", knee: "shin", ankle: "foot", toes: "toes",
  thumb1: "thumb (base)", thumb2: "thumb (tip)"
};

/** User-facing name. Legacy "l_" is the figure's right side. */
export function jointLabel(name) {
  if (PART[name]) return PART[name];
  const side = name.startsWith("l_") ? "Right" : name.startsWith("r_") ? "Left" : "";
  const part = name.slice(2);
  const finger = part.match(/^(index|middle|ring|pinky)([12])$/);
  const text = finger ? `${finger[1]} finger (${finger[2] === "1" ? "base" : "tip"})` : PART[part] || part;
  return `${side} ${text}`.trim();
}

/** Which IK chain a joint belongs to: "l_arm", "r_leg", … or null for the torso. */
export function chainOf(name) {
  const m = name.match(/^([lr])_(.*)$/);
  if (!m) return null;
  return /^(hip|knee|ankle|toes)$/.test(m[2]) ? `${m[1]}_leg` : `${m[1]}_arm`;
}

export const CHAINS = {
  l_arm: ["l_shoulder", "l_elbow", "l_wrist"], r_arm: ["r_shoulder", "r_elbow", "r_wrist"],
  l_leg: ["l_hip", "l_knee", "l_ankle"], r_leg: ["r_hip", "r_knee", "r_ankle"]
};

/* ------------------------------------------------------------------ geometry */

// A limb hanging down from the joint: tapers from r0 to r1 with a slight belly, ends tucked into the ball joints.
function limbGeo(r0, r1, len) {
  const pts = [];
  const n = 14;
  pts.push(new THREE.Vector2(0, -0.01));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const end = Math.min(1, Math.min(t, 1 - t) * 7); // round the two ends in
    const r = THREE.MathUtils.lerp(r0, r1, t) * (1 + 0.1 * Math.sin(Math.PI * t)) * (0.55 + 0.45 * end);
    pts.push(new THREE.Vector2(r, -0.01 - t * (len - 0.02)));
  }
  pts.push(new THREE.Vector2(0, -len + 0.01));
  return new THREE.LatheGeometry(pts.reverse(), 24); // bottom-to-top keeps the normals facing out
}

const ellipsoid = (rx, ry, rz) => new THREE.SphereGeometry(1, 32, 20).scale(rx, ry, rz);
const ball = (r) => new THREE.SphereGeometry(r, 20, 14);

function capsule(r, len) { // hanging down from y = 0
  return new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10).translate(0, -len / 2, 0);
}

/* ------------------------------------------------------------------ mannequin */

export class Mannequin {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.joints = [];
    this.byName = new Map();
    this.rest = new Map(); // name -> rest position
    this.build = "neutral";
    this.skin = "clay";
  }

  joint(name) {
    return this.byName.get(name) || null;
  }

  restPosition(name) {
    return this.rest.get(name);
  }

  /** (Re)build the figure, keeping the current pose (rotations, moves, scales) by joint name. */
  create(build = this.build) {
    const keep = this.root ? this.capture() : null;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    }
    this.build = BUILDS[build] ? build : "neutral";
    this.joints = [];
    this.byName.clear();
    this.rest.clear();
    this._make(BUILDS[this.build]);
    this.scene.add(this.root);
    this.setSkin(this.skin);
    if (keep) this.restore(keep);
    return this;
  }

  /** Every joint's local transform, for rebuilds. */
  capture() {
    return this.joints.map((j) => ({ name: j.name, p: j.position.clone(), q: j.quaternion.clone(), s: j.userData.segment.scale.clone() }));
  }

  restore(list) {
    for (const e of list) {
      const j = this.joint(e.name);
      if (!j) continue;
      j.position.copy(e.p);
      j.quaternion.copy(e.q);
      j.userData.segment.scale.copy(e.s);
    }
  }

  /** Back to the rest pose. keepRoot leaves the whole-figure placement alone. */
  resetPose({ keepRoot = false } = {}) {
    for (const j of this.joints) {
      if (keepRoot && j.name === "char_root") continue;
      j.position.copy(this.rest.get(j.name));
      j.quaternion.identity();
      j.userData.segment.scale.set(1, 1, 1);
    }
  }

  /** Raise or lower the pelvis so the lowest point of the body touches the floor (y = 0). */
  ground() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.root.traverse((o) => { if (o.isMesh && !o.userData.helper) box.expandByObject(o, true); });
    if (!box.isEmpty()) this.joint("hips").position.y -= box.min.y;
  }

  setSkin(name) {
    this.skin = SKINS[name] ? name : "clay";
    const base = new THREE.Color(SKINS[this.skin].color);
    this.root.traverse((o) => {
      if (!o.isMesh || o.userData.helper) return;
      o.material.color.copy(base).multiplyScalar(o.userData.tone ?? 1);
    });
  }

  /** Meshes that belong to a joint's segment (what highlights when it is selected). */
  segmentMeshes(joint) {
    const out = [];
    joint.userData.segment?.traverse((o) => { if (o.isMesh) out.push(o); });
    return out;
  }

  /* ---------------------------------------------------------------- building */

  _joint(name, parent, x = 0, y = 0, z = 0) {
    const j = new THREE.Group();
    j.name = name;
    j.position.set(x, y, z);
    j.userData.isJoint = true;
    const seg = new THREE.Group();
    seg.name = name + "_segment";
    seg.userData.isSegment = true;
    seg.userData.joint = j;
    j.add(seg);
    j.userData.segment = seg;
    if (parent) parent.add(j);
    this.joints.push(j);
    this.byName.set(name, j);
    this.rest.set(name, j.position.clone());
    return j;
  }

  _mesh(joint, geo, { x = 0, y = 0, z = 0, tone = 1, helper = false } = {}) {
    const mat = helper
      ? new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.55, depthWrite: false })
      : new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.02 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = !helper;
    m.receiveShadow = !helper;
    m.userData.pickable = true;
    m.userData.joint = joint;
    m.userData.tone = tone;
    if (helper) m.userData.helper = true;
    joint.userData.segment.add(m);
    return m;
  }

  _make(B) {
    const L = B.limb;
    const root = this._joint("char_root", null);
    this.root = root;
    // whole-figure handle: a ring on the floor around the feet
    this._mesh(root, new THREE.TorusGeometry(0.34, 0.007, 8, 64).rotateX(Math.PI / 2), { y: 0.004, helper: true });

    const hips = this._joint("hips", root, 0, 0.97, 0);
    this._mesh(hips, ellipsoid(...B.pelvis), { y: -0.012 });

    const spine = this._joint("spine", hips, 0, 0.12, 0);
    this._mesh(spine, ellipsoid(...B.waist), { y: 0.06 });

    const chest = this._joint("chest", spine, 0, 0.15, 0);
    this._mesh(chest, ellipsoid(...B.chest), { y: 0.13, z: -0.005 });

    const neck = this._joint("neck", chest, 0, 0.26, -0.01);
    this._mesh(neck, capsule(0.043, 0.11), { y: 0.1 });

    const head = this._joint("head", neck, 0, 0.09, 0);
    this._mesh(head, ellipsoid(0.082, 0.112, 0.097), { y: 0.1, z: 0.012 });
    this._mesh(head, ellipsoid(0.013, 0.02, 0.018), { y: 0.085, z: 0.103, tone: 0.97 }); // nose: which way the face looks

    for (const side of ["l", "r"]) {
      const s = side === "l" ? -1 : 1;  // -X for the legacy "l_" side
      const inward = -s;

      // arm
      const sh = this._joint(`${side}_shoulder`, chest, s * B.sh, 0.215, -0.01);
      this._mesh(sh, ball(0.054 * L), { tone: 0.9 });
      this._mesh(sh, limbGeo(0.047 * L, 0.036 * L, 0.285));
      const el = this._joint(`${side}_elbow`, sh, 0, -0.285, 0);
      this._mesh(el, ball(0.037 * L), { tone: 0.9 });
      this._mesh(el, limbGeo(0.038 * L, 0.028 * L, 0.25));
      const wr = this._joint(`${side}_wrist`, el, 0, -0.25, 0);
      this._mesh(wr, ball(0.026 * L), { tone: 0.9 });
      this._mesh(wr, new RoundedBoxGeometry(0.03, 0.092, 0.082, 3, 0.012), { y: -0.058 });
      for (const f of FINGERS) {
        const d = FINGER[f];
        const f1 = this._joint(`${side}_${f}1`, wr, 0, -0.1, d.z);
        this._mesh(f1, capsule(d.r, d.len[0]));
        const f2 = this._joint(`${side}_${f}2`, f1, 0, -d.len[0] + d.r * 0.4, 0);
        this._mesh(f2, capsule(d.r * 0.92, d.len[1]));
      }
      // thumb: its own axis points down, forward and slightly in
      const dir = new THREE.Vector3(inward * 0.3, -0.75, 0.6).normalize();
      const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const along = (g) => g.applyQuaternion(tilt);
      const t1 = this._joint(`${side}_thumb1`, wr, inward * 0.008, -0.035, 0.04);
      this._mesh(t1, along(capsule(0.011, 0.042)));
      const t2 = this._joint(`${side}_thumb2`, t1, ...dir.clone().multiplyScalar(0.036).toArray());
      this._mesh(t2, along(capsule(0.0098, 0.032)));

      // leg
      const hip = this._joint(`${side}_hip`, hips, s * B.hipX, -0.05, 0);
      this._mesh(hip, ball(0.066 * L), { tone: 0.9 });
      this._mesh(hip, limbGeo(0.072 * L, 0.048 * L, 0.42));
      const kn = this._joint(`${side}_knee`, hip, 0, -0.42, 0);
      this._mesh(kn, ball(0.048 * L), { tone: 0.9 });
      this._mesh(kn, limbGeo(0.05 * L, 0.034 * L, 0.42));
      const an = this._joint(`${side}_ankle`, kn, 0, -0.42, 0);
      this._mesh(an, ball(0.034 * L), { tone: 0.9 });
      this._mesh(an, new RoundedBoxGeometry(0.085, 0.065, 0.17, 3, 0.022), { y: -0.0455, z: 0.035 });
      const toes = this._joint(`${side}_toes`, an, 0, -0.05, 0.12);
      this._mesh(toes, new RoundedBoxGeometry(0.082, 0.04, 0.056, 3, 0.016), { y: -0.01, z: 0.026 });
    }
  }
}
