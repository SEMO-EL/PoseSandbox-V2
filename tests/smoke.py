"""End-to-end smoke test of the editor in headless Chromium (Python + Playwright).

    python tools/serve.py 8161          # in another terminal
    python tests/smoke.py [http://localhost:8161]

Prints one line per check and exits non-zero if any fails.
"""
import asyncio, sys, struct
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8161").rstrip("/")
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = await br.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True, permissions=["clipboard-read", "clipboard-write"])
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

        # a second figure: added, undone, redone
        await pg.click("summary:has-text('Figure')")
        await pg.click("#btnAddFigure")
        two = await pg.text_content("#figCount")
        await pg.click("#c", position={"x": 5, "y": 5})
        await pg.keyboard.press("Control+z")
        one = await pg.text_content("#figCount")
        await pg.keyboard.press("Control+Shift+z")
        again = await pg.text_content("#figCount")
        check("add a figure, undo, redo", "of 2" in two and one == "One figure" and "of 2" in again, f"{two} / {one} / {again}")
        await pg.keyboard.press("Control+z")

        # drag-to-pose: pulling a hand changes the pose and can be undone
        before = await pg.evaluate("localStorage.getItem('posesandbox_session_v2')")
        await pg.evaluate("document.querySelector(\"[data-view='front']\").click(); document.getElementById('btnFrame').click()")
        await pg.wait_for_timeout(700)
        box = await pg.locator("#c").bounding_box()
        hx, hy = await pg.evaluate("window.__ps.screenOf('l_wrist')")
        gx, gy = await pg.evaluate("window.__ps.screenOf('l_index1')")  # grab the knuckles: fingers pull the hand
        await pg.mouse.move(box["x"] + gx, box["y"] + gy)
        await pg.mouse.down()
        await pg.mouse.move(box["x"] + gx - 60, box["y"] + gy - 90, steps=8)
        await pg.mouse.up()
        sel = await pg.text_content("#selKind")
        moved = await pg.evaluate("window.__ps.screenOf('l_wrist')")
        check("dragging a hand pulls the arm", sel == "Right hand" and abs(moved[0] - (hx - 60)) < 12 and abs(moved[1] - (hy - 90)) < 12, f"{sel}, hand at {moved} from {[hx, hy]}")

        # looks: the ink picture is white paper with dark lines; a square guide crops the export; flip mirrors it
        await pg.select_option("#lookSelect", "ink")
        await pg.select_option("#guideSelect", "1:1")
        ink = await pg.evaluate("""(async () => {
            const im = new Image(); im.src = window.__ps.exportUrl(); await im.decode();
            const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
            const g = c.getContext('2d'); g.drawImage(im, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let white = 0, dark = 0, left = 0, right = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i] > 240) white++;
                else if (d[i] < 60) { dark++; ((i / 4) % c.width < c.width / 2) ? left++ : right++; }
            }
            return { w: c.width, h: c.height, white: white / (d.length / 4), dark: dark / (d.length / 4), left, right };
        })()""")
        check("Ink look exports line art, cropped square", ink["w"] == ink["h"] and ink["white"] > 0.7 and 0.002 < ink["dark"] < 0.2, str(ink))
        await pg.click("#btnFlip")
        flipped = await pg.evaluate("""(async () => {
            const im = new Image(); im.src = window.__ps.exportUrl(); await im.decode();
            const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
            const g = c.getContext('2d'); g.drawImage(im, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let left = 0, right = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] < 60) ((i / 4) % c.width < c.width / 2) ? left++ : right++;
            return { left, right };
        })()""")
        check("Flip mirrors the export", abs(flipped["left"] - ink["right"]) < 0.05 * max(1, ink["right"]) and ink["left"] != ink["right"], f"before L{ink['left']} R{ink['right']}, after L{flipped['left']} R{flipped['right']}")
        await pg.click("#btnFlip")
        await pg.select_option("#lookSelect", "shaded")
        await pg.select_option("#guideSelect", "none")

        # gesture practice: poses change, the scene comes back afterwards
        await pg.wait_for_timeout(600)
        mine = await pg.evaluate("localStorage.getItem('posesandbox_session_v2')")
        await pg.click("#btnPractice")
        await pg.click("#practiceDialog label:has-text('30 s')")
        await pg.click("#btnPracticeStart")
        on = await pg.evaluate("document.body.classList.contains('is-practice') && !document.getElementById('practice').hidden")
        first = await pg.evaluate("JSON.stringify(window.__ps.pose())")
        await pg.keyboard.press("ArrowRight")
        second = await pg.evaluate("JSON.stringify(window.__ps.pose())")
        count = await pg.text_content("#prCount")
        await pg.keyboard.press("ArrowLeft")
        back = await pg.evaluate("JSON.stringify(window.__ps.pose())")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(700)
        after = await pg.evaluate("localStorage.getItem('posesandbox_session_v2')")
        off = await pg.evaluate("!document.body.classList.contains('is-practice') && document.getElementById('practice').hidden")
        check("practice: new poses on demand, back returns the same pose, the scene is restored", on and off and first != second and back == first and count.startswith("2 /") and after == mine, f"count={count} restored={after == mine}")

        # share link: copy it, change the pose, open the link: the shared pose is back
        shared = await pg.evaluate("JSON.stringify(window.__ps.pose())")
        await pg.evaluate("document.getElementById('btnShare').click()")
        await pg.wait_for_timeout(500)
        link = await pg.evaluate("navigator.clipboard.readText()")
        await pg.evaluate("[...document.querySelectorAll('#presetGrid .tile')].find((t) => t.textContent === 'Archer').click()")
        changed = await pg.evaluate("JSON.stringify(window.__ps.pose())")
        await pg.evaluate("(u) => { location.hash = u.slice(u.indexOf('#')); }", link)
        await pg.wait_for_timeout(600)
        reopened = await pg.evaluate("JSON.stringify(window.__ps.pose())")
        check("a copied link reopens the scene", "#p=z" in link and changed != shared and reopened == shared and not await pg.evaluate("location.hash"), f"link is {len(link)} characters")

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
