import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          PUBLIC_BASE_URL: 'http://localhost:8787',
          DEFAULT_MAX_FILE_SIZE_BYTES: '104857600',
          DIRECT_UPLOAD_EXPIRES_SECONDS: '900',
          R2_ACCOUNT_ID: 'test-account-id',
          R2_BUCKET_NAME: 'agent-file-exchange',
          R2_ACCESS_KEY_ID: 'test-r2-access-key',
          R2_SECRET_ACCESS_KEY: 'test-r2-secret-key',
          ROOT_API_KEY_HASH: 'd9ce73b98014ae57d243cb67f4f55ae0307ad06c8c5365f090994734f72d8bbe',
          ROOT_API_KEY_PEPPER: 'test-root-pepper',
          API_KEY_PEPPER: 'test-api-pepper',
          TOKEN_HASH_PEPPER: 'test-token-pepper',
          IP_HASH_PEPPER: 'test-ip-pepper',
        },
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
