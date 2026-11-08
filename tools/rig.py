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
from scipy.spatial import cKDTree
from scipy.sparse.csgraph import connected_components

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
    if "shoulder" in j: return 2  # the ball turns inside the pad: a wide blend here smears the seam
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


def fit_shoulders(lab):
    if BALL: return  # fit once, on the first segmentation (refits would slide down the arm)
    """The shoulder pivot is the centre of the ball at the top of the upper arm (least-squares sphere fit)."""
    for side in "lr":
        top_y = J[f"{side}_shoulder"][1] - 0.06
        pts = P[(lab == LABELS.index(f"{side}_shoulder")) & (P[:, 1] > top_y)]
        A_ = np.c_[2 * pts, np.ones(len(pts))]
        c, *_ = np.linalg.lstsq(A_, (pts ** 2).sum(1), rcond=None)
        r = float(np.sqrt(c[3] + c[:3] @ c[:3]))
        res = float(np.median(np.abs(np.linalg.norm(pts - c[:3], axis=1) - r)))
        print(f"{side}_shoulder ball: centre {np.round(c[:3], 3)} r {r:.3f} residual {res * 1000:.1f} mm (was {np.round(J[f'{side}_shoulder'], 3)})")
        J[f"{side}_shoulder"] = tuple(c[:3])
        BALL[side] = (c[:3], r)


BALL = {}


def armpit_zone(side, k):
    """Under the shoulder ball, toward the body: where a raised arm pulls the skin."""
    c, r = BALL[side]
    return (P[:, 1] < c[1] - 0.3 * r) & (P[:, 1] > c[1] - 0.2) & (k * P[:, 0] < k * c[0] + 0.03) & (k * P[:, 0] > k * c[0] - 0.12)         & (np.abs(P[:, 2] - c[2]) < 2.2 * r)


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


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
        if par not in CAPS or child.endswith("_shoulder"): continue  # shoulders are cut, not blended (split_shoulders)
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
    if BALL:  # the ball's cap hides under the pad: every outward-facing vertex on the ball belongs to the arm
        n = vertex_normals()
        for side in "lr":
            c, r = BALL[side]
            d = P - c
            dist = np.linalg.norm(d, axis=1)
            out = (n * d).sum(1) / np.maximum(dist, 1e-9)
            ball = (dist < r * 1.2) & (out > 0.3)
            moved = (ball & (lab != LABELS.index(f"{side}_shoulder"))).sum()
            lab[ball] = LABELS.index(f"{side}_shoulder")
            print(f"{side} ball cap: {moved} vertices moved to the arm")
        lab = cleanup(lab, A)
    return lab


def run(mode):
    A, E = adjacency()
    conc = concavity(A)
    lab = segment(A, E, conc)
    for it in range(2):  # refit pivots to the grooves, rebuild the capsules from them, segment again
        moved = refine_joints(lab, E)
        mirror_toes()
        fit_shoulders(lab)
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
    if BALL:                                                 # armpits stretch most: clean their seam band harder
        for side, k in (("l", -1), ("r", 1)):
            fins |= armpit_zone(side, k) & band
    for _ in range(25):
        lap = (A @ Q) / deg - Q
        Q[fins] += 0.6 * lap[fins]
    moved = np.linalg.norm(Q - P, axis=1)
    print(f"defuzz: {band.sum()} vertices in seam bands, moved median {np.median(moved[band]) * 1000:.2f} mm, max {moved.max() * 1000:.2f} mm")
    return Q


def arm_labels(side):
    return [i for i, n in enumerate(LABELS) if n.startswith(side + "_") and n.split("_")[1].rstrip("12") not in ("hip", "knee", "ankle", "toes")]


def ballify(P, faces, side, arm):
    """Reshape the top of a cut-free upper arm (the open piece `faces`, vertices `arm`) into a clean ball that flows
    into the arm's tube (a smooth union of the fitted sphere and a capsule down the arm), with even vertex spacing:
    the sculpt's armpit crease is otherwise a lip of thin triangles that shows once the arm is raised. The open rim
    is smoothed along itself and projected too, so the cap built on it afterwards continues the same sphere."""
    P = P.copy()
    Ed = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), 1), axis=0)
    A = sp.coo_matrix((np.ones(len(Ed)), (Ed[:, 0], Ed[:, 1])), shape=(len(P), len(P))); A = (A + A.T).tocsr()
    deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)
    lp = np.array(boundary_loops(faces)[0])            # the open shoulder rim (one loop: split_shoulders checks)
    rim = np.zeros(len(P), bool); rim[lp] = True
    c, r = BALL[side]
    e = V(f"{side}_elbow"); Lh = np.linalg.norm(e - c)
    t0 = ((P - c) @ ((e - c) / Lh)) / Lh
    ah = P[arm & (t0 > 0.35) & (t0 < 0.45)].mean(0) - c      # axis through the arm's own cross-section centre
    ah /= np.linalg.norm(ah)
    t = ((P - c) @ ah) / Lh
    rad = np.linalg.norm(P - c - np.clip(t, 0, 1)[:, None] * Lh * ah, axis=1)
    ra = float(np.median(rad[arm & (t > 0.3) & (t < 0.45)]))
    k = 0.35 * r

    def sdf(X):
        ds = np.linalg.norm(X - c, axis=1) - r
        tt = np.clip(((X - c) @ ah) / Lh, 0, 1)
        dc = np.linalg.norm(X - c - tt[:, None] * Lh * ah, axis=1) - ra
        h = np.clip(0.5 + 0.5 * (dc - ds) / k, 0, 1)
        return dc * (1 - h) + ds * h - k * h * (1 - h)

    def project(X):
        for _ in range(2):
            d = sdf(X); g = np.zeros_like(X)
            for ax in range(3):
                dx = np.zeros(3); dx[ax] = 1e-4
                g[:, ax] = (sdf(X + dx) - sdf(X - dx)) / 2e-4
            X = X - (d / np.maximum((g * g).sum(1), 1e-9))[:, None] * g
        return X

    w = np.where(rim, 1, 1 - sm(0.15, 0.4, t))        # the rim goes all the way: the cap is built on it
    reg = arm & (w > 0)
    Q = P.copy(); X = Q[reg]
    rel = reg & ~rim
    for it in range(15):
        avg = (A @ Q) / deg[:, None]
        Q[rel] += 0.5 * (avg[rel] - Q[rel])            # even out the spacing (the rim: along itself)...
        Q[lp] = 0.5 * Q[lp] + 0.25 * (np.roll(Q[lp], 1, 0) + np.roll(Q[lp], -1, 0))
        Q[reg] = project(Q[reg])                       # ...and put it back on the surface
    move = w[reg, None] * (Q[reg] - P[reg])
    P[reg] += move
    mm = np.linalg.norm(move, axis=1) * 1000
    print(f"{side} ball: tube radius {ra * 100:.1f} cm (ball {r * 100:.1f} cm), {reg.sum()} vertices reshaped, moved median {np.median(mm):.1f} mm, max {mm.max():.1f} mm")
    return P, project, lambda X: 1 - sm(0.15, 0.4, ((X - c) @ ah) / Lh)


def split_shoulders(P, I, W, lab):
    """Cut each arm free at the shoulder like an art mannequin's ball joint. The cut runs along a smooth curve (the
    0.5 line of a smoothed arm/body field, splitting triangles), not along jagged mesh edges. The arm's opening is
    closed with a spherical cap on the fitted ball, the body's with a concave spherical socket just inside it.
    Nothing can stretch across a shoulder, and whatever a turning ball uncovers is ball or socket."""
    ci = LABELS.index("chest")
    onehot = lambda li: np.eye(len(LABELS))[li]
    seen = None
    for side in "lr":
        ai = LABELS.index(f"{side}_shoulder")
        c, r = BALL[side]
        n = len(P)
        Ed = np.unique(np.sort(np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]]), 1), axis=0)
        A = sp.coo_matrix((np.ones(len(Ed)), (Ed[:, 0], Ed[:, 1])), shape=(n, n)); A = (A + A.T).tocsr()
        deg = np.asarray(A.sum(1)).ravel()
        arm = np.isin(lab, arm_labels(side))
        f = arm.astype(float)
        free = (arm & (A @ (~arm).astype(float) > 0)) | (~arm & (A @ arm.astype(float) > 0))
        for _ in range(3): free |= A @ free.astype(float) > 0
        free &= np.linalg.norm(P - c, axis=1) < 2.5 * r
        for _ in range(60): f[free] = (A @ f)[free] / deg[free]
        zone = np.linalg.norm(P - c, axis=1) < 2.5 * r
        if seen is None:                                 # the l seam came out cleaner: keep it, and mirror it onto r
            seen = (cKDTree((P[zone] - c) * [-1, 1, 1]), f[zone])
        else:
            dd, ii = seen[0].query(P[zone] - c, k=4)
            wgt = 1 / np.maximum(dd, 1e-6)
            f[zone] = (seen[1][ii] * wgt).sum(1) / wgt.sum(1)
            for _ in range(20): f[zone] = (A @ f)[zone] / deg[zone]
        on_arm = f >= 0.5
        fn_ = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]); nrm = np.zeros_like(P)
        for k_ in range(3): np.add.at(nrm, I[:, k_], fn_)
        on_arm &= ~(zone & ((nrm * (P - c)).sum(1) < 0))  # surface facing the ball (the pad's underside) stays body
        for want in (True, False):                       # no islands: one arm region, one body region
            sub = np.where(on_arm == want)[0]
            _, comp = connected_components(A[sub][:, sub], directed=False)
            flip = sub[(comp != np.bincount(comp).argmax()) & zone[sub]]  # only near the ball: separate shells elsewhere stay
            on_arm[flip] = not want
        S = on_arm[I]; cnt = S.sum(1)
        newP, newW, newL, edge, fa, fb = [], [], [], {}, [], []

        def cut(u, v):                                   # (arm copy, body copy) of the point where f = 0.5 on edge u-v
            key = (min(u, v), max(u, v))
            if key not in edge:
                t = np.clip((0.5 - f[u]) / (f[v] - f[u]), 0.05, 0.95)
                x = P[u] + t * (P[v] - P[u])
                edge[key] = (n + len(newP), n + len(newP) + 1)
                newP.extend([x, x]); newW.extend([onehot(ai), onehot(ci)]); newL.extend([ai, ci])
            return edge[key]

        for tri, sd in zip(I[(cnt == 1) | (cnt == 2)], S[(cnt == 1) | (cnt == 2)]):
            lone = next(k for k in range(3) if sd[k] != sd[(k + 1) % 3] and sd[k] != sd[(k + 2) % 3])
            x, y, z = tri[lone], tri[(lone + 1) % 3], tri[(lone + 2) % 3]
            xy, xz = cut(x, y), cut(x, z)
            k1 = 0 if sd[lone] else 1; k2 = 1 - k1
            one = [(x, xy[k1], xz[k1])]
            two = [(xy[k2], y, z), (xy[k2], z, xz[k2])]
            (fa if sd[lone] else fb).extend(one); (fb if sd[lone] else fa).extend(two)
        P = np.vstack([P, newP]); W = np.vstack([W, newW]); lab = np.concatenate([lab, newL])
        for v in np.where(on_arm & ~arm)[0]:             # vertices the smooth cut moved across
            W[v] = onehot(ai); lab[v] = ai
        for v in np.where(~on_arm & arm)[0]:
            W[v] = onehot(ci); lab[v] = ci
        I_arm = np.vstack([I[cnt == 3], np.array(fa, int).reshape(-1, 3)])
        I_body = np.vstack([I[cnt == 0], np.array(fb, int).reshape(-1, 3)])
        P, onto_ball, ball_w = ballify(P, I_arm, side, np.isin(np.arange(len(P)), I_arm))
        parts = []
        for faces, rad, li, rings in ((I_arm, r, ai, 6), (I_body, 0.96 * r, ci, 4)):
            loops = boundary_loops(faces)
            assert len(loops) == 1, f"{side}: an opening should be one loop, got {[len(l) for l in loops]}"
            loop = loops[0]; m = len(loop)
            if li == ci:                                 # tuck the socket's lip onto the ball, fading over 8 rings
                K = 8
                Eb = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), 1), axis=0)
                Ab = sp.coo_matrix((np.ones(len(Eb)), (Eb[:, 0], Eb[:, 1])), shape=(len(P), len(P))); Ab = (Ab + Ab.T).tocsr()
                hop = np.full(len(P), 99); hop[loop] = 0; front = hop == 0
                for h_ in range(1, K):
                    front = (Ab @ front.astype(float) > 0) & (hop == 99); hop[front] = h_
                near = np.where(hop < K)[0]
                lp = np.array(loop); q = P[lp].copy()
                for _ in range(30):                          # the lip's target: on the sphere, smoothed along itself
                    q = 0.5 * q + 0.25 * (np.roll(q, 1, 0) + np.roll(q, -1, 0))
                    q = c + 1.008 * r * (q - c) / np.linalg.norm(q - c, axis=1, keepdims=True)
                D = np.zeros_like(P); D[lp] = q - P[lp]
                inner = near[hop[near] > 0]; degb = np.asarray(Ab.sum(1)).ravel()[inner]
                for _ in range(150):                         # spread the lip's move smoothly into the rings behind it
                    D[inner] = (Ab @ D)[inner] / degb[:, None]
                P[near] += D[near]
                for lam in [0.5, -0.53] * 30:                # Taubin relax of the tucked zone (lip held): no folds, no shrink
                    P[inner] += lam * ((Ab @ P)[inner] / degb[:, None] - P[inner])
            d = P[loop] - c; d /= np.linalg.norm(d, axis=1, keepdims=True)
            u = d.mean(0); u /= np.linalg.norm(u)
            ring_ix = [np.array(loop)]; extra = []
            ds = d.copy()
            for j in range(1, rings):                    # rings on the sphere, from the rim's directions toward u,
                for _ in range(400):                     # each rounder than the last (a crescent rim's own average
                    ds = 0.5 * ds + 0.25 * (np.roll(ds, 1, 0) + np.roll(ds, -1, 0))  # can lie outside it)
                    ds /= np.linalg.norm(ds, axis=1, keepdims=True)
                u = ds.mean(0); u /= np.linalg.norm(u)  # and closing on its own centre: no ring folds over
                q = (1 - j / rings) * ds + (j / rings) * u
                q = c + rad * q / np.linalg.norm(q, axis=1, keepdims=True)
                ring_ix.append(len(P) + len(extra) + np.arange(m)); extra.extend(q)
            apex = len(P) + len(extra); extra.append(c + rad * u)
            if li == ai: extra = onto_ball(np.array(extra))  # the cap lies on the same ball-and-tube surface as the arm
            P = np.vstack([P, extra]); W = np.vstack([W, np.tile(onehot(li), (len(extra), 1))]); lab = np.concatenate([lab, np.full(len(extra), li)])
            tris = []
            for O, In in zip(ring_ix[:-1], ring_ix[1:]):  # the boundary runs O[k] -> O[k+1], so the cap walks it backwards
                for k in range(m):
                    k1 = (k + 1) % m
                    tris += [(O[k1], O[k], In[k]), (O[k1], In[k], In[k1])]
            last = ring_ix[-1]
            tris += [(last[(k + 1) % m], last[k], apex) for k in range(m)]
            parts.append(np.array(tris))
            if li == ai:                                 # one last pass over the whole ball, cap and arm together,
                Fa = np.vstack([I_arm, parts[0]])        # so they meet without a crease (the cap's centre stays put)
                Ea = np.unique(np.sort(np.concatenate([Fa[:, [0, 1]], Fa[:, [1, 2]], Fa[:, [2, 0]]]), 1), axis=0)
                Aa = sp.coo_matrix((np.ones(len(Ea)), (Ea[:, 0], Ea[:, 1])), shape=(len(P), len(P))); Aa = (Aa + Aa.T).tocsr()
                ball = np.zeros(len(P), bool); ball[np.unique(Fa)] = True
                ball &= np.linalg.norm(P - c, axis=1) < 1.6 * r
                wb = np.zeros(len(P)); wb[ball] = ball_w(P[ball]); wb[np.concatenate(ring_ix)] = 1; wb[apex] = 1
                rel = ball & (wb > 0.999); rel[ring_ix[-1]] = False; rel[apex] = False
                dega = np.maximum(np.asarray(Aa.sum(1)).ravel(), 1)[rel]
                for _ in range(10):                      # (fading out down the arm exactly as the first reshape did)
                    P[rel] += 0.5 * ((Aa @ P)[rel] / dega[:, None] - P[rel])
                    P[ball] += wb[ball, None] * (onto_ball(P[ball]) - P[ball])
        I = np.vstack([I_arm, parts[0], I_body, parts[1]])
        print(f"{side} shoulder cut: {len(edge)} edges split along the seam, rim {len(boundary_loops(I_arm)[0])} points")
    # the result must be closed and manifold: every edge in exactly two triangles
    E2 = np.sort(np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]]), 1)
    _, cnt = np.unique(E2, axis=0, return_counts=True)
    assert (cnt == 2).all(), f"open or non-manifold edges after the cut: {(cnt != 2).sum()}"
    print(f"cut mesh closed: {len(P)} vertices, {len(I)} triangles, every edge shared by exactly 2 triangles")
    return P, I, W, lab


def boundary_loops(faces):
    """Ordered loops of edges used by one triangle only, each in the owning triangle's winding direction."""
    directed = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    key = np.sort(directed, 1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    nxt = {int(a): int(b) for (a, b), c in zip(directed, cnt[inv]) if c == 1}
    loops, seen = [], set()
    for start in list(nxt):
        if start in seen: continue
        loop, v = [], start
        while v not in seen:
            seen.add(v); loop.append(v); v = nxt[v]
        loops.append(loop)
    return loops


def bake(lab, A, E):
    global P
    P = defuzz(lab, A, E)
    W = weights(lab, A, E)
    P, I_cut, W, lab_cut = split_shoulders(P, I, W, lab)
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
    write_glb("../assets/models/mannequin.glb", P, I_cut, joints=joints, weights=q, extras=extras)
    blended = (q.max(1) < 255).sum()
    N_ = len(P)
    print(f"baked {len(P)} vertices, {len(I_cut)} triangles; blended vertices {blended} ({blended / N_:.1%}); max influences {(q > 0).sum(1).max()}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "labels"
    lab, A, E = run(mode)
    if mode == "bake": bake(lab, A, E)
