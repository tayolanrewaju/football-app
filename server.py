#!/usr/bin/env python3
"""Static file server + ESPN proxy (avoids browser CORS)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 4173
ESPN_HOSTS = {
    "site": "https://site.api.espn.com",
    "web": "https://site.web.api.espn.com",
}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/proxy/espn/"):
            return self.proxy_espn(parsed)
        return super().do_GET()

    def proxy_espn(self, parsed):
        # /proxy/espn/site/apis/... or /proxy/espn/web/apis/...
        parts = parsed.path.split("/", 4)
        # ['', 'proxy', 'espn', 'site', 'apis/...']
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
        try:
            req = urllib.request.Request(
                target,
                headers={
                    "User-Agent": "NINETY/1.0",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
                content_type = resp.headers.get("Content-Type", "application/json")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as err:
            body = err.read()
            self.send_response(err.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as err:  # noqa: BLE001
            payload = json.dumps({"error": str(err)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, fmt, *args):
        # quieter logs
        if "/proxy/espn/" in str(args[0] if args else ""):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"NINETY server on http://localhost:{PORT}", flush=True)
    server.serve_forever()
