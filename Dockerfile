FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun --bun nuxt build

# Production-only dependency tree, installed separately from the build so the
# runtime image stays lean. Its whole reason to exist: sharp's prebuilt addon
# dlopens libvips-cpp.so from @img/sharp-libvips-linux-x64 at RUNTIME, and Nitro's
# static dependency trace can't see that dlopen — so the .so never lands in
# .output. We ship it here and point the dynamic linker at it (LD_LIBRARY_PATH).
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
ENV NUXT_DB_PATH=/data/app.sqlite
ENV NUXT_MIGRATIONS_DIR=/app/migrations
# let sharp's addon find libvips-cpp.so at runtime (see the deps stage note)
ENV LD_LIBRARY_PATH=/app/node_modules/@img/sharp-libvips-linux-x64/lib

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY server/db/migrations ./migrations

EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
