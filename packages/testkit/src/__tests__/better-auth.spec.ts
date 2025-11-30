import { runAdapterTest } from 'better-auth/adapters/test';
import { afterAll, describe } from 'vitest';
import { memoryAdapter } from '../better-auth';

describe.skip('Memory Adapter Tests', async () => {
  afterAll(async () => {
    // Run DB cleanup here...
  });
  const adapter = memoryAdapter({
    debugLogs: {
      // If your adapter config allows passing in debug logs, then pass this here.
      isRunningAdapterTests: true, // This is our super secret flag to let us know to only log debug logs if a test fails.
    },
  });

  await runAdapterTest({
    getAdapter: async (betterAuthOptions = {}) => {
      return adapter(betterAuthOptions);
    },
  });
});
