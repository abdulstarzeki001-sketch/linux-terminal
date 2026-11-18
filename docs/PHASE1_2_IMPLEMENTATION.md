# STAR AI — Phase 1 & 2 (staging branch only)

## Verified service topology (2026-11-18)
- Cloudflare Pages: `kali-osint-star.pages.dev` (main branch); Access-protected routes use a private Worker Service Binding.
- Railway project `linux-terminal`: services `terminal` and `star-ai-gateway`, both reported Online in production.
- `terminal` attaches Railway persistent volume at `/persist`; boot audit reports restored applications, and tools catalog HTTP reached the origin with status 200.
- Gateway preflight reported `GATEWAY_READY`, which is **not** proof of a successful model completion. One-time live smoke marker was already attempted: inspect prior logs before retrying a paid model request.
- Remote Desktop Commander Kali workstation was Offline when checked.

## Phase 1: execution proof checklist
1. Authenticate with Cloudflare Access; verify unauthenticated `/api/terminal/tools/catalog` is denied.
2. From an authenticated browser, call the catalog, inspect one tool, and verify the returned timestamp, actual executable presence, and execution marker. Record results and status code.
3. Open terminal and perform an authenticated WebSocket session; confirm visible prompt and session close (no password stored in reports).
4. Request one AI answer as authenticated owner and confirm a non-empty answer *from provider*, not merely `GATEWAY_READY` or rules fallback.
5. Inspect Railway deployment logs, persistent volume status (`persist check`), and `persist verify` for backups.
6. Run Node/Python CI and report actual outcomes; do not represent a commit or GitHub PR as a successful deployment.

## Phase 2: installation planning
This branch adds `server/tool-installer.js` for a **read-only, fifteen-tool deployment plan** and a persistent-manifest health report.
It does NOT expose an endpoint to install or execute arbitrary software. Install commands are suggestions, not automatically executed.
Packages requiring Windows, privileged kernel VMs, C2 services, or dedicated databases are separated for manual lab design.
Install an approved item from the owner's protected Railway terminal only after reviewing its package provenance, disk budget and license; use `persist save` afterwards and `persist check` on the next deployment.
For pinned Python packages, use the persistent `/home/tuser/.venv` (not system Python). APT binaries must be replayed from saved manifests after image rebuilds.

## Follow-up
- Extend with authenticated, approval-gated queued installer **only** after first-stage diagnostics.
- Persist job logs and exit codes in `/persist`, bound time and output, and show explicit user confirmation and cancellation.
- Integrate `getCatalog()` through the internal origin-gated API; never expose it directly to anonymous visitors.
