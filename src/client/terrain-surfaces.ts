import * as THREE from 'three';

/**
 * Scanned ground-surface pass (ruins-builder).
 *
 * `world-scene` tags meshes it wants re-surfaced with `mesh.userData.surface`:
 *   - `'road'`   -> scanned country-road base colour + normal
 *   - `'cobble'` -> scanned cobblestone base colour + normal
 *   - `'ground'` -> existing `texture_ground_mud_grass.png` detail map, modulated by the
 *                   material's existing region tint
 *
 * The pass is deliberately defensive: files may not exist yet while asset-forge bakes in
 * parallel. A missing file simply leaves that slot untouched; the function never throws.
 * Materials are cloned per mesh so shared world materials are not mutated, and every texture
 * variant reuses the same loaded `THREE.Texture` source (clones share image + GPU upload).
 */

export type SurfaceKind = 'road' | 'cobble' | 'ground';

export const SURFACE_TEXTURES: Readonly<
  Record<SurfaceKind, { map: string; normal?: string; metresPerRepeat: number; normalStrength?: number }>
> = {
  road: {
    map: 'assets/textures/road_country_basecolor.jpg',
    normal: 'assets/textures/road_country_normal.png',
    metresPerRepeat: 4,
    normalStrength: 0.7
  },
  cobble: {
    map: 'assets/textures/cobblestone_basecolor.jpg',
    normal: 'assets/textures/cobblestone_normal.png',
    metresPerRepeat: 2.4,
    normalStrength: 0.9
  },
  ground: {
    map: 'assets/textures/texture_ground_mud_grass.png',
    metresPerRepeat: 7
  }
};

const BASE_URL: string = import.meta.env?.BASE_URL ?? '/';
const MAX_REPEAT = 64;
const ALL_SURFACES = Object.keys(SURFACE_TEXTURES) as SurfaceKind[];

type MaterialWithMaps = THREE.Material & {
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  color?: THREE.Color;
  normalScale?: THREE.Vector2;
};

interface SurfaceTextures {
  color: TextureVariants | null;
  normal: TextureVariants | null;
}

/** Cheap texture clones that share one uploaded source; only `repeat` differs per mesh. */
class TextureVariants {
  private readonly variants = new Map<string, THREE.Texture>();

  constructor(private readonly base: THREE.Texture) {}

  get(repeatX: number, repeatY: number): THREE.Texture {
    const key = `${repeatX}x${repeatY}`;
    const cached = this.variants.get(key);
    if (cached) return cached;
    // Texture.clone() keeps the same `source`, so no extra image download / GPU upload.
    const variant = this.base.clone();
    variant.wrapS = variant.wrapT = THREE.RepeatWrapping;
    variant.repeat.set(repeatX, repeatY);
    variant.anisotropy = this.base.anisotropy;
    variant.needsUpdate = true;
    this.variants.set(key, variant);
    return variant;
  }
}

function assetUrl(path: string): string {
  return `${BASE_URL}${path.replace(/^\/+/, '')}`;
}

/** Successful downloads are cached process-wide, so repeat passes never re-fetch (missing files may retry). */
const textureCache = new Map<string, THREE.Texture>();

function loadTexture(
  loader: THREE.TextureLoader,
  url: string,
  colorSpace: THREE.ColorSpace,
  anisotropy: number
): Promise<THREE.Texture | null> {
  const cached = textureCache.get(url);
  if (cached) {
    cached.anisotropy = anisotropy;
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    try {
      loader.load(
        url,
        (texture) => {
          try {
            texture.colorSpace = colorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = anisotropy;
            texture.needsUpdate = true;
            textureCache.set(url, texture);
            resolve(texture);
          } catch {
            resolve(null);
          }
        },
        undefined,
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
}

/** Repeat counts from the mesh's local geometry bounds, in world metres per texture tile. */
function repeatFromBounds(mesh: THREE.Mesh, metresPerRepeat: number): { x: number; y: number } {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  let extentX = 1;
  let extentY = 1;
  if (bounds) {
    extentX = Math.abs(bounds.max.x - bounds.min.x);
    const extentZ = Math.abs(bounds.max.z - bounds.min.z);
    // Boxes carry their length on local z; flipped planes carry it on local y instead.
    extentY = extentZ > 0.01 ? extentZ : Math.abs(bounds.max.y - bounds.min.y);
  }
  const toRepeat = (extent: number) => Math.max(1, Math.min(MAX_REPEAT, Math.round(extent / metresPerRepeat)));
  return { x: toRepeat(extentX), y: toRepeat(extentY) };
}

function applyToMesh(mesh: THREE.Mesh, surface: SurfaceKind, textures: SurfaceTextures, spec: (typeof SURFACE_TEXTURES)[SurfaceKind]): boolean {
  const repeat = repeatFromBounds(mesh, spec.metresPerRepeat);
  const color = textures.color?.get(repeat.x, repeat.y) ?? null;
  const normal = textures.normal?.get(repeat.x, repeat.y) ?? null;
  if (!color && !normal) return false;

  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const cloned = sourceMaterials.map((material) => {
    const copy = material.clone() as MaterialWithMaps;
    if (color) copy.map = color;
    if (normal) {
      copy.normalMap = normal;
      copy.normalScale = new THREE.Vector2(spec.normalStrength ?? 0.8, spec.normalStrength ?? 0.8);
    }
    // The scanned albedo carries the colour for roads/cobbles; keep (desaturated) region tint for ground.
    if (copy.color) {
      if (surface !== 'ground') {
        copy.color.setRGB(1, 1, 1);
      } else {
        // Neutralise most of the daylight-green region tint so moonlight reads blue-grey.
        const tint = copy.color;
        const luma = tint.r * 0.299 + tint.g * 0.587 + tint.b * 0.114;
        tint.lerp(new THREE.Color(luma * 1.06, luma * 1.12, luma * 1.24), 0.62);
        tint.multiplyScalar(1.35);
      }
    }
    copy.needsUpdate = true;
    return copy;
  });
  mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
  mesh.userData.surfaceTextured = true;
  return true;
}

/**
 * Loads the scanned surface textures and applies them to every `mesh.userData.surface`-tagged
 * mesh currently in the scene. Safe to call once after the world is built.
 */
const flatGroundCache = new Map<THREE.Texture, THREE.Texture>();
/**
 * The scanned mud/grass detail map is high-contrast and strongly green; multiplied by the dark
 * region tint under moonlight it reads as bright-green polygons against near-black shadow. Re-map
 * it to a low-contrast, cool blue-grey night albedo: the moss/soil luminance detail stays, but the
 * daylight-green saturation that fought the night palette goes. The green world colour then comes
 * from the grass/foliage instances rather than the ground itself.
 */
function flattenGroundTexture(source: THREE.Texture): THREE.Texture {
  const cached = flatGroundCache.get(source);
  if (cached) return cached;
  try {
    if (typeof document === 'undefined' || !source.image) return source;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return source;
    context.filter = 'blur(1.5px)';
    context.drawImage(source.image as CanvasImageSource, 0, 0, size, size);
    context.filter = 'none';
    const image = context.getImageData(0, 0, size, size);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      // Compress the luminance swing (0.42x around mid-grey) and cool it toward moonlight.
      const level = (luma - 128) * 0.42 + 96;
      data[i] = Math.max(0, Math.min(255, level * 0.82 + 10));
      data[i + 1] = Math.max(0, Math.min(255, level * 0.92 + 12));
      data[i + 2] = Math.max(0, Math.min(255, level * 1.02 + 14));
    }
    context.putImageData(image, 0, 0);
    const flattened = new THREE.CanvasTexture(canvas);
    flattened.colorSpace = THREE.SRGBColorSpace;
    flattened.wrapS = flattened.wrapT = THREE.RepeatWrapping;
    flattened.anisotropy = source.anisotropy;
    flattened.needsUpdate = true;
    flatGroundCache.set(source, flattened);
    return flattened;
  } catch {
    return source;
  }
}

export async function applySurfaceTextures(scene: THREE.Scene, maxAnisotropy: number): Promise<void> {
  try {
    const anisotropy = Math.max(1, Math.min(16, Math.floor(Number.isFinite(maxAnisotropy) ? maxAnisotropy : 1)));
    const loader = new THREE.TextureLoader();

    const loaded = new Map<SurfaceKind, SurfaceTextures>();
    await Promise.all(
      ALL_SURFACES.map(async (surface) => {
        const spec = SURFACE_TEXTURES[surface];
        const [color, normal] = await Promise.all([
          loadTexture(loader, assetUrl(spec.map), THREE.SRGBColorSpace, anisotropy),
          spec.normal ? loadTexture(loader, assetUrl(spec.normal), THREE.NoColorSpace, anisotropy) : Promise.resolve(null)
        ]);
        const flattened = surface === 'ground' && color ? flattenGroundTexture(color) : color;
        loaded.set(surface, {
          color: flattened ? new TextureVariants(flattened) : null,
          normal: normal ? new TextureVariants(normal) : null
        });
      })
    );

    const anyTexture = [...loaded.values()].some((set) => set.color || set.normal);
    if (!anyTexture) return;

    const targets: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const surface = object.userData?.surface;
      if (typeof surface !== 'string' || !Object.hasOwn(SURFACE_TEXTURES, surface)) return;
      if (object.userData.surfaceTextured === true) return;
      targets.push(object);
    });

    for (const mesh of targets) {
      try {
        const surface = mesh.userData.surface as SurfaceKind;
        const textures = loaded.get(surface);
        if (!textures) continue;
        applyToMesh(mesh, surface, textures, SURFACE_TEXTURES[surface]);
      } catch (error) {
        // A single odd material must not abort the whole pass.
        console.warn('Surface texture skipped for mesh', mesh.name, error);
      }
    }
  } catch (error) {
    console.warn('Scanned surface textures unavailable', error);
  }
}
