import {
	type Endpoint,
	webhookEvents,
	webhooksOf,
} from '@geekmidas/constructs/endpoints';
import { hasJsonSchema, toJsonSchema } from '@geekmidas/schema/conversion';

/**
 * The `webhooks` interface of a generated client: each event delivered by the
 * `Webhooks` constructs the endpoints' APIs own (`api.webhooks(id, …)`),
 * mapped to the envelope a receiver is sent, so its handler can be typed:
 *
 * ```ts
 * function onEvent(event: webhooks[keyof webhooks]) {
 *   if (event.type === 'invoice.paid') event.payload.invoiceId;
 * }
 * ```
 *
 * Ownership decides it, as it does the document: a `Webhooks` an endpoint
 * only depends on is not listed. Empty when the APIs own none. `toTs` is the
 * generator's own JSON Schema → TypeScript conversion, so a registered payload
 * names the interface the rest of the client declares for it.
 */
export function generateWebhookTypes(
	endpoints: Endpoint<any, any, any, any, any, any>[],
	toTs: (schema: Record<string, unknown>) => string,
): string {
	const entries: string[] = [];

	for (const { type, payload: schema } of webhookEvents(
		webhooksOf(endpoints),
	)) {
		let payload = 'unknown';
		if (schema && hasJsonSchema(schema)) {
			try {
				const { $defs: _defs, ...json } = toJsonSchema(schema) ?? {};
				payload = toTs(json);
			} catch {
				// A payload that cannot be converted is typed as unknown rather
				// than failing the whole client.
			}
		}
		entries.push(
			`  '${type}': { id: string; type: '${type}'; occurredAt: string; payload: ${payload} };`,
		);
	}

	if (entries.length === 0) return '';

	return `
// ============================================================
// Webhooks
// ============================================================

/**
 * The events this API delivers to the URLs its users register, by type —
 * each the JSON envelope a receiver is sent. \`occurredAt\` is an ISO 8601
 * date-time.
 */
export interface webhooks {
${entries.join('\n')}
}
`;
}
