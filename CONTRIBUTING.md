# Contributing to LocalStripe

Thanks for helping! LocalStripe aims to be a small, dependable tool, so contributions that keep it
simple, well-tested and honest about Stripe compatibility are the most welcome.

## Development setup

Requirements: Node.js ≥ 20.19 (22 recommended), pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
pnpm build:packages          # builds @localstripe/contracts and @localstripe/sdk (other packages import their dist)
pnpm db:test:up              # throwaway Postgres on localhost:55432

# Run the API with hot reload against that database:
DATABASE_URL=postgres://localstripe:localstripe@localhost:55432/localstripe_test \
LOCALSTRIPE_SECRET_KEY=sk_test_local_dev_0000000000000000 \
LOCALSTRIPE_SHARED_DIR=.localstripe-dev \
pnpm --filter @localstripe/api dev

# Dashboard (in two terminals): the BFF server, then Vite
LOCALSTRIPE_API_INTERNAL_URL=http://localhost:9001 DASHBOARD_API_KEY=sk_test_local_dev_0000000000000000 \
pnpm --filter @localstripe/dashboard dev:server
pnpm --filter @localstripe/dashboard dev
```

## Checks

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:integration        # needs `pnpm db:test:up`
pnpm e2e:up && pnpm test:e2e && pnpm e2e:down   # full docker stack
```

CI runs all of them on every pull request.

## Guidelines

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`), with a scope when useful
  (`feat(api): ...`).
- **Architecture**: business rules go in services and pure domain files, never in routes or React
  components. See [docs/architecture.md](docs/architecture.md), including "Adding a resource".
- **Comments** explain _why_, not _what_: non-obvious decisions, external constraints, and
  deliberate differences from Stripe.
- **Tests**: pure rules get unit tests; anything touching the database gets integration tests;
  user-visible flows get an E2E test when practical.
- **Compatibility**: if behavior differs from Stripe, say so in
  [docs/stripe-compatibility.md](docs/stripe-compatibility.md).
- **Safety**: never add code paths that could process real cards or talk to real payment networks,
  and never store or log card numbers or CVCs.

## Releasing

Versions follow [SemVer](https://semver.org/). Update [CHANGELOG.md](CHANGELOG.md), bump versions,
tag `vX.Y.Z`.
