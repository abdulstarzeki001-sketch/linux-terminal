FROM node:20-bookworm

# Real Linux userland: shell tools, compilers, editors, package tools.
# build-essential and python3 are needed to compile node-pty.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      build-essential git nano vim less curl wget ca-certificates \
      procps htop jq unzip zip openssh-client \
    && rm -rf /var/lib/apt/lists/*

# The web shell must not be able to escalate to root inside the container.
# Install required OS packages during the image build, not during user sessions.
RUN useradd -m -s /bin/bash tuser

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD curl --fail --silent http://127.0.0.1:8080/health > /dev/null || exit 1

EXPOSE 8080
CMD ["node", "/app/server/index.js"]
