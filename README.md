# Derby

Modern dark football app with five tabs:

1. **Matches** — fast live scores with club badges
2. **Transfers** — 2027 window board
3. **Ask AI** — ChatGPT via OpenAI API (+ live score context)
4. **Teams** — squads, player season stats, 4-3-3 pitch
5. **Favourites** — saved clubs + alerts

## ChatGPT / Ask AI

Paste an **OpenAI API key** in Account (from https://platform.openai.com/api-keys), or:

```bash
export OPENAI_API_KEY="sk-..."
python3 server.py
```

This uses the OpenAI API (ChatGPT models). It cannot log into a chatgpt.com browser session.

## Run locally

```bash
python3 server.py
```

Open http://localhost:4173
