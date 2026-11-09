"""Render the home page's poster (the studio with no UI) and the pose-library thumbnails from its own live scene.

Serve the repo (python -m http.server 8160), then: python tools/landing_shots.py  (needs playwright + pillow)
"""
import asyncio, pathlib, io
from playwright.async_api import async_playwright
from PIL import Image
REPO = pathlib.Path(__file__).resolve().parent.parent
(REPO / "assets/poses").mkdir(exist_ok=True)
W, H = 1440, 900


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await br.new_page(viewport={"width": W, "height": H})
        await pg.goto("http://localhost:8160/index.html")
        await pg.wait_for_function("document.body.classList.contains('is-live') && window.__stage", timeout=120000, polling=500)
        await pg.evaluate("document.querySelectorAll('header, main, .posename').forEach((e) => e.style.visibility = 'hidden'); __stage.hold(0)")
        shot = lambda **kw: pg.screenshot(**kw)
        await pg.evaluate("__stage.pose('contrapposto')")
        await pg.wait_for_timeout(3000)
        Image.open(io.BytesIO(await shot())).convert("RGB").save(REPO / "assets/stage-poster.webp", quality=82, method=6)
        await pg.evaluate("__stage.word('')")
        side = int(H * 0.86); cx = int(W / 2 + 0.42 * 0.22 * W)  # the hero shot stands the figure right of centre
        for pid in ["run", "sit", "kneel", "jump", "squat", "bow"]:
            await pg.evaluate(f"__stage.pose('{pid}')")
            await pg.wait_for_timeout(3000)
            img = Image.open(io.BytesIO(await shot(clip={"x": cx - side / 2, "y": (H - side) / 2 + 20, "width": side, "height": side}))).convert("RGB")
            img.resize((360, 360), Image.LANCZOS).save(REPO / f"assets/poses/{pid}.webp", quality=84, method=6)
        await br.close()
        print("poster + 6 thumbnails written")

asyncio.run(main())
