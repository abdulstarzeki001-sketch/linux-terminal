FROM node:24-bookworm

# Real Linux userland: shell tools, compilers, editors, package tools.
# build-essential and python3 are needed to compile node-pty.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      build-essential git nano vim less curl wget ca-certificates gosu \
      sudo procps htop jq unzip zip openssh-client \
      nmap tcpdump tshark whois dnsutils traceroute \
    && rm -rf /var/lib/apt/lists/*

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
