# STAR AI Local Worker — Phase 1

**Status:** Implemented and tested in the user's Kali WSL2 checkout. This is an offline, approval-gated diagnostic worker, **not** an active connection to Colab or the Railway Gateway.

## Location
- `local_worker/worker.py` — fixed diagnostic command runner, standard library only
- `test/test_local_worker.py` — tests with mocked subprocess and security assertions
- `local_worker/job.example.json` — a sample job descriptor

## Run on Kali / WSL2

```bash
cd /home/star/star-ai-ultra-workspace
python3 local_worker/worker.py --list
python3 local_worker/worker.py --task git_branch --approve
python3 local_worker/worker.py --task python_version --approve
python3 local_worker/worker.py --job-file local_worker/job.example.json --approve
python3 -m unittest discover -s test -p 'test_local_worker.py' -v
```

The `--approve` flag is required **per invocation**, even for harmless diagnostics. Never have a remote model or a network endpoint supply this flag on its own. Present the proposed task to the authenticated owner first.

## Job contract (strict)

```json
{"id":"star-001","kind":"diagnostic","task":"git_status"}
```

Only the exact keys above are accepted. The task is chosen from a fixed allowlist: `python_version`, `node_version`, `git_branch`, `git_status`, `git_commit`, `disk_space`, `kernel`. No free-form arguments, shell commands, URLs, hostnames, targets, working directories, or executable paths may be included in the JSON job. `--workspace` is selected locally and must point to an existing Git checkout.

## Security boundaries

- Every command runs with `shell=False`, fixed `argv`, a 15-second timeout, and an explicit working directory.
- Outputs are capped at 8,000 characters each. Nonzero exit codes, missing executables, timeouts, and output truncation are reported accurately.
- Child process environment is rebuilt without credentials, proxy secrets, provider tokens, or arbitrary inherited environment variables.
- No outbound network calls, remote polling, background agent, stored credential, AI key, model inference, or unattended command execution is implemented.
- The tool **does not** grant a model permission to inspect private files or execute arbitrary terminal commands.
- The worker operates on the **WSL2 environment** where it is invoked; it does not control Windows GUI apps, Colab GPU sessions, or Railway.

## Verified locally

```bash
node --test test/*.test.js
python3 -m unittest discover -s test -p 'test_local_worker.py' -v
python3 local_worker/worker.py --task git_branch --approve
python3 local_worker/worker.py --task python_version --approve
```

The Node suite passed 92 tests before adding this worker. The new Python suite passed 11 tests. The two actual WSL2 diagnostics completed with exit code 0. These results do **not** establish AI model inference, paid API availability, or remote job transport.

## Stage 2 prerequisites (not implemented)

To connect STAR AI / Colab to a local worker without exposing the shell, create an authenticated job queue with service-specific credentials, job expiry and replay protection, owner approval, outbound-only polling, per-device identities, rate limits, and audited results. Do not reuse GitHub credentials, Railway administrator keys or model API keys as worker credentials. Do not expose `127.0.0.1` or bind a shell listener to public interfaces.
