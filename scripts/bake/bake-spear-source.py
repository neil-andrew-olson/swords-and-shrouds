"""Cycle-9 Phase A: pick ONE war spear from the low-poly-spear-set (6 variants laid out along X),
join it, assign the lambert1 basecolour/normal material and export a GLB source for bake-weapons.mjs.

Run: blender --background --factory-startup --python scripts/bake/bake-spear-source.py -- \
       --in <dir with Low.fbx> --tex <basecolor.jpg> --normal <normal.jpg> --out <glb> \
       --xmin 0.045 --xmax 0.105
"""
import bpy
import os
import sys

args = sys.argv[sys.argv.index('--') + 1:]
def arg(name, default=None):
    return args[args.index(name) + 1] if name in args else default

src = arg('--in')
tex = arg('--tex')
normal = arg('--normal')
out = arg('--out')
xmin = float(arg('--xmin', '0.045'))
xmax = float(arg('--xmax', '0.105'))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(src, 'Low.fbx'))
bpy.context.view_layer.update()

picked = []
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        continue
    mw = o.matrix_world
    xs = [(mw @ v.co).x for v in o.data.vertices]
    cx = (min(xs) + max(xs)) * 0.5
    if xmin <= cx <= xmax:
        picked.append(o)
print('[spear] picked', [(o.name, len(o.data.polygons)) for o in picked])
if not picked:
    raise SystemExit('no spear meshes in X window')

for o in bpy.context.scene.objects:
    if o not in picked:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action='DESELECT')
for o in picked:
    o.select_set(True)
bpy.context.view_layer.objects.active = picked[0]
bpy.ops.object.join()
spear = bpy.context.view_layer.objects.active
spear.name = 'Spear'

mat = bpy.data.materials.new('SpearMat')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
out_node = nt.nodes.new('ShaderNodeOutputMaterial')
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
base = nt.nodes.new('ShaderNodeTexImage')
base.image = bpy.data.images.load(tex)
nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
if normal and os.path.exists(normal):
    nrm = nt.nodes.new('ShaderNodeTexImage')
    nrm.image = bpy.data.images.load(normal)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
spear.data.materials.clear()
spear.data.materials.append(mat)

bpy.ops.object.select_all(action='DESELECT')
spear.select_set(True)
bpy.context.view_layer.objects.active = spear
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True)
print('[spear] tris', sum(len(p.vertices) - 2 for p in spear.data.polygons),
      'dims', [round(v, 3) for v in spear.dimensions], 'wrote', out,
      os.path.getsize(out) if os.path.exists(out) else 'MISSING')
