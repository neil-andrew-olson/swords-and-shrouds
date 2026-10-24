"""Preview the cycle-2 character map bake: albedo (linear->sRGB, x0.75), normal, AO, ORM."""
import sys

import numpy as np
from PIL import Image

src = sys.argv[1]  # dir
name = sys.argv[2]
out = sys.argv[3]


def lin2srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0.0, 1.0), 1.0 / 2.4) - 0.055)


def load(n):
    im = Image.open(f"{src}/{name}_{n}.png")
    a = np.asarray(im).astype(np.float64) / 255.0
    return a[..., :3] if a.ndim == 3 else a


alb = np.clip(lin2srgb(load("albedo_linear")) * 0.75, 0, 1)
rough = load("roughness")
metal = load("metallic")
ao = load("ao")
normal = load("normal")
# normal map: re-encode from [-1,1] stored as linear 0..1 (bake stores N*0.5+0.5)
tiles = [alb, np.repeat(rough[..., None] if rough.ndim == 2 else rough[..., :1], 3, axis=2),
         np.repeat(metal[..., None] if metal.ndim == 2 else metal[..., :1], 3, axis=2),
         np.repeat(ao[..., None] if ao.ndim == 2 else ao[..., :1], 3, axis=2), normal]
tiles = [t if t.ndim == 3 else np.repeat(t[..., None], 3, axis=2) for t in tiles]
h = max(t.shape[0] for t in tiles)
w = sum(t.shape[1] for t in tiles) + 8 * (len(tiles) - 1)
sheet = np.zeros((h, w, 3))
x = 0
for t in tiles:
    sheet[:t.shape[0], x:x + t.shape[1]] = t
    x += t.shape[1] + 8
Image.fromarray((np.clip(sheet, 0, 1) * 255).astype(np.uint8)).save(out)
print("wrote", out, "albedo srgb mean", round(float(alb.mean() * 255), 1),
      "ao mean", round(float(ao.mean() * 255), 1), "rough mean", round(float(rough.mean() * 255), 1),
      "metal mean", round(float(metal.mean() * 255), 1))
