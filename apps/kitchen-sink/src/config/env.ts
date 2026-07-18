import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

/**
 * The single source of environment config. `Credentials` is merged in so that
 * secrets injected by `gkm dev`/`gkm exec` (or decrypted at build time) are
 * visible here. Construct env requirements are *sniffed* from the services they
 * use — this parser is what those `get(...)` calls resolve against at runtime.
 */
export const envParser = new EnvironmentParser({
	...process.env,
	...Credentials,
});

export const config = envParser
	.create((get) => ({
		port: get('PORT').string().transform(Number).default(3000),
		nodeEnv: get('NODE_ENV').string().default('development'),
		database: {
			url: get('DATABASE_URL')
				.string()
				.default(
					'postgresql://geekmidas:geekmidas@localhost:5432/kitchen_sink',
				),
		},
	}))
	.parse();
