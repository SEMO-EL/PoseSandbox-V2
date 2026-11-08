// poses/presets.js
// The built-in pose library. Angles in degrees, Euler order ZYX (abduct, then twist, then bend — the order an
// artist thinks in). Legacy "l_" joints are the figure's RIGHT side. Every preset is grounded afterwards so the
// feet land on the floor; `lift` raises it again (a jump).
//
// Conventions at rest (arms hang, figure faces +Z):
//   shoulder: z = out to the side (l_ negative, r_ positive), x < 0 = forward
//   elbow/hip x < 0 = bend forward, knee x > 0 = bend back, ankle x > 0 = toes down
//   spine/chest/neck/head: x > 0 = bend forward, y = twist, z > 0 = lean to the l_ side

import * as THREE from "three";
import { applyHandPose } from "./hands.js";

export const PRESETS = [
  { id: "stand", name: "Stand", hands: "relaxed", joints: { l_shoulder: [0, 0, -7], r_shoulder: [0, 0, 7], l_elbow: [-10, 0, 0], r_elbow: [-10, 0, 0] } },
  { id: "tpose", name: "T-pose", hands: "open", joints: { l_shoulder: [0, 0, -90], r_shoulder: [0, 0, 90] } },
  { id: "apose", name: "A-pose", hands: "relaxed", joints: { l_shoulder: [0, 0, -45], r_shoulder: [0, 0, 45] } },
  {
    id: "contrapposto", name: "Contrapposto", hands: "relaxed",
    joints: {
      hips: [0, 6, -5], spine: [0, -2, 3], chest: [0, -4, 5], neck: [0, 4, -3], head: [-4, 6, -3],
      l_hip: [0, 0, 5], r_hip: [-10, 0, -2], r_knee: [20, 0, 0], r_ankle: [8, 0, 0],
      l_shoulder: [4, 0, -8], l_elbow: [-12, 0, 0], r_shoulder: [-8, 0, 10], r_elbow: [-24, 0, 0]
    }
  },
  {
    id: "walk", name: "Walk", hands: "relaxed",
    joints: {
      hips: [0, -6, 0], chest: [0, 9, 0], head: [0, -3, 0],
      l_hip: [-24, 0, 0], l_knee: [8, 0, 0], l_ankle: [-10, 0, 0],
      r_hip: [16, 0, 0], r_knee: [32, 0, 0], r_ankle: [20, 0, 0],
      l_shoulder: [20, 0, -6], l_elbow: [-12, 0, 0], r_shoulder: [-22, 0, 6], r_elbow: [-28, 0, 0]
    }
  },
  {
    id: "run", name: "Run", hands: "grip",
    joints: {
      spine: [12, 0, 0], chest: [4, 12, 0], head: [-10, -6, 0],
      l_hip: [-62, 0, 0], l_knee: [52, 0, 0], l_ankle: [-6, 0, 0],
      r_hip: [22, 0, 0], r_knee: [92, 0, 0], r_ankle: [34, 0, 0],
      l_shoulder: [42, 0, -8], l_elbow: [-82, 0, 0], r_shoulder: [-52, 0, 8], r_elbow: [-88, 0, 0]
    }
  },
  {
    id: "sit", name: "Sit", hands: "relaxed",
    joints: {
      spine: [-6, 0, 0], chest: [6, 0, 0], head: [6, 0, 0],
      l_hip: [-90, 0, -5], r_hip: [-90, 0, 5], l_knee: [90, 0, 0], r_knee: [90, 0, 0],
      l_shoulder: [-28, 0, -6], r_shoulder: [-28, 0, 6], l_elbow: [-52, 0, 0], r_elbow: [-52, 0, 0]
    }
  },
  {
    id: "kneel", name: "Kneel", hands: "relaxed",
    joints: {
      spine: [6, 0, 0], head: [4, 0, 0],
      l_hip: [-88, 0, -4], l_knee: [88, 0, 0],
      r_hip: [6, 0, 5], r_knee: [96, 0, 0], r_ankle: [38, 0, 0], r_toes: [-55, 0, 0],
      l_shoulder: [-12, 0, -10], l_elbow: [-72, 0, 0], r_shoulder: [0, 0, 8], r_elbow: [-18, 0, 0]
    }
  },
  {
    id: "squat", name: "Squat", hands: "relaxed",
    joints: {
      spine: [24, 0, 0], chest: [10, 0, 0], head: [-18, 0, 0],
      l_hip: [-112, 0, -16], r_hip: [-112, 0, 16], l_knee: [130, 0, 0], r_knee: [130, 0, 0],
      l_ankle: [-22, 0, 0], r_ankle: [-22, 0, 0],
      l_shoulder: [-72, 0, -4], r_shoulder: [-72, 0, 4], l_elbow: [-28, 0, 0], r_elbow: [-28, 0, 0]
    }
  },
  {
    id: "reach", name: "Reach up", hands: "open",
    joints: {
      spine: [0, 0, -6], chest: [0, 0, -8], neck: [-10, 0, 0], head: [-18, 0, -4],
      r_shoulder: [0, 0, 165], r_elbow: [-8, 0, 0], l_shoulder: [-12, 0, -12], l_elbow: [-14, 0, 0],
      l_ankle: [16, 0, 0], r_ankle: [16, 0, 0]
    }
  },
  {
    id: "point", name: "Point", handsL: "point", handsR: "relaxed",
    joints: {
      chest: [0, -10, 0], head: [0, -8, 0],
      l_shoulder: [-84, -8, 0], r_shoulder: [0, 0, 8], r_elbow: [-14, 0, 0]
    }
  },
  {
    id: "wave", name: "Wave", handsL: "relaxed", handsR: "open",
    joints: {
      head: [0, 10, -4], chest: [0, 6, 0],
      r_shoulder: [0, 90, 75], r_elbow: [-100, 0, 0], r_wrist: [0, 0, -10],
      l_shoulder: [0, 0, -6], l_elbow: [-12, 0, 0]
    }
  },
  {
    id: "fight", name: "Guard", hands: "fist",
    joints: {
      hips: [0, -25, 0], chest: [6, 18, 0], head: [6, 8, 0],
      l_hip: [-26, 0, -12], l_knee: [36, 0, 0], l_ankle: [-10, 0, 0],
      r_hip: [16, 0, 10], r_knee: [26, 0, 0], r_ankle: [10, 0, 0],
      l_shoulder: [-58, 0, -22], l_elbow: [-112, 0, 0], r_shoulder: [-40, 0, 24], r_elbow: [-126, 0, 0]
    }
  },
  {
    id: "jump", name: "Jump", hands: "open", lift: 0.28,
    joints: {
      spine: [-8, 0, 0], head: [-16, 0, 0],
      l_hip: [-62, 0, -6], l_knee: [92, 0, 0], l_ankle: [30, 0, 0],
      r_hip: [-18, 0, 6], r_knee: [72, 0, 0], r_ankle: [30, 0, 0],
      l_shoulder: [0, 0, -150], r_shoulder: [0, 0, 150], l_elbow: [-8, 0, 0], r_elbow: [-8, 0, 0]
    }
  },
  {
    id: "lookback", name: "Look back", hands: "relaxed",
    joints: {
      hips: [0, -6, 0], spine: [0, 22, 0], chest: [0, 30, 0], neck: [0, 20, 0], head: [-4, 26, 0],
      l_shoulder: [0, 0, -8], r_shoulder: [10, 0, 10], l_elbow: [-14, 0, 0], r_elbow: [-20, 0, 0]
    }
  },
  {
    id: "bow", name: "Bow", hands: "relaxed",
    joints: {
      hips: [12, 0, 0], spine: [28, 0, 0], chest: [20, 0, 0], neck: [10, 0, 0], head: [12, 0, 0],
      l_shoulder: [-58, 0, -4], r_shoulder: [-58, 0, 4], l_elbow: [-6, 0, 0], r_elbow: [-6, 0, 0]
    }
  },
  {
    id: "lie", name: "Lie down", hands: "relaxed",
    joints: {
      hips: [-90, 0, 0], head: [8, 0, 0],
      l_shoulder: [0, 0, -18], r_shoulder: [0, 0, 18], l_elbow: [-10, 0, 0], r_elbow: [-10, 0, 0],
      l_hip: [0, 0, -4], r_hip: [-25, 0, 4], r_knee: [50, 0, 0]
    }
  }
];

const e = new THREE.Euler(0, 0, 0, "ZYX");

/** Put the figure in a preset pose. Keeps where the whole figure stands (its root). */
export function applyPreset(figure, preset) {
  figure.resetPose({ keepRoot: true });
  for (const [name, deg] of Object.entries(preset.joints)) {
    const j = figure.joint(name);
    if (!j) continue;
    e.set(...deg.map(THREE.MathUtils.degToRad), "ZYX");
    j.quaternion.setFromEuler(e);
  }
  applyHandPose(figure, "l", preset.handsL || preset.hands || "relaxed");
  applyHandPose(figure, "r", preset.handsR || preset.hands || "relaxed");
  figure.ground();
  if (preset.lift) figure.joint("hips").position.y += preset.lift;
}
