import { Topic } from '@geekmidas/constructs/topic';
import type { BuildContext } from '../build/types';
import type { TopicInfo } from '../types';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

/**
 * Discovers `t` topics into `manifest.topics`. A topic is a *resource*, not a
 * function — it has no handler to generate. Producers reach it via its derived
 * publisher (`topic.publisher`, whose connection string is sniffed onto the
 * producing construct) and subscribers bind via `s.topic(topic)`; this generator
 * only records the topic + its event contract so infra can provision the SNS
 * topic. Identical output for every provider (locally pg-boss routes by event
 * name, so there's nothing to run).
 */
export class TopicGenerator extends ConstructGenerator<
	Topic<any, any>,
	TopicInfo[]
> {
	isConstruct(value: any): value is Topic<any, any> {
		return Topic.isTopic(value);
	}

	async build(
		_context: BuildContext,
		constructs: GeneratedConstruct<Topic<any, any>>[],
		_outputDir: string,
		_options?: GeneratorOptions,
	): Promise<TopicInfo[]> {
		const logger = console;
		const topicInfos = constructs.map(({ construct }) => ({
			name: construct.name,
			events: construct.eventTypes,
		}));

		for (const topic of topicInfos) {
			logger.log(`Discovered topic: ${topic.name}`);
		}

		return topicInfos;
	}
}
