import type { EventPublisher, PublishableMessage } from '../types';
import type { BasicConnection } from './BasicConnection';

export class BasicPublisher<TMessage extends PublishableMessage<string, any>>
  implements EventPublisher<TMessage>
{
  constructor(private connection: BasicConnection) {}

  async publish(messages: TMessage[]) {
    const emitter = this.connection.eventEmitter;
    for (const message of messages) {
      emitter.emit(message.type, message);
    }
  }
}
