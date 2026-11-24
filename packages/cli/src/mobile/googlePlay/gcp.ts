/**
 * The Google Cloud side of publishing to Play: the project's Android
 * Publisher API, and the ids gkm derives. The project, the service account
 * and its keys are every Google provider's (`providers/google`).
 */

import type { GoogleClient } from '../../providers/google/client.js';
import { enableService } from '../../providers/google/resources.js';

/** The API EAS Submit and gkm call Play through. */
export const ANDROID_PUBLISHER_API = 'androidpublisher.googleapis.com';

/**
 * An id Google accepts, from a workspace's name: `shop` → `shop-play`.
 * Lowercased, anything else made a hyphen, cut to 30.
 */
export function playId(workspace: string): string {
	const base = workspace
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^[^a-z]+|-+$/g, '');
	return `${base.slice(0, 25).replace(/-+$/, '')}-play`;
}

/** The Android Publisher API, on in the project. */
export function enablePublisherApi(
	client: GoogleClient,
	project: string,
	options: { intervalMs?: number } = {},
): Promise<void> {
	return enableService(client, project, ANDROID_PUBLISHER_API, options);
}
