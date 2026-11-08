"""Render the home page's stage poster and pose thumbnails from its own live stage.

Serve the repo (python -m http.server 8160), then: python tools/landing_shots.py  (needs playwright + pillow)
"""
import asyncio, pathlib, io
from playwright.async_api import async_playwright
from PIL import Image
REPO = pathlib.Path(__file__).resolve().parent.parent
(REPO / "assets/poses").mkdir(exist_ok=True)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await br.new_page(viewport={"width": 1800, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
        await pg.goto("http://localhost:8160/index.html")
        await pg.wait_for_function("!!window.__stage", timeout=120000, polling=500)
        await pg.evaluate("document.querySelector('.stage__cap').style.visibility='hidden'; __stage.hold(0); __stage.look('studio')")
        st = pg.locator("#stage")
        box = await st.bounding_box()
        for pid in ["run", "sit", "kneel", "jump", "squat", "bow", "contrapposto"]:
            await pg.evaluate(f"__stage.pose('{pid}')")
            await pg.wait_for_timeout(2500)
            img = Image.open(io.BytesIO(await st.screenshot())).convert("RGB")
            w, h = img.size
            if pid == "contrapposto":
                img.save(REPO / "assets/stage-poster.webp", quality=86, method=6); print("poster", img.size)
            else:
                s = min(w, h); x0 = (w - s) // 2
                img.crop((x0, h - s, x0 + s, h)).resize((360, 360), Image.LANCZOS).save(REPO / f"assets/poses/{pid}.webp", quality=84, method=6)
        print("stage box", box, "errors:", errs)
        await br.close()
asyncio.run(main())
