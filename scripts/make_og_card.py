"""Generate the Open Graph / Twitter social card for Wetalk.

Renders assets/og-card.png (1200x630) in the landing-page light theme
(cream background, deep-green serif headline) so links shared on social
media unfurl with an on-brand preview. Pure Pillow, no other dependencies.

Usage:
    python scripts/make_og_card.py            # writes assets/og-card.png
    python scripts/make_og_card.py --out x.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630

# Landing light-theme tokens (css/light.css)
CREAM = "#F7F4EC"
CREAM_DARK = "#EEEADD"
HEADING = "#173B31"
ACCENT = "#2A5A4E"
TEXT_MUTED = "#5C665F"
BORDER = "#CFC6AE"
TRACK = "#E1DAC8"

FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts"), Path("/Library/Fonts")]


def _font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    """Load the first available font file at the given size."""
    for folder in FONT_DIRS:
        for name in candidates:
            path = folder / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def _rounded_gradient_square(size: int, radius: int, top: str, bottom: str) -> Image.Image:
    """Rounded square filled with a top-left to bottom-right two-colour gradient."""
    mask = Image.linear_gradient("L").rotate(-45).resize((size, size))
    gradient = Image.composite(
        Image.new("RGB", (size, size), top),
        Image.new("RGB", (size, size), bottom),
        mask,
    )
    rounded = Image.new("L", (size, size), 0)
    ImageDraw.Draw(rounded).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(gradient, (0, 0), rounded)
    return out


def build_card() -> Image.Image:
    """Compose the full 1200x630 card and return the image."""
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # Subtle inset frame, echoing the app icon's inner border.
    d.rounded_rectangle([24, 24, W - 25, H - 25], radius=28, outline=BORDER, width=3)

    # Brand row: green rounded square with a white serif W, then the wordmark.
    mark_size, mark_x, mark_y = 88, 72, 66
    mark = _rounded_gradient_square(mark_size, 22, ACCENT, HEADING)
    img.paste(mark, (mark_x, mark_y), mark)
    w_font = _font(["timesbd.ttf", "georgiab.ttf", "DejaVuSerif-Bold.ttf"], 52)
    d.text((mark_x + mark_size / 2, mark_y + mark_size / 2 - 2), "W",
           font=w_font, fill="#FFFFFF", anchor="mm")
    name_font = _font(["timesbd.ttf", "georgiab.ttf", "DejaVuSerif-Bold.ttf"], 44)
    d.text((mark_x + mark_size + 22, mark_y + mark_size / 2), "Wetalk",
           font=name_font, fill=HEADING, anchor="lm")

    # Headline.
    head_font = _font(["timesbd.ttf", "georgiab.ttf", "DejaVuSerif-Bold.ttf"], 76)
    d.text((72, 240), "Practice out loud.", font=head_font, fill=HEADING)
    d.text((72, 330), "Score on the real rubric.", font=head_font, fill=ACCENT)

    # Sub-lines.
    sub_font = _font(["times.ttf", "georgia.ttf", "DejaVuSerif.ttf"], 33)
    d.text((72, 448), "Impromptu Speech  \u00b7  Vericant Interview  \u00b7  TOEFL Speaking",
           font=sub_font, fill=TEXT_MUTED)
    d.text((72, 498), "Free in your browser \u2014 AI examiner feedback included.",
           font=sub_font, fill=TEXT_MUTED)

    # Score ring on the right, echoing the hero mock's overall score.
    cx, cy, r, lw = 985, 330, 118, 20
    d.arc([cx - r, cy - r, cx + r, cy + r], 0, 360, fill=TRACK, width=lw)
    d.arc([cx - r, cy - r, cx + r, cy + r], -90, -90 + int(0.84 * 360), fill=ACCENT, width=lw)
    ring_font = _font(["timesbd.ttf", "georgiab.ttf", "DejaVuSerif-Bold.ttf"], 88)
    d.text((cx, cy - 14), "4.2", font=ring_font, fill=HEADING, anchor="mm")
    cap_font = _font(["times.ttf", "georgia.ttf", "DejaVuSerif.ttf"], 28)
    d.text((cx, cy + 62), "overall / 5", font=cap_font, fill=TEXT_MUTED, anchor="mm")

    # Footer band with the URL.
    d.rectangle([24, H - 96, W - 24, H - 25], fill=CREAM_DARK)
    d.rounded_rectangle([24, 24, W - 25, H - 25], radius=28, outline=BORDER, width=3)
    url_font = _font(["timesbd.ttf", "georgiab.ttf", "DejaVuSerif-Bold.ttf"], 34)
    d.text((W / 2, H - 60), "junlinpeng.github.io/wetalk", font=url_font,
           fill=ACCENT, anchor="mm")

    return img


def main() -> None:
    """Parse arguments and write the card to disk."""
    parser = argparse.ArgumentParser(description="Render the Wetalk social card PNG.")
    default_out = Path(__file__).resolve().parent.parent / "assets" / "og-card.png"
    parser.add_argument("--out", type=Path, default=default_out,
                        help="Output PNG path (default: assets/og-card.png).")
    args = parser.parse_args()

    card = build_card()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    card.save(args.out, "PNG", optimize=True)
    print(f"Wrote {args.out} ({card.size[0]}x{card.size[1]})")


if __name__ == "__main__":
    main()
