"""Fix the Vostok texture atlas:
 - complete the clipped 'ВОСТОК' and '8K72K' texts (redrawn, two copies
   aligned with the 'СССР' copies on opposite sides)
 - add the USSR state emblem (hammer & sickle) to the payload fairing,
   replacing the two small stars there (stars remain on the boosters)
Background is restored with a vertical-streak-aware fill (column copy from
a clean row above, since the metal is brushed vertically).
"""
from PIL import Image, ImageDraw, ImageFont
import math

SRC = '/home/tkleisas/Projects/bokontep.gr/three/assets/textures/vostok_basecolor.png'
im = Image.open(SRC).convert('RGB')
W, H = im.size
RED = (170, 36, 32)
GREY = (110, 112, 112)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def erase(x0, y0, x1, y1, src_dy=90):
    """fill rect with the column content from src_dy pixels above"""
    for y in range(y0, y1):
        sy = y - src_dy
        for x in range(x0, x1):
            im.putpixel((x, y), im.getpixel((x, sy)))

def text_centered(s, cx, cy, size, color, spacing=0):
    f = ImageFont.truetype(FONT, size)
    d = ImageDraw.Draw(im)
    widths = []
    for ch in s:
        b = d.textbbox((0, 0), ch, font=f)
        widths.append(b[2] - b[0])
    total = sum(widths) + spacing * (len(s) - 1)
    x = cx - total / 2
    asc, desc = f.getmetrics()
    y = cy - (asc + desc) / 2
    for ch, w in zip(s, widths):
        d.text((x, y), ch, font=f, fill=color)
        x += w + spacing

# ---- 1. ВОСТОК: erase the row (incl. clipped 2nd copy), redraw complete --
erase(1000, 1380, 3500, 1450)
text_centered('ВОСТОК', 860, 1415, 66, RED, spacing=6)
text_centered('ВОСТОК', 2376, 1415, 66, RED, spacing=6)

# ---- 2. 8K72K: same treatment ---------------------------------------------
erase(1400, 2605, 3500, 2670)
text_centered('8K72K', 860, 2638, 58, GREY, spacing=4)
text_centered('8K72K', 2376, 2638, 58, GREY, spacing=4)

# ---- 3. state emblem on the fairing ---------------------------------------
# authentic hammer & sickle (Wikimedia Commons, public domain), tinted to
# the atlas red for consistency
emblem = Image.open('/home/tkleisas/Projects/bokontep.gr/three/tools/emblem_source.png').convert('RGBA')
emblem = emblem.resize((400, 400), Image.LANCZOS)
px = emblem.load()
for yy in range(400):
    for xx in range(400):
        r, g, b, a = px[xx, yy]
        if a > 0:
            px[xx, yy] = (RED[0], RED[1], RED[2], a)

# erase the two small fairing stars, then paste two emblems on opposite sides
erase(150, 340, 2000, 588, src_dy=160)
erase(150, 588, 2000, 620, src_dy=-32)
im.paste(emblem, (870 - 200, 190), emblem)
im.paste(emblem, (2610 - 200, 190), emblem)

im.save(SRC)
print('saved', SRC)
# write a preview crop for inspection
im.crop((0, 0, 3500, 800)).resize((1400, 320)).save('/tmp/atlas_fairing.png')
im.crop((0, 1300, 3500, 1500)).resize((1400, 80)).save('/tmp/atlas_vostok.png')
im.crop((0, 2560, 3500, 2720)).resize((1400, 64)).save('/tmp/atlas_8k72k.png')
print('previews written')
