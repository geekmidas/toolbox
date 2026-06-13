export {
	Queue,
	type QueueContext,
	type QueueHandler,
} from './Queue';

import { QueueBuilder } from './QueueBuilder';

export { QueueBuilder } from './QueueBuilder';

export const q = new QueueBuilder();
