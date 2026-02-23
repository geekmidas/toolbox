import type { Construct } from '@geekmidas/constructs';
import { describe, expect, it } from 'vitest';
import type { GeneratedConstruct } from '../../generators/Generator';
import {
	DEFAULT_PARTITION,
	groupByPartition,
	groupInfosByPartition,
	hasPartitions,
} from '../partitions';

function makeConstruct(
	name: string,
	partition?: string,
): GeneratedConstruct<Construct> {
	return {
		key: name,
		name,
		construct: {} as Construct,
		path: { absolute: `/src/${name}.ts`, relative: `src/${name}.ts` },
		partition,
	};
}

describe('groupByPartition', () => {
	it('should group all constructs into default when no partition set', () => {
		const constructs = [makeConstruct('a'), makeConstruct('b')];
		const groups = groupByPartition(constructs);

		expect(groups.size).toBe(1);
		expect(groups.get(DEFAULT_PARTITION)).toHaveLength(2);
	});

	it('should group constructs by partition name', () => {
		const constructs = [
			makeConstruct('a', 'admin'),
			makeConstruct('b', 'public'),
			makeConstruct('c', 'admin'),
		];
		const groups = groupByPartition(constructs);

		expect(groups.size).toBe(2);
		expect(groups.get('admin')).toHaveLength(2);
		expect(groups.get('public')).toHaveLength(1);
	});

	it('should handle mix of partitioned and un-partitioned', () => {
		const constructs = [
			makeConstruct('a', 'admin'),
			makeConstruct('b'), // no partition → default
			makeConstruct('c', 'admin'),
		];
		const groups = groupByPartition(constructs);

		expect(groups.size).toBe(2);
		expect(groups.get('admin')).toHaveLength(2);
		expect(groups.get(DEFAULT_PARTITION)).toHaveLength(1);
	});

	it('should return empty map for empty input', () => {
		const groups = groupByPartition([]);
		expect(groups.size).toBe(0);
	});
});

describe('hasPartitions', () => {
	it('should return false when no constructs have partitions', () => {
		const constructs = [makeConstruct('a'), makeConstruct('b')];
		expect(hasPartitions(constructs)).toBe(false);
	});

	it('should return true when any construct has a partition', () => {
		const constructs = [makeConstruct('a', 'admin'), makeConstruct('b')];
		expect(hasPartitions(constructs)).toBe(true);
	});

	it('should return false for empty array', () => {
		expect(hasPartitions([])).toBe(false);
	});
});

describe('groupInfosByPartition', () => {
	it('should group infos matching construct partitions', () => {
		const constructs = [
			makeConstruct('a', 'admin'),
			makeConstruct('b', 'public'),
			makeConstruct('c', 'admin'),
		];
		const infos = [
			{ name: 'a', handler: 'a.handler' },
			{ name: 'b', handler: 'b.handler' },
			{ name: 'c', handler: 'c.handler' },
		];

		const grouped = groupInfosByPartition(infos, constructs);

		expect(grouped.admin).toHaveLength(2);
		expect(grouped.public).toHaveLength(1);
		expect(grouped.admin![0]).toEqual({ name: 'a', handler: 'a.handler' });
		expect(grouped.admin![1]).toEqual({ name: 'c', handler: 'c.handler' });
	});

	it('should use default partition for un-partitioned constructs', () => {
		const constructs = [makeConstruct('a'), makeConstruct('b')];
		const infos = [{ name: 'a' }, { name: 'b' }];

		const grouped = groupInfosByPartition(infos, constructs);

		expect(grouped[DEFAULT_PARTITION]).toHaveLength(2);
	});
});
