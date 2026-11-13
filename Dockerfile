FROM node:20-bookworm

# Real Linux userland: shell tools, compilers, editors, package tools.
# build-essential and python3 are needed to compile node-pty.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      build-essential git nano vim less curl wget ca-certificates \
      sudo procps htop jq unzip zip openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for the shell. sudo is enabled so commands like apt install work.
# Trade-off: sudo means root inside the container. The container is the isolation boundary.
RUN useradd -m -s /bin/bash tuser \
    && echo "tuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/tuser \
    && chmod 0440 /etc/sudoers.d/tuser

WORKDIR /app/server
COPY server/package.json ./
# node-pty compiles against the Node headers already shipped in this image.
ENV npm_config_nodedir=/usr/local
RUN npm install --omit=dev

COPY server/index.js ./
COPY web /app/web

RUN chown -R tuser:tuser /app
USER tuser
ENV HOME=/home/tuser
WORKDIR /home/tuser

EXPOSE 8080
CMD ["node", "/app/server/index.js"]
