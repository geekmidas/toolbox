import { EnvironmentParser } from '@geekmidas/envkit';

const envParser = new EnvironmentParser({
  ...process.env,
  EVENT_SUBSCRIBER_CONNECTION_STRING: 'basic://in-memory',
});

export default envParser;
