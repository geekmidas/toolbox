import { describe, it } from 'vitest';
import { z } from 'zod/v4';
import { AWSApiGatewayV1EndpointAdaptor } from '../AWSApiGatewayV1EndpointAdaptor';
import { Endpoint } from '../Endpoint';

describe('Endpoint', () => {
  it('Endpoint.toJSONSchema PUT', async () => {
    const getUsers = Endpoint.put('/users')
      .body(z.object({ name: z.string().min(2).max(100) }))
      .description('Get users')
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .handle(({ services }) => ({
        name: '',
      }));

    const handler = new AWSApiGatewayV1EndpointAdaptor(getUsers).handler;
  });
});
