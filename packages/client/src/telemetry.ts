/**
 * W3C trace context on the requests a client makes to its own API, so a user
 * action in the browser and the API request it causes are one trace.
 *
 * Two levels, chosen per request:
 *
 * - **An OpenTelemetry context is active** — a browser SDK has a span open, or
 *   this runs on a server (a Next.js server component, an API calling another
 *   API) inside a request span. The globally registered propagator writes the
 *   headers, so the current span is the parent: `traceparent`, `tracestate`,
 *   and whatever else that propagator carries.
 * - **Otherwise** (level 1): one trace id per page view — per page load in a
 *   browser, per client in Node — a fresh span id per request, and a sampled
 *   flag decided once per page view from {@link ClientTelemetryOptions.sampleRate}.
 *
 * Nothing is sent to any origin but the API's own: a trace id is an identifier,
 * and a third party has no business correlating a user's requests by it.
 *
 * `@opentelemetry/api` is not imported. Every copy of it — whichever version
 * an app bundles — registers its globals on `globalThis` under
 * `Symbol.for('opentelemetry.js.api.1')`, which is how two copies in one page
 * already share a provider. Reading the propagator and context manager from
 * there costs a browser bundle nothing when no SDK is loaded, and still finds
 * the SDK when one is.
 */

/** Telemetry on a client: `true` for the defaults, or these options. */
export interface ClientTelemetryOptions {
	/**
	 * The fraction of page views whose requests are sampled, from 0 to 1, when
	 * no OpenTelemetry context is active. Decided once per page view, so a
	 * page's requests are all kept or all dropped together.
	 *
	 * Use the stage's rate. The API caps an incoming sampled flag at its own
	 * rate anyway, and decides from the trace id the same way this does, so a
	 * page view sampled here at the API's rate is sampled there too.
	 * @default 1
	 */
	sampleRate?: number;
}

/** A `sampleRate` outside 0–1, which no sampler can honour. */
export class InvalidClientSampleRate extends Error {
	constructor(readonly sampleRate: number) {
		super(
			`telemetry.sampleRate must be a number from 0 (no page views) to 1 (every page view), got ${sampleRate}. Pass the stage's sample rate, such as 0.1.`,
		);
		this.name = 'InvalidClientSampleRate';
	}
}

/** Adds trace headers to a request to `url`, when it is the API's own. */
export type TraceContextInjector = (
	url: string,
	headers: Record<string, string>,
) => void;

/** The slice of `@opentelemetry/api`'s global registry this reads. */
interface OtelGlobal {
	context?: { active(): unknown };
	propagation?: {
		inject(
			context: unknown,
			carrier: Record<string, string>,
			setter: {
				set(carrier: Record<string, string>, key: string, value: string): void;
			},
		): void;
	};
}

const OTEL_GLOBAL = Symbol.for('opentelemetry.js.api.1');

const setter = {
	set(carrier: Record<string, string>, key: string, value: string) {
		carrier[key] = value;
	},
};

/**
 * The headers the registered propagator writes for the active context, or
 * undefined when there is no SDK or no span to continue.
 */
function fromActiveContext(): Record<string, string> | undefined {
	const api = (globalThis as Record<symbol, OtelGlobal | undefined>)[
		OTEL_GLOBAL
	];
	if (!api?.propagation || !api.context) return undefined;

	const carrier: Record<string, string> = {};
	try {
		api.propagation.inject(api.context.active(), carrier, setter);
	} catch {
		return undefined;
	}
	// The W3C propagator writes nothing without a valid, unsuppressed span.
	return carrier.traceparent ? carrier : undefined;
}

/** `bytes` crypto-random bytes as lowercase hex, never all zeros. */
function randomHex(bytes: number): string {
	const buffer = new Uint8Array(bytes);
	do {
		globalThis.crypto.getRandomValues(buffer);
	} while (buffer.every((byte) => byte === 0));
	let hex = '';
	for (const byte of buffer) hex += byte.toString(16).padStart(2, '0');
	return hex;
}

/**
 * Whether a trace is sampled at `rate`, from its id.
 *
 * The same rule as OpenTelemetry's `TraceIdRatioBasedSampler`: the id's four
 * 32-bit words XORed together, under `rate` of the 32-bit range. The trace id
 * is random, so this samples `rate` of page views — and the API, applying the
 * same rule to the same id at the same rate, keeps exactly the page views kept
 * here rather than a random `rate` of them.
 */
export function sampledAt(traceId: string, rate: number): boolean {
	if (rate >= 1) return true;
	if (rate <= 0) return false;
	let accumulation = 0;
	for (let i = 0; i < traceId.length; i += 8) {
		accumulation = (accumulation ^ parseInt(traceId.slice(i, i + 8), 16)) >>> 0;
	}
	return accumulation < Math.floor(rate * 0xffffffff);
}

/** A page view: one trace id for every request made during it. */
interface PageView {
	traceId: string;
}

let browserPageView: PageView | undefined;

/**
 * The page view a request belongs to: the page load's in a browser, shared by
 * every client on the page, or this client's own elsewhere — a server process
 * outlives any one user action, so one trace for all of it would mean nothing.
 */
function pageViewFor(own: () => PageView): PageView {
	const browser =
		typeof window !== 'undefined' && typeof document !== 'undefined';
	if (!browser) return own();
	browserPageView ??= { traceId: randomHex(16) };
	return browserPageView;
}

/** The origin of `url`, resolved the way `fetch` would, or undefined. */
function originOf(url: string): string | undefined {
	try {
		const base = (globalThis as { location?: { href?: string } }).location
			?.href;
		return new URL(url, base).origin;
	} catch {
		return undefined;
	}
}

/**
 * An injector for a client whose API is at `baseURL`, or undefined when
 * telemetry is off.
 */
export function traceContextInjector(
	baseURL: string,
	telemetry: boolean | ClientTelemetryOptions | undefined,
): TraceContextInjector | undefined {
	if (!telemetry) return undefined;

	const sampleRate = telemetry === true ? 1 : (telemetry.sampleRate ?? 1);
	if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
		throw new InvalidClientSampleRate(sampleRate);
	}

	const apiOrigin = originOf(baseURL || '/');
	let own: PageView | undefined;
	const ownPageView = () => {
		own ??= { traceId: randomHex(16) };
		return own;
	};

	return (url, headers) => {
		// Only the API's own origin: never a third party, and never anything
		// whose origin cannot be told.
		if (!apiOrigin || originOf(url) !== apiOrigin) return;
		// A caller that set its own context keeps it.
		if (Object.keys(headers).some((h) => h.toLowerCase() === 'traceparent'))
			return;

		const active = fromActiveContext();
		if (active) {
			Object.assign(headers, active);
			return;
		}

		const { traceId } = pageViewFor(ownPageView);
		const flags = sampledAt(traceId, sampleRate) ? '01' : '00';
		headers.traceparent = `00-${traceId}-${randomHex(8)}-${flags}`;
	};
}
