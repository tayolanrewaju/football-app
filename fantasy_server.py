"""Leagues, rankings, and competition settings for Derby fantasy."""

from __future__ import annotations

import secrets
import threading
import time
from pathlib import Path


class Store:
    def __init__(self, path: Path, read_json, write_json):
        self.path = path
        self.read_json = read_json
        self.write_json = write_json
        self.lock = threading.Lock()

    def _blank(self) -> dict:
        return {
            "leagues": [],
            "squads": {},
            "config": {
                "deadlineOffsetMin": 90,
                "seasonStart": "2026-08-10",
                "seasonEnd": "2027-05-24",
                "scoringNote": "Derby position table",
                "priceOverrides": {},
            },
        }

    def load(self) -> dict:
        data = self.read_json(self.path, self._blank())
        data.setdefault("leagues", [])
        data.setdefault("squads", {})
        data.setdefault("config", self._blank()["config"])
        return data

    def save(self, data: dict) -> None:
        backup = self.path.with_suffix(".json.bak")
        if self.path.exists():
            backup.write_text(self.path.read_text(encoding="utf-8"), encoding="utf-8")
        self.write_json(self.path, data)

    def create_league(self, name: str, kind: str, privacy: str, admin: dict) -> dict:
        kind = kind if kind in {"classic", "h2h", "cup", "public"} else "classic"
        privacy = "public" if privacy == "public" or kind == "public" else "private"
        with self.lock:
            data = self.load()
            code = secrets.token_hex(3).upper()
            while any(league["code"] == code for league in data["leagues"]):
                code = secrets.token_hex(3).upper()
            league = {
                "id": secrets.token_hex(4),
                "name": (name or "League").strip()[:40],
                "code": code,
                "kind": "classic" if kind == "public" else kind,
                "privacy": privacy,
                "adminId": admin.get("id"),
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "members": [_member(admin)],
                "history": [],
            }
            data["leagues"].append(league)
            self.save(data)
            return _public_league(league)

    def join(self, code: str, member: dict) -> dict | None:
        with self.lock:
            data = self.load()
            league = _find(data, code)
            if not league:
                return None
            if any(item.get("userId") == member.get("id") for item in league["members"]):
                return _public_league(league)
            league["members"].append(_member(member))
            self.save(data)
            return _public_league(league)

    def leave(self, code: str, user_id: str, remove_id: str | None = None) -> dict | None:
        with self.lock:
            data = self.load()
            league = _find(data, code)
            if not league:
                return None
            target = remove_id or user_id
            if target != user_id and league.get("adminId") != user_id:
                return None
            league["members"] = [item for item in league["members"] if item.get("userId") != target]
            self.save(data)
            return _public_league(league)

    def delete_league(self, code: str, user_id: str) -> bool:
        with self.lock:
            data = self.load()
            league = _find(data, code)
            if not league or league.get("adminId") != user_id:
                return False
            data["leagues"] = [item for item in data["leagues"] if item.get("code") != league["code"]]
            self.save(data)
            return True

    def entry(self, user_id: str, payload: dict) -> dict:
        points = _bounded(payload.get("points"), -20, 8000)
        week = _bounded(payload.get("weekPoints"), -40, 400)
        with self.lock:
            data = self.load()
            current = data["squads"].get(user_id, {})
            history = current.get("history") or []
            week_key = str(payload.get("week") or "")
            if week_key and (not history or history[-1].get("week") != week_key):
                history.append({"week": week_key, "points": week, "chip": payload.get("chip")})
            transfers = payload.get("transfers") if isinstance(payload.get("transfers"), list) else current.get("transfers") or []
            squad = {
                "userId": user_id,
                "name": payload.get("name") or current.get("name") or "Manager",
                "teamName": payload.get("teamName") or current.get("teamName") or "Fantasy",
                "points": points,
                "weekPoints": week,
                "captain": payload.get("captain") or "",
                "week": week_key,
                "chip": payload.get("chip"),
                "country": str(payload.get("country") or current.get("country") or "")[:40],
                "region": str(payload.get("region") or current.get("region") or "")[:40],
                "squadNames": [str(name)[:40] for name in (payload.get("squadNames") or [])][:15],
                "transfers": transfers[:8],
                "history": history[-40:],
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            data["squads"][user_id] = squad
            for league in data["leagues"]:
                for member in league["members"]:
                    if member.get("userId") == user_id:
                        weeks = member.get("weeks") or []
                        if week_key:
                            if weeks and weeks[-1].get("week") == week_key:
                                weeks[-1]["points"] = week
                            else:
                                weeks.append({"week": week_key, "points": week})
                        member.update({
                            "name": squad["name"],
                            "teamName": squad["teamName"],
                            "points": points,
                            "weekPoints": week,
                            "captain": squad["captain"],
                            "week": week_key,
                            "weeks": weeks[-40:],
                        })
            self.save(data)
            return squad

    def league(self, code: str) -> dict | None:
        data = self.load()
        league = _find(data, code)
        return _public_league(league) if league else None

    def search(self, query: str) -> list:
        needle = (query or "").strip().lower()
        data = self.load()
        rows = []
        for league in data["leagues"]:
            if league.get("privacy") != "public" and needle not in (league.get("code") or "").lower():
                continue
            if needle and needle not in league.get("name", "").lower() and needle not in league.get("code", "").lower():
                continue
            rows.append(_public_league(league))
        return rows[:20]

    def rankings(self, country: str = "", region: str = "", sort: str = "overall") -> list:
        data = self.load()
        rows = list(data["squads"].values())
        if country:
            rows = [row for row in rows if (row.get("country") or "").lower() == country.lower()]
        if region:
            rows = [row for row in rows if (row.get("region") or "").lower() == region.lower()]
        key_name = "weekPoints" if sort == "week" else "points"
        rows.sort(key=lambda row: (-(row.get(key_name) or 0), row.get("name") or ""))
        ranked = []
        for index, row in enumerate(rows, start=1):
            ranked.append({**row, "rank": index})
        return ranked

    def popularity(self) -> dict:
        data = self.load()
        captains: dict[str, int] = {}
        coming: dict[str, int] = {}
        leaving: dict[str, int] = {}
        for squad in data["squads"].values():
            captain = squad.get("captain") or ""
            if captain:
                captains[captain] = captains.get(captain, 0) + 1
            for move in squad.get("transfers") or []:
                if not isinstance(move, dict):
                    continue
                if move.get("in"):
                    coming[str(move["in"])] = coming.get(str(move["in"]), 0) + 1
                if move.get("out"):
                    leaving[str(move["out"])] = leaving.get(str(move["out"]), 0) + 1

        def top(bucket: dict) -> list:
            return [{"name": name, "count": count} for name, count in sorted(bucket.items(), key=lambda item: -item[1])[:8]]

        return {"captains": top(captains), "in": top(coming), "out": top(leaving)}

    def message(self, code: str, user: dict, text: str) -> dict | None:
        text = str(text or "").strip()[:240]
        if not text:
            return None
        with self.lock:
            data = self.load()
            league = _find(data, code)
            if not league or not any(member.get("userId") == user.get("id") for member in league["members"]):
                return None
            league.setdefault("messages", []).append({
                "id": secrets.token_hex(3),
                "userId": user.get("id"),
                "name": user.get("name") or "Manager",
                "text": text,
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            league["messages"] = league["messages"][-40:]
            self.save(data)
            return _public_league(league)

    def poll(self, code: str, user: dict, question: str, options: list) -> dict | None:
        question = str(question or "").strip()[:120]
        choices = [str(option).strip()[:40] for option in options if str(option).strip()][:4]
        if not question or len(choices) < 2:
            return None
        with self.lock:
            data = self.load()
            league = _find(data, code)
            if not league or league.get("adminId") != user.get("id"):
                return None
            league.setdefault("polls", []).append({
                "id": secrets.token_hex(3),
                "question": question,
                "options": [{"label": choice, "votes": []} for choice in choices],
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            league["polls"] = league["polls"][-8:]
            self.save(data)
            return _public_league(league)

    def vote(self, code: str, user_id: str, poll_id: str, option: int) -> dict | None:
        with self.lock:
            data = self.load()
            league = _find(data, code)
            if not league or not any(member.get("userId") == user_id for member in league["members"]):
                return None
            found = next((item for item in league.get("polls") or [] if item.get("id") == poll_id), None)
            if not found or not isinstance(option, int) or option < 0 or option >= len(found.get("options") or []):
                return None
            for choice in found["options"]:
                choice["votes"] = [voter for voter in choice.get("votes") or [] if voter != user_id]
            found["options"][option].setdefault("votes", []).append(user_id)
            self.save(data)
            return _public_league(league)

    def reset(self) -> dict:
        with self.lock:
            data = self.load()
            data.setdefault("archives", []).append({
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "squads": data.get("squads") or {},
                "leagues": data.get("leagues") or [],
            })
            data["archives"] = data["archives"][-8:]
            data["squads"] = {}
            for league in data["leagues"]:
                for member in league.get("members") or []:
                    member["points"] = 0
                    member["weekPoints"] = 0
                    member["weeks"] = []
            self.save(data)
            return {"ok": True, "archives": len(data["archives"])}

    def heartbeat(self) -> None:
        with self.lock:
            data = self.load()
            data["config"]["lastBeat"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self.save(data)

    def health(self) -> dict:
        data = self.load()
        return {
            "leagues": len(data.get("leagues") or []),
            "managers": len(data.get("squads") or {}),
            "lastBeat": (data.get("config") or {}).get("lastBeat"),
            "backup": self.path.with_suffix(".json.bak").exists(),
            "archives": len(data.get("archives") or []),
        }

    def config(self) -> dict:
        return self.load()["config"]

    def set_config(self, patch: dict) -> dict:
        with self.lock:
            data = self.load()
            for key in ("deadlineOffsetMin", "seasonStart", "seasonEnd", "scoringNote"):
                if key in patch and patch[key] not in (None, ""):
                    data["config"][key] = patch[key]
            if isinstance(patch.get("priceOverrides"), dict):
                data["config"]["priceOverrides"] = {str(key).lower()[:80]: value for key, value in list(patch["priceOverrides"].items())[:40]}
            if isinstance(patch.get("postponed"), list):
                data["config"]["postponed"] = [str(item)[:40] for item in patch["postponed"] if str(item).strip()][:40]
            self.save(data)
            return data["config"]


def _member(user: dict) -> dict:
    return {
        "userId": user.get("id"),
        "name": user.get("name") or "Manager",
        "teamName": user.get("teamName") or "Fantasy",
        "points": 0,
        "weekPoints": 0,
        "captain": "",
        "week": "",
    }


def _find(data: dict, code: str):
    wanted = (code or "").strip().upper()
    return next((league for league in data["leagues"] if league.get("code") == wanted or league.get("id") == code), None)


def _public_league(league: dict) -> dict:
    members = sorted(league.get("members") or [], key=lambda item: (-(item.get("points") or 0), item.get("name") or ""))
    table = []
    for index, member in enumerate(members, start=1):
        table.append({**member, "rank": index})
    return {
        "id": league.get("id"),
        "name": league.get("name"),
        "code": league.get("code"),
        "kind": league.get("kind"),
        "privacy": league.get("privacy"),
        "adminId": league.get("adminId"),
        "createdAt": league.get("createdAt"),
        "members": table,
        "h2h": _h2h(table)[0],
        "h2hTable": _h2h(table)[1],
        "cup": _cup(table),
        "messages": league.get("messages") or [],
        "polls": [
            {
                **poll,
                "options": [{"label": option.get("label"), "votes": len(option.get("votes") or [])} for option in poll.get("options") or []],
            }
            for poll in (league.get("polls") or [])
        ],
    }


def _h2h(members: list) -> tuple[list, list]:
    rows = []
    table = []
    ordered = sorted(members, key=lambda item: item.get("userId") or "")
    if len(ordered) < 2:
        return rows, table
    for index in range(0, len(ordered) - 1, 2):
        left, right = ordered[index], ordered[index + 1]
        left_weeks = {item.get("week"): item.get("points") or 0 for item in left.get("weeks") or []}
        right_weeks = {item.get("week"): item.get("points") or 0 for item in right.get("weeks") or []}
        wins = {left.get("userId"): 0, right.get("userId"): 0}
        for key in set(left_weeks) & set(right_weeks):
            if left_weeks[key] == right_weeks[key]:
                continue
            winner = left.get("userId") if left_weeks[key] > right_weeks[key] else right.get("userId")
            wins[winner] += 1
        winner = left["userId"] if (left.get("weekPoints") or 0) >= (right.get("weekPoints") or 0) else right["userId"]
        rows.append({"home": left, "away": right, "winner": winner})
        table.append({
            "home": left.get("name"),
            "away": right.get("name"),
            "homeWins": wins[left.get("userId")],
            "awayWins": wins[right.get("userId")],
        })
    return rows, table


def _cup(members: list) -> dict:
    field = list(members)
    if len(field) < 2:
        return {"round": "Waiting for two managers", "ties": [], "rounds": []}
    rounds = []
    round_no = 1
    while len(field) >= 2 and round_no <= 6:
        ties = []
        winners = []
        working = list(field)
        if len(working) % 2:
            winners.append(working.pop())
        for index in range(0, len(working), 2):
            left, right = working[index], working[index + 1]
            winner = left if (left.get("points") or 0) >= (right.get("points") or 0) else right
            ties.append({"home": left.get("name"), "away": right.get("name"), "winner": winner.get("name"), "bye": False})
            winners.append(winner)
        if len(field) % 2:
            ties.append({"home": field[-1].get("name"), "away": "Bye", "winner": field[-1].get("name"), "bye": True})
        rounds.append({"name": f"Round {round_no}", "ties": ties})
        field = winners
        round_no += 1
    return {"round": rounds[-1]["name"] if rounds else "Knockout", "ties": rounds[-1]["ties"] if rounds else [], "rounds": rounds}


def _bounded(value, low, high) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0
    return max(low, min(high, round(number, 1)))
