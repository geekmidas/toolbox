import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';

/**
 * Service interface for the new simplified service pattern.
 * Services are objects with a serviceName and register method.
 *
 * @template TName - The literal string type for the service name
 * @template TInstance - The type of the service instance that will be registered
 *
 * @example
 * ```typescript
 * class DatabaseService implements Service<'database', Database> {
 *   serviceName = 'database' as const;
 *
 *   async register(envParser: EnvironmentParser<{}>): Promise<Database> {
 *     const config = envParser.create((get) => ({
 *       url: get('DATABASE_URL').string()
 *     })).parse();
 *
 *     return new Database(config.url);
 *   }
 * }
 * ```
 */
export interface Service<TName extends string = string, TInstance = unknown> {
	/**
	 * Unique name for the service, used for lookup via services.get()
	 */
	serviceName: TName;
	/**
	 * Register method that returns the actual service instance.
	 * Called once on first access, then cached.
	 */
	register(envParser: EnvironmentParser<{}>): TInstance | Promise<TInstance>;
}

/**
 * Service discovery container that manages service registration and retrieval.
 * Implements a singleton pattern with lazy initialization of services.
 *
 * @template TServices - Record type mapping service names to their instance types
 * @template TLogger - Logger type for internal logging
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
 * const discovery = ServiceDiscovery.getInstance<MyServices>(logger, envParser);
 *
 * // Register services
 * await discovery.register([
 *   new DatabaseService(),
 *   new CacheService(),
 *   new AuthService()
 * ]);
 *
 * // Retrieve services
 * const db = await discovery.get('database');
 * const { cache, auth } = await discovery.getMany(['cache', 'auth']);
 * ```
 */
export class ServiceDiscovery<
	TServices extends Record<string, unknown> = {},
	TLogger extends Logger = Logger,
> {
	/** Singleton instance of ServiceDiscovery */
	private static _instance: ServiceDiscovery<any, any>;
	/** Map of registered service definitions */
	private services = new Map<string, Service>();
	/** Map of instantiated service instances */
	private instances = new Map<keyof TServices, TServices[keyof TServices]>();

	/**
	 * Gets the singleton instance of ServiceDiscovery.
	 * Creates a new instance if one doesn't exist.
	 *
	 * @template T - Record type mapping service names to their instance types
	 * @template TLogger - Logger type for internal logging
	 * @param logger - Logger instance for service logging
	 * @param envParser - Environment parser for service configuration
	 * @returns The ServiceDiscovery singleton instance
	 *
	 * @example
	 * ```typescript
	 * const services = ServiceDiscovery.getInstance<MyServices>(logger, envParser);
	 * ```
	 */
	static getInstance<
		T extends Record<any, unknown> = any,
		TLogger extends Logger = Logger,
	>(logger: TLogger, envParser: EnvironmentParser<{}>): ServiceDiscovery<T> {
		if (!ServiceDiscovery._instance) {
			ServiceDiscovery._instance = new ServiceDiscovery<T, TLogger>(
				logger,
				envParser,
			);
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
	 * @param logger - Logger instance for service logging
	 * @param envParser - Environment parser for service configuration
	 * @private
	 */
	private constructor(
		readonly logger: TLogger,
		readonly envParser: EnvironmentParser<{}>,
	) {}

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
	 *   new DatabaseService(),
	 *   new CacheService(),
	 *   new AuthService()
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

			const instance = await service.register(this.envParser);

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

		return service.register(this.envParser) as Promise<TServices[K]>;
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
	 * const dbService = new DatabaseService();
	 * if (!discovery.has(dbService)) {
	 *   await discovery.register([dbService]);
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
 * type Names = ExtractServiceNames<[DatabaseService, CacheService]>;
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
 * type MyServiceRecord = ServiceRecord<[DatabaseService, CacheService]>;
 * // type MyServiceRecord = {
 * //   database: Database;
 * //   cache: CacheService;
 * // }
 * ```
 */
export type ServiceRecord<T extends Service[]> = {
	[K in T[number] as K['serviceName']]: K extends Service
		? Awaited<ReturnType<K['register']>>
		: never;
};
