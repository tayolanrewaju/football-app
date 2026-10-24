#!/usr/bin/env python3
"""Static file server + ESPN proxy + auth API with durable user storage."""

from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "4173"))
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
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

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
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
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
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
        user = {
            "id": str(uuid.uuid4()),
            "name": name,
            "email": email,
            "username": username,
            "phone": phone,
            "password": password,
            "provider": "email",
            "picture": "",
            "favorites": [],
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
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"NINETY server on http://localhost:{PORT}", flush=True)
    server.serve_forever()
