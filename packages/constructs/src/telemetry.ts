/**
 * `Telemetry` — what an application emits, declared.
 *
 * Traces and logs over OTLP, from every process that is given it. The
 * construct says *what* is emitted — which requests are noise, which
 * attributes every span carries — and never where it goes or how much of it:
 * the provider and the sample rate are the deploy's, per stage
 * (`deploy.telemetry` in `gkm.config.ts`), and locally `gkm dev` runs
 * OpenObserve and sends everything there.
 *
 * ```ts
 * export const telemetry = new Telemetry('Telemetry', {
 *   ignorePaths: ['/health', '/ready'],
 *   attributes: { 'service.namespace': 'shop' },
 * });
 *
 * // passed like the logger: a fact about the process
 * new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none', telemetry });
 * new Worker('Jobs', { logger, telemetry });
 * ```
 *
 * Each process given it is an edge to this node, so the `OTEL_*` keys it
 * provides reach exactly those processes, and the build of each one fails
 * without the OpenTelemetry packages it needs.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	TELEMETRY_KEYS,
} from '@geekmidas/manifest';
import type { Declarable } from './construct-interface';

export interface TelemetryConfig {
	/**
	 * Request paths no span is recorded for, on every surface that uses this —
	 * health checks, by default the only noise worth naming. A trailing `*`
	 * matches a prefix. One route on one surface says so itself:
	 * `.telemetry({ ignore: true })`.
	 */
	ignorePaths?: readonly string[];
	/**
	 * Resource attributes every span and log record carries —
	 * `{ 'service.namespace': 'shop' }`. The service's name is not one of
	 * them: it is the app's, set per process.
	 */
	attributes?: Readonly<Record<string, string>>;
}

export class Telemetry<TName extends string = string>
	implements Declarable<TName>
{
	readonly id: TName;
	readonly ignorePaths: readonly string[];
	readonly attributes: Readonly<Record<string, string>>;

	constructor(id: ConstructName<TName>, config: TelemetryConfig = {}) {
		this.id = canonicalId(id as string) as TName;
		this.ignorePaths = [...(config.ignorePaths ?? [])];
		this.attributes = { ...config.attributes };
	}

	/**
	 * One node, providing OpenTelemetry's own variables. No address of its
	 * own: where the telemetry goes is the deploy's, so it is resolved by the
	 * target for each stage, never declared here.
	 */
	declare(): Declaration[] {
		return [
			{
				kind: 'telemetry',
				id: this.id,
				...(this.ignorePaths.length ? { ignorePaths: this.ignorePaths } : {}),
				...(Object.keys(this.attributes).length
					? { attributes: this.attributes }
					: {}),
				provides: [...TELEMETRY_KEYS],
			},
		];
	}
}

/** Per-route telemetry, on the endpoint builder — `.telemetry({ ignore: true })`. */
export interface EndpointTelemetry {
	/** Record no span for this route. */
	ignore?: boolean;
	/** Attributes this route's request span carries. */
	attributes?: Readonly<Record<string, string>>;
}
