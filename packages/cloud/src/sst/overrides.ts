/**
 * What a deploy can say about each construct, inferred from the manifest.
 *
 * `fromManifest` used to take `Record<string, Record<string, unknown>>`, so a
 * misspelt id, a prop the component never reads, and a missing VPC all passed
 * the type checker — the first two silently, the last at synth, mid-deploy.
 * The manifest is emitted `as const`, so every id's kind is known statically,
 * and the kind decides what can be overridden:
 *
 * - only the manifest's own ids are keys;
 * - each takes the props its kind's provisioner reads, minus those the
 *   declaration already decides (a site's `path`, a file server's `origin`);
 * - what the synth refuses to guess is required — a database's `vpc`, mail's
 *   `from`, and, by backend, an ElastiCache `vpc` or a non-SES mail `url`;
 * - a kind with nothing to override takes no key at all.
 */

import type { ConstructManifest, DeclarationKind } from '@geekmidas/manifest';
import type { CacheProps } from './aws/Cache';
import type { CredentialProps } from './aws/Credential';
import type { DatabaseProps } from './aws/Database';
import type { EncryptionProps } from './aws/Encryption';
import type { ExternalApiProps } from './aws/ExternalApi';
import type { FileServerProps } from './aws/FileServer';
import type { ObjectStorageProps } from './aws/ObjectStorage';
import type { QueueProps } from './aws/Queue';
import type { SecretProps } from './aws/Secret';
import type { StaticSiteProps } from './aws/StaticSite';
import type { TopicProps } from './aws/Topic';

/** The backend choices that are config rather than declaration. */
export interface ManifestBackends {
	cache?: 'upstash' | 'elasticache' | 'db';
	email?: 'resend' | 'ses' | 'smtp';
}

/** The backend a choice resolves to — the provisioner's default when unset. */
type CacheBackendOf<B extends ManifestBackends> =
	B['cache'] extends NonNullable<ManifestBackends['cache']>
		? B['cache']
		: 'upstash';
type EmailBackendOf<B extends ManifestBackends> =
	B['email'] extends NonNullable<ManifestBackends['email']>
		? B['email']
		: 'ses';

type CacheOverride<Backend> = Backend extends 'elasticache'
	? { vpc: NonNullable<CacheProps['vpc']> }
	: Backend extends 'upstash'
		? { url?: CacheProps['url']; region?: string }
		: never;

type EmailOverride<Backend> = {
	/** Every provider rejects an unverified sender, so there is no default. */
	from: $util.Input<string>;
	region?: $util.Input<string>;
} & (Backend extends 'ses'
	? { url?: $util.Input<string> }
	: // Resend and a relay are accounts somebody created: their URL is theirs.
		{ url: $util.Input<string> });

/**
 * What one declaration takes, by its kind and the backends; `never` for a kind
 * with nothing to override, which drops its id from the keys.
 */
export type OverrideFor<D, B extends ManifestBackends = {}> = D extends {
	kind: infer K extends DeclarationKind;
}
	? K extends 'objects'
		? Partial<ObjectStorageProps>
		: K extends 'file-server'
			? Partial<Omit<FileServerProps, 'origin'>>
			: K extends 'site'
				? Partial<Omit<StaticSiteProps, 'path' | 'variant' | 'environment'>>
				: K extends 'queue'
					? Partial<Omit<QueueProps, 'fifo'>>
					: K extends 'topic'
						? Partial<TopicProps>
						: K extends 'database'
							? Omit<DatabaseProps, 'schema' | 'version'>
							: K extends 'cache'
								? // In a database: same address, one more table, nothing to say.
									D extends { of: string }
									? never
									: CacheOverride<CacheBackendOf<B>>
								: K extends 'email'
									? EmailOverride<EmailBackendOf<B>>
									: K extends 'rest-api'
										? Partial<sst.aws.ApiGatewayV2Args>
										: K extends 'secret'
											? SecretProps
											: K extends 'credential'
												? CredentialProps
												: K extends 'encryption'
													? Partial<EncryptionProps>
													: K extends 'external-api'
														? Omit<ExternalApiProps, 'url'>
														: // Derived databases, compute, mobile apps, OIDC.
															never
	: never;

/** Whether `{}` satisfies an override — whether the id can be left out. */
type IsOptional<T> = {} extends T ? true : false;

type Overridable<M, B extends ManifestBackends> = {
	[Id in keyof M]: [OverrideFor<M[Id], B>] extends [never] ? never : Id;
}[keyof M];

type RequiredIds<M, B extends ManifestBackends> = {
	[Id in Overridable<M, B>]: IsOptional<OverrideFor<M[Id], B>> extends true
		? never
		: Id;
}[Overridable<M, B>];

/**
 * The overrides a manifest accepts, keyed by its own construct ids.
 *
 * A manifest typed only as `ConstructManifest` — ids unknown — falls back to
 * the untyped record, and the provisioners' synth-time checks still apply.
 */
export type ManifestOverrides<
	M extends ConstructManifest,
	B extends ManifestBackends = {},
> = string extends keyof M
	? Record<string, Record<string, unknown>>
	: {
			[Id in RequiredIds<M, B>]: OverrideFor<M[Id], B>;
		} & {
			[Id in Exclude<Overridable<M, B>, RequiredIds<M, B>>]?: OverrideFor<
				M[Id],
				B
			>;
		};
