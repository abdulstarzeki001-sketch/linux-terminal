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

## STAR AI Copilot for Railway Terminal — isolated service

The terminal has a separate **STAR AI** drawer that explains commands and
errors **after Railway password authentication**. It never executes commands
and never automatically shares terminal output with a model. You can explicitly
prepare a draft of the recent output, remove secrets, and click Send.

### Production architecture

```text
Phone / Wormstar AI Lab (/terminal/) / Railway login
                    |
           Authenticated /ws
                    |
            Railway terminal
             (Bash + xterm)
                    |
          private internal HTTP
                    |
      star-ai-gateway.railway.internal:8081
          (AI key stored ONLY here)
                    |
             OpenAI Responses API
```

The terminal Dockerfile currently grants `tuser` passwordless sudo, so
**never put the provider API key in the terminal service variables**. A
terminal user might inspect local process environments. This design puts
`AI_API_KEY` in a **different non-root Railway service and container**.
The terminal only holds an internal gateway token; that token may still be
recoverable by someone with sudo and could incur model costs, so the gateway
limits requests (default 30/hour per service replica; max 60/hour) and should
not have a public domain. Use provider billing limits as an additional guard.

### Prepare the two Railway services

1. Merge this PR only after reviewing tests. In the same Railway project
   and environment, create a new GitHub-backed service named
   `star-ai-gateway` from this repository. Set its **Dockerfile path**
   to `ai-gateway/Dockerfile` and build context/root directory to repo
   root `/`. Do **not** generate a public domain. Private DNS uses the
   name `star-ai-gateway.railway.internal`.
2. In **gateway service** Variables, add:
   - `AI_ENABLED=1`
   - `AI_MODEL=<a Responses-API-compatible model enabled on your account>`
   - `AI_API_KEY=<provider key>` (only in this gateway; use a low-budget key)
   - `AI_GATEWAY_TOKEN=<random string at least 32 characters>`
   - `AI_MAX_PER_HOUR=30` (optional)
   - `PORT=8081` (optional; default 8081)
3. In the existing **terminal service**, add:
   - `AI_ENABLED=1`
   - `AI_GATEWAY_URL=http://star-ai-gateway.railway.internal:8081/answer`
   - `AI_GATEWAY_TOKEN=<the exact same shared token>`
   - **Never add `AI_API_KEY` here.**
4. Deploy the gateway first and check the internal health endpoint
   `http://star-ai-gateway.railway.internal:8081/health` from the private
   network. Then deploy the updated terminal. Keep `TERMINAL_PASSWORD` and
   its access control unchanged.
5. Login to Railway Terminal as usual; click **✦ STAR AI**. If the
   gateway is missing or misconfigured, the rest of the terminal continues
   working and the AI drawer shows an explanation.

### Behavior, privacy and limits

- All AI chat is transported through the **already authenticated WebSocket**.
  Cloudflare's `/terminal/ws` proxy continues to forward it transparently.
- Only a deliberate Send click transmits a question. Preparing terminal output
  only fills the editable question field; it never silently sends it.
- AI replies render via `textContent`, not `innerHTML`, and have **no**
  permission to write to the PTY, create files, or execute commands.
- Per authenticated terminal session: 25 requests maximum, at least 2.5 seconds
  between requests, one AI request in flight. Provider max 650 output tokens;
  input capped at 4,000 characters and timeout around 25–28 seconds.
- Gateway has a separate global hourly request cap; the configuration is
  not intended for untrusted public terminals. No conversation is persisted
  in browser storage or server files. Provider handling is governed by the
  provider account's terms; `store:false` is sent with model requests.
- Keep `AI_ENABLED=0` in the terminal until gateway credentials and
  private networking are ready. Real provider calls incur API charges.

### Tests

```bash
node --check server/index.js
node --check server/ai.js
node --check ai-gateway/index.js
node --check ai-gateway/provider.js
node --check web/app.js
node --test test/*.test.js
```

All provider tests use mocked responses except the in-process HTTP gateway test,
which runs against localhost only. They do not use a paid provider key.
