# Dependency and Code Security Findings

These gates extend Gitleaks without weakening its config. The original gate rollout was tooling-only; subsequent dependency remediation is documented below. Existing findings below are explicitly documented rather than represented as fixed. The gate accepts only their exact fingerprints; new/changed findings, expired exceptions and scanner/registry failures block commits/PRs/publishing. No broad baseline, directory waiver or inline nosemgrep suppression.

## Coverage

Offline ruleset v1 has 13 reviewed JavaScript/TypeScript and Python rules for dynamic code execution, shell-mode subprocesses, request-to-shell injection, disabled TLS, insecure hashes and unsafe deserialization/YAML. It is a high-signal starter set, not exhaustive security review or Semgrep Pro analysis. Tests and scripts are scanned; `.semgrepignore` excludes only generated output, caches and dependencies. Scan output contains rule/file/line, never source snippets.

## Dependency Findings

- `alexa-cookie2` high, installed 5.0.6: via cookie; via http-proxy-middleware. Historical baseline fingerprint accepted until 2026-12-10; see the re-check below.

- `alexa-remote2` low, installed 8.1.1: via alexa-cookie2. Below the configured high threshold; reported, not suppressed.

- `braces` high, installed 3.0.3: historical stack-exhaustion advisory (https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), withdrawn on 2026-10-23. Historical baseline fingerprint accepted until 2026-12-10; see the re-check below.

- `cookie` low, installed 0.6.0: cookie accepts cookie name, path, and domain with out of bounds characters (https://github.com/advisories/GHSA-pxg6-pf52-xh8x). Below the configured high threshold; reported, not suppressed.

- `http-proxy-middleware` high, installed 2.0.10: via micromatch. Historical baseline fingerprint accepted until 2026-12-10; see the re-check below.

- `micromatch` high, installed 4.0.8: via braces. Historical baseline fingerprint accepted until 2026-12-10; see the re-check below.

### 2026-11-09 Re-check and Exception Renewal

The public npm registry still lists `alexa-remote2` 8.1.1, `alexa-cookie2` 5.0.6, `micromatch` 4.0.8 and `braces` 3.0.3 as latest. There is no published patched `braces` release or patched dependency path that preserves the current `alexa-remote2` version. The advisory was withdrawn on 2026-10-23 because it was judged not practically exploitable, and the current production audit no longer reports the braces-related high findings; withdrawal is not a shipped dependency fix.

The four existing historical exceptions were due to expire on 2026-11-10. The standing weekly re-check requires a 30-day extension when no patched path exists and expiry is within seven days, so their expiry is extended to 2026-12-10. Package names, fingerprints, reasons and tracking scope remain unchanged. These entries do not accept any new or changed finding, and do not change the production dependencies or runtime. The weekly re-check remains in place.

Separately, the production lockfile's `follow-redirects` 1.16.1 triggered GHSA-mrwp-f3q8-3g9p (https://github.com/advisories/GHSA-mrwp-f3q8-3g9p). It is updated to the patched 1.16.2 within `http-proxy`'s existing dependency range. No exception is added for this finding, and `alexa-remote2` remains 8.1.1. Loopback-only regression tests cover same-realm and cross-realm sensitive-header lists with object and array headers, preserving harmless headers while removing sensitive headers on cross-origin redirects.


## Code Findings

No findings after rule review. The request-to-shell rule targets child-process calls, not RegExp.exec.


## Running and Reviewing

Enable `.githooks` for every clone. Install Semgrep using the pin in `.cursor/install-semgrep.sh` and Python 3.10+; Mini Codex/Claude Code share the installed hook/scanner. `python3 .security/scan.py all` runs `npm audit --omit=dev --audit-level=high --json` and `semgrep scan --config .security/semgrep.yml --error --strict --metrics off --disable-version-check --disable-nosem --json`. npm registry/network errors fail closed. Pre-commit scans index bytes and audits staged package files when those files or policy change. The local pre-PR/pre-deploy gate (`.security/local-gate.py`) and npm prepublishOnly run the full gate. Cursor installation uses `.cursor/install-security.sh`, which also runs the full gate.

Raw npm audit may exit 1 for the documented high findings above. The wrapper prints each finding and accepts only exact, unexpired fingerprints with a reason and remediation tracking. Never extend expiry or change a fingerprint without reviewing the finding; remove entries when remediated. The local gate (`.security/local-gate.py`) runs negative tests for new/changed high findings, outages, unsafe staged code hidden by unstaged edits, invalid rules and expired policy. Keep all scanner/agent setup files excluded from npm packages.

## Complete repository privacy and language gates

The privacy gate also checks raw Git author/committer headers and commit messages. New commits require GitHub noreply; history permits only GitHub noreply and the exact public tool identities documented by metadata.py. Mailmap cannot conceal private identities. Commit-msg scans messages for secrets; pre-push runs metadata, full-history Gitleaks and full dependency/code checks. Before merging, run `python3 .security/local-gate.py PR_NUMBER` from the reviewed PR checkout: it runs every gate plus this repository's tests (`.security/local-gate.json`) on the exact head in a clean worktree and records the result on that SHA as the `local-gate` commit status and a PR comment. Then `python3 .security/merge-pr.py PR_NUMBER` requires that recorded PASS from the owner on the exact head (GitHub Actions are not the merge gate), reruns full local gates, and merges with a matching-head condition. Public repositories also require the `local-gate` status in branch protection; private branch protection depends on the account plan, so there the command is an enforced agent workflow, not a GitHub-side access restriction.

The code gate includes checksum-pinned ShellCheck at warning/error threshold for shell files, including extensionless wrappers, and Clang Static Analyzer for C/Objective-C helpers on macOS. On macOS the local gate (`.security/local-gate.py`) runs the Clang analysis for native helpers; Linux reports the platform handoff explicitly. No source language is silently claimed as analyzed by Semgrep. Add language-appropriate checks before adding a new runtime language. All scanners run locally and report locations/rule names without source snippets. Runtime downloads and separately installed language environments require their own dependency audit; npm audit of the parent manifest alone does not cover them.
