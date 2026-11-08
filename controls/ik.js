// controls/ik.js
// Analytic two-bone IK (shoulder→elbow→wrist, hip→knee→ankle). The elbow/knee keeps bending the way it already
// bends; when the limb is dead straight it falls back to a default bend (elbows back, knees forward).

import * as THREE from "three";

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const t = new THREE.Vector3(), dir = new THREE.Vector3(), pole = new THREE.Vector3(), bNew = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const dq = new THREE.Quaternion(), wq = new THREE.Quaternion(), pq = new THREE.Quaternion();

/** Turn `joint` (about its world pivot) so the direction pivot→from points along pivot→to. */
function aim(joint, pivot, from, to) {
  v1.subVectors(from, pivot).normalize();
  v2.subVectors(to, pivot).normalize();
  dq.setFromUnitVectors(v1, v2);
  joint.getWorldQuaternion(wq);
  joint.parent.getWorldQuaternion(pq);
  joint.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
  joint.updateWorldMatrix(false, true);
}

/**
 * Solve so `end` reaches `target` (world). `defaultPole` is a world direction used only for a straight limb.
 * Returns the distance still missing (0 when reachable).
 */
export function solveTwoBone(upper, mid, end, target, defaultPole) {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(a);
  mid.getWorldPosition(b);
  end.getWorldPosition(c);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);

  dir.subVectors(target, a);
  const want = dir.length();
  const d = THREE.MathUtils.clamp(want, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  dir.normalize();

  v1.subVectors(b, a);
  pole.copy(v1).addScaledVector(dir, -v1.dot(dir));
  if (pole.lengthSq() < 1e-8) pole.copy(defaultPole).addScaledVector(dir, -defaultPole.dot(dir));
  pole.normalize();

  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  bNew.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(pole, l1 * Math.sqrt(1 - cosA * cosA));

  aim(upper, a, b, bNew);
  mid.getWorldPosition(b);
  end.getWorldPosition(c);
  t.copy(a).addScaledVector(dir, d);
  aim(mid, b, c, t);
  return Math.max(0, want - d);
}

/** Keep `joint`'s world orientation equal to `worldQuat` (a planted hand or foot) after its parents moved. */
export function holdWorldRotation(joint, worldQuat) {
  joint.parent.updateWorldMatrix(true, false);
  joint.parent.getWorldQuaternion(pq);
  joint.quaternion.copy(pq.invert().multiply(worldQuat));
  joint.updateWorldMatrix(false, true);
}
