import type {
  AuditableAction,
  Auditor,
  AuditStorage,
} from '@geekmidas/audit';
import { DefaultAuditor } from '@geekmidas/audit';
import { EnvironmentParser } from '@geekmidas/envkit';
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
import type { Function } from './Function';
import { FunctionBuilder } from './FunctionBuilder';

export class TestFunctionAdaptor<
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
  static getDefaultServiceDiscovery<
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
  >(
    fn: Function<
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
      any
    >,
  ) {
    return ServiceDiscovery.getInstance(fn.logger, new EnvironmentParser({}));
  }

  constructor(
    private readonly fn: Function<
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
      any
    >,
    private serviceDiscovery: ServiceDiscovery<
      any,
      any
    > = TestFunctionAdaptor.getDefaultServiceDiscovery(fn),
  ) {}

  async invoke(
    ctx: TestFunctionRequest<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName,
      TDatabase,
      TAuditAction
    >,
  ): Promise<InferStandardSchema<TOutSchema>> {
    // Parse input if schema is provided

    const parsedInput = await FunctionBuilder.parseComposableStandardSchema(
      ctx.input,
      this.fn.input,
    );

    // Create logger with context
    const logger = this.fn.logger.child({
      test: true,
    }) as TLogger;

    // Register services (use provided services or register from function)
    let services: ServiceRecord<TServices>;
    if (ctx.services) {
      services = ctx.services;
    } else {
      services = await this.serviceDiscovery.register(this.fn.services);
    }

    // Resolve database (use provided db or register from function)
    let db: TDatabase | undefined;
    if ('db' in ctx && ctx.db !== undefined) {
      db = ctx.db;
    } else if (this.fn.databaseService) {
      const dbServices = await this.serviceDiscovery.register([
        this.fn.databaseService,
      ]);
      db = dbServices[
        this.fn.databaseService.serviceName as keyof typeof dbServices
      ] as TDatabase;
    }

    // Resolve auditor (use provided auditor or create from function)
    let auditor: Auditor<TAuditAction> | undefined;
    if ('auditor' in ctx && ctx.auditor !== undefined) {
      auditor = ctx.auditor;
    } else if (this.fn.auditorStorageService) {
      const auditServices = await this.serviceDiscovery.register([
        this.fn.auditorStorageService,
      ]);
      const storage = auditServices[
        this.fn.auditorStorageService.serviceName as keyof typeof auditServices
      ] as AuditStorage;

      auditor = new DefaultAuditor<TAuditAction>({
        actor: { id: 'system', type: 'system' },
        storage,
        metadata: {
          function: this.fn.type,
          test: true,
        },
      });
    }

    // Execute the function
    const response = await this.fn['fn']({
      input: parsedInput,
      services,
      logger,
      db,
      auditor,
    } as any);

    // Parse output if schema is provided
    const output = await this.fn.parseOutput(response);

    // Flush audits if any were recorded
    if (auditor) {
      const records = auditor.getRecords();
      if (records.length > 0) {
        logger.debug({ auditCount: records.length }, 'Flushing function audits');
        await auditor.flush();
      }
    }

    // Register publisher service if provided in context

    await publishEvents(
      logger,
      this.serviceDiscovery,
      this.fn.events,
      output,
      this.fn.publisherService,
    );

    return output;
  }
}

export type TestFunctionRequest<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TDatabase = undefined,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> = {
  input: InferComposableStandardSchema<TInput>;
  services: ServiceRecord<TServices>;
  publisher?: Service<TEventPublisherServiceName, TEventPublisher>;
  db?: TDatabase;
  auditor?: Auditor<TAuditAction>;
} & InferComposableStandardSchema<{ input: TInput }>;
