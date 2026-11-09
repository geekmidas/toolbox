export {
	isQueueResult,
	Queue,
	type QueueContext,
	type QueueHandler,
	type QueueMessage,
	type QueueRecord,
	type QueueResult,
} from './Queue';

import { QueueBuilder } from './QueueBuilder';

export { QueueBuilder } from './QueueBuilder';

export const q = new QueueBuilder();
