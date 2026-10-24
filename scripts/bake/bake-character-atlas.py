"""Bake a procedural armour base-colour atlas onto a character body, using a fresh Smart-UV layout.

The shipped character bodies (hero/ally/fallen/templar/berserker/ranger/survivor) have a broken
UV0 layout (93 % of triangles have zero UV area, so the embedded atlas samples black gutters).
This script:
  1. imports the current GLB,
  2. rebuilds UV0 with Blender's Smart UV Project (charts with margin),
  3. builds a per-character procedural 'armour mixture' material (object-space noise: base steel /
     cloth / leather mix, large-scale wear, fine grain, crevice dirt) driven into an Emission
     shader so an EMIT bake writes pure albedo with no lighting,
  4. bakes it to a 1024x1024 image over the NEW UV layout and saves the raw linear PNG,
  5. exports the mesh (with the new UVs) as a small GLB so the Node post-process can graft the new
     UVs onto the original skin/animation data without re-exporting the rig.

  blender.exe --background --factory-startup --python scripts/bake/bake-character-atlas.py -- \
      --name hero --src <path.glb> --out <dir>
"""
import bpy
import math
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


NAME = arg("--name")
SRC = arg("--src")
OUT = arg("--out")
TEX_SIZE = int(arg("--size", "1024"))
ANGLE = float(arg("--angle", "66"))

# ---------------------------------------------------------------- palettes (sRGB targets)
PALETTES = {
    # base metal, secondary metal/cloth, accent cloth, leather, dirt
    "hero": dict(steel=(0.80, 0.82, 0.85), steel2=(0.44, 0.47, 0.52), cloth=(0.30, 0.33, 0.40),
                 accent=(0.62, 0.55, 0.38), leather=(0.34, 0.25, 0.17), wear=0.55),
    "templar": dict(steel=(0.74, 0.75, 0.77), steel2=(0.50, 0.52, 0.55), cloth=(0.86, 0.84, 0.78),
                    accent=(0.80, 0.62, 0.24), leather=(0.32, 0.23, 0.15), wear=0.50),
    "ally": dict(steel=(0.46, 0.56, 0.70), steel2=(0.26, 0.33, 0.44), cloth=(0.15, 0.20, 0.30),
                 accent=(0.55, 0.58, 0.62), leather=(0.28, 0.22, 0.16), wear=0.55),
    "berserker": dict(steel=(0.52, 0.14, 0.14), steel2=(0.30, 0.09, 0.09), cloth=(0.18, 0.12, 0.10),
                      accent=(0.44, 0.42, 0.42), leather=(0.26, 0.18, 0.12), wear=0.60),
    "ranger": dict(steel=(0.24, 0.36, 0.20), steel2=(0.12, 0.20, 0.11), cloth=(0.20, 0.28, 0.16),
                   accent=(0.42, 0.31, 0.20), leather=(0.34, 0.26, 0.17), wear=0.55),
    "survivor": dict(steel=(0.54, 0.52, 0.47), steel2=(0.35, 0.33, 0.30), cloth=(0.52, 0.44, 0.33),
                     accent=(0.40, 0.34, 0.26), leather=(0.30, 0.24, 0.17), wear=0.65),
    "fallen": dict(steel=(0.30, 0.20, 0.40), steel2=(0.16, 0.11, 0.24), cloth=(0.11, 0.09, 0.15),
                   accent=(0.34, 0.30, 0.36), leather=(0.20, 0.15, 0.12), wear=0.55),
}


def srgb_to_linear(c):
    return tuple((v / 12.92) if v <= 0.04045 else (((v + 0.055) / 1.055) ** 2.4) for v in c)


def rgba(c, a=1.0):
    l = srgb_to_linear(c)
    return (l[0], l[1], l[2], a)


def build_material(pal):
    """Readable 'dressed armour' albedo: metal helmet/torso, cloth mid-body, leather boots, thin
    accent trim bands, subtle wear. Uses Generated coordinates (0..1 over the body bounds) so the
    pattern frequency is independent of the mesh's unit scale (the imported character body is in
    centimetre-like units, where Object-space noise would alias into static)."""
    mat = bpy.data.materials.new("atlas_bake")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    texco = nt.nodes.new("ShaderNodeTexCoord")
    gen = texco.outputs["Generated"]
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(gen, sep.inputs["Vector"])

    def noise(scale, detail=2.0, rough=0.5):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        nt.links.new(gen, n.inputs["Vector"])
        return n.outputs["Fac"]

    def ramp_vals(sock, stops):
        r = nt.nodes.new("ShaderNodeValToRGB")
        r.color_ramp.interpolation = "EASE"
        nt.links.new(sock, r.inputs["Fac"])
        els = r.color_ramp.elements
        while len(els) > len(stops):
            els.remove(els[-1])
        for i, (pos, col) in enumerate(stops):
            e = els[i] if i < len(els) else els.new(pos)
            e.position = pos
            e.color = col if len(col) == 4 else rgba(col)
        return r.outputs["Color"]

    def mix(a, b, fac):
        m = nt.nodes.new("ShaderNodeMixRGB")
        m.blend_type = "MIX"
        if isinstance(fac, (int, float)):
            m.inputs["Fac"].default_value = float(fac)
        else:
            nt.links.new(fac, m.inputs["Fac"])
        if isinstance(a, tuple):
            m.inputs["Color1"].default_value = a if len(a) == 4 else rgba(a)
        else:
            nt.links.new(a, m.inputs["Color1"])
        if isinstance(b, tuple):
            m.inputs["Color2"].default_value = b if len(b) == 4 else rgba(b)
        else:
            nt.links.new(b, m.inputs["Color2"])
        return m.outputs["Color"]

    def mask_between(lo, hi, feather):
        """Smooth 1.0 inside the normalised-height band [lo,hi], 0 outside."""
        a = nt.nodes.new("ShaderNodeMapRange")
        a.interpolation_type = "SMOOTHSTEP"
        nt.links.new(sep.outputs["Z"], a.inputs["Value"])
        a.inputs["From Min"].default_value = lo - feather
        a.inputs["From Max"].default_value = lo
        b = nt.nodes.new("ShaderNodeMapRange")
        b.interpolation_type = "SMOOTHSTEP"
        nt.links.new(sep.outputs["Z"], b.inputs["Value"])
        b.inputs["From Min"].default_value = hi
        b.inputs["From Max"].default_value = hi + feather
        sub = nt.nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.use_clamp = True
        nt.links.new(a.outputs["Result"], sub.inputs[0])
        nt.links.new(b.outputs["Result"], sub.inputs[1])
        return sub.outputs["Value"]

    # 1) torso/helmet metal with broad tonal variation
    metal = ramp_vals(noise(4.0, 2.0, 0.45),
                      [(0.32, pal["steel2"]), (0.62, pal["steel"])])
    col = metal
    # 2) cloth region over the mid/lower body (gambeson, sleeves, surcoat)
    lower = mask_between(0.0, pal.get("cloth_hi", 0.52), 0.06)   # 1 in the cloth band
    mfac = nt.nodes.new("ShaderNodeMixRGB")
    mfac.blend_type = "MULTIPLY"
    mfac.inputs["Fac"].default_value = 1.0
    nt.links.new(lower, mfac.inputs["Color1"])
    nt.links.new(ramp_vals(noise(5.5, 2.0, 0.5), [(0.35, (0.35, 0.35, 0.35, 1.0)), (0.65, (1.0, 1.0, 1.0, 1.0))]), mfac.inputs["Color2"])
    col = mix(col, pal["cloth"], mfac.outputs["Color"])
    # 3) leather boots / straps in the lowest ~22 %
    lower2 = mask_between(0.0, 0.22, 0.05)
    mfac2 = nt.nodes.new("ShaderNodeMixRGB")
    mfac2.blend_type = "MULTIPLY"
    mfac2.inputs["Fac"].default_value = 1.0
    nt.links.new(lower2, mfac2.inputs["Color1"])
    nt.links.new(ramp_vals(noise(9.0, 2.0, 0.5), [(0.4, (0.4, 0.4, 0.4, 1.0)), (0.6, (1.0, 1.0, 1.0, 1.0))]), mfac2.inputs["Color2"])
    col = mix(col, pal["leather"], mfac2.outputs["Color"])
    # 4) accent trim: thin band at the waist + collar highlight
    waist = mask_between(0.28, 0.33, 0.012)
    collar = mask_between(0.66, 0.70, 0.010)
    trim = nt.nodes.new("ShaderNodeMixRGB")
    trim.blend_type = "LIGHTEN"  # max() of the two 0/1 masks
    nt.links.new(waist, trim.inputs["Color1"])
    nt.links.new(collar, trim.inputs["Color2"])
    col = mix(col, pal["accent"], trim.outputs["Color"])
    # 5) subtle wear (broad, low contrast) + fine grain (very small amplitude)
    wear = ramp_vals(noise(12.0, 2.0, 0.5),
                     [(0.25, (0.90, 0.90, 0.90, 1.0)), (0.75, (1.06, 1.06, 1.06, 1.0))])
    m1 = nt.nodes.new("ShaderNodeMixRGB")
    m1.blend_type = "MULTIPLY"
    m1.inputs["Fac"].default_value = pal["wear"]
    nt.links.new(col, m1.inputs["Color1"])
    nt.links.new(wear, m1.inputs["Color2"])
    # 6) gentle vertical grime (feet a little darker) + overall evening tint
    grime = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(sep.outputs["Z"], grime.inputs["Value"])
    grime.inputs["From Min"].default_value = 0.0
    grime.inputs["From Max"].default_value = 1.0
    grime.inputs["To Min"].default_value = 0.82
    grime.inputs["To Max"].default_value = 1.0
    m2 = nt.nodes.new("ShaderNodeMixRGB")
    m2.blend_type = "MULTIPLY"
    m2.inputs["Fac"].default_value = 0.7
    nt.links.new(m1.outputs["Color"], m2.inputs["Color1"])
    nt.links.new(grime.outputs["Result"], m2.inputs["Color2"])
    nt.links.new(m2.outputs["Color"], emit.inputs["Color"])
    return mat


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh imported")
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    print(f"[atlas] {NAME}: mesh {mesh.name} verts={len(mesh.data.vertices)} polys={len(mesh.data.polygons)} "
          f"uv_layers={[u.name for u in mesh.data.uv_layers]}", flush=True)

    # ---- Smart UV Project over a fresh UV layer ----
    for o in bpy.context.scene.objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    while mesh.data.uv_layers:
        mesh.data.uv_layers.remove(mesh.data.uv_layers[0])
    mesh.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.mark_seam(clear=True)
    # unwrap with seams only along sharp edges: UVs stay continuous everywhere else, so the
    # glTF export needs far fewer vertex splits (payload stays near the 450 KB budget)
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(float(arg("--sharp", "52"))))
    bpy.ops.mesh.mark_seam()
    bpy.ops.mesh.select_all(action="SELECT")
    used_seam_unwrap = True
    try:
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.002)
        bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
    except Exception as e:
        print("[atlas] seam unwrap failed, falling back to smart project:", e, flush=True)
        used_seam_unwrap = False
    if not used_seam_unwrap:
        bpy.ops.uv.smart_project(angle_limit=math.radians(ANGLE), island_margin=0.004,
                                 area_weight=0.0, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    # normalise the fresh layout to fill [0,1] (smart_project does not always scale to bounds)
    uvl = mesh.data.uv_layers.active.data
    uv_min = [1e9, 1e9]
    uv_max = [-1e9, -1e9]
    for loop_uv in uvl:
        for i in (0, 1):
            uv_min[i] = min(uv_min[i], loop_uv.uv[i])
            uv_max[i] = max(uv_max[i], loop_uv.uv[i])
    span_u = max(uv_max[0] - uv_min[0], 1e-9)
    span_v = max(uv_max[1] - uv_min[1], 1e-9)
    scale = min(0.96 / span_u, 0.96 / span_v)
    for loop_uv in uvl:
        loop_uv.uv[0] = (loop_uv.uv[0] - uv_min[0]) * scale + 0.02
        loop_uv.uv[1] = (loop_uv.uv[1] - uv_min[1]) * scale + 0.02
    area = 0.0
    for poly in mesh.data.polygons:
        if len(poly.loop_indices) < 3:
            continue
        uvs = [uvl[li].uv for li in poly.loop_indices]
        for i in range(1, len(uvs) - 1):
            a, b, c = uvs[0], uvs[i], uvs[i + 1]
            area += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5
    print(f"[atlas] smart UV coverage after normalise: {area:.3f} (of 1.0), "
          f"uv bbox was ({uv_min[0]:.3f},{uv_min[1]:.3f})..({uv_max[0]:.3f},{uv_max[1]:.3f})", flush=True)

    # ---- procedural material ----
    pal = PALETTES[NAME]
    mat = build_material(pal)
    mesh.data.materials.clear()
    mesh.data.materials.append(mat)

    # ---- bake to a linear (Non-Color) image over the new UVs ----
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    img = bpy.data.images.new(NAME + "_linear", TEX_SIZE, TEX_SIZE, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    nt = mat.node_tree
    texnode = nt.nodes.new("ShaderNodeTexImage")
    texnode.image = img
    for n in nt.nodes:
        n.select = False
    texnode.select = True
    nt.nodes.active = texnode
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.bake(type="EMIT")
    png = os.path.join(OUT, NAME + "_linear.png")
    img.filepath_raw = png
    img.file_format = "PNG"
    img.save()
    print(f"[atlas] baked {png} ({os.path.getsize(png)/1024:.1f} KB)", flush=True)

    # ---- export the mesh with the new UVs (no armature: only UVs are consumed) ----
    model_glb = os.path.join(OUT, NAME + "_uvmesh.glb")
    for o in bpy.context.scene.objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    # strip the armature modifier so the exported mesh is the bind-pose body
    for m in list(mesh.modifiers):
        mesh.modifiers.remove(m)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {
        "filepath": model_glb, "export_format": "GLB", "use_selection": True,
        "export_yup": True, "export_apply": False, "export_animations": False,
        "export_skins": False, "export_materials": "NONE", "export_texcoords": True,
        "export_normals": True, "export_draco_mesh_compression_enable": False,
    }
    kwargs = {k: v for k, v in kwargs.items() if k == "filepath" or k in props}
    bpy.ops.export_scene.gltf(**kwargs)
    print(f"[atlas] exported UV mesh {model_glb} ({os.path.getsize(model_glb)/1024:.1f} KB)", flush=True)


main()
