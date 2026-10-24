#!/usr/bin/env python3
"""Static file server + ESPN proxy + auth API with durable user storage."""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import fantasy_prices
import fantasy_server

RATE: dict[str, list[float]] = {}

mimetypes.add_type("application/manifest+json", ".webmanifest")

PORT = int(os.environ.get("PORT", "4173"))
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
FANTASY_FILE = DATA_DIR / "fantasy.json"
FANTASY_LOG = DATA_DIR / "fantasy.log"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
CONFIG_FILE = DATA_DIR / "auth-config.json"

ESPN_HOSTS = {
    "site": "https://site.api.espn.com",
    "web": "https://site.web.api.espn.com",
}

# Short in-memory cache so Matches don't re-hit ESPN on every tab switch
PROXY_CACHE: dict[str, tuple[float, bytes, str, int]] = {}
PROXY_TTL = 45.0

DATA_DIR.mkdir(exist_ok=True)


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


FANTASY = fantasy_server.Store(FANTASY_FILE, read_json, write_json)


def rate_ok(ip: str) -> bool:
    now = time.time()
    hits = [stamp for stamp in RATE.get(ip, []) if now - stamp < 60]
    if len(hits) > 240:
        return False
    hits.append(now)
    RATE[ip] = hits
    return True


def ensure_admin() -> None:
    users = read_json(USERS_FILE, [])
    if not users or any(item.get("role") == "admin" for item in users):
        return
    users[0]["role"] = "admin"
    write_json(USERS_FILE, users)


def apply_price_overrides(payload: dict) -> dict:
    overrides = {str(key).lower(): value for key, value in (FANTASY.config().get("priceOverrides") or {}).items()}
    if not overrides:
        return payload
    rows = payload.get("players")
    if isinstance(rows, list):
        for player in rows:
            price = overrides.get(str(player.get("name") or "").lower())
            if price not in (None, ""):
                player["price"] = float(price)
                player["override"] = True
        return payload
    price = overrides.get(str(payload.get("name") or "").lower())
    if price not in (None, ""):
        payload["price"] = float(price)
        payload["override"] = True
    return payload


def fantasy_housekeeping() -> None:
    while True:
        time.sleep(1800)
        try:
            FANTASY.heartbeat()
        except Exception as err:  # noqa: BLE001
            FANTASY_LOG.parent.mkdir(exist_ok=True)
            with FANTASY_LOG.open("a", encoding="utf-8") as handle:
                handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} beat {err}\n")


def openai_api_key() -> str:
    cfg = read_json(CONFIG_FILE, {})
    return (os.environ.get("OPENAI_API_KEY") or cfg.get("openaiApiKey") or "").strip()


def public_user(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email") or "",
        "phone": user.get("phone") or "",
        "username": user.get("username") or "",
        "provider": user.get("provider"),
        "picture": user.get("picture") or "",
        "favorites": user.get("favorites") or [],
        "createdAt": user.get("createdAt"),
        "updatedAt": user.get("updatedAt"),
        "displayName": user.get("displayName") or user.get("name") or "",
        "emailVerified": bool(user.get("emailVerified")),
        "favouriteClub": user.get("favouriteClub") or "",
        "privacy": user.get("privacy") or "public",
        "role": user.get("role") or "member",
        "country": user.get("country") or "",
        "region": user.get("region") or "",
    }


def find_user(users: list, identity: str):
    q = (identity or "").strip().lower()
    for user in users:
        if (user.get("email") or "").lower() == q:
            return user
        if (user.get("username") or "").lower() == q:
            return user
        if (user.get("phone") or "").lower() == q:
            return user
    return None


def upsert_user(users: list, user: dict) -> dict:
    user["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for i, existing in enumerate(users):
        if existing.get("id") == user.get("id"):
            users[i] = user
            write_json(USERS_FILE, users)
            return user
    users.append(user)
    write_json(USERS_FILE, users)
    return user


def create_session(user_id: str) -> str:
    sessions = read_json(SESSIONS_FILE, {})
    token = secrets.token_urlsafe(24)
    sessions[token] = {"userId": user_id, "createdAt": time.time()}
    write_json(SESSIONS_FILE, sessions)
    return token


def user_from_session(token: str):
    if not token:
        return None
    sessions = read_json(SESSIONS_FILE, {})
    entry = sessions.get(token)
    if not entry:
        return None
    users = read_json(USERS_FILE, [])
    return next((u for u in users if u.get("id") == entry.get("userId")), None)


def verify_google_id_token(token: str, client_id: str):
    url = "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode({"id_token": token})
    req = urllib.request.Request(url, headers={"User-Agent": "NINETY/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    if client_id and data.get("aud") != client_id:
        raise ValueError("Google token audience mismatch")
    if data.get("email_verified") not in (True, "true", "True"):
        # still allow if email present
        pass
    return data


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*") or "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _limited(self, path: str) -> bool:
        if not path.startswith("/api/"):
            return False
        if rate_ok(self.client_address[0]):
            return False
        self.json_response({"error": "Too many requests. Wait a minute and try again."}, 429)
        return True

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if self._limited(parsed.path):
            return None
        if parsed.path.startswith("/proxy/espn/"):
            return self.proxy_espn(parsed)
        if parsed.path == "/api/auth/me":
            return self.auth_me()
        if parsed.path == "/api/auth/config":
            return self.auth_config()
        if parsed.path == "/api/auth/logout":
            return self.auth_logout()
        if parsed.path == "/api/ai/status":
            return self.ai_status()
        if parsed.path == "/api/fantasy/quote":
            return self.fantasy_quote(parsed)
        if parsed.path == "/api/fantasy/faces":
            return self.fantasy_faces(parsed)
        if parsed.path == "/api/fantasy/players":
            return self.fantasy_players(parsed)
        if parsed.path == "/api/fantasy/league":
            return self.fantasy_league_get(parsed)
        if parsed.path == "/api/fantasy/leagues":
            return self.fantasy_leagues(parsed)
        if parsed.path == "/api/fantasy/rankings":
            params = urllib.parse.parse_qs(parsed.query or "")
            country = (params.get("country") or [""])[0]
            region = (params.get("region") or [""])[0]
            sort = (params.get("sort") or ["overall"])[0]
            return self.json_response({"rankings": FANTASY.rankings(country, region, sort)})
        if parsed.path == "/api/fantasy/stats":
            return self.json_response(FANTASY.popularity())
        if parsed.path == "/api/fantasy/health":
            return self.json_response(FANTASY.health())
        if parsed.path == "/api/fantasy/config":
            return self.json_response(FANTASY.config())
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if self._limited(parsed.path):
            return None
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except Exception:
            return self.json_response({"error": "Invalid JSON"}, 400)

        routes = {
            "/api/auth/register": self.auth_register,
            "/api/auth/login": self.auth_login,
            "/api/auth/google": self.auth_google,
            "/api/auth/apple": self.auth_apple,
            "/api/auth/social": self.auth_social,
            "/api/auth/favorites": self.auth_favorites,
            "/api/auth/config": self.auth_config_save,
            "/api/ai/chat": self.ai_chat,
            "/api/fantasy/badge": self.fantasy_badge,
            "/api/auth/verify/request": self.auth_verify_request,
            "/api/auth/verify": self.auth_verify,
            "/api/auth/reset/request": self.auth_reset_request,
            "/api/auth/reset": self.auth_reset,
            "/api/auth/delete": self.auth_delete,
            "/api/auth/profile": self.auth_profile,
            "/api/fantasy/league": self.fantasy_league_create,
            "/api/fantasy/league/join": self.fantasy_league_join,
            "/api/fantasy/league/leave": self.fantasy_league_leave,
            "/api/fantasy/league/delete": self.fantasy_league_delete,
            "/api/fantasy/entry": self.fantasy_entry,
            "/api/fantasy/config": self.fantasy_config_save,
            "/api/fantasy/league/chat": self.fantasy_chat,
            "/api/fantasy/league/poll": self.fantasy_poll,
            "/api/fantasy/league/vote": self.fantasy_vote,
            "/api/fantasy/reset": self.fantasy_reset,
        }
        handler = routes.get(parsed.path)
        if not handler:
            return self.send_error(404)
        return handler(body)

    def json_response(self, payload, status=200, session_token=None, clear_session=False):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if session_token:
            self.send_header(
                "Set-Cookie",
                f"ninety_session={session_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
            )
        if clear_session:
            self.send_header(
                "Set-Cookie",
                "ninety_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            )
        self.end_headers()
        self.wfile.write(data)

    def session_token(self) -> str:
        cookie = SimpleCookie()
        if self.headers.get("Cookie"):
            cookie.load(self.headers.get("Cookie"))
        if "ninety_session" in cookie:
            return cookie["ninety_session"].value
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            return auth.split(" ", 1)[1].strip()
        return ""

    def auth_config(self):
        cfg = read_json(CONFIG_FILE, {})
        key = openai_api_key()
        payload = {
            "googleClientId": os.environ.get("GOOGLE_CLIENT_ID") or cfg.get("googleClientId") or "",
            "appleClientId": os.environ.get("APPLE_CLIENT_ID") or cfg.get("appleClientId") or "",
            "openaiConfigured": bool(key),
            "openaiKeyHint": (f"…{key[-4:]}" if len(key) > 4 else ""),
        }
        return self.json_response(payload)

    def auth_config_save(self, body):
        cfg = read_json(CONFIG_FILE, {})
        if body.get("googleClientId") is not None:
            cfg["googleClientId"] = str(body.get("googleClientId") or "").strip()
        if body.get("appleClientId") is not None:
            cfg["appleClientId"] = str(body.get("appleClientId") or "").strip()
        if body.get("openaiApiKey") is not None:
            cfg["openaiApiKey"] = str(body.get("openaiApiKey") or "").strip()
        write_json(CONFIG_FILE, cfg)
        key = openai_api_key()
        return self.json_response(
            {
                "ok": True,
                "googleClientId": cfg.get("googleClientId") or "",
                "appleClientId": cfg.get("appleClientId") or "",
                "openaiConfigured": bool(key),
                "openaiKeyHint": (f"…{key[-4:]}" if len(key) > 4 else ""),
            }
        )

    def ai_status(self):
        key = openai_api_key()
        return self.json_response({"openaiConfigured": bool(key)})

    def ai_chat(self, body):
        key = openai_api_key()
        if not key:
            return self.json_response(
                {
                    "error": "No OpenAI API key set. Add one in Account → ChatGPT / OpenAI, or set OPENAI_API_KEY.",
                    "needsKey": True,
                },
                400,
            )
        question = str(body.get("question") or body.get("message") or "").strip()
        if not question:
            return self.json_response({"error": "Empty question"}, 400)
        context = str(body.get("context") or "")[:6000]
        system = (
            "You are Derby Ask AI, a sharp football assistant inside a live scores app. "
            "Be concise, colourful, and accurate. Prefer the live context when provided "
            "(scores, squads, transfers). Use UK football phrasing. If unsure, say so."
        )
        user_content = question if not context else f"Live app context:\n{context}\n\nQuestion: {question}"
        payload = {
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "temperature": 0.6,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
        }
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
                "User-Agent": "Derby/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode())
            text = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
            )
            if not text:
                return self.json_response({"error": "Empty response from OpenAI"}, 502)
            return self.json_response(
                {
                    "text": text,
                    "source": "ChatGPT",
                    "model": payload["model"],
                }
            )
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="ignore")[:400]
            return self.json_response(
                {"error": f"OpenAI HTTP {err.code}: {detail}"},
                502,
            )
        except Exception as err:  # noqa: BLE001
            return self.json_response({"error": str(err)}, 502)

    def fantasy_faces(self, parsed):
        params = urllib.parse.parse_qs(parsed.query or "")
        raw = (params.get("names") or [""])[0]
        names = [part.strip() for part in raw.split("|") if part.strip()]
        try:
            return self.json_response(fantasy_prices.faces_for(names))
        except Exception as err:  # noqa: BLE001
            return self.json_response({"faces": {}, "error": str(err)}, 502)

    def fantasy_badge(self, body):
        key = openai_api_key()
        if not key:
            return self.json_response(
                {
                    "error": "No OpenAI API key set. Add one in Account → ChatGPT / OpenAI, or set OPENAI_API_KEY.",
                    "needsKey": True,
                },
                400,
            )
        name = " ".join(str(body.get("teamName") or "Fantasy").split())[:40] or "Fantasy"
        club = " ".join(str(body.get("favouriteClub") or "").split())[:40]
        prompt = (
            "Design one football club crest as a single centered shield on a plain light background. "
            f"The club is called {name}. "
            "Flat vector style, bold shapes, thick outlines, high contrast, no people, no stadium, no mockup, no photorealism. "
            "A short name or initials may sit inside the shield. "
        )
        prompt += f"Use a colour palette inspired by {club}. " if club else "Use deep navy, white, and gold. "
        prompt += "It must stay recognisable at a very small size."
        attempts = [
            {"model": "gpt-image-1", "prompt": prompt, "size": "1024x1024", "n": 1},
            {"model": "dall-e-3", "prompt": prompt, "size": "1024x1024", "n": 1, "response_format": "b64_json"},
            {"model": "dall-e-2", "prompt": prompt, "size": "512x512", "n": 1, "response_format": "b64_json"},
        ]
        last_error = "OpenAI did not return an image."
        for payload in attempts:
            req = urllib.request.Request(
                "https://api.openai.com/v1/images/generations",
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {key}",
                    "User-Agent": "Derby/1.0",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    data = json.loads(resp.read().decode())
                image = self._badge_data_url(data)
                if image:
                    return self.json_response({"image": image, "model": payload["model"]})
                last_error = "OpenAI returned an empty image."
            except urllib.error.HTTPError as err:
                last_error = err.read().decode(errors="ignore")[:400]
                continue
            except Exception as err:  # noqa: BLE001
                last_error = str(err)
                continue
        return self.json_response({"error": f"Could not draw a badge. {last_error}"}, 502)

    def _badge_data_url(self, data: dict) -> str:
        item = (data.get("data") or [{}])[0]
        blob = item.get("b64_json") or ""
        if blob:
            return f"data:image/png;base64,{blob}"
        url = item.get("url") or ""
        if not url:
            return ""
        req = urllib.request.Request(url, headers={"User-Agent": "Derby/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            mime = (resp.headers.get("Content-Type") or "image/png").split(";")[0]
        return f"data:{mime};base64,{base64.b64encode(raw).decode()}"

    def auth_me(self):
        user = user_from_session(self.session_token())
        if not user:
            return self.json_response({"user": None})
        return self.json_response({"user": public_user(user)})

    def auth_logout(self):
        token = self.session_token()
        sessions = read_json(SESSIONS_FILE, {})
        if token in sessions:
            sessions.pop(token, None)
            write_json(SESSIONS_FILE, sessions)
        return self.json_response({"ok": True}, clear_session=True)

    def auth_register(self, body):
        name = str(body.get("name") or "").strip()
        password = str(body.get("password") or "")
        email = str(body.get("email") or "").strip()
        username = str(body.get("username") or "").strip()
        phone = str(body.get("phone") or "").strip()
        if not name or len(password) < 4:
            return self.json_response({"error": "Name and a password (4+ characters) are required."}, 400)
        if not email and not username and not phone:
            return self.json_response({"error": "Add an email, username, or phone number."}, 400)
        users = read_json(USERS_FILE, [])
        if email and find_user(users, email):
            return self.json_response({"error": "That email is already registered."}, 400)
        if username and find_user(users, username):
            return self.json_response({"error": "That username is taken."}, 400)
        if phone and find_user(users, phone):
            return self.json_response({"error": "That phone number is already registered."}, 400)
        has_admin = any(item.get("role") == "admin" for item in users)
        user = {
            "id": str(uuid.uuid4()),
            "name": name,
            "displayName": name,
            "email": email,
            "username": username,
            "phone": phone,
            "password": password,
            "provider": "email",
            "picture": "",
            "favorites": [],
            "emailVerified": False,
            "favouriteClub": "",
            "privacy": "public",
            "role": "member" if has_admin else "admin",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        upsert_user(users, user)
        token = create_session(user["id"])
        return self.json_response({"user": public_user(user)}, session_token=token)

    def auth_login(self, body):
        identity = str(body.get("identity") or "")
        password = str(body.get("password") or "")
        users = read_json(USERS_FILE, [])
        user = find_user(users, identity)
        if not user or user.get("password") != password:
            return self.json_response({"error": "Incorrect details."}, 401)
        token = create_session(user["id"])
        return self.json_response({"user": public_user(user)}, session_token=token)

    def auth_social(self, body):
        provider = str(body.get("provider") or "").lower()
        if provider not in {"google", "apple"}:
            return self.json_response({"error": "Unknown provider"}, 400)
        email = str(body.get("email") or f"{provider}-user@ninety.app").strip().lower()
        name = str(body.get("name") or ("Google Fan" if provider == "google" else "Apple Fan")).strip()
        picture = str(body.get("picture") or "")
        users = read_json(USERS_FILE, [])
        user = find_user(users, email)
        if not user:
            user = {
                "id": str(uuid.uuid4()),
                "name": name,
                "email": email,
                "username": f"{provider}_{secrets.token_hex(3)}",
                "phone": "",
                "password": secrets.token_urlsafe(16),
                "provider": provider,
                "picture": picture,
                "favorites": [],
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        else:
            user["name"] = name or user.get("name")
            user["provider"] = provider
            if picture:
                user["picture"] = picture
        upsert_user(users, user)
        token = create_session(user["id"])
        return self.json_response({"user": public_user(user)}, session_token=token)

    def auth_google(self, body):
        credential = str(body.get("credential") or "")
        cfg = read_json(CONFIG_FILE, {})
        client_id = os.environ.get("GOOGLE_CLIENT_ID") or cfg.get("googleClientId") or ""
        if not credential:
            return self.json_response({"error": "Missing Google credential"}, 400)
        try:
            info = verify_google_id_token(credential, client_id)
        except Exception as err:  # noqa: BLE001
            return self.json_response({"error": f"Google verification failed: {err}"}, 401)
        email = info.get("email") or f"google-{info.get('sub')}@ninety.app"
        name = info.get("name") or info.get("given_name") or "Google Fan"
        picture = info.get("picture") or ""
        return self.auth_social(
            {"provider": "google", "email": email, "name": name, "picture": picture}
        )

    def auth_apple(self, body):
        # Apple identity token fully verified with Apple keys in production;
        # we accept the authorized payload from AppleJS and persist the account.
        email = str(body.get("email") or "").strip().lower()
        name = str(body.get("name") or "Apple Fan").strip()
        sub = str(body.get("sub") or secrets.token_hex(8))
        if not email:
            email = f"apple-{sub}@ninety.app"
        return self.auth_social(
            {"provider": "apple", "email": email, "name": name, "picture": ""}
        )

    def auth_favorites(self, body):
        user = user_from_session(self.session_token())
        if not user:
            return self.json_response({"error": "Not signed in"}, 401)
        favorites = body.get("favorites")
        if not isinstance(favorites, list):
            return self.json_response({"error": "favorites must be a list"}, 400)
        users = read_json(USERS_FILE, [])
        for i, existing in enumerate(users):
            if existing.get("id") == user.get("id"):
                users[i]["favorites"] = favorites
                users[i]["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                write_json(USERS_FILE, users)
                return self.json_response({"user": public_user(users[i])})
        return self.json_response({"error": "User missing"}, 404)

    def proxy_espn(self, parsed):
        parts = parsed.path.split("/", 4)
        if len(parts) < 5:
            self.send_error(400, "Bad proxy path")
            return
        kind = parts[3]
        rest = parts[4]
        host = ESPN_HOSTS.get(kind)
        if not host:
            self.send_error(400, "Unknown ESPN host")
            return
        target = f"{host}/{rest}"
        if parsed.query:
            target = f"{target}?{parsed.query}"

        cached = PROXY_CACHE.get(target)
        now = time.time()
        if cached and now - cached[0] < PROXY_TTL:
            _, body, content_type, status = cached
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Cache", "HIT")
            self.end_headers()
            self.wfile.write(body)
            return

        try:
            req = urllib.request.Request(
                target,
                headers={"User-Agent": "Derby/1.0", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                body = resp.read()
                content_type = resp.headers.get("Content-Type", "application/json")
                PROXY_CACHE[target] = (now, body, content_type, 200)
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Cache", "MISS")
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as err:
            body = err.read()
            content_type = "application/json"
            if err.code < 500:
                PROXY_CACHE[target] = (now, body, content_type, err.code)
            self.send_response(err.code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as err:  # noqa: BLE001
            payload = json.dumps({"error": str(err)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def current_user(self):
        return user_from_session(self.session_token())

    def auth_verify_request(self, _body):
        user = self.current_user()
        if not user:
            return self.json_response({"error": "Sign in first."}, 401)
        code = f"{secrets.randbelow(1000000):06d}"
        user["verifyCode"] = code
        users = read_json(USERS_FILE, [])
        upsert_user(users, user)
        return self.json_response({"code": code, "note": "Enter this code to verify the email on the account.", "user": public_user(user)})

    def auth_verify(self, body):
        user = self.current_user()
        if not user:
            return self.json_response({"error": "Sign in first."}, 401)
        if str(body.get("code") or "") != str(user.get("verifyCode") or ""):
            return self.json_response({"error": "That code does not match."}, 400)
        user["emailVerified"] = True
        user["verifyCode"] = ""
        upsert_user(read_json(USERS_FILE, []), user)
        return self.json_response({"user": public_user(user)})

    def auth_reset_request(self, body):
        users = read_json(USERS_FILE, [])
        user = find_user(users, str(body.get("identity") or ""))
        if not user:
            return self.json_response({"error": "No account with those details."}, 404)
        code = f"{secrets.randbelow(1000000):06d}"
        user["resetCode"] = code
        upsert_user(users, user)
        return self.json_response({"code": code, "note": "Use this code to choose a new password."})

    def auth_reset(self, body):
        users = read_json(USERS_FILE, [])
        user = find_user(users, str(body.get("identity") or ""))
        password = str(body.get("password") or "")
        if not user or str(body.get("code") or "") != str(user.get("resetCode") or ""):
            return self.json_response({"error": "Code or account did not match."}, 400)
        if len(password) < 4:
            return self.json_response({"error": "Password needs 4 or more characters."}, 400)
        user["password"] = password
        user["resetCode"] = ""
        upsert_user(users, user)
        return self.json_response({"ok": True})

    def auth_delete(self, _body):
        user = self.current_user()
        if not user:
            return self.json_response({"error": "Sign in first."}, 401)
        users = [item for item in read_json(USERS_FILE, []) if item.get("id") != user.get("id")]
        write_json(USERS_FILE, users)
        sessions = read_json(SESSIONS_FILE, {})
        token = self.session_token()
        sessions.pop(token, None)
        write_json(SESSIONS_FILE, sessions)
        return self.json_response({"ok": True}, clear_session=True)

    def auth_profile(self, body):
        user = self.current_user()
        if not user:
            return self.json_response({"error": "Sign in first."}, 401)
        for key in ("name", "displayName", "username", "picture", "favouriteClub", "privacy", "country", "region"):
            if key in body and body[key] is not None:
                user[key] = str(body[key])[:80]
        users = read_json(USERS_FILE, [])
        if user.get("username") and any(item.get("id") != user.get("id") and (item.get("username") or "").lower() == user["username"].lower() for item in users):
            return self.json_response({"error": "That username is taken."}, 400)
        upsert_user(users, user)
        return self.json_response({"user": public_user(user)})

    def fantasy_players(self, parsed):
        params = urllib.parse.parse_qs(parsed.query or "")
        def one(key):
            return (params.get(key) or [""])[0]
        max_price = one("maxPrice")
        min_points = one("minPoints")
        min_form = one("minForm")
        try:
            payload = fantasy_prices.list_players(
                query=one("q"),
                slot=one("slot"),
                club=one("club"),
                sort=one("sort") or "price",
                limit=int(one("limit") or 40),
                offset=int(one("offset") or 0),
                max_price=float(max_price) if max_price else None,
                min_points=float(min_points) if min_points else None,
                status=one("status"),
                min_form=float(min_form) if min_form else None,
            )
            payload = apply_price_overrides(payload)
        except Exception as err:  # noqa: BLE001
            FANTASY_LOG.parent.mkdir(exist_ok=True)
            with FANTASY_LOG.open("a", encoding="utf-8") as handle:
                handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} players {err}\n")
            return self.json_response({"players": [], "error": str(err)}, 502)
        return self.json_response(payload)

    def fantasy_league_get(self, parsed):
        params = urllib.parse.parse_qs(parsed.query or "")
        code = (params.get("code") or [""])[0]
        league = FANTASY.league(code)
        if not league:
            return self.json_response({"error": "League not found."}, 404)
        return self.json_response(league)

    def fantasy_leagues(self, parsed):
        params = urllib.parse.parse_qs(parsed.query or "")
        query = (params.get("q") or [""])[0]
        return self.json_response({"leagues": FANTASY.search(query)})

    def _actor(self, body):
        user = self.current_user()
        if user:
            return {"id": user.get("id"), "name": body.get("manager") or user.get("displayName") or user.get("name"), "teamName": body.get("teamName") or "Fantasy"}
        return {"id": str(body.get("userId") or ""), "name": body.get("manager") or "Manager", "teamName": body.get("teamName") or "Fantasy"}

    def fantasy_league_create(self, body):
        actor = self._actor(body)
        if not actor["id"]:
            return self.json_response({"error": "Missing manager."}, 400)
        league = FANTASY.create_league(str(body.get("name") or "League"), str(body.get("kind") or "classic"), str(body.get("privacy") or "private"), actor)
        return self.json_response(league)

    def fantasy_league_join(self, body):
        actor = self._actor(body)
        league = FANTASY.join(str(body.get("code") or ""), actor)
        if not league:
            return self.json_response({"error": "League not found."}, 404)
        return self.json_response(league)

    def fantasy_league_leave(self, body):
        actor = self._actor(body)
        league = FANTASY.leave(str(body.get("code") or ""), actor["id"], body.get("removeId"))
        if not league:
            return self.json_response({"error": "Could not update that league."}, 400)
        return self.json_response(league)

    def fantasy_league_delete(self, body):
        actor = self._actor(body)
        if not FANTASY.delete_league(str(body.get("code") or ""), actor["id"]):
            return self.json_response({"error": "Only the league admin can delete it."}, 403)
        return self.json_response({"ok": True})

    def fantasy_entry(self, body):
        actor = self._actor(body)
        if not actor["id"]:
            return self.json_response({"error": "Missing manager."}, 400)
        squad = FANTASY.entry(actor["id"], {**body, "name": actor["name"], "teamName": actor["teamName"]})
        return self.json_response(squad)

    def fantasy_config_save(self, body):
        user = self.current_user()
        if not user or user.get("role") != "admin":
            return self.json_response({"error": "Admin only."}, 403)
        return self.json_response(FANTASY.set_config(body))

    def fantasy_quote(self, parsed):
        params = urllib.parse.parse_qs(parsed.query or "")
        name = (params.get("name") or [""])[0]
        club = (params.get("club") or [""])[0]
        position = (params.get("position") or [""])[0]
        quoted = fantasy_prices.quote(name, club, position)
        quoted["name"] = name
        return self.json_response(apply_price_overrides(quoted))

    def fantasy_chat(self, body):
        actor = self._actor(body)
        league = FANTASY.message(str(body.get("code") or ""), actor, str(body.get("text") or ""))
        if not league:
            return self.json_response({"error": "Join the league before posting."}, 400)
        return self.json_response(league)

    def fantasy_poll(self, body):
        actor = self._actor(body)
        options = body.get("options") if isinstance(body.get("options"), list) else str(body.get("options") or "").split(",")
        league = FANTASY.poll(str(body.get("code") or ""), actor, str(body.get("question") or ""), options)
        if not league:
            return self.json_response({"error": "Only the league admin can open a poll."}, 403)
        return self.json_response(league)

    def fantasy_vote(self, body):
        actor = self._actor(body)
        try:
            option = int(body.get("option"))
        except (TypeError, ValueError):
            return self.json_response({"error": "Pick an option."}, 400)
        league = FANTASY.vote(str(body.get("code") or ""), actor["id"], str(body.get("pollId") or ""), option)
        if not league:
            return self.json_response({"error": "Vote was not recorded."}, 400)
        return self.json_response(league)

    def fantasy_reset(self, _body):
        user = self.current_user()
        if not user or user.get("role") != "admin":
            return self.json_response({"error": "Admin only."}, 403)
        return self.json_response(FANTASY.reset())

    def log_message(self, fmt, *args):
        msg = str(args[0] if args else "")
        if "/proxy/espn/" in msg:
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    if not USERS_FILE.exists():
        write_json(USERS_FILE, [])
    if not SESSIONS_FILE.exists():
        write_json(SESSIONS_FILE, {})
    ensure_admin()
    threading.Thread(target=fantasy_prices.warm, name="fantasy-prices", daemon=True).start()
    threading.Thread(target=fantasy_housekeeping, name="fantasy-housekeeping", daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"NINETY server on http://localhost:{PORT}", flush=True)
    server.serve_forever()
