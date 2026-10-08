import type { AuditStorage } from '@geekmidas/audit';
import {
	runWithRequestContext,
	type ServiceDiscovery,
} from '@geekmidas/services';
import {
	context,
	ROOT_CONTEXT,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';
import { publishEvents } from '../publisher';
import type { Cron } from './Cron';

/**
 * Run a cron once, in this process: what an EventBridge rule's invocation does
 * on Lambda, for a server that schedules its own.
 *
 * The same steps as the Lambda adaptor — its services, its worker's database
 * as `db`, an auditor when it declared one, its output parsed, its events
 * published — because a cron that ran differently on a server than deployed
 * would pass locally and fail where it matters. Services come through the
 * discovery, which keeps one instance of each, so running every minute does not
 * reconnect a database every minute.
 *
 * Each run is a trace of its own: a root span, `cron <name>`, whatever was
 * active when the timer or the broker fired it.
 */
export async function runCron(
	cron: Cron<any, any, any, any, any, any>,
	serviceDiscovery: ServiceDiscovery<any>,
	/** The cron's export name, for its span. */
	name?: string,
): Promise<unknown> {
	const span = trace.getTracer('@geekmidas/constructs').startSpan(
		`cron ${name ?? cron.schedule ?? 'manual'}`,
		{
			kind: SpanKind.INTERNAL,
			attributes: {
				...(name && { 'gkm.cron.name': name }),
				...(cron.schedule && { 'gkm.cron.schedule': cron.schedule }),
			},
		},
		ROOT_CONTEXT,
	);

	return context.with(trace.setSpan(ROOT_CONTEXT, span), async () => {
		try {
			return await run(cron, serviceDiscovery);
		} catch (error) {
			if (error instanceof Error) span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw error;
		} finally {
			span.end();
		}
	});
}

async function run(
	cron: Cron<any, any, any, any, any, any>,
	serviceDiscovery: ServiceDiscovery<any>,
): Promise<unknown> {
	const services =
		cron.services.length > 0
			? await serviceDiscovery.register(cron.services)
			: {};

	const db = cron.databaseService
		? (await serviceDiscovery.register([cron.databaseService]))[
				cron.databaseService.serviceName
			]
		: undefined;

	// Only imported for a cron that audits: `@geekmidas/audit` is optional.
	let auditor: { flush(): Promise<void> } | undefined;
	if (cron.auditorStorageService) {
		const { DefaultAuditor } = await import('@geekmidas/audit');
		const registered: Record<string, unknown> = await serviceDiscovery.register(
			[cron.auditorStorageService],
		);
		const storage = registered[
			cron.auditorStorageService.serviceName
		] as AuditStorage;
		auditor = new DefaultAuditor({
			actor: { id: 'system', type: 'system' },
			storage,
			metadata: { function: cron.type },
		});
	}

	const logger = cron.logger;
	const requestId = `cron-${Date.now()}`;

	return runWithRequestContext(
		{
			logger,
			requestId,
			startTime: Date.now(),
			operation: `cron ${cron.schedule ?? 'manual'}`,
		},
		async () => {
			const response = await cron.fn({
				input: undefined,
				services,
				logger,
				db,
				auditor,
			} as any);
			const output = await cron.parseOutput(response);

			await auditor?.flush();
			// The cron's output schema is erased by the `any` it is typed with here.
			await publishEvents(
				logger,
				serviceDiscovery,
				cron.events,
				output as never,
			);

			return output;
		},
	);
}
