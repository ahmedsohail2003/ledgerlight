# Multi-stage build: compile the web SPA and the server, then ship a slim
# runtime image that serves both from one process (single-URL deployment).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build --workspace @ledgerlight/web \
 && npm run build --workspace @ledgerlight/server

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production dependencies only.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
# Compiled server, built SPA, and the migrations/SQL + gold-set the app reads.
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY server/src/db/migrations ./server/dist/db/migrations
COPY docs/research/gold_set_candidates.json ./docs/research/gold_set_candidates.json
USER node
EXPOSE 8080
# Fail fast if the process stops answering.
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/rules').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/api/server.js"]
