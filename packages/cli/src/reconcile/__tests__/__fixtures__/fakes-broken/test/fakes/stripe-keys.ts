import { fake } from '@geekmidas/constructs/external-api';

/** An external API's fake, where a credential's belongs. */
export default fake.app(
	{ fetch: () => Response.json({ ok: true }) },
	{ credentials: {} },
);
