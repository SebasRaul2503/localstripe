# @localstripe/dashboard

Web dashboard for LocalStripe (a local payment **mock** — no real payments are processed).

- `src/` — React SPA (Vite, Tailwind v4, TanStack Query, React Router). It only calls relative
  `/api/v1/...` URLs and never sees an API key.
- `server/` — small Fastify backend-for-frontend (BFF): serves the built SPA, proxies `/api/v1/*` to
  the LocalStripe API with the dashboard's internal key, and exposes `/config.json` and `/healthz`.

## Development

Run the BFF against a running API (it reads the key from `DASHBOARD_API_KEY`, or from
`$LOCALSTRIPE_SHARED_DIR/dashboard.key` which the API writes):

```sh
LOCALSTRIPE_API_INTERNAL_URL=http://localhost:9001 \
LOCALSTRIPE_SHARED_DIR=../../.localstripe-dev \
pnpm --filter @localstripe/dashboard dev:server   # BFF on :3002

pnpm --filter @localstripe/dashboard dev          # Vite on :5173, proxies /api and /config.json to :3002
```

## Production

```sh
pnpm --filter @localstripe/dashboard build   # dist/ (SPA) + dist-server/ (BFF)
pnpm --filter @localstripe/dashboard start   # node dist-server/main.js
```

| Variable                       | Default                       | Purpose                                |
| ------------------------------ | ----------------------------- | -------------------------------------- |
| `LOCALSTRIPE_API_INTERNAL_URL` | `http://localhost:9001`       | API the BFF proxies to                 |
| `DASHBOARD_API_KEY`            | —                             | Key to inject (overrides the key file) |
| `LOCALSTRIPE_SHARED_DIR`       | `/var/lib/localstripe/shared` | Directory containing `dashboard.key`   |
| `PUBLIC_API_URL`               | `http://localhost:9001`       | API URL shown in the UI (docs links)   |
| `DASHBOARD_HOST` / `_PORT`     | `0.0.0.0` / `3002`            | Listen address                         |
| `LOG_LEVEL`                    | `info`                        | Pino log level                         |

If the key file does not exist yet, API calls return `503` until it appears; if the API answers
`401`, the file is re-read once (the key may have been rotated).

## Tests

```sh
pnpm --filter @localstripe/dashboard test:unit
pnpm --filter @localstripe/dashboard typecheck
```
