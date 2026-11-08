# tools/

`rig.py` turns the sculpted mannequin (`mannequin-source.glb`, a Meshy AI "Blank Mannequin" generation) into the
skinned figure the app loads, `assets/models/mannequin.glb`:

1. normalise (1.80 m tall, feet on y = 0), fit PoseSandbox's skeleton (v1 joint names kept, so old pose files load);
2. segment the welded surface into parts with a crease-aware flood (part boundaries land in the sculpted grooves),
   refit each pivot to the centre of its groove ring, segment again;
3. smooth Meshy's seam fuzz in the grooves only (Taubin, then fin collapse on noisy-normal vertices);
4. blend weights in a band of a few edge rings at each seam (≤ 3 influences, each vertex sums to exactly 1);
   the shoulders are not blended but cut free like an art mannequin's ball joint: the cut follows a smooth curve
   (the l seam, mirrored onto r), the arm's top is reshaped into a ball flowing into the arm and capped, and the
   chest gets a spherical socket whose lip hugs the ball, so nothing stretches or tears at any arm angle;
5. bake a GLB with JOINTS_0 / WEIGHTS_0; the mesh extras carry joint order, parents and rest positions.

    python tools/rig.py labels   # tools/_labels.glb: parts colour-coded (view with tests/glb.html?src=../tools/_labels.glb)
    python tools/rig.py bake     # assets/models/mannequin.glb

The four fingers are fused in the sculpt, so they move as one block (driven by the index joints); thumbs are separate.
Check `tests/selfcheck.html` after a re-bake (bind, weights, presets on the floor, IK).
