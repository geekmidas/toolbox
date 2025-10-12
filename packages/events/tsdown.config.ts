import { defineConfig } from 'tsdown';

export default defineConfig({
  external: ['amqplib', '@aws-sdk/client-sqs', '@aws-sdk/client-sns'],
});
