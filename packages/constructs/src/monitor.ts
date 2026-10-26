import type { Logger } from '@geekmidas/logger';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import type { ConstructType } from './Construct';

/**
 * What a monitor is told about the construct whose run it is reporting.
 */
export interface MonitorContext {
	/** The kind of construct: function, cron or endpoint. */
	type: ConstructType;
	logger: Logger;
}

/**
 * Reports a construct's runs to an outside service — a heartbeat, an uptime
 * check, an error tracker.
 *
 * `start` runs before the handler and whatever it returns is handed back to
 * `success` or `failure`, so a provider that pairs the two (a check-in id) can.
 * A monitor that throws is logged and ignored: monitoring must never turn a
 * successful run into a failed one.
 */
export interface ConstructMonitor<TRun = unknown> {
	start?(ctx: MonitorContext): Promise<TRun>;
	success(
		ctx: MonitorContext & { run: TRun; output: unknown; status?: number },
	): Promise<void>;
	failure(
		ctx: MonitorContext & { run: TRun; error: unknown; status?: number },
	): Promise<void>;
}

/**
 * A monitor as the build manifest records it, so infrastructure can provision
 * what it reports to: a heartbeat's URL, set in the variable it reads.
 */
export interface MonitorInfo {
	/** The kind of monitor, e.g. `heartbeat`. */
	type: string;
	/** The service it reports to, e.g. `betterStack`. Absent for a custom one. */
	provider?: string;
	/** The environment variable it reads its target from. */
	env?: string;
}

export type MonitorService = Service<string, ConstructMonitor<any>> & {
	/** How the manifest records this monitor. Defaults to its service name. */
	monitor?: MonitorInfo;
};

/** A run in progress, closed by exactly one of its two methods. */
export interface MonitoredRun {
	success(output: unknown, status?: number): Promise<void>;
	failure(error: unknown, status?: number): Promise<void>;
	/**
	 * Close an HTTP run from its response status: a 5xx is a failure, anything
	 * else is a success. A 4xx is the caller's mistake, not an outage.
	 */
	settle(status: number, error?: unknown): Promise<void>;
}

/**
 * Add a monitor to a construct's list, refusing one that is already there.
 *
 * Services are cached by name, so two monitors with one name would silently
 * share an instance: two heartbeats reading `HEARTBEAT_URL` would both ping
 * whichever was registered first, and the other provider would never hear
 * from the construct.
 */
export function addMonitor(
	monitors: readonly MonitorService[],
	monitor: MonitorService,
): MonitorService[] {
	if (monitors.some((m) => m.serviceName === monitor.serviceName)) {
		throw new Error(
			`Monitor "${monitor.serviceName}" is already set on this construct. ` +
				'Two heartbeats reading the same env var would share one URL; ' +
				"give one its own, e.g. heartbeat.healthchecks('HEALTHCHECKS_HEARTBEAT_URL').",
		);
	}
	return [...monitors, monitor];
}

const NOOP_RUN: MonitoredRun = {
	async success() {},
	async failure() {},
	async settle() {},
};

/**
 * Start a construct's monitors for one run.
 *
 * Never throws: a monitor that fails to register, start or report is logged,
 * and the run goes on without it.
 */
export async function startMonitors(
	construct: { type: ConstructType; monitors: readonly MonitorService[] },
	serviceDiscovery: ServiceDiscovery<any>,
	logger: Logger,
): Promise<MonitoredRun> {
	if (!construct.monitors.length) {
		return NOOP_RUN;
	}

	const ctx: MonitorContext = { type: construct.type, logger };

	let started: { monitor: ConstructMonitor<any>; run: unknown }[];
	try {
		const registered: Record<string, unknown> = await serviceDiscovery.register(
			[...construct.monitors],
		);
		started = await Promise.all(
			construct.monitors.map(async ({ serviceName }) => {
				const monitor = registered[serviceName] as ConstructMonitor<any>;
				let run: unknown;
				try {
					run = await monitor.start?.(ctx);
				} catch (error) {
					logger.warn(
						{ error, monitor: serviceName },
						'Monitor failed to start',
					);
				}
				return { monitor, run };
			}),
		);
	} catch (error) {
		logger.warn({ error }, 'Monitors could not be registered');
		return NOOP_RUN;
	}

	const report = async (
		call: (monitor: ConstructMonitor<any>, run: unknown) => Promise<void>,
	) => {
		const results = await Promise.allSettled(
			started.map(({ monitor, run }) => call(monitor, run)),
		);
		for (const result of results) {
			if (result.status === 'rejected') {
				logger.warn({ error: result.reason }, 'Monitor failed to report');
			}
		}
	};

	const run: MonitoredRun = {
		success: (output, status) =>
			report((monitor, r) =>
				monitor.success({ ...ctx, run: r, output, status }),
			),
		failure: (error, status) =>
			report((monitor, r) =>
				monitor.failure({ ...ctx, run: r, error, status }),
			),
		settle: (status, error) =>
			status >= 500
				? run.failure(error ?? new Error(`Responded with ${status}`), status)
				: run.success(undefined, status),
	};

	return run;
}
