import { basicEventsDriver } from '../../basic/driver';
import { pgbossEventsDriver } from '../../pgboss/driver';
import { rabbitmqEventsDriver } from '../../rabbitmq/driver';
import { registerEventsDriver } from '../../registry';
import { snsEventsDriver } from '../../sns/driver';
import { sqsEventsDriver } from '../../sqs/driver';

/**
 * Every broker's driver, registered — what a spec of the generic factories
 * needs, as an entry point registers the one its target uses.
 */
export function registerAllEventsDrivers(): void {
	for (const driver of [
		basicEventsDriver,
		pgbossEventsDriver,
		rabbitmqEventsDriver,
		snsEventsDriver,
		sqsEventsDriver,
	]) {
		registerEventsDriver(driver);
	}
}

/**
 * Forget every registered driver — a spec of the registry itself starts from
 * what a process that registered nothing has.
 */
export function clearEventsDrivers(): void {
	(globalThis as { [key: symbol]: Map<string, unknown> | undefined })[
		Symbol.for('@geekmidas/events/drivers')
	]?.clear();
}
