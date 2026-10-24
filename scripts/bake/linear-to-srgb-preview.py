"""Convert a baked linear (Non-Color) atlas PNG to an sRGB preview PNG.

  python scripts/bake/linear-to-srgb-preview.py <in_linear.png> <out_srgb.png>
"""
import sys

import numpy as np
from PIL import Image


def lin2srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0.0, 1.0), 1.0 / 2.4) - 0.055)


src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
a = np.asarray(im).astype(np.float64) / 255.0
if a.ndim == 3:
    a = a[..., :3]
srgb = np.clip(lin2srgb(a), 0.0, 1.0)
Image.fromarray((srgb * 255.0 + 0.5).astype(np.uint8)).save(dst)
print('wrote', dst, 'srgb mean', round(float(srgb.mean() * 255.0), 1))
