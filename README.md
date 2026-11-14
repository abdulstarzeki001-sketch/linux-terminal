# Linux Terminal (web)

A password-protected web terminal. The browser shows xterm.js. The server runs a real `bash` shell with `node-pty`, inside a Docker container with resource limits. Each session is a fresh shell. Closing the tab kills it.

## Run locally

```sh
cp .env.example .env          # then edit TERMINAL_PASSWORD (12+ characters)
docker compose up --build
```

Open <http://127.0.0.1:8080>, enter the password, and run commands.

Inside the terminal you have a normal Debian environment: `apt` (via `sudo apt install ...`), `python3`, `pip`, `git`, `nano`, `vim`, `curl`, `jq`, `gcc`, and more.

## Security model

- **Password:** `TERMINAL_PASSWORD` comes from `.env` and is never written into the code or the image. The server refuses to start if it is shorter than 12 characters.
- **Auth failures:** the connection closes after 3 wrong passwords. This limit is per connection, so for public exposure add rate limiting at the reverse proxy.
- **Shell environment:** the shell gets an explicit allowlist of environment variables, so the password is not visible from inside the terminal.
- **Limits:** 1 GB RAM, 1 CPU, 512 processes, 30 minutes idle timeout, 2 hours maximum session.
- **Sudo:** `tuser` has passwordless sudo, so the shell can install packages. This means root inside the container. The container is the isolation boundary, so do not mount host folders or add privileged flags. To remove sudo, delete the `sudoers.d` line from the Dockerfile.
- **HTTPS:** this app speaks plain HTTP. Do not expose it on the internet without HTTPS in front (Fly.io, Caddy, or Cloudflare Tunnel).

## Put it online with Cloudflare Tunnel

This app runs a real `bash` process per session, so it needs a persistent
container — it **cannot** run on Cloudflare Pages or Workers (V8 isolates,
no process spawning, no PTY). The right way to expose it through Cloudflare
is a **Cloudflare Tunnel**: the container stays private, and `cloudflared`
makes an outbound connection to Cloudflare's edge, which serves a public
HTTPS URL (WebSockets included) with Cloudflare's protection in front.

The `docker-compose.cloudflare.yml` overlay removes the host port and adds a
`cloudflared` service on the private network.

**Named tunnel (stable URL, your own domain):**

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a
   tunnel → Cloudflared**.
2. Add a **Public Hostname** route: `terminal.example.com` → `http://terminal:8080`.
3. Put the tunnel token in `.env`: `TUNNEL_TOKEN=...`
4. Start it:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up --build
   ```

**Quick tunnel (no account, throwaway `*.trycloudflare.com` URL, for testing):**

```sh
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml \
  run --rm cloudflared tunnel --no-autoupdate --url http://terminal:8080
```

Cloudflare prints a temporary `https://…trycloudflare.com` address.

> **Harden it:** the terminal's password is the only gate. For public
> exposure, add a **Cloudflare Access** policy (email / SSO) in front of the
> hostname so the shell is never reachable by password alone.

## Deploy to Railway (works from an iPad)

Railway builds the `Dockerfile` straight from GitHub and keeps the service
always on — the whole setup happens in the browser, no CLI needed.

1. Go to <https://railway.com>, sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → pick this repository.
3. In the service **Variables** tab add:
   - `TERMINAL_PASSWORD` — a strong password, 12+ characters
   - `PORT` — `8080`
4. In **Settings → Networking → Generate Domain**, choose port `8080`.
5. Open the generated `https://….up.railway.app` URL, enter the password,
   and you have a Linux terminal in the browser.

Notes: Railway's Hobby plan is $5/month (includes $5 of usage). The
container filesystem is ephemeral — anything installed with `apt` or saved
in `$HOME` disappears on redeploy. WebSockets work out of the box.

## Deploy to Fly.io (later)

Fly.io runs the same Docker image. You will need to set `TERMINAL_PASSWORD` as a Fly secret (`fly secrets set TERMINAL_PASSWORD=...`), not in the repo.

## Files

| Path | Purpose |
| --- | --- |
| `server/index.js` | Express static server, WebSocket endpoint `/ws`, bash via node-pty |
| `web/` | xterm.js page and client script |
| `Dockerfile` | Debian + Node 20 + dev tools, non-root `tuser` |
| `docker-compose.yml` | Local run with resource limits, bound to 127.0.0.1 |
| `docker-compose.cloudflare.yml` | Overlay that fronts the terminal with a Cloudflare Tunnel |

## STAR AI Copilot (optional, off by default)

The Neon Terminal can display a **separate, advisory AI chat** after the ordinary
Railway terminal password has been accepted. It is not a virtual shell and does
not get permission to execute, paste or modify Bash commands. The actual Linux
PTY stays connected through the existing WebSocket.

### Setup

The optional backend uses OpenAI's **Responses API** through server-side
`fetch`. No key is included in this repository or the HTML.

Railway Dashboard → project `terminal` service → Variables:

| Variable | Value |
| --- | --- |
| `AI_ENABLED` | `1` to opt in, `0` to keep disabled |
| `AI_MODEL` | A Responses-API-compatible model available to your account |
| `AI_API_KEY` | Provider API key; **enter in Railway, never in GitHub or chat** |

Redeploy only when ready, then sign into the normal terminal password form and
select **✦ STAR AI**. Chat messages are sent only on an explicit Send click.
The **إرفاق آخر المخرجات** button prepares an editable draft from recent xterm
output without uploading anything. Remove personal data/secrets before Send.

The API is limited to a fixed provider endpoint, max 4,000 input characters,
650 generated tokens per request, 25 AI requests per WebSocket session,
2.5-second cooldown, and a 25-second timeout. Chat state is not written to disk,
browser storage or shell history. It does not call tools or Bash.

**Important credential-isolation warning:** the current Docker image explicitly
grants the terminal user passwordless `sudo`. Consequently, anyone trusted to
log into this terminal may be able to inspect process environment and recover
an `AI_API_KEY` stored in this **same container**, despite the server's
`shellEnv()` allowlist. The current integration is **not safe for high-value
production API keys** until privileges are hardened or the AI provider key is
moved to a separate isolated service. Keep `AI_ENABLED=0` until that risk is
resolved. A dedicated AI gateway service with its own Railway variables is the
recommended production architecture. Set a strict billing budget on the
provider account regardless of architecture.

Validation: `node --check server/ai.js`, `node --check server/index.js`,
`node --check web/app.js`, and `node --test test/*.test.js`.
The mocked AI tests make no paid model requests and cannot verify a real key.
