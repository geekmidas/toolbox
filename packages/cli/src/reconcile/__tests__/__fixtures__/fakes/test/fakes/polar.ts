import { fake } from '@geekmidas/constructs/external-api';

export default fake.app(
	{ fetch: () => Response.json({ ok: true }) },
	{ credentials: { clientId: 'fake', clientSecret: 'fake' } },
);
