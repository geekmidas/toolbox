import { fake } from '@geekmidas/constructs/external-api';
import { Hono } from 'hono';

// What the fake shares with a test: read through `fake(carrier)`.
export const asked: string[] = [];

export default fake.app(
	new Hono().post('/quotes', (c) => {
		asked.push('quote');
		return c.json({ amount: 1 });
	}),
	{ credentials: { key: 'fake' } },
);
