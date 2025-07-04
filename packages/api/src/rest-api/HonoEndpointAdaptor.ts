import type { EnvironmentParser } from '@geekmidas/envkit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Hono } from 'hono';
import { wrapError } from '../errors';
import { getEndpointsFromRoutes } from '../helpers';
import { ConsoleLogger, type Logger } from '../logger';
import {
  type HermodServiceConstructor,
  HermodServiceDiscovery,
} from '../services';
import type { Handler } from './Endpoint';
import type { EndpointSchemas, Method } from './types';

export class HonoEndpointAdaptor<
  S extends EndpointSchemas,
  Path extends string,
  TMethod extends Method,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  readonly app: Hono;
  readonly endpoints: Handler<
    S,
    Path,
    TMethod,
    OutSchema,
    TServices,
    TLogger,
    TSession
  >[];
  readonly logger: TLogger;
  readonly envParser: EnvironmentParser<{}>;

  static async fromRoutes<TLogger extends Logger>(
    routes: string[],
    envParser: EnvironmentParser<{}>,
    app?: Hono,
    logger?: TLogger,
    cwd = process.cwd(),
  ): Promise<Hono> {
    const endpoints = await getEndpointsFromRoutes(routes, cwd);

    const adaptor = new HonoEndpointAdaptor({
      endpoints,
      app,
      logger: logger as ConsoleLogger | undefined,
      envParser,
    });

    return adaptor.register();
  }

  constructor(
    options: HonoEndpointAdaptorOptions<
      S,
      Path,
      TMethod,
      OutSchema,
      TServices,
      TLogger,
      TSession
    >,
  ) {
    this.app = options.app ?? new Hono();
    this.endpoints = options.endpoints;
    // @ts-ignore
    this.logger = options.logger ?? new ConsoleLogger();
    this.envParser = options.envParser;
  }

  async register(): Promise<Hono> {
    const serviceDiscovery = HermodServiceDiscovery.getInstance(
      this.logger,
      this.envParser,
    );
    for await (const e of this.endpoints) {
      const method = e.method.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'delete';
      const path = e.path;

      this.app[method](path, async (c) => {
        const logger = this.logger.child({
          route: e.route(),
          method,
        }) as TLogger;
        try {
          const h = c.req.header();
          logger.info({ headers: h }, 'Request headers');
          const p = c.req.param();
          const q = c.req.query();

          const b = await c.req.json().catch(() => undefined);

          const body = await e.parseBody(b);
          const query = await e.parseQuery(q);
          const params = await e.parseParams(p);

          const headers = new Map(
            Object.entries(h).map(([key, value]) => [
              key.toLowerCase(),
              value as string,
            ]),
          );

          const services = await serviceDiscovery.register(e.services);
          const ctx = {
            req: {
              headers,
            },
            logger,
            services,
            body,
            query,
            params,
          } as any;
          const session = await e.getSession(ctx);

          const result = await e.handler({
            ...ctx,
            session,
          });

          const response = await e.parseOutput(result);

          // @ts-ignore
          return c.json(response, e.status);
        } catch (error) {
          logger.error(error);
          const err = wrapError(error, 500, 'Internal Server Error');
          // @ts-ignore
          return c.json(err, err.statusCode);
        }
      });
    }

    return this.app;
  }
}

export type HonoEndpointAdaptorOptions<
  S extends EndpointSchemas,
  Path extends string,
  TMethod extends Method,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = {
  endpoints: Handler<
    S,
    Path,
    TMethod,
    OutSchema,
    TServices,
    TLogger,
    TSession
  >[];
  envParser: EnvironmentParser<{}>;
  app?: Hono;
  logger?: TLogger;
};
