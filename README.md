# NINETY

iOS-style football app with five tabs:

1. **Matches** — live scores with club crests across top European leagues
2. **Transfers** — big European moves from the 2027 window
3. **Ask AI** — multi-source football answers
4. **Teams** — world club search, full squads, player season stats, 4-3-3 formation
5. **Favourites** — saved clubs with form and alerts

## Account

Email signup/signin plus **Continue with Apple / Google**. Logins are saved on the server (`data/users.json` + HttpOnly session cookie).

Optional real OAuth client IDs:

```bash
export GOOGLE_CLIENT_ID="your-google-web-client-id"
export APPLE_CLIENT_ID="your-apple-services-id"
python3 server.py
```

Or `POST /api/auth/config` with `{ "googleClientId", "appleClientId" }`.

## Run locally

```bash
python3 server.py
```

Open http://localhost:4173
