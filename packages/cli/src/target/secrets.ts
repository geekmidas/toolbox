/**
 * A stage's secrets as a target sees them: read and written through the
 * stage's own store, and masked in everything the run prints once read.
 */

import { secretsStoreFor } from '../secrets/store';
import type { StageSecrets } from '../secrets/types';
import type { NormalizedWorkspace } from '../workspace/types';
import type { DeploySecrets } from './types';

/**
 * Shorter values are left alone: what a progress line legitimately prints —
 * a port, a stage, an app name — would otherwise come out as `***` wherever
 * a secret happened to share it.
 */
const SHORTEST_MASKED = 6;

/** The values a run must never print, and the rewrite that keeps it so. */
export class Redactor {
	private readonly values = new Set<string>();

	add(value: string | undefined): void {
		if (value && value.length >= SHORTEST_MASKED) this.values.add(value);
	}

	/** `text` with every masked value replaced by `***`, longest first. */
	redact(text: string): string {
		if (this.values.size === 0) return text;
		let out = text;
		const longestFirst = [...this.values].sort((a, b) => b.length - a.length);
		for (const value of longestFirst) out = out.replaceAll(value, '***');
		return out;
	}
}

/** Every value in `secrets` that is a secret rather than a label. */
function secretValues(secrets: StageSecrets): string[] {
	return [
		secrets.seed,
		...Object.values(secrets.custom ?? {}),
		...Object.values(secrets.urls ?? {}),
		...Object.values(secrets.services ?? {}).map(
			(service) => service?.password,
		),
	].filter((value): value is string => typeof value === 'string');
}

/**
 * The stage's secrets through the store `secrets.store` names for it. Opening
 * one builds a client and makes no request, so a target that never reads them
 * costs nothing.
 */
export async function deploySecrets(
	workspace: NormalizedWorkspace,
	stage: string,
	redactor: Redactor,
	options: { home?: string } = {},
): Promise<DeploySecrets> {
	const store = await secretsStoreFor(workspace, stage, options);
	const mask = (secrets: StageSecrets) => {
		for (const value of secretValues(secrets)) redactor.add(value);
	};

	return {
		store: store.name,
		async read() {
			const secrets = await store.read(stage);
			if (secrets) mask(secrets);
			return secrets;
		},
		async write(secrets) {
			mask(secrets);
			await store.write(stage, secrets);
		},
		mask: (value) => redactor.add(value),
	};
}
