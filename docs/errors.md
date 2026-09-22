# Errors

Every error uses Stripe's envelope, so Stripe SDKs raise their usual typed errors:

```json
{
  "error": {
    "type": "card_error",
    "code": "card_declined",
    "decline_code": "insufficient_funds",
    "message": "Your card has insufficient funds. (Simulated by LocalStripe; no real payment was attempted.)",
    "payment_intent": { "id": "pi_local_01...", "status": "requires_payment_method", "...": "..." }
  }
}
```

Every response also carries a `Request-Id` header (`req_...`) that appears in the API logs. Stack
traces are never returned.

## Types

| `type` | HTTP status | Meaning |
| --- | --- | --- |
| `invalid_request_error` | 400, 403, 404, 413, 415 | Invalid parameters, unknown resource, forbidden for this key, malformed body. |
| `authentication_error` | 401 | Missing, invalid or revoked API key. |
| `card_error` | 402 | The simulated payment was declined. Includes `decline_code` and `payment_intent` when relevant. |
| `idempotency_error` | 400, 409 | Idempotency key reused with different parameters (400) or still in use (409). |
| `rate_limit_error` | 429 | Too many requests (`RATE_LIMIT_MAX` per minute per key). |
| `api_error` | 500 | Unexpected LocalStripe failure. Please open an issue with the `Request-Id`. |

## Codes

| `code` | When |
| --- | --- |
| `api_key_required` | No `Authorization` header. |
| `api_key_invalid` | Unknown or revoked key. |
| `permission_denied` | Publishable key used on a secret-key endpoint, wrong `client_secret`, a key revoking itself. |
| `parameter_missing` | A required parameter is missing (`param` names it). |
| `parameter_invalid` | A parameter has an invalid value (`param` names it, e.g. `card[exp_month]`). |
| `parameter_unknown` | Unknown parameter while `STRICT_PARAMS=true`. |
| `resource_missing` | The object does not exist, or the URL is unknown. |
| `payment_intent_unexpected_state` | The action is not allowed from the PaymentIntent's status (see the lifecycle). |
| `payment_intent_authentication_failure` | The simulated 3DS challenge was failed (set in `last_payment_error`). |
| `payment_method_unexpected_state` | Attaching a payment method that belongs to another customer, etc. |
| `checkout_session_unexpected_state` | Paying or expiring a session that is not open. |
| `amount_too_large` | Refund larger than the remaining refundable amount; session total too large. |
| `amount_too_small` | Refund amount not positive. |
| `charge_already_refunded` | Nothing left to refund. |
| `incorrect_number` | Card number not in the test card catalog. |
| `invalid_expiry_month`, `invalid_expiry_year` | Invalid or past expiry date. |
| `incorrect_cvc` | CVC of the wrong length when creating a payment method, or the `incorrect_cvc` test card. |
| `card_declined` | Declining test card (see `decline_code`: `generic_decline`, `insufficient_funds`, ...). |
| `expired_card`, `processing_error` | Test cards that simulate those declines. |
| `idempotency_key_in_use`, `idempotency_key_reused` | See [Idempotency](../README.md#idempotency). |
| `body_too_large`, `malformed_request` | Body over `BODY_LIMIT_BYTES`, unparsable JSON, unsupported content type. |
| `rate_limit` | Rate limit exceeded. |
| `internal_error` | Unexpected error (500). |

The list is also exported as `ERROR_CODES` / `ERROR_TYPES` from `@localstripe/contracts`. Custom test
cards in a catalog file may define additional decline codes.
