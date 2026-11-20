FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ai-gateway/index.js ai-gateway/provider.js ai-gateway/minis.js ai-gateway/minis-provider.js ai-gateway/mcp.js ai-gateway/redteam-lab.js ai-gateway/review.html ./
COPY ai-gateway/entrypoint.sh /usr/local/bin/star-entrypoint
RUN chmod 0755 /usr/local/bin/star-entrypoint && mkdir -p /data
ENV NODE_ENV=production
ENV STAR_AGENT_STATE_FILE=/data/star-agent-mcp.json
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/star-entrypoint"]
CMD ["node","index.js"]
