import {
	ParentBasedSampler,
	type Sampler,
	TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

/**
 * The sampler a service uses at `ratio`: parent-based, with the ratio as a cap
 * on what a remote caller asks for.
 *
 * `parentbased_traceidratio` follows a remote parent's sampled flag as it is.
 * Between services that is how a trace stays whole — but the flag on a
 * request from a browser is the caller's to set, and following it would let
 * any page force 100% tracing on a stage that keeps 10%. So:
 *
 * | parent                    | decision                              |
 * |---------------------------|---------------------------------------|
 * | none (a new trace)        | the ratio, from the trace id          |
 * | remote, sampled           | the ratio again: the flag is a request |
 * | remote, not sampled       | not sampled: a caller may only ask for less |
 * | local (this process)      | the parent's decision                 |
 *
 * The cap costs a whole trace nothing. `TraceIdRatioBasedSampler` decides from
 * the trace id alone, so every service at the same rate — and the generated
 * API client, which applies the same rule to the page view's trace id — makes
 * the same decision for the same trace: a trace sampled where it started is
 * sampled at every hop.
 */
export function traceSampler(ratio: number): Sampler {
	const capped = new TraceIdRatioBasedSampler(ratio);
	return new ParentBasedSampler({
		root: capped,
		remoteParentSampled: capped,
	});
}

/**
 * {@link traceSampler} at the rate the standard variables name, when they ask
 * for `parentbased_traceidratio` — which is what a deploy sets for a stage's
 * sample rate. `OTEL_TRACES_SAMPLER_ARG` is the rate, 1 when absent.
 *
 * Undefined otherwise, and for an argument that is not a rate from 0 to 1:
 * the SDK then reads the variables itself, as it would without this, and
 * reports a bad argument the way it always has — a sampling setting is not a
 * reason for a server not to start.
 */
export function traceSamplerFromEnv(
	env: Record<string, string | undefined> = process.env,
): Sampler | undefined {
	if (env.OTEL_TRACES_SAMPLER?.trim() !== 'parentbased_traceidratio') {
		return undefined;
	}
	const arg = env.OTEL_TRACES_SAMPLER_ARG?.trim();
	const ratio = arg ? Number(arg) : 1;
	if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return undefined;
	return traceSampler(ratio);
}
