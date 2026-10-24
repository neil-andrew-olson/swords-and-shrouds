"""Blender 5.2 headless weapon baker for Swords & Shrouds (asset-forge / task-1).

Run:  blender.exe --background --python scripts/bake/bake_weapons_blender.py -- [--only rapier]

For each weapon it imports the warehouse GLB, crops to a single weapon when the source is a
display set (halabardy.glb holds two halberds + flat boards), joins parts, rotates so the
blade/head points +Z in Blender (= +Y in glTF), puts the grip at the local origin with the
handle ~20 % of the height below it, decimates to the triangle budget, exports an
uncompressed GLB to temp_sketchlab/bake/ and renders front/side previews for inspection.
Texture re-encoding + gzip happen afterwards in scripts/bake/postprocess-glb.mjs.
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector, Matrix

WAREHOUSE = r"C:\Users\neil\Desktop\AIprojects\swords\sketchlab"
SCRATCH = r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab"
OUT = os.path.join(SCRATCH, "bake")

WEAPONS = {
    "rapier": {
        "src": "spanish_rapier.glb",
        "budget": 3400,
        # blade/pommel are parent empties around the mesh children (Spanish names)
        "tip_hints": ["hoja"],
        "butt_hints": ["pomo", "virola"],
        "crop_box": None,
    },
    "halberd": {
        # NOTE: spec's halabardy.glb is a two-rack *display set* of ~10 polearms whose heads
        # interpenetrate (plus flat boards); a single weapon cannot be cropped cleanly out of
        # it. Falling back to the warehouse's single-model viking_halberd.glb (1,912 tris,
        # embedded PBR textures) — reported as a deviation to the Lead.
        "src": "viking_halberd.glb",
        "budget": 3400,
        "mode": "pca",
        "tip_hints": None,
        "butt_hints": None,
        "crop_box": None,
    },
    "dane_axe": {
        "src": "great_dane_axe.glb",
        "budget": 1200,
        "tip_hints": ["head"],
        "butt_hints": ["handle"],
        "crop_box": None,
    },
}


def log(*a):
    print("[bake]", *a, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    objs = mesh_objects()
    if not objs:
        raise RuntimeError("no mesh objects imported from " + path)
    # bake object transforms into mesh data so local == world
    for o in objs:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    return objs


def world_bounds(objs):
    lo = Vector((1e30, 1e30, 1e30))
    hi = Vector((-1e30, -1e30, -1e30))
    for o in objs:
        for v in o.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    return lo, hi


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def part_bounds(objs):
    """[{name, parent, center}] using the imported parent empty names."""
    out = []
    for o in objs:
        lo, hi = world_bounds([o])
        names = []
        p = o.parent
        while p is not None and len(names) < 4:
            names.append(p.name)
            p = p.parent
        out.append({"name": o.name, "chain": "/".join(names), "center": (lo + hi) / 2})
    return out


def pca_head_direction(objs):
    """Principal axis of the vertices; sign chosen by greater cross-sectional spread
    (the head/blade end is wider than the butt end)."""
    import numpy as np
    pts = []
    for o in objs:
        for v in o.data.vertices:
            pts.append(v.co[:])
    a = np.array(pts)
    centre = a.mean(axis=0)
    cov = np.cov((a - centre).T)
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, int(np.argmax(vals))]
    axis = axis / np.linalg.norm(axis)
    t = (a - centre) @ axis
    lo, hi = float(t.min()), float(t.max())
    span = hi - lo
    # cross-sectional spread at each end (outer 15 %)
    ends = []
    for sign, cond in ((1, t > hi - 0.15 * span), (-1, t < lo + 0.15 * span)):
        sel = a[cond] - centre
        if len(sel) < 3:
            ends.append(0.0)
            continue
        proj = np.outer(sel @ axis, axis)
        radial = sel - proj
        ends.append(float(np.mean(np.linalg.norm(radial, axis=1))))
    log(f"  pca spans {lo:.2f}..{hi:.2f} endSpread +={ends[0]:.2f} -={ends[1]:.2f}")
    if ends[0] < ends[1]:
        axis = -axis
    return Vector(axis.tolist())


def crop_objects(objs, box):
    """Delete faces whose centre lies beyond box['max'] along box['axis']."""
    axis = box["axis"]
    limit = box["max"]
    kept = 0
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = [f for f in bm.faces if f.calc_center_median()[axis] > limit]
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        kept += len(o.data.polygons)
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


def rotate_objects(objs, quat):
    R = quat.to_matrix().to_4x4()
    for o in objs:
        o.data.transform(R)


def translate_objects(objs, vec):
    for o in objs:
        o.data.transform(Matrix.Translation(vec))


def decimate(objs, budget):
    total = tri_count(objs)
    if total <= budget:
        log(f"  no decimation needed ({total} tris)")
        return total
    ratio = max(0.01, min(1.0, budget / total * 0.99))
    for o in objs:
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        new_mesh = bpy.data.meshes.new_from_object(ev)
        o.modifiers.clear()
        o.data = new_mesh
    total = tri_count(objs)
    log(f"  decimated to {total} tris (ratio {ratio:.3f})")
    # second pass if still over budget (decimate is approximate on small parts)
    guard = 0
    while total > budget and guard < 4:
        guard += 1
        r2 = max(0.01, min(1.0, budget / total * 0.97))
        for o in objs:
            mod = o.modifiers.new("dec", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = r2
            mod.use_collapse_triangulate = True
            dg = bpy.context.evaluated_depsgraph_get()
            ev = o.evaluated_get(dg)
            new_mesh = bpy.data.meshes.new_from_object(ev)
            o.modifiers.clear()
            o.data = new_mesh
        total = tri_count(objs)
        log(f"  pass {guard}: {total} tris")
    return total


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    all_props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {
        "filepath": path,
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": True,
        "export_animations": False,
        "export_skins": False,
        "export_morph": False,
        "export_draco_mesh_compression_enable": False,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
        "export_cameras": False,
        "export_lights": False,
        "use_selection": False,
        "export_extras": False,
        "export_texcoords": True,
        "export_normals": True,
        "export_tangents": True,
    }
    kwargs = {k: v for k, v in kwargs.items() if k == "filepath" or k in all_props}
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"  exported {path} ({os.path.getsize(path)/1024:.1f} KB)")


def render_previews(name, objs):
    lo, hi = world_bounds(objs)
    center = (lo + hi) / 2
    size = max(hi.z - lo.z, 1e-3)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.25
    cam_data.clip_start = max(0.01, size * 0.01)
    cam_data.clip_end = size * 40 + 1000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    os.makedirs(os.path.join(SCRATCH, "weapon_previews"), exist_ok=True)
    for label, offset in (("front", Vector((0, -size * 3, 0))), ("side", Vector((size * 3, 0, 0)))):
        cam.location = center + offset
        direction = center - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(SCRATCH, "weapon_previews", f"{name}_{label}.png")
        bpy.ops.render.render(write_still=True)
    log("  previews rendered")


def bake(name, cfg):
    log("=" * 8, name)
    reset_scene()
    objs = import_glb(os.path.join(WAREHOUSE, cfg["src"]))
    log(f"  imported {len(objs)} objects, {tri_count(objs)} tris")
    lo, hi = world_bounds(objs)
    log(f"  source bbox min={tuple(round(v,2) for v in lo)} max={tuple(round(v,2) for v in hi)}")

    if cfg.get("crop_box"):
        kept = crop_objects(objs, cfg["crop_box"])
        objs = [o for o in objs if len(o.data.polygons)]
        lo, hi = world_bounds(objs)
        log(f"  cropped to {kept} faces, bbox min={tuple(round(v,2) for v in lo)} max={tuple(round(v,2) for v in hi)}")

    # head/blade direction in Blender world space
    tip_dir = None
    if cfg.get("mode") == "pca":
        tip_dir = pca_head_direction(objs)
        log(f"  PCA head direction: {tuple(round(c, 2) for c in tip_dir)}")
    elif cfg.get("force_tip"):
        v = cfg["force_tip"]
        # glTF (x,y,z) -> Blender (x,-z,y)
        tip_dir = Vector((v[0], -v[2], v[1]))
        log(f"  head direction (declared): {tuple(round(c,2) for c in tip_dir)}")
    else:
        parts = part_bounds(objs)
        def centroid(hints):
            sel = [p for p in parts if any(h in p["chain"].lower() for h in hints)]
            if not sel:
                raise RuntimeError(f"no parts matching {hints}; chains={[p['chain'] for p in parts]}")
            c = Vector((0, 0, 0))
            for p in sel:
                c += p["center"]
            return c / len(sel), [p["chain"] for p in sel]
        tip, tip_names = centroid(cfg["tip_hints"])
        butt, butt_names = centroid(cfg["butt_hints"])
        tip_dir = tip - butt
        log(f"  tip parts {tip_names[:4]} butt parts {butt_names[:4]} -> dir {tuple(round(c,2) for c in tip_dir)}")

    quat = tip_dir.normalized().rotation_difference(Vector((0.0, 0.0, 1.0)))
    rotate_objects(objs, quat)
    lo, hi = world_bounds(objs)
    log(f"  aligned bbox min={tuple(round(v,2) for v in lo)} max={tuple(round(v,2) for v in hi)}")

    height = hi.z - lo.z
    # centre x/y on the bottom-quarter (handle) centroid, put z=0 there with 20% below
    zcut = lo.z + 0.25 * height
    sx = sy = n = 0
    for o in objs:
        step = max(1, len(o.data.vertices) // 20000)
        for i, v in enumerate(o.data.vertices):
            if i % step:
                continue
            if v.co.z <= zcut:
                sx += v.co.x
                sy += v.co.y
                n += 1
    cx = sx / n if n else (lo.x + hi.x) / 2
    cy = sy / n if n else (lo.y + hi.y) / 2
    translate_objects(objs, Vector((-cx, -cy, -0.20 * height - lo.z)))
    lo, hi = world_bounds(objs)
    log(f"  grip aligned: height={height:.3f} min.z={lo.z:.3f} ({lo.z/height*100:.1f}%) max.z={hi.z:.3f}")

    objs = join_objects(objs)
    total = decimate(objs, cfg["budget"])
    lo, hi = world_bounds(objs)
    log(f"  final bbox min={tuple(round(v,3) for v in lo)} max={tuple(round(v,3) for v in hi)} tris={total}")

    export_glb(os.path.join(OUT, name + ".glb"))
    render_previews(name, objs)
    return total


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = argv[argv.index("--only") + 1].split(",")
    for name, cfg in WEAPONS.items():
        if only and name not in only:
            continue
        bake(name, cfg)


main()
