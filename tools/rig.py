"""Rig the sculpted mannequin: fit PoseSandbox's skeleton, segment the welded surface into rigid parts that meet
at the sculpted joint crevices, blend weights inside narrow bands at each crevice, bake a skinned GLB.

    python tools/rig.py labels   -> tools/_labels.glb + tools/joints.json (colour-coded parts, for checking)
    python tools/rig.py bake     -> assets/models/mannequin.glb (what the app loads)

The skeleton keeps v1 joint names (legacy "l_" = the figure's right side, at -X). Rest rotations are identity:
the figure's own stance is its rest pose, joint offsets are the measured world deltas.
"""
import sys, json, numpy as np, scipy.sparse as sp
import meshio
from glbwrite import write_glb

P, I, SCALE = meshio.load()
N = len(P)

# ---------------------------------------------------------------- skeleton (world rest positions, metres)
J = {
    "char_root": (0, 0, 0),
    "hips": (0, 0.93, -0.02), "spine": (0, 1.035, -0.02), "chest": (0, 1.205, -0.02), "neck": (0, 1.5, -0.03), "head": (0, 1.575, -0.02),
    "l_shoulder": (-0.2, 1.405, -0.055), "l_elbow": (-0.236, 1.185, -0.095), "l_wrist": (-0.263, 0.935, -0.06),
    "l_index1": (-0.262, 0.795, -0.062), "l_index2": (-0.255, 0.745, -0.064), "l_thumb1": (-0.246, 0.865, -0.012), "l_thumb2": (-0.238, 0.812, -0.009),
    "r_shoulder": (0.195, 1.405, -0.055), "r_elbow": (0.224, 1.205, -0.055), "r_wrist": (0.262, 0.935, 0.0),
    "r_index1": (0.268, 0.8, 0.004), "r_index2": (0.26, 0.763, 0.002), "r_thumb1": (0.236, 0.9, 0.035), "r_thumb2": (0.236, 0.85, 0.042),
    "l_hip": (-0.1, 0.875, -0.02), "l_knee": (-0.125, 0.5, -0.035), "l_ankle": (-0.113, 0.115, -0.05), "l_toes": (-0.15, 0.03, 0.11),
    "r_hip": (0.1, 0.875, -0.02), "r_knee": (0.125, 0.5, -0.035), "r_ankle": (0.113, 0.115, -0.05), "r_toes": (0.15, 0.03, 0.11),
}
PARENT = {"hips": "char_root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck"}
for s in "lr":
    PARENT.update({f"{s}_shoulder": "chest", f"{s}_elbow": f"{s}_shoulder", f"{s}_wrist": f"{s}_elbow",
                   f"{s}_index1": f"{s}_wrist", f"{s}_index2": f"{s}_index1", f"{s}_thumb1": f"{s}_wrist", f"{s}_thumb2": f"{s}_thumb1",
                   f"{s}_hip": "hips", f"{s}_knee": f"{s}_hip", f"{s}_ankle": f"{s}_knee", f"{s}_toes": f"{s}_ankle"})

# capsules per labelled bone: (a, b, radius). a/b are joint names or literal points.
def V(x): return np.array(J[x] if isinstance(x, str) else x, float)
CAPS = {
    "hips": [((0, 0.9, -0.02), (0, 0.99, -0.02), 0.12)],
    "spine": [((0, 1.04, -0.02), (0, 1.18, -0.02), 0.13)],
    "chest": [((0, 1.24, -0.02), (0, 1.44, -0.03), 0.16)],
    "neck": [((0, 1.505, -0.025), (0, 1.56, -0.02), 0.05)],
    "head": [((0, 1.65, 0.01), (0, 1.73, 0.0), 0.1)],
}
def rebuild_caps():
  for s, k in (("l", -1), ("r", 1)):
    CAPS.update({
        f"{s}_shoulder": [(f"{s}_shoulder", f"{s}_elbow", 0.055)],
        f"{s}_elbow": [(f"{s}_elbow", f"{s}_wrist", 0.048)],
        f"{s}_wrist": [(f"{s}_wrist", f"{s}_index1", 0.045)],
        f"{s}_index1": [(f"{s}_index1", f"{s}_index2", 0.035)],
        f"{s}_index2": [(f"{s}_index2", tuple(V(f"{s}_index2") + (V(f"{s}_index2") - V(f"{s}_index1")) * 1.1), 0.03)],
        f"{s}_thumb1": [(f"{s}_thumb1", f"{s}_thumb2", 0.016)],
        f"{s}_thumb2": [(f"{s}_thumb2", tuple(V(f"{s}_thumb2") + (V(f"{s}_thumb2") - V(f"{s}_thumb1")) * 0.9), 0.015)],
        f"{s}_hip": [(f"{s}_hip", f"{s}_knee", 0.08)],
        f"{s}_knee": [(f"{s}_knee", f"{s}_ankle", 0.06)],
        f"{s}_ankle": [(f"{s}_ankle", (k * 0.125, 0.04, 0.02), 0.06)],
        f"{s}_toes": [(f"{s}_toes", (k * 0.165, 0.025, 0.18), 0.045)],
    })
rebuild_caps()
LABELS = list(CAPS)

# band width (graph hops) for the soft blend at each joint, by joint kind
def band_hops(j):
    if any(t in j for t in ("index", "thumb", "toes")): return 2
    if any(t in j for t in ("elbow", "knee", "wrist", "ankle")): return 3
    return 4


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def adjacency():
    E = np.unique(np.sort(np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]]), 1), axis=0)
    A = sp.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(N, N))
    return (A + A.T).tocsr(), E


def initial_labels():
    D = np.full((N, len(LABELS)), np.inf)
    for li, name in enumerate(LABELS):
        for a, b, r in CAPS[name]:
            D[:, li] = np.minimum(D[:, li], seg_dist(P, V(a), V(b)) / r)
    return D.argmin(1)


def vertex_normals():
    n = np.zeros((N, 3))
    fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    for k in range(3): np.add.at(n, I[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def concavity(A):
    """How far a vertex sits below the average of its neighbours, along its normal (grooves are > 0)."""
    deg = np.asarray(A.sum(1)).ravel()
    lap = (A @ P) / deg[:, None] - P
    e = np.asarray((A.multiply(A)).sum(1)).ravel()
    return np.maximum(0, (lap * vertex_normals()).sum(1))


def seeds_from_capsules():
    """Core vertices of each part: closest to that capsule and well away from its ends (joints)."""
    D = np.full((N, len(LABELS)), np.inf); T = np.zeros((N, len(LABELS)))
    for li, name in enumerate(LABELS):
        for a, b, r in CAPS[name]:
            a, b = V(a), V(b); ab = b - a
            t = ((P - a) @ ab) / (ab @ ab)
            d = np.linalg.norm(P - (a + np.clip(t, 0, 1)[:, None] * ab), axis=1) / r
            better = d < D[:, li]
            D[better, li] = d[better]; T[better, li] = t[better]
    best = D.argmin(1)
    seed = np.full(N, -1)
    core = (D[np.arange(N), best] < 1.6) & (T[np.arange(N), best] > 0.2) & (T[np.arange(N), best] < 0.8)
    seed[core] = best[core]
    return seed


def watershed(seed, A, conc):
    """Minimax flood: a vertex joins the part it can reach while climbing over the lowest groove, ties by distance."""
    import heapq
    indptr, indices = A.indptr, A.indices
    lab = seed.copy()
    best = np.full(N, np.inf); dist = np.full(N, np.inf)
    h = []
    for v in np.where(seed >= 0)[0]:
        best[v] = 0; dist[v] = 0; h.append((0.0, 0.0, v))
    heapq.heapify(h)
    done = np.zeros(N, bool)
    while h:
        b, d, v = heapq.heappop(h)
        if done[v]: continue
        done[v] = True
        for u in indices[indptr[v]:indptr[v + 1]]:
            if done[u]: continue
            nb = max(b, conc[u]); nd = d + np.linalg.norm(P[u] - P[v])
            if nb < best[u] - 1e-12 or (abs(nb - best[u]) <= 1e-12 and nd < dist[u]):
                best[u] = nb; dist[u] = nd; lab[u] = lab[v]
                heapq.heappush(h, (nb, nd, u))
    return lab


def refine_joints(lab, E):
    """Put each pivot at the centre of the groove ring it sits in (seam vertices between the two parts)."""
    moved = {}
    for child, par in PARENT.items():
        if child not in LABELS or par not in LABELS or child.endswith(("shoulder", "hip", "toes", "thumb1", "thumb2")) or child in ("hips",): continue
        ci, pi = LABELS.index(child), LABELS.index(par)
        e = E[((lab[E[:, 0]] == ci) & (lab[E[:, 1]] == pi)) | ((lab[E[:, 0]] == pi) & (lab[E[:, 1]] == ci))]
        if len(e) < 6: continue
        c = P[np.unique(e)].mean(0)
        moved[child] = float(np.linalg.norm(c - V(child)))
        J[child] = tuple(c)
    return moved


def mirror_toes():
    x, y, z = J["r_toes"]
    J["l_toes"] = (-x, y, z)


def cleanup(lab, A):
    """Every part must be one connected piece: islands are given to the label that surrounds them."""
    for _ in range(12):
        changed = 0
        for li in range(len(LABELS)):
            idx = np.where(lab == li)[0]
            if len(idx) == 0: continue
            sub = A[idx][:, idx]
            n, comp = sp.csgraph.connected_components(sub, directed=False)
            if n <= 1: continue
            keep = np.bincount(comp).argmax()
            for c in range(n):
                if c == keep: continue
                vs = idx[comp == c]
                nb = A[vs].indices
                nb_l = lab[nb]; nb_l = nb_l[nb_l != li]
                if len(nb_l): lab[vs] = np.bincount(nb_l).argmax(); changed += 1
        if not changed: break
    return lab


def boundary_pairs(lab, E):
    a, b = lab[E[:, 0]], lab[E[:, 1]]
    m = a != b
    pairs = {}
    for x, y in zip(a[m], b[m]):
        k = tuple(sorted((LABELS[x], LABELS[y])))
        pairs[k] = pairs.get(k, 0) + 1
    return pairs


def weights(lab, A, E):
    """One-hot by part, then a harmonic blend inside a band of a few edge rings at each parent–child seam."""
    W = np.zeros((N, len(LABELS)))
    W[np.arange(N), lab] = 1
    deg = np.asarray(A.sum(1)).ravel()
    pairs = [(c, PARENT.get(c)) for c in LABELS] + [("l_thumb2", "l_wrist"), ("r_thumb2", "r_wrist"), ("head", "chest")]
    for child, par in pairs:
        if par not in CAPS: continue
        ci, pi = LABELS.index(child), LABELS.index(par)
        both = (lab == ci) | (lab == pi)
        seam = np.zeros(N, bool)
        e = E[(lab[E[:, 0]] == ci) & (lab[E[:, 1]] == pi) | (lab[E[:, 0]] == pi) & (lab[E[:, 1]] == ci)]
        if len(e) == 0: continue
        seam[e.ravel()] = True
        band = seam.copy()
        for _ in range(band_hops(child)):
            band = (band | (A @ band.astype(float) > 0)) & both
        s = (lab == ci).astype(float)
        fixed = ~band
        for _ in range(60):
            s_new = (A @ s) / np.maximum(deg, 1)
            s = np.where(fixed, s, s_new)
        v = np.where(band)[0]
        tot = W[v, ci] + W[v, pi]
        W[v, ci] = tot * s[v]
        W[v, pi] = tot * (1 - s[v])
    return W


COLORS = np.array([[230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240],
                   [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255], [170, 110, 40], [255, 250, 200],
                   [128, 0, 0], [170, 255, 195], [128, 128, 0], [255, 215, 180], [0, 0, 128], [128, 128, 128], [255, 255, 255]])


def segment(A, E, conc):
    lab = cleanup(watershed(seeds_from_capsules(), A, conc), A)
    return lab


def run(mode):
    A, E = adjacency()
    conc = concavity(A)
    lab = segment(A, E, conc)
    for it in range(2):  # refit pivots to the grooves, rebuild the capsules from them, segment again
        moved = refine_joints(lab, E)
        mirror_toes()
        print("refit", it, {k: round(v, 3) for k, v in moved.items() if v > 0.004})
        rebuild_caps()
        lab = segment(A, E, conc)
    json.dump({k: list(map(float, v)) for k, v in J.items()}, open("joints.json", "w"))
    pairs = boundary_pairs(lab, E)
    print("seams:")
    for (a, b), n in sorted(pairs.items(), key=lambda kv: -kv[1]):
        related = PARENT.get(a) == b or PARENT.get(b) == a
        print(f"  {a:12s} | {b:12s} {n:5d}{'' if related else '   <-- NOT parent/child (welded contact)'}")
    print("vertices per part:", {LABELS[i]: int(c) for i, c in enumerate(np.bincount(lab, minlength=len(LABELS)))})
    if mode == "labels":
        C = np.c_[COLORS[np.arange(len(LABELS)) % len(COLORS)][lab], np.full(N, 255)]
        write_glb("_labels.glb", P, I, colors=C)
        np.save("_labels.npy", lab)
        print("wrote _labels.glb")
    return lab, A, E


ORDER = ["char_root", "hips", "spine", "chest", "neck", "head"] + [f"{s}_{p}" for s in "lr" for p in
         ["shoulder", "elbow", "wrist", "thumb1", "thumb2", "index1", "index2", "middle1", "middle2", "ring1", "ring2", "pinky1", "pinky2",
          "hip", "knee", "ankle", "toes"]]


def normal_noise():
    """1 - (worst agreement between a vertex normal and the faces around it): ~0 on smooth skin, high in fuzz."""
    fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    vn = vertex_normals()
    worst = np.ones(N)
    for k in range(3):
        np.minimum.at(worst, I[:, k], (fn * vn[I[:, k]]).sum(1))
    return 1 - worst


def defuzz(lab, A, E, rings=3, iters=20):
    """Meshy leaves zigzag fuzz in the crevices between parts. Taubin-smooth (no shrinking) only a thin band of
    vertices around each seam; everything else keeps the sculpt exactly."""
    seam = np.zeros(N, bool)
    seam[E[lab[E[:, 0]] != lab[E[:, 1]]].ravel()] = True
    seam |= concavity(A) > np.percentile(concavity(A), 85)  # every sculpted groove, not only the part seams
    seam |= normal_noise() > 0.35                            # and the "hair": faces around a vertex pointing every which way
    band = seam.copy()
    for _ in range(rings):
        band |= (A @ band.astype(float)) > 0
    deg = np.asarray(A.sum(1)).ravel()[:, None]
    Q = P.copy()
    for _ in range(iters):
        for k in (0.5, -0.53):
            lap = (A @ Q) / deg - Q
            Q[band] += k * lap[band]
    fins = normal_noise() > 0.25                             # then collapse the thin fins that Taubin keeps
    fins |= (A @ fins.astype(float)) > 0
    for _ in range(15):
        lap = (A @ Q) / deg - Q
        Q[fins] += 0.6 * lap[fins]
    moved = np.linalg.norm(Q - P, axis=1)
    print(f"defuzz: {band.sum()} vertices in seam bands, moved median {np.median(moved[band]) * 1000:.2f} mm, max {moved.max() * 1000:.2f} mm")
    return Q


def bake(lab, A, E):
    global P
    P = defuzz(lab, A, E)
    W = weights(lab, A, E)
    top = np.argsort(-W, 1)[:, :4]
    tw = np.take_along_axis(W, top, 1)
    tw /= tw.sum(1, keepdims=True)
    q = np.floor(tw * 255).astype(int)
    q[:, 0] += 255 - q.sum(1)                       # every vertex sums to exactly 255
    joints = np.vectorize(lambda li: ORDER.index(LABELS[li]))(top)
    joints[q == 0] = 0
    parents = {n: PARENT.get(n) for n in ORDER if n != "char_root"}
    for side in "lr":                                # the sculpt has one fused finger block: index drives it,
        for f in ("middle", "ring", "pinky"):        # the other finger joints exist (for pose files) without vertices
            J[f"{side}_{f}1"] = J[f"{side}_index1"]; J[f"{side}_{f}2"] = J[f"{side}_index2"]
            parents[f"{side}_{f}1"] = f"{side}_wrist"; parents[f"{side}_{f}2"] = f"{side}_{f}1"
    extras = {"order": ORDER, "parents": parents, "joints": {n: [round(float(v), 5) for v in J[n]] for n in ORDER},
              "fingerBlock": True, "source": "Meshy AI 'Blank Mannequin' (1108175649), rigged by tools/rig.py"}
    write_glb("../assets/models/mannequin.glb", P, I, joints=joints, weights=q, extras=extras)
    blended = (q.max(1) < 255).sum()
    print(f"baked {N} vertices, {len(I)} triangles; blended vertices {blended} ({blended / N:.1%}); max influences {(q > 0).sum(1).max()}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "labels"
    lab, A, E = run(mode)
    if mode == "bake": bake(lab, A, E)
