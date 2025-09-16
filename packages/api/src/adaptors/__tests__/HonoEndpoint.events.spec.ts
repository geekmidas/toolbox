import { EnvironmentParser } from '@geekmidas/envkit';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { e } from '../../constructs/EndpointFactory';
import type {
  EventPublisher,
  PublishableMessage,
} from '../../constructs/events';
import type { Logger } from '../../logger';
import { ServiceDiscovery } from '../../services';
import { HonoEndpoint } from '../HonoEndpoint';

type TestEvent = PublishableMessage<
  'test.created' | 'test.updated',
  { id: string; name: string }
>;

describe('HonoEndpoint - Event Publishing', () => {
  const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  };

  const mockPublisher: EventPublisher<TestEvent> = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const envParser = new EnvironmentParser({});
  const serviceDiscovery = ServiceDiscovery.getInstance(mockLogger, envParser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should publish events after successful endpoint execution', async () => {
    const endpoint = e
      .publisher(mockPublisher)
      .post('/test')
      .body(z.object({ name: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .event({
        type: 'test.created',
        payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
      })
      .handle(async ({ body }) => ({
        id: '123',
        name: body.name,
      }));

    const app = new Hono();
    HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);

    const response = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '123', name: 'Test Item' });

    // Verify event was published
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'test.created',
        payload: { id: '123', name: 'Test Item' },
      },
    ]);
  });

  it('should publish multiple events', async () => {
    const endpoint = e
      .publisher(mockPublisher)
      .post('/test')
      .body(z.object({ name: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .event({
        type: 'test.created',
        payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
      })
      .event({
        type: 'test.updated',
        payload: (ctx) => ({
          id: ctx.response.id,
          name: 'Updated: ' + ctx.response.name,
        }),
      })
      .handle(async ({ body }) => ({
        id: '123',
        name: body.name,
      }));

    const app = new Hono();
    HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);

    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item' }),
    });

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'test.created',
        payload: { id: '123', name: 'Test Item' },
      },
      {
        type: 'test.updated',
        payload: { id: '123', name: 'Updated: Test Item' },
      },
    ]);
  });

  it('should respect event conditions', async () => {
    const endpoint = e
      .publisher(mockPublisher)
      .post('/test')
      .body(z.object({ name: z.string(), publish: z.boolean() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .event({
        type: 'test.created',
        payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
        when: (ctx) => ctx.body.publish === true,
      })
      .handle(async ({ body }) => ({
        id: '123',
        name: body.name,
      }));

    const app = new Hono();
    HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);

    // First request with publish = false
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item', publish: false }),
    });

    expect(mockPublisher.publish).not.toHaveBeenCalled();

    // Second request with publish = true
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item', publish: true }),
    });

    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('should not publish events when no publisher is configured', async () => {
    const endpoint = e
      .post('/test')
      .body(z.object({ name: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .event({
        type: 'test.created',
        payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
      })
      .handle(async ({ body }) => ({
        id: '123',
        name: body.name,
      }));

    const app = new Hono();
    HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);

    const response = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item' }),
    });

    expect(response.status).toBe(200);
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('should not publish events on error', async () => {
    const endpoint = e
      .publisher(mockPublisher)
      .post('/test')
      .body(z.object({ name: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .event({
        type: 'test.created',
        payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
      })
      .handle(async () => {
        throw new Error('Test error');
      });

    const app = new Hono();
    HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);

    const response = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Item' }),
    });

    expect(response.status).toBe(500);
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('should have access to all context in event payload', async () => {
    const endpoint = e
      .publisher(mockPublisher)
      .post('/users/:userId')
      .params(z.object({ userId: z.string() }))
      .query(z.object({ include: z.string().optional() }))
      .body(z.object({ name: z.string() }))
      .output(z.object({ id: z.string(), name: z.string() }))
      .event({
        type: 'test.created',
        payload: (ctx) => ({
          id: ctx.response.id,
          name: ctx.body.name,
          userId: ctx.params.userId,
          include: ctx.query.include,
        }),
      })
      .handle(async ({ body, params }) => ({
        id: params.userId,
        name: body.name,
      }));

    const app = new Hono();
    HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);

    await app.request('/users/user-123?include=profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User' }),
    });

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'test.created',
        payload: {
          id: 'user-123',
          name: 'Test User',
          userId: 'user-123',
          include: 'profile',
        },
      },
    ]);
  });
});
