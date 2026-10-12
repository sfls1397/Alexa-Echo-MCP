# Application privacy and security review

Reviewed during the October 12, 2026 Path 2 Entrypoint B Codex standardization. Base commit: e7d6a18f7aef66dca249847480cde00590dae754. Candidate changes are described below; this document alone does not claim they are deployed.

Bearer authentication, AWS session lifecycle, Keychain storage and logging reviewed. Large sessions use immutable bounded stdin-written chunks and an integrity-checked manifest; failed writes preserve the previous session and clean partial chunks. Legacy session reads remain supported. alexa-remote2 logging remains disabled. Four exact previously approved high dependency findings remain unresolved until their existing expiry; production audit is not vulnerability-free. No live device action was run.

Scope: tracked source and scripts, raw Git metadata and full-history patch scans, production dependency manifests, actual package file inventory, local authentication boundaries, credential/logging paths, local data permissions, and separately managed runtime components where present. Scanner PASS is a limited set of checks, not a guarantee against all vulnerabilities. This was not an external penetration test or exhaustive formal verification. Live personal content was not copied into this repository, PRs or Notion.

Evidence: repository dependency/code gates and their negative enforcement tests; local build and relevant application tests; disposable Keychain create/update/escaping/large-session readbacks with cleanup; local HTTP authorization probes; ShellCheck and macOS Clang where applicable. Reviewed historical public automation identities remain exact; prospective commits require GitHub noreply.
