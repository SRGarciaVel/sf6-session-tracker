"""
Derive the web brand assets from the official SST logo (docs/brand/sst-logo-original.webp).

Technical derivation only: no redrawing, recoloring or new effects.
  1. Background → transparency: the logo sits on a flat near-black background (~rgb(5,7,10)).
     Each pixel is "un-composited" from that background (alpha = strongest channel above the
     background, colour = (pixel − background) / alpha), so the result composited back over
     the same background reproduces the original pixel, glow included. Compression noise in the
     flat background (< ~4% alpha) is cleared.
  2. Symbol vs "SST": no straight cut exists (the symbol's streaks reach over the first S and
     the S's orange shard reaches under the symbol), so solid shapes are split by connected
     component (centroid left of the letters ⇒ symbol) and every glow pixel follows its
     nearest solid shape.
  3. Crops, resizes (Lanczos) and exports: WebP/PNG UI assets, favicon.ico, icon.png,
     apple-icon.png (opaque, app background) and a 1200×630 Open Graph image.

Not an app dependency. Run with: python3 -m pip install numpy scipy pillow
  python3 scripts/brand/build_brand_assets.py <fonts dir with BarlowCondensed-Bold.ttf, Barlow-Medium.ttf>
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/brand/sst-logo-original.webp"
PUBLIC = ROOT / "public/brand"
DOCS = ROOT / "docs/brand"
APP = ROOT / "src/app"
FONTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

APP_BG = (10, 11, 14)  # --color-bg in src/app/(app)/globals.css
NOISE_ALPHA = 10  # /255: background compression noise below this is cleared
SOLID_LUMA = 60  # solid shapes for the symbol/wordmark split
LETTERS_START_X = 600  # in source pixels: the first S starts right of this


def transparent(rgb: np.ndarray) -> np.ndarray:
    corners = np.concatenate(
        [rgb[:60, :60], rgb[-60:, -60:], rgb[:60, -60:], rgb[-60:, :60]]
    ).reshape(-1, 3)
    bg = np.median(corners, axis=0)
    lifted = np.clip((rgb - bg) / (255.0 - bg), 0, 1)
    alpha = lifted.max(axis=2)
    safe = np.where(alpha > 0, alpha, 1)[..., None]
    colour = np.clip(lifted / safe, 0, 1)
    a8 = alpha * 255
    # Smooth ramp instead of a hard step so soft glow edges don't band.
    a8 = np.clip((a8 - NOISE_ALPHA) * 255 / (255 - NOISE_ALPHA), 0, 255)
    out = np.dstack([colour * 255, a8]).round().astype(np.uint8)
    out[out[..., 3] == 0, :3] = 0
    return out


def split(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Masks (symbol, letters) over the whole image."""
    luma = rgba[..., :3].max(axis=2) * (rgba[..., 3] / 255.0)
    solid = luma > SOLID_LUMA
    labels, n = ndimage.label(solid, structure=np.ones((3, 3)))
    centroids = ndimage.center_of_mass(solid, labels, range(1, n + 1))
    is_symbol = np.zeros(n + 1, dtype=bool)
    for i, (_, cx) in enumerate(centroids, start=1):
        is_symbol[i] = cx < LETTERS_START_X
    # Every pixel (glow) belongs to its nearest solid shape.
    _, (iy, ix) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
    nearest = labels[iy, ix]
    symbol = is_symbol[nearest]
    return symbol, ~symbol


def crop_to_content(rgba: np.ndarray, pad: int) -> Image.Image:
    img = Image.fromarray(rgba, "RGBA")
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    assert box
    x0, y0, x1, y1 = box
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad))


def fit_height(img: Image.Image, height: int) -> Image.Image:
    width = round(img.width * height / img.height)
    return img.resize((width, height), Image.LANCZOS)


def square(img: Image.Image, size: int, bg=None, margin=0.08) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (*bg, 255) if bg else (0, 0, 0, 0))
    inner = round(size * (1 - 2 * margin))
    scale = inner / max(img.width, img.height)
    fitted = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    rgb = np.asarray(Image.open(SOURCE).convert("RGB")).astype(np.float64)
    rgba = transparent(rgb)
    symbol_mask, _ = split(rgba)

    full = crop_to_content(rgba, pad=4)
    symbol_rgba = rgba.copy()
    symbol_rgba[~symbol_mask, 3] = 0
    symbol = crop_to_content(symbol_rgba, pad=4)

    # UI assets (displayed at ≤ 48 px tall full logo / ≤ 40 px symbol; 3–4× for HiDPI).
    full_ui = fit_height(full, 160)
    symbol_ui = fit_height(symbol, 160)
    full_ui.save(PUBLIC / "sst-logo.webp", "WEBP", quality=90, method=6)
    symbol_ui.save(PUBLIC / "sst-symbol.webp", "WEBP", quality=90, method=6)
    # Lossless transparent masters (not served): docs, presentations, future assets.
    fit_height(full, 320).save(DOCS / "sst-logo.png", optimize=True)
    fit_height(symbol, 320).save(DOCS / "sst-symbol.png", optimize=True)

    # Icons: symbol only. Opaque app background keeps the white/blue strokes visible on light
    # browser chrome and iOS home screens (which do not support transparency).
    sym_sq = symbol
    square(sym_sq, 256, bg=APP_BG, margin=0.06).save(
        APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    square(sym_sq, 192, bg=APP_BG, margin=0.08).save(APP / "icon.png", optimize=True)
    square(sym_sq, 180, bg=APP_BG, margin=0.1).save(APP / "apple-icon.png", optimize=True)

    if FONTS:
        og = Image.new("RGBA", (1200, 630), (*APP_BG, 255))
        logo = fit_height(full, 190)
        og.alpha_composite(logo, ((1200 - logo.width) // 2, 120))
        draw = ImageDraw.Draw(og)
        title = ImageFont.truetype(str(FONTS / "BarlowCondensed-Bold.ttf"), 76)
        sub = ImageFont.truetype(str(FONTS / "Barlow-Medium.ttf"), 30)
        for text, font, y, fill in (
            ("SF6 Session Tracker", title, 345, (241, 244, 250)),
            ("Real-time Street Fighter 6 session tracking for streamers", sub, 445, (150, 160, 180)),
        ):
            w = draw.textlength(text, font=font)
            draw.text(((1200 - w) / 2, y), text, font=font, fill=fill)
        # Thin accent rule echoing the app's header line.
        for x in range(360, 840):
            t = (x - 360) / 480
            colour = tuple(round(a + (b - a) * t) for a, b in zip((255, 122, 26), (40, 160, 255)))
            draw.line([(x, 530), (x, 532)], fill=colour)
        og.convert("RGB").save(APP / "(app)/opengraph-image.png", optimize=True)

    for p in sorted([*PUBLIC.iterdir(), *DOCS.glob("sst-*.png"), APP / "favicon.ico", APP / "icon.png",
                     APP / "apple-icon.png", APP / "(app)/opengraph-image.png"]):
        if p.exists():
            with Image.open(p) as im:
                print(f"{p.relative_to(ROOT)}  {im.size[0]}×{im.size[1]}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
