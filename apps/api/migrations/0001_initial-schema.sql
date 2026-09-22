-- Up Migration

CREATE TABLE api_keys (
  id            text PRIMARY KEY,
  type          text NOT NULL CHECK (type IN ('secret', 'publishable')),
  name          text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  key_prefix    text NOT NULL,
  key_last4     text NOT NULL,
  -- Publishable keys are public by design, so their plaintext is kept for display.
  publishable_plaintext text,
  internal      boolean NOT NULL DEFAULT false,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id              text PRIMARY KEY,
  email           text,
  name            text,
  phone           text,
  description     text,
  address         jsonb,
  default_payment_method text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_email_idx ON customers (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE payment_methods (
  id              text PRIMARY KEY,
  customer_id     text REFERENCES customers (id),
  -- Only the catalog id of the test card is stored, never the card number or CVC.
  test_card_id    text NOT NULL,
  brand           text NOT NULL,
  funding         text NOT NULL,
  last4           char(4) NOT NULL,
  exp_month       smallint NOT NULL,
  exp_year        smallint NOT NULL,
  fingerprint     text NOT NULL,
  billing_details jsonb NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_methods_customer_idx ON payment_methods (customer_id, id DESC);

CREATE TABLE payment_intents (
  id                  text PRIMARY KEY,
  amount              bigint NOT NULL CHECK (amount > 0),
  amount_received     bigint NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL,
  status              text NOT NULL,
  customer_id         text REFERENCES customers (id),
  payment_method_id   text REFERENCES payment_methods (id),
  client_secret       text NOT NULL,
  description         text,
  receipt_email       text,
  return_url          text,
  last_payment_error  jsonb,
  next_action         jsonb,
  latest_charge_id    text,
  cancellation_reason text,
  canceled_at         timestamptz,
  checkout_session_id text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_intents_status_idx ON payment_intents (status, id DESC);
CREATE INDEX payment_intents_customer_idx ON payment_intents (customer_id, id DESC);

CREATE TABLE charges (
  id                 text PRIMARY KEY,
  payment_intent_id  text NOT NULL REFERENCES payment_intents (id),
  payment_method_id  text NOT NULL REFERENCES payment_methods (id),
  customer_id        text REFERENCES customers (id),
  amount             bigint NOT NULL,
  amount_refunded    bigint NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  currency           char(3) NOT NULL,
  status             text NOT NULL CHECK (status IN ('succeeded', 'pending', 'failed')),
  failure_code       text,
  failure_message    text,
  decline_code       text,
  description        text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charges_refund_within_amount CHECK (amount_refunded <= amount)
);
CREATE INDEX charges_payment_intent_idx ON charges (payment_intent_id, id DESC);

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_latest_charge_fk FOREIGN KEY (latest_charge_id) REFERENCES charges (id);

CREATE TABLE refunds (
  id                 text PRIMARY KEY,
  charge_id          text NOT NULL REFERENCES charges (id),
  payment_intent_id  text NOT NULL REFERENCES payment_intents (id),
  amount             bigint NOT NULL CHECK (amount > 0),
  currency           char(3) NOT NULL,
  reason             text,
  status             text NOT NULL,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_intent_idx ON refunds (payment_intent_id, id DESC);
CREATE INDEX refunds_charge_idx ON refunds (charge_id, id DESC);

CREATE TABLE checkout_sessions (
  id                   text PRIMARY KEY,
  status               text NOT NULL,
  payment_status       text NOT NULL,
  currency             char(3) NOT NULL,
  amount_subtotal      bigint NOT NULL,
  amount_total         bigint NOT NULL,
  customer_id          text REFERENCES customers (id),
  customer_email       text,
  client_reference_id  text,
  payment_intent_id    text REFERENCES payment_intents (id),
  success_url          text NOT NULL,
  cancel_url           text,
  line_items           jsonb NOT NULL,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at           timestamptz NOT NULL,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkout_sessions_open_expiry_idx ON checkout_sessions (expires_at) WHERE status = 'open';
CREATE INDEX checkout_sessions_payment_intent_idx ON checkout_sessions (payment_intent_id);

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_checkout_session_fk FOREIGN KEY (checkout_session_id) REFERENCES checkout_sessions (id);

CREATE TABLE events (
  id                text PRIMARY KEY,
  type              text NOT NULL,
  object_id         text NOT NULL,
  data              jsonb NOT NULL,
  request_id        text,
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_type_idx ON events (type, id DESC);
CREATE INDEX events_object_idx ON events (object_id, id DESC);

CREATE TABLE webhook_endpoints (
  id              text PRIMARY KEY,
  url             text NOT NULL,
  description     text,
  enabled_events  text[] NOT NULL,
  secret          text NOT NULL,
  status          text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id                    text PRIMARY KEY,
  event_id              text NOT NULL REFERENCES events (id),
  webhook_endpoint_id   text NOT NULL REFERENCES webhook_endpoints (id),
  status                text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts              integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  locked_until          timestamptz,
  last_attempt_at       timestamptz,
  last_response_status  integer,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, webhook_endpoint_id)
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries (webhook_endpoint_id, id DESC);
CREATE INDEX webhook_deliveries_event_idx ON webhook_deliveries (event_id);

CREATE TABLE webhook_delivery_attempts (
  id                    text PRIMARY KEY,
  webhook_delivery_id   text NOT NULL REFERENCES webhook_deliveries (id) ON DELETE CASCADE,
  attempt               integer NOT NULL,
  response_status       integer,
  response_body         text,
  error                 text,
  duration_ms           integer NOT NULL,
  succeeded             boolean NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_delivery_attempts_delivery_idx ON webhook_delivery_attempts (webhook_delivery_id, attempt);

CREATE TABLE idempotency_keys (
  id               bigserial PRIMARY KEY,
  api_key_id       text NOT NULL,
  key              text NOT NULL,
  request_method   text NOT NULL,
  request_path     text NOT NULL,
  request_hash     text NOT NULL,
  status           text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  response_status  integer,
  response_body    jsonb,
  locked_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE jobs (
  id            text PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  run_at        timestamptz NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs (run_at);

-- Down Migration

DROP TABLE jobs;
DROP TABLE idempotency_keys;
DROP TABLE webhook_delivery_attempts;
DROP TABLE webhook_deliveries;
DROP TABLE webhook_endpoints;
DROP TABLE events;
ALTER TABLE payment_intents DROP CONSTRAINT payment_intents_checkout_session_fk;
DROP TABLE checkout_sessions;
DROP TABLE refunds;
ALTER TABLE payment_intents DROP CONSTRAINT payment_intents_latest_charge_fk;
DROP TABLE charges;
DROP TABLE payment_intents;
DROP TABLE payment_methods;
DROP TABLE customers;
DROP TABLE api_keys;
