import type { Generated } from 'kysely';

/**
 * The tables a `Webhooks` construct keeps in its tenant.
 *
 * One schema per construct — its tenant is its own — so the names carry no
 * prefix and two constructs never share a row.
 */
export interface WebhookTables {
	webhook_subscriptions: WebhookSubscriptionRow;
	webhook_deliveries: WebhookDeliveryRow;
	webhook_attempts: WebhookAttemptRow;
}

/** Who receives which events, and with what secret. */
export interface WebhookSubscriptionRow {
	id: string;
	/** Whose subscription it is — an account, a tenant: the app decides. */
	owner: string;
	url: string;
	events: string[];
	/** The signing secret, encrypted with the construct's key. */
	secret: string;
	/** The secret it replaced, encrypted — still signing until it expires. */
	previous_secret: string | null;
	previous_secret_expires_at: Date | null;
	status: WebhookSubscriptionStatus;
	disabled_reason: string | null;
	consecutive_failures: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export type WebhookSubscriptionStatus = 'active' | 'disabled';

/** One event, owed to one subscription. */
export interface WebhookDeliveryRow {
	/** The idempotency key — sent as `webhook-id`, the same on every attempt. */
	id: string;
	subscription_id: string;
	event_id: string;
	event_type: string;
	payload: unknown;
	occurred_at: Date;
	status: WebhookDeliveryStatus;
	attempts: Generated<number>;
	next_attempt_at: Date | null;
	last_status: number | null;
	last_error: string | null;
	created_at: Generated<Date>;
	delivered_at: Date | null;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'abandoned';

/** One request made for a delivery, and what came back. */
export interface WebhookAttemptRow {
	id: Generated<number>;
	delivery_id: string;
	attempted_at: Generated<Date>;
	status: number | null;
	latency_ms: number;
	error: string | null;
}

/**
 * The DDL for {@link WebhookTables}: what `gkm migration <id>` writes as a
 * committed migration. Idempotent, so applying it over tables that already
 * exist changes nothing.
 *
 * - An event is owed to a subscription once: `(event_id, subscription_id)` is
 *   unique, so the same event published twice internally sends once.
 * - The sweep reads due rows by `next_attempt_at` among pending ones only.
 */
export const WEBHOOK_TABLES_SQL = `CREATE TABLE IF NOT EXISTS webhook_subscriptions (
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
`;

/** The tables {@link WEBHOOK_TABLES_SQL} creates, by name. */
export const WEBHOOK_TABLES = [
	'webhook_subscriptions',
	'webhook_deliveries',
	'webhook_attempts',
] as const;
