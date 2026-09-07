import { Credential } from '@geekmidas/constructs/credential';
import { z } from 'zod';

/**
 * A third-party credential, with a shape.
 *
 * The distinction from a `Secret` is lifecycle, not storage: a signing key is
 * generated and rotated by the platform, while this one is issued by somebody
 * else, arrives with several fields, and is worth checking on the way in.
 *
 * It is validated where it is read, so a half-set credential fails when the
 * process starts rather than on the first request that needed the one field
 * somebody forgot. Set it as one JSON value:
 *
 * ```
 * gkm secrets:set PAYMENTS_CREDENTIAL '{"secretKey":"sk_...","webhookSecret":"whsec_..."}'
 * ```
 *
 * A handler reaches it as `services.payments.secretKey` — already parsed, with
 * nothing to await, because the service registry resolves it before the handler
 * runs.
 */
export const payments = new Credential('Payments', {
	schema: z.object({
		secretKey: z.string().min(1),
		webhookSecret: z.string().min(1),
	}),
});
