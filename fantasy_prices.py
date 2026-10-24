"""Fantasy prices from the public league lists, averaged onto Derby's £150m budget."""

from __future__ import annotations

import json
import math
import re
import ssl
import threading
import unicodedata
import urllib.request

DERBY_BUDGET = 150.0
FPL_BUDGET = 100.0
FPL_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"
LALIGA_PLAYERS = "https://fantasy-api.llt-services.com/api/v1/competition/1/players"
LALIGA_TEAMS = "https://fantasy-api.llt-services.com/api/v3/teams-master"

SLOT_FROM_FPL = {1: "G", 2: "D", 3: "M", 4: "A"}
SLOT_FROM_LALIGA = {"1": "G", "2": "D", "3": "M", "4": "A"}

_lock = threading.Lock()
_books: dict | None = None
_error = ""


def fold(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def slot_from_position(position: str) -> str:
    raw = str(position or "").upper().strip()
    token = re.split(r"[\s/-]", raw)[0]
    if token in {"G", "GK", "GKP"} or "GOAL" in raw:
        return "G"
    if token in {"D", "DF", "DEF", "CB", "LB", "RB", "WB", "LWB", "RWB", "CD", "LD", "RD"} or token.startswith("CD"):
        return "D"
    if token in {"F", "FW", "FWD", "ST", "CF", "SS", "A"} or "FORWARD" in raw or "STRIKER" in raw:
        return "A"
    if token in {"SUB", ""}:
        return "M"
    return "M"


def _fetch(url: str) -> object:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 Derby fantasy",
            "Accept": "application/json",
            "x-app": "Fantasy-web",
            "x-lang": "en",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            return json.loads(resp.read().decode())


def _clubs_match(left: str, right: str) -> bool:
    a, b = fold(left), fold(right)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _index(players: list[dict]) -> dict:
    by_full: dict[str, list] = {}
    by_web: dict[str, list] = {}
    for player in players:
        by_full.setdefault(fold(player["name"]), []).append(player)
        web = fold(player["web"])
        if web:
            by_web.setdefault(web, []).append(player)
    return {"players": players, "by_full": by_full, "by_web": by_web}


def _pick(book: dict, name: str, club: str) -> dict | None:
    key = fold(name)
    if not key:
        return None
    last = key.split()[-1]
    exact = list(book["by_full"].get(key, []))
    web_exact = list(book["by_web"].get(key, []))
    last_hits = list(book["by_web"].get(last, []))
    pool = []
    seen = set()
    for player in exact + web_exact + last_hits:
        marker = (player["league"], player["name"], player["club"])
        if marker in seen:
            continue
        seen.add(marker)
        pool.append(player)
    if not pool:
        return None

    def acceptable(player: dict, require_club: bool) -> bool:
        full = fold(player["name"])
        web = fold(player["web"])
        name_ok = full == key or web == key or (web == last and (len(key.split()) == 1 or full.endswith(last)))
        if not name_ok:
            return False
        if require_club:
            return _clubs_match(player["club"], club)
        if web == last and full != key and web != key and len(last_hits) > 1:
            return False
        return True

    if club:
        club_hits = [player for player in pool if acceptable(player, True)]
        if len(club_hits) == 1:
            return club_hits[0]
        if len(club_hits) > 1:
            full_hits = [player for player in club_hits if fold(player["name"]) == key or fold(player["web"]) == key]
            if len(full_hits) == 1:
                return full_hits[0]
    loose = [player for player in pool if acceptable(player, False)]
    full_hits = [player for player in loose if fold(player["name"]) == key or fold(player["web"]) == key]
    if len(full_hits) == 1:
        return full_hits[0]
    if len(loose) == 1:
        return loose[0]
    return None


def _laliga_to_fpl(market: float, median: float, maximum: float, fpl_min: float, fpl_median: float, fpl_max: float) -> float:
    """Keep a player's place in the LaLiga price list, on the Premier League price scale."""
    if maximum <= median:
        return fpl_median
    if market <= median:
        span = max(median - 0.5, 0.1)
        share = min(1.0, max(0.0, (market - 0.5) / span))
        return fpl_min + share * (fpl_median - fpl_min)
    share = math.log(max(market, median) / median) / math.log(maximum / median)
    share = min(1.0, max(0.0, share))
    return fpl_median + share * (fpl_max - fpl_median)


def _load_books() -> dict:
    fpl = _fetch(FPL_URL)
    teams = {}
    badges = {}
    for team in fpl.get("teams") or []:
        teams[team["id"]] = team["name"]
        code = team.get("code")
        if code:
            badges[team["id"]] = f"https://resources.premierleague.com/premierleague/badges/70/t{code}.png"
    fpl_players = []
    fpl_costs = []
    medians: dict[str, list[float]] = {"G": [], "D": [], "M": [], "A": []}
    for row in fpl.get("elements") or []:
        native = round((row.get("now_cost") or 0) / 10, 1)
        if native <= 0:
            continue
        slot = SLOT_FROM_FPL.get(row.get("element_type"), "M")
        derby = round(native * (DERBY_BUDGET / FPL_BUDGET), 1)
        fpl_costs.append(native)
        medians[slot].append(derby)
        first = row.get("first_name") or ""
        second = row.get("second_name") or ""
        code = str(row.get("code") or "")
        status_code = str(row.get("status") or "a")
        status = {"a": "available", "d": "doubt", "i": "injured", "s": "suspended", "u": "unavailable", "n": "unavailable"}.get(status_code, "available")
        fpl_players.append(
            {
                "pid": f"fpl-{row.get('id')}",
                "name": f"{first} {second}".strip(),
                "web": row.get("web_name") or second or first,
                "club": teams.get(row.get("team"), ""),
                "slot": slot,
                "native": native,
                "native_label": f"£{native:.1f}m",
                "derby": derby,
                "league": "Premier League",
                "game": "Fantasy Premier League",
                "status": status,
                "news": row.get("news") or "",
                "chance": row.get("chance_of_playing_this_round"),
                "owned": row.get("selected_by_percent"),
                "form": row.get("form"),
                "points": row.get("total_points") or 0,
                "week_points": row.get("event_points") or 0,
                "xg": row.get("expected_goals"),
                "xa": row.get("expected_assists"),
                "goals": row.get("goals_scored") or 0,
                "assists": row.get("assists") or 0,
                "minutes": row.get("minutes") or 0,
                "starts": row.get("starts") or 0,
                "penalties": row.get("penalties_text") or "",
                "set_pieces": row.get("corners_and_indirect_freekicks_text") or row.get("direct_freekicks_text") or "",
                "headshot": f"https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png" if code else "",
                "number": row.get("squad_number") or "",
                "price_change": round((row.get("cost_change_event") or 0) / 10, 1),
                "price_change_start": round((row.get("cost_change_start") or 0) / 10, 1),
                "badge": badges.get(row.get("team"), ""),
                "xgi": row.get("expected_goal_involvements"),
                "clean_sheets": row.get("clean_sheets") or 0,
            }
        )
    fpl_costs.sort()

    laliga_teams = {}
    try:
        team_payload = _fetch(LALIGA_TEAMS)
        team_rows = team_payload if isinstance(team_payload, list) else team_payload.get("teams") or team_payload.get("data") or []
        for team in team_rows:
            if isinstance(team, dict) and team.get("id") is not None:
                laliga_teams[str(team.get("id"))] = team.get("name") or team.get("shortName") or ""
    except Exception:
        laliga_teams = {}

    laliga_raw = _fetch(LALIGA_PLAYERS)
    laliga_rows = laliga_raw if isinstance(laliga_raw, list) else []
    market_values = sorted(float(row.get("marketValue") or 0) / 1_000_000 for row in laliga_rows if float(row.get("marketValue") or 0) > 0)
    market_median = market_values[len(market_values) // 2] if market_values else 1
    market_max = market_values[-1] if market_values else 1
    fpl_min = fpl_costs[0] if fpl_costs else 4
    fpl_median = fpl_costs[len(fpl_costs) // 2] if fpl_costs else 5
    fpl_max = fpl_costs[-1] if fpl_costs else 15
    laliga_players = []
    for row in laliga_rows:
        market = float(row.get("marketValue") or 0) / 1_000_000
        if market <= 0 or row.get("playerStatus") == "out_of_league":
            continue
        native_fpl = _laliga_to_fpl(market, market_median, market_max, fpl_min, fpl_median, fpl_max)
        derby = round(native_fpl * (DERBY_BUDGET / FPL_BUDGET), 1)
        slot = SLOT_FROM_LALIGA.get(str(row.get("positionId")), "M")
        nickname = row.get("nickname") or ""
        image = row.get("image") or ""
        laliga_status = str(row.get("playerStatus") or "ok")
        laliga_players.append(
            {
                "pid": f"ll-{row.get('id')}",
                "name": nickname,
                "web": nickname,
                "club": laliga_teams.get(str(row.get("teamId")), ""),
                "slot": slot,
                "native": round(market, 1),
                "native_label": f"€{market:.1f}m",
                "derby": derby,
                "league": "La Liga",
                "game": "LaLiga Fantasy",
                "status": "injured" if laliga_status == "injured" else "available" if laliga_status == "ok" else laliga_status,
                "news": "",
                "chance": None,
                "owned": None,
                "form": round(float(row.get("averagePoints") or 0), 1),
                "points": row.get("points") or 0,
                "week_points": 0,
                "xg": None,
                "xa": None,
                "goals": None,
                "assists": None,
                "minutes": None,
                "starts": None,
                "penalties": "",
                "set_pieces": "",
                "headshot": image if isinstance(image, str) else "",
                "number": "",
                "price_change": 0,
                "price_change_start": 0,
                "badge": "",
                "xgi": None,
                "clean_sheets": 0,
            }
        )

    position_price = {}
    for slot, values in medians.items():
        ordered = sorted(values)
        position_price[slot] = ordered[len(ordered) // 2] if ordered else 8.0

    return {
        "books": [_index(fpl_players), _index(laliga_players)],
        "position_price": position_price,
        "counts": {"Fantasy Premier League": len(fpl_players), "LaLiga Fantasy": len(laliga_players)},
    }


def warm() -> None:
    global _books, _error
    try:
        books = _load_books()
    except Exception as err:  # noqa: BLE001
        with _lock:
            _error = str(err)
        return
    with _lock:
        _books = books
        _error = ""


def ensure() -> dict | None:
    global _books
    with _lock:
        ready = _books
    if ready is not None:
        return ready
    warm()
    with _lock:
        return _books


def quote(name: str, club: str = "", position: str = "") -> dict:
    books = ensure()
    slot = slot_from_position(position)
    if not books:
        with _lock:
            message = _error or "Fantasy prices are still loading."
        return {
            "price": None,
            "estimated": True,
            "slot": slot,
            "sources": [],
            "error": message,
        }
    found = []
    for book in books["books"]:
        hit = _pick(book, name, club)
        if hit:
            found.append(hit)
    if not found:
        fallback_slot = slot
        price = books["position_price"].get(fallback_slot, 8.0)
        return {
            "price": price,
            "estimated": True,
            "slot": fallback_slot,
            "sources": [
                {
                    "league": "World",
                    "game": "Derby",
                    "cost": "No listing",
                    "note": "Not in Fantasy Premier League or LaLiga Fantasy. Price is the average for this position.",
                }
            ],
        }
    slots = [hit["slot"] for hit in found if hit.get("slot")]
    chosen = max(set(slots), key=slots.count) if slots else slot
    average = round(sum(hit["derby"] for hit in found) / len(found), 1)
    return {
        "price": average,
        "estimated": False,
        "slot": chosen,
        "sources": [
            {
                "league": hit["league"],
                "game": hit["game"],
                "cost": hit["native_label"],
                "derby": hit["derby"],
            }
            for hit in found
        ],
    }


def _public_player(player: dict, sources: list[dict]) -> dict:
    prices = [source["derby"] for source in sources]
    return {
        "id": player.get("pid") or player["name"],
        "name": player["name"],
        "club": player.get("club") or "",
        "slot": player.get("slot") or "M",
        "price": round(sum(prices) / len(prices), 1) if prices else player.get("derby"),
        "status": player.get("status") or "available",
        "news": player.get("news") or "",
        "chance": player.get("chance"),
        "owned": player.get("owned"),
        "form": player.get("form"),
        "points": player.get("points") or 0,
        "weekPoints": player.get("week_points") or 0,
        "xg": player.get("xg"),
        "xa": player.get("xa"),
        "goals": player.get("goals"),
        "assists": player.get("assists"),
        "minutes": player.get("minutes"),
        "starts": player.get("starts"),
        "penalties": player.get("penalties") or "",
        "setPieces": player.get("set_pieces") or "",
        "headshot": player.get("headshot") or "",
        "number": player.get("number") or "",
        "priceChange": player.get("price_change") or 0,
        "priceChangeStart": player.get("price_change_start") or 0,
        "badge": player.get("badge") or "",
        "xgi": player.get("xgi") if player.get("xgi") is not None else _sum_xgi(player),
        "cleanSheets": player.get("clean_sheets") or 0,
        "selected": player.get("owned"),
        "sources": [{"game": source["game"], "cost": source["native_label"], "derby": source["derby"]} for source in sources],
    }


def _sum_xgi(player: dict):
    xg = player.get("xg")
    xa = player.get("xa")
    if xg is None and xa is None:
        return None
    return round(float(xg or 0) + float(xa or 0), 2)


def list_players(query: str = "", slot: str = "", club: str = "", sort: str = "price", limit: int = 40, offset: int = 0, max_price: float | None = None, min_points: float | None = None, status: str = "", min_form: float | None = None) -> dict:
    books = ensure()
    if not books:
        return {"players": [], "total": 0, "error": _error or "Prices are still loading."}
    grouped: dict[str, list] = {}
    for book in books["books"]:
        for player in book["players"]:
            key = fold(player.get("web") or player.get("name"))
            grouped.setdefault(key, []).append(player)
    rows = []
    needle = fold(query)
    club_needle = fold(club)
    for group in grouped.values():
        base = group[0]
        row = _public_player(base, group)
        if slot and row["slot"] != slot:
            continue
        if needle and needle not in fold(row["name"]) and needle not in fold(row["club"]):
            continue
        if club_needle and club_needle not in fold(row["club"]):
            continue
        if max_price is not None and row["price"] > max_price:
            continue
        if min_points is not None and (row["points"] or 0) < min_points:
            continue
        if status and row["status"] != status:
            continue
        if min_form is not None and float(row["form"] or 0) < min_form:
            continue
        rows.append(row)
    def sort_key(row: dict):
        if sort == "points":
            return -(row["points"] or 0)
        if sort == "form":
            return -(float(row["form"] or 0))
        if sort == "owned":
            return -(float(row["owned"] or 0))
        if sort == "name":
            return row["name"]
        return row["price"]
    rows.sort(key=sort_key)
    total = len(rows)
    start = max(0, offset)
    return {"players": rows[start:start + max(1, min(limit, 80))], "total": total}
