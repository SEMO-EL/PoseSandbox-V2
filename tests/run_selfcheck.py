"""Run tests/selfcheck.html in headless Chromium and print the result (Python + Playwright).

    python tools/serve.py 8161            # in another terminal
    python tests/run_selfcheck.py [http://localhost:8161]
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8161").rstrip("/")


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await br.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(BASE + "/tests/selfcheck.html")
        await pg.wait_for_function("window.__result", timeout=90000)
        r = await pg.evaluate("window.__result")
        for x in r["results"]:
            print(("PASS " if x["ok"] else "FAIL ") + x["name"] + (f"  ({x['detail']})" if x["detail"] else ""))
        print(await pg.title(), errors[:3] or "")
        await br.close()
        sys.exit(0 if r["pass"] and not errors else 1)


asyncio.run(main())
