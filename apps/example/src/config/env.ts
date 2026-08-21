import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

const testExchange = 'geekmidas_events_example';

export const envParser = new EnvironmentParser({
	...process.env,
	EVENT_SUBSCRIBER_CONNECTION_STRING: `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=true`,
	...Credentials,
});

export const config = envParser
	.create((get) => ({
		port: get('PORT').string().transform(Number).default(3000),
		nodeEnv: get('NODE_ENV').string().default('development'),
		database: {
			// Provided by the `Example` database construct — `gkm dev` and
			// `gkm exec` inject it from the container they reconciled, so the port
			// is whatever was free rather than whatever was hard-coded.
			url: get('EXAMPLE_URL')
				.string()
				.default('postgres://geekmidas:geekmidas@localhost:5432/example'),
		},
	}))
	.parse();
