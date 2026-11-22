# Types and strict lint

Dev process steps 3 and 4 for Alexa-Echo-MCP (D16, D19), copied from the Toolbox's `docs/TYPES-AND-LINT.md` and scaled to this repository: TypeScript first, with a little JavaScript, Python and shell. Whole kinds of mistakes fail in seconds, before any test runs. Lauren Tan puts "lint rules, type systems, compilers" in the deterministic layers that come first, ahead of prose rules, and says to "start with a lint rule to prevent new occurrences of anti-patterns and then clean up those old patterns as well". Comments "go stale easily", so no new one lands; the old ones are cleaned in a separate job after this one merges.

## What runs

| Tool | Checks | Pinned in |
|---|---|---|
| TypeScript's checker (`tsc`) | Types over `src`, `tests`, `bin` and `scripts` in strict mode, with `checkJs` for the JavaScript, plus implicit returns, switch fall through, missing `override` and unreachable code | `.lint/package-lock.json`, options in `.lint/tsconfig.json` |
| ESLint with typescript-eslint | Bugs in TypeScript and JavaScript: undefined names, duplicate keys, unreachable code, unused variables, the typescript-eslint recommended bug rules | `.lint/package-lock.json`, rules in `.lint/eslint.config.mjs` |
| Ruff | Python bugs in `.security`: undefined names, unused imports, bad escapes, dead conditions | `.cursor/install-lint.sh` (version and checksum), rules in `.lint/ruff.toml` |
| Pyright | Python types: wrong calls, unknown module attributes, Python 3.10 features on the Mini's Python 3.9 | `.lint/package-lock.json`, rules in `pyrightconfig.json` |
| Import check | No file outside `tests/` loads a test, a fixture, a worktree or another repository | `.security/lint.py`, reading imports with `.lint/reader.mjs` |
| Suppression check | No comment turns a checker off (`@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `eslint-disable`, `# pyright:`, `# type: ignore`). ESLint runs with inline config off and Ruff with `--ignore-noqa`, so such comments do nothing anyway | `.security/lint.py` |
| Comment ban (step 4) | No new code comment in TypeScript, JavaScript, Python or shell, and no new Python docstring that nothing reads ([below](#the-comment-ban)) | `.security/lint.py`, `.lint/reader.mjs`; shell read by shfmt, pinned in `.cursor/install-lint.sh` |
| ShellCheck | Shell scripts, already in the gate (`.security/languages.py`), unchanged | `.cursor/install-shellcheck.sh` |

`python3 .security/lint.py gate` is the gate's step "Types and strict lint (Ruff, Pyright, ESLint, tsc, imports, comments)". In `.security/local-gate.py` it runs after the commit hook and after `Install dependencies` (`npm ci`, which moved out of `local-gate.json` so `tsc` can read the product's types), and before the security audit, the probes and every test. The gate's first step records each tool's pinned version. `.githooks/pre-commit` runs `python3 .security/lint.py staged` on the staged text with Ruff, Pyright, ESLint and the import, suppression and comment checks; `tsc` needs the whole tree, so it runs in the gate only. `.security/test_lint.py` is the gate's step "Lint step probes".

Install or update the tools with `bash .cursor/install-lint.sh`. They live in `~/.local/share/repo-lint/alexa-echo-mcp/` (Ruff and shfmt in versioned folders, the Node tools in a folder named for the lockfile's hash), and `lint.py` finds them there, never on `PATH`. This differs from the Toolbox on purpose: the Toolbox links its tools into `~/.local/bin` and its gate pins those links, so a second repository linking a different `eslint` or `tsc` there would break the Toolbox's gate, and the Toolbox's installer deletes any `node-<hash>` folder next to its own. `REPO_LINT_HOME` moves the folder for tests; point it at a folder of its own, never at `~/.local/share/repo-lint` itself, because the installer's cleanup removes every `node-<hash>` folder directly under it.

Not copied from the Toolbox: dependency-cruiser (the reader already parses every file's imports, and a second parser adds a dependency to pin), `lib/bounded_read.py` (a Toolbox guard for a stalled volume read) and the JXA globals file (no JXA here).

## The ratchet

Each finding is keyed by its tool, rule, file and a hash of its line's text, so moving code does not change it. `.lint/baseline.json` holds today's findings and only shrinks:

- A change fails on a finding absent from both the baseline and the PR base, including indirect breakage in untouched files. Editing a finding's line changes its key, so editing a line that holds an old comment makes the comment new: remove the comment while you are there. A renamed file keeps its old findings.
- A finding already on the PR base is a warning even in a touched file, so a merge commit is never blamed for main's existing finding. Counts matter: one existing occurrence does not excuse a second new one.
- A baseline that gains an entry fails. The one way in is a new check's first entries: `python3 .security/lint.py baseline` writes them only for a tool the baseline's `tools` list does not hold yet. When code is fixed, the gate warns that entries are stale; `python3 .security/lint.py prune` drops them and never adds one (`prune --resolved-only` also leaves every kept entry's line field as it was).
- With no PR base (the deploy gate), findings outside the baseline are warnings. `local-gate.py PR_NUMBER` fetches `origin/main` first and sets `LOCAL_GATE_BASE` to the merge base with it; if the fetch or the merge base fails, the gate stops with an error instead of dropping to warn-only.
- A change to a lint config, a pin or the lists of allowed comments needs an exact `.lint/policy-review.json` with `before`, `after` and a specific `reason` of at least 40 characters, from `policy_digest(base)` and `policy_digest()` in `.security/lint.py`. The note supplies the rationale; it never replaces the fresh reviewer. The PR that introduces `lint.py` needs none, since the base has nothing to weaken.

`python3 .security/lint.py counts` prints the findings per tool; `python3 .security/lint.py comments` lists every comment line the ban flags, for the cleanup jobs.

## Findings in today's code

Measured on main at 295a95e with this step, before any cleanup:

| Tool | Before this PR | After this PR (held by the baseline) |
|---|---|---|
| Ruff | not run | 0 |
| Pyright | not run | 0 |
| ESLint | not run | 0 |
| tsc | not run (only `src` was typed, by `npm run typecheck`, with no findings) | 3 |
| Imports | not run | 0 |
| Suppression | not run | 0 |
| Comments | not checked | 208 lines in 29 files |
| **Total** | | **211** |

The three `tsc` findings are real mismatches that the product's own `npm run typecheck` never saw, because it reads `src` only: two test doubles in `tests/client.test.ts` (lines 88 and 115) that omit three methods of the `AlexaRemoteLike` interface the tests never call, and `scripts/scan-package.js` line 10 passing a `Buffer` where `JSON.parse` is typed to take a string (it works, since `JSON.parse` converts it). They are in the baseline and fixed by a later job, not here.

## Rules dropped, and why

False alarms must be zero, so a rule that flags correct code is off (Peter: false alarms must be zero, quality first, cost second, time third; about 7:50 PM CT Nov 15 2026). Each tool was first run with its widest rule set over the whole repository and every rule's hits were read.

**tsc** (widest: every strict option below plus `noUnusedLocals`, `noUnusedParameters`; 141 errors). Kept: `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `allowUnreachableCode: false`, `allowUnusedLabels: false`. Dropped: `noPropertyAccessFromIndexSignature` (123 hits, every one a plain `a.b` on a `Record<string, unknown>` that Alexa's JSON needs), `noUncheckedIndexedAccess` (13 hits in `src` and tests, each after a length check, a regular expression match or a test's own assertion, so the index is there), `exactOptionalPropertyTypes` (its one hit is `sessionIdGenerator: undefined`, which the MCP SDK documents as the way to ask for stateless mode), `noUnusedLocals` and `noUnusedParameters` (ESLint's unused variable rule owns them, so one mistake is not counted twice).

**ESLint** (widest: every core rule that is not deprecated plus typescript-eslint strict and stylistic; about 1,100 hits in 36 rules). Kept: the Toolbox's core bug rules (undefined names, duplicate keys and cases, unreachable code, bad regular expressions, self assignment, unsafe negation and the like) for JavaScript, and typescript-eslint's `recommended` set for TypeScript, with the core rules it replaces switched off for TypeScript (`tsc` owns undefined names and redeclared names there). Dropped, after reading the hits: every style, ordering and size rule (`sort-keys`, `one-var`, `no-magic-numbers`, `curly`, `id-length`, `no-ternary`, `func-style`, `max-statements`, `complexity`, `init-declarations` and the like), `require-await` (15 hits: async functions that satisfy an interface returning a promise), `no-promise-executor-return` and `no-void` (the idioms `new Promise((resolve) => setTimeout(resolve))` and `void promise` for deliberately unawaited work), `no-useless-assignment`, `preserve-caught-error` (the message already carries the cause), `no-implicit-coercion`, `@typescript-eslint/no-explicit-any` (13 hits, tests casting a partial fake to the product's interface), `@typescript-eslint/no-non-null-assertion` (9 hits after a regular expression match), `@typescript-eslint/no-empty-function` (silent log callbacks in tests), `@typescript-eslint/no-dynamic-delete` (`delete process.env[NAME]` in tests) and `@typescript-eslint/ban-ts-comment` (the suppression check owns it). `no-unused-vars` ignores arguments, caught errors, rest siblings and names starting `_`.

**Ruff** (widest: `--select ALL`, about 1,400 hits): the Toolbox's reviewed rule list, which finds nothing here. Style families (quotes, annotations, docstrings, print, subprocess without `check`, test assertion style) flag correct code in `.security`, so they stay off, as in the Toolbox.

**Pyright** (18 errors in standard mode): `reportOptionalMemberAccess` (`spec.loader.exec_module` and `Popen.stdin`), `reportArgumentType` (`ModuleSpec | None`) and the other Toolbox filters are off for the same reason: the code has no annotations and the checks flag standard idioms. `reportAttributeAccessIssue` is kept for module attributes only (`os.nope`), not for `module.ROOT = ...` assignments in the probes, `reportCallIssue` for wrong argument counts and names, and `reportGeneralTypeIssues` for features that need Python 3.10. One trap this repository found: Pyright skips every folder whose name starts with a dot, and `.security` is one, so a plain run reports "0 errors" having read nothing. `lint.py` copies the Python files to folders without the leading dot (`.security` becomes `dot-security`), maps findings back to the real path and fails when Pyright reads fewer files than it was given. A probe plants an error in `.security` and expects it.

## The comment ban

Build step 4 (D19). Comments go stale, and agents copy them and lean on them; the fix for code that needs explaining is a better name or a test.

**What fails.** Each line of a new comment is one finding, `comments no-comment`: `//` and `/* */` (including JSDoc blocks) in TypeScript and JavaScript, `#` in Python and shell, whether on its own line or after code. A Python docstring nothing reads is `comments no-docstring`, per line, and a bare string used as a statement counts the same way.

**How it reads code, so text is never a false alarm.** TypeScript and JavaScript through the TypeScript compiler's own parser and comment ranges (`.lint/reader.mjs`), Python through `tokenize` and `ast`, shell through shfmt's bash parser. Strings, template strings, regular expressions, heredoc bodies, `$#`, `${#name}` and `a#b` are never comments. Only `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, `.py`, `.sh` and `.bash` files are read, plus files with no suffix whose first line is a python, sh, bash, dash or ksh shebang. Data and text files (JSON, YAML, TOML, Markdown, plist) are never read. A file the reader cannot parse is its own finding (`comments unreadable-javascript`, `comments unreadable-shell`), so no comment slips through unread (none today). zsh files are not read, since shfmt reads no zsh (none today).

**Allowed.**
- A shebang on line 1.
- A comment line holding a link to an upstream issue, pull request, bug or RFC: issues, pulls, merge requests and discussions on GitHub, GitLab and Codeberg, except Peter's own repositories (`sfls1397`), which are not upstream; `bugs.` and `bugzilla.` hosts and `show_bug.cgi`; crbug and the Chromium and Google issue trackers; rfc-editor.org and the IETF datatracker.
- License text: the file's leading comment block, when any of its lines holds `SPDX-License-Identifier:`, `Copyright`, `Licensed under`, `Permission is hereby granted` or `All rights reserved`.
- Comments a tool needs to work: Python's encoding line on line 1 or 2 (PEP 263) and ShellCheck's `# shellcheck shell=`, `source=` and `source-path=` directives. Nothing else qualifies: `# shellcheck disable=`, `# noqa` and `eslint-disable` turn a checker off rather than help it work, so they are the suppression check's findings, counted once.

**Docstrings count, unless the program reads them.** A docstring is prose for a reader and goes stale like a comment. A docstring the code reads is program text: the module docstring of a file that reads `__doc__` (`lint.py` prints it as usage) and a function or class docstring the same file reads as `name.__doc__`.

## The comment cleanup (done)

Dev process step 4 (D19) cleaned every comment the baseline held, in one job on main at 2a7b8f9: 208 comment lines in 29 files before, 0 after (`python3 .security/lint.py counts`), and `.lint/baseline.json` holds no comment entry, only the 3 `tsc` entries that a later job fixes. None of the 208 comments cited a Peter instruction or a lesson ID, so no citation had to move; the reasons that were worth keeping moved as follows.

Where each kind's "why" goes, as applied:

- Narration, field descriptions and history (PR numbers, dates, who found it) were deleted.
- A note about Alexa's behavior that the code depends on went into the name of the test that guards it. Three had no guard, so tests were added: `tests/login.test.ts` (the first alexa-cookie2 callback only says the proxy is up), the init callback test in `tests/client.test.ts` (alexa-remote2 repeats the callback after each cookie refresh) and the per device state timeout test (a just-changed device can stall Amazon's answer for a minute). Each was shown to fail with its guard removed.
- Behavior a user can see went into `README.md`: stale device state, the installer's wait before `launchctl bootstrap` (error 5) and `ALEXA_ECHO_MCP_HOME`.
- A docstring the program does not read was deleted; `local-gate.py` already prints its usage in its argument error.

Proof of no behavior change: syntax trees are equal with comments dropped for every changed TypeScript, JavaScript, Python and shell file (TypeScript through `ts.createSourceFile` tokens, Python through `ast.dump` without string statements, shell through `shfmt -mn`), taken before and after the deleting commit, which changes nothing else. A planted one line change in a TypeScript, a Python and a shell file was reported as different. The reason moves are a separate commit that touches only tests, `README.md` and this doc.

From here the ban holds: a new comment fails the gate and the commit hook, and the baseline only shrinks.

## Changing a pin or a rule

Edit `.lint/package.json` and regenerate `.lint/package-lock.json` (`npm install --package-lock-only` in `.lint`), or the Ruff and shfmt versions and checksums in `.cursor/install-lint.sh`, run the installer, then `python3 .security/lint.py counts`. Compare finding counts before and after a config edit and check that the intended diagnostic changed: an accepted but misspelled rule key can leave the wrong behavior in force. A pin or rule that finds new findings in today's code needs those fixed in the same PR, since the baseline never grows. The security scan audits the lint tools' dependencies at the high threshold with no exceptions.
