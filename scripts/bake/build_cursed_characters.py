"""Build rigged, class-graded Cursed Knight variants for Swords & Shrouds."""
import bpy
import bmesh
import os
from pathlib import Path
from mathutils import Vector

ROOT = Path(r"C:\Users\neil\Desktop\AIprojects\swords")
SOURCE = ROOT / "temp_chars" / "cursed-knight-ue5-character-game-ready" / "source" / "Cursed Knight.fbx"
TEXTURES = ROOT / "temp_sketchlab" / "cursed_textures"
OUT = ROOT / "temp_sketchlab" / "cursed_base" / "custom"
ANIM = ROOT / "sword_shield"
CLIPS = [
    ("sword and shield idle.fbx", "idle"),
    ("sword and shield run.fbx", "run"),
    ("sword and shield attack.fbx", "attack_1"),
    ("sword and shield attack (2).fbx", "attack_2"),
    ("sword and shield block idle.fbx", "block_idle"),
    ("sword and shield death.fbx", "death_forward"),
]
ONLY = set(os.environ.get("CURSED_ONLY", "").split(",")) if os.environ.get("CURSED_ONLY") else None
NAMES = ["templar", "hero", "ally", "berserker", "ranger", "survivor", "fallen"]

UE5_TO_MIXAMO = {
    "hand_r": "mixamorig:RightHand", "hand_l": "mixamorig:LeftHand",
    "pelvis": "mixamorig:Hips", "root": "mixamorig:RootNode",
    "spine_01": "mixamorig:Spine", "spine_02": "mixamorig:Spine1", "spine_03": "mixamorig:Spine2",
    "neck_01": "mixamorig:Neck", "head": "mixamorig:Head",
    "upperarm_l": "mixamorig:LeftArm", "lowerarm_l": "mixamorig:LeftForeArm",
    "upperarm_r": "mixamorig:RightArm", "lowerarm_r": "mixamorig:RightForeArm",
    "clavicle_l": "mixamorig:LeftShoulder", "clavicle_r": "mixamorig:RightShoulder",
    "thigh_l": "mixamorig:LeftUpLeg", "calf_l": "mixamorig:LeftLeg",
    "foot_l": "mixamorig:LeftFoot", "ball_l": "mixamorig:LeftToeBase",
    "thigh_r": "mixamorig:RightUpLeg", "calf_r": "mixamorig:RightLeg",
    "foot_r": "mixamorig:RightFoot", "ball_r": "mixamorig:RightToeBase",
}

DROP = {
    "Dagger", "Heavy Sword", "Shield", "Sword", "Scabbared", "Mask", "Hair_Card",
    "Eye", "Blind_Eye", "Pouch 2", "L Hand Armor",
}
LIGHT_DROP = {
    "Body_Armor", "Big Shoulder Armor", "R Hand Armor", "Leg Twist Armor",
    "Upper Arm Armor", "Small Shoulder Armor", "Lower Leg Armor", "Lower Arm Armor",
    "Twist Armor", "Plates Armor", "Foot Armor", "Lower Twist Armor", "Upper Leg Armor",
}
CONFIG = {
    "templar": {"drop": set()},
    "hero": {"drop": set()},
    "ally": {"drop": {"Big Shoulder Armor"}},
    "berserker": {"drop": {"Big Shoulder Armor", "Upper Arm Armor", "Lower Arm Armor"}},
    "ranger": {"drop": {"Big Shoulder Armor", "Upper Arm Armor", "Lower Leg Armor"}},
    "survivor": {"drop": LIGHT_DROP},
    "fallen": {"drop": set()},
}
BUDGET = {
    "Outfit": 5800,
    "Body Armor": 2300,
    "Head": 1000,
    "Helmet": 700,
    "Primary Armors": 1800,
    "Secoundary Armors": 1600,
    "Belts": 850,
}
GROUP_NAME = {
    "Outfit": "CursedOutfit",
    "Body Armor": "CursedBodyArmor",
    "Head": "CursedHead",
    "Helmet": "CursedHelmet",
    "Primary Armors": "CursedPrimary",
    "Secoundary Armors": "CursedSecondary",
    "Belts": "CursedBelts",
}


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def join_objects(objects, name):
    if not objects:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = name
    return result


def decimate(obj, target):
    current = tri_count(obj)
    if current <= target:
        return
    modifier = obj.modifiers.new("Game budget", "DECIMATE")
    modifier.ratio = max(0.001, target / current)
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def refine_helmet_and_cloth(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    for _ in range(3):
        edges = [edge for edge in bm.edges if edge.calc_length() > 0.42]
        if not edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()


def pbr_material(name, character, source_name):
    folder = TEXTURES / character / source_name
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    base = nodes.new("ShaderNodeTexImage")
    base.image = bpy.data.images.load(str(folder / "basecolor.jpg"), check_existing=True)
    base.image.colorspace_settings.name = "sRGB"
    links.new(base.outputs["Color"], shader.inputs["Base Color"])
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = bpy.data.images.load(str(folder / "normal.jpg"), check_existing=True)
    normal.image.colorspace_settings.name = "Non-Color"
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    orm = nodes.new("ShaderNodeTexImage")
    orm.image = bpy.data.images.load(str(folder / "orm.jpg"), check_existing=True)
    orm.image.colorspace_settings.name = "Non-Color"
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.mode = "RGB"
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs[1], shader.inputs["Roughness"])
    links.new(separate.outputs[2], shader.inputs["Metallic"])
    return mat


def merge_twist_weights(arm):
    replacements = {"spine_04": "mixamorig:Spine2", "spine_05": "mixamorig:Spine2"}
    for side, prefix in [("l", "Left"), ("r", "Right")]:
        for bone, target in [("upperarm", "Arm"), ("lowerarm", "ForeArm"), ("thigh", "UpLeg"), ("calf", "Leg")]:
            for index in ["01", "02"]:
                replacements[f"{bone}_twist_{index}_{side}"] = f"mixamorig:{prefix}{target}"
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for group in list(obj.vertex_groups):
            target_name = replacements.get(group.name)
            if not target_name:
                continue
            target_group = obj.vertex_groups.get(target_name)
            if target_group is None:
                target_group = obj.vertex_groups.new(name=target_name)
            for vertex in obj.data.vertices:
                try:
                    weight = group.weight(vertex.index)
                except RuntimeError:
                    continue
                if weight > 0:
                    target_group.add([vertex.index], weight, "ADD")
            obj.vertex_groups.remove(group)


def rename_rig(arm):
    for side, prefix in [("l", "Left"), ("r", "Right")]:
        for finger, label in [("thumb", "Thumb"), ("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Pinky")]:
            for index in [1, 2, 3]:
                UE5_TO_MIXAMO[f"{finger}_{index:02d}_{side}"] = f"mixamorig:{prefix}Hand{label}{index}"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in arm.data.edit_bones:
        replacement = UE5_TO_MIXAMO.get(bone.name.lower())
        if replacement:
            bone.name = replacement
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            for group in obj.vertex_groups:
                replacement = UE5_TO_MIXAMO.get(group.name.lower())
                if replacement:
                    group.name = replacement
    arm.name = "Armature"
    merge_twist_weights(arm)


def import_clips(arm):
    from mathutils import Matrix

    arm.animation_data_create()
    arm.animation_data.action = None
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    for bone in arm.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.matrix_basis = Matrix.Identity(4)
    source_by_name = lambda name: name.replace("mixamorig:", "")
    target_height = (arm.matrix_world @ arm.data.bones["mixamorig:Hips"].matrix_local).translation.z
    imported_count = 0
    for filename, clip_name in CLIPS:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=str(ANIM / filename))
        imported = [obj for obj in set(bpy.data.objects) - before if obj.type == "ARMATURE"]
        if not imported:
            raise RuntimeError(f"No animation armature in {filename}")
        source = imported[0]
        source_action = source.animation_data.action if source.animation_data else None
        if not source_action:
            raise RuntimeError(f"No source action in {filename}")
        source.animation_data.action = source_action
        source.animation_data.action_slot = source_action.slots[0]
        source_bones = {source_by_name(bone.name): bone.name for bone in source.data.bones}
        start, end = [int(value) for value in source_action.frame_range]
        bpy.context.scene.frame_set(start)
        bpy.context.view_layer.update()
        source_hip_reference = (source.matrix_world @ source.pose.bones["mixamorig:Hips"].matrix).translation.copy()
        scale = target_height / max(0.001, source_hip_reference.z)
        baked = bpy.data.actions.new(clip_name)
        slot = baked.slots.new(id_type="OBJECT", name=arm.name)
        arm.animation_data.action = baked
        arm.animation_data.action_slot = slot
        pairs = [(bone, source_bones[source_by_name(bone.name)]) for bone in arm.data.bones if source_by_name(bone.name) in source_bones]
        frames = list(range(start, end + 1, 2))
        if frames[-1] != end:
            frames.append(end)
        for frame in frames:
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            posed = {}
            for target_bone, source_name in pairs:
                source_rest = source.data.bones[source_name].matrix_local
                source_pose = source.pose.bones[source_name].matrix
                delta = (source.matrix_world @ source_pose).to_quaternion() @ (source.matrix_world @ source_rest).to_quaternion().inverted()
                rotation = delta @ (arm.matrix_world @ target_bone.matrix_local).to_quaternion()
                desired = rotation.to_matrix().to_4x4()
                translation = (arm.matrix_world @ target_bone.matrix_local).translation.copy()
                if target_bone.name == "mixamorig:Hips":
                    translation.z += ((source.matrix_world @ source_pose).translation.z - source_hip_reference.z) * scale
                desired.translation = translation
                target_pose = arm.matrix_world.inverted() @ desired
                parent = target_bone.parent
                parent_rest = parent.matrix_local if parent else Matrix.Identity(4)
                relative_rest = parent_rest.inverted() @ target_bone.matrix_local
                parent_pose = posed.get(parent.name, parent_rest) if parent else Matrix.Identity(4)
                basis = relative_rest.inverted() @ parent_pose.inverted() @ target_pose
                pose_bone = arm.pose.bones[target_bone.name]
                pose_bone.matrix_basis = basis
                pose_bone.keyframe_insert("rotation_quaternion", frame=frame, group=target_bone.name)
                if target_bone.name == "mixamorig:Hips":
                    pose_bone.keyframe_insert("location", frame=frame, group=target_bone.name)
                posed[target_bone.name] = target_pose
        track = arm.animation_data.nla_tracks.new()
        track.name = clip_name
        strip = track.strips.new(clip_name, start, baked)
        strip.name = clip_name
        imported_count += 1
        print(f"Retargeted {clip_name}: {len(pairs)} joints, {len(frames)} frames", flush=True)
        arm.animation_data.action = None
        for obj in set(bpy.data.objects) - before:
            bpy.data.objects.remove(obj, do_unlink=True)
    used_actions = {strip.action for track in arm.animation_data.nla_tracks for strip in track.strips}
    for action in list(bpy.data.actions):
        if action not in used_actions:
            bpy.data.actions.remove(action)
    if imported_count != len(CLIPS):
        raise RuntimeError(f"Expected {len(CLIPS)} clips, imported {imported_count}")


def build(character):
    print(f"\n=== {character} ===", flush=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(SOURCE))
    arm = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    rename_rig(arm)
    excluded = DROP | CONFIG[character]["drop"]
    groups = {key: [] for key in BUDGET}
    cloth = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        if obj.name in excluded:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if obj.name in {"Dress", "Scarf"}:
            cloth.append(obj)
        else:
            material_name = obj.data.materials[0].name
            groups["Outfit" if material_name == "Head" else material_name].append(obj)
    if "Helmet" not in groups or not groups["Helmet"]:
        raise RuntimeError(f"{character}: helmet is required for the armour primitive")
    if not cloth:
        raise RuntimeError(f"{character}: cloth source pieces are missing")
    built = []
    for material_name, objects in groups.items():
        if not objects:
            continue
        has_head = any(obj.data.materials[0].name == "Head" for obj in objects)
        joined = join_objects(objects, GROUP_NAME[material_name])
        decimate(joined, BUDGET[material_name])
        joined.data.materials.clear()
        joined.data.materials.append(pbr_material(material_name, character, material_name))
        if has_head:
            joined.data.materials.append(pbr_material("Head", character, "Head"))
        built.append(joined)
    cloth_obj = join_objects(cloth, "CursedCloth")
    decimate(cloth_obj, 650)
    refine_helmet_and_cloth(cloth_obj)
    cloth_obj.data.materials.clear()
    cloth_obj.data.materials.append(pbr_material(f"{character}_cloth", character, "Outfit"))
    built.append(cloth_obj)
    for obj in built:
        arm_modifier = obj.modifiers.new("Armature", "ARMATURE")
        arm_modifier.object = arm
        if len(obj.vertex_groups) == 0:
            bone_name = "mixamorig:Spine2" if obj.name == "CursedBodyArmor" else "mixamorig:Hips"
            group = obj.vertex_groups.new(name=bone_name)
            group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        world = obj.matrix_world.copy()
        obj.parent = arm
        obj.matrix_world = world
        obj["character_class"] = character
    helmet = next(obj for obj in built if obj.name == "CursedHelmet")
    refine_helmet_and_cloth(helmet)
    helmet.data.materials[0].name = f"{character}_plate"
    import_clips(arm)
    total = sum(tri_count(obj) for obj in built)
    if total > 16000:
        raise RuntimeError(f"{character}: {total} triangles exceeds the 16000 budget")
    print(f"{character}: {total} tris, {len(built)} mesh objects", flush=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for obj in built:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    OUT.mkdir(parents=True, exist_ok=True)
    output = OUT / f"{character}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_nla_strips=True,
        export_skins=True,
        export_morph=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_keep_originals=False,
    )
    print(f"wrote {output}", flush=True)


for name in NAMES:
    if ONLY and name not in ONLY:
        continue
    build(name)
