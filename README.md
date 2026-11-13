# Linux Terminal (web)

A password-protected web terminal. The browser shows xterm.js. The server runs a real `bash` shell with `node-pty`, inside a Docker container with resource limits. Each session is a fresh shell. Closing the tab kills it.

## Run locally

```sh
cp .env.example .env          # then edit TERMINAL_PASSWORD (12+ characters)
docker compose up --build
```

Open <http://127.0.0.1:8080>, enter the password, and run commands.

Inside the terminal you have a normal Debian environment: `python3`, `pip`, `git`, `nano`, `vim`, `curl`, `jq`, `gcc`, and more.

## Security model

- **Password:** `TERMINAL_PASSWORD` comes from `.env` and is never written into the code or the image. The server refuses to start if it is shorter than 12 characters.
- **Auth failures:** a connection closes after three wrong passwords and the server temporarily blocks repeated failures from the same socket peer. Add additional rate limiting and identity enforcement at the edge for public use.
- **Shell environment:** the shell gets an explicit allowlist of environment variables, so the password is not visible from inside the terminal.
- **Limits:** 1 GB RAM, 1 CPU, 512 processes, 30 minutes idle timeout, 2 hours maximum session.
- **Non-root shell:** `tuser` has no passwordless sudo; install OS packages at image build time. The public terminal must not grant root on demand.
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

> **Required before public exposure:** use Cloudflare Access or another
> identity-aware gateway in front of the terminal, enforce request rate limits,
> and restrict trusted users. Password-only access is not appropriate for a
> sensitive shell, even with the server's additional protections.

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

Notes: Railway's pricing may change. The container filesystem is ephemeral;
files saved in `$HOME` disappear on redeploy. WebSockets work out of the box.
A public Railway-generated domain is reachable from the internet. Apply an
identity-aware access gateway before using this as a sensitive administration
terminal; an application password alone is not sufficient.

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
