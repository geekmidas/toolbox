# Debugging Publisher Service Issue

## Current Failing Endpoint

```ts
import { e } from './packages/api/src/constructs/EndpointFactory';

export const r = e
  .logger(logger)
  .services([])
  .publisher(EventsService);

export const sessionRouter = r.session(async ({ header, services }) => {
  // Session logic here
  return {};
});

export const acceptProposalRoute = sessionRouter  // or proposalRouter derived from sessionRouter
  .patch('/:id/accept')
  .params(...)
  .services([])
  .output(...)
  .event({
    type: NotificationType.AcceptProposal,
    payload: (r) => ({ proposalId: r.id }),
  })
  .handle(async ({ params, services, session }) => {
    return {
      id: params.id
    }
  });

const adapter = new AmazonApiGatewayV2Endpoint(envParser, acceptProposalRoute);

export const handler = adapter.handler;
```

## Problem

The endpoint is logging "No publisher service available" despite setting `.publisher(EventsService)` on the factory.

## Debugging Steps

### 1. Check EventsService Implementation

Ensure your EventsService is properly implemented:

```ts
const EventsService: Service<'EventsService', EventPublisher<YourEventType>> = {
  serviceName: 'EventsService',
  register: async (envParser) => {
    // Your publisher implementation
    return {
      publish: async (events) => {
        // Publishing logic
      }
    };
  }
};
```

### 2. Check Session Router Impact

The issue might be in the session router. When you call `r.session()`, it creates a new factory. Verify that the session router preserves the publisher:

```ts
// Debug: Check if sessionRouter has publisher
console.log('sessionRouter defaultEventPublisher:', (sessionRouter as any).defaultEventPublisher);
```

### 3. Check Endpoint Construction Chain

The problem might be in how the endpoint is built from sessionRouter. Add debug logs:

```ts
export const acceptProposalRoute = sessionRouter
  .patch('/:id/accept')
  .params(...)
  .services([])  // ⚠️ This might be overriding the publisher
  .output(...)
  .event({
    type: NotificationType.AcceptProposal,
    payload: (r) => ({ proposalId: r.id }),
  })
  .handle(async ({ params, services, session }) => {
    return { id: params.id }
  });

// Debug: Check if endpoint has publisher
console.log('acceptProposalRoute publisherService:', acceptProposalRoute.publisherService);
```

### 4. Potential Fix: Avoid Services Override

The `.services([])` call might be creating a new builder that doesn't inherit the publisher. Try removing it or ensuring it doesn't override publisher settings:

```ts
export const acceptProposalRoute = sessionRouter
  .patch('/:id/accept')
  .params(...)
  // .services([])  // ← Remove this line
  .output(...)
  .event({
    type: NotificationType.AcceptProposal,
    payload: (r) => ({ proposalId: r.id }),
  })
  .handle(async ({ params, services, session }) => {
    return { id: params.id }
  });
```

### 5. Alternative: Set Publisher Directly on Endpoint

If the factory inheritance isn't working, set the publisher directly on the endpoint:

```ts
export const acceptProposalRoute = sessionRouter
  .patch('/:id/accept')
  .params(...)
  .publisher(EventsService)  // ← Set publisher directly
  .output(...)
  .event({
    type: NotificationType.AcceptProposal,
    payload: (r) => ({ proposalId: r.id }),
  })
  .handle(async ({ params, services, session }) => {
    return { id: params.id }
  });
```

### 6. Check Session Factory Implementation

Verify that the session method preserves the publisher from the original factory. The issue might be in the EndpointFactory.session() method not copying the defaultEventPublisher.

## Expected Behavior

After fixing, you should see:
1. `acceptProposalRoute.publisherService` should be defined
2. `acceptProposalRoute.publisherService.serviceName` should be 'EventsService'
3. No "No publisher service available" warning in logs
4. Events should be published successfully after successful endpoint execution

## Debug Output Analysis

When you see the logged endpoint object (from `logger.info(endpoint)`), check:
- `endpoint.publisherService` - should not be undefined
- `endpoint.events` - should contain your event definition
- `endpoint._path` - should match your route
- `endpoint.method` - should be 'PATCH'

If `publisherService` is undefined, the issue is in the endpoint construction chain, not in the EventsService implementation.