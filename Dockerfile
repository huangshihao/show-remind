FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm prisma generate && pnpm build

# web
FROM base AS web
EXPOSE 3000
CMD ["pnpm", "start"]

# worker
FROM base AS worker
CMD ["pnpm", "worker"]
