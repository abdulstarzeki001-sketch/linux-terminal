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

## Deploy to Fly.io (later)

Fly.io runs the same Docker image. You will need to set `TERMINAL_PASSWORD` as a Fly secret (`fly secrets set TERMINAL_PASSWORD=...`), not in the repo.

## Files

| Path | Purpose |
| --- | --- |
| `server/index.js` | Express static server, WebSocket endpoint `/ws`, bash via node-pty |
| `web/` | xterm.js page and client script |
| `Dockerfile` | Debian + Node 20 + dev tools, non-root `tuser` |
| `docker-compose.yml` | Local run with resource limits, bound to 127.0.0.1 |
