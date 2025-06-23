import { EnvironmentParser } from '@geekmidas/envkit';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { HermodService } from '../../services';
import { AWSApiGatewayV1EndpointAdaptor } from '../AWSApiGatewayV1EndpointAdaptor';
import { Endpoint } from '../Endpoint';
const envParser = new EnvironmentParser({});
class TestService extends HermodService<{
  name: string;
}> {
  static readonly serviceName = 'TestService';
  register() {
    return Promise.resolve({
      name: 'TestService',
    });
  }
}
describe('AWSApiGatewayV1EndpointAdaptor', () => {
  it('Fix Service Middleware', async () => {
    const getUsers = Endpoint.put('/users')
      .body(z.object({ name: z.string().min(2).max(100) }))
      .description('Get users')
      .services([TestService])
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .handle(({ services, logger }) => {
        return services.TestService;
      });

    const awsEndpoint = new AWSApiGatewayV1EndpointAdaptor(getUsers, envParser)
      .handler;
    // @ts-ignore
    const response = await awsEndpoint({
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'John Doe' }),
    });

    expect(response).toHaveProperty('statusCode', 200);
    expect(response).toHaveProperty('body');
    const body = JSON.parse(response?.body || '{}');
    expect(body).toHaveProperty('name', 'TestService');
  });
});
