import { ConsoleLogger } from '@geekmidas/logger/console';

// Create a console logger instance
export const logger = new ConsoleLogger({
	level: process.env.LOG_LEVEL || 'info',
	pretty: process.env.NODE_ENV !== 'production',
});

// You can also export a default logger
export default logger;
