import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostPortTaken, takenHostPort, variableForHostPort } from './services';

describe('takenHostPort', () => {
	it('reads the port from the daemon wording', () => {
		const output =
			'Error response from daemon: driver failed programming external connectivity on endpoint geekmidas-toolbox-test-postgres-1: Bind for 0.0.0.0:5432 failed: port is already allocated';

		expect(takenHostPort(output)).toBe(5432);
	});

	it('reads the port from the kernel wording', () => {
		const output =
			'Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:5672 -> 127.0.0.1:0: listen tcp 0.0.0.0:5672: bind: address already in use';

		expect(takenHostPort(output)).toBe(5672);
	});

	it('reads an IPv6 bind', () => {
		expect(
			takenHostPort('listen tcp6 [::]:4566: bind: address already in use'),
		).toBe(4566);
	});

	it('is undefined for any other failure', () => {
		expect(
			takenHostPort('Cannot connect to the Docker daemon. Is it running?'),
		).toBeUndefined();
	});
});

describe('variableForHostPort', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('names the variable whose default is the port', () => {
		vi.stubEnv('LOCALSTACK_HOST_PORT', '');

		expect(variableForHostPort(4566)).toBe('LOCALSTACK_HOST_PORT');
	});

	it('names the variable an override moved onto the port', () => {
		vi.stubEnv('RABBITMQ_HOST_PORT', '34567');

		expect(variableForHostPort(34567)).toBe('RABBITMQ_HOST_PORT');
	});

	it('is undefined for a port the stack does not publish', () => {
		expect(variableForHostPort(1)).toBeUndefined();
	});
});

describe('HostPortTaken', () => {
	it('tells the developer which variable to set', () => {
		const error = new HostPortTaken(
			['postgres'],
			5432,
			'POSTGRES_HOST_PORT',
			'port is already allocated',
		);

		expect(error.name).toBe('HostPortTaken');
		expect(error.message).toContain('host port 5432 is already taken');
		expect(error.message).toContain('POSTGRES_HOST_PORT=25432');
	});

	it('points at the table when no variable matches', () => {
		const error = new HostPortTaken(['postgres'], 1, undefined, '');

		expect(error.message).toContain('*_HOST_PORT');
	});
});
