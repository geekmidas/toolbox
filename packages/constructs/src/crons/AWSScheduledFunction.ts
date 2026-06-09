import type { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { AWSLambdaFunction } from '../functions/AWSLambdaFunction';
import type { Cron } from './Cron';

/**
 * AWS Lambda adaptor for {@link Cron} constructs.
 *
 * A `Cron` is a {@link import('../functions').Function} that is invoked on a
 * schedule (an EventBridge rule) rather than by an API request. Because of
 * that, the runtime execution pipeline is identical to a regular Lambda
 * function: input parsing, service/database/auditor wiring, event publishing,
 * error handling, and the `runWithRequestContext` wrapper that powers
 * request-scoped logging via `serviceContext.getLogger()`.
 *
 * This adaptor therefore reuses {@link AWSLambdaFunction} wholesale and only
 * narrows the constructor to accept a `Cron`. The schedule expression itself
 * (`cron.schedule`) is **deploy-time** infrastructure consumed by the CLI to
 * provision the EventBridge rule — it is not needed at runtime.
 *
 * @example
 * ```typescript
 * import { AWSScheduledFunction } from '@geekmidas/constructs/crons';
 * import { cancelPastBookings } from '../../../src/crons/cancelPastBookings.js';
 * import { envParser } from '../../../src/env';
 *
 * const adapter = new AWSScheduledFunction(envParser, cancelPastBookings);
 *
 * export const handler = adapter.handler;
 * ```
 */
export class AWSScheduledFunction<
	TInput extends ComposableStandardSchema | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TOutSchema extends StandardSchemaV1 | undefined = undefined,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends AWSLambdaFunction<
	TInput,
	TOutSchema,
	TServices,
	TLogger,
	TEventPublisher,
	TEventPublisherServiceName,
	undefined,
	string,
	TDatabase,
	TDatabaseServiceName
> {
	constructor(
		envParser: EnvironmentParser<{}>,
		cron: Cron<
			TInput,
			TServices,
			TLogger,
			TOutSchema,
			TEventPublisher,
			TEventPublisherServiceName,
			TDatabase,
			TDatabaseServiceName
		>,
	) {
		super(envParser, cron);
	}
}
