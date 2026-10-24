"""Blender 5.2 headless baker for the ruins / keeps / props (task-2).

blender.exe --background --factory-startup --python scripts/bake/bake_assets_blender.py -- [--only name,...]

Per asset: import (FBX or GLB) -> bake transforms -> drop helper meshes -> join -> uniform
scale to a real-world size -> origin at ground centre (min.z = 0, bbox centre x/y = 0) ->
decimate to the triangle budget -> simplify materials (drop the metallic map on scans) ->
export an uncompressed GLB to temp_sketchlab/bake/ -> render front/side previews.
Texture re-encoding + gzip happen in scripts/bake/postprocess-glb.mjs.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab"
OUT = os.path.join(SCRATCH, "bake")
WAREHOUSE = r"C:\Users\neil\Desktop\AIprojects\swords\sketchlab"

TRI = os.path.join(SCRATCH, "collapsed-gothic-chapel-ruin")
AQU = os.path.join(SCRATCH, "ruined-aqueduct-arches-segment")
BRG = os.path.join(SCRATCH, "ruined-stone-bridge-broken-arch")
CRT = os.path.join(SCRATCH, "overgrown-courtyard-patio-ruin")
WEL = os.path.join(SCRATCH, "medieval-stone-well-game-prop")


def tri_fbx(folder):
    for root, _dirs, files in os.walk(folder):
        for f in files:
            if f.lower().endswith(".fbx"):
                return os.path.join(root, f)
    raise FileNotFoundError(folder)


ASSETS = {
    # --- ruins: scan of a ruined structure, normalised to a real-world height ---
    "chapel_ruin": dict(src=tri_fbx(TRI), budget=14000, scale_axis=2, scale_value=7.0, kind="scan"),
    "aqueduct_ruin": dict(src=tri_fbx(AQU), budget=14000, scale_axis=2, scale_value=6.0, kind="scan"),
    "bridge_ruin": dict(src=tri_fbx(BRG), budget=14000, scale_axis=2, scale_value=4.5, kind="scan"),
    "courtyard_ruin": dict(src=tri_fbx(CRT), budget=14000, scale_axis=2, scale_value=2.4, kind="scan"),
    # --- stone strongholds ---
    # medieval-fortress-kit/source/fortress.fbx is ASCII FBX (Blender cannot import it);
    # modular-castle/source/MOD_castle.fbx is the spec's documented alternative.
    "fortress_keep": dict(src=os.path.join(SCRATCH, "modular-castle", "source", "MOD_castle.fbx"),
                          budget=14000, scale_axis=2, scale_value=8.0, kind="fbx"),
    "castle_tower": dict(src=os.path.join(WAREHOUSE, "vashlovani_tower.glb"),
                         budget=14000, scale_axis=2, scale_value=9.0, kind="glb"),
    # --- props ---
    "well": dict(src=tri_fbx(WEL), budget=6000, scale_axis=0, scale_value=1.5, kind="scan"),
    "chest": dict(src=os.path.join(WAREHOUSE, "medieval_era_chest.glb"),
                  budget=6000, scale_axis=0, scale_value=1.1, kind="glb"),
    "bench": dict(kind="bench", budget=6000),
    "rock_cluster": dict(src=os.path.join(SCRATCH, "stones-and-grass", "source", "stones_and_grass.fbx"),
                         budget=6000, scale_axis=0, scale_value=1.7, kind="rocks",
                         drop_meshes_over=100000),
}


def log(*a):
    print("[bake]", *a, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def import_source(path):
    reset_scene()
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    objs = mesh_objects()
    if not objs:
        raise RuntimeError("no mesh objects imported from " + path)
    for o in objs:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    return objs


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def bounds(objs):
    lo = Vector((1e30, 1e30, 1e30))
    hi = Vector((-1e30, -1e30, -1e30))
    for o in objs:
        for v in o.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    return lo, hi


def drop_big_objects(objs, max_tris):
    kept = [o for o in objs if sum(len(p.vertices) - 2 for p in o.data.polygons) <= max_tris]
    dropped = [o for o in objs if o not in kept]
    for o in dropped:
        log(f"  dropping helper mesh {o.name!r} "
            f"({sum(len(p.vertices) - 2 for p in o.data.polygons)} tris)")
        bpy.data.objects.remove(o, do_unlink=True)
    return kept


def join_objects(objs):
    objs = [o for o in objs if len(o.data.polygons)]
    if len(objs) == 1:
        return objs
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def transform_objs(objs, matrix):
    for o in objs:
        o.data.transform(matrix)


def normalise_scale(objs, axis, value):
    lo, hi = bounds(objs)
    extent = hi[axis] - lo[axis]
    if extent <= 0:
        raise RuntimeError("degenerate bounds")
    s = value / extent
    transform_objs(objs, Matrix.Scale(s, 4))
    log(f"  scaled by {s:.5f} so {'xyz'[axis]} extent = {value} m")
    return s


def normalise_origin(objs):
    lo, hi = bounds(objs)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    transform_objs(objs, Matrix.Translation(-centre))
    lo, hi = bounds(objs)
    log(f"  origin at ground centre; bbox min={tuple(round(v,3) for v in lo)} "
        f"max={tuple(round(v,3) for v in hi)} size={tuple(round(v,3) for v in (hi-lo))}")
    return lo, hi


def decimate(objs, budget):
    total = tri_count(objs)
    if total <= budget:
        log(f"  no decimation needed ({total} tris)")
        return total
    ratio = max(0.0005, min(1.0, budget / total * 0.99))
    guard = 0
    while total > budget and guard < 5:
        guard += 1
        r = max(0.0005, min(1.0, budget / total * (0.99 if guard == 1 else 0.96)))
        for o in objs:
            mod = o.modifiers.new("dec", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = r
            mod.use_collapse_triangulate = True
            dg = bpy.context.evaluated_depsgraph_get()
            ev = o.evaluated_get(dg)
            new_mesh = bpy.data.meshes.new_from_object(ev)
            o.modifiers.clear()
            old = o.data
            o.data = new_mesh
            if old.users == 0:
                bpy.data.meshes.remove(old)
        total = tri_count(objs)
        log(f"  decimate pass {guard}: ratio {r:.5f} -> {total} tris")
    return total


def image_colours(nt, img_node):
    """Return the colour space an image needs, based on where its colour output is used."""
    stack = [(img_node.outputs["Color"], 0)]
    while stack:
        sock, depth = stack.pop()
        for link in sock.links:
            node, to_sock = link.to_node, link.to_socket
            if node.type == "BSDF_PRINCIPLED":
                return "sRGB" if to_sock.name == "Base Color" else "Non-Color"
            if node.type == "NORMAL_MAP" or node.type == "BUMP":
                return "Non-Color"
            if depth < 3:
                for out in node.outputs:
                    stack.append((out, depth + 1))
    return "Non-Color"


def simplify_materials(objs, drop_metallic=True):
    for o in objs:
        for m in o.data.materials:
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if principled is None:
                continue
            if drop_metallic:
                sock = principled.inputs.get("Metallic")
                if sock is not None:
                    for link in list(sock.links):
                        nt.links.remove(link)
                    sock.default_value = 0.0
            for n in nt.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    cs = image_colours(nt, n)
                    try:
                        n.image.colorspace_settings.name = cs
                    except Exception:
                        pass
            # keep everything matte-ish stone
            rough = principled.inputs.get("Roughness")
            if rough is not None and not rough.links:
                rough.default_value = max(rough.default_value, 0.75)


def make_material(name, basecolor_path, normal_path=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    principled = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base = bpy.data.images.load(basecolor_path, check_existing=True)
    base.colorspace_settings.name = "sRGB"
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = base
    nt.links.new(node.outputs["Color"], principled.inputs["Base Color"])
    if normal_path and os.path.exists(normal_path):
        nimg = bpy.data.images.load(normal_path, check_existing=True)
        nimg.colorspace_settings.name = "Non-Color"
        nnode = nt.nodes.new("ShaderNodeTexImage")
        nnode.image = nimg
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nnode.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], principled.inputs["Normal"])
    return mat


def box_project_uv(obj, scale):
    """World-space box projection so every face samples the tile at `scale` metres/repeat."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    for poly in me.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if axis == 0:
                u, v = co.y, co.z
            elif axis == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            uv[li].uv = (u / scale, v / scale)


def add_box(bm, center, size):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    verts = []
    for dz in (-1, 1):
        for dy in (-1, 1):
            for dx in (-1, 1):
                verts.append(bm.verts.new((cx + dx * sx, cy + dy * sy, cz + dz * sz)))
    # index: 0..3 bottom (dz=-1): (dx,dy) = (-,-),(-,+),(+,-),(+,+); 4..7 top
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    # bottom / top winding needs care: build both orders and fix with recalc normals
    for q in quads:
        try:
            bm.faces.new([verts[i] for i in q])
        except ValueError:
            pass
    return verts


def build_bench():
    reset_scene()
    bm = bmesh.new()
    # stone slab + two block legs, 1.6 m long, 0.48 m tall
    add_box(bm, (0, 0, 0.42), (1.60, 0.44, 0.12))
    add_box(bm, (-0.62, 0, 0.18), (0.26, 0.38, 0.36))
    add_box(bm, (0.62, 0, 0.18), (0.26, 0.38, 0.36))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("bench")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("bench", me)
    bpy.context.scene.collection.objects.link(obj)
    tex_dir = os.path.join(SCRATCH, "bench")
    mat = make_material("bench_stone", os.path.join(tex_dir, "bench_basecolor.png"),
                        os.path.join(tex_dir, "bench_normal.png"))
    me.materials.append(mat)
    box_project_uv(obj, scale=0.8)
    log(f"  modelled bench: {tri_count([obj])} tris, {len(me.vertices)} verts")
    return [obj]


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {
        "filepath": path, "export_format": "GLB", "export_yup": True, "export_apply": True,
        "export_animations": False, "export_skins": False, "export_morph": False,
        "export_draco_mesh_compression_enable": False, "export_materials": "EXPORT",
        "export_image_format": "AUTO", "export_cameras": False, "export_lights": False,
        "use_selection": False, "export_extras": False, "export_texcoords": True,
        "export_normals": True, "export_tangents": False,
    }
    kwargs = {k: v for k, v in kwargs.items() if k == "filepath" or k in props}
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"  exported {path} ({os.path.getsize(path)/1024:.1f} KB)")


def render_previews(name, objs):
    lo, hi = bounds(objs)
    centre = (lo + hi) / 2
    size = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_shadows = True
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.3
    cam_data.clip_start = max(0.01, size * 0.01)
    cam_data.clip_end = size * 40 + 1000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    outdir = os.path.join(SCRATCH, "asset_previews")
    os.makedirs(outdir, exist_ok=True)
    for label, off in (("front", Vector((0, -size * 3, 0))), ("side", Vector((size * 3, 0, 0)))):
        cam.location = centre + off
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"{name}_{label}.png")
        bpy.ops.render.render(write_still=True)
    log("  previews rendered")


def bake(name, cfg):
    log("=" * 8, name)
    kind = cfg.get("kind", "scan")
    if kind == "bench":
        objs = build_bench()
    else:
        objs = import_source(cfg["src"])
        log(f"  imported {len(objs)} objects, {tri_count(objs)} tris")
        if cfg.get("drop_meshes_over"):
            objs = drop_big_objects(objs, cfg["drop_meshes_over"])
        objs = join_objects(objs)
        if cfg.get("scale_axis") is not None:
            normalise_scale(objs, cfg["scale_axis"], cfg["scale_value"])
        if kind == "scan":
            simplify_materials(objs, drop_metallic=True)
    lo, hi = normalise_origin(objs)
    if kind != "bench":
        decimate(objs, cfg["budget"])
    lo, hi = bounds(objs)
    log(f"  final bbox min={tuple(round(v,3) for v in lo)} max={tuple(round(v,3) for v in hi)} "
        f"size={tuple(round(v,3) for v in (hi-lo))} tris={tri_count(objs)}")
    export_glb(os.path.join(OUT, name + ".glb"))
    render_previews(name, objs)
    return tri_count(objs)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = argv[argv.index("--only") + 1].split(",")
    os.makedirs(OUT, exist_ok=True)
    for name, cfg in ASSETS.items():
        if only and name not in only:
            continue
        bake(name, cfg)


main()
