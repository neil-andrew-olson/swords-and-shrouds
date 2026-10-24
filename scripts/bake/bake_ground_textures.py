"""Task-3: bake seamless scanned ground textures for Swords & Shrouds.

Sources (raw warehouse, sketchlab):
  ground_03_-_country_road.glb         -> basecolor + normal are laid out as a photogrammetry
                                          UV atlas with black gutters, so the largest fully
                                          covered inscribed square of the biggest island is
                                          cropped out of both maps with the same rect.
  cobblestone_ground_-_highpoly.glb    -> three full-bleed 4096 albedo patches, no normal map.
                                          Best patch is used; a tangent-space normal map is
                                          derived from its luminance height field.

Seams: roll by half in both axes and cross-fade the seams with a cosine window, then
numerically verify (wrap-edge difference vs interior neighbour difference).

Run with: python.exe scripts/bake/bake_ground_textures.py
"""
import io
import json
import os
import struct

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

ROOT = r"C:\Users\neil\Desktop\AIprojects\swords\sketchlab"
SCRATCH = r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab"
GAME = r"C:\Users\neil\Desktop\AIprojects\neilandrew.dev\.game-build"
OUT_TEXTURES = os.path.join(GAME, "public", "assets", "textures")
OUT_PREVIEW = os.path.join(SCRATCH, "texture_previews")
SIZE = 1024
BAND = 0.20  # cross-fade band as a fraction of the tile (each side)


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    j = json.loads(data[20:20 + jlen].decode("utf-8"))
    return j, data, 20 + jlen + 8


def glb_image(j, data, binoff, idx):
    im = j["images"][idx]
    bv = j["bufferViews"][im["bufferView"]]
    start = binoff + bv.get("byteOffset", 0)
    img = Image.open(io.BytesIO(data[start:start + bv["byteLength"]]))
    img.load()
    return img


def largest_inscribed_square(mask, margin):
    """Largest square that, together with `margin` px of context, is fully covered by mask.
    Returns (x, y, size) of the top-left corner of the usable square in mask coordinates."""
    h, w = mask.shape
    m = mask.astype(np.float32)
    best = None
    lo, hi = 16, min(h, w) - 2 * margin
    while lo <= hi:
        s = (lo + hi) // 2
        win = s + 2 * margin
        cover = uniform_filter(m, size=win, mode="constant", cval=0.0)
        hits = np.argwhere(cover > 0.9995)
        if len(hits):
            best = (s, win, hits)
            lo = s + 1
        else:
            hi = s - 1
    if best is None:
        return None
    s, win, hits = best
    # uniform_filter reports window *centres*: shift back to the top-left corner
    xs = hits[:, 1] - win // 2 + margin
    ys = hits[:, 0] - win // 2 + margin
    valid = (xs >= 0) & (ys >= 0) & (xs + s <= w) & (ys + s <= h)
    xs, ys = xs[valid], ys[valid]
    if len(xs) == 0:
        return None
    # pick the candidate nearest the covered-area centroid
    cy, cx = np.argwhere(mask).mean(axis=0)
    k = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
    return int(xs[k]), int(ys[k]), int(s)


def seamless(img_arr, band=BAND):
    """Roll by half in both axes, cross-fade the seams with a cosine window."""
    h, w = img_arr.shape[:2]
    rolled = np.roll(img_arr, (h // 2, w // 2), axis=(0, 1))
    x = np.linspace(0, 1, w)
    y = np.linspace(0, 1, h)
    def window(t):
        # 0 at the edges, 1 in the middle, cosine ramps of width `band`
        v = np.clip(t / band, 0, 1) * np.clip((1 - t) / band, 0, 1)
        return 0.5 - 0.5 * np.cos(np.pi * v)
    wx, wy = window(x), window(y)
    wgt = (wy[:, None] * wx[None, :])[..., None]
    return img_arr * wgt + rolled * (1 - wgt)


def normalise(v):
    return v / np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)


def height_to_normal(rgb, strength=3.0, blur=1.2):
    """OpenGL (+Y) tangent-space normal from the luminance height field of an albedo tile.
    Gradients are periodic (rolled) so the resulting normal map tiles exactly."""
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    if blur:
        lum = uniform_filter(lum, size=int(blur * 2 + 1), mode="wrap")
    gx = (np.roll(lum, -1, axis=1) - np.roll(lum, 1, axis=1)) * 0.5
    gy = (np.roll(lum, -1, axis=0) - np.roll(lum, 1, axis=0)) * 0.5
    n = np.stack([-gx * strength, gy * strength, np.ones_like(lum)], axis=2)
    n = normalise(n)
    return (n * 0.5 + 0.5).clip(0, 1)


def seam_metric(arr):
    """ratio wrap-edge mean |diff| / interior neighbour mean |diff| (1.0 == seamless)."""
    a = arr.astype(np.float32)
    d = lambda x: float(np.abs(x).mean())
    vert = d(a[:, 0] - a[:, -1])
    horz = d(a[0, :] - a[-1, :])
    inner_v = d(a[:, 1:] - a[:, :-1])
    inner_h = d(a[1:, :] - a[:-1, :])
    return {
        "v_seam": vert, "h_seam": horz, "v_inner": inner_v, "h_inner": inner_h,
        "v_ratio": vert / max(inner_v, 1e-6), "h_ratio": horz / max(inner_h, 1e-6),
    }


def save_jpeg(arr, path, quality=88):
    Image.fromarray((arr.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(
        path, "JPEG", quality=quality, optimize=True, subsampling=1)
    return os.path.getsize(path)


def save_png(arr, path):
    im = Image.fromarray((arr.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    im.save(path, "PNG", optimize=True)
    size = os.path.getsize(path)
    dims = im.size
    while size > 2 * 1024 * 1024 and im.size[0] > 512:
        im = im.resize((im.size[0] // 2, im.size[1] // 2), Image.LANCZOS)
        im.save(path, "PNG", optimize=True)
        size = os.path.getsize(path)
    return size, im.size


def tiled_preview(arr, path, n=2):
    small = Image.fromarray((arr.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGB").resize(
        (SIZE // 2, SIZE // 2), Image.LANCZOS)
    out = Image.new("RGB", (SIZE, SIZE))
    for i in range(n):
        for jx in range(n):
            out.paste(small, (jx * SIZE // 2, i * SIZE // 2))
    out.save(path)
    return path


def main():
    os.makedirs(OUT_TEXTURES, exist_ok=True)
    os.makedirs(OUT_PREVIEW, exist_ok=True)
    report = {}

    # ---------------- country road ----------------
    j, data, binoff = load_glb(os.path.join(ROOT, "ground_03_-_country_road.glb"))
    base = glb_image(j, data, binoff, 0)       # KHR_materials_pbrSpecularGlossiness.diffuseTexture
    normal = glb_image(j, data, binoff, 1)     # normalTexture (glTF => OpenGL +Y convention)
    print("road source sizes:", base.size, normal.size)

    # gutter mask from a 1024 thumbnail (black atlas gutters are < 2 % luminance)
    thumb = base.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    lum = np.asarray(thumb, dtype=np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mask = lum > 10.0
    print(f"road atlas coverage: {mask.mean()*100:.1f}%")
    rect = largest_inscribed_square(mask, margin=14)
    if rect is None:
        raise RuntimeError("no fully covered square found in the road atlas")
    x, y, s = rect
    print(f"largest inscribed square (1024 thumb): x={x} y={y} size={s}")
    sx = base.size[0] / 1024.0
    box = (round(x * sx), round(y * sx), round((x + s) * sx), round((y + s) * sx))
    print("crop box on 4096 source:", box)
    road_base = np.asarray(base.convert("RGB").crop(box).resize((SIZE, SIZE), Image.LANCZOS),
                           dtype=np.float32) / 255.0
    road_normal = np.asarray(normal.convert("RGB").crop(box).resize((SIZE, SIZE), Image.LANCZOS),
                             dtype=np.float32) / 255.0

    road_base = seamless(road_base)
    road_normal = seamless(road_normal)
    # renormalise the blended normals so they stay unit length
    n = normalise(road_normal * 2.0 - 1.0)
    road_normal = (n * 0.5 + 0.5).clip(0, 1)

    bp = os.path.join(OUT_TEXTURES, "road_country_basecolor.jpg")
    npth = os.path.join(OUT_TEXTURES, "road_country_normal.png")
    base_bytes = save_jpeg(road_base, bp, 88)
    normal_bytes, normal_dims = save_png(road_normal, npth)
    report["road_country"] = {
        "crop": box, "basecolor_bytes": base_bytes, "normal_bytes": normal_bytes,
        "normal_dims": normal_dims, "seam_base": seam_metric(road_base),
        "seam_normal": seam_metric(road_normal),
    }
    tiled_preview(road_base, os.path.join(OUT_PREVIEW, "road_country_basecolor_2x2.png"))

    # ---------------- cobblestone ----------------
    j, data, binoff = load_glb(os.path.join(ROOT, "cobblestone_ground_-_highpoly.glb"))
    best_idx, best_detail = None, -1
    for idx in range(3):
        im = glb_image(j, data, binoff, idx)
        a = np.asarray(im.convert("RGB").resize((512, 512), Image.LANCZOS), dtype=np.float32) / 255.0
        detail = float(np.abs(np.diff(a, axis=0)).mean() + np.abs(np.diff(a, axis=1)).mean())
        print(f"cobblestone albedo[{idx}] {im.size} detail={detail:.4f}")
        if detail > best_detail:
            best_idx, best_detail = idx, detail
    print("using cobblestone albedo image", best_idx)
    src = glb_image(j, data, binoff, best_idx)
    # centre-crop 6 % to stay clear of scan border shading, then resize
    w, h = src.size
    inset = int(min(w, h) * 0.03)
    src = src.convert("RGB").crop((inset, inset, w - inset, h - inset))
    cobble_base = np.asarray(src.resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32) / 255.0
    cobble_base = seamless(cobble_base)
    cobble_normal = height_to_normal(cobble_base, strength=2.6, blur=1.0)

    cp = os.path.join(OUT_TEXTURES, "cobblestone_basecolor.jpg")
    cnp = os.path.join(OUT_TEXTURES, "cobblestone_normal.png")
    cbase_bytes = save_jpeg(cobble_base, cp, 88)
    cnormal_bytes, cnormal_dims = save_png(cobble_normal, cnp)
    report["cobblestone"] = {
        "albedo_source_index": best_idx, "basecolor_bytes": cbase_bytes,
        "normal_bytes": cnormal_bytes, "normal_dims": cnormal_dims,
        "seam_base": seam_metric(cobble_base), "seam_normal": seam_metric(cobble_normal),
    }
    tiled_preview(cobble_base, os.path.join(OUT_PREVIEW, "cobblestone_basecolor_2x2.png"))

    print(json.dumps(report, indent=2))
    with open(os.path.join(SCRATCH, "texture_report.json"), "w") as f:
        json.dump(report, f, indent=2)


main()
