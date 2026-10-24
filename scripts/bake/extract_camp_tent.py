"""Extract the tent/camp-shelter from the top-down medieval camp scene and bake it as a prop.

blender.exe --background --factory-startup --python scripts/bake/extract_camp_tent.py

The camp GLB is one big low-poly scene (117,798 tris, 8,211 loose parts: a tarp canopy on four
poles plus rocks, crates, logs, a cart wheel...). The shelter occupies the left third of the
scene and is the only thing reaching above ~0.7 m in that footprint, so it is isolated by
connected-component filtering: keep components whose centre is inside the shelter footprint AND
whose top is above the ground clutter. The result is scaled to 3 m, grounded at the origin,
decimated to the 6,000-tri prop budget and exported to temp_sketchlab/bake/camp_tent.glb.
"""
import bpy
import bmesh
import os
from mathutils import Matrix, Vector

SCRATCH = r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab"
SRC = r"C:\Users\neil\Desktop\AIprojects\swords\sketchlab\top_down_low_poly_medieval_camp.glb"
OUT = os.path.join(SCRATCH, "bake", "camp_tent.glb")

# shelter footprint in Blender world space (camp scene units; ~100 units per metre)
X_MIN, X_MAX = 1820.0, 2440.0
Z_TOP_MIN = 70.0   # ground clutter (crates/jugs) tops out well below this
TARGET_HEIGHT = 3.0
BUDGET = 6000


def log(*a):
    print("[tent]", *a, flush=True)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bounds(objs):
    lo = Vector((1e30, 1e30, 1e30))
    hi = Vector((-1e30, -1e30, -1e30))
    for o in objs:
        for v in o.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    return lo, hi


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {
        "filepath": path, "export_format": "GLB", "export_yup": True, "export_apply": True,
        "export_animations": False, "export_skins": False, "export_morph": False,
        "export_draco_mesh_compression_enable": False, "export_materials": "EXPORT",
        "export_image_format": "AUTO", "export_cameras": False, "export_lights": False,
        "use_selection": False, "export_extras": False, "export_texcoords": True,
        "export_normals": True, "export_tangents": False, "export_vertex_color": "NONE",
    }
    kwargs = {k: v for k, v in kwargs.items() if k == "filepath" or k in props}
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"exported {path} ({os.path.getsize(path)/1024:.1f} KB)")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    log(f"imported {len(objs)} objects, {sum(tri_count(o) for o in objs)} tris")

    # join everything, then split into connected components via union-find over edges
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    parent = list(range(len(bm.verts)))

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    for e in bm.edges:
        ra, rb = find(e.verts[0].index), find(e.verts[1].index)
        if ra != rb:
            parent[ra] = rb
    comps = {}
    for v in bm.verts:
        comps.setdefault(find(v.index), []).append(v.index)
    log(f"connected components: {len(comps)}")

    # per-component bounds -> keep the shelter components
    co = [v.co.copy() for v in bm.verts]
    comp_faces = {}
    for f in bm.faces:
        root = find(f.verts[0].index)
        comp_faces[root] = comp_faces.get(root, 0) + 1
    keep = {}
    kept_tris = 0
    for root, idxs in comps.items():
        xs = [co[i].x for i in idxs]
        zs = [co[i].z for i in idxs]
        cx = (min(xs) + max(xs)) / 2
        zmax = max(zs)
        ok = (X_MIN <= cx <= X_MAX) and (zmax > Z_TOP_MIN)
        keep[root] = ok
        if ok:
            kept_tris += comp_faces.get(root, 0)
    doomed = [f for f in bm.faces if not keep[find(f.verts[0].index)]]
    log(f"deleting {len(doomed)} faces outside the shelter footprint")
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    # the camp's boulder pile shares the same footprint corner: drop its material's faces
    rock_slots = {i for i, m in enumerate(obj.data.materials)
                  if m is not None and "rock" in m.name.lower()}
    if rock_slots:
        rock_faces = [f for f in bm.faces if f.material_index in rock_slots]
        log(f"deleting {len(rock_faces)} rock faces (material slots {sorted(rock_slots)})")
        bmesh.ops.delete(bm, geom=rock_faces, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    log(f"tent mesh: {tri_count(obj)} tris")
    # remove any now-unused material slots so only the shelter atlas is embedded
    for i in reversed(range(len(obj.data.materials))):
        if i not in {p.material_index for p in obj.data.polygons}:
            obj.data.materials.pop(index=i)

    # scale to 3 m tall and ground-centre the origin
    lo, hi = bounds([obj])
    height = hi.z - lo.z
    s = TARGET_HEIGHT / height
    obj.data.transform(Matrix.Scale(s, 4))
    lo, hi = bounds([obj])
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    obj.data.transform(Matrix.Translation(-centre))
    lo, hi = bounds([obj])
    log(f"scaled x{s:.5f}; bbox min={tuple(round(v,3) for v in lo)} "
        f"max={tuple(round(v,3) for v in hi)} size={tuple(round(hi[i]-lo[i],3) for i in range(3))}")

    # neutralise the camp's emissive/vertex-colour material setup: keep base colour + normal
    for mat in list(obj.data.materials):
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if principled is None:
            continue
        for name, value in (("Emissive Color", (0.0, 0.0, 0.0, 1.0)), ("Emission Color", (0.0, 0.0, 0.0, 1.0))):
            sock = principled.inputs.get(name)
            if sock is not None:
                for link in list(sock.links):
                    nt.links.remove(link)
                sock.default_value = value
        for name in ("Emission Strength", "Emissive Strength"):
            sock = principled.inputs.get(name)
            if sock is not None:
                sock.default_value = 0.0
        sock = principled.inputs.get("Metallic")
        if sock is not None:
            for link in list(sock.links):
                nt.links.remove(link)
            sock.default_value = 0.0
        sock = principled.inputs.get("Roughness")
        if sock is not None and not sock.links:
            sock.default_value = 0.85
        for n in nt.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                # any non-colour data map must stay linear
                if n.label.lower().startswith("normal") or "normal" in n.image.name.lower():
                    n.image.colorspace_settings.name = "Non-Color"
    # drop vertex colours so the shared camp atlas is not multiplied twice in engine
    for attr in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(attr)

    # decimate to the prop budget (with an explicit depsgraph update per pass)
    total = tri_count(obj)
    guard = 0
    while total > BUDGET and guard < 5:
        guard += 1
        ratio = max(0.01, min(1.0, BUDGET / total * (0.99 if guard == 1 else 0.96)))
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        obj.modifiers.clear()
        old = obj.data
        obj.data = new_mesh
        if old.users == 0:
            bpy.data.meshes.remove(old)
        total = tri_count(obj)
        log(f"decimate pass {guard}: ratio {ratio:.4f} -> {total} tris")
        if guard > 1 and total < BUDGET * 0.75:
            break

    lo, hi = bounds([obj])
    log(f"final tris={tri_count(obj)} bbox min={tuple(round(v,3) for v in lo)} "
        f"max={tuple(round(v,3) for v in hi)} size={tuple(round(hi[i]-lo[i],3) for i in range(3))}")
    export_glb(OUT)

    # preview
    centre = (lo + hi) / 2
    size = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.25
    cam_data.clip_start = 0.01
    cam_data.clip_end = 1000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    outdir = os.path.join(SCRATCH, "asset_previews")
    os.makedirs(outdir, exist_ok=True)
    for label, off in (("front", Vector((0, -size * 4, size * 0.15))), ("side", Vector((size * 4, 0, size * 0.15)))):
        cam.location = centre + off
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(outdir, f"camp_tent_{label}.png")
        bpy.ops.render.render(write_still=True)
        log("wrote", scene.render.filepath)


main()
