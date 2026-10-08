/**
 * `deploy.<kind>.<stage>`, read: what backs one kind of construct on a stage.
 *
 * Kept free of the providers themselves — of the AWS SDK and the graph — so
 * the workspace schema can check an entry with the words a deploy would use,
 * the way `checkStageTelemetry` does for `deploy.telemetry`.
 */

import { checkS3Config, S3_PROVISIONING } from './s3/config.js';
import type {
	ProviderConfig,
	ProviderKind,
	ResourceProvider,
	StageProviderEntry,
} from './types.js';

/** Each provider's config check, by kind and name. */
const CHECKS: {
	readonly [K in ProviderKind]: Readonly<
		Record<string, (stage: string, config: ProviderConfig) => ProviderConfig>
	>;
} = {
	objects: { s3: checkS3Config },
};

/** How each provider's provisioning credentials are supplied, by kind and name. */
const PROVISIONING: {
	readonly [K in ProviderKind]: Readonly<
		Record<string, ResourceProvider['provisioning']>
	>;
} = {
	objects: { s3: S3_PROVISIONING },
};

/** How `name`'s provisioning credentials are supplied, for messages. */
export function provisioningOf(
	kind: ProviderKind,
	name: string,
): ResourceProvider['provisioning'] | undefined {
	return Object.hasOwn(PROVISIONING[kind], name)
		? PROVISIONING[kind][name]
		: undefined;
}

/** The `provider:` names a kind accepts. */
export function providerNamesOf(kind: ProviderKind): string[] {
	return Object.keys(CHECKS[kind]).sort();
}

/** What `deploy.<kind>.<stage>` may be, for messages. */
function accepted(kind: ProviderKind): string {
	return [
		"'external'",
		...providerNamesOf(kind).map((name) => `{ provider: '${name}' }`),
		'false',
	].join(', ');
}

/** An entry that names no provider gkm has, or is not an entry at all. */
export class UnknownStageProvider extends Error {
	constructor(
		readonly kind: ProviderKind,
		readonly stage: string,
		readonly value: unknown,
	) {
		super(
			`deploy.${kind}.${stage} is ${JSON.stringify(value)}, which is not a ` +
				`provider gkm has for ${kind}. It takes ${accepted(kind)}.`,
		);
		this.name = 'UnknownStageProvider';
	}
}

/**
 * One stage's entry checked: `'external'`, `false`, or a provider's object
 * that its own check accepts.
 *
 * @throws {UnknownStageProvider} for anything else — `'minio'` included
 */
export function checkStageProvider(
	kind: ProviderKind,
	stage: string,
	value: unknown,
): StageProviderEntry {
	if (value === 'external' || value === false) return value;
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const name = (value as { provider?: unknown }).provider;
		const check =
			typeof name === 'string' && Object.hasOwn(CHECKS[kind], name)
				? CHECKS[kind][name]
				: undefined;
		if (check) return check(stage, value as ProviderConfig);
	}
	throw new UnknownStageProvider(kind, stage, value);
}

/** What one stage resolves `deploy.<kind>` to. */
export type StageProviderChoice =
	| { mode: 'external' }
	| { mode: 'none' }
	| { mode: 'provider'; name: string; config: ProviderConfig };

/** What a stage's `deploy.<kind>` is read from. */
export interface StageProviderSource {
	deploy?: Partial<Record<ProviderKind, Record<string, unknown>>> | undefined;
	stages?: { local?: string };
}

/**
 * What backs `kind` on `stage`: the local stage is always `external` here —
 * `gkm dev` runs its own — and a deployed stage that names nothing is too.
 */
export function stageProvider(
	workspace: StageProviderSource,
	kind: ProviderKind,
	stage: string,
): StageProviderChoice {
	if (stage === workspace.stages?.local) return { mode: 'external' };
	const value = workspace.deploy?.[kind]?.[stage];
	if (value === undefined) return { mode: 'external' };
	const entry = checkStageProvider(kind, stage, value);
	if (entry === 'external') return { mode: 'external' };
	if (entry === false) return { mode: 'none' };
	return { mode: 'provider', name: entry.provider, config: entry };
}
