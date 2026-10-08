import { publishTraced } from '../telemetry';
import type { EventPublisher, PublishableMessage } from '../types';
import type { BasicConnection } from './BasicConnection';

export class BasicPublisher<TMessage extends PublishableMessage<string, any>>
	implements EventPublisher<TMessage>
{
	constructor(private connection: BasicConnection) {}

	async publish(messages: TMessage[]) {
		const emitter = this.connection.eventEmitter;
		// The trace context rides beside the message, as the emitter's second
		// argument, so the message a listener receives is the one published.
		await publishTraced(
			messages,
			(message) => ({
				system: 'basic',
				destination: message.type,
				type: message.type,
			}),
			async (carriers) => {
				messages.forEach((message, i) => {
					emitter.emit(message.type, message, carriers[i]);
				});
			},
		);
	}
}
