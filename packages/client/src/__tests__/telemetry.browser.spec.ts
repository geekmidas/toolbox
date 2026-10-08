// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createEndpointHooks } from '../endpoint-hooks';
import { createTypedFetcher } from '../fetcher';
import { traceContextInjector } from '../telemetry';
import { server } from './setup';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/;

/**
 * In a browser a page view is the page load: every client on the page shares
 * its trace, so the requests one user action makes through two clients — the
 * API's and the auth server's, say — belong together.
 */
describe('trace context in a browser', () => {
	it('shares one trace id across the clients on a page', () => {
		const api = traceContextInjector('https://api.example.com', true)!;
		const auth = traceContextInjector('https://auth.example.com', true)!;

		const a: Record<string, string> = {};
		api('https://api.example.com/users', a);
		const b: Record<string, string> = {};
		auth('https://auth.example.com/session', b);

		const [, traceA, spanA] = a.traceparent!.match(TRACEPARENT)!;
		const [, traceB, spanB] = b.traceparent!.match(TRACEPARENT)!;
		expect(traceB).toBe(traceA);
		expect(spanB).not.toBe(spanA);
	});

	it("resolves a relative base URL against the page's origin", () => {
		const inject = traceContextInjector('', true)!;

		const own: Record<string, string> = {};
		inject(`${window.location.origin}/api/users`, own);
		const relative: Record<string, string> = {};
		inject('/api/users', relative);
		const other: Record<string, string> = {};
		inject('https://cdn.example.net/x.js', other);

		expect(own.traceparent).toMatch(TRACEPARENT);
		expect(relative.traceparent).toMatch(TRACEPARENT);
		expect(other).toEqual({});
	});

	it('reaches the React Query hooks, which go through the same fetch', async () => {
		server.use(
			http.get('https://api.example.com/echo', ({ request }) =>
				HttpResponse.json({ traceparent: request.headers.get('traceparent') }),
			),
		);
		const fetcher = createTypedFetcher<any>({
			baseURL: 'https://api.example.com',
			telemetry: true,
		});
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const hooks = createEndpointHooks<any>(fetcher as any, { queryClient });
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(QueryClientProvider, { client: queryClient }, children);

		const { result } = renderHook(() => hooks.useQuery('GET /echo' as any), {
			wrapper,
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect((result.current.data as any).traceparent).toMatch(TRACEPARENT);
	});
});
