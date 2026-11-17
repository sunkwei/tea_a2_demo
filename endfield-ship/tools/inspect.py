"""
截图体检工具：把 PNG 变成可量化的信息（区域亮度 / 构图 / ASCII 预览）

    python endfield-ship/tools/inspect.py <png...> [--crop x0,y0,x1,y1] [--ascii W]

示例：
    # 各区域亮度体检
    python endfield-ship/tools/inspect.py endfield-ship/tools/shots/05-overview.png

    # 放大看某个区域（用 ASCII 直接读，不占用图片配额）
    python endfield-ship/tools/inspect.py shot.png --crop 0.33,0.16,0.52,0.50 --ascii 110
"""
import sys
from PIL import Image

CHARS = " .:-=+*#%@"


def region(im, x0, y0, x1, y1):
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(im.width, x1), min(im.height, y1)
    px = list(im.crop((x0, y0, x1, y1)).convert("L").getdata())
    if not px:
        return {"avg": 0, "max": 0}
    return {"avg": round(sum(px) / len(px), 1), "max": max(px)}


def ascii_art(im, width):
    height = max(1, int(width * im.height / im.width / 2.1))
    small = im.convert("L").resize((width, height))
    px = small.load()
    for y in range(height):
        print("".join(CHARS[min(len(CHARS) - 1, px[x, y] * len(CHARS) // 256)] for x in range(width)))


args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = [a for a in sys.argv[1:] if a.startswith("--")]
crop = None
ascii_w = 0
for f in flags:
    if f.startswith("--crop"):
        crop = f.split("=", 1)[1] if "=" in f else flags[flags.index(f) + 1]
    if f.startswith("--ascii"):
        ascii_w = int(f.split("=", 1)[1]) if "=" in f else 0

for path in args:
    im = Image.open(path).convert("RGB")
    W, H = im.size
    print(f"\n=== {path.split(chr(92))[-1].split('/')[-1]}  ({W}x{H}) ===")

    if crop:
        x0, y0, x1, y1 = (float(v) for v in crop.split(","))
        box = im.crop((int(W * x0), int(H * y0), int(W * x1), int(H * y1)))
        print(f"裁剪 {x0},{y0} → {x1},{y1}")
        if ascii_w:
            ascii_art(box, ascii_w)
        continue

    gray = im.convert("L")
    hist = gray.histogram()
    total = sum(hist)
    blown = sum(hist[249:])
    dark = sum(hist[:12])

    print(f"整体亮度  {region(im, 0, 0, W, H)}")
    print(f"舷窗区域  {region(im, int(W * .27), int(H * .32), int(W * .80), int(H * .60))}")
    print(f"行星区域  {region(im, int(W * .28), int(H * .40), int(W * .45), int(H * .62))}")
    print(f"天花板    {region(im, int(W * .20), 0, int(W * .80), int(H * .20))}")
    print(f"地面前景  {region(im, int(W * .20), int(H * .80), int(W * .80), H)}")
    print(f"过曝占比  {blown / total * 100:.2f}%   死黑占比 {dark / total * 100:.2f}%")

    if ascii_w:
        ascii_art(im, ascii_w)
