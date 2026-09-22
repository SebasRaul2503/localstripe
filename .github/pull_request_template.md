## What does this change?

<!-- A short description and the motivation. Link the issue it closes, if any. -->

## How was it tested?

- [ ] `pnpm lint && pnpm typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm test:integration` (needs `pnpm db:test:up`)
- [ ] `pnpm e2e:up && pnpm test:e2e` (if the change affects the running stack)

## Checklist

- [ ] Docs updated (README, `docs/`, OpenAPI descriptions) if behavior changed
- [ ] `docs/stripe-compatibility.md` updated if Stripe compatibility changed
- [ ] No real card data, real Stripe keys or secrets committed
