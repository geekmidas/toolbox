CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id text PRIMARY KEY,
  owner text NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL,
  secret text NOT NULL,
  previous_secret text,
  previous_secret_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  disabled_reason text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_subscriptions_owner_idx
  ON webhook_subscriptions (owner);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES webhook_subscriptions (id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'abandoned')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (event_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_idx
  ON webhook_deliveries (subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_attempts (
  id bigserial PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES webhook_deliveries (id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  status integer,
  latency_ms integer NOT NULL,
  error text
);

CREATE INDEX IF NOT EXISTS webhook_attempts_delivery_idx
  ON webhook_attempts (delivery_id, attempted_at);
