"""Cycles CPU preview render (true PBR material check) for a shipped GLB.

blender.exe --background --factory-startup --python scripts/bake/render_glb_cycles.py -- <file.glb> [out.png]
"""
import bpy
import math
import os
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = args[0]
out = args[1] if len(args) > 1 else r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab\shipped_previews\cycles.png"

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((1e30, 1e30, 1e30))
hi = Vector((-1e30, -1e30, -1e30))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
centre = (lo + hi) / 2
size = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
print("[cycles] bbox", tuple(round(v, 3) for v in (hi - lo)))

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.render.resolution_x = 480
scene.render.resolution_y = 480
scene.render.film_transparent = False

# world: dim blue night sky
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.05, 0.07, 0.12, 1.0)
bg.inputs[1].default_value = 0.6

# key sun
light_data = bpy.data.lights.new("sun", type="SUN")
light_data.energy = 4.0
light = bpy.data.objects.new("sun", light_data)
light.rotation_euler = (math.radians(55), 0, math.radians(35))
scene.collection.objects.link(light)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size * 1.2
cam_data.clip_start = max(0.01, size * 0.01)
cam_data.clip_end = size * 40 + 1000
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = centre + Vector((size * 0.6, -size * 3.0, size * 0.5))
cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
os.makedirs(os.path.dirname(out), exist_ok=True)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("[cycles] wrote", out)
