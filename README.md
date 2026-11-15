# PoseSandbox

A free 3D pose reference for artists that runs in the browser: pose a mannequin (or several), light it, look at it
as flat values, line art or a silhouette, and export a clean PNG. No build step, no server, no account.

Live site: <https://semo-el.github.io/PoseSandbox-V2/> · editor: `app.html` · home page: `index.html`

## What it does

- **Pose by dragging.** A hand or foot pulls its limb (IK), the pelvis moves the body over planted feet, the floor
  ring slides the figure, any other part swings about its joint. A gizmo (Rotate / Move / Scale) for exact work.
- **Several figures** in one scene (up to six), each with its own pose, build and material.
- **46 library poses** in four groups, 7 hand shapes, mirror, symmetry, random, undo for everything.
- **Looks:** Shaded, Values (four flat tones), Ink (line art), Silhouette. **Flip** the view. **Framing guides**
  (thirds, 1:1, 4:5, A4, 16:9 …). Export gives what you see, at 1×, 2× or 4×, optionally transparent.
- **Gesture practice:** timed poses with a countdown, from the library or your saved poses.
- **Lighting:** five studio presets, seven portrait patterns (Rembrandt, Loop, Butterfly, Split …), your own point
  and spot lights.
- Props, imported `.glb` models, a pinned reference image, a saved-pose gallery, pose files, and **share links**
  that carry a whole scene in the URL.

## Run it

Everything is static files. Any web server works; this one never caches, so an edited file is what the browser runs:

    python tools/serve.py 8161        # then open http://localhost:8161/app.html

(Opening `app.html` straight from disk does not work: browsers block module imports from `file://`.)

## Test it

Needs Python with `playwright` (and `pillow` for the pose sheet). With the server above running:

    python tests/run_selfcheck.py     # logic: IK, save/load, mirror, undo, presets on the floor, hinges  (18 checks)
    python tests/smoke.py             # the real editor in headless Chromium: drag, figures, looks, practice, links (16 checks)

Both print one line per check and exit non-zero on a failure. Not covered by tests: real phones and touch,
Safari and Firefox, the chime's sound, the Gumroad checkout.

## Publish it

The live site is GitHub Pages on the `main` branch of the `v2` remote (`SEMO-EL/PoseSandbox-V2`). Work happens on
the local branch `v2-upgrade`. Publishing is one push; Pages redeploys in about a minute:

    git push v2 v2-upgrade:main

## Where things are

| Path | What it holds |
| --- | --- |
| `app.html`, `app.js`, `styles.css` | The editor: markup, the wiring of every panel and tool, styles |
| `index.html`, `landing.js`, `landing.css` | The home page (a scroll-driven 3D studio) |
| `character/character.js` | The mannequin: the skinned model and the three procedural builds, joints, materials |
| `controls/` | `selection.js` picking and highlight · `grab.js` drag-to-pose pointer handling · `ik.js` two-bone IK, aim, hinge limits · `practice.js` the gesture-practice clock |
| `engine/` | `scene.js` camera, orbit, studio lights, floor · `looks.js` Values / Ink / Silhouette · `loop.js` render on demand · `reference.js` pinned image |
| `poses/` | `presets.js` the pose library · `hands.js` hand shapes · `pose-io.js` the file format (also undo snapshots, gallery, links) |
| `core/` | `world.js` props, lights, imports · `history.js` undo · `share.js` links · `helpers.js` |
| `lights/custom-lights.js`, `gallery/gallery.js` | User lights; saved poses in localStorage |
| `assets/models/mannequin.glb` | The figure (Quaternius, CC0), made by `tools/ual_convert.py` |
| `tools/` | Dev server, pose contact sheet, pose-angle helper, model converter (see `tools/README.md`) |
| `vendor/three/` | three.js r186, vendored (no CDN) |

## How to add a pose

1. Add an entry to `PRESETS` in `poses/presets.js`: an `id`, a `name`, a `group` (Standing, Gesture, Action,
   Seated and floor) and `joints` as `[x, y, z]` degrees per joint. The conventions are at the top of that file.
   The legacy `l_` joints are the figure's **right** side.
2. For an arm or leg it is easier to say where it should go than to guess angles:

       node tools/aim_angles.mjs "0.5,-0.82,-0.28" "-0.85,0.1,0.5"     # limb points there, bends toward there

   or call `reachAngles(shoulder, wristTarget, elbowSide)` from that file for a whole limb.
3. Look at it: `python tools/pose_sheet.py sheet.jpg yourid otherid` renders poses from two angles into one image.
4. `python tests/run_selfcheck.py` checks it stands on the floor on both figure types.

## Good to know

- Pose files, gallery entries, undo snapshots and share links are all the same JSON document (`poses/pose-io.js`).
  The first figure sits at the top level, exactly as older files had it, so old files and the Starter Pack still
  load; extra figures are in `figures`.
- The editor draws only when something changed (`engine/loop.js`). Anything that changes the picture must call
  `invalidate()`.
- Helpers (gizmo, grid, bulbs, floor ring) carry `userData.helper = true`. Exports hide them; the looks draw them
  on a separate layer so they are never stylised.
- Imported models are not stored in pose files or links; they are matched by name when a file is opened.
- Saved work lives in the browser's localStorage (`posesandbox_session_v2`, `pose_sandbox_gallery_v1`,
  `posesandbox_view`).

## Credits

Mannequin model by [Quaternius](https://quaternius.com) (CC0). three.js (MIT). Built with Claude.
