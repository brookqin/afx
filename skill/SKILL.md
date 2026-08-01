---
name: agent-file-exchange
description: Share a local file through a temporary public URL or create a one-time upload link to receive a file.
---

# Agent File Exchange

Use this skill when the user asks to:

- share a generated local file,
- provide a temporary download link,
- ask another person to upload a file,
- wait for and retrieve a file uploaded through an inbox link.

## Share a file

Run:

    afx upload "<path>" --expires 24h --json

Optional:

    --downloads <count>
    --burn

Return the `data.url` field to the user.

## Receive a file

Create an inbox:

    afx inbox create --expires 1h --json

Return `data.upload_url` to the user.

When instructed to wait for the upload:

    afx inbox wait "<inbox-id>" --timeout 1h --download --output "<directory>" --json

## Safety rules

1. Only upload files explicitly requested by the user or generated for the user.
2. Never upload private keys, credentials, tokens, `.env` files, browser profiles, authentication databases, or sensitive configuration unless the user explicitly authorizes the exact file.
3. Prefer a 24-hour expiration for shared output.
4. Prefer a 1-hour expiration for receiving files.
5. Use burn-after-read only when explicitly requested or when the file is highly sensitive and the user accepts one-attempt semantics.
6. Never reveal `AFX_API_KEY` or `AFX_ROOT_API_KEY`.
7. Do not invent a URL when upload fails.
8. Parse JSON output and return stable error messages.
9. Treat an inbox URL as a write capability and a download URL as a read capability.
10. Do not place either token in logs or source control.
