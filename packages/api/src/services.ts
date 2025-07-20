import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from './logger';

/**
 * Service interface for the new simplified service pattern.
 * Services are objects with a serviceName and register method.
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

export interface HermodServiceInterface<TInstance = unknown> {
  /**
   * The register method is called when the service is registered with the service discovery.
   */
  register(): Promise<TInstance> | TInstance;
}

export class ServiceDiscovery<
  TServices extends Record<string, unknown> = {},
  TLogger extends Logger = Logger,
> {
  private static _instance: ServiceDiscovery<any, any>;
  private services = new Map<string, Service>();
  private instances = new Map<keyof TServices, TServices[keyof TServices]>();

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

  private constructor(
    readonly logger: TLogger,
    readonly envParser: EnvironmentParser<{}>,
  ) {}
  /**
   * Add a service to the service discovery.
   *
   * @param service The service to add.
   */
  private add<TName extends string, TInstance>(
    name: TName,
    service: Service<TName, TInstance>,
  ): void {
    if (!this.services.has(name)) {
      this.services.set(name, service);
    }
  }

  /**
   * Register multiple services with the service discovery.
   *
   * @param services -  The services to register.
   */
  async register<T extends Service[]>(services: T): Promise<ServiceRecord<T>> {
    const registeredServices: ServiceRecord<T> = {} as ServiceRecord<T>;
    for (const service of services) {
      const name = service.serviceName;
      if (this.instances.has(name)) {
        registeredServices[name] = this.instances.get(
          name,
        ) as TServices[keyof TServices];
        continue;
      }

      const instance = await service.register(this.envParser);

      this.instances.set(name, instance as TServices[keyof TServices]);
      registeredServices[name] = instance as TServices[keyof TServices];
    }

    return registeredServices;
  }

  /**
   * Get a service from the service discovery.
   *
   * @param name  - The name of the service to get.
   * @returns The service instance.
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
   *
   * @param names - The names of the services to get.
   * @returns - An object containing the service instances.
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
   *
   * @param service - The service name or service instance to check.
   * @returns True if the service exists, false otherwise.
   */
  has(service: string | Service): boolean {
    if (typeof service === 'string') {
      return this.services.has(service);
    }

    return this.services.has(service.serviceName);
  }
}

export type ExtractServiceNames<T extends Service[]> = T[number]['serviceName'];

export type ServiceRecord<T extends Service[]> = {
  [K in T[number] as K['serviceName']]: K extends Service
    ? Awaited<ReturnType<K['register']>>
    : never;
};
