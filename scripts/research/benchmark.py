"""Research tool: Playwright vs plain HTTP latency for the research CFN profile (N runs).

    scripts/research/.venv/bin/python scripts/research/benchmark.py [--runs 5]

Plain Chromium, httpx default headers, 3 s between requests, stops at the first 403/429.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from cfn_session import BASE, TEST_CFN, httpx_cookie_jar, playwright_cookies, write_json  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

URL = f"{BASE}/profile/{TEST_CFN}/battlelog"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()
    out: dict[str, list[float] | str] = {"http_ms": [], "playwright_ms": []}

    with httpx.Client(cookies=httpx_cookie_jar(), timeout=20) as client:
        for _ in range(args.runs):
            t0 = time.perf_counter()
            r = client.get(URL)
            out["http_ms"].append(round((time.perf_counter() - t0) * 1000))  # type: ignore[union-attr]
            if r.status_code in (403, 429):
                out["stopped"] = f"http {r.status_code}"
                break
            time.sleep(3)

    if "stopped" not in out:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context()
            ctx.add_cookies(playwright_cookies())
            page = ctx.new_page()
            for _ in range(args.runs):
                t0 = time.perf_counter()
                r = page.goto(URL, wait_until="networkidle", timeout=45_000)
                out["playwright_ms"].append(round((time.perf_counter() - t0) * 1000))  # type: ignore[union-attr]
                if r and r.status in (403, 429):
                    out["stopped"] = f"playwright {r.status}"
                    break
                time.sleep(3)
            browser.close()

    for k in ("http_ms", "playwright_ms"):
        v = out[k]
        if v:
            print(f"{k}: runs={len(v)} median={statistics.median(v)} min={min(v)} max={max(v)}")  # type: ignore[arg-type]
    if "stopped" in out:
        print("STOPPED:", out["stopped"])
    write_json("benchmark.json", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
