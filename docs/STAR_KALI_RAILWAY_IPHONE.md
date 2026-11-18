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
