import numpy as np
from scipy import ndimage

def slab_clusters(P, y, half=0.006, cell=0.008):
    """2D (x,z) blobs of the vertices in a horizontal slab: list of (index array, centroid, extent)."""
    m = np.where(np.abs(P[:, 1] - y) < half)[0]
    if len(m) == 0: return []
    q = P[m][:, [0, 2]]
    lo = q.min(0) - cell
    ij = np.floor((q - lo) / cell).astype(int)
    grid = np.zeros(ij.max(0) + 2, bool); grid[ij[:, 0], ij[:, 1]] = True
    lab, n = ndimage.label(ndimage.binary_dilation(grid, iterations=1))
    vl = lab[ij[:, 0], ij[:, 1]]
    out = []
    for k in range(1, n + 1):
        sel = m[vl == k]
        if len(sel) < 3: continue
        out.append((sel, P[sel][:, [0, 2]].mean(0), P[sel][:, [0, 2]].max(0) - P[sel][:, [0, 2]].min(0)))
    return out
