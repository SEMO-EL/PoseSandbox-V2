"""Contact sheet of the pose library: every preset from two angles, to check new poses by eye.

    python tools/serve.py 8161                      # in another terminal
    python tools/pose_sheet.py out.jpg [id id ...]  # no ids = the whole library   (needs playwright + pillow)
"""
import asyncio, io, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else "pose_sheet.jpg"
IDS = sys.argv[2:]
CELL = 300
VIEWS = [("2.2,1.25,3.6", "0,0.85,0"), ("-4.2,1.1,0.4", "0,0.85,0")]  # three-quarter front, from the figure's right


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await br.new_page(viewport={"width": CELL, "height": CELL})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        shots = []
        ids = None
        for view, look in VIEWS:
            await pg.goto(f"http://localhost:8161/tests/viewer.html?view={view}&look={look}")
            await pg.wait_for_function("!!window.render", timeout=60000)
            await pg.evaluate("import('/poses/presets.js').then((m) => { window.P = m; })")
            await pg.wait_for_function("!!window.P")
            ids = IDS or await pg.evaluate("P.PRESETS.map((p) => p.id)")
            row = []
            for pid in ids:
                ok = await pg.evaluate("(id) => { const p = P.PRESETS.find((x) => x.id === id); if (!p) return false; P.applyPreset(M, p); render(); return true; }", pid)
                if not ok:
                    print("no preset", pid)
                    continue
                row.append(Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"))
            shots.append(row)
        await br.close()
        n = len(shots[0])
        cols = min(n, 4)
        rows = (n + cols - 1) // cols
        sheet = Image.new("RGB", (cols * CELL * 2, rows * CELL), (11, 15, 23))
        d = ImageDraw.Draw(sheet)
        for i in range(n):
            x, y = (i % cols) * CELL * 2, (i // cols) * CELL
            sheet.paste(shots[0][i], (x, y))
            sheet.paste(shots[1][i], (x + CELL, y))
            d.text((x + 8, y + 6), ids[i], fill=(255, 255, 255))
        sheet.save(OUT, quality=85)
        print("wrote", OUT, f"({n} poses)", errors[:2] or "")


asyncio.run(main())
