import type { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from './context';
import type { Service } from './types';

/**
 * Service discovery container that manages service registration and retrieval.
 * Implements a singleton pattern with lazy initialization of services.
 *
 * @template TServices - Record type mapping service names to their instance types
 *
 * @example
 * ```typescript
 * // Define service types
 * interface MyServices {
 *   database: Database;
 *   cache: CacheService;
 *   auth: AuthService;
 * }
 *
 * // Get service discovery instance
 * const discovery = ServiceDiscovery.getInstance<MyServices>(envParser);
 *
 * // Register services
 * await discovery.register([
 *   databaseService,
 *   cacheService,
 *   authService
 * ]);
 *
 * // Retrieve services
 * const db = await discovery.get('database');
 * const { cache, auth } = await discovery.getMany(['cache', 'auth']);
 * ```
 */
export class ServiceDiscovery<TServices extends Record<string, unknown> = {}> {
	/** Singleton instance of ServiceDiscovery */
	private static _instance: ServiceDiscovery<any>;
	/** Map of registered service definitions */
	private services = new Map<string, Service>();
	/** Map of instantiated service instances */
	private instances = new Map<keyof TServices, TServices[keyof TServices]>();

	/**
	 * Gets the singleton instance of ServiceDiscovery.
	 * Creates a new instance if one doesn't exist.
	 *
	 * @template T - Record type mapping service names to their instance types
	 * @param envParser - Environment parser for service configuration
	 * @returns The ServiceDiscovery singleton instance
	 *
	 * @example
	 * ```typescript
	 * const services = ServiceDiscovery.getInstance<MyServices>(envParser);
	 * ```
	 */
	static getInstance<T extends Record<any, unknown> = any>(
		envParser: EnvironmentParser<{}>,
	): ServiceDiscovery<T> {
		if (!ServiceDiscovery._instance) {
			ServiceDiscovery._instance = new ServiceDiscovery<T>(envParser);
		}
		return ServiceDiscovery._instance as ServiceDiscovery<T>;
	}

	/**
	 * Resets the singleton instance. Use only for testing purposes.
	 * This clears all cached services and allows a fresh instance to be created.
	 *
	 * @example
	 * ```typescript
	 * // In test teardown
	 * afterEach(() => {
	 *   ServiceDiscovery.reset();
	 * });
	 * ```
	 */
	static reset(): void {
		ServiceDiscovery._instance = undefined as any;
	}

	/**
	 * Private constructor to enforce singleton pattern.
	 *
	 * @param envParser - Environment parser for service configuration
	 * @private
	 */
	private constructor(readonly envParser: EnvironmentParser<{}>) {}

	/**
	 * Register multiple services with the service discovery.
	 * Services are instantiated lazily on first access.
	 * Already instantiated services are returned from cache.
	 *
	 * @template T - Array type of services to register
	 * @param services - Array of services to register
	 * @returns Promise resolving to a record of service names to instances
	 *
	 * @example
	 * ```typescript
	 * const services = await discovery.register([
	 *   databaseService,
	 *   cacheService,
	 *   authService
	 * ]);
	 *
	 * // services = {
	 * //   database: Database instance,
	 * //   cache: CacheService instance,
	 * //   auth: AuthService instance
	 * // }
	 * ```
	 */
	async register<T extends Service[]>(services: T): Promise<ServiceRecord<T>> {
		const registeredServices = {} as ServiceRecord<T>;
		for (const service of services) {
			const name = service.serviceName as T[number]['serviceName'];
			if (this.instances.has(name)) {
				(registeredServices as any)[name] = this.instances.get(
					name,
				) as TServices[keyof TServices];
				continue;
			}

			// Pass both envParser and context to service
			const instance = await service.register({
				envParser: this.envParser,
				context: serviceContext,
			});

			this.instances.set(name, instance as TServices[keyof TServices]);
			(registeredServices as any)[name] =
				instance as TServices[keyof TServices];
		}

		return registeredServices;
	}

	/**
	 * Get a service from the service discovery.
	 * Services are instantiated on first access if not already cached.
	 *
	 * @template K - The service name key
	 * @param name - The name of the service to get
	 * @returns Promise resolving to the service instance
	 * @throws {Error} If the service is not registered
	 *
	 * @example
	 * ```typescript
	 * const database = await discovery.get('database');
	 * const users = await database.query('SELECT * FROM users');
	 * ```
	 */
	get<K extends keyof TServices & string>(name: K): Promise<TServices[K]> {
		const service = this.services.get(name);

		if (!service) {
			throw new Error(`Service '${name}' not found in service discovery`);
		}

		return service.register({
			envParser: this.envParser,
			context: serviceContext,
		}) as Promise<TServices[K]>;
	}
	/**
	 * Get multiple services from the service discovery.
	 * Useful for retrieving multiple dependencies at once.
	 *
	 * @template K - Array of service name keys
	 * @param names - Array of service names to retrieve
	 * @returns Promise resolving to an object containing the service instances
	 *
	 * @example
	 * ```typescript
	 * const { database, cache, auth } = await discovery.getMany([
	 *   'database',
	 *   'cache',
	 *   'auth'
	 * ]);
	 * ```
	 */
	async getMany<K extends (keyof TServices & string)[]>(
		names: [...K],
	): Promise<{ [P in K[number]]: TServices[P] }> {
		const result = {} as { [P in K[number]]: TServices[P] };

		for (const name of names) {
			result[name] = await this.get(name);
		}

		return result;
	}

	/**
	 * Check if a service exists in the service discovery.
	 * Can check by service name or service instance.
	 *
	 * @param service - The service name or service instance to check
	 * @returns True if the service exists, false otherwise
	 *
	 * @example
	 * ```typescript
	 * if (discovery.has('database')) {
	 *   const db = await discovery.get('database');
	 * }
	 *
	 * // Or check with service instance
	 * if (!discovery.has(databaseService)) {
	 *   await discovery.register([databaseService]);
	 * }
	 * ```
	 */
	has(service: string | Service): boolean {
		if (typeof service === 'string') {
			return this.services.has(service);
		}

		return this.services.has(service.serviceName);
	}
}

/**
 * Utility type to extract service names from an array of services.
 *
 * @template T - Array of Service types
 *
 * @example
 * ```typescript
 * type Names = ExtractServiceNames<[typeof databaseService, typeof cacheService]>;
 * // type Names = 'database' | 'cache'
 * ```
 */
export type ExtractServiceNames<T extends Service[]> = T[number]['serviceName'];

/**
 * Utility type to create a record type from an array of services.
 * Maps service names to their registered instance types.
 *
 * @template T - Array of Service types
 *
 * @example
 * ```typescript
 * type MyServiceRecord = ServiceRecord<[typeof databaseService, typeof cacheService]>;
 * // type MyServiceRecord = {
 * //   database: DatabaseInstance;
 * //   cache: CacheInstance;
 * // }
 * ```
 */
export type ServiceRecord<T extends Service[]> = {
	[K in T[number] as K['serviceName']]: K extends Service
		? Awaited<ReturnType<K['register']>>
		: never;
};
