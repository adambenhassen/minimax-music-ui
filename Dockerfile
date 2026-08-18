# syntax=docker/dockerfile:1.7

# ---- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm run build \
 && npm prune --omit=dev

# ---- runtime -------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/library >/dev/null || exit 1
CMD ["node", "server/dist/index.js"]
