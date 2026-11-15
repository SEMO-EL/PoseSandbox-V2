// controls/ik.js
// Analytic two-bone IK (shoulder→elbow→wrist, hip→knee→ankle). The elbow/knee keeps bending the way it already
// bends; when the limb is dead straight it falls back to a default bend (elbows back, knees forward).

import * as THREE from "three";

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const t = new THREE.Vector3(), dir = new THREE.Vector3(), pole = new THREE.Vector3(), bNew = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const dq = new THREE.Quaternion(), wq = new THREE.Quaternion(), pq = new THREE.Quaternion();
const xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3(), zAxis = new THREE.Vector3(), basis = new THREE.Matrix4();

/** Turn `joint` (about its world pivot) so the direction pivot→from points along pivot→to. */
export function aim(joint, pivot, from, to) {
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
 *
 * hinge: -1 for an arm, +1 for a leg, 0 for neither. With it the upper bone is also twisted so that the elbow or
 * knee bends purely about its own X axis, the way the real joint does (and the way the pose library writes it);
 * without it the middle joint just turns whichever way is shortest.
 */
export function solveTwoBone(upper, mid, end, target, defaultPole, hinge = 0) {
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

  t.copy(a).addScaledVector(dir, d); // where the end will be
  if (hinge) {
    yAxis.subVectors(a, bNew).normalize();                        // the bones hang along their own -Y
    v1.subVectors(t, bNew);
    zAxis.copy(v1).addScaledVector(yAxis, -v1.dot(yAxis));        // which way the limb is bent
    if (zAxis.lengthSq() > 1e-10) {
      zAxis.normalize().multiplyScalar(-hinge);                   // a forearm bends toward its +Z, a shin toward -Z
      xAxis.crossVectors(yAxis, zAxis);
      upper.parent.getWorldQuaternion(pq);
      upper.quaternion.copy(pq.invert()).multiply(wq.setFromRotationMatrix(basis.makeBasis(xAxis, yAxis, zAxis)));
      const bend = hinge * Math.acos(THREE.MathUtils.clamp(-v1.normalize().dot(yAxis), -1, 1));
      mid.quaternion.set(Math.sin(bend / 2), 0, 0, Math.cos(bend / 2));
      upper.updateWorldMatrix(false, true);
      mid.getWorldPosition(b);
    }
  }
  // (after the hinge step these two are only hair-thin corrections for bones that don't hang exactly along -Y)
  aim(upper, a, b, bNew);
  mid.getWorldPosition(b);
  end.getWorldPosition(c);
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

/**
 * Make a joint a hinge: keep only its turn about its own X axis (how elbows and knees bend) and hold that between
 * min and max (radians). Used when a forearm or shin is dragged, so it can't twist off or bend the wrong way.
 */
export function clampHinge(q, min, max) {
  const angle = 2 * Math.atan2(q.x, q.w);
  const a = THREE.MathUtils.clamp(angle > Math.PI ? angle - 2 * Math.PI : angle < -Math.PI ? angle + 2 * Math.PI : angle, min, max);
  return q.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
}
