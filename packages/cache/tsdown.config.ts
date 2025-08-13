import { defineConfig } from 'tsdown';

export default defineConfig({
  external: ['expo-secure-store', '@upstash/redis'],
});
