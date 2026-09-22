# Examples

Runnable examples against a local LocalStripe (`docker compose up -d`, API on
`http://localhost:9001`). LocalStripe is a payment **mock**: none of them charges a real card.

They are standalone npm projects, not part of the pnpm workspace. Each one reads
`LOCALSTRIPE_API_KEY` (your `sk_test_local_...` key: `docker compose logs api | grep "Secret key"`)
and optionally `LOCALSTRIPE_API_URL`.

| Example                                  | What it shows                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`stripe-node`](./stripe-node)           | The official `stripe` package pointed at LocalStripe: payment, refund, decline, Checkout Session.    |
| [`sdk-quickstart`](./sdk-quickstart)     | The same flow with `@localstripe/sdk`, plus 3D Secure, Checkout completion and auto-pagination.      |
| [`webhook-receiver`](./webhook-receiver) | A `node:http` server that verifies webhook signatures; works with endpoints or `localstripe listen`. |

The SDK-based examples depend on `file:../../packages/sdk`: run `pnpm install` and
`pnpm --filter @localstripe/sdk build` at the repository root first.
