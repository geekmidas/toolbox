import type { EventEmitter } from 'node:events';
import type { EventPublisher, PublishableMessage } from '../types';

export class BasicPublisher<TMessage extends PublishableMessage<string, any>>
  implements EventPublisher<TMessage>
{
  constructor(readonly emitter: EventEmitter) {}

  async publish(messages: TMessage[]) {
    for (const message of messages) {
      this.emitter.emit(message.type, message);
    }
  }
}
