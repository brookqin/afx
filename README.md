# Agent File Exchange

[中文说明](README.zh-CN.md)

![Agent File Exchange social preview](docs/assets/social-preview.png)

Agent File Exchange (AFX) is a temporary file exchange service for automated agents. It runs on Cloudflare Workers, stores metadata in D1, stores file bodies in R2, and includes an English Go CLI.

## Features

- Send a file and create a temporary public download URL with expiration, download limits, or burn-after-read semantics.
- Create a one-time inbox URL for a human or external system, then wait for and download the received file.
- Upload file bodies directly to R2. The Worker signs a short-lived staging URL, verifies the object, and publishes it to an immutable final key with CopyObject.
- Isolate tenants by API key, with a separate Root API key for global administration.
- Store only HMAC digests of public capability tokens and redact secrets from audit events.
- Serve public pages in English and Simplified Chinese from separate locale resources.

## Architecture

```text
afx CLI / agent ── metadata API ──> Cloudflare Worker ──> D1
       │                                      │
       └── signed PUT ───────────────────────> R2 staging object
                                              │ verify + CopyObject
                                              └────────> R2 final object

public recipient ── capability URL ─────────> download or one-time inbox page
```

The Worker never proxies upload bodies. A signed URL can only write to a staging key; completion verifies size and metadata before copying to the final key, so an old upload URL cannot overwrite a published file.

## Repository layout

```text
worker/   Cloudflare Worker (TypeScript, Hono, D1, R2)
cli/      afx CLI (Go, Cobra; English interface)
skill/    Agent Skill instructions
docs/     API, security, operations, and social assets
design/   Implementation plan and design decisions
```

## Quick start

### 1. Prepare Cloudflare resources

Generate a Root API key and its HMAC hash offline. Replace the pepper placeholder with the same secret you will configure as `ROOT_API_KEY_PEPPER`:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(32).toString('base64url');console.log('ROOT_KEY=afx_root_'+s);console.log('ROOT_API_KEY_HASH='+c.createHmac('sha256','<ROOT_API_KEY_PEPPER>').update(s).digest('hex'))"
```

Then create D1 and R2, configure `worker/wrangler.jsonc`, set secrets, apply the initial schema, and deploy:

```bash
cd worker
npm install
npx wrangler d1 create agent-file-exchange
npx wrangler r2 bucket create agent-file-exchange

# Fill in the D1 database ID, R2 account/bucket values, and PUBLIC_BASE_URL.
# Replace the example origin in r2-cors.example.json with PUBLIC_BASE_URL.
npx wrangler secret put ROOT_API_KEY_HASH
npx wrangler secret put ROOT_API_KEY_PEPPER
npx wrangler secret put API_KEY_PEPPER
npx wrangler secret put TOKEN_HASH_PEPPER
npx wrangler secret put IP_HASH_PEPPER
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler r2 bucket cors set agent-file-exchange --file r2-cors.example.json
npx wrangler d1 migrations apply agent-file-exchange --remote
npx wrangler deploy
```

This repository has not been released or deployed yet, so `worker/migrations/0001_initial.sql` is the single source of truth for a new database. There are no incremental `ALTER TABLE` migrations.

### 2. Build and use the CLI

```bash
make build
export AFX_ENDPOINT=https://files.example.com
export AFX_API_KEY=afx_...
export AFX_ROOT_API_KEY=afx_root_...

./cli/afx upload report.pdf --expires 24h --json
./cli/afx inbox create --expires 1h --title "Upload logs" --json
./cli/afx inbox wait <inbox-id> --timeout 1h --download --output . --json
```

Run `./cli/afx --help` for the full English command reference.

### 3. Develop and test

```bash
make test
make typecheck
make build
```

For local Worker development, configure local D1/R2 bindings and run `make worker-dev`.

## Internationalization

Public Worker pages support English (`en`) and Simplified Chinese (`zh-CN`). Locale selection uses this order:

1. `?lang=en` or `?lang=zh-CN`
2. the weighted `Accept-Language` header
3. Simplified Chinese as the fallback

Language resources live in `worker/src/locales/en.ts` and `worker/src/locales/zh-CN.ts`. API error codes and JSON response shapes remain language-neutral and stable. The CLI intentionally stays English-only.

## Security model

- Public URLs contain 32-byte high-entropy capability tokens; D1 stores only HMAC-SHA-256 digests.
- Conditional D1 updates atomically enforce download counts, burn-after-read, and one-time upload leases.
- Original filenames never appear in R2 object keys.
- Direct-upload URLs expire quickly and cannot target final object keys.
- Audit events exclude complete tokens, API keys, secrets, and file content; client IPs are HMAC-pseudonymized with daily rotation.

See [Security](docs/SECURITY.md) before production use.

## Documentation

- [API reference](docs/API.md)
- [Operations guide](docs/OPERATIONS.md)
- [Security model](docs/SECURITY.md)
- [Agent Skill](skill/SKILL.md)
- [Implementation plan](design/agent-file-exchange-implementation-plan.md)

## License

Licensed under the [MIT License](LICENSE).
