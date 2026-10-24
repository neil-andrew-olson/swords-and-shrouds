"""Render a close-up of a character GLB with fixed framing (skinned mesh bboxes are huge, so the
generic preview script frames the wrong box). Used as visual proof for the character atlas fix.

blender.exe --background --factory-startup --python scripts/bake/render-character-cycles.py -- \
    <file.glb> <out.png> [label]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src, out = args[0], args[1]
label = args[2] if len(args) > 2 else ""

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print(f"[char] {os.path.basename(src)}: {len(meshes)} mesh(es), armatures="
      f"{[o.name for o in bpy.context.scene.objects if o.type == 'ARMATURE']}", flush=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 32
scene.render.resolution_x = 520
scene.render.resolution_y = 640
scene.render.film_transparent = False

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.045, 0.06, 0.10, 1.0)  # night sky
bg.inputs[1].default_value = 1.2

key = bpy.data.lights.new("key", type="SUN")
key.energy = 3.2
key.angle = math.radians(18)
key_obj = bpy.data.objects.new("key", key)
key_obj.rotation_euler = (math.radians(62), 0, math.radians(25))
scene.collection.objects.link(key_obj)
fill = bpy.data.lights.new("fill", type="AREA")
fill.energy = 120
fill.size = 3.0
fill_obj = bpy.data.objects.new("fill", fill)
fill_obj.location = (-2.6, -2.2, 2.2)
fill_obj.rotation_euler = (math.radians(70), 0, math.radians(-35))
scene.collection.objects.link(fill_obj)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.35
cam_data.clip_start = 0.01
cam_data.clip_end = 100
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = Vector((0.0, 0.0, 0.95))
cam.location = target + Vector((2.1, -2.6, 0.55))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

os.makedirs(os.path.dirname(out), exist_ok=True)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"[char] wrote {out} {label}", flush=True)
