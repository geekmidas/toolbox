/**
 * A busy compose stage's deploy state, at the size the caps let it reach: five
 * apps with ten releases each, ten resources and four DNS records per app,
 * and a full history — the shape whose save outgrew SSM's standard tier.
 */

import { createHash } from 'node:crypto';
import type { GithubActor } from '../../actor';
import { dnsRecordResource } from '../../dnsResources';
import {
	type HistoryEntry,
	type ResourceInput,
	type ResourceRecord,
	STATE_HISTORY,
	STATE_SCHEMA_VERSION,
	type StateDocument,
} from '../../StateStore';
import {
	type AppReleases,
	type ComposeStageState,
	RELEASE_HISTORY,
	type ReleasedImage,
} from '../../state';

export const BUSY_APPS = ['api', 'auth', 'web', 'admin', 'jobs'] as const;

const by: GithubActor = {
	kind: 'github',
	actor: 'release-bot',
	run: 'https://github.com/acme/shop/actions/runs/18234567890',
	workflow: 'Deploy',
};

/** Stable per input, and as incompressible as a real digest or sha. */
const hex = (seed: string, length: number) =>
	createHash('sha256').update(seed).digest('hex').slice(0, length);

const at = (index: number) =>
	new Date(Date.UTC(2026, 8, 1) + index * 3_600_000).toISOString();

function release(app: string, n: number): ReleasedImage {
	const sha = hex(`${app}-${n}-sha`, 40);
	return {
		ref: `ghcr.io/acme/shop/${app}:${sha}`,
		tag: sha,
		digest: `sha256:${hex(`${app}-${n}-digest`, 64)}`,
		releasedAt: at(n),
		releasedBy: by,
	};
}

export function busyState(stage: string): ComposeStageState {
	const releases: Record<string, AppReleases> = {};
	for (const app of BUSY_APPS) {
		const history = Array.from({ length: RELEASE_HISTORY }, (_, i) =>
			release(app, RELEASE_HISTORY - i),
		);
		releases[app] = {
			current: history[0]!,
			previous: history[1]!,
			history,
		};
	}
	return {
		provider: 'compose',
		stage,
		lastDeployedAt: at(RELEASE_HISTORY),
		identity: 'shop/shop',
		releases,
	};
}

/**
 * Ten resources and four DNS records — for the stage, or for each app with
 * `perApp` — as `putResource` takes them.
 */
export function busyResources(
	stage: string,
	options: { perApp?: boolean } = {},
): ResourceInput[] {
	const resources: ResourceInput[] = [];
	for (const app of options.perApp ? BUSY_APPS : (['shop'] as const)) {
		for (let i = 0; i < 10; i++) {
			const key = `s3-bucket:${app}-files-${i}`;
			resources.push({
				key,
				type: 's3-bucket',
				id: `shop-${stage}-${app}-files-${i}`,
				status: 'ready',
				data: {
					name: `shop-${stage}-${app}-files-${i}`,
					region: 'eu-west-1',
					accessKeyId: `AKIA${hex(`${app}${i}`, 16).toUpperCase()}`,
				},
			});
		}
		for (const type of ['A', 'AAAA'] as const) {
			for (const host of [app, `www.${app}`]) {
				resources.push(
					dnsRecordResource({
						domain: 'shop.example.com',
						name: host,
						type,
						value: type === 'A' ? '203.0.113.10' : '2001:db8::10',
						ttl: 300,
						provider: 'route53',
					}),
				);
			}
		}
	}
	return resources;
}

/** The whole document, as a store would hold it after a busy month. */
export function busyDocument(
	stage: string,
	options: { perApp?: boolean } = {},
): StateDocument {
	const resources: Record<string, ResourceRecord> = {};
	for (const [i, input] of busyResources(stage, options).entries()) {
		resources[input.key] = { ...input, updatedAt: at(i), updatedBy: by };
	}
	const history: HistoryEntry[] = Array.from(
		{ length: STATE_HISTORY },
		(_, i) => ({
			serial: 200 - i,
			at: at(200 - i),
			by,
			operation: 'deploy',
		}),
	);
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		stage,
		serial: 200,
		state: busyState(stage),
		resources,
		updatedAt: at(200),
		updatedBy: by,
		history,
	};
}
