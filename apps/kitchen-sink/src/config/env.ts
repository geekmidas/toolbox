import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

/**
 * The single source of environment config. `Credentials` is merged in so that
 * what `gkm dev`/`gkm exec` injected — every URL the constructs declared, plus
 * the secrets — is visible here.
 *
 * Nothing about infrastructure is read below any more. A construct declares its
 * own key and reads it when its client is built, so `DATABASE_URL`,
 * `UPLOADS_URL`, `MAIL_URL` and the broker strings never appear in application
 * config. What is left is what genuinely belongs to the process.
 */
export const envParser = new EnvironmentParser({
	...process.env,
	...Credentials,
});

export const config = envParser
	.create((get) => ({
		port: get('PORT').string().transform(Number).default(3000),
		nodeEnv: get('NODE_ENV').string().default('development'),
	}))
	.parse();
