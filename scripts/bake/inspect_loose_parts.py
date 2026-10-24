"""Split a GLB/FBX into loose parts, report the biggest parts (world-space bbox) and render
orthographic previews of the whole scene, to identify a single prop (e.g. the camp tent).

blender.exe --background --factory-startup --python scripts/bake/inspect_loose_parts.py -- <file> [outdir]
"""
import bpy
import os
import sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = args[0]
outdir = args[1] if len(args) > 1 else r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab\asset_previews"
os.makedirs(outdir, exist_ok=True)
name = os.path.splitext(os.path.basename(src))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in objs:
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

# join everything so loose-part separation sees the whole scene
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
with bpy.context.temp_override(active_object=objs[0], selected_objects=objs, selected_editable_objects=objs):
    bpy.ops.object.join()
whole = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
whole.name = "scene"
tris = sum(len(p.vertices) - 2 for p in whole.data.polygons)
print(f"[loose] {name}: joined {tris} tris", flush=True)

bpy.context.view_layer.objects.active = whole
with bpy.context.temp_override(active_object=whole, selected_objects=[whole], selected_editable_objects=[whole]):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
parts = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print(f"[loose] separated into {len(parts)} loose parts", flush=True)

rows = []
for o in parts:
    me = o.data
    if not me.vertices:
        continue
    lo = Vector((1e30, 1e30, 1e30))
    hi = Vector((-1e30, -1e30, -1e30))
    for v in me.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    size = hi - lo
    t = sum(len(p.vertices) - 2 for p in me.polygons)
    rows.append((size.x * size.y * size.z, t, lo.copy(), hi.copy(), size, o.name))
rows.sort(key=lambda r: -r[0])
print("[loose] idx tris   size(x,y,z)              centre", flush=True)
for i, (vol, t, lo, hi, size, nm) in enumerate(rows[:60]):
    c = (lo + hi) / 2
    print(f"[loose] {i:3d} {t:6d}  {size.x:8.2f} {size.y:8.2f} {size.z:8.2f}  "
          f"c=({c.x:9.2f},{c.y:9.2f},{c.z:9.2f})  {nm}", flush=True)
print(f"[loose] total parts={len(rows)}", flush=True)

# previews of the joined scene (before separation) - use the union of parts at the end
lo = Vector((1e30, 1e30, 1e30))
hi = Vector((-1e30, -1e30, -1e30))
for o in parts:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
centre = (lo + hi) / 2
size = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * 1.15
cam_data.clip_start = max(0.01, size * 0.01)
cam_data.clip_end = size * 40 + 1000
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
for label, off in (("top", Vector((0, 0, size * 4))), ("front", Vector((0, -size * 4, 0)))):
    cam.location = centre + off
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(outdir, f"{name}_{label}.png")
    bpy.ops.render.render(write_still=True)
    print("[loose] wrote", scene.render.filepath, flush=True)
