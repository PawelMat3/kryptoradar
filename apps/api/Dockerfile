# Budowanie z katalogu głównego repozytorium (monorepo): docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build -w apps/api && cp -r apps/api/src/db/migrations apps/api/dist/db/migrations

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/data apps/api/data
USER node
WORKDIR /app/apps/api
ENV RADAR_DATA_DIR=/app/apps/api/data
EXPOSE 3000
CMD ["node", "dist/index.js"]
