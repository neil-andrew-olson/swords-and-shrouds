"""Character base-colour atlas diagnostics.

For each of the affected character GLBs: report the embedded base-colour image mean
luminance, the mesh UV layout quality (island count / covered UV area / bbox / degenerate
triangles) and the UV-sampled image luminance (rasterise the UV triangles and sample the
image). This is the "before" half of the before/after table for the atlas bake.

  python scripts/bake/character-uv-stats.py <glb.gz> [<glb.gz> ...]
"""
import json
import math
import struct
import sys
import zlib

import numpy as np
from PIL import Image

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
TYPE_MAX = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def load_glb(path):
    raw = open(path, 'rb').read()
    b = zlib.decompress(raw, 16 + zlib.MAX_WBITS) if raw[:2] == b'\x1f\x8b' else raw
    jlen = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jlen].decode('utf-8'))
    return j, b, 20 + jlen + 8, len(raw)


def accessor(j, b, binoff, idx):
    a = j['accessors'][idx]
    bv = j['bufferViews'][a['bufferView']]
    fmt, size = CT[a['componentType']]
    n = NCOMP[a['type']]
    stride = bv.get('byteStride') or size * n
    start = binoff + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    # supports interleaved vertex buffers (character exports use byteStride > tight packing)
    arr = np.ndarray(shape=(a['count'], n), dtype=np.dtype('<' + fmt), buffer=b,
                     offset=start, strides=(stride, size)).astype(np.float64)
    if a.get('normalized'):
        if a['componentType'] in (5120, 5122):
            arr = np.clip(arr / TYPE_MAX[a['componentType']], -1.0, 1.0)
        else:
            arr = arr / TYPE_MAX[a['componentType']]
    return arr


def image_of(j, b, binoff):
    tex = None
    for mat in j.get('materials', []):
        tex = (mat.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
        if tex:
            break
    if not tex:
        return None
    img_idx = j['textures'][tex['index']]['source']
    im = j['images'][img_idx]
    bv = j['bufferViews'][im['bufferView']]
    raw = b[binoff + bv.get('byteOffset', 0): binoff + bv.get('byteOffset', 0) + bv['byteLength']]
    return Image.open(__import__('io').BytesIO(raw)).convert('RGB'), img_idx


def uv_stats(uv, tris):
    """UV area coverage, island count (connected by shared UV vertex ids is approximate), bbox."""
    lo = uv.min(axis=0)
    hi = uv.max(axis=0)
    a = uv[tris[:, 0]]
    b = uv[tris[:, 1]]
    c = uv[tris[:, 2]]
    area = 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))
    degenerate = float((area < 1e-12).mean())
    # connected components over triangle adjacency by shared UV position (rounded)
    key = np.round(uv * 4096).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    parent = np.arange(inv.max() + 1)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in tris:
        r = [find(inv[i]) for i in t]
        for x in r[1:]:
            if x != r[0]:
                parent[x] = r[0]
    islands = len({find(i) for i in range(len(parent))})
    return {'bbox': [float(v) for v in np.concatenate([lo, hi])], 'area': float(area.sum()),
            'deg_tris': round(degenerate * 100, 2), 'islands': islands,
            'out_of_unit': int(((uv < -0.01) | (uv > 1.01)).any(axis=1).sum())}


def sample_uv(img, uv, tris, spp=7):
    """Rasterise UV triangles (barycentric samples) and sample the image."""
    W, H = img.size
    pix = np.asarray(img, dtype=np.float64).reshape(H, W, 3)
    rng = np.random.default_rng(7)
    bary = np.array([[1 - 1 / 3 - 1 / 3, 1 / 3, 1 / 3]])
    # deterministic barycentric grid + jitter
    pts = []
    for i in range(1, spp):
        for jx in range(1, spp - i):
            k = spp - i - jx
            if k <= 0:
                continue
            pts.append([i / spp, jx / spp, k / spp])
    bary = np.array(pts)
    a, bb, c = uv[tris[:, 0]], uv[tris[:, 1]], uv[tris[:, 2]]
    su = (bary[None, :, 0, None] * a[:, None, :] + bary[None, :, 1, None] * bb[:, None, :]
          + bary[None, :, 2, None] * c[:, None, :])
    su = su.reshape(-1, 2)
    x = np.clip(np.floor(su[:, 0] * W).astype(int), 0, W - 1)
    y = np.clip(np.floor((1.0 - su[:, 1]) * H).astype(int), 0, H - 1)
    lum = (0.2126 * pix[y, x, 0] + 0.7152 * pix[y, x, 1] + 0.0722 * pix[y, x, 2])
    covered = np.zeros(len(su), dtype=bool)
    covered[:] = True
    return {'mean': float(lum.mean()), 'median': float(np.median(lum)),
            'p90': float(np.percentile(lum, 90)), 'lit_frac': float((lum > 25).mean() * 100)}


def report(path):
    j, b, binoff, gz = load_glb(path)
    mesh = j['meshes'][0]
    prim = mesh['primitives'][0]
    uv = accessor(j, b, binoff, prim['attributes']['TEXCOORD_0'])
    idx = accessor(j, b, binoff, prim['indices']).reshape(-1).astype(int)
    tris = idx.reshape(-1, 3)
    img, img_idx = image_of(j, b, binoff)
    pix = np.asarray(img, dtype=np.float64)
    lum = 0.2126 * pix[..., 0] + 0.7152 * pix[..., 1] + 0.0722 * pix[..., 2]
    s = sample_uv(img, uv, tris)
    us = uv_stats(uv, tris)
    print(f"{path.split('/')[-1].replace('.glb.gz', ''):18s} gz={gz/1024:6.1f}KB img[{img_idx}] {img.size[0]}x{img.size[1]} "
          f"img_mean={lum.mean():5.1f} img_med={np.median(lum):5.1f} | UV: bbox={[round(v,3) for v in us['bbox']]} "
          f"area={us['area']:.3f} islands={us['islands']} deg={us['deg_tris']}% out={us['out_of_unit']} | "
          f"UV-sampled mean={s['mean']:5.1f} med={s['median']:5.1f} p90={s['p90']:5.1f} lit>{25}={s['lit_frac']:4.1f}%")


for p in sys.argv[1:]:
    try:
        report(p)
    except Exception as e:
        print(p, 'ERROR', repr(e))
