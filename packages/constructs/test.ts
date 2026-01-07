import type { Cache } from '@geekmidas/cache';
import { UpstashCache } from '@geekmidas/cache/upstash';
import { e } from '@geekmidas/constructs/endpoints';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import { ConsoleLogger } from '@geekmidas/logger/console';
import z4 from 'zod/v4';
import { isValidJWT } from 'zod/v4/core';

export type CacheClient = Cache<string>;

export class CacheService {
  private static client: CacheClient;
  static serviceName = 'cache' as const;

  private static config = (envParser: EnvironmentParser<{}>) =>
    envParser.create((get) => ({
      url: get('UPSTASH_URL').string(),
      token: get('UPSTASH_TOKEN').string(),
    }));

  static register(envParser: EnvironmentParser<{}>): CacheClient {
    if (!CacheService.client) {
      const config = this.config(envParser).parse();
      CacheService.client = new UpstashCache(config.url, config.token);
    }
    return CacheService.client;
  }
}

export class EventsService {
  public static instance: ShortstaffEventPublisher;
  static serviceName = 'events' as const;

  public static config = (envParser: EnvironmentParser<{}>) =>
    envParser.create((get) => ({
      topicArn: get('NOTIFICATION_TOPIC_ARN').string(),
      region: get('AWS_REGION').string(),
      accessKeyId: get('AWS_ACCESS_KEY_ID').string().optional(),
      secretAccessKey: get('AWS_SECRET_ACCESS_KEY').string().optional(),
      endpoint: get('AWS_ENDPOINT_URL').string().optional(),
    }));

  static register(envParser: EnvironmentParser<{}>): ShortstaffEventPublisher {
    return EventsService.instance;
  }
}

export type ShortstaffEventPublisher = EventPublisher<{
  type: 'user';
  payload: {};
}>;

export const r = e
  .logger(new ConsoleLogger())
  .services([CacheService])
  .publisher(EventsService);

export const sessionRouter = r.session(async ({ header, services }) => {
  const authHeader = header('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authorization header required');
  }

  const token = authHeader.substring(7);

  if (!isValidJWT(token)) {
    throw new UnauthorizedError('Invalid token format');
  }

  return { token };
});

const LoginUserSchema = z4.object({
  username: z4.string().min(3),
  password: z4.string().min(6),
});

const LoginResponseSchema = z4.object({
  token: z4.string(),
});

export const login = r
  .post('/auth/login')
  .body(LoginUserSchema)
  .output(LoginResponseSchema)
  .handle(async ({ body, services, header }, res) => {
    return { token: 'mock-jwt-token' };
  });
