# KALI-OSINT-STAR on the existing Railway Terminal (iPhone-first)

## Deployed architecture

This integration bundles the reviewed KALI-OSINT-STAR repository at a **fixed Git commit** into the existing `linux-terminal` container. It does **not** deploy Kali Linux or change the user's laptop.

- Railway web terminal: existing password-protected HTTPS/WebSocket service on `PORT=8080`.
- FastAPI: `127.0.0.1:8000` inside the **same container only**. No new public service, domain or TCP proxy.
- Source: `/opt/kali-osint-star`; Python virtual environment: `/opt/star-kali-venv`.
- Persistent credentials: `/home/tuser/.config/kali-osint-star/local-auth.env` (mode 0600), auto-generated once. **Never paste, display, or commit this file.**
- Persistent SQLite: `/home/tuser/.local/share/kali-osint-star/operations.sqlite`.
- `STAR_LAB_CIDRS` is explicitly empty in the runner; **network target checks remain disabled** on Railway. Only approved local inventory and read-only metadata are exposed.
- Existing STAR AI gateway is unchanged and must be authorized independently.
- A safe local inventory runs after API readiness once for each approved image profile; results and approvals are recorded in SQLite. GitHub CI must pass before merging.
- Debian includes baseline defensive binaries: `nmap`, `tcpdump`, `tshark`, `whois`, `dig` (`dnsutils`) and `traceroute`; they are not invoked against network targets during deployment.

## iPhone usage

1. Open `https://terminal-production-fb16bd35.up.railway.app` with Safari. Use the **existing Railway terminal password**, not the credentials generated for the local API.
2. In the password-protected web terminal, run:
   - `star-kali health` to verify the local FastAPI service.
   - `star-kali capabilities` to confirm all remote execution is disabled.
   - `star-kali catalog` to list the 15 supported local tool **detection** records.
   - `star-kali inventory` to run one authorized `tool_inventory` job, recording the result and audit.
   - `star-kali system` to run a read-only local OS inventory.
   - `star-kali audit` to review the audit history.
3. The command line is the only execution surface for these operations; the Cloudflare Pages Operations panel is **not** connected to this Railway container.

**STAR KALI API jobs are metadata/inventory tasks only.** The pre-installed diagnostic binaries can be run manually by the authenticated terminal operator, but the automated initialization makes **no network scans, packet captures, or third-party requests**. This is Debian, not a complete Kali Linux distribution. Do not test public or private network targets without authorization.

## Security constraints

- The existing web terminal allows a user with the terminal password to obtain root **inside the container** via sudo. Keep its password strong and unique, and put a proper Cloudflare Access/custom-domain identity policy or equivalent upstream gateway before using it with sensitive data.
- Do not turn on public shell, add TCP proxies for `8000`, change FastAPI to `0.0.0.0`, or use this service to scan external/private networks.
- No `STAR_OPERATOR_TOKEN` or `STAR_APPROVAL_TOKEN` in browser storage, HTML bundles, GitHub, Railway variables, or service logs.
- This launcher intentionally does not pass tokens to the Node web-terminal service process. Only the loopback FastAPI subprocess and local CLI read the private file.
- App password authentication is separate from the internal API's bearer tokens, but both credentials are accessible to the authenticated shell operator. This is not two-person approval.
- Future remote execution from Cloudflare requires an independently audited gateway enforcing identity, fine-grained scope, CSRF protection, authorization, quotas and immutable audit records.

## Validation from connectors

- GitHub CI runs existing Node/browser tests and builds the final terminal Dockerfile, then imports the pinned FastAPI Python application.
- Railway build/deployment success + runtime logs show the actual image runs. Seek log entries `[STAR KALI] Local API health verified.`, `[STAR KALI] nmap: installed`, and `[STAR KALI] Approved local tool inventory completed.`.
- This is not a real iPhone signed-in end-to-end browser test. Do not claim that a remote terminal session was opened unless it was.

## Recovery / rollback

The change is isolated to the `linux-terminal` image and startup command, and does **not** overwrite the persistent volume. If Railway fails, roll back to the previous successfully deployed image using Railway's rollback. User files in `/persist` remain intact. The credential file and SQLite will remain on the existing volume; back up before deleting the volume.

## Persistent applications and updates (iPhone)

The existing Railway volume `wormstar-terminal-data` (currently 500 MB, mounted at `/persist`) persists across image replacement. The interactive shell's `/home/tuser` points to that volume.

Use the owner terminal at `https://wormstar-ai-lab.abdulstarzeki001.workers.dev/terminal/`:

```bash
persist status            # show volume, saved APT packages and last restore
persist check             # verify volume, persistent Python/npm and APT tools
sudo apt install figlet   # example: automatically tracked in /persist
pip install requests      # installs to ~/.venv on the volume
npm install -g typescript # installs to ~/.npm-global on the volume
persist save              # save APT and package metadata snapshots
persist repair            # retry missed APT packages after network outages
persist upgrade           # upgrade Debian and replay updates on later deploys
persist auto-upgrade off  # disable OS upgrade replay if startup takes too long
```

The startup runner checks each saved APT package against the new image, reinstalls missing names and records `ready` or `degraded` under `/persist/state/restore-status.txt`. It uses bounded timeouts, so an unavailable Debian mirror does not permanently block terminal startup. `persist repair` retries without a new deployment.

Python's `~/.venv`, global npm's `~/.npm-global`, repositories, dotfiles, reports, shell history and local STAR API SQLite data are all stored under the persistent home directory. `persist save` records additional name/version inventories at `~/.config/wormstar/pip-packages.txt` and `npm-packages.json`, avoiding `pip freeze` URL credentials. Packages themselves already live in these persistent directories.

**Limits:** OS images are ephemeral; editing `/etc`, `/opt`, `/usr/local` or `/usr/bin` manually is not persistent. APT package versions may change because Debian repositories update; installed packages can fail to restore if their names disappear or network is unavailable. Major Python changes may require rebuilding the virtualenv. The 500 MB volume is not an independent backup: enable Railway Volume Backups or copy critical files to a separate repository. Do not delete/detach the existing volume.

CI uses two fresh Docker containers sharing one temporary volume. It verifies persistent home/Python/npm state, an automatically captured APT package manifest and restoration of a small extra APT package in the second container.

## Recovery gaps closed (November 18, 2026)

The default 500 MB Railway Volume contains persistent user files, package inventories and APT restore state. The added commands cover two remaining recovery cases:

```bash
persist save          # update private inventories (after installing pip/npm packages)
persist repair-user   # ON DEMAND only: reinstall pinned user Python/npm packages
persist backup        # create local, private, size-limited .tgz with SHA-256
persist backups       # list up to three snapshot archives on the volume
persist verify        # validate latest SHA-256 and compressed-tar structure
persist unpack        # extract to ~/restored/<snapshot-name>, no overwrite
persist verify star-home-YYYYMMDDTHHMMSSZ-PID.tgz
persist check         # check current apps, volume link and package restoration
```

**Snapshot contents:** `~/projects`, a `.bashrc` and `.profile` when present, pip/npm package **metadata** and the tracked Debian APT package list. It omits Git metadata, `node_modules`, `.venv`, npm caches, `.env` files, `.npmrc`, obvious private keys and password files. It does not archive `~/.ssh`, STAR AI gateway API keys or user conversation data. Other sensitive content inside your project source files is not detectable reliably and may still be present, so review what you store in `~/projects`.

**Snapshot constraints:** This command deliberately refuses more than three on-volume archives, data exceeding 80 MiB uncompressed, or a volume with less than 32 MiB free. Archives and SHA-256 files are private (0600). The CLI never deletes existing archives automatically. To verify your last archive: `persist verify`. There is **no automatic restoration of project files**, to avoid overwriting user work. `persist unpack` verifies the archive, rejects unexpected/absolute paths and extracts into a *new* `~/restored/` review folder; it never overwrites a live project.

**Important:** A snapshot on `/persist/home/tuser/backups` is **not an independent offsite backup**. If Railway loses or deletes the volume, that snapshot is lost too. Export it from an authenticated terminal to your own offline storage, use Railway native backups where your plan offers them, or commit non-secret sources to private GitHub repositories. No bucket, cloud storage credentials, or additional recurring charges are provisioned by this change.

**User tool repair:** `persist repair-user` is explicit because it contacts public Python/npm registries and npm packages can run code when installed. Only valid package names and pinned numeric version strings from the owner-created inventory are accepted, and npm install runs with `--ignore-scripts` to reduce lifecycle risk. The command does not run at startup, does not replace a broken venv automatically, and does not modify system APT packages. Use `persist repair` for APT failures instead.

The real Docker integration test creates multiple independent containers with one shared throwaway volume, validates the exported archive and checksum and confirms project `.env` exclusion. A successful test is not proof of offsite backup availability.

## Worker-origin authentication on the public Railway domain

The Railway-generated domain must not allow direct access to the shell UI or `/ws` just because the visitor knows the original `TERMINAL_PASSWORD`. Wormstar Cloudflare Access is the public owner entrypoint. A second, long, randomly generated secret is transmitted only as `X-Star-Edge-Origin` from the Cloudflare Worker to Railway.

- `TERMINAL_EDGE_ORIGIN_SECRET` is configured as a secret separately on both Cloudflare Worker `wormstar-ai-lab` and Railway service `terminal`; never store or print its value in the repository, the UI, logs or the terminal shell.
- The server only enforces this credential when Railway `TERMINAL_EDGE_MODE=enforce`; keep this OFF while deploying code/secret values, then enable after successful Worker rollout.
- Once enforced, Railway `GET /` and unauthenticated `/ws` upgrades return `403` even if an attacker has the old terminal password. `GET /health` remains anonymous for Railway's own healthcheck.
- A valid owner session in Wormstar must still receive a short-lived signed Worker ticket. Worker makes the upstream connection with its private header and authenticates the Railway WebSocket with the pre-existing `TERMINAL_RAILWAY_PASSWORD` secret.
- If the origin secret is missing in enforcement mode, Railway exits instead of silently exposing the shell. Roll back by removing `TERMINAL_EDGE_MODE` *only after* investigating the root cause; avoid leaving the public direct origin password-only.
- Validate after activation: anonymous `GET https://terminal-production-fb16bd35.up.railway.app/` returns `403`; Railway `/health` returns `200`; authenticated Wormstar `/terminal/` connects via Cloudflare.

**Scope and limits:** This protects HTTP and WebSocket access to the Railway origin. It does not change how the shell uses `sudo` *inside the isolated container*. This is a complementary origin gate, not a replacement for Cloudflare Access or a hardened sandbox.

## Export your snapshot to iPhone Files without opening Railway to the internet

This workflow uses the existing owner-gated Wormstar Cloudflare Worker. It does not create a paid bucket, grant new users access, or expose the persistent volume over a public download link.

1. Open `https://wormstar-ai-lab.abdulstarzeki001.workers.dev/terminal/` and sign in as owner via Cloudflare Access and your existing Wormstar owner session.
2. In the terminal, run `persist save`, then `persist backup`, then `persist verify`.
3. Expand the `النسخ الاحتياطي والأمان` section and tap `تنزيل آخر نسخة للآيفون`.
4. Save the downloaded `star-home-YYYYMMDDTHHMMSSZ-PID.tgz` in iPhone Files, iCloud Drive or your offline computer storage. Keeping only a copy inside the Railway volume is **not** an offsite backup.

The download is limited to the newest verified archive in `~/backups/`, capped at 80 MiB. Its SHA-256 checksum is checked by Railway before streaming. Cloudflare Access, the Wormstar owner token and the private Worker-origin credential protect the download. The endpoint returns no arbitrary directory or path listing and is intentionally unavailable without `TERMINAL_EDGE_MODE=enforce`.

**Warning:** Filename filters exclude common secrets, but project source files may contain private material or hard-coded keys. Review `~/projects` before exporting. Never share an exported `.tgz` publicly. There is no background or automatic transfer to cloud storage.

## November 2026 runtime security maintenance

Node.js 20 became end-of-life on March 24, 2026. The terminal image and private AI gateway have been moved to `node:24-bookworm` and `node:24-bookworm-slim` (Node.js 24 LTS) instead. Native `node-pty` is rebuilt inside the Docker image, not copied from the old runtime.

GitHub CI must compile the terminal image, load the bundled Python API, test both real WebSocket and persistent-volume restart behavior, and assert that both Docker images run Node.js major version 24 before merging. The persistent Railway volume is reused.

User-installed npm global tools under `~/.npm-global` survive on the volume, but any native addons compiled for the old Node.js ABI may require `persist save` then `persist repair-user` to rebuild. Do not delete your persistent home or run a blind recursive reinstall.
