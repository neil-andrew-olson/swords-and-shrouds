"""Cycle-2 character map bake: albedo (with material detail), roughness, metallic, tangent-space
NORMAL and AO maps baked over the character's EXISTING UV layout (cycle-1 charts, so no geometry or
rig change is involved — only the material/texture set is replaced later in Node).

Per body it bakes:
  <name>_albedo_linear.png   1024  (EMIT of the albedo graph, linear data)
  <name>_roughness.png        512  (EMIT of the roughness graph, linear)
  <name>_metallic.png         512  (EMIT of the metal mask, linear)
  <name>_normal.png           512  (Cycles NORMAL bake incl. procedural bump = tangent-space)
  <name>_ao.png               512  (Cycles AO bake)

  blender.exe --background --factory-startup --python scripts/bake/bake-character-maps.py -- \
      --name hero --src <glb> --out <dir>
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
OUT = arg("--out")
ALBEDO_SIZE = int(arg("--albedo", "1024"))
MAP_SIZE = int(arg("--map", "512"))

PALETTES = {
    "hero": dict(steel=(0.72, 0.74, 0.78), steel2=(0.40, 0.42, 0.47), cloth=(0.28, 0.31, 0.38),
                 accent=(0.56, 0.48, 0.32), leather=(0.30, 0.22, 0.15), wear=0.5, chain=0.55),
    "templar": dict(steel=(0.68, 0.69, 0.71), steel2=(0.45, 0.46, 0.49), cloth=(0.76, 0.73, 0.66),
                    accent=(0.72, 0.56, 0.22), leather=(0.29, 0.21, 0.14), wear=0.45, chain=0.35),
    "ally": dict(steel=(0.40, 0.49, 0.62), steel2=(0.23, 0.29, 0.38), cloth=(0.15, 0.19, 0.27),
                 accent=(0.48, 0.50, 0.53), leather=(0.25, 0.19, 0.13), wear=0.5, chain=0.5),
    "berserker": dict(steel=(0.47, 0.13, 0.13), steel2=(0.27, 0.08, 0.08), cloth=(0.17, 0.11, 0.09),
                      accent=(0.40, 0.38, 0.38), leather=(0.23, 0.17, 0.11), wear=0.55, chain=0.45),
    "ranger": dict(steel=(0.22, 0.32, 0.18), steel2=(0.12, 0.18, 0.10), cloth=(0.18, 0.25, 0.15),
                   accent=(0.38, 0.28, 0.18), leather=(0.30, 0.23, 0.15), wear=0.55, chain=0.2),
    "survivor": dict(steel=(0.47, 0.45, 0.41), steel2=(0.31, 0.29, 0.26), cloth=(0.46, 0.39, 0.29),
                     accent=(0.35, 0.30, 0.22), leather=(0.27, 0.21, 0.14), wear=0.6, chain=0.15),
    "fallen": dict(steel=(0.27, 0.18, 0.36), steel2=(0.15, 0.10, 0.22), cloth=(0.10, 0.08, 0.14),
                   accent=(0.30, 0.26, 0.32), leather=(0.18, 0.13, 0.11), wear=0.5, chain=0.5),
}


def srgb_to_linear(c):
    return tuple((v / 12.92) if v <= 0.04045 else (((v + 0.055) / 1.055) ** 2.4) for v in c)


def rgba(c, a=1.0):
    l = srgb_to_linear(c)
    return (l[0], l[1], l[2], a)


def build_material(pal):
    mat = bpy.data.materials.new("char_bake")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    principled = nt.nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Base Color"].default_value = (0.2, 0.2, 0.2, 1.0)
    principled.inputs["Roughness"].default_value = 0.7
    principled.inputs["Metallic"].default_value = 0.0
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    texco = nt.nodes.new("ShaderNodeTexCoord")
    gen = texco.outputs["Generated"]
    uv = texco.outputs["UV"]
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(gen, sep.inputs["Vector"])

    def noise(vec, scale, detail=2.0, rough=0.5, distort=0.0):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        if "Distortion" in n.inputs:
            n.inputs["Distortion"].default_value = distort
        nt.links.new(vec, n.inputs["Vector"])
        return n.outputs["Fac"]

    def voronoi(vec, scale, feature="DISTANCE_TO_EDGE"):
        v = nt.nodes.new("ShaderNodeTexVoronoi")
        v.feature = feature
        v.inputs["Scale"].default_value = scale
        nt.links.new(vec, v.inputs["Vector"])
        return v.outputs["Distance"]

    def ramp(sock, lo, hi, smooth=True):
        r = nt.nodes.new("ShaderNodeValToRGB")
        r.color_ramp.interpolation = "EASE" if smooth else "LINEAR"
        nt.links.new(sock, r.inputs["Fac"])
        r.color_ramp.elements[0].position = lo
        r.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
        r.color_ramp.elements[1].position = hi
        r.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
        return r.outputs["Color"]

    def mixc(a, b, fac):
        m = nt.nodes.new("ShaderNodeMixRGB")
        m.blend_type = "MIX"
        if isinstance(fac, (int, float)):
            m.inputs["Fac"].default_value = float(fac)
        else:
            nt.links.new(fac, m.inputs["Fac"])
        for sock, val in (("Color1", a), ("Color2", b)):
            if isinstance(val, tuple):
                m.inputs[sock].default_value = val if len(val) == 4 else rgba(val)
            else:
                nt.links.new(val, m.inputs[sock])
        return m.outputs["Color"]

    def mulc(a, b, fac=1.0):
        m = nt.nodes.new("ShaderNodeMixRGB")
        m.blend_type = "MULTIPLY"
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

    def math(op, a, b=None, clamp=True):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        if isinstance(a, (int, float)):
            n.inputs[0].default_value = float(a)
        else:
            nt.links.new(a, n.inputs[0])
        if b is not None:
            if isinstance(b, (int, float)):
                n.inputs[1].default_value = float(b)
            else:
                nt.links.new(b, n.inputs[1])
        return n.outputs["Value"]

    # ---- material regions (same topology as cycle-1, but with detail) ----
    cloth_mask = mask_between(0.0, 0.52, 0.05)
    leather_mask = mask_between(0.0, 0.22, 0.045)
    metal_mask = math("SUBTRACT", 1.0, cloth_mask)

    # plate cells: seams dark + rivets at cell centres
    plate_edge = ramp(voronoi(gen, 15.0, "DISTANCE_TO_EDGE"), 0.03, 0.12)
    seam = math("SUBTRACT", 1.0, plate_edge)                      # 1 at plate seams
    cell_centre = ramp(voronoi(gen, 15.0, "F1"), 0.02, 0.13)      # 1 at cell centres
    rivet = math("MULTIPLY", cell_centre, 0.9)
    # chainmail micro-weave on metal
    chain = ramp(voronoi(gen, 210.0, "DISTANCE_TO_EDGE"), 0.04, 0.22)
    chain = math("MULTIPLY", math("SUBTRACT", 1.0, chain), pal["chain"])
    # cloth weave: fine cross-hatch from two stretched noises
    weave_a = noise(uv, 260.0, 1.0, 0.5)
    weave_b = noise(uv, 260.0, 1.0, 0.5)
    weave = math("MULTIPLY", ramp(weave_a, 0.35, 0.65), ramp(weave_b, 0.35, 0.65))
    # leather grain
    grain = ramp(noise(gen, 95.0, 3.0, 0.6), 0.30, 0.75)
    # broad wear / scratches
    wear_noise = noise(gen, 9.0, 3.0, 0.55, distort=0.4)
    wear = ramp(wear_noise, 0.25, 0.8)
    # heraldic bands across the torso + trim bands at waist / collar
    band_torso = mask_between(0.56, 0.605, 0.008)
    band_torso2 = mask_between(0.47, 0.495, 0.007)
    waist = mask_between(0.275, 0.315, 0.010)
    collar = mask_between(0.655, 0.685, 0.008)
    trim = math("ADD", math("ADD", band_torso, band_torso2), math("ADD", waist, collar))

    # ---- albedo ----
    def colour_ramp(sock, stops):
        r = nt.nodes.new("ShaderNodeValToRGB")
        r.color_ramp.interpolation = "EASE"
        nt.links.new(sock, r.inputs["Fac"])
        els = r.color_ramp.elements
        while len(els) > len(stops):
            els.remove(els[-1])
        for i, (pos, col) in enumerate(stops):
            e = els[i] if i < len(els) else els.new(pos)
            e.position = pos
            e.color = rgba(col)
        return r.outputs["Color"]

    metal = colour_ramp(noise(gen, 4.5, 2.0, 0.5, distort=0.2),
                        [(0.30, pal["steel2"]), (0.62, pal["steel"])])
    # chainmail darkens the metal slightly and raises contrast
    metal = mixc(metal, (0.16, 0.16, 0.18, 1.0), math("MULTIPLY", chain, 0.55))
    albedo = mixc(metal, pal["cloth"], math("MULTIPLY", cloth_mask, 0.92))
    albedo = mixc(albedo, pal["leather"], math("MULTIPLY", leather_mask, 0.55))
    # cloth weave + leather grain modulation
    weave_dark = colour_ramp(weave, [(0.25, (0.80, 0.80, 0.80)), (0.75, (1.04, 1.04, 1.04))])
    albedo = mulc(albedo, weave_dark, 0.85)
    grain_dark = colour_ramp(grain, [(0.25, (0.78, 0.78, 0.78)), (0.75, (1.03, 1.03, 1.03))])
    albedo = mulc(albedo, grain_dark, 0.55)
    # plate seams dark, rivets bright
    albedo = mulc(albedo, (0.34, 0.34, 0.36, 1.0), math("MULTIPLY", seam, 1.0))
    albedo = mixc(albedo, (0.82, 0.81, 0.76, 1.0), math("MULTIPLY", rivet, 0.7))
    # trim / heraldic bands
    albedo = mixc(albedo, pal["accent"], math("MULTIPLY", trim, 0.65))
    # wear + bottom grime
    albedo = mulc(albedo, colour_ramp(wear, [(0.2, (0.82, 0.82, 0.82)), (0.8, (1.03, 1.03, 1.03))]),
                 pal["wear"])
    grime = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(sep.outputs["Z"], grime.inputs["Value"])
    grime.inputs["From Min"].default_value = 0.0
    grime.inputs["From Max"].default_value = 1.0
    grime.inputs["To Min"].default_value = 0.72
    grime.inputs["To Max"].default_value = 1.0
    albedo = mulc(albedo, grime.outputs["Result"], 0.8)

    # ---- roughness / metallic ----
    # dielectrically weighted armour: metalness stays modest (~0.35) and roughness fairly high so
    # the body keeps its albedo/diffuse response at night (the runtime also clamps metalness for
    # actor materials); cloth/leather are fully dielectric
    rough = mulc(mixc((0.55, 0.55, 0.55, 1.0),
                      (0.88, 0.88, 0.88, 1.0), cloth_mask),
                 colour_ramp(wear, [(0.2, (0.90, 0.90, 0.90)), (0.8, (1.10, 1.10, 1.10))]), 0.85)
    metal_out = mulc(mixc((0.35, 0.35, 0.35, 1.0), (0.02, 0.02, 0.02, 1.0), cloth_mask),
                     colour_ramp(wear, [(0.2, (0.80, 0.80, 0.80)), (0.8, (1.0, 1.0, 1.0))]), 0.7)

    # ---- height for the normal bake ----
    height = math("ADD", math("MULTIPLY", seam, -1.6, clamp=False),
                  math("MULTIPLY", rivet, 0.9, clamp=False), clamp=False)
    height = math("ADD", height, math("MULTIPLY", chain, 0.55, clamp=False), clamp=False)
    height = math("ADD", height, math("MULTIPLY", math("MULTIPLY", cloth_mask, weave, clamp=False), 0.7, clamp=False), clamp=False)
    height = math("ADD", height, math("MULTIPLY", math("MULTIPLY", leather_mask, grain, clamp=False), 0.7, clamp=False), clamp=False)
    height = math("ADD", height, math("MULTIPLY", trim, 0.4, clamp=False), clamp=False)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    # distance is in object units; the imported body is ~190 units tall, so 0.5 ≈ 5 mm of relief
    bump.inputs["Distance"].default_value = 0.04
    nt.links.new(height, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], principled.inputs["Normal"])

    # wiring helpers: the caller relinks whichever graph it wants to bake
    return mat, {"emit": emit, "principled": principled, "out": out, "albedo": albedo,
                 "rough": rough, "metal": metal_out, "nt": nt}


def make_image(name, size, float_buffer=True):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = "Non-Color"
    return img


def select_only(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bake_to(mat_info, expr_source, size, bake_type, samples, filename, margin=6):
    """Bake one pass. expr_source is a node socket to route into an Emission shader, or None for
    NORMAL/AO bakes which use the Principled surface."""
    nt = mat_info["nt"]
    out = mat_info["out"]
    emit = mat_info["emit"]
    for link in list(out.inputs["Surface"].links):
        nt.links.remove(link)
    if bake_type == "EMIT":
        nt.links.remove(emit.inputs["Color"].links[0]) if emit.inputs["Color"].links else None
        nt.links.new(expr_source, emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    else:
        nt.links.new(mat_info["principled"].outputs["BSDF"], out.inputs["Surface"])
    img = make_image(f"{NAME}_{bake_type}_{size}", size)
    texnode = None
    for n in nt.nodes:
        if n.type == "TEX_IMAGE":
            texnode = n
            n.image = None
    if texnode is None:
        texnode = nt.nodes.new("ShaderNodeTexImage")
    texnode.image = img
    for n in nt.nodes:
        n.select = False
    texnode.select = True
    nt.nodes.active = texnode
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.bake.margin = margin
    scene.render.bake.use_clear = True
    select_only(mesh_obj)
    bpy.ops.object.bake(type=bake_type)
    path = os.path.join(OUT, filename)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    print(f"[maps] {NAME} {bake_type} ({size}) -> {path} "
          f"({os.path.getsize(path)/1024:.0f} KB)", flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mesh_obj = max(meshes, key=lambda o: len(o.data.vertices))
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj
print(f"[maps] {NAME}: mesh {mesh_obj.name} verts={len(mesh_obj.data.vertices)} "
      f"uv_layers={[u.name for u in mesh_obj.data.uv_layers]}", flush=True)
pal = PALETTES[NAME]
mat, info = build_material(pal)
mesh_obj.data.materials.clear()
mesh_obj.data.materials.append(mat)
os.makedirs(OUT, exist_ok=True)

bake_to(info, info["albedo"], ALBEDO_SIZE, "EMIT", 4, NAME + "_albedo_linear.png")
bake_to(info, info["rough"], MAP_SIZE, "EMIT", 4, NAME + "_roughness.png")
bake_to(info, info["metal"], MAP_SIZE, "EMIT", 4, NAME + "_metallic.png")
bake_to(info, None, MAP_SIZE, "NORMAL", 8, NAME + "_normal.png")
bake_to(info, None, MAP_SIZE, "AO", 16, NAME + "_ao.png", margin=8)
print("[maps] done", NAME, flush=True)
