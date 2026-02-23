import type { Construct } from '@geekmidas/constructs';
import type { GeneratedConstruct } from '../generators/Generator';

export const DEFAULT_PARTITION = 'default';

/**
 * Group constructs by their partition field.
 * Constructs without a partition are placed in the 'default' group.
 */
export function groupByPartition<T extends Construct>(
	constructs: GeneratedConstruct<T>[],
): Map<string, GeneratedConstruct<T>[]> {
	const groups = new Map<string, GeneratedConstruct<T>[]>();

	for (const construct of constructs) {
		const partition = construct.partition ?? DEFAULT_PARTITION;
		const group = groups.get(partition);
		if (group) {
			group.push(construct);
		} else {
			groups.set(partition, [construct]);
		}
	}

	return groups;
}

/**
 * Check if any construct across the given arrays has a non-undefined partition.
 * When true, the manifest should use the partitioned shape for that construct type.
 */
export function hasPartitions<T extends Construct>(
	constructs: GeneratedConstruct<T>[],
): boolean {
	return constructs.some((c) => c.partition !== undefined);
}

/**
 * Group an info array by partition, using the partition values from
 * the corresponding construct array. Both arrays must be the same length
 * and in the same order.
 */
export function groupInfosByPartition<T>(
	infos: T[],
	constructs: GeneratedConstruct<any>[],
): Record<string, T[]> {
	const groups: Record<string, T[]> = {};

	for (let i = 0; i < infos.length; i++) {
		const partition = constructs[i]?.partition ?? DEFAULT_PARTITION;
		if (!groups[partition]) {
			groups[partition] = [];
		}
		groups[partition].push(infos[i]!);
	}

	return groups;
}
