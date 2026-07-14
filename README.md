# Portkey Chat UI (Vertex AI)

A minimal AI chat UI that calls a Vertex AI model **through your Portkey SaaS gateway**.
The UI lets you switch, at runtime:

- **`_user`** in `x-portkey-metadata` — toggle between `NOTE` and `ETON` (plus editable `app` / `env`).
- **`x-portkey-config`** — a free-text config slug field.
- **model** — free-text field.

A live panel shows the exact headers that will be sent with the next request.

## Architecture

```
Browser (public/index.html)
   │  POST /api/chat  { messages, model, config, metadata }
   ▼
Node/Express in Docker (server.js)   ← holds PORTKEY_API_KEY (never sent to the browser)
   │  POST /v1/chat/completions
   │  headers: x-portkey-api-key, x-portkey-config, x-portkey-metadata
   ▼
Portkey SaaS gateway ──► Vertex AI
```

The browser never sees the Portkey API key — the server injects it and streams
the response (SSE) back to the page.

## Setup (Docker — recommended)

```bash
git clone https://github.com/chitnakub/AI-Chat-by-Claude.git
cd AI-Chat-by-Claude
cp .env.example .env
# edit .env and set PORTKEY_API_KEY (and optionally DEFAULT_PORTKEY_CONFIG / DEFAULT_MODEL)

docker compose up -d --build   # start (builds on first run)
```

Then open http://localhost:3000

Start / stop whenever you like:

```bash
docker compose up -d      # start
docker compose stop       # stop (keeps the built image, quick restart)
docker compose start      # start again
docker compose down       # stop and remove the container
docker compose logs -f    # tail logs
```

### Applying changes — which command to use

Only `up -d` recreates the container, so it's the only one that picks up new
config. `restart` / `stop` / `start` reuse the container's **baked-in** env —
they will silently keep serving old `.env` values.

| You changed…                          | Command                          |
|---------------------------------------|----------------------------------|
| `.env` (e.g. `DEFAULT_MODEL`, keys)   | `docker compose up -d`           |
| Code (`server.js`, `public/…`)        | `docker compose up -d --build`   |
| Nothing — just cycling the process    | `docker compose restart`         |

> ⚠️ **Gotcha:** `docker compose restart` (and `stop` + `start`) do **not**
> re-read `.env`. If a `.env` change isn't taking effect, run
> `docker compose up -d`. Verify what the container actually has with:
> ```bash
> docker compose exec chat-ui printenv DEFAULT_MODEL
> curl -s http://localhost:3000/api/defaults
> ```

After any change, hard-refresh the browser (Cmd+Shift+R) to drop cached UI assets.

## Setup (without Docker)

```bash
npm install
cp .env.example .env        # then edit .env
npm start                   # or: npm run dev  (auto-reload)
```

Then open http://localhost:3000

## .env

| Variable                 | Purpose                                                        |
|--------------------------|---------------------------------------------------------------|
| `PORTKEY_API_KEY`        | Your Portkey SaaS API key. **Required.** Stays server-side.    |
| `PORTKEY_BASE_URL`       | Gateway URL. Default `https://api.portkey.ai/v1`.             |
| `DEFAULT_PORTKEY_CONFIG` | Config slug used when the UI config field is empty.           |
| `DEFAULT_MODEL`          | Model used when the UI model field is empty.                  |
| `PORT`                   | Local server port (default 3000).                            |

## Notes

- **Config vs. virtual key for Vertex:** your Vertex credentials/routing live in the
  Portkey **config** referenced by `x-portkey-config`. Create a config in the Portkey
  dashboard that points at your Vertex provider, then paste its slug into the UI (or
  set `DEFAULT_PORTKEY_CONFIG`).
- **Metadata** is sent as `x-portkey-metadata: {"_user":"NOTE","app":"AI-Chat","env":"GCP-Dev"}`.
  These values show up in Portkey analytics/logs so you can filter by user.
- Conversation history is kept in the browser and re-sent each turn.
