import { defineConfig } from 'tsdown';

export default defineConfig({
  external: [
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-presigned-post',
    '@aws-sdk/s3-request-presigner',
  ],
});
