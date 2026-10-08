import { describe, expect, it } from 'vitest';
import { LogsAllowEmpty, LogsRetentionInvalid } from '../../compose/logsConfig';
import { validateWorkspaceConfig } from '../../workspace/schema';
import type { StageTelemetryConfig } from '../../workspace/types';
import {
	otlpHeaderString,
	otlpTelemetryEnv,
	resolveStageTelemetry,
	SelfHostedTelemetryUnavailable,
	type StageTelemetryInput,
	TelemetryEndpointInvalid,
	TelemetryProviderRequired,
	TelemetrySampleRateInvalid,
	telemetryEnv,
} from '../config';

/** A deployed stage on a server target that runs OpenObserve — compose. */
function onCompose(
	telemetry?: Record<string, StageTelemetryConfig>,
	overrides: Partial<StageTelemetryInput> = {},
): StageTelemetryInput {
	return {
		...(telemetry ? { telemetry } : {}),
		stage: 'production',
		local: false,
		target: 'compose',
		runtime: 'server',
		selfHosted: true,
		used: true,
		...overrides,
	};
}

/** A deployed stage on AWS, which has no self-hosted provider. */
function onAws(telemetry?: Record<string, StageTelemetryConfig>) {
	return onCompose(telemetry, {
		target: 'sst',
		runtime: 'aws',
		selfHosted: false,
	});
}

describe('resolveStageTelemetry', () => {
	it('is nothing when no process uses a Telemetry construct', () => {
		expect(
			resolveStageTelemetry(
				onCompose({ production: 'self-hosted' }, { used: false }),
			),
		).toBeUndefined();
		// Not even AWS asks for a provider then.
		expect(resolveStageTelemetry({ ...onAws(), used: false })).toBeUndefined();
	});

	it('runs the self-hosted provider on a server target whose stage names nothing', () => {
		expect(resolveStageTelemetry(onCompose())).toEqual({
			provider: 'self-hosted',
			selfHosted: { port: 5080, retentionDays: 30 },
			sampleRate: 1,
		});
	});

	it('takes the self-hosted provider’s options and rate from the stage', () => {
		expect(
			resolveStageTelemetry(
				onCompose({
					production: {
						provider: 'self-hosted',
						port: 5081,
						retentionDays: 14,
						public: { allow: ['203.0.113.7'] },
						sampleRate: 0.1,
					},
				}),
			),
		).toEqual({
			provider: 'self-hosted',
			selfHosted: {
				port: 5081,
				retentionDays: 14,
				public: { allow: ['203.0.113.7'] },
			},
			sampleRate: 0.1,
		});
	});

	it('fails a deployed AWS stage that uses telemetry and names no provider', () => {
		const run = () => resolveStageTelemetry(onAws());

		expect(run).toThrow(TelemetryProviderRequired);
		expect(run).toThrow(/deploy: \{ telemetry: \{ production: false \} \}/);
	});

	it('refuses the self-hosted provider where the target cannot run it', () => {
		expect(() =>
			resolveStageTelemetry(onAws({ production: 'self-hosted' })),
		).toThrow(SelfHostedTelemetryUnavailable);
	});

	it('sends to any OTLP endpoint a stage names, on AWS too', () => {
		expect(
			resolveStageTelemetry(
				onAws({
					production: {
						provider: 'otlp',
						endpoint: 'https://otlp.example.com/',
						headers: { 'x-team': 'shop' },
						sampleRate: 0.25,
					},
				}),
			),
		).toEqual({
			provider: 'otlp',
			endpoint: 'https://otlp.example.com',
			headers: { 'x-team': 'shop' },
			sampleRate: 0.25,
		});
	});

	it('sends nothing for a stage that opts out with false', () => {
		expect(
			resolveStageTelemetry(onCompose({ production: false })),
		).toBeUndefined();
		expect(resolveStageTelemetry(onAws({ production: false }))).toBeUndefined();
	});

	it('ignores deploy.telemetry on the local stage: self-hosted, every trace', () => {
		const local = { stage: 'development', local: true };

		for (const config of [
			false,
			{ provider: 'otlp', endpoint: 'https://otlp.example.com' },
			{ provider: 'self-hosted', sampleRate: 0.01, retentionDays: 3 },
		] as StageTelemetryConfig[]) {
			expect(
				resolveStageTelemetry(onCompose({ development: config }, { ...local })),
			).toEqual({
				provider: 'self-hosted',
				selfHosted: { port: 5080, retentionDays: 30 },
				sampleRate: 1,
			});
		}
		// Even on AWS's runtime: the local stage is never deployed there.
		expect(resolveStageTelemetry({ ...onAws(), ...local })).toMatchObject({
			provider: 'self-hosted',
			sampleRate: 1,
		});
	});

	it('refuses a sample rate that is not a fraction', () => {
		expect(() =>
			resolveStageTelemetry(
				onCompose({ production: { provider: 'self-hosted', sampleRate: 2 } }),
			),
		).toThrow(TelemetrySampleRateInvalid);
	});

	it('refuses an OTLP endpoint that is not an http(s) URL', () => {
		expect(() =>
			resolveStageTelemetry(
				onCompose({ production: { provider: 'otlp', endpoint: 'collector' } }),
			),
		).toThrow(TelemetryEndpointInvalid);
	});
});

describe('the sampler env', () => {
	it('is parent-based, at the stage’s rate', () => {
		expect(telemetryEnv({ endpoint: 'http://collector:4318' }, 0.1)).toEqual({
			OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
			OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
			OTEL_TRACES_SAMPLER_ARG: '0.1',
		});
	});

	it('keeps every trace when the stage sets no rate', () => {
		const resolved = resolveStageTelemetry(
			onAws({
				production: { provider: 'otlp', endpoint: 'https://otlp.example.com' },
			}),
		);
		expect(resolved?.provider).toBe('otlp');
		if (resolved?.provider !== 'otlp') return;

		expect(otlpTelemetryEnv(resolved)).toEqual({
			OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
			OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
			OTEL_TRACES_SAMPLER_ARG: '1',
		});
	});

	it('writes headers the way the SDK parses them', () => {
		expect(
			otlpHeaderString({ authorization: 'Basic a b', 'x-team': 'shop,eu' }),
		).toBe('authorization=Basic%20a%20b,x-team=shop%2Ceu');
	});
});

describe('deploy.telemetry in gkm.config.ts', () => {
	const config = (telemetry: unknown) => ({
		name: 'shop',
		stages: { local: 'development', deployed: ['production'] },
		apps: { api: { type: 'backend', path: 'apps/api', port: 3000 } },
		deploy: { telemetry },
	});

	it('takes every shape a stage can name', () => {
		expect(() =>
			validateWorkspaceConfig(
				config({
					a: 'self-hosted',
					b: { provider: 'self-hosted', retentionDays: 7, sampleRate: 0.5 },
					c: { provider: 'otlp', endpoint: 'https://otlp.example.com' },
					d: false,
				}),
			),
		).not.toThrow();
	});

	it('refuses an option the provider would refuse, in its words', () => {
		expect(() =>
			validateWorkspaceConfig(
				config({ production: { provider: 'self-hosted', retentionDays: 1 } }),
			),
		).toThrow(new LogsRetentionInvalid('production', 1).message);
		expect(() =>
			validateWorkspaceConfig(
				config({
					production: { provider: 'self-hosted', public: { allow: [] } },
				}),
			),
		).toThrow(new LogsAllowEmpty('production').message);
	});

	it('refuses the deleted deploy.compose.logs rather than dropping it', () => {
		expect(() =>
			validateWorkspaceConfig({
				...config(undefined),
				deploy: { compose: { logs: true } },
			}),
		).toThrow(/logs/);
	});
});
