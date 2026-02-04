import { c } from '@geekmidas/constructs/crons';

/**
 * Example cron that generates a daily report at 9 AM UTC
 */
export const dailyReport = c
	.schedule('cron(0 9 * * ? *)')
	.timeout(600000) // 10 minutes
	.handle(async ({ logger }) => {
		logger.info('Generating daily report');

		const reportDate = new Date().toISOString().split('T')[0];

		// Generate report logic here
		const reportData = {
			date: reportDate,
			totalOrders: 150,
			totalRevenue: 12500.0,
			topProducts: [
				{ id: 'prod-1', name: 'Widget A', sales: 45 },
				{ id: 'prod-2', name: 'Widget B', sales: 32 },
			],
		};

		logger.info(reportData, 'Daily report generated');

		return reportData;
	});

/**
 * Example cron that runs every hour
 */
export const hourlyCleanup = c
	.schedule('rate(1 hour)')
	.timeout(300000) // 5 minutes
	.handle(async ({ logger }) => {
		logger.info('Running hourly cleanup');

		// Cleanup logic here
		const itemsCleaned = 42;

		logger.info(`Cleaned ${itemsCleaned} items`);

		return { itemsCleaned };
	});
