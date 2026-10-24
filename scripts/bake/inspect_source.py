"""Inspect any 3D source in Blender: objects, tris, bbox, materials, texture wiring.

blender.exe --background --factory-startup --python scripts/bake/inspect_source.py -- <file> [scale_hint]
"""
import bpy
import os
import sys
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = args[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((1e30, 1e30, 1e30))
hi = Vector((-1e30, -1e30, -1e30))
tris = 0
for o in objs:
    tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
print(f"[inspect] {os.path.basename(src)} ext={ext} objects={len(objs)} totalTris={tris}")
print(f"[inspect] bbox min={tuple(round(v,3) for v in lo)} max={tuple(round(v,3) for v in hi)} size={tuple(round(v,3) for v in (hi-lo))}")
mats = set()
for o in objs[:40]:
    mats.update(m.name for m in o.data.materials if m)
    print(f"[inspect] obj {o.name!r} parent={o.parent.name if o.parent else None!r} verts={len(o.data.vertices)} tris={sum(len(p.vertices)-2 for p in o.data.polygons)} uvs={[u.name for u in o.data.uv_layers]} mats={[m.name if m else None for m in o.data.materials]}")
print(f"[inspect] objects listed: {min(len(objs),40)}/{len(objs)}; distinct materials={len(mats)}")
print(f"[inspect] materials: {sorted(mats)}")
for m in list(bpy.data.materials)[:30]:
    if not m.use_nodes:
        continue
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            print(f"[inspect] mat {m.name!r} image {n.image.name!r} filepath={n.image.filepath!r} size={tuple(n.image.size)} found={bool(n.image.has_data)}")
