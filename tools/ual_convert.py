"""Turn Quaternius's CC0 "Universal Animation Library" mannequin into the app's rigged figure.

    python tools/ual_convert.py path/to/AnimationLibrary_Godot_Standard.glb   ->  assets/models/mannequin.glb

Source: https://opengameart.org/content/universal-animation-library (Standard zip, Godot/*.glb), CC0 1.0, by Quaternius.
The artist's skin weights are kept; only the bones are merged onto PoseSandbox's joints (v1 names, so old pose files
load), the T-pose arms are lowered through those same weights so the rest pose hangs like the app expects, and the
figure is scaled to 1.80 m with its feet on y = 0.
"""
import json, struct, sys, pathlib
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from glbwrite import write_glb

ORDER = ["char_root", "hips", "spine", "chest", "neck", "head"] + [f"{s}_{p}" for s in "lr" for p in
         ["shoulder", "elbow", "wrist", "thumb1", "thumb2", "index1", "index2", "middle1", "middle2", "ring1", "ring2",
          "pinky1", "pinky2", "hip", "knee", "ankle", "toes"]]
PARENT = {"hips": "char_root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck"}
for s in "lr":
    PARENT.update({f"{s}_shoulder": "chest", f"{s}_elbow": f"{s}_shoulder", f"{s}_wrist": f"{s}_elbow",
                   f"{s}_hip": "hips", f"{s}_knee": f"{s}_hip", f"{s}_ankle": f"{s}_knee", f"{s}_toes": f"{s}_ankle"})
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        PARENT[f"{s}_{f}1"] = f"{s}_wrist"; PARENT[f"{s}_{f}2"] = f"{s}_{f}1"

# source bone -> app joint (".L" is the figure's left, at +X: the app's legacy "r_" side)
MAP = {"root": "hips", "DEF-hips": "hips", "DEF-spine.001": "spine", "DEF-spine.002": "spine", "DEF-spine.003": "chest",
       "DEF-shoulder.L": "chest", "DEF-shoulder.R": "chest", "DEF-neck": "neck", "DEF-head": "head"}
for S, s in (("L", "r"), ("R", "l")):
    MAP.update({f"DEF-upper_arm.{S}": f"{s}_shoulder", f"DEF-forearm.{S}": f"{s}_elbow", f"DEF-hand.{S}": f"{s}_wrist",
                f"DEF-thigh.{S}": f"{s}_hip", f"DEF-shin.{S}": f"{s}_knee", f"DEF-foot.{S}": f"{s}_ankle", f"DEF-toe.{S}": f"{s}_toes",
                f"DEF-thumb.01.{S}": f"{s}_thumb1", f"DEF-thumb.02.{S}": f"{s}_thumb2", f"DEF-thumb.03.{S}": f"{s}_thumb2"})
    for f in ("index", "middle", "ring", "pinky"):
        MAP.update({f"DEF-f_{f}.01.{S}": f"{s}_{f}1", f"DEF-f_{f}.02.{S}": f"{s}_{f}2", f"DEF-f_{f}.03.{S}": f"{s}_{f}2"})
# where each app joint pivots: the head of this source bone
PIVOT = {"hips": "DEF-hips", "spine": "DEF-spine.001", "chest": "DEF-spine.003", "neck": "DEF-neck", "head": "DEF-head"}
for S, s in (("L", "r"), ("R", "l")):
    PIVOT.update({f"{s}_shoulder": f"DEF-upper_arm.{S}", f"{s}_elbow": f"DEF-forearm.{S}", f"{s}_wrist": f"DEF-hand.{S}",
                  f"{s}_hip": f"DEF-thigh.{S}", f"{s}_knee": f"DEF-shin.{S}", f"{s}_ankle": f"DEF-foot.{S}", f"{s}_toes": f"DEF-toe.{S}",
                  f"{s}_thumb1": f"DEF-thumb.01.{S}", f"{s}_thumb2": f"DEF-thumb.02.{S}"})
    for f in ("index", "middle", "ring", "pinky"):
        PIVOT.update({f"{s}_{f}1": f"DEF-f_{f}.01.{S}", f"{s}_{f}2": f"DEF-f_{f}.02.{S}"})
JOINT_TONE = 0.55 ** 2.2  # joint rings (its second material) a step darker; glTF vertex colours are linear


def read(path):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    J = json.loads(b[20:20 + n]); BIN = b[20 + n + 8:]
    def acc(i):
        a = J["accessors"][i]; v = J["bufferViews"][a["bufferView"]]
        dt = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a["componentType"]]
        nc = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        out = np.frombuffer(BIN, dt, a["count"] * nc, v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(a["count"], nc)
        return out / 255.0 if a.get("normalized") and dt == np.uint8 else out
    return J, acc


def main(src):
    J, acc = read(src)
    skin = J["skins"][0]
    names = [J["nodes"][j]["name"] for j in skin["joints"]]
    missing = sorted(set(MAP) - set(names)) + sorted(set(names) - set(MAP))
    assert not missing, f"bones not mapped / not found: {missing}"
    G = np.linalg.inv(acc(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1))  # bind pose, per bone
    head = {nm: G[i][:3, 3].astype(float) for i, nm in enumerate(names)}

    P, N, Jn, W, T, I = [], [], [], [], [], []
    for prim in J["meshes"][0]["primitives"]:
        a = prim["attributes"]; base = sum(len(p) for p in P)
        P.append(acc(a["POSITION"]).astype(float)); N.append(acc(a["NORMAL"]).astype(float))
        Jn.append(acc(a["JOINTS_0"]).astype(int)); W.append(acc(a["WEIGHTS_0"]).astype(float))
        T.append(np.full(len(P[-1]), 1.0 if prim.get("material", 0) == 0 else JOINT_TONE))
        I.append(acc(prim["indices"]).reshape(-1, 3).astype(int) + base)
    P, N, Jn, W, T, I = map(np.concatenate, (P, N, Jn, W, T, I))
    W /= W.sum(1, keepdims=True)

    # lower the T-pose arms to hang straight down, through the artist's weights (linear blend skinning)
    M = np.tile(np.eye(4), (len(names), 1, 1))
    for S, sign in (("L", -1), ("R", 1)):
        c, sn = 0.0, float(sign)  # cos/sin of 90 degrees about Z: +X arm swings to -Y, -X arm too
        R = np.array([[c, -sn, 0], [sn, c, 0], [0, 0, 1]])
        p = head[f"DEF-upper_arm.{S}"]
        A = np.eye(4); A[:3, :3] = R; A[:3, 3] = p - R @ p
        for i, nm in enumerate(names):
            if nm.endswith(f".{S}") and any(k in nm for k in ("upper_arm", "forearm", "hand", "f_", "thumb")):
                M[i] = A
    Mv = np.einsum("vk,vkij->vij", W, M[Jn])
    P = np.einsum("vij,vj->vi", Mv[:, :3, :3], P) + Mv[:, :3, 3]
    N = np.einsum("vij,vj->vi", Mv[:, :3, :3], N)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    for i, nm in enumerate(names):
        head[nm] = M[i][:3, :3] @ head[nm] + M[i][:3, 3]

    # 1.80 m tall, feet on the floor, centred
    s = 1.80 / (P[:, 1].max() - P[:, 1].min())
    off = np.array([-(P[:, 0].max() + P[:, 0].min()) / 2, -P[:, 1].min(), -(P[:, 2].max() + P[:, 2].min()) / 2])
    P = (P + off) * s
    joints = {n: [0.0, 0.0, 0.0] for n in ORDER}
    for ours, bone in PIVOT.items():
        joints[ours] = [round(float(v), 5) for v in (head[bone] + off) * s]

    # merge the bones' weights onto the app's joints; keep the four largest, summing to exactly 255
    col = np.array([ORDER.index(MAP[nm]) for nm in names])
    Wo = np.zeros((len(P), len(ORDER)))
    np.add.at(Wo, (np.repeat(np.arange(len(P)), 4), col[Jn].ravel()), W.ravel())
    top = np.argsort(-Wo, 1)[:, :4]
    tw = np.take_along_axis(Wo, top, 1); tw /= tw.sum(1, keepdims=True)
    q = np.floor(tw * 255).astype(int); q[:, 0] += 255 - q.sum(1)
    top[q == 0] = 0
    assert (q.sum(1) == 255).all() and (q >= 0).all()

    tone = np.round(T * 255).astype(np.uint8)
    C = np.stack([tone, tone, tone, np.full(len(P), 255, np.uint8)], 1)
    extras = {"order": ORDER, "parents": {n: PARENT.get(n) for n in ORDER if n != "char_root"}, "joints": joints,
              "fingerBlock": False, "source": "Quaternius, Universal Animation Library mannequin (CC0 1.0), via tools/ual_convert.py"}
    out = pathlib.Path(__file__).parent.parent / "assets/models/mannequin.glb"
    write_glb(str(out), P, I, normals=N, colors=C, joints=top, weights=q, extras=extras)
    print(f"wrote {out.name}: {len(P)} vertices, {len(I)} triangles, height {P[:, 1].max():.3f} m, "
          f"blended {(q.max(1) < 255).mean():.0%}, l_shoulder {joints['l_shoulder']}, l_wrist {joints['l_wrist']}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../ual-cc0/raw/AnimationLibrary_Godot_Standard.glb")
