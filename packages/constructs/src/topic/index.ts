export {
	Topic,
	type TopicEvents,
	type TopicMessage,
} from './Topic';

import { TopicBuilder } from './TopicBuilder';

export { TopicBuilder } from './TopicBuilder';

export const t = new TopicBuilder();
