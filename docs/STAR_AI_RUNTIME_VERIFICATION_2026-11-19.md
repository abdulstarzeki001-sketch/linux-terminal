# STAR AI — live runtime verification (19 Nov 2026)

## Current truth, not deployment claims

### A100 Google Colab
- Notebook: https://colab.research.google.com/drive/1gO0CygHePuEMbgYa0Y4pptdSK025w9WN
- The external browser successfully opened the notebook, but was **not signed into Google**.
- The page showed an A100 High-RAM selection but **no connected runtime** and no recorded completion of Qwen inference.
- Therefore: **Qwen on A100 is not verified live**. This does not contradict the owner's earlier screenshot showing CUDA worked in a different session.
- No paid runtime was started, no large model was downloaded, and no notebook cell was executed during this verification.

### Connected Kali WSL2 workstation
- Remote Desktop Commander connection verified online for `DESKTOP-16NTS4H`.
- Ollama 0.40.16 served `/api/tags` on `127.0.0.1:11434`; installed tags included `qwen3:0.6b`, `qwen3:4b`, `qwen2.5:7b`.
- A **real `/api/chat` inference request failed HTTP 500**, reporting that `llama-server` binary is missing from its expected locations.
- Thus: a healthy HTTP status and downloaded model tags do not prove usable local inference.
- WSL2 currently reported approximately 3.7 GiB system RAM and no `nvidia-smi` executable; **do not** treat this environment as the A100 cloud runtime.
- Official Ollama amd64 v0.40.16 full release archive is approximately 1.55 GB. No system-wide package replacement or large download was attempted during this verification.

### Automatic AI command execution
- `local_worker/worker.py` executes fixed, read-only diagnostic tasks only with local approval; real `git_branch`, `python_version`, and `git_status` probes returned genuine exit-code-zero results in the previous phase.
- An AI task-selection controller has been staged locally with strict allowlisted task selection and opt-in execution. Its unit tests were successful, **but live Qwen-driven task selection did not complete** because Ollama's inference runner failed.
- Do not claim 'automatic AI execution enabled' until a real model response selects a safe task and the worker returns a matching on-device result.
- Do not introduce a generic network-reachable shell, or send model-generated shell text to a command interpreter.

## Next verified gates
1. **Colab:** authorized owner signs into Google; select and connect A100; run GPU smoke and one bounded Qwen completion; capture actual `nvidia-smi` and response output.
2. **Local Qwen:** repair the missing Ollama runner using a trusted verified install, preferably in a user-scoped isolated location so the existing service is not overwritten, and test a small model first.
3. **AI controller:** rerun a one-task end-to-end allowed diagnostic through the real model after the runtime is healthy, while retaining explicit owner approval for the fixed safe set.
4. **Remote deployment:** require a separate authenticated queue design, outbound polling, replay protection, expiring signed jobs, user authorization, and audited execution. No remote auto-execution service was deployed.

## Verification limits
Syntax checks, mocked provider tests, local diagnostic execution and a real model inference request are separate forms of evidence. A passing unit test **does not** establish availability of a paid GPU, a working language model, or a production connection.
