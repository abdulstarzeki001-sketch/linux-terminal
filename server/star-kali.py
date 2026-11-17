#!/usr/bin/env python3
"""Owner-initiated, loopback-only control client for the STAR training API.

Never connects to third-party targets. CLI only talks to 127.0.0.1:8000.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8000"
AUTH_FILE = Path.home() / ".config/kali-osint-star/local-auth.env"


def tokens() -> dict[str, str]:
    if not AUTH_FILE.is_file():
        raise RuntimeError("Missing private local auth file; check Railway startup logs")
    data = {}
    for line in AUTH_FILE.read_text(encoding="ascii").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            if key in {"STAR_OPERATOR_TOKEN", "STAR_APPROVAL_TOKEN"}:
                data[key] = value
    if any(len(data.get(name, "")) < 32 for name in ("STAR_OPERATOR_TOKEN", "STAR_APPROVAL_TOKEN")):
        raise RuntimeError("Local credential file is incomplete")
    return data


def call(path: str, method: str = "GET", payload=None, approval: bool = False):
    headers = {"Accept": "application/json"}
    if path != "/api/v1/health":
        secret = tokens()
        headers["Authorization"] = "Bearer " + secret["STAR_OPERATOR_TOKEN"]
        if approval:
            headers["X-STAR-APPROVAL"] = secret["STAR_APPROVAL_TOKEN"]
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"Local API returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError("KALI-OSINT-STAR API is not reachable on loopback") from exc


def run_inventory(kind: str):
    # Explicit CLI invocation is the operator's approval for this predefined local-only task.
    job = call("/api/v1/jobs", "POST", {"kind": kind})
    jid = job["id"]
    call("/api/v1/jobs/" + jid + "/approve", "POST", {
        "reason": "Read-only inventory approved by authenticated terminal operator",
        "scope_confirmed": True
    }, approval=True)
    return call("/api/v1/jobs/" + jid + "/run", "POST")


def main():
    parser = argparse.ArgumentParser(description="STAR KALI local, training-only console")
    parser.add_argument("command", choices=["health", "capabilities", "catalog", "system", "inventory", "audit"],
                        help="Inventory and metadata only; no shell commands or network scans")
    args = parser.parse_args()
    path_by_command = {
        "health": "/api/v1/health",
        "capabilities": "/api/v1/capabilities",
        "catalog": "/api/v1/tooling/catalog",
        "audit": "/api/v1/audit",
    }
    try:
        if args.command in ("system", "inventory"):
            result = run_inventory("system_inventory" if args.command == "system" else "tool_inventory")
        else:
            result = call(path_by_command[args.command])
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (RuntimeError, ValueError, KeyError) as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
