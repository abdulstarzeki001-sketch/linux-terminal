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

## Optional Qwen task planner (Phase 1.5)

The additional module in local_worker/ai_controller.py asks an already-running LOCAL Ollama model (fixed endpoint http://127.0.0.1:11434/api/chat) to select exactly one name from the diagnostic allowlist. It uses strict JSON parsing and never turns model output into shell text.

- Propose without execution: python3 -m local_worker.ai_controller --prompt 'ما هو فرع Git الحالي؟'
- Explicit one-shot safe automatic execution: python3 -m local_worker.ai_controller --prompt 'ما هو فرع Git الحالي؟' --auto-safe
- Optional installed model: append --model qwen3:0.6b (tiny local smoke-test model, not cloud A100)
- Test: python3 -m unittest discover -s test -p 'test_ai_controller.py' -v

Every invocation with --auto-safe authorizes at most one hard-coded, read-only task. Unsupported actions and model responses with extra command fields are rejected. No continuous polling or remote shell API is activated.

### Current runtime blockers (verified November 19, 2026)
- On Kali WSL2, the Ollama HTTP health/tag endpoints respond, but a real Qwen request fails HTTP 500 because the installation lacks the llama-server executable. The installed model weights are NOT proof of runnable AI. Restoring a full Ollama runtime would require a separate reviewed installation; the official Linux archive is approximately 1.55 GB. It was **not** downloaded here, to avoid unnecessary storage/network and laptop-memory usage.
- The linked Google Colab notebook can be viewed, but the cloud browser session is not signed in as the owner and shows no active A100 runtime or generated output. **Qwen on A100 has not been verified**.
- Railway STAR AI Gateway is deployed and holds AI configuration, but its private-network endpoint is not directly reachable from this laptop. The planner currently does not connect to it or to Colab.
- Offline Python tests use a fake model response solely to exercise tool routing and authorization, not to simulate or claim a successful Qwen inference.
