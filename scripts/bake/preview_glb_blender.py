"""Render orthographic Workbench previews of a GLB (front/side/top) plus print stats.

blender.exe --background --factory-startup --python scripts/bake/preview_glb_blender.py -- <file.glb> [outdir]
"""
import bpy
import math
import os
import sys
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = args[0]
outdir = args[1] if len(args) > 1 else r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab\weapon_previews"
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
if os.path.splitext(src)[1].lower() == ".fbx":
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
lo = Vector((1e30, 1e30, 1e30))
hi = Vector((-1e30, -1e30, -1e30))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
print(f"[preview] {os.path.basename(src)} objects={len(objs)} tris={tris}")
print(f"[preview] bbox min={tuple(round(v,3) for v in lo)} max={tuple(round(v,3) for v in hi)} size={tuple(round(v,3) for v in (hi-lo))}")
for o in objs:
    print(f"[preview]   object {o.name!r} parent={o.parent.name if o.parent else None!r} verts={len(o.data.vertices)} mats={[m.name if m else None for m in o.data.materials]}")

center = (lo + hi) / 2
size = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.show_shadows = True
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 640
scene.render.resolution_y = 640
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * 1.35
cam_data.clip_start = max(0.01, size * 0.01)
cam_data.clip_end = size * 40 + 1000
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
name = os.path.splitext(os.path.basename(src))[0]
views = [("front", Vector((0, -size * 4, 0))), ("side", Vector((size * 4, 0, 0))), ("top", Vector((0, 0, size * 4)))]
for label, off in views:
    cam.location = center + off
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(outdir, f"{name}_{label}.png")
    bpy.ops.render.render(write_still=True)
    print("[preview] wrote", scene.render.filepath)
