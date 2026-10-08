import { describe, expect } from 'vitest';
import { it } from '#test';

describe('plans', () => {
	it("serves the plans the database's seed wrote, which no request did", async ({
		browser,
	}) => {
		// `gkm test` migrates, then runs every seed — as a deploy does — so the
		// reference data is there before the first request.
		const { plans } = await browser.api.get('/plans');

		expect(plans).toEqual([
			{ id: 'free', name: 'Free', monthlyCents: 0 },
			{ id: 'team', name: 'Team', monthlyCents: 2_000 },
		]);
	});
});
