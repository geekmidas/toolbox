import type { Logger } from '@geekmidas/logger';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import type { ConstructType } from './Construct';

/**
 * What a monitor is told about the cron whose run it is reporting.
 */
export interface MonitorContext {
	/** The kind of construct, always a cron. */
	type: ConstructType;
	logger: Logger;
}

/**
 * Reports a cron's runs to an uptime service, set with `.uptime()`, so a cron
 * that stops running is noticed. A failure is already logged where it
 * happens; what only a monitor can report is a run that never happened.
 *
 * `start` runs before the handler and whatever it returns is handed back to
 * `success` or `failure`, so a provider that pairs the two (a check-in id) can.
 * A monitor that throws is logged and ignored: monitoring must never turn a
 * successful run into a failed one.
 */
export interface ConstructMonitor<TRun = unknown> {
	start?(ctx: MonitorContext): Promise<TRun>;
	success(ctx: MonitorContext & { run: TRun; output: unknown }): Promise<void>;
	failure(ctx: MonitorContext & { run: TRun; error: unknown }): Promise<void>;
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
	success(output: unknown): Promise<void>;
	failure(error: unknown): Promise<void>;
}

const NOOP_RUN: MonitoredRun = {
	async success() {},
	async failure() {},
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

	return {
		success: (output) =>
			report((monitor, run) => monitor.success({ ...ctx, run, output })),
		failure: (error) =>
			report((monitor, run) => monitor.failure({ ...ctx, run, error })),
	};
}
