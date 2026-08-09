---
name: agent-file-exchange
description: Share, receive, inspect, revoke, and clean up temporary files through the AFX CLI. Use when Codex needs to install or verify afx, upload a local or generated file and return a temporary download link, create a constrained one-time inbox link, wait for and download an inbox file, inspect transfer status, revoke an inbox, or delete a shared file.
---

# Agent File Exchange

Use the English-only `afx` CLI for every operation. Parse `--json` output; do not scrape human-readable text.

## Prepare the CLI

Resolve the bundled installer relative to this `SKILL.md`. On macOS or Linux, install the latest release when `afx` is unavailable:

```sh
AFX_BIN="$(command -v afx || true)"
if [ -z "$AFX_BIN" ]; then
  AFX_BIN="$(sh "<skill-directory>/scripts/install-cli.sh")"
fi
"$AFX_BIN" --json version
```

The installer downloads only from `brookqin/afx` GitHub Releases, verifies the published SHA-256 checksum, and never invokes `sudo`. On Windows, download the matching `afx_<version>_windows_<arch>.zip` and `checksums.txt` from the same GitHub Release, verify the checksum, and use `afx.exe`.

Require `AFX_ENDPOINT` and `AFX_API_KEY` for file operations. Prefer environment variables or `~/.config/afx/config.toml`; never place an API key in a command argument, log, source file, or user-visible response.

## Share a file

1. Resolve the exact path and confirm it is a regular file explicitly requested by or generated for the user.
2. Reject directories and inspect suspicious filenames or sensitive configuration before uploading.
3. Run:

```sh
"$AFX_BIN" upload "<path>" --description "<description>" --expires 24h --json
```

Omit `--description` when no description is requested; descriptions are limited to 2,000 characters. Add `--downloads <count>` only when requested. Add `--burn` only with explicit approval; do not combine it with `--downloads` greater than 1. Treat burn-after-read as first-download-attempt semantics, including interrupted transfers.

Require `ok: true`, then return `data.url`. Retain `data.id` for later status checks or deletion. Never invent or reconstruct a URL.

## Receive a file

Create an inbox with the constraints requested by the user:

```sh
"$AFX_BIN" inbox create \
  --expires 1h \
  --title "<title>" \
  --description "<description>" \
  --accept ".zip,.log" \
  --max-size "100MiB" \
  --json
```

Omit optional flags that the user did not specify. Require `ok: true`, retain `data.id` as the private inbox identifier, and return only `data.upload_url` as the write-capability link.

When asked to wait, use a new empty destination directory unless the user explicitly chooses another safe path:

```sh
"$AFX_BIN" inbox wait "<inbox-id>" \
  --timeout 1h \
  --download \
  --output "<empty-directory>" \
  --json
```

Require `ok: true`, verify that `data.path` exists, then return the local path and `data.size_bytes`. Never overwrite an existing file without explicit approval.

## Inspect, revoke, and clean up

Use these lifecycle commands when requested:

```sh
"$AFX_BIN" inbox info "<inbox-id>" --json
"$AFX_BIN" inbox revoke "<inbox-id>" --json
"$AFX_BIN" files info "<file-id>" --json
"$AFX_BIN" files delete "<file-id>" --json
```

Revoke an unused inbox when the user cancels receipt. Delete a shared file when the user asks to invalidate its download capability.

## Handle failures

For `ok: false`, report `error.code`, a concise explanation, and `request_id` when present. Treat `error.code` as stable; do not branch on `error.message`. Retry only transient network, timeout, or server failures, and never claim success until the CLI returns `ok: true`.

## Safety rules

1. Upload only the exact files authorized by the user.
2. Never upload private keys, credentials, tokens, `.env` files, browser profiles, authentication databases, or sensitive configuration without explicit authorization for that exact file.
3. Prefer a 24-hour expiration for shared files and a 1-hour expiration for inboxes.
4. Treat inbox URLs as write capabilities and download URLs as read capabilities.
5. Never place capability URLs in logs, source control, command history, or unrelated messages.
6. Do not expose `AFX_API_KEY`, `AFX_ROOT_API_KEY`, presigned R2 URLs, or internal object keys.
7. Keep Root credentials out of normal share and receive workflows.
