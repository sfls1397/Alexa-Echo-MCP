# Changelog

## 1.3.3

- The HTTP server reads its bearer token from `ALEXA_ECHO_MCP_TOKEN` first when it is set and not blank, so a secrets manager can inject it at launch; the Keychain item stays the fallback, unchanged. `http-token` still prints only the Keychain token (generating one if missing); the Amazon session and sign-in are unchanged.

## 1.3.2

- Refresh dependencies within existing ranges: `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7 and `body-parser` 2.4.0 (high advisories GHSA-mrhx-c7xc-m3w5 and GHSA-27r3-jxmh-p828).
- README: global-install LaunchAgent path, `serverHost` and `check-config`.

## 1.3.0

- Add staged, full-history CI and pre-publication package privacy/secret scans.
- Use visibly fake authentication fixtures and document synthetic device IDs.
- Publish with explicit provenance; preserve local aliases and Keychain sign-in.
