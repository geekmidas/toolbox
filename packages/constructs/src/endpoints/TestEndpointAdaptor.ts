import type { AuditStorage, AuditableAction } from '@geekmidas/audit';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type {
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { publishConstructEvents } from '../publisher';
import type { HttpMethod } from '../types';
import {
  type CookieOptions,
  Endpoint,
  type EndpointSchemas,
  ResponseBuilder,
} from './Endpoint';
import type { MappedAudit } from './audit';
import {
  createAuditContext,
  executeWithAuditTransaction,
} from './processAudits';

export type TestHttpResponse<TBody = any> = {
  body: TBody;
  status: number;
  headers: Record<string, string | string[]>;
};

/**
 * Serializes a cookie into a Set-Cookie header string
 */
function serializeCookie(
  name: string,
  value: string,
  options?: CookieOptions,
): string {
  let cookieString = `${name}=${value}`;

  if (options) {
    if (options.maxAge !== undefined) {
      cookieString += `; Max-Age=${options.maxAge}`;
    }
    if (options.expires) {
      cookieString += `; Expires=${options.expires.toUTCString()}`;
    }
    if (options.domain) {
      cookieString += `; Domain=${options.domain}`;
    }
    if (options.path) {
      cookieString += `; Path=${options.path}`;
    }
    if (options.httpOnly) {
      cookieString += '; HttpOnly';
    }
    if (options.secure) {
      cookieString += '; Secure';
    }
    if (options.sameSite) {
      cookieString += `; SameSite=${options.sameSite}`;
    }
  }

  return cookieString;
}

export class TestEndpointAdaptor<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> {
  static getDefaultServiceDiscover<
    TRoute extends string,
    TMethod extends HttpMethod,
    TInput extends EndpointSchemas = {},
    TOutSchema extends StandardSchemaV1 | undefined = undefined,
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
    TSession = unknown,
    TEventPublisher extends EventPublisher<any> | undefined = undefined,
    TEventPublisherServiceName extends string = string,
    TAuditStorage extends AuditStorage | undefined = undefined,
    TAuditStorageServiceName extends string = string,
    TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
      string,
      unknown
    >,
    TDatabase = undefined,
    TDatabaseServiceName extends string = string,
  >(
    endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >,
  ) {
    return ServiceDiscovery.getInstance(
      endpoint.logger,
      new EnvironmentParser({}),
    );
  }
  constructor(
    private readonly endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >,
    private serviceDiscovery: ServiceDiscovery<
      any,
      any
    > = TestEndpointAdaptor.getDefaultServiceDiscover(endpoint),
  ) {}

  async fullRequest(
    ctx: TestRequestAdaptor<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName
    >,
  ): Promise<TestHttpResponse<InferStandardSchema<TOutSchema>>> {
    const body = await this.endpoint.parseInput((ctx as any).body, 'body');
    const query = await this.endpoint.parseInput((ctx as any).query, 'query');
    const params = await this.endpoint.parseInput(
      (ctx as any).params,
      'params',
    );

    const header = Endpoint.createHeaders(ctx.headers);
    const cookie = Endpoint.createCookies(ctx.headers.cookie);
    const logger = this.endpoint.logger.child({
      route: this.endpoint.route,
      host: ctx.headers.host,
      method: this.endpoint.method,
    }) as TLogger;
    const session = await this.endpoint.getSession({
      logger,
      services: ctx.services,
      header,
      cookie,
    });

    // Create audit context if audit storage is configured
    // The auditorStorage is required when endpoint uses .auditor()
    const auditorStorageService = (ctx as any).auditorStorage as
      | Service<TAuditStorageServiceName, TAuditStorage>
      | undefined;
    const endpointWithAuditor = auditorStorageService
      ? { ...this.endpoint, auditorStorageService }
      : this.endpoint;

    const auditContext = await createAuditContext(
      endpointWithAuditor as typeof this.endpoint,
      this.serviceDiscovery,
      logger,
      {
        session,
        header,
        cookie,
        services: ctx.services as Record<string, unknown>,
      },
    );

    // Warn if declarative audits are configured but no audit storage
    const audits = this.endpoint.audits as MappedAudit<
      TAuditAction,
      TOutSchema
    >[];
    if (!auditContext && audits?.length) {
      logger.warn('No auditor storage service available');
    }

    // Resolve database service if configured
    // The database is required when endpoint uses .database()
    const databaseService = (ctx as any).database as
      | Service<TDatabaseServiceName, TDatabase>
      | undefined;
    const rawDb = databaseService
      ? await this.serviceDiscovery
          .register([databaseService])
          .then((s) => s[databaseService.serviceName as keyof typeof s])
      : undefined;

    // Execute handler with automatic audit transaction support
    const result = await executeWithAuditTransaction(
      auditContext,
      async (auditor) => {
        // Use audit transaction as db only if the storage uses the same database service
        const sameDatabase =
          auditContext?.storage?.databaseServiceName &&
          auditContext.storage.databaseServiceName ===
            databaseService?.serviceName;
        const db = sameDatabase
          ? (auditor?.getTransaction?.() ?? rawDb)
          : rawDb;

        const responseBuilder = new ResponseBuilder();
        const response = await this.endpoint.handler(
          {
            body,
            query,
            params,
            session,
            services: ctx.services,
            logger,
            header,
            cookie,
            auditor,
            db,
          } as any,
          responseBuilder,
        );

        // Check if response has metadata
        let data = response;
        let metadata = responseBuilder.getMetadata();

        if (Endpoint.hasMetadata(response)) {
          data = response.data;
          metadata = response.metadata;
        }

        const output = await this.endpoint.parseOutput(data);

        return { output, metadata, responseBuilder };
      },
      // Process declarative audits after handler (inside transaction)
      async (result, auditor) => {
        if (!audits?.length) return;

        for (const audit of audits) {
          if (audit.when && !audit.when(result.output as any)) {
            continue;
          }
          const payload = audit.payload(result.output as any);
          const entityId = audit.entityId?.(result.output as any);
          auditor.audit(audit.type as any, payload as any, {
            table: audit.table,
            entityId,
          });
        }
      },
    );

    const { output, metadata } = result;

    ctx.publisher && (await this.serviceDiscovery.register([ctx.publisher]));
    await publishConstructEvents(this.endpoint, output, this.serviceDiscovery);

    // Convert cookies to Set-Cookie headers
    const headers: Record<string, string | string[]> = {
      ...(metadata.headers || {}),
    };

    if (metadata.cookies && metadata.cookies.size > 0) {
      const setCookieValues: string[] = [];
      for (const [name, cookie] of metadata.cookies.entries()) {
        setCookieValues.push(
          serializeCookie(name, cookie.value, cookie.options),
        );
      }
      headers['set-cookie'] = setCookieValues;
    }

    // Return HTTP response format
    return {
      body: output,
      status: metadata.status || 200,
      headers,
    };
  }

  async request(
    ctx: TestRequestAdaptor<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName
    >,
  ): Promise<InferStandardSchema<TOutSchema>> {
    const response = await this.fullRequest(ctx);
    return response.body;
  }
}

/**
 * Conditional audit storage requirement - required when TAuditStorage is configured
 */
type AuditStorageRequirement<
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
> = TAuditStorage extends undefined
  ? {}
  : {
      /** Audit storage service - required when endpoint uses .auditor() */
      auditorStorage: Service<TAuditStorageServiceName, TAuditStorage>;
    };

/**
 * Conditional database requirement - required when TDatabase is configured
 */
type DatabaseRequirement<
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> = TDatabase extends undefined
  ? {}
  : {
      /** Database service - required when endpoint uses .database() */
      database: Service<TDatabaseServiceName, TDatabase>;
    };

export type TestRequestAdaptor<
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> = {
  services: ServiceRecord<TServices>;
  headers: Record<string, string>;
  publisher?: Service<TEventPublisherServiceName, TEventPublisher>;
} & InferComposableStandardSchema<TInput> &
  AuditStorageRequirement<TAuditStorage, TAuditStorageServiceName> &
  DatabaseRequirement<TDatabase, TDatabaseServiceName>;
