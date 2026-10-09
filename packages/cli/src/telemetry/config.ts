/**
 * `deploy.telemetry`, read: where one stage's telemetry goes, and how much.
 *
 * The application says what it emits (the `Telemetry` construct). This says
 * where it is sent, per stage, and is the only place that does:
 *
 * - **self-hosted** — the target runs OpenObserve beside the apps (#189's
 *   stack service). A server target that can run it uses it when a stage
 *   names nothing.
 * - **otlp** — any OTLP/HTTP endpoint, with its headers.
 * - **false** — nothing is sent.
 *
 * Vendor presets (a known endpoint and header shape, with the stage secret
 * `TELEMETRY_CREDENTIALS`) are one more entry in {@link PROVIDERS}: a
 * resolver from the stage's config to a {@link ResolvedTelemetry}, which
 * every target already consumes through {@link telemetryEnv}.
 *
 * The local stage ignores all of it: `gkm dev` and `gkm compose` on it run
 * OpenObserve and keep every trace.
 */

import { type ResolvedLogs, resolveSelfHosted } from '../compose/logsConfig.js';
import { GkmError } from '../errors';
import type { DeployRuntime } from '../target/types.js';
import type {
	OtlpTelemetryConfig,
	SelfHostedTelemetryConfig,
	StageTelemetryConfig,
} from '../workspace/types.js';

/** A stage's telemetry, its defaults applied and its config checked. */
export type ResolvedTelemetry =
	| {
			provider: 'self-hosted';
			/** How the stack's OpenObserve is run and reached. */
			selfHosted: ResolvedLogs;
			sampleRate: number;
	  }
	| {
			provider: 'otlp';
			endpoint: string;
			headers: Readonly<Record<string, string>>;
			sampleRate: number;
	  };

/** The providers `deploy.telemetry` can name. */
export type TelemetryProviderName = Exclude<
	StageTelemetryConfig,
	false | 'self-hosted'
>['provider'];

/** A deployed stage uses telemetry and its target cannot choose for it. */
export class TelemetryProviderRequired extends GkmError {
	constructor(
		readonly stage: string,
		readonly target: string,
	) {
		super(
			`The stage '${stage}' deploys through ${target}, which cannot run ` +
				'telemetry itself, and a process uses a Telemetry construct. Say ' +
				`where it goes in gkm.config.ts: deploy: { telemetry: { ${stage}: ` +
				"{ provider: 'otlp', endpoint: 'https://…' } } } — or " +
				`deploy: { telemetry: { ${stage}: false } } to send nothing.`,
		);
		this.name = 'TelemetryProviderRequired';
	}
}

/** A stage asks for the self-hosted provider on a target that cannot run it. */
export class SelfHostedTelemetryUnavailable extends GkmError {
	constructor(
		readonly stage: string,
		readonly target: string,
	) {
		super(
			`deploy.telemetry.${stage} is 'self-hosted', and ${target} does not ` +
				'run OpenObserve beside the apps — the compose target does. Deploy ' +
				`'${stage}' through compose, or send its telemetry elsewhere: ` +
				`deploy: { telemetry: { ${stage}: { provider: 'otlp', endpoint: ` +
				"'https://…' } } }.",
		);
		this.name = 'SelfHostedTelemetryUnavailable';
	}
}

/** A sample rate that is not a fraction. */
export class TelemetrySampleRateInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly sampleRate: unknown,
	) {
		super(
			`deploy.telemetry.${stage}.sampleRate is ${String(sampleRate)}; set it ` +
				'to a number from 0 to 1 — the fraction of traces kept — or leave it ' +
				'out to keep every one.',
		);
		this.name = 'TelemetrySampleRateInvalid';
	}
}

/** An OTLP endpoint that is not an http(s) URL. */
export class TelemetryEndpointInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly endpoint: unknown,
	) {
		super(
			`deploy.telemetry.${stage}.endpoint is ${JSON.stringify(endpoint)}; set ` +
				"it to the collector's OTLP/HTTP base URL, like " +
				"'https://otlp.example.com' — /v1/traces and /v1/logs are added to it.",
		);
		this.name = 'TelemetryEndpointInvalid';
	}
}

/** The sample rate a stage keeps, checked. */
function sampleRateOf(stage: string, sampleRate: number | undefined): number {
	const rate = sampleRate ?? 1;
	if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
		throw new TelemetrySampleRateInvalid(stage, sampleRate);
	}
	return rate;
}

/**
 * Each provider's resolver: a stage's config to what the targets consume.
 * A vendor preset is one more entry here.
 */
const PROVIDERS: {
	[P in TelemetryProviderName]: (
		config: Extract<StageTelemetryConfig, { provider: P }>,
		stage: string,
	) => ResolvedTelemetry;
} = {
	'self-hosted': (config: SelfHostedTelemetryConfig, stage) => {
		const { provider: _, sampleRate, ...options } = config;
		return {
			provider: 'self-hosted',
			selfHosted: resolveSelfHosted(options, stage),
			sampleRate: sampleRateOf(stage, sampleRate),
		};
	},
	otlp: (config: OtlpTelemetryConfig, stage) => {
		if (typeof config.endpoint !== 'string' || !isHttpUrl(config.endpoint)) {
			throw new TelemetryEndpointInvalid(stage, config.endpoint);
		}
		return {
			provider: 'otlp',
			endpoint: config.endpoint.replace(/\/+$/, ''),
			headers: { ...config.headers },
			sampleRate: sampleRateOf(stage, config.sampleRate),
		};
	},
};

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * One stage's entry, checked on its own — what the workspace schema runs, so
 * a bad config fails to load with the words a deploy would fail with.
 */
export function checkStageTelemetry(
	stage: string,
	config: StageTelemetryConfig,
): ResolvedTelemetry | undefined {
	if (config === false) return undefined;
	const entry: Exclude<StageTelemetryConfig, false | 'self-hosted'> =
		config === 'self-hosted' ? { provider: 'self-hosted' } : config;
	const resolve = PROVIDERS[entry.provider] as (
		config: typeof entry,
		stage: string,
	) => ResolvedTelemetry;
	return resolve(entry, stage);
}

/** What a stage's telemetry is resolved from. */
export interface StageTelemetryInput {
	/** `deploy.telemetry`. */
	telemetry?: Readonly<Record<string, StageTelemetryConfig>>;
	stage: string;
	/** Whether this is the project's local stage, which ignores the config. */
	local: boolean;
	/** The target's name, for messages. */
	target: string;
	runtime: DeployRuntime;
	/** Whether the target runs the self-hosted provider. */
	selfHosted: boolean;
	/** Whether any process uses a `Telemetry` node. */
	used: boolean;
}

/**
 * Where a stage's telemetry goes, or undefined when nothing is sent — no
 * process uses a `Telemetry` node, or the stage opted out with `false`.
 *
 * The local stage always runs the self-hosted provider with its defaults and
 * keeps every trace, whatever `deploy.telemetry` says. A deployed stage that
 * names nothing gets the self-hosted provider where its target runs one, and
 * {@link TelemetryProviderRequired} where it cannot — AWS has none.
 */
export function resolveStageTelemetry(
	input: StageTelemetryInput,
): ResolvedTelemetry | undefined {
	const { stage } = input;
	if (!input.used) return undefined;

	if (input.local) {
		return {
			provider: 'self-hosted',
			selfHosted: resolveSelfHosted({}, stage),
			sampleRate: 1,
		};
	}

	const config = input.telemetry?.[stage];
	if (config === undefined) {
		if (input.runtime === 'server' && input.selfHosted) {
			return checkStageTelemetry(stage, 'self-hosted');
		}
		throw new TelemetryProviderRequired(stage, input.target);
	}

	const resolved = checkStageTelemetry(stage, config);
	if (resolved?.provider === 'self-hosted' && !input.selfHosted) {
		throw new SelfHostedTelemetryUnavailable(stage, input.target);
	}
	return resolved;
}

/** The sampler every process with the edge runs, per the stage's rate. */
export const TRACES_SAMPLER = 'parentbased_traceidratio';

/**
 * `OTEL_EXPORTER_OTLP_HEADERS` for a set of headers: `key=value` pairs,
 * comma-separated, each value percent-encoded — the W3C baggage format the
 * SDK parses.
 */
export function otlpHeaderString(
	headers: Readonly<Record<string, string>>,
): string {
	return Object.entries(headers)
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join(',');
}

/**
 * The `OTEL_*` values a stage resolves for its `Telemetry` node, before any
 * one process is named: where to export, how to sign, and how much to keep.
 * `OTEL_SERVICE_NAME` is each process's own — see `scopeTelemetryEnv`.
 */
export function telemetryEnv(
	destination: { endpoint: string; headers?: string },
	sampleRate: number,
): Record<string, string> {
	return {
		OTEL_EXPORTER_OTLP_ENDPOINT: destination.endpoint,
		...(destination.headers
			? { OTEL_EXPORTER_OTLP_HEADERS: destination.headers }
			: {}),
		OTEL_TRACES_SAMPLER: TRACES_SAMPLER,
		OTEL_TRACES_SAMPLER_ARG: String(sampleRate),
	};
}

/** What an `otlp` stage resolves, for every process with the edge. */
export function otlpTelemetryEnv(
	resolved: Extract<ResolvedTelemetry, { provider: 'otlp' }>,
): Record<string, string> {
	const headers = otlpHeaderString(resolved.headers);
	return telemetryEnv(
		{ endpoint: resolved.endpoint, ...(headers ? { headers } : {}) },
		resolved.sampleRate,
	);
}

/**
 * The sample rate a stage's browsers trace page views at — a public value,
 * the same rate its servers sample at — or undefined when the stage sends no
 * telemetry. The local stage keeps every trace.
 *
 * Lenient where `resolveStageTelemetry` is strict: a site's client is built
 * before, and apart from, the deploy that refuses a stage with no provider.
 */
export function stageSampleRate(
	telemetry: Readonly<Record<string, StageTelemetryConfig>> | undefined,
	stage: string,
	local: boolean,
): number | undefined {
	if (local) return 1;
	const config = telemetry?.[stage];
	if (config === false) return undefined;
	if (config === undefined || config === 'self-hosted') return 1;
	return sampleRateOf(stage, config.sampleRate);
}
