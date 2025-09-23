import { EventEmitter } from 'node:events';
import type { PublishableMessage } from './events';

export class EventSystem<TMessage extends PublishableMessage<string, any>> {
  private emitter = new EventEmitter();

  subscribe<TEvent extends TMessage>(
    type: TEvent['type'],
    listener: (payload: TEvent) => Promise<void>,
  ) {
    this.emitter.on(type, listener);
  }

  async publish(messages: TMessage[]) {
    for (const message of messages) {
      this.emitter.emit(message.type, message);
    }
  }
}
