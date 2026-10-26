"""Prepare class-graded PBR textures for the Cursed Knight character variants."""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(r"C:\Users\neil\Desktop\AIprojects\swords")
SOURCE = ROOT / "temp_chars" / "cursed-knight-ue5-character-game-ready" / "textures"
OUT = ROOT / "temp_sketchlab" / "cursed_textures"

MATERIALS = {
    "Outfit": ("Cursed_Knight", "1001"),
    "Body Armor": ("Cursed_Knight", "1002"),
    "Helmet": ("Cursed_Knight", "1003"),
    "Primary Armors": ("Cursed_Knight", "1013"),
    "Secoundary Armors": ("Cursed_Knight", "1011"),
    "Belts": ("Cursed_Knight", "1012"),
    "Head": ("Skin", "1001"),
}

PALETTES = {
    "templar": {"rgb": (1.08, 1.04, 0.94), "brightness": 1.10, "sat": 0.90, "rough": 0.92, "metal": 1.0},
    "hero": {"rgb": (0.96, 1.03, 1.10), "brightness": 1.20, "sat": 0.76, "rough": 0.82, "metal": 1.0},
    "ally": {"rgb": (0.82, 0.96, 1.18), "brightness": 0.98, "sat": 0.88, "rough": 0.96, "metal": 0.95},
    "berserker": {"rgb": (1.12, 0.74, 0.64), "brightness": 0.86, "sat": 0.94, "rough": 1.12, "metal": 0.85},
    "ranger": {"rgb": (0.78, 1.04, 0.72), "brightness": 0.91, "sat": 0.90, "rough": 1.20, "metal": 0.40},
    "survivor": {"rgb": (1.03, 0.96, 0.80), "brightness": 0.98, "sat": 0.76, "rough": 1.28, "metal": 0.18},
    "fallen": {"rgb": (0.84, 0.70, 1.10), "brightness": 0.76, "sat": 0.90, "rough": 1.02, "metal": 0.95},
}


def read(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def save_rgb(arr, path, size, quality):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(path, "JPEG", quality=quality, optimize=True, subsampling=1)


def source_path(material, kind):
    prefix, tile = MATERIALS[material]
    return SOURCE / f"{prefix}_{kind}.{tile}.png"


def main():
    for name, cfg in PALETTES.items():
        for material in MATERIALS:
            base = read(source_path(material, "BaseColor"))
            luma = base @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            base = luma[..., None] + (base - luma[..., None]) * cfg["sat"]
            base *= cfg["brightness"] * np.array(cfg["rgb"], dtype=np.float32)
            if material == "Head":
                base = np.clip(base, 0.22, 0.92)
            save_rgb(base, OUT / name / material / "basecolor.jpg", 512, 82)

            normal = read(source_path(material, "Normal"))
            normal[..., 1] = 1.0 - normal[..., 1]
            save_rgb(normal, OUT / name / material / "normal.jpg", 256, 86)

            roughness = read(source_path(material, "Roughness"))[..., 0]
            metallic_path = source_path(material, "Metallic")
            metallic = read(metallic_path)[..., 0] if metallic_path.exists() else np.zeros_like(roughness)
            orm = np.stack([
                np.ones_like(roughness),
                np.clip(roughness * cfg["rough"], 0.08, 1.0),
                np.clip(metallic * cfg["metal"], 0.0, 1.0),
            ], axis=-1)
            save_rgb(orm, OUT / name / material / "orm.jpg", 256, 84)
        print(f"prepared {name}: {len(MATERIALS)} PBR material sets")


if __name__ == "__main__":
    main()
