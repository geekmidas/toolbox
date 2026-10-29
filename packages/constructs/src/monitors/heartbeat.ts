import type { Service } from '@geekmidas/services';
import type { ConstructMonitor, MonitorInfo } from '../monitor';

export interface HeartbeatOptions {
	/**
	 * The environment variable holding the heartbeat URL. Required: the manifest
	 * lists it so infrastructure sets it wherever the construct is deployed. If
	 * it is missing at runtime the monitor is skipped with a warning, and the
	 * run goes on.
	 * @default 'HEARTBEAT_URL'
	 */
	env?: string;
	/** The URL to request when a run starts. Omit for providers without one. */
	start?: (url: string) => string;
	/** The URL to request when a run succeeds. @default the URL itself */
	success?: (url: string) => string;
	/**
	 * The URL to request when a run fails. Omit to send nothing, and let the
	 * provider alert on the missed success ping instead.
	 */
	failure?: (url: string) => string;
	/** Milliseconds to wait for the provider. @default 3000 */
	timeout?: number;
	/**
	 * The service the URL belongs to, recorded in the manifest so infrastructure
	 * knows which kind of heartbeat to create. Set by the presets.
	 */
	provider?: string;
}

/**
 * A monitor that pings a URL when a run succeeds, and optionally when it
 * starts or fails — the shape most heartbeat and cron-monitoring services
 * share.
 *
 * @example
 * ```typescript
 * cron
 *   .schedule('cron(0 0 * * *)')
 *   .uptime(heartbeat.betterStack())
 *   .handle(async () => {});
 * ```
 */
export function heartbeat(
	options: HeartbeatOptions = {},
): Service<`heartbeat:${string}`, ConstructMonitor> & { monitor: MonitorInfo } {
	const {
		env = 'HEARTBEAT_URL',
		start,
		success = (url) => url,
		failure,
		timeout = 3000,
		provider,
	} = options;

	return {
		serviceName: `heartbeat:${env}`,
		monitor: { type: 'heartbeat', ...(provider ? { provider } : {}), env },
		async register({ envParser }) {
			const { url } = envParser
				.create((get) => ({ url: get(env).string() }))
				.parse();

			const ping = async (target?: (url: string) => string) => {
				if (!url || !target) {
					return;
				}
				const response = await fetch(target(url), {
					signal: AbortSignal.timeout(timeout),
				});
				if (!response.ok) {
					throw new Error('Heartbeat responded with an error status', {
						cause: { status: response.status },
					});
				}
			};

			return {
				start: () => ping(start),
				success: () => ping(success),
				failure: () => ping(failure),
			};
		},
	};
}

/** Better Stack heartbeats: `{url}` on success, `{url}/fail` on failure. */
heartbeat.betterStack = (env?: string) =>
	heartbeat({ env, provider: 'betterStack', failure: (url) => `${url}/fail` });

/** Healthchecks.io: `{url}/start`, `{url}` and `{url}/fail`. */
heartbeat.healthchecks = (env?: string) =>
	heartbeat({
		env,
		provider: 'healthchecks',
		start: (url) => `${url}/start`,
		failure: (url) => `${url}/fail`,
	});
