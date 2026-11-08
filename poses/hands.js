// poses/hands.js
// Hand shapes. Angles are degrees, Euler order ZYX, written for the legacy "l_" hand; the other hand is mirrored.
// Fingers hang along -Y with the palm facing the body, so curling a finger is a Z rotation toward the palm.

import * as THREE from "three";
import { FINGERS } from "../character/character.js";
import { mirrorQuaternion } from "./pose-io.js";

const curl = (base, tip, spread = [0, 0, 0, 0]) =>
  Object.fromEntries(FINGERS.flatMap((f, i) => [[`${f}1`, [spread[i], 0, base[i]]], [`${f}2`, [0, 0, tip[i]]]]));

export const HAND_POSES = {
  relaxed: { label: "Relaxed", ...curl([18, 24, 28, 32], [22, 28, 32, 36]), thumb1: [20, 0, 12], thumb2: [0, 0, 18] },
  open:    { label: "Open",    ...curl([0, 0, 0, 0], [0, 0, 0, 0], [-10, -3, 4, 11]), thumb1: [-12, 0, -8], thumb2: [0, 0, 0] },
  fist:    { label: "Fist",    ...curl([88, 92, 94, 96], [100, 104, 104, 104]), thumb1: [52, 0, 38], thumb2: [0, 0, 45] },
  point:   { label: "Point",   ...curl([0, 92, 94, 96], [0, 104, 104, 104]), thumb1: [48, 0, 34], thumb2: [0, 0, 40] },
  grip:    { label: "Grip",    ...curl([62, 66, 68, 70], [70, 74, 74, 76]), thumb1: [40, 0, 26], thumb2: [0, 0, 26] },
  peace:   { label: "Peace",   ...curl([0, 0, 94, 96], [0, 0, 104, 104], [-9, 6, 0, 0]), thumb1: [50, 0, 36], thumb2: [0, 0, 42] },
  claw:    { label: "Claw",    ...curl([30, 32, 34, 36], [80, 84, 84, 86], [-8, -2, 4, 9]), thumb1: [10, 0, 20], thumb2: [0, 0, 40] }
};

const e = new THREE.Euler(0, 0, 0, "ZYX");
const q = new THREE.Quaternion();

/** side: "l" or "r" (legacy joint prefix). */
export function applyHandPose(figure, side, name) {
  const pose = HAND_POSES[name];
  if (!pose) return;
  for (const [part, deg] of Object.entries(pose)) {
    if (part === "label") continue;
    const j = figure.joint(`${side}_${part}`);
    if (!j) continue;
    e.set(...deg.map(THREE.MathUtils.degToRad), "ZYX");
    q.setFromEuler(e);
    if (side === "r") mirrorQuaternion(q, j.quaternion);
    else j.quaternion.copy(q);
  }
}
