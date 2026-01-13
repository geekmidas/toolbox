import { EventConnectionFactory, Publisher } from '@geekmidas/events';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';

let instance: {} | null = null;

export const DummyService = {
	serviceName: 'dummy' as const,
	register(ctx: ServiceRegisterOptions): {} {
		// Create the config parser - this tracks environment variables
		const configParser = ctx.envParser.create((get) => ({
			connectionString: get('DUMMY_CONNECTION_STRING').string(),
		}));

		// For environment detection (when env is empty), return ConfigParser
		// This allows build-time detection without needing actual env values
		// @ts-expect-error - accessing internal property to detect sniffer
		const envData = envParser.env || {};
		if (Object.keys(envData).length === 0) {
			return configParser;
		}

		// Runtime: return a promise that resolves to the service instance
		return (async () => {
			if (!instance) {
				const config = configParser.parse();
				const connection = await EventConnectionFactory.fromConnectionString(
					config.connectionString,
				);
				instance = await Publisher.fromConnection(connection);
			}
			return instance;
		})();
	},
} satisfies Service<'dummy', {}>;
