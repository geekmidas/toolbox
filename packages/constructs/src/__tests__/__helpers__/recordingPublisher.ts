import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { vi } from 'vitest';
import type { Topic } from '../../topic/Topic';

/** A publisher that keeps what it was asked to publish, one array per call. */
export interface RecordingPublisher extends EventPublisher<any> {
	/** Every `publish(messages)` call, in order. */
	calls: PublishableMessage<string, unknown>[][];
	/** Every message across all calls, flattened. */
	readonly published: PublishableMessage<string, unknown>[];
}

export function recordingPublisher(): RecordingPublisher {
	const calls: PublishableMessage<string, unknown>[][] = [];

	return {
		calls,
		get published() {
			return calls.flat();
		},
		async publish(messages) {
			calls.push([...messages]);
		},
	};
}

/**
 * Stand a recorder in for a topic's transport: registering `topic.service`
 * hands back `publisher` instead of opening a broker connection.
 *
 * The connection string is the only part replaced — which topic, which
 * service name and which events stay the construct's own.
 */
export function recordTopic(
	topic: Topic<any, any>,
	publisher: RecordingPublisher = recordingPublisher(),
): RecordingPublisher {
	vi.spyOn(topic.service, 'register').mockResolvedValue(publisher as never);

	return publisher;
}
