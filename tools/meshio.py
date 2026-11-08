"""Read the source GLB (positions + indices) into numpy, normalised: feet on y=0, centred, 1.80 m tall."""
import json, struct, numpy as np, pathlib

SRC = pathlib.Path(__file__).with_name("mannequin-source.glb")
HEIGHT = 1.80


def load(path=SRC):
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    J = json.loads(b[20:20 + n]); BIN = b[20 + n + 8:]
    def acc(i, dtype, comps):
        a = J["accessors"][i]; v = J["bufferViews"][a["bufferView"]]
        off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(BIN, dtype=dtype, count=a["count"] * comps, offset=off).reshape(-1, comps) if comps > 1 else np.frombuffer(BIN, dtype=dtype, count=a["count"], offset=off)
    p = J["meshes"][0]["primitives"][0]
    P = acc(p["attributes"]["POSITION"], np.float32, 3).astype(np.float64)
    I = acc(p["indices"], np.uint32, 1).astype(np.int64).reshape(-1, 3)
    s = HEIGHT / (P[:, 1].max() - P[:, 1].min())
    P = P * s
    P[:, 1] -= P[:, 1].min()
    P[:, [0, 2]] -= (P[:, [0, 2]].max(0) + P[:, [0, 2]].min(0)) / 2
    return P, I, s


def components(n, I):
    parent = np.arange(n)
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for a, b, c in I:
        for u, v in ((a, b), (b, c)):
            ru, rv = find(u), find(v)
            if ru != rv: parent[ru] = rv
    return np.array([find(i) for i in range(n)])
