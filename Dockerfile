FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun --bun nuxt build

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
ENV NUXT_DB_PATH=/data/app.sqlite
ENV NUXT_MIGRATIONS_DIR=/app/migrations

COPY --from=build /app/.output ./.output
COPY server/db/migrations ./migrations

EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
