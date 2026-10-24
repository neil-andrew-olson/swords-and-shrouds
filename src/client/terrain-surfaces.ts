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
        // Neutralise most of the daylight-green region tint so moonlight reads blue-grey, and cool
        // the remainder slightly; scene.ts may tint on top of this, so keep the shift moderate.
        const tint = copy.color;
        const luma = tint.r * 0.299 + tint.g * 0.587 + tint.b * 0.114;
        tint.lerp(new THREE.Color(luma * 1.02, luma * 1.1, luma * 1.3), 0.66);
        tint.multiplyScalar(1.28);
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
const remapCache = new WeakMap<THREE.Texture, THREE.Texture>();

type ChannelRemap = (red: number, green: number, blue: number) => readonly [number, number, number];

const clampByte = (value: number) => Math.max(0, Math.min(255, value));
const lumaOf = (red: number, green: number, blue: number) => red * 0.299 + green * 0.587 + blue * 0.114;

/**
 * Canvas remap for scanned albedo maps: keeps the luminance detail but rewrites the palette.
 * Used for the night ground pass and to turn the country-road scan into grey stone. Missing DOM
 * (tests / non-browser) or an unloaded image simply returns the source texture untouched.
 */
function remapTexture(source: THREE.Texture, size: number, blur: string, remap: ChannelRemap): THREE.Texture {
  const cached = remapCache.get(source);
  if (cached) return cached;
  try {
    if (typeof document === 'undefined' || !source.image) return source;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return source;
    context.filter = blur;
    context.drawImage(source.image as CanvasImageSource, 0, 0, size, size);
    context.filter = 'none';
    const image = context.getImageData(0, 0, size, size);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue] = remap(data[index], data[index + 1], data[index + 2]);
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
    }
    context.putImageData(image, 0, 0);
    const remapped = new THREE.CanvasTexture(canvas);
    remapped.colorSpace = THREE.SRGBColorSpace;
    remapped.wrapS = remapped.wrapT = THREE.RepeatWrapping;
    remapped.anisotropy = source.anisotropy;
    remapped.needsUpdate = true;
    remapCache.set(source, remapped);
    return remapped;
  } catch {
    return source;
  }
}

/**
 * Night ground (batch 2026-10B): the scanned mud/grass detail map is high-contrast and strongly
 * green, and multiplied by the dark region tint it reads as bright-green polygons against the long
 * castle shadow. Compress the luminance swing, lower the mid-point slightly and pull the palette
 * toward cool blue-grey: moss/soil detail stays, the daylight-green saturation goes. The green of
 * the world then comes from the grass/foliage instances rather than the ground itself.
 */
function nightGroundRemap(red: number, green: number, blue: number): readonly [number, number, number] {
  const level = (lumaOf(red, green, blue) - 128) * 0.36 + 90;
  return [clampByte(level * 0.79 + 8), clampByte(level * 0.9 + 10), clampByte(level * 1.03 + 13)];
}

/**
 * Country road -> grey stone (batch 2026-10B): desaturate the scanned earth tones toward a neutral
 * cool grey and compress contrast slightly, keeping all the scan detail. world-scene still
 * multiplies the material colour down in scene.ts, so this stays moderately bright: the detail
 * carries the read, not the exposure.
 */
function greyStoneRemap(red: number, green: number, blue: number): readonly [number, number, number] {
  const level = (lumaOf(red, green, blue) - 128) * 0.84 + 124;
  return [clampByte(level * 0.96 + 4), clampByte(level + 6), clampByte(level * 1.04 + 9)];
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
        // Ground -> cool low-contrast night albedo; road -> grey stone; cobble keeps its scan as-is.
        const mapped =
          !color || surface === 'cobble'
            ? color
            : surface === 'ground'
              ? remapTexture(color, 512, 'blur(1.5px)', nightGroundRemap)
              : remapTexture(color, 1024, 'blur(0.4px)', greyStoneRemap);
        loaded.set(surface, {
          color: mapped ? new TextureVariants(mapped) : null,
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
