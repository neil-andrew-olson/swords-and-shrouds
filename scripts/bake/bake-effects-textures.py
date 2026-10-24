"""Cycle-3 Phase A textures: effects, corruption mask, region ground decals, foliage atlases.

All procedural (numpy/Pillow), night-toned, no external references. Writes into
public/assets/textures/ for the effect/decals, and into a scratch folder for the foliage atlases that
get embedded inside the new tree GLBs.

  python scripts/bake/bake-effects-textures.py
"""
import os
import sys

import numpy as np
from PIL import Image

GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build'
TEX = os.path.join(GAME, 'public/assets/textures')
SCRATCH = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/cycle3_tex'
os.makedirs(TEX, exist_ok=True)
os.makedirs(SCRATCH, exist_ok=True)

rng = np.random.default_rng(7)


def smooth_noise(w, h, cells, octaves=3, seed=1):
    out = np.zeros((h, w), np.float64)
    amp = 1.0
    for o in range(octaves):
        c = cells * (2 ** o)
        g = rng.random((c + 1, c + 1))
        xs = np.linspace(0, c, w)
        ys = np.linspace(0, c, h)
        x0 = np.floor(xs).astype(int); x1 = np.clip(x0 + 1, 0, c)
        y0 = np.floor(ys).astype(int); y1 = np.clip(y0 + 1, 0, c)
        tx = xs - x0; ty = ys - y0
        sx = tx * tx * (3 - 2 * tx); sy = ty * ty * (3 - 2 * ty)
        a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]
        c2 = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
        layer = (a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d * sx) * sy
        out += layer * amp
        amp *= 0.55
    lo, hi = out.min(), out.max()
    return (out - lo) / (hi - lo + 1e-9)


def radial(w, h, cx=0.5, cy=0.5, power=1.0):
    yy, xx = np.mgrid[0:h, 0:w]
    x = (xx + 0.5) / w - cx
    y = (yy + 0.5) / h - cy
    r = np.sqrt(x * x + y * y) / 0.5
    return np.clip(1.0 - r, 0.0, 1.0) ** power


def save_rgba(path, rgba):
    Image.fromarray(np.clip(rgba * 255.0 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(path, optimize=True)
    print('wrote', os.path.basename(path), os.path.getsize(path), 'bytes')


def save_rgb(path, rgb):
    Image.fromarray(np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8), 'RGB').save(path, optimize=True)
    print('wrote', os.path.basename(path), os.path.getsize(path), 'bytes')


# ---------------------------------------------------------------- flame_soft (256)
N = 256
n = smooth_noise(N, N, 4, 4)
core = radial(N, N, 0.5, 0.66, 1.6)
tongue = np.clip((n * 0.5 + core * 0.9) * (1.0 - radial(N, N, 0.5, 0.66, 0.45) ** 3), 0, 1)
alpha = np.clip(tongue * 1.35, 0, 1)
alpha *= np.clip(1.2 - radial(N, N, 0.5, 0.6, 0.9) * 1.1, 0, 1) ** 0.7
col = np.zeros((N, N, 4))
hot = np.clip(tongue * 1.5, 0, 1)
col[..., 0] = 0.55 + 0.45 * hot
col[..., 1] = 0.22 + 0.45 * hot ** 1.6
col[..., 2] = 0.06 + 0.20 * hot ** 2.5
col[..., 3] = alpha
save_rgba(os.path.join(TEX, 'flame_soft.png'), col)

# ---------------------------------------------------------------- flame_core (128)
N = 128
n2 = smooth_noise(N, N, 6, 3)
r = radial(N, N, 0.5, 0.62, 1.1)
a = np.clip((r ** 1.2) * 1.5 * (0.75 + 0.5 * n2), 0, 1)
core_col = np.zeros((N, N, 4))
core_col[..., 0] = 1.0
core_col[..., 1] = 0.82 + 0.18 * a
core_col[..., 2] = 0.55 + 0.35 * a ** 2
core_col[..., 3] = a
save_rgba(os.path.join(TEX, 'flame_core.png'), core_col)

# ---------------------------------------------------------------- smoke_puff (128)
N = 128
n3 = smooth_noise(N, N, 3, 4)
r3 = radial(N, N, 0.5, 0.5, 0.9)
a = np.clip((n3 * 0.85 + 0.15) * r3 * 1.5, 0, 1) ** 1.2
smoke = np.zeros((N, N, 4))
grey = 0.30 + 0.22 * n3
smoke[..., 0] = grey * 1.02
smoke[..., 1] = grey
smoke[..., 2] = grey * 0.98
smoke[..., 3] = a * 0.85
save_rgba(os.path.join(TEX, 'smoke_puff.png'), smoke)

# ---------------------------------------------------------------- ember_dot (128)
N = 128
r = radial(N, N, 0.5, 0.5, 2.4)
a = np.clip(r * 1.9, 0, 1)
ember = np.zeros((N, N, 4))
ember[..., 0] = 1.0
ember[..., 1] = 0.45 + 0.45 * a
ember[..., 2] = 0.10 + 0.15 * a
ember[..., 3] = a ** 1.5
save_rgba(os.path.join(TEX, 'ember_dot.png'), ember)

# ---------------------------------------------------------------- corruption_feather (256)
N = 256
nn = smooth_noise(N, N, 5, 4)
r = radial(N, N, 0.5, 0.5, 0.8)
edge = np.clip(r * 1.25 + (nn - 0.5) * 0.55, 0, 1)          # feathered, noisy border
mask = np.clip(edge ** 1.4, 0, 1)
# tendrils: darker veins
veins = smooth_noise(N, N, 9, 3)
mask *= np.clip(0.75 + 0.45 * veins, 0, 1)
corr = np.zeros((N, N, 4))
corr[..., 0] = 0.16 + 0.10 * nn
corr[..., 1] = 0.04 + 0.03 * nn
corr[..., 2] = 0.14 + 0.10 * nn
corr[..., 3] = mask
save_rgba(os.path.join(TEX, 'corruption_feather.png'), corr)


# ---------------------------------------------------------------- ground decals (512)
def decal(kind, N=512):
    base = smooth_noise(N, N, 6, 4)
    fine = smooth_noise(N, N, 40, 2)
    yy, xx = np.mgrid[0:N, 0:N]
    r = np.sqrt(((xx / N - 0.5) ** 2 + (yy / N - 0.5) ** 2)) * 2.0
    edge = np.clip(1.0 - r + (base - 0.5) * 0.35, 0, 1) ** 1.25
    out = np.zeros((N, N, 4))
    if kind == 'snow':
        tone = 0.72 + 0.18 * base
        out[..., 0] = tone * 0.92
        out[..., 1] = tone * 0.95
        out[..., 2] = tone
        out[..., 3] = np.clip(edge * (0.55 + 0.6 * base), 0, 1)
    elif kind == 'ash':
        tone = 0.13 + 0.16 * base
        out[..., 0] = tone
        out[..., 1] = tone * 0.93
        out[..., 2] = tone * 0.86
        out[..., 3] = np.clip(edge * (0.5 + 0.7 * base), 0, 1)
        # ember specks
        specks = (fine > 0.93) & (edge > 0.15)
        out[specks, 0] = 0.55; out[specks, 1] = 0.18; out[specks, 2] = 0.05
        out[specks, 3] = 0.9
    else:  # grass
        tone = 0.10 + 0.13 * base
        out[..., 0] = tone * 0.75
        out[..., 1] = tone * 1.15
        out[..., 2] = tone * 0.6
        out[..., 3] = np.clip(edge * (0.5 + 0.65 * base), 0, 1)
        blades = (fine > 0.72) & (edge > 0.1)
        out[blades, 0] = 0.16; out[blades, 1] = 0.25; out[blades, 2] = 0.10
        out[blades, 3] = 0.85
    save_rgba(os.path.join(TEX, f'{kind}_patch.png'), out)


for kind in ('snow', 'ash', 'grass'):
    decal(kind)

# ---------------------------------------------------------------- foliage atlases (embedded in tree GLBs)


def leaf_atlas(kind, N=256):
    """Alpha-cut foliage card: a dense CLUSTER (multiple needle sprigs / leaf sprays) rather than a
    single fan, so a handful of cards already reads as a full branch."""
    n = smooth_noise(N, N, 7, 4)
    fine = smooth_noise(N, N, 30, 2)
    yy, xx = np.mgrid[0:N, 0:N]
    mask = np.zeros((N, N))
    if kind in ('pine', 'snow_pine'):
        # 6-8 needle sprigs: fans of thin strands growing outward from a branch line
        for s in range(7):
            bx = 0.5 + rng.uniform(-0.28, 0.28)
            by = 0.5 + rng.uniform(-0.28, 0.28)
            base_ang = rng.uniform(0, np.pi * 2)
            spread = rng.uniform(0.55, 0.9)
            length = rng.uniform(0.2, 0.34)
            strands = 11
            for k in range(strands):
                ang = base_ang + (k / strands - 0.5) * spread * 2
                dxv, dyv = np.cos(ang), np.sin(ang)
                px = (xx / N) - bx
                py = (yy / N) - by
                along = px * dxv + py * dyv
                perp = np.abs(-px * dyv + py * dxv)
                strand = np.exp(-(perp / 0.007) ** 2) * (1.0 - np.clip(along / length, 0, 1)) ** 0.7
                mask = np.maximum(mask, strand)
        mask = np.clip(mask * 1.9 - 0.35, 0, 1) * (0.55 + 0.85 * fine)
        mask = np.clip((mask - 0.10) / 0.45, 0, 1)  # near-binary alpha so MASK cutoff does not discard leaves
        col = np.zeros((N, N, 4))
        if kind == 'pine':
            col[..., 0] = 0.14 + 0.06 * n
            col[..., 1] = 0.22 + 0.09 * n
            col[..., 2] = 0.12 + 0.05 * n
        else:
            snow = np.clip(fine * 1.4 - 0.5, 0, 1)
            col[..., 0] = 0.10 + 0.05 * n + 0.55 * snow
            col[..., 1] = 0.17 + 0.08 * n + 0.58 * snow
            col[..., 2] = 0.09 + 0.04 * n + 0.64 * snow
        col[..., 3] = mask
        save_rgba(os.path.join(SCRATCH, f'leaf_{kind}.png'), col)
    else:
        # broadleaf: dense overlapping leaf ellipses, ragged silhouette
        blobs = np.zeros((N, N))
        for _ in range(120):
            bx = rng.uniform(0.1, 0.9); by = rng.uniform(0.08, 0.92)
            br = rng.uniform(0.04, 0.075)
            d = np.sqrt((xx / N - bx) ** 2 + ((yy / N - by) * 1.25) ** 2)
            blobs = np.maximum(blobs, np.clip(1.0 - d / br, 0, 1))
        edge = np.clip(1.65 - 2.2 * np.sqrt(((xx / N) - 0.5) ** 2 + ((yy / N) - 0.5) ** 2), 0, 1)
        mask = np.clip((blobs * edge * (0.88 + 0.30 * fine) - 0.10) / 0.34, 0, 1)
        col = np.zeros((N, N, 4))
        if kind == 'oak':
            base = np.stack([0.17 + 0.07 * n, 0.25 + 0.09 * n, 0.12 + 0.05 * n], -1)
        elif kind == 'maple':
            base = np.stack([0.56 + 0.22 * n, 0.24 + 0.16 * n, 0.07 + 0.05 * n], -1)
        else:  # autumn mix
            base = np.stack([0.38 + 0.2 * n, 0.27 + 0.12 * n, 0.08 + 0.06 * n], -1)
        col[..., :3] = base
        col[..., 3] = mask
        save_rgba(os.path.join(SCRATCH, f'leaf_{kind}.png'), col)


def bark_atlas(N=256):
    n = smooth_noise(N, N, 8, 5)
    fine = smooth_noise(N, N, 42, 2)
    col = np.zeros((N, N, 3))
    tone = 0.10 + 0.13 * n + 0.03 * fine
    col[..., 0] = tone * 1.15
    col[..., 1] = tone * 1.0
    col[..., 2] = tone * 0.82
    save_rgb(os.path.join(SCRATCH, 'bark.png'), col)


def stone_atlas(N=256):
    n = smooth_noise(N, N, 10, 5)
    fine = smooth_noise(N, N, 48, 2)
    col = np.zeros((N, N, 3))
    tone = 0.18 + 0.16 * n + 0.04 * fine
    col[..., 0] = tone
    col[..., 1] = tone * 1.02
    col[..., 2] = tone * 0.96
    save_rgb(os.path.join(SCRATCH, 'stone.png'), col)


def ice_atlas(N=256):
    n = smooth_noise(N, N, 6, 4)
    fine = smooth_noise(N, N, 26, 3)
    col = np.zeros((N, N, 3))
    tone = 0.30 + 0.22 * n + 0.10 * fine
    col[..., 0] = tone * 0.55
    col[..., 1] = tone * 0.85
    col[..., 2] = tone * 1.05
    save_rgb(os.path.join(SCRATCH, 'ice.png'), col)


for kind in ('pine', 'snow_pine', 'oak', 'maple'):
    leaf_atlas(kind)
bark_atlas()
stone_atlas()
ice_atlas()
print('done')
