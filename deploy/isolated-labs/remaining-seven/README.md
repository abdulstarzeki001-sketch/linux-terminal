# STAR Remaining Seven — isolated/private lab package

This package prepares *private* runtime infrastructure for the seven tools not deployed on STAR Railway (8/15). It does not alter Railway Terminal, expand its 500 MB persistent volume, publish C2 services, or use the Windows host as a target.

## Precisely what is available

| Tool | What is prepared here | What is NOT deployed |
| --- | --- | --- |
| BloodHound Community Edition | Official app + Postgres + Neo4j Compose stack, host UI restricted to 127.0.0.1:18080, internal backend network, external passwords, persistent volumes | Not started: no eligible dedicated VM found |
| MITRE CALDERA | Pinned 5.2.0 official container image with an image-check-only command, no C2 startup | No agents, web API, listener or public domain |
| Mythic C2 | Official source/project link and isolated-host prerequisite | No Mythic server, profiles, callback handlers or implants |
| Sliver C2 | Official source/project link and isolated-host prerequisite | No Sliver server, implants or active listeners |
| Havoc C2 | Official source/project link and isolated-host prerequisite | No Havoc service, agents or teamserver |
| Rubeus | Official GhostPack source and offline Windows VM requirement | Not installed on the production Windows host |
| Mimikatz | Official gentilkiwi source and offline Windows VM requirement | Not installed on the production Windows host |

## Safety prerequisites

**Use a dedicated isolated Linux lab VM** for BloodHound CE (at least 12 GB *available* RAM and 30 GB free disk, with extra margin for actual datasets), Docker Engine and Compose. Host must block inbound traffic except an operator-approved tunnel. No default passwords. BloodHound and databases communicate over `internal: true` Docker network; only the UI binds to `127.0.0.1:18080`, which cannot be reached directly over the public network.

`preflight.sh` checks Docker, resources and the presence (not values) of secrets; it will reject STAR's current 3.8 GB WSL allocation and Railway's 500 MB volume.

On a suitable owner-authorized private VM:

```bash
cd deploy/isolated-labs/remaining-seven
# Set STAR_BH_PG_PASSWORD and STAR_BH_NEO4J_PASSWORD
# through that VM's secure secrets mechanism (never commit them).
./preflight.sh
docker compose --profile bloodhound pull
docker compose --profile bloodhound up -d
docker compose --profile bloodhound ps
```

Reach BloodHound via a **separately approved authenticated loopback tunnel**, such as an SSH local port-forward, then browse `http://127.0.0.1:18080/ui/login`. Its initial administrator password is generated at startup; do not post it or database credentials to chat. Before operational use, pin the upstream `latest` image tag to a tested digest and review vendor version compatibility.

To inspect the Caldera image, with *no Caldera server running*:

```bash
docker compose --profile caldera pull caldera-image-check
docker compose --profile caldera run --rm caldera-image-check
```

The Caldera image-check container has `network_mode: none`, no published ports and an entrypoint overridden to print an inert verification marker. Do not repurpose it as an internet-exposed C2 service.

## Other isolated environments

- **Mythic:** <https://github.com/its-a-feature/Mythic>. Requires own host with private auth and network isolation; use vendor guidance within a formally authorized lab.
- **Sliver:** <https://github.com/BishopFox/sliver>. Requires private, approved red-team range. No implant creation, callbacks or listener automation included.
- **Havoc:** <https://github.com/HavocFramework/Havoc>. Requires dedicated Linux GUI/Qt and isolated teamserver environment.
- **Rubeus:** <https://github.com/GhostPack/Rubeus>. Windows-only; separate offline/snapshotted authorized AD test VM.
- **Mimikatz:** <https://github.com/gentilkiwi/mimikatz>. Windows-only; separate credential-research VM, never a production workstation.

These are **requirements and preparation**, not claims that binaries have been installed. Do not run Windows credential-access tools on the user's primary Windows installation.

## Status and platform limits, verified 19 Nov 2026

- **Railway:** eight binaries verified in production, Terminal and STAR AI Gateway healthy. No additional service quota available for independent labs.
- **Kali WSL:** remote inspection confirmed Docker 28.5.2, ~3.8 GB RAM, 876 GB filesystem free. The local Kali packages `bloodhound` and `neo4j` are installed, but this is not an operational BloodHound CE stack. Low RAM blocks the full stack. No cloud funds or existing VM have been consumed.
- **DigitalOcean:** account returned a droplet provisioning warning, no existing reachable droplet.
- **CI:** validates network binding and Compose structure without deploying services; previous temporary GitHub Actions jobs verified official CALDERA and BloodHound images. Ephemeral CI != a continuously running application.

An operational claim requires dedicated VM capacity, actual health checks, authenticated user access and service logs. The STAR public tool counter must remain **8/15** until such live proof exists.
