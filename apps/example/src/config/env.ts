import { EnvironmentParser } from '@geekmidas/envkit';

const testExchange = 'geekmidas_events_example';

export const envParser = new EnvironmentParser({
	...process.env,
	EVENT_SUBSCRIBER_CONNECTION_STRING: `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=true`,
});

export const config = envParser
	.create((get) => ({
		port: get('PORT').string().transform(Number).default(3000),
		nodeEnv: get('NODE_ENV').string().default('development'),
		database: {
			url: get('DATABASE_URL')
				.string()
				.default('postgresql://geekmidas:geekmidas@localhost:5432/examples'),
		},
	}))
	.parse();
