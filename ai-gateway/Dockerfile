FROM node:24-bookworm-slim
WORKDIR /app
COPY ai-gateway/index.js ai-gateway/provider.js ai-gateway/minis.js ai-gateway/minis-provider.js ai-gateway/mcp.js ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV NODE_ENV=production
ENV STAR_AGENT_STATE_FILE=/data/star-agent-mcp.json
EXPOSE 8081
CMD ["node","index.js"]
