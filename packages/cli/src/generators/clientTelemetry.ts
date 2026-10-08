/**
 * Whether a generated client propagates trace context by default.
 *
 * `false` (the default) prints a client that sends no trace headers unless
 * its caller passes `telemetry`. Anything else prints that default into
 * `createApi`: `true`, or `{ sampleRate }` — the stage's rate, for the page
 * views no OpenTelemetry SDK is tracing. A caller's own `telemetry` option
 * still wins.
 */
export type ClientTelemetryDefault = boolean | { sampleRate: number };

/** A `sampleRate` outside 0–1, which no sampler can honour. */
export class InvalidClientTelemetrySampleRate extends Error {
	constructor(readonly sampleRate: number) {
		super(
			`The client's telemetry sample rate must be a number from 0 to 1, got ${sampleRate}. Pass the stage's rate, such as 0.1, or leave it out for 1.`,
		);
		this.name = 'InvalidClientTelemetrySampleRate';
	}
}

/** The `telemetry` default as the generated module prints it. */
export function printTelemetryDefault(
	telemetry: ClientTelemetryDefault,
): string {
	if (typeof telemetry === 'boolean') return String(telemetry);
	const { sampleRate } = telemetry;
	if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
		throw new InvalidClientTelemetrySampleRate(sampleRate);
	}
	return `{ sampleRate: ${sampleRate} }`;
}

/**
 * `--telemetry [rate]` for a client default, as `gkm openapi` takes it — and
 * as a site's Dockerfile passes it to the `gkm openapi --app` it runs.
 */
export function telemetryArgs(telemetry?: ClientTelemetryDefault): string[] {
	if (!telemetry) return [];
	if (telemetry === true) return ['--telemetry'];
	return ['--telemetry', String(telemetry.sampleRate)];
}

/** What `--telemetry [rate]` parsed to: on, at a rate when one was given. */
export function parseTelemetryFlag(
	value: boolean | string | undefined,
): ClientTelemetryDefault | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === true) return true;
	return { sampleRate: Number(value) };
}
