---
name: agent-file-exchange
description: Validate, configure, and use Agent File Exchange through the AFX CLI. Use when Codex needs to check an AFX installation or API key, connect to an existing or self-hosted deployment, upload a file and return a temporary download link, create an upload link and receive a file, query transfer state, download a received file, revoke a link, or delete a shared file.
---

# Agent File Exchange

Use the English-only `afx` CLI for every operation. Always request `--json` and parse the JSON envelope; never scrape human-readable output.

Follow this workflow in order. Do not upload or create an inbox until CLI and authentication status are ready.

## 1. Prepare and validate the CLI

Resolve the bundled installer relative to this `SKILL.md`. On macOS or Linux:

```sh
AFX_BIN="$(command -v afx || true)"
if [ -z "$AFX_BIN" ]; then
  AFX_BIN="$(sh "<skill-directory>/scripts/install-cli.sh")"
fi
"$AFX_BIN" version --json
"$AFX_BIN" status --json
```

The installer downloads only from `brookqin/afx` GitHub Releases, verifies the published SHA-256 checksum, and never invokes `sudo`. On Windows, download the matching archive and `checksums.txt` from the same release, verify the checksum, and use `afx.exe`.

If `status` is an unknown command, the CLI is outdated. Run the bundled installer once to upgrade, then retry. Do not continue with an incompatible CLI.

Interpret `status --json` as follows:

- `ok: true`, `data.state: "ready"`: the endpoint is reachable and the tenant API key is valid. Check `data.remote.key.scopes` contains the scopes required for the requested operation.
- `ok: true`, `data.state: "unconfigured"`: the endpoint is reachable but no tenant API key is configured. Continue to step 2.
- `ok: false`, `error.code: "invalid_api_key"`, `"api_key_disabled"`, or `"api_key_revoked"`: ask the user for a replacement tenant key or for an administrator to restore access.
- Network, timeout, TLS, or server errors: report the endpoint and stable error code, then stop. Do not treat them as missing credentials.

Never print, log, or return any key from the local environment or config file.

## 2. Configure a deployment

If no tenant API key is configured, ask the user to choose one of these paths before changing configuration.

### Connect to an existing deployment

Request only:

1. The HTTPS AFX endpoint, such as `https://files.example.com`.
2. A tenant API key beginning with `afx_`; do not request a Root key.
3. Whether configuration should be ephemeral environment variables or the persistent local config file.

For an ephemeral session:

```sh
export AFX_ENDPOINT="https://files.example.com"
export AFX_API_KEY="afx_replace_with_tenant_key"
```

For persistent local configuration, create `~/.config/afx/config.toml`:

```toml
endpoint = "https://files.example.com"
api_key = "afx_replace_with_tenant_key"
```

Set the directory to mode `0700` and the file to mode `0600`. Never commit or upload it. Resolution order is command flags, environment variables, config file, then the default endpoint `http://localhost:8787`; an API key has no default. Avoid `--api-key` and `--root-key` because command arguments can enter history or process listings.

Run `status --json` again and require `data.state: "ready"`.

### Use a self-hosted deployment

When the user chooses self-hosting, use the repository deployment instructions if available. Explain that deployment needs these values, but keep real values in ignored local configuration and Cloudflare Secrets:

- Public HTTPS base URL.
- D1 database binding and database ID.
- R2 account ID, bucket name, and a bucket-scoped Object Read & Write S3 credential.
- `ROOT_API_KEY_HASH`, `ROOT_API_KEY_PEPPER`, `API_KEY_PEPPER`, `TOKEN_HASH_PEPPER`, and `IP_HASH_PEPPER`.
- `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as Worker Secrets.

After deployment, create a least-privilege tenant key and configure only its endpoint and tenant key for routine Skill use.

### Root key boundary

`AFX_ROOT_API_KEY` is the global administrator credential for explicit `afx admin ...` operations. It is not an R2 token and is never needed for routine file or inbox operations.

Keep the Root key in a password manager or OS credential store. Do not put `root_api_key` in normal Skill configuration, source control, chat, logs, command arguments, or user-visible output. Load it ephemerally only when the user explicitly requests administration, perform the minimum operation, then unset it.

To create a tenant key for the complete workflow:

```sh
afx admin keys create codex-skill \
  --scopes files:upload,files:list,files:read,files:delete,inboxes:create,inboxes:list,inboxes:read,inboxes:delete \
  --json
```

The full tenant key is returned once. Store it as `AFX_API_KEY` or `api_key`, then rerun `status --json`.

## 3. Upload and share a download link

1. Resolve the exact path and confirm it is a regular file authorized by the user.
2. Reject directories and inspect suspicious filenames or sensitive configuration.
3. Upload:

```sh
"$AFX_BIN" upload "<path>" --description "<description>" --expires 24h --json
```

Omit `--description` when none is requested; descriptions are limited to 2,000 characters. Add `--downloads <count>` only when requested. Add `--burn` only with explicit approval and never combine it with more than one download.

Require `ok: true`. Return exactly `data.url` as the temporary download-page link and retain `data.id` privately for later status checks or deletion. Never invent or reconstruct a capability URL.

## 4. Share an upload link and receive a file

Create a constrained one-time inbox:

```sh
"$AFX_BIN" inbox create \
  --expires 1h \
  --title "<title>" \
  --description "<description>" \
  --accept ".zip,.log" \
  --max-size "100MiB" \
  --json
```

Omit constraints the user did not request. Require `ok: true`, retain `data.id` privately, and return only `data.upload_url` to the sender.

When asked to wait for the upload, use a new empty destination directory unless the user explicitly selects another safe path:

```sh
"$AFX_BIN" inbox wait "<inbox-id>" \
  --timeout 1h \
  --download \
  --output "<empty-directory>" \
  --json
```

Require `ok: true`, verify `data.path` exists and is a regular file, then report the local path and `data.size_bytes`. Never overwrite an existing file without explicit approval.

## 5. Query and manage transfers

Use the tenant commands that match the request:

```sh
"$AFX_BIN" files list --json
"$AFX_BIN" files info "<file-id>" --json
"$AFX_BIN" files stats "<file-id>" --json
"$AFX_BIN" files download "<file-id>" --output "<destination>" --json
"$AFX_BIN" files delete "<file-id>" --json

"$AFX_BIN" inbox list --json
"$AFX_BIN" inbox info "<inbox-id>" --json
"$AFX_BIN" inbox wait "<inbox-id>" --timeout 1h --json
"$AFX_BIN" inbox revoke "<inbox-id>" --json
```

Use list filters and limits when the request is narrow. Revoke an unused inbox when receipt is cancelled. Delete a shared file when the user asks to invalidate its download capability. Use `afx admin ...` only for an explicitly requested cross-tenant or key-management task.

## Failure and safety rules

- For `ok: false`, report `error.code`, a concise explanation, and `request_id` when present. Branch on stable codes, not `error.message`.
- Retry only transient network, timeout, or server failures. Never claim success before `ok: true`.
- Upload only the exact files authorized by the user.
- Never upload credentials, private keys, tokens, `.env` files, browser profiles, authentication databases, or sensitive configuration without explicit authorization for that exact file.
- Prefer a 24-hour expiration for shared files and one hour for inboxes.
- Treat inbox URLs as write capabilities and download URLs as read capabilities.
- Never place capability URLs in logs, source control, command history, or unrelated messages.
- Never expose tenant keys, Root keys, R2 credentials, presigned URLs, or internal object keys.
