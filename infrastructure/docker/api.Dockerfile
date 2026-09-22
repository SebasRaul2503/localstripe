# syntax=docker/dockerfile:1.7
# LocalStripe API + worker + CLI. Build context: repository root.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/sdk/package.json packages/sdk/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@localstripe/api..." --filter "@localstripe/cli..."
COPY packages/contracts packages/contracts
COPY packages/sdk packages/sdk
COPY apps/api apps/api
COPY apps/cli apps/cli
RUN pnpm --filter @localstripe/contracts build \
 && pnpm --filter @localstripe/sdk build \
 && pnpm --filter @localstripe/api build \
 && pnpm --filter @localstripe/cli build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @localstripe/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    API_PORT=9001 \
    LOCALSTRIPE_SHARED_DIR=/var/lib/localstripe/shared
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build /repo/apps/cli/dist/main.js /usr/local/lib/localstripe/cli.js
# The shared directory is seeded into the named volume with node ownership on first use.
RUN printf '#!/bin/sh\nexec node /usr/local/lib/localstripe/cli.js "$@"\n' > /usr/local/bin/localstripe \
 && chmod +x /usr/local/bin/localstripe \
 && mkdir -p /var/lib/localstripe/shared \
 && chown -R node:node /var/lib/localstripe
USER node
EXPOSE 9001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/health" > /dev/null || exit 1
CMD ["node", "dist/main.js"]
