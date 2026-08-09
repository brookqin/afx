import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { applyMigration, createKey } from '../helpers';

beforeAll(async () => {
  await applyMigration();
});

describe('tenant status', () => {
  it('validates a key without requiring a business scope', async () => {
    const key = await createKey('status-only', { scopes: [] });
    const response = await SELF.fetch('http://localhost/api/status', {
      headers: { authorization: `Bearer ${key.apiKey}` },
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.authenticated).toBe(true);
    expect(body.data.key).toMatchObject({ id: key.id, name: 'status-only', scopes: [] });
    expect(body.data.key).not.toHaveProperty('secret');
    expect(body.data.key).not.toHaveProperty('secret_hash');
  });

  it('rejects a missing or invalid key', async () => {
    const response = await SELF.fetch('http://localhost/api/status');
    const body = (await response.json()) as any;
    expect(response.status).toBe(401);
    expect(body.error.code).toBe('invalid_api_key');
  });
});
