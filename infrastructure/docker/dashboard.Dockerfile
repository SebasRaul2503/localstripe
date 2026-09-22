# syntax=docker/dockerfile:1.7
# LocalStripe dashboard: static React SPA + backend-for-frontend. Build context: repository root.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/dashboard/package.json apps/dashboard/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@localstripe/dashboard..."
COPY packages/contracts packages/contracts
COPY apps/dashboard apps/dashboard
RUN pnpm --filter @localstripe/contracts build && pnpm --filter @localstripe/dashboard build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @localstripe/dashboard deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    DASHBOARD_PORT=3002 \
    LOCALSTRIPE_SHARED_DIR=/var/lib/localstripe/shared
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${DASHBOARD_PORT}/healthz" > /dev/null || exit 1
CMD ["node", "dist-server/main.js"]
