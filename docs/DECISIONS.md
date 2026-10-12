# Architectural Decisions

> Record WHY you chose X over Y. Future-you (and future-Claude) will thank you.

ADR-001 and ADR-002 describe projects the kit generates (the TypeScript and StrictDB conventions). ADR-003 onward describe the kit itself.

---

## Decision Template

When adding a new decision, copy this template:

```markdown
## ADR-XXX: [Title]

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by ADR-XXX | Deprecated

### Context
What is the issue or situation that motivated this decision?

### Decision
What is the change we're making?

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Option A | ... | ... |
| Option B | ... | ... |

### Consequences
What are the positive and negative results of this decision?
```

---

## ADR-001: TypeScript Over JavaScript

**Date:** (today)
**Status:** Accepted

### Context
AI-assisted development needs explicit type information to avoid guessing. JavaScript provides no type contracts, leading to runtime errors that are hard to trace.

### Decision
All new code MUST be TypeScript with strict mode. When editing existing JavaScript files, convert to TypeScript first.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| JavaScript + JSDoc | Less setup | AI still guesses, JSDoc can be wrong |
| TypeScript (strict) | Explicit contracts, better AI accuracy | Slightly more verbose |

### Consequences
- Claude can reason about types without guessing
- Refactoring is safer with compile-time checks
- New team members learn the codebase from type signatures

---

## ADR-002: StrictDB for All Database Access

**Date:** (today)
**Status:** Accepted

### Context
Without centralized database access, each file creates its own connection, leading to pool exhaustion. This starter kit originally shipped a custom database adapter that evolved into StrictDB — a standalone npm package and unified driver supporting MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, and Elasticsearch through a single API.

### Decision
All database access uses StrictDB directly. Install `strictdb` + your database driver, create a single `StrictDB` instance at app startup, and share it across the application. NEVER import native database drivers (`mongodb`, `pg`, etc.) directly.

### Consequences
- Single connection pool prevents exhaustion
- One place to add logging, metrics, retries
- Easy to mock for testing
- One API for all backends — switching databases requires only changing STRICTDB_URI
- Built-in sanitization, guardrails, and AI-first discovery (describe, validate, explain)
- StrictDB-MCP server gives AI agents direct database access with all guardrails enforced

---

## ADR-003: One Manifest and One Shared Engine

**Date:** 2026-10-12
**Status:** Accepted

### Context
The goal is uniformity: every new and existing project carries the same commands, skills, agents, hooks, settings, ignore entries, and CLAUDE.md blocks. Before this, the file lists lived separately in the scaffold scripts and in the prose of each command, and they drifted apart.

### Decision
`starter-kit-manifest.json` is the only list of what a project contains. `scripts/kit-apply.sh` applies it. The scaffold scripts, `/new-project`, `/update-project`, and `/convert-project-to-starter-kit` all call the engine rather than copying files themselves. The engine is idempotent and a second run must report `changes=0`.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Separate copy logic in each command | Each command is self-contained | Lists drift; a fix must be made in several places |
| One manifest, one engine (chosen) | One place to change; tests cover the engine once | The engine is Bash, so portability needs testing |
| Rewrite the engine in TypeScript | Easier to test | Needs a build step in every project that runs it |

### Consequences
- A new command or hook is added to the manifest once and reaches every project through `/update-project`.
- Tests assert the manifest matches the files on disk and the kit's own `.claude/settings.json` matches the default template.
- Linux behavior is unverified (see INFRASTRUCTURE).

---

## ADR-004: Hook Ownership and the `${CLAUDE_PROJECT_DIR}` Path Form

**Date:** 2026-10-12
**Status:** Accepted

### Context
Hook commands in `settings.json` are run from whatever folder the session is in. Relative paths (`.claude/hooks/x`) fail with exit 127 from a subfolder. Paths under `~/.claude` only work where the global install exists. A global Python hook that is missing exits 2 and blocks every tool call. Listing the same hook in both the global and the project settings runs it twice.

An earlier recommendation here chose project-relative paths and reintroduced the subfolder failure; it was caught and reverted, and the branches were redone.

### Decision
- Three hooks are global and are wired only in `~/.claude/settings.json`: `block-secrets`, `verify-no-secrets`, `check-rulecatch`.
- Six hooks are copied into each project and wired as `bash "${CLAUDE_PROJECT_DIR}"/.claude/hooks/<name>`: `lint-on-save`, `check-rybbit`, `check-branch`, `check-ports`, `check-e2e`, `check-env-sync`.
- Plannotator hooks come only from the Tessera plugin.
- The `clean` profile wires only `lint-on-save`.
- The engine finds an existing hook by script name, rewrites it to the template form, and removes redundant global or Plannotator entries only when the replacement is verified present.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Relative paths | Simple | Breaks from subfolders (this actually happened) |
| `~/.claude/hooks/...` for all nine | One copy to maintain | Projects fail on a machine without the global install |
| Copy all nine into projects | Self-contained | Secret-scanning hooks duplicate and drift per project |
| `${CLAUDE_PROJECT_DIR}` for six, global for three (chosen) | Works from any folder; secrets hooks stay central | Cloud sessions are not yet verified |

### Consequences
- Never put a global or Plannotator hook in a project's `settings.json`.
- The cloud-session behavior of `${CLAUDE_PROJECT_DIR}` is a known unverified item.

---

## ADR-005: Two Managed CLAUDE.md Blocks With Separate Owners

**Date:** 2026-10-12
**Status:** Accepted

### Context
Projects need the Superpowers plus Plannotator workflow and the Tessera graph policy in `CLAUDE.md`, without the kit overwriting a project's own rules.

### Decision
The kit owns `STARTER-KIT:WORKFLOW` (source: `templates/claude-blocks/workflow.md`). Tessera owns `TESSERA:START v3 ... TESSERA:END`, written only by `tessera scan`. Each tool edits only inside its own markers. Nothing else in `CLAUDE.md` is touched. The kit never copies its own `CLAUDE.md` into a project.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Append the kit's CLAUDE.md sections | Simple | The kit's file describes the kit repository, not a project |
| Kit writes the Tessera text too | One writer | Two sources of truth; the text drifts from the Tessera version |
| Two marked blocks, one owner each (chosen) | Safe updates; user text is preserved | Needs marker discipline |

### Consequences
- `/update-project` can refresh both blocks repeatedly with no manual merge.
- A project that opts out uses `--skip-claude-md`, which also skips the Tessera scan.

---

## ADR-006: Sync Safety Model

**Date:** 2026-10-12
**Status:** Accepted

### Context
Updating many existing projects must never lose work, commit work the kit did not make, or change a project's current branch.

### Decision
- Always run `--dry-run` first and show the result.
- A git project gets one `chore/starter-kit-sync-*` branch; the user reviews and merges.
- A dirty working tree stops the sync (untracked `.mcp.json`, `.tessera`, `.mdd` are not counted). The kit never commits, stashes, or resets for the user.
- A folder that is not a git repo is backed up to `~/.claude/starter-kit-backups/` and the kit never runs `git init` on it, because `git add -A` could stage dependencies, build output, or secrets.
- Core layer only for projects of other stacks; web-stack extras are added only to web projects.
- Blank doc templates (from `scaffold-clean.sh`) are created when missing; the kit's own docs are never copied into a project.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Commit straight to the current branch | Fast | Mixes sync changes with the user's work |
| Auto `git init` non-git folders | Gives a snapshot | Risks staging secrets and build output |
| Branch per project plus backups (chosen) | Reviewable and reversible | More steps |

### Consequences
- Each project needs a review and merge after a sync.
- Several rollout problems (duplicate hooks, copied kit docs into projects) were found and fixed under this model before reaching the main branch.

---

## ADR-007: Registry Managed by One Tool

**Date:** 2026-10-12
**Status:** Accepted

### Context
`~/.claude/starter-kit-projects.json` had taken several shapes over time, including a nested array that crashed the scaffold scripts. Multiple commands edited it by hand.

### Decision
Only `scripts/registry.mjs` reads or writes it (`normalize`, `list`, `add`, `touch`, `remove`). It reads every historic shape, always writes `{"projects":[...]}`, writes atomically, backs up before a repair or removal, and refuses to overwrite a file that is not valid JSON. `STARTER_KIT_REGISTRY` overrides the path.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Each command edits JSON inline | No new file | The cause of the corruption and the crash |
| One tool (chosen) | One tested code path | Commands must call the tool |

### Consequences
- A broken registry stops the command with a message instead of being silently replaced.
- All command docs reference the tool; none instruct editing the file.

---

## ADR-008: Branch Guard Resolves the Real Commit Target

**Date:** 2026-10-12
**Status:** Accepted

### Context
The original guard checked only the session folder's branch and skipped any `git -C` command. A session on `main` was blocked from committing in a feature-branch repo, and a commit into a `main` repo through `git -C` was never checked.

### Decision
`check-branch.sh` finds each `git commit` in the command line and judges the repository it targets, following `cd <dir> &&`, `git -C <dir>` (with `~`, quotes, and relative paths), and `NAME=value` assignments made in the same command. It allows an initial commit in a repository with no commits, respects `auto_branch = false`, and falls back to the session folder when a target cannot be resolved (fail safe).

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Check only the session folder | Simple | Wrong in both directions (the original bug) |
| Block all `git -C` commits | Safe | Blocks legitimate multi-repo work |
| Resolve the target (chosen) | Accurate | A variable set in an earlier tool call cannot be resolved |

### Consequences
- Instructions require literal absolute paths for commits when a variable came from an earlier command.
- The guard does not cover git plumbing commands such as `commit-tree`; the command docs forbid them instead.
- Covered by 25 tests in `tests/unit/check-branch.test.ts`.

---

## ADR-009: Install Missing Global Tools, With an Off Switch

**Date:** 2026-10-12
**Status:** Accepted

### Context
Every project should have Beacon, Plannotator, and the Tessera plugin available. A project that depends on a tool that is not installed fails confusingly.

### Decision
The engine checks each tool listed under `globalTools` in the manifest and installs what is missing, except where the vendor installer cannot be run by the assistant (Plannotator), in which case the exact command is reported for the user to run. `STARTER_KIT_SKIP_INSTALL=1` turns installs into reports only. Beacon skill discovery is optional and runs after the sync, with honest expectations about what it indexes.

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Only report missing tools | Never changes the machine | Projects arrive half-set-up |
| Always install (chosen, with off switch) | Uniform result | Installs software; needs the off switch for tests and CI |

### Consequences
- Tests set the skip variable.
- Closing or keeping the Tessera skills re-base (Tessera PR 17) is a separate cost decision and does not change this one.
