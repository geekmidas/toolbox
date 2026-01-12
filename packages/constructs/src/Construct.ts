import type { AuditStorage } from '@geekmidas/audit';
import { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import compact from 'lodash.compact';

// Cache for service environment variables to handle singleton services
// Key: service class/constructor, Value: array of env var names
const serviceEnvCache = new Map<Service, string[]>();

export abstract class Construct<
	TLogger extends Logger = Logger,
	TServiceName extends string = string,
	T extends EventPublisher<any> | undefined = undefined,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TAuditStorageServiceName extends string = string,
	TAuditStorage extends AuditStorage | undefined = undefined,
> {
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
	 * @returns Promise that resolves to array of environment variable names, sorted alphabetically
	 *
	 * @example
	 * ```typescript
	 * const endpoint = e
	 *   .services([databaseService, authService])
	 *   .get('/users')
	 *   .handle(async () => []);
	 *
	 * const envVars = await endpoint.getEnvironment(); // ['AUTH_SECRET', 'DATABASE_URL']
	 * ```
	 */
	async getEnvironment(): Promise<string[]> {
		const envVars = new Set<string>();
		const services: Service[] = compact([
			...this.services,
			this.publisherService,
			this.auditorStorageService,
		]);

		try {
			for (const service of services) {
				// Check cache first - handles singleton services that short-circuit
				if (serviceEnvCache.has(service)) {
					const cached = serviceEnvCache.get(service)!;
					cached.forEach((v) => envVars.add(v));
					continue;
				}

				// Sniff the service for env vars
				const sniffer = new SnifferEnvironmentParser();
				try {
					const result = service.register({ envParser: sniffer as any });

					// Await if it's a Promise (async services)
					if (result && typeof result === 'object' && 'then' in result) {
						await Promise.resolve(result);
					}
				} catch {
					// Service registration may fail but env vars are still tracked
				}

				// Cache and collect the env vars
				const serviceEnvVars = sniffer.getEnvironmentVariables();
				serviceEnvCache.set(service, serviceEnvVars);
				serviceEnvVars.forEach((v) => envVars.add(v));
			}

			return Array.from(envVars).sort();
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
