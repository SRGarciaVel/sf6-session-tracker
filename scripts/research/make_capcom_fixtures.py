"""Build the sanitized Capcom fixtures (tests/fixtures/capcom/) from a manually captured HAR.

    python3 scripts/research/make_capcom_fixtures.py "/path/to/www.streetfighter.com.har"

WHITELIST approach: only the fields the provider parses (plus a few used for evidence/tests) are
copied. Request/response headers, cookies, translations (__namespaces), emblems, circles, titles,
online status and every other field are dropped. The raw HAR is never copied into the repo.
"""

from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path
from typing import Any

CFN = "1733837998"
OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "capcom"

LEAGUE_INFO = ["league_point", "league_rank", "master_league", "master_rating", "master_rating_ranking"]
PLAYER = ["fighter_id", "short_id", "platform_name"]
SIDE = [
    "character_id",
    "character_name",
    "character_tool_name",
    "playing_character_id",
    "playing_character_name",
    "playing_character_tool_name",
    "battle_input_type",
    "battle_input_type_name",
    "round_results",
    *LEAGUE_INFO,
]
REPLAY = [
    "replay_id",
    "uploaded_at",
    "replay_battle_type",
    "replay_battle_type_name",
    "replay_battle_sub_type",
    "replay_battle_sub_type_name",
    "battle_version",
]
CARD = ["sid", "fighter_name", "favorite_character_tool_name", "league_rank_number", "lp", "mr", "ml", "mrr", "platform_tool_name"]
CHAR_LEAGUE = ["character_id", "character_name", "character_alpha", "character_tool_name", "character_sort", "is_played"]


def pick(obj: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    return {k: obj[k] for k in keys if k in obj}


def banner(b: dict[str, Any]) -> dict[str, Any]:
    fav = b.get("favorite_character_league_info", {})
    return {
        "personal_info": pick(b["personal_info"], ["fighter_id", "short_id", "platform_name", "platform_tool_name"]),
        "favorite_character_id": b.get("favorite_character_id"),
        "favorite_character_name": b.get("favorite_character_name"),
        "favorite_character_tool_name": b.get("favorite_character_tool_name"),
        "favorite_character_league_info": {
            **pick(fav, LEAGUE_INFO),
            **({"league_rank_info": fav["league_rank_info"]} if "league_rank_info" in fav else {}),
        },
    }


def side(p: dict[str, Any]) -> dict[str, Any]:
    return {"player": pick(p["player"], PLAYER), **pick(p, SIDE)}


def battlelog(d: dict[str, Any]) -> dict[str, Any]:
    pp = d["pageProps"]
    return {
        "pageProps": {
            "sid": pp["sid"],
            "current_page": pp["current_page"],
            "total_page": pp["total_page"],
            "fighter_banner_info": banner(pp["fighter_banner_info"]),
            "replay_list": [
                {**pick(r, REPLAY), "player1_info": side(r["player1_info"]), "player2_info": side(r["player2_info"])}
                for r in pp["replay_list"]
            ],
        },
        "__N_SSP": d.get("__N_SSP"),
    }


def play(d: dict[str, Any]) -> dict[str, Any]:
    pp = d["pageProps"]
    p = pp["play"]
    return {
        "pageProps": {
            "sid": pp["sid"],
            "fighter_banner_info": banner(pp["fighter_banner_info"]),
            "play": {
                "current_season_id": p["current_season_id"],
                "season_ids": p["season_ids"],
                "character_league_infos": [
                    {**pick(c, CHAR_LEAGUE), "league_info": pick(c["league_info"], LEAGUE_INFO)}
                    for c in p["character_league_infos"]
                ],
            },
        },
        "__N_SSP": d.get("__N_SSP"),
    }


def profile_html(html: str) -> str:
    """Keep only the Next.js bootstrap facts used for buildId discovery (no user data)."""
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit("profile HTML has no __NEXT_DATA__")
    nd = json.loads(m.group(1))
    slim = {k: nd[k] for k in ("page", "query", "buildId", "assetPrefix", "isFallback", "gssp", "locale") if k in nd}
    slim["props"] = {"pageProps": {}}
    manifests = sorted(set(re.findall(r'src="(/6/buckler/_next/static/[^"]+/_buildManifest\.js)"', html)))
    scripts = "".join(f'<script src="{s}" defer=""></script>' for s in manifests)
    return (
        "<!DOCTYPE html><html><head>"
        f"{scripts}</head><body><div id=\"__next\"></div>"
        f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(slim, separators=(",", ":"))}</script>'
        "</body></html>\n"
    )


def main() -> int:
    har = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    bodies: dict[str, str] = {}
    for e in har["log"]["entries"]:
        url = e["request"]["url"]
        content = e["response"]["content"]
        text = content.get("text")
        if not text or e["response"]["status"] != 200 or "streetfighter.com/6/buckler" not in url:
            continue
        if url.endswith(f"/profile/{CFN}"):
            key = "html"
        elif url.endswith(f"/api/en/card/{CFN}"):
            key = "card"
        elif f"/en/profile/{CFN}/battlelog.json" in url:
            key = "battlelog-2" if "page=2" in url else "battlelog-1"
        elif f"/en/profile/{CFN}/play.json" in url:
            key = "play"
        else:
            continue
        if content.get("encoding") == "base64":
            text = base64.b64decode(text).decode()
        bodies.setdefault(key, text)

    missing = {"html", "card", "battlelog-1", "battlelog-2", "play"} - bodies.keys()
    if missing:
        raise SystemExit(f"HAR is missing: {sorted(missing)}")

    OUT.mkdir(parents=True, exist_ok=True)

    def dump(name: str, data: Any) -> None:
        (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print("wrote", OUT / name)

    dump(f"card-{CFN}.json", pick(json.loads(bodies["card"]), CARD))
    dump(f"play-{CFN}.json", play(json.loads(bodies["play"])))
    dump(f"battlelog-{CFN}-page-1.json", battlelog(json.loads(bodies["battlelog-1"])))
    dump(f"battlelog-{CFN}-page-2.json", battlelog(json.loads(bodies["battlelog-2"])))
    (OUT / f"profile-{CFN}.html").write_text(profile_html(bodies["html"]))
    print("wrote", OUT / f"profile-{CFN}.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
