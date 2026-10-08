import { consumeTraced, type TraceCarrier } from '../telemetry';
import type { EventSubscriber, PublishableMessage } from '../types';
import type { BasicConnection } from './BasicConnection';

export class BasicSubscriber<TMessage extends PublishableMessage<string, any>>
	implements EventSubscriber<TMessage>
{
	constructor(private connection: BasicConnection) {}

	async subscribe(
		messages: TMessage['type'][],
		listener: (payload: TMessage) => Promise<void>,
	): Promise<void> {
		const emitter = this.connection.eventEmitter;

		for (const messageType of messages) {
			emitter.on(messageType, (message: TMessage, carrier?: TraceCarrier) => {
				consumeTraced(
					{ system: 'basic', destination: messageType, type: messageType },
					carrier,
					() => listener(message),
				).catch((_error) => {});
			});
		}
	}
}
