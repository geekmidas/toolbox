/**
 * Receiving mail locally: Mailpit's webhook, and the worker it posts to.
 *
 * Deployed, SES stores each message and publishes its receipt notification on
 * the inbox's topic. Locally Mailpit receives it, and its webhook posts each
 * message to one route — `POST /__gkm/inbox` on the worker that runs the
 * inbox subscribers — which hands it to the same receiver `mailbox.receive`
 * calls in a feature test (`receiveMail` in `@geekmidas/constructs/inbox`).
 *
 * Shared by every local stage and the local compose stack: each asks this
 * module which worker relays and with what token, and supplies only how that
 * worker is reached from its Mailpit — the host's gateway, or the stack's
 * network.
 */

import { createHash } from 'node:crypto';
import { type ConstructManifest, providedKeyFor } from '@geekmidas/manifest';
import { GkmError } from '../errors';
import type { BoundSubscriber } from './discover';

/** The route Mailpit posts each message it receives to. */
export const INBOX_ROUTE = '/__gkm/inbox';

/** The env key the relaying worker reads its token from. */
export const INBOX_RELAY_TOKEN_KEY = 'GKM_INBOX_RELAY_TOKEN';

/**
 * Inbox subscribers in more than one worker. Mailpit posts to one webhook, so
 * locally one worker receives for every inbox — #343 lifts this.
 */
export class InboxSubscribersSpanWorkers extends GkmError {
	constructor(readonly workers: readonly string[]) {
		super(
			`Inbox subscribers run in ${workers.map((w) => `'${w}'`).join(' and ')}, ` +
				`and locally mail is received by one worker: Mailpit posts each ` +
				`message to a single webhook. Bind every worker.inbox(…) to one ` +
				`worker for now (#343).`,
		);
		this.name = 'InboxSubscribersSpanWorkers';
	}
}

/**
 * The worker whose route Mailpit posts to: the one that runs every inbox
 * subscriber. `undefined` when no inbox has a subscriber.
 */
export function inboxRelayWorker(
	manifest: ConstructManifest,
	subscribers: Readonly<Record<string, readonly BoundSubscriber[]>>,
): string | undefined {
	const topicKeys = new Set<string>();
	for (const declaration of Object.values(manifest)) {
		if (declaration.kind !== 'inbox') continue;
		topicKeys.add(
			providedKeyFor(declaration.topic, 'topic', 'publisherConnectionString'),
		);
	}
	if (topicKeys.size === 0) return undefined;

	const workers = Object.keys(subscribers)
		.sort()
		.filter((worker) =>
			(subscribers[worker] ?? []).some(({ connectionKey }) =>
				topicKeys.has(connectionKey),
			),
		);
	if (workers.length > 1) throw new InboxSubscribersSpanWorkers(workers);
	return workers[0];
}

/**
 * The token Mailpit presents in the webhook's query — it cannot send a
 * header. Derived as a bucket's webhook token is: from the stage's seed where
 * one is given, and the project; not salted by the stage, since `gkm dev` and
 * `gkm test` share one Mailpit.
 */
export function inboxRelayToken(project: string, seed?: string): string {
	return createHash('sha256')
		.update(`${seed ? `${seed}:` : ''}${project}:inbox-webhook`)
		.digest('base64url')
		.slice(0, 32);
}

/** Mailpit's `MP_WEBHOOK_URL`: the relay route at `base`, with the token. */
export function inboxWebhookUrl(base: string, token: string): string {
	return `${base.replace(/\/+$/, '')}${INBOX_ROUTE}?token=${encodeURIComponent(token)}`;
}
