-- Up Migration

ALTER TABLE checkout_sessions ADD COLUMN payment_intent_metadata jsonb;

-- Down Migration

ALTER TABLE checkout_sessions DROP COLUMN payment_intent_metadata;
