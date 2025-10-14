import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export abstract class Construct<
  TLogger extends Logger = Logger,
  TServiceName extends string = string,
  T extends EventPublisher<any> | undefined = undefined,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> {
  constructor(
    public readonly type: ConstructType,
    public readonly logger: TLogger,
    public readonly events: MappedEvent<T, any>[] = [],
    public readonly publisherService?: Service<TServiceName, T>,
    public outputSchema?: OutSchema,
  ) {}
}

export enum ConstructType {
  Cron = 'dev.geekmidas.function.cron',
  Endpoint = 'dev.geekmidas.function.endpoint',
  Function = 'dev.geekmidas.function.function',
  Subscriber = 'dev.geekmidas.function.subscriber',
}
