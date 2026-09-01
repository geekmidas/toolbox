import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import { cloneWith } from '../clone';
import { Topic, type TopicEvents } from './Topic';

/**
 * Builds a {@link Topic} — `t.topic('users').events({ 'user.created': schema, … })`.
 * The event map is the topic's contract: it types the derived `topic.publisher`
 * and the subscribers that bind via `s.topic(topic)`.
 */
export class TopicBuilder<
	TName extends string = string,
	TEvents extends TopicEvents = TopicEvents,
> {
	private _name?: string;
	private _logger: Logger = DEFAULT_LOGGER;

	/** The topic name — drives the infra topic and its `<NAME>_*` env vars. */
	topic<T extends string>(name: T): TopicBuilder<T, TEvents> {
		return cloneWith(this, { _name: name }) as unknown as TopicBuilder<
			T,
			TEvents
		>;
	}

	logger(logger: Logger): this {
		return cloneWith(this, { _logger: logger });
	}

	/**
	 * The event contract — a map of event type → payload schema. Building the
	 * topic requires this; it's what types the publisher and subscribers.
	 */
	events<T extends TopicEvents>(events: T): Topic<TName, T> {
		if (!this._name) {
			throw new Error(
				'Topic requires a name — call .topic(name) before .events().',
			);
		}

		const topic = new Topic<TName, T>(
			this._name as TName,
			events,
			this._logger,
		);

		// No reset. `.events()` reads this builder and leaves it alone, so a
		// configured base stays usable for the next topic — and two chains off one
		// base cannot feed each other.
		return topic;
	}
}
