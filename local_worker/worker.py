"""STAR AI local diagnostic worker.

Never accepts shell text from a model. Only fixed, reviewable diagnostic tasks run,
and each invocation requires a local approval flag. No outbound connections.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_JOB_BYTES = 16_384
MAX_OUTPUT_CHARS = 8_000
TIMEOUT_SECONDS = 15
JOB_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
TASKS = {
    "python_version": ("python3", "--version"),
    "node_version": ("node", "--version"),
    "git_branch": ("git", "branch", "--show-current"),
    "git_status": ("git", "status", "--short", "--untracked-files=no"),
    "git_commit": ("git", "log", "-1", "--format=%h %s"),
    "disk_space": ("df", "-h", "."),
    "kernel": ("uname", "-srm"),
}


class InvalidJob(ValueError):
    """The task is outside the worker's fixed diagnostic contract."""


def validate_job(job: Any) -> tuple[str, str]:
    if not isinstance(job, dict) or set(job) != {"id", "kind", "task"}:
        raise InvalidJob("Job must contain exactly: id, kind, task")
    job_id, kind, task = job["id"], job["kind"], job["task"]
    if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
        raise InvalidJob("Invalid job id")
    if kind != "diagnostic":
        raise InvalidJob("Only diagnostic jobs are supported")
    if not isinstance(task, str) or task not in TASKS:
        raise InvalidJob("Task not allowed")
    return job_id, task


def clean_environment() -> dict[str, str]:
    """No keys, passwords, proxy credentials or AI secrets reach child commands."""
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
        "NO_COLOR": "1",
    }


def bounded(text: str | None) -> tuple[str, bool]:
    content = text or ""
    return content[:MAX_OUTPUT_CHARS], len(content) > MAX_OUTPUT_CHARS


def execute_job(
    job: Any,
    *,
    workspace: str | Path,
    approved: bool,
    runner: Any = subprocess.run,
) -> dict[str, Any]:
    job_id, task = validate_job(job)
    if not approved:
        raise PermissionError("Local --approve is required for every execution")
    root = Path(workspace).expanduser().resolve(strict=True)
    if not root.is_dir() or not (root / ".git").exists():
        raise InvalidJob("Workspace must be an existing Git repository")
    args = TASKS[task]
    start = time.monotonic()
    try:
        completed = runner(
            list(args),
            cwd=str(root),
            env=clean_environment(),
            shell=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=TIMEOUT_SECONDS,
        )
        stdout, stdout_truncated = bounded(completed.stdout)
        stderr, stderr_truncated = bounded(completed.stderr)
        code = int(completed.returncode)
        status = "completed" if code == 0 else "failed"
    except subprocess.TimeoutExpired:
        stdout, stderr, code, status = "", "Task timed out", 124, "timeout"
        stdout_truncated = stderr_truncated = False
    except OSError:
        stdout, stderr, code, status = "", "Diagnostic executable unavailable", 127, "failed"
        stdout_truncated = stderr_truncated = False

    return {
        "id": job_id,
        "kind": "diagnostic",
        "task": task,
        "status": status,
        "exit_code": code,
        "duration_ms": round((time.monotonic() - start) * 1000),
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "stdout": stdout,
        "stderr": stderr,
        "truncated": stdout_truncated or stderr_truncated,
        "source": "star-ai-local-worker",
        "execution": "real-local" if status != "timeout" else "timed-out",
    }


def load_job(path: Path) -> Any:
    if path.stat().st_size > MAX_JOB_BYTES:
        raise InvalidJob("Job file too large")
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Approval-gated STAR AI local diagnostics")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--list", action="store_true", help="Show allowed tasks (no execution)")
    target.add_argument("--task", choices=sorted(TASKS), help="A fixed diagnostic task")
    target.add_argument("--job-file", type=Path, help="Local JSON job file (untrusted input)")
    parser.add_argument("--approve", action="store_true", help="Required for every diagnostic execution")
    parser.add_argument(
        "--workspace",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Existing Git checkout to inspect (default: this repository)",
    )
    args = parser.parse_args(argv)
    if args.list:
        print(json.dumps({"allowed_tasks": sorted(TASKS), "shell": False, "approval_required": True}))
        return 0
    try:
        job = (
            load_job(args.job_file) if args.job_file
            else {"id": "local-" + uuid.uuid4().hex[:16],
                  "kind": "diagnostic", "task": args.task}
        )
        result = execute_job(job, workspace=args.workspace, approved=args.approve)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] == "completed" else 1
    except (InvalidJob, PermissionError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({
            "status": "rejected", "error": type(exc).__name__,
            "reason": str(exc)[:180], "execution": "none"
        }, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
