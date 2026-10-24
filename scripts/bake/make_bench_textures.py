"""Procedural stone-bench textures (task-2 bench fallback: the low-poly props FBX has no
bench, so a simple stone bench is modelled in Blender and needs a small packed texture).
Running-bond stone ashlar blocks with per-block tint, grain and chipped mortar joints;
a matching tangent-space (OpenGL +Y) normal map is derived from the same height field.
Writes temp_sketchlab/bench/bench_basecolor.png + bench_normal.png.
"""
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter

OUT = r"C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab\bench"
SIZE = 512
rng = np.random.default_rng(20261023)
os.makedirs(OUT, exist_ok=True)


def value_noise(shape, scale, seed):
    r = np.random.default_rng(seed)
    small = r.random((max(2, shape[0] // scale + 2), max(2, shape[1] // scale + 2)))
    img = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((shape[1], shape[0]), Image.BICUBIC),
                     dtype=np.float32) / 255.0
    return img


# ---- height field: running-bond blocks ----
rows, cols = 6, 4
row_h = SIZE // rows
col_w = SIZE // cols
height = np.zeros((SIZE, SIZE), dtype=np.float32)
tint = np.zeros((SIZE, SIZE), dtype=np.float32)
mortar = np.zeros((SIZE, SIZE), dtype=np.float32)
for r in range(rows):
    offset = (col_w // 2) if r % 2 else 0
    for c in range(-1, cols + 1):
        x0 = c * col_w + offset
        y0 = r * row_h
        # jittered block rectangle
        jx = int(rng.integers(-3, 4))
        jy = int(rng.integers(-2, 3))
        x1, y1 = x0 + jx, y0 + jy
        x2, y2 = x0 + col_w + jx - 4, y0 + row_h + jy - 4
        xa, xb = max(0, x1), min(SIZE, x2)
        ya, yb = max(0, y1), min(SIZE, y2)
        if xb <= xa or yb <= ya:
            continue
        h = rng.uniform(0.55, 0.9)
        t = rng.uniform(0.0, 1.0)
        height[ya:yb, xa:xb] = h
        tint[ya:yb, xa:xb] = t
        mortar[ya:yb, xa:xb] = 1.0

# soft joint edges
m = uniform_filter(mortar, size=9)
joint = np.clip(1.0 - m, 0, 1)
height = height - joint * 0.35
grain = value_noise((SIZE, SIZE), 3, 7) * 0.06 + value_noise((SIZE, SIZE), 12, 11) * 0.05
height = height + grain

# ---- base colour ----
stone = np.stack([0.46 + tint * 0.10, 0.45 + tint * 0.09, 0.42 + tint * 0.08], axis=2)
stone = stone * (0.82 + 0.28 * height[..., None])
speck = value_noise((SIZE, SIZE), 2, 3)
stone += (speck[..., None] - 0.5) * 0.06
joint_col = np.array([0.26, 0.25, 0.23], dtype=np.float32)
stone = stone * (1 - joint[..., None] * 0.35) + joint_col * joint[..., None] * 0.35
stone += (value_noise((SIZE, SIZE), 40, 17)[..., None] - 0.5) * 0.03  # fine dirt
base = np.clip(stone, 0, 1)

# ---- normal from the same height field (periodic gradient -> tiles) ----
hs = gaussian_filter(height, 1.2, mode="wrap")
gx = (np.roll(hs, -1, axis=1) - np.roll(hs, 1, axis=1)) * 0.5
gy = (np.roll(hs, -1, axis=0) - np.roll(hs, 1, axis=0)) * 0.5
strength = 2.2
n = np.stack([-gx * strength, gy * strength, np.ones_like(hs)], axis=2)
n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
normal = np.clip(n * 0.5 + 0.5, 0, 1)

Image.fromarray((base * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, "bench_basecolor.png"))
Image.fromarray((normal * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, "bench_normal.png"))
print("wrote", OUT, os.path.getsize(os.path.join(OUT, "bench_basecolor.png")), os.path.getsize(os.path.join(OUT, "bench_normal.png")))
