import { EnvironmentParser } from '@geekmidas/envkit';
import { ConsoleLogger } from '@geekmidas/logger/console';
import {
	type Service,
	ServiceDiscovery,
	serviceContext,
} from '@geekmidas/services';
import { afterEach, describe, expect, test } from 'vitest';
import {
	requestContextFixture,
	runInRequestContext,
	withRequestContext,
} from '../requestContext';

describe('runInRequestContext', () => {
	test('runs callback inside request context with defaults', async () => {
		expect(serviceContext.hasContext()).toBe(false);

		const result = await runInRequestContext(() => {
			expect(serviceContext.hasContext()).toBe(true);
			expect(typeof serviceContext.getRequestId()).toBe('string');
			expect(typeof serviceContext.getRequestStartTime()).toBe('number');
			return 'ok';
		});

		expect(result).toBe('ok');
		expect(serviceContext.hasContext()).toBe(false);
	});

	test('uses caller-supplied logger and request id', async () => {
		const logger = new ConsoleLogger({ app: 'spec' });
		const startTime = Date.now();

		await runInRequestContext(
			() => {
				expect(serviceContext.getLogger()).toBe(logger);
				expect(serviceContext.getRequestId()).toBe('req-42');
				expect(serviceContext.getRequestStartTime()).toBe(startTime);
			},
			{ logger, requestId: 'req-42', startTime },
		);
	});

	test('lets services that consume context register successfully', async () => {
		(ServiceDiscovery as unknown as { _instance?: unknown })._instance =
			undefined;
		const envParser = new EnvironmentParser({ ...process.env });

		const recorded: { requestId?: string } = {};
		const recordingService = {
			serviceName: 'recorder' as const,
			register({ context }) {
				recorded.requestId = context.getRequestId();
				return { recorded };
			},
		} satisfies Service<'recorder', { recorded: typeof recorded }>;

		await runInRequestContext(
			async () => {
				const discovery = ServiceDiscovery.getInstance(envParser);
				await discovery.register([recordingService]);
			},
			{ requestId: 'from-test' },
		);

		expect(recorded.requestId).toBe('from-test');
	});
});

describe('requestContextFixture', () => {
	const itWithCtx = test.extend({
		...requestContextFixture({ requestId: 'fixture-req' }),
	});

	itWithCtx(
		'exposes serviceContext via fixture',
		async ({ requestContext }) => {
			expect(requestContext.getRequestId()).toBe('fixture-req');
			expect(serviceContext.getRequestId()).toBe('fixture-req');
		},
	);

	itWithCtx(
		'runs the test body inside the ALS even without destructuring',
		() => {
			// `auto: true` means we get context here even though we didn't ask for it
			expect(serviceContext.hasContext()).toBe(true);
		},
	);
});

describe('withRequestContext', () => {
	const itWithCtx = withRequestContext(test, { requestId: 'wrapped-req' });

	itWithCtx('wraps an existing TestAPI', () => {
		expect(serviceContext.hasContext()).toBe(true);
		expect(serviceContext.getRequestId()).toBe('wrapped-req');
	});
});

describe('isolation between tests', () => {
	afterEach(() => {
		expect(serviceContext.hasContext()).toBe(false);
	});

	test('does not leak context outside runInRequestContext', async () => {
		await runInRequestContext(() => undefined);
	});
});
