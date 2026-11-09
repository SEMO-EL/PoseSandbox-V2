"""Blender side of the MakeHuman figure: build a CC0 MakeHuman body with MPFB, rig it with the game_engine skeleton and
export it as a skinned GLB for tools/mh_convert.py.

    blender -b --python tools/mh_build.py -- out.glb [gender muscle weight proportions]

Needs Blender 4.2+ with the MPFB extension installed (extensions.blender.org/add-ons/mpfb, GPL code; its base mesh,
targets, rigs and weights are MakeHuman's CC0 assets).
"""
import sys, importlib, addon_utils, bpy, bmesh

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
gender, muscle, weight, proportions = map(float, argv[1:5] if len(argv) >= 5 else [1.0, 0.65, 0.5, 0.75])

for m in addon_utils.modules():
    if m.__name__.endswith(".mpfb"):
        addon_utils.enable(m.__name__, default_set=True)


def mpfb(path, key):
    for name in list(sys.modules):
        if name.endswith(path):
            return getattr(importlib.import_module(name), key)
    raise ImportError(path)


HumanService = mpfb("mpfb.services.humanservice", "HumanService")
TargetService = mpfb("mpfb.services.targetservice", "TargetService")

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
macro = TargetService.get_default_macro_info_dict()
macro.update(gender=gender, muscle=muscle, weight=weight, proportions=proportions)
body = HumanService.create_human(macro_detail_dict=macro)
TargetService.bake_targets(body)
rig = HumanService.add_builtin_rig(body, "game_engine")  # fitted to the joint cubes, so before the helpers go

# keep the skin and the eyeballs; drop the helper geometry (tights, skirt, hair, teeth, lashes, joint cubes)
keep = {body.vertex_groups[n].index for n in ("body", "helper-l-eye", "helper-r-eye")}
bm = bmesh.new(); bm.from_mesh(body.data)
dl = bm.verts.layers.deform.active
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep & set(v[dl].keys())], context="VERTS")
bm.to_mesh(body.data); bm.free()
body.modifiers.remove(body.modifiers["Hide helpers"])
for p in body.data.polygons:
    p.use_smooth = True

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_skins=True, export_morph=False,
                          export_animations=False, export_materials="NONE", export_yup=True)
print("MH_BUILD_OK", len(body.data.vertices), "verts", len(rig.data.bones), "bones")
