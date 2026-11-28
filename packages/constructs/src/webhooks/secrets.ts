import type { Selectable } from 'kysely';
import type { Cipher } from '../encryption/cipher';
import type { WebhookSubscriptionRow } from './schema';

/**
 * The secrets a delivery to this subscription is signed with, in plaintext:
 * its current one, and the one it replaced while that still overlaps.
 */
export async function signingSecrets(
	row: Pick<
		Selectable<WebhookSubscriptionRow>,
		'secret' | 'previous_secret' | 'previous_secret_expires_at'
	>,
	cipher: Cipher,
	now: Date = new Date(),
): Promise<string[]> {
	const secrets = [await cipher.decrypt(row.secret)];
	if (
		row.previous_secret &&
		row.previous_secret_expires_at &&
		row.previous_secret_expires_at > now
	) {
		secrets.push(await cipher.decrypt(row.previous_secret));
	}
	return secrets;
}
