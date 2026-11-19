# STAR ISOLATED LABS — private lab infrastructure

This package creates **real, offline, reproducible tool containers** for an owner-authorized cyber lab. It does **not** install tools into STAR Terminal's small /persist volume, create public C2 listeners, or claim that eleven tools are deployed merely because their cards exist. `tool-status.json` is authoritative for readiness.

## Current status (19 November 2026)

- STAR Terminal on Railway remains separate and healthy, with Certipy, Impacket, Frida and AFL++ verified there (4/15).
- The new Railway project request **failed**: `Free plan resource provision limit exceeded`. No new billed services, VMs or public domains were created.
- This repository supplies audited offline containers for **NetExec** and **Ligolo-ng**, plus a dedicated **Ghidra headless** image. Running containers still requires a Docker host with available resources.
- **BloodHound CE** needs the official app + PostgreSQL + Neo4j; **CALDERA** and the three C2 frameworks need separate authenticated lab-only services. **Rubeus/Mimikatz** require a Windows VM; **Syzkaller** requires Linux/QEMU with a KCOV-enabled kernel. No production launches are configured for these services.
- CI can build and verify the small Kali image in an **ephemeral GitHub Actions runner**, avoiding laptop resource use. CI is not a continuously available terminal and does not preserve data.

## Prerequisites & isolation

Use an owner-controlled Linux VM with Docker Engine + Docker Compose. Suggested minimum allocations, not performance guarantees:

| Role | Suggested RAM | Suggested free disk | Route |
| --- | --- | --- | --- |
| Kali audit (NetExec, Ligolo-ng binaries) | 4 GiB | 12 GiB | offline container |
| Ghidra headless | 8 GiB | 20 GiB | offline container |
| BloodHound CE app, PostgreSQL, Neo4j | 16 GiB | 30 GiB | dedicated database stack |
| CALDERA/other C2 lab services | 8 GiB each | 20 GiB each | private host-only lab |
| Windows identity research | 8–16 GiB per VM | 40 GiB | isolated Windows VM |
| Syzkaller research | 16 GiB+ | 40 GiB+ | QEMU/KCOV kernel VM |

The 4 GiB / 8 GiB / 16 GiB values above are planning allocations, **not** verified official minimums for every workload. Do not run all workloads simultaneously on a small VPS.

Both Compose profiles have `network_mode: none`, **zero published ports**, dropped Linux capabilities, no new privileges, non-root users and read-only filesystems. Image **builds** download signed packages from the official Kali repository. Runtime network access is disabled by default.

## Offline Kali audit lab

```bash
cd deploy/isolated-labs
bash scripts/preflight.sh audit
docker compose --profile audit build kali-audit
docker compose --profile audit run --rm kali-audit
# Read-only CLI checks; do not pass a network target:
docker compose --profile audit run --rm kali-audit 'nxc --version'
docker compose --profile audit run --rm kali-audit 'ligolo-proxy -version'
```

The Ligolo proxy and agent are not started or configured as relays; only offline versions are checked. For authorized network traffic, create a separate private/VLAN-isolated training target environment with explicit route and scope approval; **do not remove the network isolation or publish ports as a shortcut**.

## Offline Ghidra analysis lab

```bash
cd deploy/isolated-labs
bash scripts/preflight.sh analysis
docker compose --profile analysis build ghidra-analysis
docker compose --profile analysis run --rm ghidra-analysis
```

The Ghidra image installs the official Kali `ghidra` package and verifies the installed `analyzeHeadless` entrypoint. No GUI is forwarded, no sample is processed automatically and no ports are exposed.

## Dedicated services not provisioned by this repository

**BloodHound CE:** Follow SpecterOps' [official Community Edition quickstart](https://bloodhound.specterops.io/get-started/quickstart/community-edition-quickstart) or [official Docker Compose example](https://github.com/SpecterOps/BloodHound/tree/main/examples/docker-compose), with isolated database volumes and unique secrets. Bind the UI to localhost or an authenticated private tunnel. Do not reuse tutorial/default DB credentials when exposing it.

**MITRE CALDERA:** Use the [official install guide](https://caldera.readthedocs.io/en/5.3.0/Installing-Caldera.html) with a pinned stable release and isolate its listening endpoints. Do not use `--insecure` for remotely accessible services.

**Mythic, Sliver, Havoc:** Require independent lab VMs, isolated ranges, access control and explicit authorization before activation. This repository intentionally has no listener bootstrap, public domains, callback configuration, agents or automated payload deployment.

**Windows (Rubeus, Mimikatz):** Must remain in an owner-authorized, snapshotted, offline Windows VM; isolate credentials, disable shared clipboard/host mounts where possible and don't use the production laptop as the lab by default.

**Syzkaller:** Requires QEMU and Linux kernel instrumentation, including `CONFIG_KCOV`, with nested virtualization support where necessary. See [official setup](https://github.com/google/syzkaller/blob/master/docs/linux/setup.md).

## Costs & next deployment gate

Railway currently refuses new resource provisioning for this account's plan. Storing GitHub source files does not start a billed Railway service, but GitHub Actions minutes and any future Docker VM/cloud servers may be billable subject to plan limits. Before commissioning live VMs: confirm quotas, a bounded monthly spend limit, networking access and the user's intended Windows/QEMU provider. Do **not** run `railway up`, add public domains, expose VNC/SSH ports or commit API keys into this repository.

After provisioning, verification must report **both** a successful binary-level smoke test and a protected live endpoint where appropriate. A directory listing or a green GitHub build alone is not proof of a running 24/7 lab.
