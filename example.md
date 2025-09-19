```ts
import { e } from './packages/api/src/constructs/EndpointFactory';

export const r = e
  .logger(...)
  .services([])
  .publisher(...);

export const sessionRouter = r.session(async ({ header, services }) => {
  

  return {};
});




export const acceptProposalRoute = proposalRouter
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
      id
    }
  });

  const adapter = new AmazonApiGatewayV2Endpoint(envParser, acceptProposalRoute);

export const handler = adapter.handler;

```