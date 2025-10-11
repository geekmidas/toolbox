import type { PublishableMessage } from './types';

export class EventPublisher<TMessage extends PublishableMessage<string, any>> {}
