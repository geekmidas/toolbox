import type { EnvironmentParser } from '@geekmidas/envkit';
import type { ConsoleLogger, Logger } from './logger';

export interface HermodServiceInterface<TInstance = unknown> {
  /**
   * The register method is called when the service is registered with the service discovery.
   */
  register(): Promise<TInstance> | TInstance;
}

export abstract class HermodService<
  TInstance = unknown,
  TLogger extends Logger = ConsoleLogger,
> {
  /**
   * The register method is called when the service is registered with the service discovery.
   */
  abstract register(): Promise<TInstance> | TInstance;
  /**
   * @param serviceDiscovery The service discovery instance to register the service with.
   */
  constructor(
    readonly serviceDiscovery: HermodServiceDiscovery,
    readonly logger: TLogger,
  ) {}
}

export class HermodServiceDiscovery<
  TServices extends Record<string, unknown> = {},
  TLogger extends Logger = ConsoleLogger,
> {
  private static _instance: HermodServiceDiscovery<any, any>;
  private services = new Map<string, HermodServiceInterface>();
  s!: TServices;

  static getInstance<
    T extends Record<any, unknown> = any,
    TLogger extends Logger = ConsoleLogger,
  >(
    logger: TLogger,
    envParser: EnvironmentParser<{}>,
  ): HermodServiceDiscovery<T> {
    if (!HermodServiceDiscovery._instance) {
      HermodServiceDiscovery._instance = new HermodServiceDiscovery<T, TLogger>(
        logger,
        envParser,
      );
    }
    return HermodServiceDiscovery._instance as HermodServiceDiscovery<T>;
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
  add<TName extends string, TInstance>(
    name: TName,
    service: HermodServiceInterface<TInstance>,
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
  async register<T extends HermodServiceConstructor[]>(
    services: T,
  ): Promise<HermodServiceRecord<T>> {
    const names: ExtractServiceNames<T>[] = services.map(
      (Service) => Service.serviceName,
    ) as ExtractServiceNames<T>[];
    for await (const Service of services) {
      const name = Service.serviceName;
      if (!this.has(name)) {
        const childLogger = this.logger.child({
          service: `ns.serviceDiscovery.${name}`,
        });
        // @ts-ignore
        const service = new Service(this, childLogger) as HermodService<
          ExtractServiceNames<typeof services>
        >;
        await service.register();
        this.add(name, service);
      }
    }

    const registeredServices = await this.getMany(names);

    return registeredServices as unknown as HermodServiceRecord<T>;
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

    return service.register() as Promise<TServices[K]>;
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
  has(service: string | HermodServiceConstructor): boolean {
    if (typeof service === 'string') {
      return this.services.has(service);
    }

    return this.services.has(service.serviceName);
  }
}
/** The options bag to pass to the {@link search} method. */
export interface HermodServiceConstructor<
  TName extends string = string,
  TInstance = unknown,
  TLogger extends Logger = ConsoleLogger,
> {
  new (
    serviceDiscovery: HermodServiceDiscovery,
    logger: TLogger,
  ): HermodService<TInstance>;

  serviceName: TName;
}

// First, let's create a type to extract information from a service class
type ExtractServiceInfo<T> = T extends HermodServiceConstructor<
  infer Name,
  infer Instance
>
  ? { name: Name; instance: Instance }
  : never;

export type ExtractServiceName<T> = T extends HermodServiceConstructor<
  infer Name
>
  ? Name
  : never;
export type ExtractServiceNames<T> = T extends HermodServiceConstructor<
  infer Name
>[]
  ? Name
  : never;
// Now let's create a type to build a record from an array of service classes
export type HermodServiceRecord<T extends HermodServiceConstructor[]> = {
  [K in Extract<ExtractServiceInfo<T[number]>['name'], string>]: Extract<
    ExtractServiceInfo<T[number]>,
    { name: K }
  >['instance'];
};
