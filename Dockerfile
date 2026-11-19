FROM python:3.12.16-slim-bookworm AS python312

# Build NetExec from a fixed upstream tag in a throwaway Bookworm toolchain.
# Keep compilers and build headers out of the production Node image.
FROM python:3.12.16-bookworm AS netexec_builder
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git build-essential rustc cargo libffi-dev libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN /usr/local/bin/python3.12 -m venv /opt/netexec312 \
    && printf 'dploot==3.1.2\n' > /tmp/netexec-constraints.txt \
    && /opt/netexec312/bin/python -m pip install --isolated --no-input \
      --disable-pip-version-check --no-cache-dir \
      -c /tmp/netexec-constraints.txt \
      "git+https://github.com/Pennyw0rth/NetExec.git@v1.5.1" \
    && /opt/netexec312/bin/python -c "import importlib.metadata as m; assert m.version('netexec') == '1.5.1'; assert m.version('dploot') == '3.1.2'" \
    && test -x /opt/netexec312/bin/nxc

FROM node:24-bookworm
COPY --from=netexec_builder /opt/netexec312 /opt/netexec312
# The Python 3.12 runtime is separate from system Python 3.11.
COPY --from=python312 /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=python312 /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=python312 /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/libpython3.12.so.1.0

# Real Linux userland: shell tools, compilers, editors, package tools.
# build-essential and python3 are needed to compile node-pty.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      libbz2-1.0 libffi8 libgdbm6 liblzma5 libncursesw6 libreadline8 libsqlite3-0 libssl3 libuuid1 zlib1g \
      build-essential git nano vim less curl wget ca-certificates gosu \
      sudo procps htop jq unzip zip openssh-client \
      nmap tcpdump tshark whois dnsutils traceroute afl++ \
    && rm -rf /var/lib/apt/lists/*
RUN ldconfig && /usr/local/bin/python3.12 -c "import ssl,sqlite3,bz2,lzma,ctypes,venv,ensurepip,sys; assert sys.version_info[:2] == (3, 12)"

# Owner-approved Certipy installation, baked into an auditable immutable image.
# Distinct from /persist/home/tuser/.venv-py312; no restart-time PyPI writes,
# no Cloudflare Access bypass and no impact on the existing persistent venv.
# certipy-ad==5.1.0 officially requires Python 3.12+.
RUN /usr/local/bin/python3.12 -m venv /opt/certipy-ad312 \
    && /opt/certipy-ad312/bin/python -m pip install --isolated --no-input \
         --no-cache-dir --disable-pip-version-check --only-binary=:all: \
         "certipy-ad==5.1.0" \
    && /opt/certipy-ad312/bin/python -c "import sys,importlib.metadata as m; assert sys.version_info[:2] == (3,12); assert m.version('certipy-ad') == '5.1.0'" \
    && test -x /opt/certipy-ad312/bin/certipy \
    && /opt/certipy-ad312/bin/certipy -h > /dev/null

# Independently pinned and isolated CLI packages; no remote targets, scans,
# device attach or privileged services are started during image build.
RUN /usr/local/bin/python3.12 -m venv /opt/impacket312 \
    && /opt/impacket312/bin/python -m pip install --isolated --no-input \
         --no-cache-dir --disable-pip-version-check --only-binary=:all: \
         "impacket==0.13.1" \
    && /opt/impacket312/bin/python -c "import importlib.metadata as m; assert m.version('impacket') == '0.13.1'" \
    && test -x /opt/impacket312/bin/lookupsid.py \
    && ln -s lookupsid.py /opt/impacket312/bin/impacket-lookupsid \
    && /opt/impacket312/bin/impacket-lookupsid -h > /dev/null
RUN /usr/local/bin/python3.12 -m venv /opt/frida312 \
    && /opt/frida312/bin/python -m pip install --isolated --no-input \
         --no-cache-dir --disable-pip-version-check --only-binary=:all: \
         "frida-tools==14.13.2" \
    && /opt/frida312/bin/python -c "import importlib.metadata as m; assert m.version('frida-tools') == '14.13.2'" \
    && test -x /opt/frida312/bin/frida \
    && /opt/frida312/bin/frida --version > /dev/null
# NetExec is an owner inventory CLI only; never runs a network target in CI.
RUN test -x /opt/netexec312/bin/nxc \
    && /opt/netexec312/bin/python -c "import importlib.metadata as m; assert m.version('netexec')=='1.5.1'"

# Debian signed APT package; only verify the binary. Do not fuzz any targets.
RUN dpkg-query -W -f='${Status}' 'afl++' | grep -qx 'install ok installed' \
    && test -x /usr/bin/afl-fuzz



# Non-root user for the shell. sudo is enabled so commands like apt install work.
# Trade-off: sudo means root inside the container. The container is the isolation boundary.
RUN useradd -m -s /bin/bash tuser \
    && echo "tuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/tuser \
    && chmod 0440 /etc/sudoers.d/tuser

# Immutable audited KALI-OSINT-STAR source (never execute project checkout at runtime).
# Keep API isolated on loopback inside the terminal container.
ARG KALI_OSINT_STAR_REF=ab4e9cdcb5e07e6941eb04e392595a1c77a3c3b0
RUN git init -q /opt/kali-osint-star \
    && git -C /opt/kali-osint-star fetch -q --depth 1 \
       https://github.com/abdulstarzeki001-sketch/KALI-OSINT-STAR.git "${KALI_OSINT_STAR_REF}" \
    && git -C /opt/kali-osint-star checkout -q --detach FETCH_HEAD \
    && python3 -m venv /opt/star-kali-venv \
    && /opt/star-kali-venv/bin/python -m pip install --no-cache-dir \
       -r /opt/kali-osint-star/services/api/requirements.txt

WORKDIR /app/server
COPY server/package.json ./
# node-pty compiles against the Node headers already shipped in this image.
ENV npm_config_nodedir=/usr/local
RUN npm install --omit=dev

COPY server/index.js ./
COPY server/edge-guard.js ./
COPY server/backup-export.js ./
COPY server/training-engine.js ./
COPY server/tool-ops.js ./
COPY server/tool-installer.js ./
COPY server/tool-install-runner.js ./
COPY server/training-fixtures ./training-fixtures
COPY server/ai.js ./
COPY server/boot-audit.js ./
COPY server/kali-shell.sh /usr/local/share/wormstar-kali-shell.sh
COPY server/run-with-kali.sh /app/server/run-with-kali.sh
COPY server/star-kali.py /usr/local/bin/star-kali
COPY server/entrypoint.sh /usr/local/bin/wormstar-entrypoint
COPY server/apt-track.sh /usr/local/bin/wormstar-apt-track
COPY server/restore-packages.sh /usr/local/bin/wormstar-restore-packages
COPY server/apt-wrapper.sh /usr/local/bin/apt
COPY server/apt-wrapper.sh /usr/local/bin/apt-get
COPY server/persist-cli.sh /usr/local/bin/persist
COPY server/persist-backup.sh /usr/local/bin/wormstar-persist-backup
COPY server/restore-user-tools.sh /usr/local/bin/wormstar-restore-user-tools
COPY server/install-approved-afl.sh /usr/local/bin/wormstar-install-afl
COPY web /app/web

# Keep default Debian profile, then add visual Bash colors to interactive login shells.
RUN printf '\n# Wormstar ANSI colors\n[ -r /usr/local/share/wormstar-kali-shell.sh ] && . /usr/local/share/wormstar-kali-shell.sh\n' >> /home/tuser/.profile \
    && chown tuser:tuser /home/tuser/.profile

# The image's manual package baseline must be saved BEFORE runtime packages.
RUN mkdir -p /persist /usr/local/share \
    && chmod +x /usr/local/bin/wormstar-install-afl \
       /usr/local/bin/wormstar-entrypoint /usr/local/bin/wormstar-apt-track \
       /usr/local/bin/wormstar-restore-packages \
       /app/server/run-with-kali.sh /usr/local/bin/star-kali \
       /usr/local/bin/apt /usr/local/bin/apt-get /usr/local/bin/persist \
       /usr/local/bin/wormstar-persist-backup /usr/local/bin/wormstar-restore-user-tools \
    && apt-mark showmanual | LC_ALL=C sort -u > /usr/local/share/wormstar-manual-base.txt \
    && printf 'DPkg::Post-Invoke { "/usr/local/bin/wormstar-apt-track || true"; };\n' > /etc/apt/apt.conf.d/98wormstar-persist \
    && chown -R tuser:tuser /app
# Only the volume/bootstrap runs as root. Entrypoint drops server + Bash to tuser.
USER root
ENV HOME=/home/tuser WORMSTAR_PERSIST_ROOT=/persist
WORKDIR /app/server
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/wormstar-entrypoint"]
CMD ["bash", "/app/server/run-with-kali.sh"]
