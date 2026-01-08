/**
 * Build-Time Optimization Benchmarks
 *
 * Compares:
 * - Raw Hono (baseline)
 * - HonoEndpoint.addRoutes (current runtime approach)
 * - Build-time generated inline handlers (Phase 2 optimization)
 *
 * Run with: pnpm bench packages/constructs/src/__benchmarks__/build-time-optimization.bench.ts
 */
import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { bench, describe } from 'vitest';
import { Endpoint, ResponseBuilder } from '../endpoints';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';
import {
	authEndpoint,
	mockLogger,
	postEndpoint,
	simpleEndpoint,
} from './fixtures';

const envParser = new EnvironmentParser({});

// ============================================================================
// Build-Time Generated Style: Validator Factories (reusable)
// ============================================================================

const validateBody = (endpoint: any) =>
	validator('json', async (value, c) => {
		if (!endpoint.input?.body) return undefined;
		const parsed = await Endpoint.validate(endpoint.input.body, value);
		if (parsed.issues) return c.json(parsed.issues, 422);
		return parsed.value;
	});

const validateQuery = (endpoint: any) =>
	validator('query', async (_, c) => {
		if (!endpoint.input?.query) return undefined;
		const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
		const parsed = await Endpoint.validate(endpoint.input.query, rawQuery);
		if (parsed.issues) return c.json(parsed.issues, 422);
		return parsed.value;
	});

// ============================================================================
// App Setup: Raw Hono (baseline)
// ============================================================================

const rawHonoApp = new Hono();
rawHonoApp.get('/health', (c) =>
	c.json({ status: 'ok', timestamp: Date.now() }),
);

// ============================================================================
// App Setup: HonoEndpoint.addRoutes (current runtime approach)
// ============================================================================

const runtimeApp = new Hono();
const runtimeServiceDiscovery = ServiceDiscovery.getInstance(
	mockLogger,
	envParser,
);
HonoEndpoint.addRoutes(
	[simpleEndpoint] as any,
	runtimeServiceDiscovery as any,
	runtimeApp,
);

// ============================================================================
// App Setup: Build-Time Generated Minimal Handler
// ============================================================================

const buildTimeMinimalApp = new Hono();
// Simulates generated code for minimal-tier endpoint (no auth, no services)
buildTimeMinimalApp.get('/health', async (c) => {
	const result = await simpleEndpoint.handler(
		{
			services: {},
			logger: mockLogger,
			body: undefined,
			query: undefined,
			params: undefined,
			session: undefined,
			header: Endpoint.createHeaders(c.req.header()),
			cookie: Endpoint.createCookies(c.req.header().cookie),
			auditor: undefined,
			db: undefined,
		} as any,
		{ getMetadata: () => ({}) } as any,
	);
	return c.json(result, simpleEndpoint.status as any);
});

// ============================================================================
// App Setup: Build-Time Generated Standard Handler (with auth)
// ============================================================================

const buildTimeStandardApp = new Hono();
const standardServiceDiscovery = ServiceDiscovery.getInstance(
	mockLogger,
	envParser,
);

// Simulates generated code for standard-tier endpoint (auth + services)
buildTimeStandardApp.get('/profile', async (c) => {
	const headerValues = c.req.header();
	const header = Endpoint.createHeaders(headerValues);
	const cookie = Endpoint.createCookies(headerValues.cookie);

	const services = await standardServiceDiscovery.register(
		authEndpoint.services,
	);

	// Authentication
	const session = await authEndpoint.getSession({
		services,
		logger: mockLogger,
		header,
		cookie,
	} as any);

	const isAuthorized = await authEndpoint.authorize({
		header,
		cookie,
		services,
		logger: mockLogger,
		session,
	} as any);

	if (!isAuthorized) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const responseBuilder = new ResponseBuilder();
	const result = await authEndpoint.handler(
		{
			services,
			logger: mockLogger,
			body: undefined,
			query: undefined,
			params: undefined,
			session,
			header,
			cookie,
			auditor: undefined,
			db: undefined,
		} as any,
		responseBuilder,
	);

	const status = (responseBuilder.getMetadata().status ??
		authEndpoint.status) as any;
	return c.json(result, status);
});

// Runtime version of auth endpoint for comparison
const runtimeAuthApp = new Hono();
HonoEndpoint.addRoutes(
	[authEndpoint] as any,
	standardServiceDiscovery as any,
	runtimeAuthApp,
);

// ============================================================================
// App Setup: Build-Time Generated with Body Validation
// ============================================================================

const buildTimeBodyApp = new Hono();
const bodyServiceDiscovery = ServiceDiscovery.getInstance(
	mockLogger,
	envParser,
);

// Simulates generated code with body validation
buildTimeBodyApp.post('/users', validateBody(postEndpoint), async (c) => {
	const headerValues = c.req.header();
	const header = Endpoint.createHeaders(headerValues);
	const cookie = Endpoint.createCookies(headerValues.cookie);

	const services = await bodyServiceDiscovery.register(postEndpoint.services);

	const responseBuilder = new ResponseBuilder();
	const result = await postEndpoint.handler(
		{
			services,
			logger: mockLogger,
			body: (c.req.valid as any)('json'),
			query: undefined,
			params: undefined,
			session: undefined,
			header,
			cookie,
			auditor: undefined,
			db: undefined,
		} as any,
		responseBuilder,
	);

	const status = (responseBuilder.getMetadata().status ??
		postEndpoint.status) as any;
	return c.json(result, status);
});

// Runtime version for comparison
const runtimeBodyApp = new Hono();
HonoEndpoint.addRoutes(
	[postEndpoint] as any,
	bodyServiceDiscovery as any,
	runtimeBodyApp,
);

// ============================================================================
// Request Helpers
// ============================================================================

function createRequest(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		headers?: Record<string, string>;
	} = {},
) {
	const { method = 'GET', body, headers = {} } = options;
	const init: RequestInit = {
		method,
		headers: { 'Content-Type': 'application/json', ...headers },
	};
	if (body) init.body = JSON.stringify(body);
	return new Request(`http://localhost${path}`, init);
}

// ============================================================================
// Benchmarks
// ============================================================================

describe('Build-Time vs Runtime: Minimal Endpoint (GET /health)', () => {
	const req = createRequest('/health');

	bench('Raw Hono (baseline)', async () => {
		await rawHonoApp.fetch(req);
	});

	bench('HonoEndpoint.addRoutes (runtime)', async () => {
		await runtimeApp.fetch(req);
	});

	bench('Build-time generated (minimal tier)', async () => {
		await buildTimeMinimalApp.fetch(req);
	});
});

describe('Build-Time vs Runtime: Auth Endpoint (GET /profile)', () => {
	const req = createRequest('/profile', {
		headers: { Authorization: 'Bearer test-token' },
	});

	bench('HonoEndpoint.addRoutes (runtime)', async () => {
		await runtimeAuthApp.fetch(req);
	});

	bench('Build-time generated (standard tier)', async () => {
		await buildTimeStandardApp.fetch(req);
	});
});

describe('Build-Time vs Runtime: Body Validation (POST /users)', () => {
	const req = createRequest('/users', {
		method: 'POST',
		body: { name: 'Test User', email: 'test@example.com' },
	});

	bench('HonoEndpoint.addRoutes (runtime)', async () => {
		await runtimeBodyApp.fetch(req);
	});

	bench('Build-time generated (standard tier)', async () => {
		await buildTimeBodyApp.fetch(req);
	});
});
