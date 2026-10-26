import json, os, sys
from PIL import Image, ImageEnhance

RAW = "/tmp/cov-raw"
OUT = "/mnt/c/Users/Administrator/prediction-arena/frontend/public/covers"

# (source, output name, horizontal focus 0..1, contrast, color)
PICKS = [
    ("crypto.jpg", "crypto", 0.5, 1.0, 1.0),          # existing unsplash
    ("football2-0.jpg", "football", 0.5, 1.10, 1.12),  # night crowd + pitch, CC BY 4.0
    ("basketball-0.png", "basketball", 0.5, 1.10, 1.12),
    ("esports-0.jpg", "esports", 0.10, 1.06, 1.08),   # VCT arena, crop left of the logo
    ("f1-0.jpg", "motorsport", 0.42, 1.08, 1.10),
    ("capitol-3.jpg", "capitol", 0.5, 1.06, 1.05),
    ("eu2-0.jpg", "eu", 0.5, 1.05, 1.05),
    ("gold2-3.jpg", "gold", 0.5, 1.10, 1.10),
    ("ai-lab-1.jpg", "ai-lab", 0.5, 1.05, 1.10),
    ("ai-neural-0.jpg", "neural", 0.5, 1.05, 1.12),
    ("meme-3.jpg", "meme", 0.5, 1.06, 1.15),
    ("chain-2.jpg", "chain", 0.5, 1.05, 1.08),
    ("macro.jpg", "macro", 0.5, 1.0, 1.0),
    ("space.jpg", "space", 0.5, 1.0, 1.0),
]

W, H = 1600, 900
SW, SH = 640, 360
made = []
only = set(sys.argv[1:])
for src, name, focus, contrast, color in PICKS:
    if only and name not in only:
        continue
    path = os.path.join(RAW, src) if not src.startswith(("crypto", "macro", "space")) else os.path.join(OUT, src)
    if not os.path.exists(path):
        print("MISSING", path)
        continue
    im = Image.open(path).convert("RGB")
    w, h = im.size
    target = W / H
    if w / h > target:                      # too wide → crop width, honour focus
        nw = int(h * target)
        x = int(max(0, min(w - nw, (w - nw) * focus)))
        im = im.crop((x, 0, x + nw, h))
    else:                                   # too tall → crop height from the top third
        nh = int(w / target)
        y = int(max(0, min(h - nh, (h - nh) * 0.35)))
        im = im.crop((0, y, w, y + nh))
    im = im.resize((W, H), Image.LANCZOS)
    im = ImageEnhance.Contrast(im).enhance(contrast)
    im = ImageEnhance.Color(im).enhance(color)
    # crush the blacks a touch so text layers always win
    im = Image.eval(im, lambda v: int(v * 0.94))
    im.save(os.path.join(OUT, f"{name}.jpg"), "JPEG", quality=80, optimize=True, progressive=True)
    sm = im.resize((SW, SH), Image.LANCZOS)
    sm.save(os.path.join(OUT, f"{name}-sm.jpg"), "JPEG", quality=80, optimize=True, progressive=True)
    made.append((name, os.path.getsize(os.path.join(OUT, f"{name}.jpg")), os.path.getsize(os.path.join(OUT, f"{name}-sm.jpg"))))

for n, a, b in made:
    print(f"{n:12s} {a//1024:4d}KB  sm {b//1024:3d}KB")
print("total", len(made))
