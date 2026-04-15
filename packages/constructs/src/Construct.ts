import type { AuditStorage } from '@geekmidas/audit';
import {
	SnifferEnvironmentParser,
	type SniffResult,
	sniffWithFireAndForget,
} from '@geekmidas/envkit/sniffer';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { Service, ServiceContext } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import compact from 'lodash.compact';

// Cache for service environment variables to handle singleton services
// Stores both the full list and the optional subset so the same sniff result
// can satisfy both getEnvironment() and getEnvironment({ markOptional: true }).
const serviceEnvCache = new Map<
	Service,
	{ envVars: string[]; optionalEnvVars: string[] }
>();

/**
 * Noop context for environment sniffing.
 * Used when calling service.register() to detect env vars without a real request.
 * Returns dummy values since services should only use context in instance methods,
 * not during registration.
 */
const snifferContext: ServiceContext = {
	getLogger() {
		// Return a noop logger for sniffing - services shouldn't log during registration
		return {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
			child: () => snifferContext.getLogger(),
		} as unknown as Logger;
	},
	getRequestId() {
		return 'sniffer-context';
	},
	getRequestStartTime() {
		return Date.now();
	},
	hasContext() {
		return false;
	},
};

export abstract class Construct<
	TLogger extends Logger = Logger,
	TServiceName extends string = string,
	T extends EventPublisher<any> | undefined = undefined,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TAuditStorageServiceName extends string = string,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TDatabaseServiceName extends string = string,
	TDatabase = unknown,
> {
	/** Database service for this construct (used by Endpoint for RLS/audit context) */
	public databaseService?: Service<TDatabaseServiceName, TDatabase>;

	constructor(
		public readonly type: ConstructType,
		public readonly logger: TLogger,
		public readonly services: TServices,
		public readonly events: MappedEvent<T, any>[] = [],

		public readonly publisherService?: Service<TServiceName, T>,
		public outputSchema?: OutSchema,
		public readonly timeout?: number,
		public readonly memorySize?: number,
		public readonly auditorStorageService?: Service<
			TAuditStorageServiceName,
			TAuditStorage
		>,
	) {}

	/**
	 * Returns an array of environment variable names required by this construct's services.
	 * This is determined by running a "sniffer" EnvironmentParser through each service's
	 * register method to track which environment variables are accessed.
	 *
	 * Results are cached per service class to handle singleton patterns where
	 * subsequent register() calls may short-circuit and not access env vars.
	 *
	 * @param markOptional - When true, optional vars (those accessed via `.optional()` or
	 *   `.default()`) are suffixed with `?` in the returned array (e.g. `'PORT?'`).
	 * @returns Promise that resolves to array of environment variable names, sorted alphabetically
	 *
	 * @example
	 * ```typescript
	 * const endpoint = e
	 *   .services([databaseService, authService])
	 *   .get('/users')
	 *   .handle(async () => []);
	 *
	 * await endpoint.getEnvironment();               // ['AUTH_SECRET', 'DATABASE_URL']
	 * await endpoint.getEnvironment({ markOptional: true }); // ['AUTH_SECRET', 'DATABASE_URL', 'PORT?']
	 * ```
	 */
	async getEnvironment(
		opts: { markOptional?: boolean } = {},
	): Promise<string[]> {
		const { markOptional = false } = opts;
		const envVars = new Set<string>();
		const optionalVars = new Set<string>();
		const services: Service[] = compact([
			...this.services,
			this.publisherService,
			this.publisherService,
			this.auditorStorageService,
			this.databaseService,
		]);

		try {
			for (const service of services) {
				// Check cache first - handles singleton services that short-circuit
				if (serviceEnvCache.has(service)) {
					const cached = serviceEnvCache.get(service)!;
					cached.envVars.forEach((v) => envVars.add(v));
					cached.optionalEnvVars.forEach((v) => optionalVars.add(v));
					continue;
				}

				// Use sniffService to properly handle all error scenarios
				const result = await sniffService(service);

				// Log any issues for debugging
				if (result.error) {
					this.logger.warn(
						{ error: result.error.message, service: service.serviceName },
						'Service threw error during env sniffing (env vars still captured)',
					);
				}
				if (result.unhandledRejections.length > 0) {
					this.logger.warn(
						{
							errors: result.unhandledRejections.map((e) => e.message),
							service: service.serviceName,
						},
						'Fire-and-forget rejections during env sniffing (suppressed)',
					);
				}

				// Cache and collect env vars (both required and optional)
				serviceEnvCache.set(service, {
					envVars: result.envVars,
					optionalEnvVars: result.optionalEnvVars,
				});
				result.envVars.forEach((v) => envVars.add(v));
				result.optionalEnvVars.forEach((v) => optionalVars.add(v));
			}

			const sorted = Array.from(envVars).sort();
			if (!markOptional || optionalVars.size === 0) return sorted;
			return sorted.map((v) => (optionalVars.has(v) ? `${v}?` : v));
		} catch (error) {
			this.logger.error(
				{ error },
				'Error determining environment variables for construct',
			);

			return [];
		}
	}
}

export enum ConstructType {
	Cron = 'dev.geekmidas.function.cron',
	Endpoint = 'dev.geekmidas.function.endpoint',
	Function = 'dev.geekmidas.function.function',
	Subscriber = 'dev.geekmidas.function.subscriber',
}

/**
 * Utility to test sniffing a service for environment variables.
 * Useful for debugging services that throw errors during sniffing.
 *
 * @example
 * ```typescript
 * import { sniffService } from '@geekmidas/constructs';
 * import { authService } from './services/AuthService';
 *
 * const result = await sniffService(authService);
 * console.log('Env vars:', result.envVars);
 * console.log('Error:', result.error);
 * ```
 */
export async function sniffService(service: Service): Promise<SniffResult> {
	const sniffer = new SnifferEnvironmentParser();

	return sniffWithFireAndForget(sniffer, () =>
		service.register({
			envParser: sniffer as any,
			context: snifferContext,
		}),
	);
}

// Export for testing
export { snifferContext };
