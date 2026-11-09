# tools/

The figure the app loads, `assets/models/mannequin.glb`, is a [MakeHuman](https://www.makehumancommunity.org) body built in
Blender with the MPFB extension ([extensions.blender.org/add-ons/mpfb](https://extensions.blender.org/add-ons/mpfb/)).
MakeHuman's base mesh, targets, rigs and skin weights are **CC0 1.0** (no attribution required; credited anyway); MPFB's
own code is GPL and is not shipped.

1. `mh_build.py` (runs inside Blender 4.2+ with MPFB installed) makes the body (male, a little muscular), fits the
   `game_engine` skeleton with MakeHuman's weights, keeps the skin and eyeballs and exports a skinned GLB:

       blender -b --python tools/mh_build.py -- mh.glb [gender muscle weight proportions]

2. `mh_convert.py` keeps those weights and only:
   - merges the bones onto PoseSandbox's joints (v1 names, so old pose files load; `_l` bones are the figure's left, the
     app's legacy `r_` side; clavicles join the chest, finger segments 2 and 3 join);
   - brings the A-pose to the app's rest through the same weights: arms and forearms straight down, palms to the thighs
     with the thumbs forward, fingers straightened (the hand shapes assume straight fingers);
   - scales it to 1.80 m with the feet on y = 0.

       python tools/mh_convert.py mh.glb

Check `tests/selfcheck.html` after a conversion (bind, weights, presets on the floor, IK); `tests/viewer.html` shows the
figure alone (`?preset=jump&view=x,y,z&look=x,y,z`, `&src=` for another GLB).

`landing_shots.py` re-renders the home page's poster and pose thumbnails from its live stage.
