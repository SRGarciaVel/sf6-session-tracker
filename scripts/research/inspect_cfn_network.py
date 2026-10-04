"""Research tool: what does Buckler's Boot Camp load when opening a profile?

    scripts/research/.venv/bin/python scripts/research/inspect_cfn_network.py [--no-cookies]

Visits, in order, for the research CFN only:
    /profile/1733837998
    /profile/1733837998/battlelog
    /en/profile/1733837998/play
records fetch/xhr/document/JSON traffic (no images, fonts, css, analytics), extracts __NEXT_DATA__
from each document, and writes SANITIZED copies to debug_output/network/.

Plain Chromium (headless). NO stealth plugin, NO automation-flag hiding, NO captcha solving.
Stops if the site answers 403/429.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from cfn_session import (  # noqa: E402
    BASE,
    TEST_CFN,
    looks_logged_out,
    playwright_cookies,
    safe_headers,
    sanitize_json,
    session_report,
    write_json,
)
from playwright.sync_api import Response, sync_playwright  # noqa: E402

PAGES = [
    ("profile", f"{BASE}/profile/{TEST_CFN}"),
    ("battlelog", f"{BASE}/profile/{TEST_CFN}/battlelog"),
    ("play", f"{BASE}/en/profile/{TEST_CFN}/play"),
]
IGNORE_TYPES = {"image", "font", "stylesheet", "media", "manifest", "other", "ping"}
IGNORE_HOSTS = re.compile(
    r"google|doubleclick|facebook|cookiebot|consent|analytics|gtm|tagmanager|adobe|demdex|omtrdc|"
    r"hotjar|clarity|twitter|tiktok|yahoo|criteo|bing|newrelic|sentry|onetrust|akamai\.net/.+\.js",
    re.I,
)


def summarize_next_data(nd: dict[str, Any]) -> dict[str, Any]:
    props = nd.get("props", {}).get("pageProps", {})
    return {
        "buildId": nd.get("buildId"),
        "page": nd.get("page"),
        "query": nd.get("query"),
        "locale": nd.get("locale"),
        "isFallback": nd.get("isFallback"),
        "gssp": nd.get("gssp"),
        "pageProps_keys": sorted(props.keys()) if isinstance(props, dict) else type(props).__name__,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cookies", action="store_true", help="probe anonymously (no session)")
    args = ap.parse_args()

    report: dict[str, Any] = {"session": session_report(), "with_cookies": not args.no_cookies, "pages": []}
    print("session:", json.dumps({k: v for k, v in report["session"].items() if k != "file"}, indent=1))

    captured: list[dict[str, Any]] = []
    stop = {"reason": None}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)  # plain: no stealth, no flag hiding
        context = browser.new_context(locale="en-US", viewport={"width": 1366, "height": 768})
        if not args.no_cookies:
            context.add_cookies(playwright_cookies())

        def on_response(resp: Response) -> None:
            req = resp.request
            rtype = req.resource_type
            url = resp.url
            if rtype in IGNORE_TYPES or IGNORE_HOSTS.search(url):
                return
            if rtype == "script" and "/_next/data/" not in url:
                return
            ctype = resp.headers.get("content-type", "")
            if resp.status in (403, 429):
                stop["reason"] = f"{resp.status} on {url}"
            entry: dict[str, Any] = {
                "method": req.method,
                "url": url,
                "status": resp.status,
                "resource_type": rtype,
                "content_type": ctype,
                "request_header_names": sorted(req.headers.keys()),
                "sends_cookie": "cookie" in {k.lower() for k in req.all_headers().keys()},
                "response_headers": safe_headers(resp.headers),
            }
            try:
                body = resp.body()
                entry["bytes"] = len(body)
                if "json" in ctype or url.endswith(".json") or "/_next/data/" in url:
                    data = json.loads(body)
                    n = len([e for e in captured if e.get("json_file")]) + 1
                    entry["json_file"] = write_json(f"json_{n:02d}.json", sanitize_json(data)).name
                    entry["json_top_keys"] = sorted(data.keys())[:40] if isinstance(data, dict) else type(data).__name__
            except Exception as exc:  # noqa: BLE001
                entry["body_error"] = str(exc)[:120]
            captured.append(entry)

        context.on("response", on_response)
        page = context.new_page()

        for name, url in PAGES:
            if stop["reason"]:
                print("STOP:", stop["reason"])
                break
            t0 = time.perf_counter()
            before = len(captured)
            resp = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(4000)  # let client fetches after hydration happen
            html = page.content()
            nd_raw = page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__'); return el ? el.textContent : null }"
            )
            next_data = json.loads(nd_raw) if nd_raw else None
            if next_data:
                write_json(f"next_data_{name}.json", sanitize_json(next_data))
            rsc = bool(re.search(r"self\.__next_f\.push", html))
            page_info = {
                "name": name,
                "url": url,
                "final_url": page.url,
                "status": resp.status if resp else None,
                "ms_to_settle": round((time.perf_counter() - t0) * 1000),
                "html_bytes": len(html),
                "logged_out_marker": looks_logged_out(page.inner_text("body")[:20000]),
                "has___NEXT_DATA__": bool(next_data),
                "has_RSC_flight": rsc,
                "next_data_summary": summarize_next_data(next_data) if next_data else None,
                "captured_requests": len(captured) - before,
            }
            report["pages"].append(page_info)
            print(json.dumps(page_info, indent=1))
            if resp and resp.status in (403, 429):
                stop["reason"] = f"{resp.status} on document {url}"

        browser.close()

    report["requests"] = captured
    out = write_json("network_report.json", report)
    print(f"\n{len(captured)} relevant requests → {out}")
    for e in captured:
        print(f"  {e['status']} {e['method']} {e['resource_type']:<8} {e.get('bytes', '?'):>8}B  {e['url'][:150]}")
    if stop["reason"]:
        print("STOPPED:", stop["reason"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
