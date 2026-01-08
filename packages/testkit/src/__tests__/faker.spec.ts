import { beforeEach, describe, expect, it } from 'vitest';
import { faker } from '../faker';

describe('faker', () => {
	describe('sequence', () => {
		beforeEach(() => {
			faker.resetAllSequences();
		});

		it('should start from 1 for a new sequence', () => {
			expect(faker.sequence()).toBe(1);
			expect(faker.sequence('custom')).toBe(1);
		});

		it('should increment on each call', () => {
			expect(faker.sequence()).toBe(1);
			expect(faker.sequence()).toBe(2);
			expect(faker.sequence()).toBe(3);
		});

		it('should maintain separate counters for different names', () => {
			expect(faker.sequence('users')).toBe(1);
			expect(faker.sequence('posts')).toBe(1);
			expect(faker.sequence('users')).toBe(2);
			expect(faker.sequence('posts')).toBe(2);
			expect(faker.sequence('users')).toBe(3);
			expect(faker.sequence('posts')).toBe(3);
		});

		it('should handle concurrent-like sequential calls', () => {
			const results: number[] = [];
			for (let i = 0; i < 100; i++) {
				results.push(faker.sequence('concurrent'));
			}

			// Check that all values are unique and sequential
			expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
		});
	});

	describe('resetSequence', () => {
		beforeEach(() => {
			faker.resetAllSequences();
		});

		it('should reset a specific sequence to 0', () => {
			faker.sequence('test');
			faker.sequence('test');
			expect(faker.sequence('test')).toBe(3);

			faker.resetSequence('test');
			expect(faker.sequence('test')).toBe(1);
		});

		it('should reset a specific sequence to a custom value', () => {
			faker.sequence('test');
			faker.resetSequence('test', 10);
			expect(faker.sequence('test')).toBe(11);
		});

		it('should create a new sequence if it does not exist', () => {
			faker.resetSequence('new', 5);
			expect(faker.sequence('new')).toBe(6);
		});

		it('should not affect other sequences', () => {
			faker.sequence('test1');
			faker.sequence('test1');
			faker.sequence('test2');

			faker.resetSequence('test1');

			expect(faker.sequence('test1')).toBe(1);
			expect(faker.sequence('test2')).toBe(2);
		});
	});

	describe('resetAllSequences', () => {
		it('should reset all sequences', () => {
			faker.sequence('test1');
			faker.sequence('test1');
			faker.sequence('test2');
			faker.sequence('test2');
			faker.sequence('test2');

			faker.resetAllSequences();

			expect(faker.sequence('test1')).toBe(1);
			expect(faker.sequence('test2')).toBe(1);
			expect(faker.sequence()).toBe(1);
		});
	});

	describe('identifier', () => {
		beforeEach(() => {
			faker.resetAllSequences();
		});

		it('should include sequence number in identifier', () => {
			const id1 = faker.identifier();
			const id2 = faker.identifier();

			// Both should be different because of the sequence
			expect(id1).not.toBe(id2);

			// Should end with sequence numbers
			expect(id1).toMatch(/1$/);
			expect(id2).toMatch(/2$/);
		});

		it('should use custom suffix when provided', () => {
			const id = faker.identifier('customSuffix');
			expect(id).toMatch(/\.customSuffix$/);
		});
	});

	describe('timestamps', () => {
		it('should return createdAt and updatedAt dates', () => {
			const { createdAt, updatedAt } = faker.timestamps();

			expect(createdAt).toBeInstanceOf(Date);
			expect(updatedAt).toBeInstanceOf(Date);
			expect(createdAt.getTime()).toBeLessThanOrEqual(updatedAt.getTime());
			expect(updatedAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
		});

		it('should have milliseconds set to 0', () => {
			const { createdAt, updatedAt } = faker.timestamps();

			expect(createdAt.getMilliseconds()).toBe(0);
			expect(updatedAt.getMilliseconds()).toBe(0);
		});
	});

	describe('price', () => {
		it('should return a number', () => {
			const result = faker.price();
			expect(typeof result).toBe('number');
			expect(result).toBeGreaterThan(0);
		});
	});

	describe('coordinates', () => {
		const center = { lat: 40.7128, lng: -74.006 }; // New York City

		describe('within', () => {
			it('should generate a coordinate within the given radius', () => {
				const radius = 1000; // 1km
				const result = faker.coordinates.within(center, radius);

				expect(result).toHaveProperty('lat');
				expect(result).toHaveProperty('lng');
				expect(typeof result.lat).toBe('number');
				expect(typeof result.lng).toBe('number');

				// Calculate distance using Haversine formula
				const R = 6378137; // Earth's radius in meters
				const dLat = ((result.lat - center.lat) * Math.PI) / 180;
				const dLng = ((result.lng - center.lng) * Math.PI) / 180;
				const a =
					Math.sin(dLat / 2) * Math.sin(dLat / 2) +
					Math.cos((center.lat * Math.PI) / 180) *
						Math.cos((result.lat * Math.PI) / 180) *
						Math.sin(dLng / 2) *
						Math.sin(dLng / 2);
				const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
				const distance = R * c;

				expect(distance).toBeLessThanOrEqual(radius);
			});

			it('should generate different coordinates on multiple calls', () => {
				const radius = 1000;
				const results = Array.from({ length: 10 }, () =>
					faker.coordinates.within(center, radius),
				);

				// Not all results should be identical
				const uniqueLats = new Set(results.map((r) => r.lat));
				expect(uniqueLats.size).toBeGreaterThan(1);
			});
		});

		describe('outside', () => {
			it('should generate a coordinate outside the minimum radius', () => {
				const minRadius = 1000; // 1km
				const maxRadius = 5000; // 5km
				const result = faker.coordinates.outside(center, minRadius, maxRadius);

				expect(result).toHaveProperty('lat');
				expect(result).toHaveProperty('lng');
				expect(typeof result.lat).toBe('number');
				expect(typeof result.lng).toBe('number');

				// Calculate distance using Haversine formula
				const R = 6378137;
				const dLat = ((result.lat - center.lat) * Math.PI) / 180;
				const dLng = ((result.lng - center.lng) * Math.PI) / 180;
				const a =
					Math.sin(dLat / 2) * Math.sin(dLat / 2) +
					Math.cos((center.lat * Math.PI) / 180) *
						Math.cos((result.lat * Math.PI) / 180) *
						Math.sin(dLng / 2) *
						Math.sin(dLng / 2);
				const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
				const distance = R * c;

				expect(distance).toBeGreaterThanOrEqual(minRadius);
				expect(distance).toBeLessThanOrEqual(maxRadius);
			});

			it('should generate different coordinates on multiple calls', () => {
				const results = Array.from({ length: 10 }, () =>
					faker.coordinates.outside(center, 1000, 5000),
				);

				const uniqueLats = new Set(results.map((r) => r.lat));
				expect(uniqueLats.size).toBeGreaterThan(1);
			});

			it('should normalize longitude to valid range', () => {
				// Use a center near the antimeridian
				const pacificCenter = { lat: 0, lng: 179 };
				const result = faker.coordinates.outside(pacificCenter, 100000, 500000);

				expect(result.lng).toBeGreaterThanOrEqual(-180);
				expect(result.lng).toBeLessThanOrEqual(180);
			});
		});
	});
});
