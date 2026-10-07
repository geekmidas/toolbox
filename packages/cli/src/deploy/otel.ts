/**
 * The OpenTelemetry variables a stage's secrets pass to every backend.
 *
 * A production server starts OpenTelemetry when `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is set (`generators/telemetry.ts`), and the SDK reads the rest of its
 * configuration from the standard `OTEL_*` variables. No construct declares
 * them — they say where the telemetry goes, not what the app is — so a target
 * that writes each backend only the keys it reads would never hand them over.
 * Every target that runs backends asks this module instead.
 *
 * Which keys pass is a pattern over the `OTEL_` prefix rather than the prefix
 * alone or a list:
 *
 * - The bare prefix would forward anything a stage happened to name `OTEL_*`
 *   — `OTEL_LOG_LEVEL=debug`, `OTEL_SDK_DISABLED` — to every backend, without
 *   anyone choosing to.
 * - A list would have to spell out the exporter's five settings once for all
 *   signals and once per signal — twenty keys — and would miss the next one.
 *
 * The pattern names the families the server uses: the OTLP exporter's
 * endpoint, headers, protocol, timeout and compression, for every signal or
 * for one (`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`); sampling; and the resource's
 * identity.
 *
 * Sites get none of it: a site's environment is inlined into a bundle that
 * every browser downloads, and an exporter's headers are a credential.
 */

/** The `OTEL_*` variables a backend is handed from the stage's secrets. */
export const OTEL_PASSTHROUGH =
	/^OTEL_(?:EXPORTER_OTLP_(?:(?:TRACES|LOGS|METRICS)_)?(?:ENDPOINT|HEADERS|PROTOCOL|TIMEOUT|COMPRESSION)|TRACES_SAMPLER(?:_ARG)?|RESOURCE_ATTRIBUTES|SERVICE_NAME)$/;

/** Whether a stage secret is one of the passed-through `OTEL_*` variables. */
export function isOtelVariable(key: string): boolean {
	return OTEL_PASSTHROUGH.test(key);
}

/** Whether a variable says where an OTLP exporter sends, or how it signs. */
export function isOtlpDestination(key: string): boolean {
	return /^OTEL_EXPORTER_OTLP_(?:(?:TRACES|LOGS|METRICS)_)?(?:ENDPOINT|HEADERS)$/.test(
		key,
	);
}

/**
 * The `OTEL_*` variables one backend runs with: every one the stage's secrets
 * hold, and `OTEL_SERVICE_NAME` — the app's name — where the stage set
 * telemetry up without naming the service. Empty when the stage set none.
 */
export function otelEnv(
	custom: Readonly<Record<string, string>>,
	app: string,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(custom)) {
		if (isOtelVariable(key) && value !== '') env[key] = value;
	}
	if (Object.keys(env).length > 0 && !env.OTEL_SERVICE_NAME) {
		env.OTEL_SERVICE_NAME = app;
	}
	return env;
}
