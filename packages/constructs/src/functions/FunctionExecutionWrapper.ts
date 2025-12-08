import type { AuditStorage, AuditableAction, Auditor } from '@geekmidas/audit';
import { DefaultAuditor } from '@geekmidas/audit';
import { withAuditableTransaction } from '@geekmidas/audit/kysely';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { publishEvents } from '../publisher';
import type { Function, FunctionHandler } from './Function';
import { FunctionBuilder } from './FunctionBuilder';

export abstract class FunctionExecutionWrapper<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> {
  constructor(
    protected envParser: EnvironmentParser<{}>,
    protected readonly fn: Function<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction,
      FunctionHandler<
        TInput,
        TServices,
        TLogger,
        TOutSchema,
        TDatabase,
        TAuditStorage,
        TAuditAction
      >
    >,
  ) {}

  protected _logger?: TLogger;

  get logger(): TLogger {
    return this._logger || this.fn.logger;
  }

  get serviceDiscovery(): ServiceDiscovery<ServiceRecord<TServices>, Logger> {
    const serviceDiscovery = ServiceDiscovery.getInstance<
      ServiceRecord<TServices>,
      TLogger
    >(this.logger, this.envParser);

    return serviceDiscovery;
  }

  getServices(): Promise<ServiceRecord<TServices>> {
    return this.serviceDiscovery.register(this.fn.services);
  }

  async getDatabase(): Promise<TDatabase | undefined> {
    if (!this.fn.databaseService) {
      return undefined;
    }

    const services = await this.serviceDiscovery.register([
      this.fn.databaseService,
    ]);

    return services[
      this.fn.databaseService.serviceName as keyof typeof services
    ] as TDatabase;
  }

  /**
   * Get the audit storage service if configured.
   * Returns undefined if no auditor storage is configured.
   */
  async getAuditStorage(): Promise<TAuditStorage | undefined> {
    if (!this.fn.auditorStorageService) {
      return undefined;
    }

    const services = await this.serviceDiscovery.register([
      this.fn.auditorStorageService,
    ]);

    return services[
      this.fn.auditorStorageService.serviceName as keyof typeof services
    ] as TAuditStorage;
  }

  /**
   * Create an auditor instance for the function.
   * Returns undefined if no auditor storage is configured.
   */
  async createAuditor(): Promise<Auditor<TAuditAction> | undefined> {
    const storage = await this.getAuditStorage();
    if (!storage) {
      return undefined;
    }

    return new DefaultAuditor<TAuditAction>({
      actor: { id: 'system', type: 'system' },
      storage: storage as AuditStorage,
      metadata: {
        function: this.fn.type,
      },
    });
  }

  /**
   * Execute handler with audit transaction support.
   * If the audit storage has a database (via getDatabase()), wraps execution
   * in a transaction so audits are atomic with handler's database operations.
   *
   * @param handler - The handler function to execute (receives auditor and db)
   * @returns The handler result
   */
  async executeWithAudit<T>(
    handler: (ctx: {
      auditor?: Auditor<TAuditAction>;
      db?: TDatabase;
    }) => Promise<T>,
  ): Promise<T> {
    const auditor = await this.createAuditor();
    const storage = await this.getAuditStorage();

    // No audit context - just run handler with regular db
    if (!auditor || !storage) {
      const db = await this.getDatabase();
      return handler({ db });
    }

    // Check if storage has a database and db service names match
    const storageDb = (storage as AuditStorage).getDatabase?.();
    const databaseServiceName = this.fn.databaseService?.serviceName;
    const auditDbServiceName = this.fn.auditorStorageService?.serviceName;

    // If the audit storage has a database and we're using the same database service
    // (or the audit storage provides the database), use transactional execution
    if (storageDb && databaseServiceName && auditDbServiceName) {
      return withAuditableTransaction(
        storageDb as any,
        auditor as any,
        async (trx) => {
          // Use transaction as db
          const response = await handler({
            auditor,
            db: trx as TDatabase,
          });
          // Audits are flushed by withAuditableTransaction before commit
          return response;
        },
      );
    }

    // No database on storage or service names don't match - run handler and flush audits after
    const db = await this.getDatabase();
    const response = await handler({ auditor, db });

    // Flush audits (no transaction)
    await auditor.flush();

    return response;
  }

  async getFunctionInput<TEvent>(
    event: TEvent,
  ): Promise<InferComposableStandardSchema<TInput>> {
    const parsedInput = await FunctionBuilder.parseComposableStandardSchema(
      event,
      this.fn.input,
    );

    return parsedInput as InferComposableStandardSchema<TInput>;
  }

  async publishEvents(response: InferStandardSchema<TOutSchema>) {
    await publishEvents(
      this.logger,
      this.serviceDiscovery,
      this.fn.events,
      response,
      this.fn.publisherService,
    );
  }

  async parseComposableStandardSchema<T extends ComposableStandardSchema>(
    data: unknown,
    schema: T,
  ): Promise<InferComposableStandardSchema<T>> {
    return FunctionBuilder.parseComposableStandardSchema(data, schema);
  }
}
