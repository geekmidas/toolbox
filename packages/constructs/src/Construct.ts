import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import compact from 'lodash.compact';

export abstract class Construct<
  TLogger extends Logger = Logger,
  TServiceName extends string = string,
  T extends EventPublisher<any> | undefined = undefined,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
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
  ) {}

  /**
   * Returns an array of environment variable names required by this construct's services.
   * This is determined by running a "sniffer" EnvironmentParser through each service's
   * register method to track which environment variables are accessed.
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
    const sniffer = new EnvironmentParser({});
    const services: Service[] = compact([
      ...this.services,
      this.publisherService,
    ]);

    try {
      // Run each service's register method with the sniffer to track env var access
      for (const service of services) {
        try {
          const config = service.register(sniffer);

          // Await if it's a Promise (async services)
          const resolvedConfig =
            config && typeof config === 'object' && 'then' in config
              ? await Promise.resolve(config)
              : config;

          // If register returns a ConfigParser, collect its env vars
          if (
            resolvedConfig &&
            typeof resolvedConfig === 'object' &&
            'getEnvironmentVariables' in resolvedConfig &&
            typeof resolvedConfig.getEnvironmentVariables === 'function'
          ) {
            const vars = resolvedConfig.getEnvironmentVariables();
            if (Array.isArray(vars)) {
              vars.forEach((v: string) => envVars.add(v));
            }
          }
        } catch (serviceError) {
          // Service registration failed (e.g., missing env vars during .parse())
          // But env vars were already tracked during .create(), so we continue
          continue;
        }
      }

      return Array.from(envVars).sort();
    } catch (error) {
      console.error(
        'Error determining environment variables for construct:',
        error,
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
