import type { EnvironmentParser } from '@geekmidas/envkit';
import { EventConnectionFactory, Publisher } from '@geekmidas/events';

let instance: {} | null = null;

export const DummyService = {
	serviceName: 'dummy' as const,
	register(envParser: EnvironmentParser<{}>): any {
		// Create the config parser - this tracks environment variables
		const configParser = envParser.create((get) => ({
			connectionString: get('DUMMY_CONNECTION_STRING').string(),
		}));

		// For environment detection (when env is empty), return ConfigParser
		// This allows build-time detection without needing actual env values
		// @ts-ignore - accessing internal property to detect sniffer
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
} as const;
