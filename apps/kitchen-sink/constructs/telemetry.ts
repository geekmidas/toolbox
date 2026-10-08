import { Telemetry } from '@geekmidas/constructs/telemetry';

/**
 * What this application emits: traces and logs over OTLP, from every process
 * given it — the API, the auth server and the worker.
 *
 * Never where it goes. Locally `gkm dev` runs OpenObserve and sends every
 * trace there; deployed, `deploy.telemetry` in `gkm.config.ts` picks the
 * provider and the sample rate per stage. The logger needs no setting: in a
 * process that runs telemetry, every line is exported in its request's trace.
 */
export const telemetry = new Telemetry('Telemetry', {
	// Probes, not traffic: no span is worth keeping for either.
	ignorePaths: ['/health', '/ready'],
	attributes: { 'service.namespace': 'kitchen-sink' },
});
