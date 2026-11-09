"""Turn the MakeHuman figure (tools/mh_build.py's GLB) into the app's rigged figure, assets/models/mannequin.glb.

    python tools/mh_convert.py path/to/makehuman.glb

MakeHuman's CC0 skin weights are kept; the game_engine bones are merged onto PoseSandbox's joints (v1 names, so old pose
files load), the A-pose arms are lowered through those same weights so the rest pose hangs like the app expects, and the
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

# source bone -> app joint ("_l" is the figure's left, at +X: the app's legacy "r_" side)
MAP = {"Root": "hips", "pelvis": "hips", "spine_01": "spine", "spine_02": "spine", "spine_03": "chest",
       "clavicle_l": "chest", "clavicle_r": "chest", "neck_01": "neck", "head": "head"}
PIVOT = {"hips": "pelvis", "spine": "spine_01", "chest": "spine_03", "neck": "neck_01", "head": "head"}
for S, s in (("l", "r"), ("r", "l")):
    MAP.update({f"upperarm_{S}": f"{s}_shoulder", f"lowerarm_{S}": f"{s}_elbow", f"hand_{S}": f"{s}_wrist",
                f"thigh_{S}": f"{s}_hip", f"calf_{S}": f"{s}_knee", f"foot_{S}": f"{s}_ankle", f"ball_{S}": f"{s}_toes"})
    PIVOT.update({f"{s}_shoulder": f"upperarm_{S}", f"{s}_elbow": f"lowerarm_{S}", f"{s}_wrist": f"hand_{S}",
                  f"{s}_hip": f"thigh_{S}", f"{s}_knee": f"calf_{S}", f"{s}_ankle": f"foot_{S}", f"{s}_toes": f"ball_{S}"})
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        MAP.update({f"{f}_01_{S}": f"{s}_{f}1", f"{f}_02_{S}": f"{s}_{f}2", f"{f}_03_{S}": f"{s}_{f}2"})
        PIVOT.update({f"{s}_{f}1": f"{f}_01_{S}", f"{s}_{f}2": f"{f}_02_{S}"})
ARM = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")


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


def rotation(a, b):
    """The rotation matrix taking unit vector a onto unit vector b (Rodrigues)."""
    v, c = np.cross(a, b), float(a @ b)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def main(src):
    J, acc = read(src)
    skin = J["skins"][0]
    names = [J["nodes"][j]["name"] for j in skin["joints"]]
    missing = sorted(set(MAP) - set(names)) + sorted(set(names) - set(MAP))
    assert not missing, f"bones not mapped / not found: {missing}"
    G = np.linalg.inv(acc(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1))  # bind pose, per bone
    head = {nm: G[i][:3, 3].astype(float) for i, nm in enumerate(names)}
    assert head["upperarm_l"][0] > 0, "expected the figure's left arm at +X"

    P, N, Jn, W, I = [], [], [], [], []
    for prim in J["meshes"][0]["primitives"]:
        a = prim["attributes"]; base = sum(len(p) for p in P)
        P.append(acc(a["POSITION"]).astype(float)); N.append(acc(a["NORMAL"]).astype(float))
        Jn.append(acc(a["JOINTS_0"]).astype(int)); W.append(acc(a["WEIGHTS_0"]).astype(float))
        I.append(acc(prim["indices"]).reshape(-1, 3).astype(int) + base)
    P, N, Jn, W, I = map(np.concatenate, (P, N, Jn, W, I))
    W /= W.sum(1, keepdims=True)

    # bring the A-pose arms to the app's rest (as the old mannequin): upper arm and forearm straight down, fingers down,
    # palm to the thigh with the thumb forward; each step rotates through the artist's weights (linear blend skinning)
    M = np.tile(np.eye(4), (len(names), 1, 1))
    def turn(bones, R, at):
        A = np.eye(4); A[:3, :3] = R; A[:3, 3] = at - R @ at
        for i, nm in enumerate(names):
            if nm in bones:
                M[i] = A @ M[i]; head[nm] = A[:3, :3] @ head[nm] + A[:3, 3]
    down = np.array([0.0, -1.0, 0.0])
    unit = lambda v: v / np.linalg.norm(v)
    for S in "lr":
        arm = [n for n in names if n.endswith(f"_{S}") and n.startswith(ARM)]
        fore, hand = arm[1:], [n for n in arm if not n.startswith(("upperarm", "lowerarm"))]
        for bones, a, b in ((arm, "upperarm", "lowerarm"), (fore, "lowerarm", "hand")):
            turn(bones, rotation(unit(head[f"{b}_{S}"] - head[f"{a}_{S}"]), down), head[f"{a}_{S}"].copy())
        w = head[f"hand_{S}"].copy()
        turn(hand, rotation(unit(head[f"middle_01_{S}"] - w), down), w)
        across = head[f"index_01_{S}"] - head[f"pinky_01_{S}"]; across[1] = 0
        tw = rotation(unit(across), np.array([0.0, 0.0, 1.0]))  # about Y, since both lie in the floor plane
        half = rotation(unit(across), unit(unit(across) + np.array([0.0, 0.0, 1.0])))
        turn(hand, tw, w)
        for i, nm in enumerate(names):  # spread half the twist up the forearm so the wrist does not pinch
            if nm == f"lowerarm_{S}":
                A = np.eye(4); A[:3, :3] = half; A[:3, 3] = w - half @ w; M[i] = A @ M[i]
        # MakeHuman's fingers rest curled ~35 deg toward the palm; the app's hand shapes assume straight ones (a fist
        # would curl through the palm), so straighten each segment's bend (about Z) and keep its spread
        for f in ("index", "middle", "ring", "pinky"):
            seg = [f"{f}_0{k}_{S}" for k in (1, 2, 3)]
            for k, b in enumerate(seg):
                if k < 2:
                    d = head[seg[k + 1]] - head[b]
                else:  # the last segment has no child: aim at its own skin, as moved so far
                    i = names.index(b); c = P[(Jn[:, 0] == i) & (W[:, 0] > 0.6)].mean(0)
                    d = M[i][:3, :3] @ c + M[i][:3, 3] - head[b]
                a = np.arctan2(d[0], -d[1])
                turn(seg[k:], np.array([[np.cos(-a), -np.sin(-a), 0], [np.sin(-a), np.cos(-a), 0], [0, 0, 1]]), head[b].copy())
    Mv = np.einsum("vk,vkij->vij", W, M[Jn])
    P = np.einsum("vij,vj->vi", Mv[:, :3, :3], P) + Mv[:, :3, 3]
    N = np.einsum("vij,vj->vi", Mv[:, :3, :3], N)
    N /= np.linalg.norm(N, axis=1, keepdims=True)

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

    C = np.full((len(P), 4), 255, np.uint8)
    extras = {"order": ORDER, "parents": {n: PARENT.get(n) for n in ORDER if n != "char_root"}, "joints": joints,
              "fingerBlock": False, "source": "MakeHuman base mesh and game_engine rig (CC0 1.0), via tools/mh_build.py + mh_convert.py"}
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).parent.parent / "assets/models/mannequin.glb"
    write_glb(str(out), P, I, normals=N, colors=C, joints=top, weights=q, extras=extras)
    print(f"wrote {out.name}: {len(P)} vertices, {len(I)} triangles, height {P[:, 1].max():.3f} m, "
          f"blended {(q.max(1) < 255).mean():.0%}, l_shoulder {joints['l_shoulder']}, l_wrist {joints['l_wrist']}")


if __name__ == "__main__":
    main(sys.argv[1])
