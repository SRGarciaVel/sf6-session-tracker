"""Research tool: can Buckler pages/data be fetched with plain HTTP (no browser)?

    scripts/research/.venv/bin/python scripts/research/test_cfn_http.py [--no-cookies] [--runs N]

For the research CFN only. Each run fetches the profile document and, if the HTML exposes a
Next.js buildId, the matching /_next/data/<buildId>/... JSON route. Uses httpx's default
headers (no browser UA spoofing, no header forging). Stops at the first 403/429.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from cfn_session import BASE, TEST_CFN, httpx_cookie_jar, looks_logged_out, safe_headers, write_json  # noqa: E402

TARGETS = [
    ("profile", f"{BASE}/profile/{TEST_CFN}"),
    ("battlelog", f"{BASE}/profile/{TEST_CFN}/battlelog"),
    ("play", f"{BASE}/en/profile/{TEST_CFN}/play"),
]


def classify(resp: httpx.Response) -> str:
    server = resp.headers.get("server", "")
    if resp.status_code in (403, 429):
        return f"BLOCKED ({resp.status_code}, server={server}, x-cache={resp.headers.get('x-cache', '')})"
    if looks_logged_out(resp.text[:50000]):
        return "LOGGED_OUT"
    return "OK"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cookies", action="store_true")
    ap.add_argument("--runs", type=int, default=1)
    args = ap.parse_args()

    cookies = {} if args.no_cookies else httpx_cookie_jar()
    results = []
    with httpx.Client(cookies=cookies, follow_redirects=False, timeout=20) as client:
        for run in range(1, args.runs + 1):
            for name, url in TARGETS:
                t0 = time.perf_counter()
                resp = client.get(url)
                ms = round((time.perf_counter() - t0) * 1000)
                verdict = classify(resp)
                build_id = re.search(r'"buildId":"([^"]+)"', resp.text)
                row = {
                    "run": run,
                    "name": name,
                    "status": resp.status_code,
                    "ms": ms,
                    "bytes": len(resp.content),
                    "verdict": verdict,
                    "location": resp.headers.get("location"),
                    "buildId": build_id.group(1) if build_id else None,
                    "has___NEXT_DATA__": "__NEXT_DATA__" in resp.text,
                    "response_headers": safe_headers(dict(resp.headers)),
                }
                results.append(row)
                print(json.dumps({k: v for k, v in row.items() if k != "response_headers"}))
                if resp.status_code in (403, 429):
                    print("STOP: blocked — not retrying (research policy).")
                    write_json("http_report.json", results)
                    return 0
                time.sleep(2)  # polite pacing
    write_json("http_report.json", results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
