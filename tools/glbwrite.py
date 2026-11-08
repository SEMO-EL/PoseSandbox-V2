"""Minimal GLB writer: one mesh, optional normals / colours / skin attributes, JSON extras."""
import json, struct, numpy as np


def write_glb(path, positions, indices, normals=None, colors=None, joints=None, weights=None, extras=None):
    chunks, views, accessors = [], [], []

    def add(arr, target, comp, typ, normalized=False, minmax=False):
        data = arr.tobytes()
        pad = (-len(data)) % 4
        off = sum(len(c) for c in chunks)
        chunks.append(data + b"\0" * pad)
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), **({"target": target} if target else {})})
        a = {"bufferView": len(views) - 1, "componentType": comp, "count": len(arr), "type": typ}
        if normalized: a["normalized"] = True
        if minmax: a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    attrs = {"POSITION": add(positions.astype(np.float32), 34962, 5126, "VEC3", minmax=True)}
    if normals is not None: attrs["NORMAL"] = add(normals.astype(np.float32), 34962, 5126, "VEC3")
    if colors is not None: attrs["COLOR_0"] = add(colors.astype(np.uint8), 34962, 5121, "VEC4", normalized=True)
    if joints is not None: attrs["JOINTS_0"] = add(joints.astype(np.uint8), 34962, 5121, "VEC4")
    if weights is not None: attrs["WEIGHTS_0"] = add(weights.astype(np.uint8), 34962, 5121, "VEC4", normalized=True)
    idx_type = (5123, np.uint16) if len(positions) < 65536 else (5125, np.uint32)
    ind = add(indices.reshape(-1).astype(idx_type[1]), 34963, idx_type[0], "SCALAR")

    mesh = {"name": "figure", "primitives": [{"attributes": attrs, "indices": ind, "mode": 4}]}
    if extras: mesh["extras"] = extras
    doc = {"asset": {"version": "2.0", "generator": "PoseSandbox tools/rig.py"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"name": "figure", "mesh": 0}], "meshes": [mesh], "accessors": accessors, "bufferViews": views,
           "buffers": [{"byteLength": sum(len(c) for c in chunks)}]}
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    binb = b"".join(chunks)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)
