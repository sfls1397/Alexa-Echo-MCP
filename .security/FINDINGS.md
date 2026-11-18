# Dependency and Code Security Findings

These gates extend Gitleaks without weakening its config. The original gate rollout was tooling-only; subsequent dependency remediation is documented below. Existing findings below are explicitly documented rather than represented as fixed. The gate accepts only their exact fingerprints; new/changed findings, expired exceptions and scanner/registry failures block commits/PRs/publishing. No broad baseline, directory waiver or inline nosemgrep suppression.

## Coverage

Offline ruleset v1 has 13 reviewed JavaScript/TypeScript and Python rules for dynamic code execution, shell-mode subprocesses, request-to-shell injection, disabled TLS, insecure hashes and unsafe deserialization/YAML. It is a high-signal starter set, not exhaustive security review or Semgrep Pro analysis. Tests and scripts are scanned; `.semgrepignore` excludes only generated output, caches and dependencies. Scan output contains rule/file/line, never source snippets.

## Dependency Findings

- `alexa-cookie2` high, installed 5.0.6: via cookie; via http-proxy-middleware. Fingerprint re-pinned on 2026-11-17 for the picomatch chain and accepted until 2026-12-10; see the 2026-11-17 re-check below.

- `alexa-remote2` low, installed 8.1.1: via alexa-cookie2. Below the configured high threshold; reported, not suppressed.

- `cookie` low, installed 0.6.0: cookie accepts cookie name, path, and domain with out of bounds characters (https://github.com/advisories/GHSA-pxg6-pf52-xh8x). Below the configured high threshold; reported, not suppressed.

- `http-proxy-middleware` high, installed 2.0.10: via micromatch. Fingerprint re-pinned on 2026-11-17 for the picomatch chain and accepted until 2026-12-10; see the 2026-11-17 re-check below.

- `micromatch` high, installed 4.0.8: via picomatch (was via braces). Fingerprint re-pinned on 2026-11-17 and accepted until 2026-12-10; see the 2026-11-17 re-check below.

- `picomatch` high, installed 2.3.2: ReDoS through single-branch repeated extglobs (https://github.com/advisories/GHSA-fc5q-39xc-vjpf), affected through 4.0.7, no patched release. Accepted until 2026-12-10; see the 2026-11-17 re-check below.

- `hono` moderate, installed 4.13.14, and `@hono/node-server` moderate, installed 2.1.5 (via `@modelcontextprotocol/sdk`). Below the configured high threshold; reported, not suppressed; see the 2026-11-17 re-check below.

- `braces`: the historical stack-exhaustion advisory (https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn on 2026-10-23 and production audit no longer reports it, so its exception was removed on 2026-11-17.

### 2026-11-09 Re-check and Exception Renewal

The public npm registry still lists `alexa-remote2` 8.1.1, `alexa-cookie2` 5.0.6, `micromatch` 4.0.8 and `braces` 3.0.3 as latest. There is no published patched `braces` release or patched dependency path that preserves the current `alexa-remote2` version. The advisory was withdrawn on 2026-10-23 because it was judged not practically exploitable, and the current production audit no longer reports the braces-related high findings; withdrawal is not a shipped dependency fix.

The four existing historical exceptions were due to expire on 2026-11-10. The standing weekly re-check requires a 30-day extension when no patched path exists and expiry is within seven days, so their expiry is extended to 2026-12-10. Package names, fingerprints, reasons and tracking scope remain unchanged. These entries do not accept any new or changed finding, and do not change the production dependencies or runtime. The weekly re-check remains in place.

Separately, the production lockfile's `follow-redirects` 1.16.1 triggered GHSA-mrwp-f3q8-3g9p (https://github.com/advisories/GHSA-mrwp-f3q8-3g9p). It is updated to the patched 1.16.2 within `http-proxy`'s existing dependency range. No exception is added for this finding, and `alexa-remote2` remains 8.1.1. Loopback-only regression tests cover same-realm and cross-realm sensitive-header lists with object and array headers, preserving harmless headers while removing sensitive headers on cross-origin redirects.

### 2026-11-17 Picomatch Advisory Re-check

Main's push-time scan went red: production `npm audit` now reports `picomatch` high for GHSA-fc5q-39xc-vjpf ("ReDoS through single-branch repeated extglobs", affected `<=4.0.7`). That is a new finding, and it changes the advisory chain for `micromatch` (now via picomatch instead of braces), `http-proxy-middleware` and `alexa-cookie2`, so their pinned fingerprints no longer matched.

Patched path: none. The public npm registry lists `picomatch` 4.0.7 as latest (no fixed release on any line, including the 2.x line `micromatch` 4.0.8 requires through `^2.3.1`), and `micromatch` 4.0.8, `alexa-cookie2` 5.0.6 and `alexa-remote2` 8.1.1 are still latest. `http-proxy-middleware` 2.0.12 still depends on `micromatch ^4.0.2`, so no in-range lockfile update removes picomatch. Unlike the 2026-11-09 `follow-redirects` fix, no update is possible here.

Reachability: the only production path is `alexa-remote2` > `alexa-cookie2` > `http-proxy-middleware` > `micromatch` > `picomatch`. The advisory needs an attacker-supplied glob pattern (for example `+(*)`); the matched string alone does not trigger it. `http-proxy-middleware` passes only its context pattern to micromatch, and `alexa-cookie2` creates its proxy with the hardcoded context `'!/cookie-success'`, which has no extglob. That proxy runs only during the one-time `login` command, bound to 127.0.0.1 (`src/alexa/login.ts`). The MCP server and the stdio/HTTP tools never call picomatch.

Change: the four exceptions now pin exactly the four current high fingerprints (`alexa-cookie2`, `http-proxy-middleware`, `micromatch`, `picomatch`), each with the chain, reason and this section as tracking, expiring 2026-12-10 under the standing weekly re-check. The superseded fingerprints for `alexa-cookie2`, `http-proxy-middleware` and `micromatch` are replaced, not kept beside the new ones, and the stale `braces` exception is removed, so the policy accepts no more findings than before. Any further change to these chains, versions or advisories still blocks. Production dependencies and runtime are unchanged.

Moderate advisories (below the high threshold; reported, not suppressed): `hono` <=4.13.15 (GHSA-4m76-xfj5-7975, GHSA-h7mg-cq63-vhpq, GHSA-3gg2-335m-rxc6, GHSA-46wx-v44x-9hh2, GHSA-4h7h-rv7c-7m2v) and `@hono/node-server` 2.0.0-2.1.5 (GHSA-qv5m-9pm6-hqp3, GHSA-jpvv-r467-5p4w), both through `@modelcontextprotocol/sdk`. The server uses only the SDK's `StreamableHTTPServerTransport`, which converts Node requests with `@hono/node-server`'s request listener; it builds no Hono app, router, `mount()`, `csrf()`, `validator()` or `css` helper and accepts no WebSocket upgrade. Its own Node handler checks the bearer token and the exact `/mcp`, `/` or `/health` path before the SDK sees a request. Patched releases (`hono` 4.13.19, `@hono/node-server` 2.1.9) fit the SDK's ranges and are left to the next versioned product release.


## Code Findings

No findings after rule review. The request-to-shell rule targets child-process calls, not RegExp.exec.


## Running and Reviewing

Enable `.githooks` for every clone. Install Semgrep using the pin in `.cursor/install-semgrep.sh` and Python 3.10+; Mini Codex/Claude Code share the installed hook/scanner. `python3 .security/scan.py all` runs `npm audit --omit=dev --audit-level=high --json` and `semgrep scan --config .security/semgrep.yml --error --strict --metrics off --disable-version-check --disable-nosem --json`. npm registry/network errors fail closed. Pre-commit scans index bytes and audits staged package files when those files or policy change. The local pre-PR/pre-deploy gate (`.security/local-gate.py`) and npm prepublishOnly run the full gate. Cursor installation uses `.cursor/install-security.sh`, which also runs the full gate.

Raw npm audit may exit 1 for the documented high findings above. The wrapper prints each finding and accepts only exact, unexpired fingerprints with a reason and remediation tracking. Never extend expiry or change a fingerprint without reviewing the finding; remove entries when remediated. The local gate (`.security/local-gate.py`) runs negative tests for new/changed high findings, outages, unsafe staged code hidden by unstaged edits, invalid rules and expired policy. Keep all scanner/agent setup files excluded from npm packages.

## Complete repository privacy and language gates

The privacy gate also checks raw Git author/committer headers and commit messages. New commits require GitHub noreply; history permits only GitHub noreply and the exact public tool identities documented by metadata.py. Mailmap cannot conceal private identities. Commit-msg scans messages for secrets; pre-push runs metadata, full-history Gitleaks and full dependency/code checks. Before merging, run `python3 .security/local-gate.py PR_NUMBER` from the reviewed PR checkout: it runs every gate plus this repository's tests (`.security/local-gate.json`) on the exact head in a clean worktree and records the result on that SHA as the `local-gate` commit status and a PR comment. Then `python3 .security/merge-pr.py PR_NUMBER` requires that recorded PASS from the owner on the exact head (GitHub Actions are not the merge gate), reruns full local gates, and merges with a matching-head condition. Public repositories also require the `local-gate` status in branch protection; private branch protection depends on the account plan, so there the command is an enforced agent workflow, not a GitHub-side access restriction.

The code gate includes checksum-pinned ShellCheck at warning/error threshold for shell files, including extensionless wrappers, and Clang Static Analyzer for C/Objective-C helpers on macOS. On macOS the local gate (`.security/local-gate.py`) runs the Clang analysis for native helpers; Linux reports the platform handoff explicitly. No source language is silently claimed as analyzed by Semgrep. Add language-appropriate checks before adding a new runtime language. All scanners run locally and report locations/rule names without source snippets. Runtime downloads and separately installed language environments require their own dependency audit; npm audit of the parent manifest alone does not cover them.
