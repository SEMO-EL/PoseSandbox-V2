# tools/

`ual_convert.py` makes the figure the app loads, `assets/models/mannequin.glb`, from Quaternius's
**Universal Animation Library** mannequin ([OpenGameArt](https://opengameart.org/content/universal-animation-library),
Standard zip, `Godot/AnimationLibrary_Godot_Standard.glb`), released under **CC0 1.0** (no attribution required; credited anyway).

It keeps the artist's skin weights and normals and only:

1. merges the Rigify bones onto PoseSandbox's joints (v1 names, so old pose files load; `.L` bones are the figure's left,
   the app's legacy `r_` side; clavicles join the chest, finger segments 2 and 3 join);
2. lowers the T-pose arms to hang straight down through those same weights (the app's rest pose; the T-pose preset
   brings them back);
3. scales it to 1.80 m with the feet on y = 0, and writes the joint rings' darker tone as vertex colour.

    python tools/ual_convert.py path/to/AnimationLibrary_Godot_Standard.glb

Check `tests/selfcheck.html` after a conversion (bind, weights, presets on the floor, IK); `tests/viewer.html` shows the
figure alone (`?preset=jump&view=x,y,z&look=x,y,z`).

`landing_shots.py` re-renders the home page's poster and pose thumbnails from its live stage.

`serve.py` is the dev server (never cached): `python tools/serve.py 8161`.

`pose_sheet.py` renders library poses from two angles into one image, to check new poses by eye:
`python tools/pose_sheet.py sheet.jpg [id id ...]`.

`aim_angles.mjs` turns "this limb points there and bends toward there" (or "the wrist goes here") into the
`[x, y, z]` angles `poses/presets.js` uses: `node tools/aim_angles.mjs "0.5,-0.82,-0.28" "-0.85,0.1,0.5"`.
