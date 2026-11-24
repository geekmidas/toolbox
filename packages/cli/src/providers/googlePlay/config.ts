/**
 * `mobile: { provider: 'google-play' }`, read — kept free of the provider's
 * HTTP clients, so the workspace schema checks an entry without them.
 */

import { GkmError } from '../../errors';
import { GOOGLE_PROVISIONING } from '../google/provisioning.js';
import type { ProviderConfig, ResourceProvider } from '../types.js';

/**
 * `mobile: { provider: 'google-play', developer }` — each mobile app set up
 * for EAS Submit to publish to Google Play: a service account in a Google
 * Cloud project, its access to the app in Play Console, its key in EAS, and
 * the store listing kept beside the app.
 */
export interface GooglePlayConfig {
	provider: 'google-play';
	/**
	 * The Play developer account: the number in Play Console's address,
	 * `https://play.google.com/console/developers/<id>/…`.
	 */
	developer: string;
	/**
	 * The Google Cloud project the publishing service account lives in.
	 * Defaults to `<workspace>-play`, made when absent — one for every stage,
	 * since every stage publishes the same app. `--project` wins over it.
	 */
	project?: string;
}

/** `deploy.mobile.<stage>` holds a field the `google-play` provider does not take. */
export class GooglePlayConfigInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly field: string,
		readonly value: unknown,
		readonly expected: string,
	) {
		super(
			`deploy.mobile.${stage}.${field} is ${JSON.stringify(value)}; ${expected}.`,
		);
		this.name = 'GooglePlayConfigInvalid';
	}
}

const FIELDS = ['provider', 'developer', 'project'] as const;

const DEVELOPER = /^\d+$/;

export function checkGooglePlayConfig(
	stage: string,
	config: ProviderConfig,
): GooglePlayConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(FIELDS as readonly string[]).includes(field)) {
			throw new GooglePlayConfigInvalid(
				stage,
				field,
				entry[field],
				`the google-play provider takes ${FIELDS.slice(1).join(', ')} only`,
			);
		}
	}
	if (typeof entry.developer !== 'string' || !DEVELOPER.test(entry.developer)) {
		throw new GooglePlayConfigInvalid(
			stage,
			'developer',
			entry.developer,
			"set it to the Play developer account's id, the number in Play Console's " +
				'address: https://play.google.com/console/developers/<id>/…',
		);
	}
	if (
		entry.project !== undefined &&
		(typeof entry.project !== 'string' || entry.project === '')
	) {
		throw new GooglePlayConfigInvalid(
			stage,
			'project',
			entry.project,
			'set it to a Google Cloud project id, or leave it out for <workspace>-play',
		);
	}
	return entry as unknown as GooglePlayConfig;
}

/** How the provider's provisioning credentials are supplied, for messages. */
export const GOOGLE_PLAY_PROVISIONING: ResourceProvider['provisioning'] = {
	env: [...GOOGLE_PROVISIONING.env, 'EXPO_TOKEN'],
	describe:
		'EXPO_TOKEN (an access token from https://expo.dev/settings/access-tokens), ' +
		`and Google: ${GOOGLE_PROVISIONING.describe}`,
};
