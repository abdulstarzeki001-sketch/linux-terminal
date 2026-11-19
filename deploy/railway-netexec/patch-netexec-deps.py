#!/usr/bin/env python3
"""Conservative, version-locked packaging-only fix for NetExec v1.5.1.

The upstream tag lists four direct Git dependency URLs; PyPI resolver on
Debian Bookworm cannot resolve one of the fork metadata dependencies.
Replace ONLY these four exact strings with pinned published versions.
Never patch Python implementation, disable security checks, or rewrite
unrecognized pyproject files. Build fails closed if upstream changes.
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-netexec-deps.py PYPROJECT")
target=Path(sys.argv[1])
data=target.read_text(encoding="utf-8")
pairs={
    '"certipy-ad @ git+https://github.com/Pennyw0rth/Certipy"': '"certipy-ad==5.1.0"',
    '"impacket @ git+https://github.com/fortra/impacket"': '"impacket==0.13.1"',
    '"oscrypto @ git+https://github.com/wbond/oscrypto"': '"oscrypto==1.3.0"',
    '"pynfsclient @ git+https://github.com/Pennyw0rth/NfsClient"': '"pynfsclient==0.1.5"',
}
for old,new in pairs.items():
    if data.count(old)!=1:
        raise SystemExit(f"Fail-closed: expected one upstream dependency {old}")
    data=data.replace(old,new)
target.write_text(data,encoding="utf-8")
print("NetExec v1.5.1: 4 fixed dependency declarations; application source unchanged")
