"""Bake a landmark ruin from a warehouse source: import, single night-toned material, decimate to a
tri budget, ground-centre, export a plain glTF 2.0 GLB with an embedded base-colour texture.

  blender.exe --background --factory-startup --python scripts/bake/bake-landmark.py -- \
      --name chapel_ruin --src <path.fbx|glb|obj> --tex <resized basecolor.jpg> --budget 14000 --out <dir>
"""
import math
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


NAME = arg("--name")
SRC = arg("--src")
TEX = arg("--tex")
BUDGET = int(arg("--budget", "14000"))
OUT = arg("--out")
TEX_TILE = float(arg("--tile", "1"))  # UV repeat count for the base colour

os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

ext = os.path.splitext(SRC)[1].lower()
if ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=SRC)
elif ext == ".glb" or ext == ".gltf":
    bpy.ops.import_scene.gltf(filepath=SRC)
elif ext == ".obj":
    bpy.ops.import_scene.obj(filepath=SRC)
else:
    raise RuntimeError("unsupported source " + SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise RuntimeError("no mesh imported from " + SRC)
print(f"[landmark] {NAME}: {len(meshes)} mesh objects, "
      f"{sum(len(o.data.polygons) for o in meshes)} polys", flush=True)

# ---- join everything into one mesh ----
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print(f"[landmark] joined: {len(obj.data.polygons)} polys, {len(obj.data.vertices)} verts", flush=True)

# ---- material: single night-toned base colour texture ----
for m in list(obj.data.materials):
    obj.data.materials.pop(index=0)
mat = bpy.data.materials.new("ruin_bake")
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.92
bsdf.inputs["Metallic"].default_value = 0.0
nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
if TEX and os.path.exists(TEX):
    img = bpy.data.images.load(TEX)
    img.colorspace_settings.name = "sRGB"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    # night grade: slightly darker + cool tint, keeps the scan's material identity
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs["Color1"])
    mix.inputs["Color2"].default_value = (0.86, 0.90, 0.98, 1.0)
    # tiled UV mapping for structures (UVs scaled around the UV centre)
    if TEX_TILE != 1.0:
        uvn = nt.nodes.new("ShaderNodeUVMap")
        mapn = nt.nodes.new("ShaderNodeMapping")
        mapn.inputs["Location"].default_value = (0.5, 0.5, 0.0)
        mapn.inputs["Scale"].default_value = (TEX_TILE, TEX_TILE, 1.0)
        mapn.inputs["Location"].default_value = (0.5 - TEX_TILE * 0.5, 0.5 - TEX_TILE * 0.5, 0.0)
        nt.links.new(uvn.outputs["UV"], mapn.inputs["Vector"])
        nt.links.new(mapn.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
obj.data.materials.append(mat)

# ---- decimate to the triangle budget (iterate: collapse ratios compound on face counts) ----
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
for _ in range(0 if BUDGET <= 0 else 6):
    if tris <= BUDGET * 1.02:
        break
    ratio = max(0.0005, min(0.95, (BUDGET / float(tris)) * 0.96))
    dec = obj.modifiers.new("dec", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = ratio
    dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"[landmark] decimate -> {tris} tris", flush=True)
bpy.ops.object.shade_smooth()
if BUDGET > 0 and tris > BUDGET * 1.05:
    raise RuntimeError(f"still over budget: {tris} > {BUDGET}")

# ---- ground-centre: min y = 0, x/z centred ----
xs = [v.co.x for v in obj.data.vertices]
ys = [v.co.y for v in obj.data.vertices]
zs = [v.co.z for v in obj.data.vertices]
cx = (min(xs) + max(xs)) * 0.5
cz = (min(zs) + max(zs)) * 0.5
miny = min(ys)
for v in obj.data.vertices:
    v.co.x -= cx
    v.co.z -= cz
    v.co.y -= miny
obj.data.update()
xs = [v.co.x for v in obj.data.vertices]
ys = [v.co.y for v in obj.data.vertices]
zs = [v.co.z for v in obj.data.vertices]
print(f"[landmark] bbox x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] "
      f"z[{min(zs):.2f},{max(zs):.2f}]", flush=True)

obj.select_set(True)
bpy.context.view_layer.objects.active = obj
dest = os.path.join(OUT, NAME + ".glb")
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
kwargs = {
    "filepath": dest, "export_format": "GLB", "use_selection": True, "export_yup": True,
    "export_apply": False, "export_animations": False, "export_texcoords": True,
    "export_normals": True, "export_draco_mesh_compression_enable": False,
    "export_image_format": "AUTO", "export_jpeg_quality": 88,
}
kwargs = {k: v for k, v in kwargs.items() if k == "filepath" or k in props}
bpy.ops.export_scene.gltf(**kwargs)
print(f"[landmark] wrote {dest} ({os.path.getsize(dest)/1024:.0f} KB), tris={tris}", flush=True)
