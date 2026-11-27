import {
	type Endpoint,
	WebhookEventDeclaredTwice,
	webhooksOf,
} from '@geekmidas/constructs/endpoints';
import { hasJsonSchema, toJsonSchema } from '@geekmidas/schema/conversion';

/**
 * The `webhooks` interface of a generated client: each event the endpoints'
 * surfaces deliver (`api.webhooks(topic, …)`), mapped to the body a receiver
 * is sent, so its handler can be typed:
 *
 * ```ts
 * function onEvent(event: webhooks[keyof webhooks]) {
 *   if (event.type === 'invoice.paid') event.payload.invoiceId;
 * }
 * ```
 *
 * Empty when no surface delivers any. `toTs` is the generator's own
 * JSON Schema → TypeScript conversion, so a registered payload names the
 * interface the rest of the client declares for it.
 */
export function generateWebhookTypes(
	endpoints: Endpoint<any, any, any, any, any, any>[],
	toTs: (schema: Record<string, unknown>) => string,
): string {
	const entries: string[] = [];
	const carriedBy = new Map<string, string>();

	for (const { topic, options } of webhooksOf(endpoints)) {
		for (const type of options.events ?? topic.eventTypes) {
			const other = carriedBy.get(type);
			if (other !== undefined) {
				throw new WebhookEventDeclaredTwice(type, [other, topic.name]);
			}
			carriedBy.set(type, topic.name);

			const schema = topic.eventSchemas[type];
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
			entries.push(`  '${type}': { type: '${type}'; payload: ${payload} };`);
		}
	}

	if (entries.length === 0) return '';

	return `
// ============================================================
// Webhooks
// ============================================================

/**
 * The events this API delivers to the URLs its users register, by type —
 * each the JSON body a receiver is sent.
 */
export interface webhooks {
${entries.join('\n')}
}
`;
}
