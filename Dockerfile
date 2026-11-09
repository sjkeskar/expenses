# Laboratory Management System — self-contained test image.
# Build:  docker compose build      (or: docker build -t lab-management:latest .)

# ---- build stage: install deps, generate Prisma client, build the React app
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build \
    && npm prune --omit=dev && npm install --no-save prisma@5.22.0

# ---- runtime stage
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY docker ./docker
RUN chmod +x docker/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["docker/entrypoint.sh"]
