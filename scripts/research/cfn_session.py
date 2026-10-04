"""Shared helpers for CFN research tools (NOT production code).

Policy (same as the existing tdf scraper):
  * the session is a HUMAN login exported manually (Cookie-Editor JSON) — never automated;
  * no Turnstile solving, no stealth plugins, no automation-flag hiding, no proxies;
  * secrets are NEVER printed or saved: cookie values, Set-Cookie, auth/CSRF headers.

Session file: $CFN_SESSION_FILE, default ../tdf-edeportes/backend/cfn_session.json
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SESSION_FILE = REPO_ROOT.parent / "tdf-edeportes" / "backend" / "cfn_session.json"
SESSION_FILE = Path(os.environ.get("CFN_SESSION_FILE", str(DEFAULT_SESSION_FILE)))
OUT_DIR = REPO_ROOT / "debug_output" / "network"

BASE = "https://www.streetfighter.com/6/buckler"
TEST_CFN = "1733837998"  # the ONLY CFN used for research (owner of the session)

_SAMESITE = {"no_restriction": "None", "unspecified": "Lax", "lax": "Lax", "strict": "Strict", "none": "None"}

SENSITIVE_HEADER = re.compile(r"cookie|authorization|csrf|xsrf|token|session|auth", re.I)
SENSITIVE_KEY = re.compile(r"token|secret|password|cookie|session|csrf|auth|email|mail", re.I)


def redact(value: str | None, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep * 2 + 3:
        return "[REDACTED]"
    return f"{value[:keep]}...{value[-keep:]}"


def load_raw_cookies() -> list[dict[str, Any]]:
    if not SESSION_FILE.exists():
        raise SystemExit(f"Session file not found: {SESSION_FILE} (export it manually, see tdf SPECS.md #12)")
    return json.loads(SESSION_FILE.read_text())


def session_report() -> dict[str, Any]:
    """Cookie NAMES + expiry only. Never values."""
    now = time.time()
    out = []
    for c in load_raw_cookies():
        exp = c.get("expirationDate") or c.get("expires")
        out.append(
            {
                "name": c["name"],
                "domain": c["domain"],
                "httpOnly": bool(c.get("httpOnly")),
                "expires_in_days": round((exp - now) / 86400, 1) if exp else None,
                "expired": bool(exp and exp < now),
            }
        )
    return {"file": str(SESSION_FILE), "cookies": out, "any_expired": any(c["expired"] for c in out)}


def playwright_cookies() -> list[dict[str, Any]]:
    cookies = []
    for c in load_raw_cookies():
        cookies.append(
            {
                "name": c["name"],
                "value": c["value"],
                "domain": c["domain"],
                "path": c.get("path", "/"),
                "expires": c.get("expirationDate", c.get("expires", -1)) or -1,
                "httpOnly": bool(c.get("httpOnly", False)),
                "secure": bool(c.get("secure", True)),
                "sameSite": _SAMESITE.get(str(c.get("sameSite", "unspecified")).lower(), "Lax"),
            }
        )
    return cookies


def httpx_cookie_jar() -> dict[str, str]:
    return {c["name"]: c["value"] for c in load_raw_cookies()}


def safe_headers(headers: dict[str, str]) -> dict[str, str]:
    """Header names kept; sensitive values redacted; Set-Cookie dropped entirely."""
    out = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk == "set-cookie":
            out[k] = "[DROPPED]"
        elif SENSITIVE_HEADER.search(lk):
            out[k] = "[REDACTED]"
        else:
            out[k] = v[:200]
    return out


def sanitize_json(obj: Any, depth: int = 0) -> Any:
    """Recursively redact sensitive-looking keys (tokens, emails…) in captured payloads."""
    if depth > 30:
        return "[DEPTH]"
    if isinstance(obj, dict):
        return {
            k: ("[REDACTED]" if SENSITIVE_KEY.search(str(k)) and isinstance(v, (str, int)) else sanitize_json(v, depth + 1))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [sanitize_json(v, depth + 1) for v in obj]
    return obj


def looks_logged_out(html_or_text: str) -> bool:
    return bool(re.search(r"must log in|log in to|iniciar sesi[oó]n|ログイン", html_or_text, re.I))


def write_json(name: str, data: Any) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    return path
