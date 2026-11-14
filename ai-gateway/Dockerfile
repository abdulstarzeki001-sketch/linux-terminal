FROM node:20-bookworm-slim
WORKDIR /app
COPY ai-gateway/index.js ai-gateway/provider.js ./
USER node
ENV NODE_ENV=production
EXPOSE 8081
CMD ["node","index.js"]
