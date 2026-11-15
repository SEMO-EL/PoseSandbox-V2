// tools/aim_angles.mjs
// Pose-authoring helper: turn "this limb points there and bends toward there" into the preset angles
// ([x, y, z] degrees, Euler ZYX) that poses/presets.js uses.
//
//   node tools/aim_angles.mjs "0.5,-0.82,-0.28" "-0.85,0.1,0.5"
//
// First vector: where the limb points (an upper arm or thigh hangs along -Y at rest).
// Second: the limb's own "front" (+Z at rest) — an elbow bends the forearm toward it, a knee bends the shin away.
// Axes: +X is the figure's left (the r_ joints), +Y up, +Z the way it faces. Mirror X for the other side.
// Angles are relative to the parent (chest or pelvis), so they are exact only while that parent is upright.

import * as THREE from "../vendor/three/three.core.js";

export function aimAngles(dir, front) {
  const y = new THREE.Vector3(...dir).normalize().negate();
  const z0 = new THREE.Vector3(...front).normalize();
  const x = new THREE.Vector3().crossVectors(y, z0).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z), "ZYX");
  return [e.x, e.y, e.z].map((v) => Math.round(THREE.MathUtils.radToDeg(v)) + 0);
}

if (process.argv[2]) {
  const v = (s) => s.split(",").map(Number);
  const a = aimAngles(v(process.argv[2]), v(process.argv[3] || "0,0,1"));
  console.log(JSON.stringify(a), " mirrored:", JSON.stringify([a[0], -a[1], -a[2]]));
}

/**
 * The same for a whole arm or leg: where the wrist (or ankle) should be and which way the elbow (knee) points.
 * from: the shoulder or hip joint, to: the wrist or ankle, pole: the side the middle joint bulges toward.
 * Returns { upper: [x, y, z], bend: degrees } — bend is the elbow's -x or the knee's +x.
 */
export function reachAngles(from, to, pole, l1 = 0.27, l2 = 0.269, leg = false) {
  const a = new THREE.Vector3(...from), u = new THREE.Vector3(...to).sub(a);
  const d = Math.min(u.length(), l1 + l2 - 1e-4);
  u.normalize();
  const p = new THREE.Vector3(...pole).addScaledVector(u, -new THREE.Vector3(...pole).dot(u)).normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const mid = u.clone().multiplyScalar(Math.cos(A)).addScaledVector(p, Math.sin(A));       // shoulder -> elbow
  const fore = u.clone().multiplyScalar(d).addScaledVector(mid, -l1).normalize();            // elbow -> wrist
  const front = fore.clone().addScaledVector(mid, -fore.dot(mid)).normalize();               // the way it bends
  const bend = Math.round(THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, fore.dot(mid))))));
  return { upper: aimAngles(mid.toArray(), (leg ? front.negate() : front).toArray()), bend };
}
