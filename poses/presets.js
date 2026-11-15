// poses/presets.js
// The built-in pose library. Angles in degrees, Euler order ZYX (abduct, then twist, then bend — the order an
// artist thinks in). Legacy "l_" joints are the figure's RIGHT side. Every preset is grounded afterwards so the
// feet land on the floor; `lift` raises it again (a jump). `group` is the heading it is listed under. `plain` poses (stand, T, A) are left out of gesture practice.
//
// Conventions at rest (arms hang, figure faces +Z):
//   shoulder: z = out to the side (l_ negative, r_ positive), x < 0 = forward
//   elbow/hip x < 0 = bend forward, knee x > 0 = bend back, ankle x > 0 = toes down
//   spine/chest/neck/head: x > 0 = bend forward, y = twist, z > 0 = lean to the l_ side

import * as THREE from "three";
import { applyHandPose } from "./hands.js";

export const PRESETS = [
  { id: "stand", group: "Standing", name: "Stand", plain: true, hands: "relaxed", joints: { l_shoulder: [0, 0, -7], r_shoulder: [0, 0, 7], l_elbow: [-10, 0, 0], r_elbow: [-10, 0, 0] } },
  { id: "tpose", group: "Standing", name: "T-pose", plain: true, hands: "open", joints: { l_shoulder: [0, 0, -90], r_shoulder: [0, 0, 90] } },
  { id: "apose", group: "Standing", name: "A-pose", plain: true, hands: "relaxed", joints: { l_shoulder: [0, 0, -45], r_shoulder: [0, 0, 45] } },
  {
    id: "contrapposto", group: "Standing", name: "Contrapposto", hands: "relaxed",
    joints: {
      hips: [0, 6, -5], spine: [0, -2, 3], chest: [0, -4, 5], neck: [0, 4, -3], head: [-4, 6, -3],
      l_hip: [0, 0, 5], r_hip: [-10, 0, -2], r_knee: [20, 0, 0], r_ankle: [8, 0, 0],
      l_shoulder: [4, 0, -8], l_elbow: [-12, 0, 0], r_shoulder: [-8, 0, 10], r_elbow: [-24, 0, 0]
    }
  },
  {
    id: "walk", group: "Action", name: "Walk", hands: "relaxed",
    joints: {
      hips: [0, -6, 0], chest: [0, 9, 0], head: [0, -3, 0],
      l_hip: [-24, 0, 0], l_knee: [8, 0, 0], l_ankle: [-10, 0, 0],
      r_hip: [16, 0, 0], r_knee: [32, 0, 0], r_ankle: [20, 0, 0],
      l_shoulder: [20, 0, -6], l_elbow: [-12, 0, 0], r_shoulder: [-22, 0, 6], r_elbow: [-28, 0, 0]
    }
  },
  {
    id: "run", group: "Action", name: "Run", hands: "grip",
    joints: {
      spine: [12, 0, 0], chest: [4, 12, 0], head: [-10, -6, 0],
      l_hip: [-62, 0, 0], l_knee: [52, 0, 0], l_ankle: [-6, 0, 0],
      r_hip: [22, 0, 0], r_knee: [92, 0, 0], r_ankle: [34, 0, 0],
      l_shoulder: [42, 0, -8], l_elbow: [-82, 0, 0], r_shoulder: [-52, 0, 8], r_elbow: [-88, 0, 0]
    }
  },
  {
    id: "sit", group: "Seated and floor", name: "Sit", hands: "relaxed",
    joints: {
      spine: [-6, 0, 0], chest: [6, 0, 0], head: [6, 0, 0],
      l_hip: [-90, 0, -5], r_hip: [-90, 0, 5], l_knee: [90, 0, 0], r_knee: [90, 0, 0],
      l_shoulder: [-28, 0, -6], r_shoulder: [-28, 0, 6], l_elbow: [-52, 0, 0], r_elbow: [-52, 0, 0]
    }
  },
  {
    id: "kneel", group: "Seated and floor", name: "Kneel", hands: "relaxed",
    joints: {
      spine: [6, 0, 0], head: [4, 0, 0],
      l_hip: [-88, 0, -4], l_knee: [88, 0, 0],
      r_hip: [6, 0, 5], r_knee: [96, 0, 0], r_ankle: [38, 0, 0], r_toes: [-55, 0, 0],
      l_shoulder: [-12, 0, -10], l_elbow: [-72, 0, 0], r_shoulder: [0, 0, 8], r_elbow: [-18, 0, 0]
    }
  },
  {
    id: "squat", group: "Seated and floor", name: "Squat", hands: "relaxed",
    joints: {
      spine: [24, 0, 0], chest: [10, 0, 0], head: [-18, 0, 0],
      l_hip: [-112, 0, -16], r_hip: [-112, 0, 16], l_knee: [130, 0, 0], r_knee: [130, 0, 0],
      l_ankle: [-22, 0, 0], r_ankle: [-22, 0, 0],
      l_shoulder: [-72, 0, -4], r_shoulder: [-72, 0, 4], l_elbow: [-28, 0, 0], r_elbow: [-28, 0, 0]
    }
  },
  {
    id: "reach", group: "Standing", name: "Reach up", hands: "open",
    joints: {
      spine: [0, 0, -6], chest: [0, 0, -8], neck: [-10, 0, 0], head: [-18, 0, -4],
      r_shoulder: [0, 0, 165], r_elbow: [-8, 0, 0], l_shoulder: [-12, 0, -12], l_elbow: [-14, 0, 0],
      l_ankle: [16, 0, 0], r_ankle: [16, 0, 0]
    }
  },
  {
    id: "point", group: "Gesture", name: "Point", handsL: "point", handsR: "relaxed",
    joints: {
      chest: [0, -10, 0], head: [0, -8, 0],
      l_shoulder: [-84, -8, 0], r_shoulder: [0, 0, 8], r_elbow: [-14, 0, 0]
    }
  },
  {
    id: "wave", group: "Gesture", name: "Wave", handsL: "relaxed", handsR: "open",
    joints: {
      head: [0, 10, -4], chest: [0, 6, 0],
      r_shoulder: [0, 90, 75], r_elbow: [-100, 0, 0], r_wrist: [0, 0, -10],
      l_shoulder: [0, 0, -6], l_elbow: [-12, 0, 0]
    }
  },
  {
    id: "fight", group: "Action", name: "Guard", hands: "fist",
    joints: {
      hips: [0, -25, 0], chest: [6, 18, 0], head: [6, 8, 0],
      l_hip: [-26, 0, -12], l_knee: [36, 0, 0], l_ankle: [-10, 0, 0],
      r_hip: [16, 0, 10], r_knee: [26, 0, 0], r_ankle: [10, 0, 0],
      l_shoulder: [-58, 0, -22], l_elbow: [-112, 0, 0], r_shoulder: [-40, 0, 24], r_elbow: [-126, 0, 0]
    }
  },
  {
    id: "jump", group: "Action", name: "Jump", hands: "open", lift: 0.28,
    joints: {
      spine: [-8, 0, 0], head: [-16, 0, 0],
      l_hip: [-62, 0, -6], l_knee: [92, 0, 0], l_ankle: [30, 0, 0],
      r_hip: [-18, 0, 6], r_knee: [72, 0, 0], r_ankle: [30, 0, 0],
      l_shoulder: [0, 0, -135], r_shoulder: [0, 0, 135], l_elbow: [-8, 0, 0], r_elbow: [-8, 0, 0]
    }
  },
  {
    id: "lookback", group: "Standing", name: "Look back", hands: "relaxed",
    joints: {
      hips: [0, -6, 0], spine: [0, 22, 0], chest: [0, 30, 0], neck: [0, 20, 0], head: [-4, 26, 0],
      l_shoulder: [0, 0, -8], r_shoulder: [10, 0, 10], l_elbow: [-14, 0, 0], r_elbow: [-20, 0, 0]
    }
  },
  {
    id: "bow", group: "Gesture", name: "Bow", hands: "relaxed",
    joints: {
      hips: [12, 0, 0], spine: [28, 0, 0], chest: [20, 0, 0], neck: [10, 0, 0], head: [12, 0, 0],
      l_shoulder: [-58, 0, -4], r_shoulder: [-58, 0, 4], l_elbow: [-6, 0, 0], r_elbow: [-6, 0, 0]
    }
  },
  {
    id: "lie", group: "Seated and floor", name: "Lie down", hands: "relaxed",
    joints: {
      hips: [-90, 0, 0], head: [8, 0, 0],
      l_shoulder: [0, 0, -18], r_shoulder: [0, 0, 18], l_elbow: [-10, 0, 0], r_elbow: [-10, 0, 0],
      l_hip: [0, 0, -4], r_hip: [-25, 0, 4], r_knee: [50, 0, 0]
    }
  },

  /* ---- standing ---- */
  {
    id: "akimbo", group: "Standing", name: "Hands on hips", hands: "relaxed",
    joints: {
      chest: [-4, 0, 0], head: [-3, 0, 0], l_hip: [0, 0, -7], r_hip: [0, 0, 7],
      l_shoulder: [17, 61, -26], r_shoulder: [17, -61, 26], l_elbow: [-88, 0, 0], r_elbow: [-88, 0, 0]
    }
  },
  {
    id: "crossed", group: "Standing", name: "Arms crossed", hands: "relaxed",
    joints: {
      hips: [0, 5, -3], chest: [0, -4, 3], head: [0, -6, 0], r_hip: [-6, 0, 3], r_knee: [12, 0, 0],
      l_shoulder: [-43, 64, -46], r_shoulder: [-43, -64, 46], l_elbow: [-88, 0, 0], r_elbow: [-100, 0, 0]
    }
  },
  {
    id: "stretch", group: "Standing", name: "Stretch", hands: "open",
    joints: {
      spine: [-8, 0, 0], chest: [-10, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0],
      l_shoulder: [0, 0, -168], r_shoulder: [0, 0, 168], l_elbow: [-22, 0, 0], r_elbow: [-22, 0, 0],
      l_ankle: [22, 0, 0], r_ankle: [22, 0, 0]
    }
  },
  {
    id: "carry", group: "Standing", name: "Carry", hands: "open",
    joints: {
      spine: [-5, 0, 0], head: [4, 0, 0], l_hip: [-10, 0, 0], l_knee: [8, 0, 0], r_hip: [8, 0, 0], r_knee: [14, 0, 0],
      l_shoulder: [-12, 0, -6], r_shoulder: [-12, 0, 6], l_elbow: [-86, 0, 0], r_elbow: [-86, 0, 0]
    }
  },

  /* ---- gestures ---- */
  {
    id: "think", group: "Gesture", name: "Think", handsL: "relaxed", handsR: "grip",
    joints: {
      hips: [0, 4, -3], head: [10, -6, 4], r_hip: [-5, 0, 3], r_knee: [10, 0, 0],
      r_shoulder: [-33, -21, 17], r_elbow: [-140, 0, 0], l_shoulder: [-32, 68, -36], l_elbow: [-92, 0, 0]
    }
  },
  {
    id: "salute", group: "Gesture", name: "Salute", handsL: "relaxed", handsR: "open",
    joints: { chest: [-3, 0, 0], r_shoulder: [-65, 51, 60], r_elbow: [-115, 0, 0], l_shoulder: [0, 0, -5], l_elbow: [-6, 0, 0] }
  },
  {
    id: "shrug", group: "Gesture", name: "Shrug", hands: "open",
    joints: {
      head: [0, 0, 9], chest: [-3, 0, 0],
      l_shoulder: [-9, -52, -4], r_shoulder: [-9, 52, 4], l_elbow: [-78, 0, 0], r_elbow: [-78, 0, 0]
    }
  },
  {
    id: "facepalm", group: "Gesture", name: "Facepalm", handsL: "relaxed", handsR: "open",
    joints: {
      spine: [6, 0, 0], neck: [10, 0, 0], head: [16, 0, 0],
      r_shoulder: [-44, -19, 25], r_elbow: [-150, 0, 0], l_shoulder: [0, 0, -6], l_elbow: [-10, 0, 0]
    }
  },
  {
    id: "pray", group: "Gesture", name: "Hands together", hands: "open",
    joints: {
      head: [8, 0, 0],
      l_shoulder: [-31, 42, -34], r_shoulder: [-31, -42, 34], l_elbow: [-115, 0, 0], r_elbow: [-115, 0, 0]
    }
  },
  {
    id: "phone", group: "Gesture", name: "Phone", handsL: "grip", handsR: "relaxed",
    joints: {
      hips: [0, -4, 4], chest: [4, 0, -3], neck: [8, 0, 0], head: [12, 0, 0], l_hip: [-6, 0, -3], l_knee: [12, 0, 0],
      l_shoulder: [-37, 10, -14], l_elbow: [-120, 0, 0], r_shoulder: [0, 0, 6], r_elbow: [-10, 0, 0]
    }
  },
  {
    id: "cheer", group: "Gesture", name: "Cheer", hands: "fist",
    joints: {
      chest: [-6, 0, 0], head: [-10, 0, 0], l_hip: [0, 0, -9], r_hip: [0, 0, 9],
      l_shoulder: [0, 0, -148], r_shoulder: [0, 0, 148], l_elbow: [-14, 0, 0], r_elbow: [-14, 0, 0]
    }
  },

  /* ---- action ---- */
  {
    id: "punch", group: "Action", name: "Punch", hands: "fist",
    joints: {
      hips: [0, 10, 0], chest: [4, 26, 0], head: [4, -30, 0],
      r_hip: [-30, 0, 8], r_knee: [32, 0, 0], l_hip: [20, 0, -8], l_knee: [22, 0, 0], l_ankle: [26, 0, 0],
      l_shoulder: [-88, 0, -4], l_elbow: [-4, 0, 0], r_shoulder: [-40, 0, 24], r_elbow: [-128, 0, 0]
    }
  },
  {
    id: "kick", group: "Action", name: "Kick", hands: "fist",
    joints: {
      hips: [-14, 0, 0], spine: [6, 0, 0], head: [8, 0, 0],
      l_hip: [14, 0, 0], l_knee: [6, 0, 0], r_hip: [-82, 0, 6], r_knee: [8, 0, 0], r_ankle: [-12, 0, 0],
      l_shoulder: [-46, 0, -20], l_elbow: [-116, 0, 0], r_shoulder: [18, 0, 26], r_elbow: [-70, 0, 0]
    }
  },
  {
    id: "lunge", group: "Action", name: "Lunge", handsL: "grip", handsR: "open",
    joints: {
      spine: [4, 0, 0], chest: [0, 8, 0], head: [0, -6, 0],
      l_hip: [-72, 0, -4], l_knee: [86, 0, 0], l_ankle: [-12, 0, 0], r_hip: [36, 0, 4], r_knee: [24, 0, 0], r_ankle: [34, 0, 0],
      l_shoulder: [-86, 0, -6], l_elbow: [-4, 0, 0], r_shoulder: [42, 0, 34], r_elbow: [-38, 0, 0]
    }
  },
  {
    id: "throw", group: "Action", name: "Throw", handsL: "grip", handsR: "open",
    joints: {
      hips: [0, -12, 0], spine: [-6, -10, 0], chest: [-4, -26, 0], head: [0, 34, 0],
      r_hip: [-36, 0, 6], r_knee: [22, 0, 0], l_hip: [16, 0, -8], l_knee: [26, 0, 0], l_ankle: [22, 0, 0],
      l_shoulder: [26, -90, -96], l_elbow: [-96, 0, 0], r_shoulder: [-82, 0, 12], r_elbow: [-8, 0, 0]
    }
  },
  {
    id: "strike", group: "Action", name: "Overhead strike", hands: "grip",
    joints: {
      spine: [-8, 0, 0], chest: [-6, 0, 0], head: [6, 0, 0],
      l_hip: [-28, 0, -8], l_knee: [34, 0, 0], r_hip: [20, 0, 8], r_knee: [16, 0, 0], r_ankle: [18, 0, 0],
      l_shoulder: [-152, 0, -8], r_shoulder: [-152, 0, 8], l_elbow: [-58, 0, 0], r_elbow: [-58, 0, 0]
    }
  },
  {
    id: "archer", group: "Action", name: "Archer", hands: "grip",
    joints: {
      neck: [0, 30, 0], head: [0, 46, 0], l_hip: [0, 0, -13], r_hip: [0, 0, 13],
      r_shoulder: [0, 0, 90], r_elbow: [-3, 0, 0], l_shoulder: [0, 0, -92], l_elbow: [-156, 0, 0]
    }
  },
  {
    id: "push", group: "Action", name: "Push", hands: "open",
    joints: {
      hips: [22, 0, 0], spine: [8, 0, 0], neck: [-10, 0, 0], head: [-16, 0, 0],
      l_hip: [-58, 0, -4], l_knee: [52, 0, 0], l_ankle: [-14, 0, 0], r_hip: [4, 0, 4], r_knee: [12, 0, 0], r_ankle: [30, 0, 0],
      l_shoulder: [-64, 0, -5], r_shoulder: [-64, 0, 5], l_elbow: [-14, 0, 0], r_elbow: [-14, 0, 0],
      l_wrist: [-62, 0, 0], r_wrist: [-62, 0, 0]
    }
  },
  {
    id: "sneak", group: "Action", name: "Sneak", hands: "claw",
    joints: {
      spine: [24, 0, 0], chest: [10, 0, 0], neck: [-12, 0, 0], head: [-20, 0, 0],
      l_hip: [-78, 0, -6], l_knee: [96, 0, 0], l_ankle: [-16, 0, 0], r_hip: [-28, 0, 6], r_knee: [82, 0, 0], r_ankle: [32, 0, 0],
      l_shoulder: [-42, 0, -26], l_elbow: [-62, 0, 0], r_shoulder: [12, 0, 26], r_elbow: [-72, 0, 0]
    }
  },
  {
    id: "balance", group: "Action", name: "Arabesque", hands: "open",
    joints: {
      hips: [36, 0, 0], spine: [-12, 0, 0], chest: [-12, 0, 0], head: [-20, 0, 0],
      l_hip: [-36, 0, 0], r_hip: [52, 0, 0], r_knee: [4, 0, 0], r_ankle: [40, 0, 0],
      l_shoulder: [-112, 0, -14], l_elbow: [-6, 0, 0], r_shoulder: [34, 0, 58], r_elbow: [-6, 0, 0]
    }
  },
  {
    id: "landing", group: "Action", name: "Hero landing", handsL: "fist", handsR: "open",
    joints: {
      hips: [34, 0, 0], spine: [10, 0, 0], neck: [-18, 0, 0], head: [-26, 0, 0],
      l_hip: [-124, 0, -8], l_knee: [118, 0, 0], l_ankle: [-18, 0, 0],
      r_hip: [-34, 0, 14], r_knee: [112, 0, 0], r_ankle: [36, 0, 0], r_toes: [-55, 0, 0],
      l_shoulder: [-46, 0, -4], l_elbow: [-6, 0, 0], r_shoulder: [48, 0, 62], r_elbow: [-12, 0, 0]
    }
  },
  {
    id: "fly", group: "Action", name: "Fly", handsL: "fist", handsR: "relaxed", lift: 1.0,
    joints: {
      hips: [80, 0, 0], spine: [-10, 0, 0], chest: [-12, 0, 0], neck: [-22, 0, 0], head: [-30, 0, 0],
      l_hip: [8, 0, 0], l_ankle: [42, 0, 0], r_hip: [-26, 0, 0], r_knee: [48, 0, 0], r_ankle: [42, 0, 0],
      l_shoulder: [-158, 0, -8], l_elbow: [-4, 0, 0], r_shoulder: [14, 0, 10], r_elbow: [-12, 0, 0]
    }
  },

  /* ---- seated and floor ---- */
  {
    id: "crossleg", group: "Seated and floor", name: "Cross-legged", hands: "relaxed",
    joints: {
      spine: [8, 0, 0], head: [-4, 0, 0],
      l_hip: [-129, -4, 94], r_hip: [-143, 4, -94], l_knee: [134, 0, 0], r_knee: [140, 0, 0], l_ankle: [24, 0, 0], r_ankle: [24, 0, 0],
      l_shoulder: [-34, 0, -16], r_shoulder: [-34, 0, 16], l_elbow: [-32, 0, 0], r_elbow: [-32, 0, 0]
    }
  },
  {
    id: "sitfloor", group: "Seated and floor", name: "Sit, legs out", hands: "open",
    joints: {
      hips: [-16, 0, 0], spine: [6, 0, 0], head: [6, 0, 0],
      l_hip: [-74, 0, -8], r_hip: [-112, 0, 8], r_knee: [84, 0, 0], l_ankle: [-8, 0, 0],
      l_shoulder: [40, 0, -14], r_shoulder: [40, 0, 14], l_elbow: [-4, 0, 0], r_elbow: [-4, 0, 0],
      l_wrist: [-60, 0, 0], r_wrist: [-60, 0, 0]
    }
  },
  {
    id: "hugknees", group: "Seated and floor", name: "Hug knees", hands: "relaxed",
    joints: {
      hips: [-10, 0, 0], spine: [20, 0, 0], chest: [12, 0, 0], head: [8, 0, 0],
      l_hip: [-116, 0, -6], r_hip: [-116, 0, 6], l_knee: [124, 0, 0], r_knee: [124, 0, 0], l_ankle: [-6, 0, 0], r_ankle: [-6, 0, 0],
      l_shoulder: [-62, 30, -8], r_shoulder: [-62, -30, 8], l_elbow: [-44, 0, 0], r_elbow: [-44, 0, 0]
    }
  },
  {
    id: "seiza", group: "Seated and floor", name: "Kneel, both knees", hands: "relaxed",
    joints: {
      head: [4, 0, 0], l_hip: [-80, 0, -3], r_hip: [-80, 0, 3], l_knee: [152, 0, 0], r_knee: [152, 0, 0], l_ankle: [42, 0, 0], r_ankle: [42, 0, 0],
      l_shoulder: [-26, 0, -4], r_shoulder: [-26, 0, 4], l_elbow: [-34, 0, 0], r_elbow: [-34, 0, 0]
    }
  },
  {
    id: "crawl", group: "Seated and floor", name: "All fours", hands: "open",
    joints: {
      hips: [86, 0, 0], neck: [-20, 0, 0], head: [-26, 0, 0],
      l_hip: [-88, 0, 0], r_hip: [-76, 0, 0], l_knee: [88, 0, 0], r_knee: [82, 0, 0], l_ankle: [42, 0, 0], r_ankle: [42, 0, 0],
      l_shoulder: [-80, 0, -3], r_shoulder: [-94, 0, 3], l_elbow: [-4, 0, 0], r_elbow: [-4, 0, 0],
      l_wrist: [-80, 0, 0], r_wrist: [-80, 0, 0]
    }
  },
  {
    id: "plank", group: "Seated and floor", name: "Push-up", hands: "open",
    joints: {
      hips: [68, 0, 0], neck: [-16, 0, 0], head: [-20, 0, 0],
      l_ankle: [-30, 0, 0], r_ankle: [-30, 0, 0], l_toes: [-50, 0, 0], r_toes: [-50, 0, 0],
      l_shoulder: [-68, 0, -6], r_shoulder: [-68, 0, 6], l_elbow: [-3, 0, 0], r_elbow: [-3, 0, 0],
      l_wrist: [-80, 0, 0], r_wrist: [-80, 0, 0]
    }
  },
  {
    id: "prone", group: "Seated and floor", name: "Lie, propped up", hands: "relaxed",
    joints: {
      hips: [88, 0, 0], spine: [-14, 0, 0], chest: [-18, 0, 0], neck: [-14, 0, 0], head: [-18, 0, 0],
      l_ankle: [40, 0, 0], r_knee: [104, 0, 0], r_ankle: [30, 0, 0],
      l_shoulder: [-58, 0, -12], r_shoulder: [-58, 0, 12], l_elbow: [-96, 0, 0], r_elbow: [-96, 0, 0]
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
