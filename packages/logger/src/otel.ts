/**
 * The bridge from pino to OpenTelemetry logs.
 *
 * A pino record is also emitted through `@opentelemetry/api-logs` when a
 * `LoggerProvider` is registered globally — as the generated telemetry setup
 * of a production server does. Nothing hooks module loading, so it works the
 * same in a single bundled file as from `node_modules`.
 *
 * `@opentelemetry/api-logs` keeps its provider on `globalThis` under a
 * `Symbol.for` key, so the copy imported here and the copy the SDK registered
 * through share one provider even when a bundle holds both. That is why the
 * provider is looked up per record rather than once: a logger obtained before
 * the SDK registered — or through another copy's proxy — would stay a no-op.
 *
 * @module
 */
import {
	type AnyValueMap,
	type Logger,
	type LoggerProvider,
	logs,
	SeverityNumber,
} from '@opentelemetry/api-logs';

/** The instrumentation scope every bridged record carries. */
export const OTEL_SCOPE = '@geekmidas/logger';

/** Pino's level labels, upper-cased as the logger prints them. */
const SEVERITY: Record<string, SeverityNumber> = {
	TRACE: SeverityNumber.TRACE,
	DEBUG: SeverityNumber.DEBUG,
	INFO: SeverityNumber.INFO,
	WARN: SeverityNumber.WARN,
	ERROR: SeverityNumber.ERROR,
	FATAL: SeverityNumber.FATAL,
};

/** Pino's numeric levels, for a record whose level was not formatted. */
function severityFromNumber(level: number): SeverityNumber {
	if (level >= 60) return SeverityNumber.FATAL;
	if (level >= 50) return SeverityNumber.ERROR;
	if (level >= 40) return SeverityNumber.WARN;
	if (level >= 30) return SeverityNumber.INFO;
	if (level >= 20) return SeverityNumber.DEBUG;
	return SeverityNumber.TRACE;
}

const SEVERITY_TEXT: Partial<Record<SeverityNumber, string>> = {
	[SeverityNumber.TRACE]: 'TRACE',
	[SeverityNumber.DEBUG]: 'DEBUG',
	[SeverityNumber.INFO]: 'INFO',
	[SeverityNumber.WARN]: 'WARN',
	[SeverityNumber.ERROR]: 'ERROR',
	[SeverityNumber.FATAL]: 'FATAL',
};

let cached: { provider: LoggerProvider; logger: Logger } | undefined;

/** The bridge's logger from whichever provider is registered now. */
function otelLogger(): Logger {
	const provider = logs.getLoggerProvider();
	if (cached?.provider !== provider) {
		cached = { provider, logger: provider.getLogger(OTEL_SCOPE) };
	}
	return cached.logger;
}

/**
 * Emit one serialized pino line through OpenTelemetry, when a provider is
 * registered that wants it.
 *
 * The line is what pino is about to write — after path redaction and the
 * URL-credential redaction — so the exported copy is exactly as redacted as
 * stdout. It runs synchronously inside the log call, so the active context —
 * and with it the trace and span ids — is the caller's.
 *
 * Without a registered provider the logger is a no-op whose `enabled()` is
 * false, and the line is not parsed.
 */
export function emitToOtel(line: string): void {
	const logger = otelLogger();
	if (!logger.enabled()) return;

	let record: Record<string, unknown>;
	try {
		record = JSON.parse(line);
	} catch {
		return;
	}

	const { level, time, msg, ...attributes } = record;
	const severityNumber =
		typeof level === 'number'
			? severityFromNumber(level)
			: (SEVERITY[String(level).toUpperCase()] ?? SeverityNumber.UNSPECIFIED);

	if (!logger.enabled({ severityNumber })) return;

	logger.emit({
		severityNumber,
		severityText:
			SEVERITY_TEXT[severityNumber] ??
			(level === undefined ? undefined : String(level)),
		...(msg !== undefined && { body: String(msg) }),
		...(typeof time === 'number' && { timestamp: time }),
		attributes: attributes as AnyValueMap,
	});
}

/**
 * The bridge as a pino `streamWrite` hook, for a logger made with `pino()`
 * directly rather than `createLogger` — which installs it already.
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { otelStreamWrite } from '@geekmidas/logger/otel';
 *
 * const logger = pino({ hooks: { streamWrite: otelStreamWrite } });
 * ```
 */
export function otelStreamWrite(line: string): string {
	try {
		emitToOtel(line);
	} catch {
		// Exporting a log is never a reason to lose it from stdout.
	}
	return line;
}
