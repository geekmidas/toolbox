import { EnvironmentParser } from '@geekmidas/envkit';

const testExchange = 'geekmidas_events_example';

const envParser = new EnvironmentParser({
  ...process.env,
  EVENT_SUBSCRIBER_CONNECTION_STRING: `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=true`,
});

export default envParser;
