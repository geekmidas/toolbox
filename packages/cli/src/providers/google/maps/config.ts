/**
 * `deploy.maps.<stage> = { provider: 'google', … }`, read — kept free of the
 * provider itself, so the workspace schema can check an entry the way a
 * deploy would.
 */

import { GkmError } from '../../../errors';
import type { ProviderConfig } from '../../types.js';
import { GOOGLE_PROVISIONING } from '../provisioning.js';

/** `maps: { provider: 'google' }` — each `Maps` construct's keys in a Google Cloud project. */
export interface GoogleMapsConfig {
	provider: 'google';
	/**
	 * The Google Cloud project the keys are made in. `--project` wins; absent
	 * both, `<workspace>-<stage>`, created when it is not there. Maps serves
	 * only a project with billing linked.
	 */
	project?: string;
	/**
	 * The SHA-1 fingerprints of the certificates the stage's Android builds are
	 * signed with — Play's app signing key, from Play Console's App integrity
	 * page, and EAS's upload key. Without them the Android key is restricted to
	 * its APIs alone: Google restricts an Android key by package *and*
	 * certificate, never by package alone.
	 */
	android?: { sha1?: readonly string[] };
}

/** An entry under `deploy.maps.<stage>` the provider cannot use. */
export class GoogleMapsConfigInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly field: string,
		readonly value: unknown,
		readonly fix: string,
	) {
		super(`deploy.maps.${stage}.${field} is ${JSON.stringify(value)}: ${fix}.`);
		this.name = 'GoogleMapsConfigInvalid';
	}
}

const FIELDS = ['provider', 'project', 'android'] as const;

const SHA1 = /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/i;

const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function checkGoogleMapsConfig(
	stage: string,
	config: ProviderConfig,
): GoogleMapsConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(FIELDS as readonly string[]).includes(field)) {
			throw new GoogleMapsConfigInvalid(
				stage,
				field,
				entry[field],
				`the google provider takes ${FIELDS.slice(1).join(', ')} only`,
			);
		}
	}
	if (
		entry.project !== undefined &&
		(typeof entry.project !== 'string' || !PROJECT.test(entry.project))
	) {
		throw new GoogleMapsConfigInvalid(
			stage,
			'project',
			entry.project,
			'set it to a Google Cloud project id: 6 to 30 lowercase letters, digits and hyphens, starting with a letter',
		);
	}
	if (entry.android !== undefined) {
		const android = entry.android as Record<string, unknown> | null;
		const sha1 = android?.sha1;
		const valid =
			android !== null &&
			typeof android === 'object' &&
			Object.keys(android).every((key) => key === 'sha1') &&
			(sha1 === undefined ||
				(Array.isArray(sha1) &&
					sha1.every((f) => typeof f === 'string' && SHA1.test(f))));
		if (!valid) {
			throw new GoogleMapsConfigInvalid(
				stage,
				'android',
				entry.android,
				"set it to { sha1: ['AB:CD:…'] }: each signing certificate's SHA-1, 20 bytes as colon-separated hex",
			);
		}
	}
	return entry as unknown as GoogleMapsConfig;
}

/** How the google provider's credentials are supplied, for messages. */
export const GOOGLE_MAPS_PROVISIONING = GOOGLE_PROVISIONING;
