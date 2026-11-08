"""End-to-end smoke test of the editor in headless Chromium (Python + Playwright).

    python -m http.server 8160          # from the repo root, in another terminal
    python tests/smoke.py [http://localhost:8160]

Prints one line per check and exits non-zero if any fails.
"""
import asyncio, sys, struct
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8160").rstrip("/")
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = await br.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(BASE + "/app.html")
        await pg.evaluate("localStorage.clear()")
        await pg.reload()
        await pg.wait_for_timeout(2500)

        # click the figure's chest → something is selected
        box = await pg.locator("#c").bounding_box()
        await pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.38)
        await pg.wait_for_timeout(200)
        sel = await pg.text_content("#selKind")
        check("clicking the figure selects a body part", sel not in ("None", ""), sel)

        # v1 bug: Backspace / number keys in Notes acted on the scene
        await pg.click("summary:has-text('Props')")
        await pg.click("#propButtons button:has-text('Cube')")
        await pg.click("summary:has-text('Saved poses')")
        await pg.click("#poseNotes")
        await pg.keyboard.type("arm up 3")
        await pg.keyboard.press("Backspace")
        kind = await pg.text_content("#selKind")
        mode_ok = await pg.get_attribute("[data-mode='rotate']", "aria-pressed")
        check("typing in Notes no longer deletes the prop or switches mode", kind == "Cube" and mode_ok == "true", f"selected={kind}")

        # custom light: add, edit, undo
        await pg.click("summary:has-text('Lighting')")
        await pg.click("#btnAddSpot")
        n = await pg.locator("#lightList li").count()
        editor = await pg.is_visible("#lightEditor")
        await pg.fill("#leIntensity", "40")
        await pg.dispatch_event("#leIntensity", "change")
        out = await pg.text_content("#leIntensityOut")
        check("spot light added with an editor", n == 1 and editor and out == "40", f"lights={n} brightness={out}")
        await pg.click("#c", position={"x": 5, "y": 5})  # focus the view, not a field
        await pg.keyboard.press("Control+z")
        await pg.keyboard.press("Control+z")
        n2 = await pg.locator("#lightList li").count()
        check("undo removes the light again", n2 == 0, f"lights={n2}")
        await pg.keyboard.press("Control+Shift+z")
        await pg.keyboard.press("Control+Shift+z")
        check("redo brings it back", await pg.locator("#lightList li").count() == 1)

        # export 2×: a PNG twice the view size, no gizmo (checked by size only)
        await pg.click("#btnExport")
        async with pg.expect_download() as dl:
            await pg.click("#btnDownloadPng")
        path = await (await dl.value).path()
        head = open(path, "rb").read(24)
        w, h = struct.unpack(">II", head[16:24])
        cw = await pg.evaluate("document.getElementById('c').clientWidth")
        check("Export PNG at 2×", head[:8] == b"\x89PNG\r\n\x1a\n" and abs(w - cw * 2) <= 2, f"{w}x{h} for a {cw}px view")

        # gallery + session restore
        await pg.keyboard.press("Control+s")
        tiles = await pg.locator("#poseGallery .tile").count()
        check("Ctrl+S saves to the gallery", tiles == 1)
        await pg.wait_for_timeout(600)
        await pg.reload()
        await pg.wait_for_timeout(2500)
        lights = await pg.locator("#lightList li").count()
        notes = await pg.input_value("#poseNotes")
        check("the session survives a reload", lights == 1 and notes.startswith("arm up"), f"lights={lights} notes={notes!r}")

        check("no page errors", not errors, "; ".join(errors[:3]))

        # phone: the view fills the screen, no sideways scroll
        m = await br.new_context(viewport={"width": 375, "height": 812}, is_mobile=True, has_touch=True)
        mp = await m.new_page()
        await mp.goto(BASE + "/app.html")
        await mp.wait_for_timeout(2500)
        dims = await mp.evaluate("({c: document.getElementById('c').getBoundingClientRect().height, w: document.documentElement.scrollWidth})")
        check("phone: canvas visible, no horizontal scroll", dims["c"] > 500 and dims["w"] <= 375, str(dims))
        await br.close()
    sys.exit(0 if all(results) else 1)


asyncio.run(main())
