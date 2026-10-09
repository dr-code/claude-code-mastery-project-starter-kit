---
description: Update one or many existing projects to the latest starter-kit layer (commands, hooks, settings, managed blocks) — safe, branch-based, dry-run first
scope: starter-kit
argument-hint: [<project-path>] [--all] [--scan <dir>] [--dry-run] [--force] [--clean]
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion
---

# Update Starter Kit Projects

Bring existing projects in line with the current starter kit so every project has the same commands, hooks, `settings.json`, `.gitignore` entries, and managed `CLAUDE.md` blocks. The work is done by one engine, `$SOURCE/scripts/kit-apply.sh`, which reads `starter-kit-manifest.json`; this command adds target selection, safety, reporting, and git handling around it.

**Arguments:** $ARGUMENTS

**What this command never does**
- Never commits changes it did not make: a dirty working tree stops the update for that project.
- Never works on the project's current branch: changes go on a new `chore/starter-kit-sync-*` branch.
- Never merges the kit's own `CLAUDE.md` or `.claude/settings.json` into a project. They describe the kit repo. Projects get their `settings.json` from `templates/project-settings*.json` and their `CLAUDE.md` content from managed blocks only.
- Never touches files the kit does not own (custom commands, hooks, skills, agents).
- Never runs `git init` or `git add -A` on a folder that is not already a repo.

---

## Step 0 — Resolve Source (Starter Kit)

Find the starter kit source directory:

1. If CWD has BOTH `claude-mastery-project.conf` AND `.claude/commands/new-project.md` → use CWD as `$SOURCE`
2. Else read `~/.claude/starter-kit-source-path` → verify it still has both files
3. Else ask via AskUserQuestion: "Where is the starter kit cloned?" with a text input

Verify `$SOURCE/starter-kit-manifest.json` and `$SOURCE/scripts/kit-apply.sh` exist; if not, stop: "This starter kit is too old for /update-project. Pull the latest kit first."

Store as `$SOURCE`.

Parse flags from `$ARGUMENTS`:
- `--dry-run` → report only; stop after Step 3, change nothing
- `--force` → skip confirmation prompts (never skips the dirty-tree stop)
- `--clean` → run **Clean Mode** (below) after Steps 1-2
- `--all` → every registered project
- `--scan <dir>` → discover candidate projects under `<dir>`

---

## Step 1 — Select Targets

Pick the target list in this order:

1. **`<project-path>` given** → that one project.
2. **`--all`** → read `~/.claude/starter-kit-projects.json`, keep projects whose `path` still exists. If the file is missing or empty, say so and suggest `--scan`.
3. **`--scan <dir>`** → list immediate subdirectories of `<dir>` that contain `.claude/` or `.git`. Show a numbered table: name, git (yes/no), registered (yes/no), `.claude/` (yes/no). Ask via AskUserQuestion: "Update all N / Choose (type numbers) / Cancel". Never apply to a folder the user did not confirm.
4. **Nothing given** → registry picker: up to 4 most recent registered projects as options, plus "Other (type a path)".

### Validations (per target; a failure skips that target and continues)

1. Directory exists.
2. Not the starter kit itself (compare resolved paths of `$SOURCE` and `$TARGET`).
3. If not in `~/.claude/starter-kit-projects.json`, it is registered automatically in Step 6 (name = folder name). Registration is no longer a prerequisite.

---

## Step 2 — Pre-flight (per target)

```bash
git -C "$TARGET" rev-parse --is-inside-work-tree 2>/dev/null
git -C "$TARGET" status --porcelain
git -C "$TARGET" symbolic-ref -q --short HEAD
```

| State | Action |
|-------|--------|
| Git repo, clean, on a branch | Continue. Remember the current branch as `$ORIGINAL_BRANCH`. |
| Git repo, **uncommitted changes** | **STOP for this target.** Report: "`<name>` has N uncommitted files. Commit or stash them, then re-run." Never commit them for the user. Continue with the next target. |
| Git repo, detached HEAD | Stop for this target: "Check out a branch first." |
| **Not a git repo** | There is no git undo, so use backup mode: `BACKUP_DIR=~/.claude/starter-kit-backups/<name>-<YYYYMMDD-HHMMSS>`. Say so plainly and require confirmation (even with `--force`): "No git history here. Files will be backed up to `$BACKUP_DIR` before any change." Do NOT run `git init`: a baseline commit would stage everything in the folder. |

**Not yet converted:** if the target has no `.claude/` directory or no `CLAUDE.md`, stop for this target and say: "`<name>` hasn't been set up with the starter kit yet. Run `/convert-project-to-starter-kit <path>`." Conversion creates a security-only `CLAUDE.md`, asks how to treat existing files, and uses the same engine. `/update-project` only refreshes projects that already have both.

---

## Step 3 — Dry Run Report (per target)

```bash
bash "$SOURCE/scripts/kit-apply.sh" "$TARGET" --dry-run
```

This writes nothing, installs nothing, and does not scan. It prints, for commands, skills, agents, and hooks, how many files are new, updated, unchanged, and custom (yours, never touched) with the names of new and updated ones, then what it would do to `settings.json`, `.gitignore`, and the `CLAUDE.md` workflow block, which global tools are missing, and a final `RESULT: changes=<n>`.

Choose the profile with `--profile clean` if the project's `.claude/features.json` says `"language": "none"`; otherwise use the default.

Read the output for these cases and tell the user plainly:

- `WARNING globally-owned hooks listed here`: the project's `settings.json` lists hooks that are provided globally (block-secrets, verify-no-secrets, check-rulecatch) or by the Tessera plugin (Plannotator). Listing them again fires them twice. Offer `--fix-settings` in Step 4. The engine removes a hook only when its replacement is verified present on this machine (the global hook file exists and is wired in `~/.claude/settings.json`, or the Tessera plugin is installed); otherwise it keeps the hook and says so.
- `migrated N hook command(s)`: a project hook wired through `~/.claude/hooks/...` or a project-relative `.claude/hooks/...` path is rewritten to `bash "${CLAUDE_PROJECT_DIR}"/.claude/hooks/...` instead of being added a second time. The variable form works from any subfolder and on any machine; a project-relative path fails with "No such file or directory" whenever the Bash tool's working directory is a subfolder, and a `~/.claude` path needs the global install.
- `managed-ignore paths are already tracked by git`: ignoring a tracked path has no effect. Report it; do not untrack anything.
- `kit-management commands present`: suggest `--clean`.
- `tessera-plugin MISSING`: the real run installs it (this changes the machine, not just the project; say so before Step 5).

Then run the feature-file inventory below, and combine both into one report per target.

## Step 3b — Feature File Inventory

After the infrastructure diff above, also check for feature source files to update.

1. Read `$TARGET/.claude/features.json`
2. **If exists:** extract the list of installed features from `features` object
3. **If missing (legacy project):** auto-detect features from file presence:
   - `strictdb` in `package.json` dependencies → feature `mongo` (or `postgres` — StrictDB handles both)
   - `vitest.config.ts` exists → feature `vitest`
   - `playwright.config.ts` exists → feature `playwright`
   - `scripts/build-content.ts` exists → feature `content`
   - `Dockerfile` exists → feature `docker`
   - If any features detected, ask: "Detected features: [list]. Write manifest for future updates?" via AskUserQuestion
     - **Yes, write manifest** (Recommended) → create `.claude/features.json` with detected features
     - **No, skip** → continue without manifest

4. For each installed feature, read the feature definitions from `$SOURCE/.claude/commands/add-feature.md` (the Feature Definitions table)

5. For each file listed in the feature definition, compare `$SOURCE/<file>` vs `$TARGET/<file>`:
   - File exists in both, content differs → **UPDATED**
   - File exists in both, content identical → **UNCHANGED**
   - File exists in source only → **NEW** (file was added to the feature since installation)
   - File exists in target only → **CUSTOM** (user added it, don't touch)

6. Append feature file status to the diff report:

```
Feature Files:
  mongo:
    ↻ UPDATED:   scripts/db-query.ts
    = UNCHANGED: scripts/db-query.ts, scripts/queries/*
  vitest:
    = UNCHANGED: vitest.config.ts
  (N features, N files updated, N unchanged)
```

If no features installed or no feature files changed, show:
```
Feature Files: (none installed or all unchanged)
```

---

## Step 4 — Confirm (unless --force)

If `--dry-run` was given, print the reports and stop here: "Dry run only. No changes made."

For several targets, first print a one-line-per-project table (project, git state, `changes=<n>`, blockers such as "dirty working tree"), then ask once. For one target, ask directly.

Ask via AskUserQuestion:

"Apply these updates? Your custom files won't be touched."
- **Yes, update** (Recommended)
- **Show me the diffs first** — for each UPDATED file, show `diff` between `$SOURCE` and `$TARGET`, then ask again
- **No, cancel**

If a `WARNING globally-owned hooks` line appeared, ask a second question: "Remove the redundant hooks that are verified to be provided globally?" Yes (Recommended) passes `--fix-settings`; No leaves them and only reports.

If the user cancels: "Update cancelled. No changes made."

---

## Step 5 — Apply (per target)

### 5a. Branch (git projects)

```bash
cd "$TARGET"
BRANCH="chore/starter-kit-sync-$(date +%Y%m%d)"
git rev-parse --verify -q "$BRANCH" >/dev/null && BRANCH="$BRANCH-$(date +%H%M)"
git switch -c "$BRANCH"
```

Never apply on the original branch. For non-git projects, skip this step and pass `--backup-dir "$BACKUP_DIR"` below.

### 5b. Run the engine

```bash
bash "$SOURCE/scripts/kit-apply.sh" "$TARGET" [--profile clean] [--fix-settings] [--backup-dir "$BACKUP_DIR"]
```

This copies the kit-owned commands, skills, agents, and project hooks, generates or merges `settings.json` from the profile template, adds the managed `.gitignore` entries, inserts or replaces the workflow block in `CLAUDE.md` between its markers, checks Beacon, Plannotator and the Tessera plugin (installing what is missing), and runs `tessera scan`. It is safe to run again.

Set `STARTER_KIT_SKIP_INSTALL=1` to report missing tools without installing them.

If the engine exits non-zero, stop for this target, leave the branch in place, and report the error. Do not retry blindly.

### 5c. Feature File Updates

If Step 3b identified any **UPDATED** or **NEW** feature files:

- For each **NEW** file: create directories and copy from source
- For each **UPDATED** file: overwrite target with source version
- For **UNCHANGED** and **CUSTOM** files: skip

After copying, update the manifest `$TARGET/.claude/features.json`:
- For each affected feature, set `updatedAt` to current ISO timestamp
- Add any new files to the feature's `files` array

If no feature files were changed, skip this step entirely.

### 5d. Infrastructure Files

| File | If Missing in Target | If Exists in Target |
|------|---------------------|---------------------|
| `CLAUDE.local.md` | Copy from source | Skip |
| `claude-mastery-project.conf` | Copy from source | Skip |
| `docs/PROJECT_CONTEXT.md` | Create with starter template | Skip |
| `docs/ARCHITECTURE_SUMMARY.md` | Create with starter template | Skip |
| `docs/ARCHITECTURE.md` | Copy | Skip |
| `docs/INFRASTRUCTURE.md` | Copy | Skip |
| `docs/DECISIONS.md` | Copy | Skip |
| `.env.example` | Copy from source | Merge: add lines from source whose key name (before `=`) doesn't exist in target. |
| `.gitignore` | Handled by the engine (managed entries). Also ensure `.env`, `CLAUDE.local.md`, `_ai_temp/` are present. | Do NOT copy other lines from the kit's own `.gitignore`: it describes the kit repo. |
| `.dockerignore` | Copy from source | Merge: add lines from source that don't exist in target. |

If `docs/PROJECT_CONTEXT.md` is missing, create it with the standard starter template:

```markdown
# Project Context

## Key Commands
| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm test` | Run all tests |
| `pnpm build` | Build for production |
| `pnpm typecheck` | TypeScript type-check |

## Feature → Doc Lookup

| Working on... | Read first |
|---------------|------------|
| (Add entries here as you create docs with `/mdd <feature>`) | — |

## Common Gotchas

<!-- Add project-specific gotchas here as they are discovered -->

## Reference Docs
- Architecture: `docs/ARCHITECTURE_SUMMARY.md` (brief) · `docs/ARCHITECTURE.md` (full)
- Infrastructure: `docs/INFRASTRUCTURE.md`
- Decisions: `docs/DECISIONS.md`
- Transcripts: `docs/transcripts/`
```

If `docs/ARCHITECTURE_SUMMARY.md` is missing, create it with the standard starter template:

```markdown
# Architecture Summary

> Full architecture detail: `docs/ARCHITECTURE.md`

## System Overview

<!-- 1-paragraph description of what the system does -->

## Service Boundaries

<!-- Describe major services/layers and their responsibilities -->

## Data Flow

<!-- Describe how a typical request moves through the system -->

## Core Invariants

<!-- List the rules that must never be violated -->

## Key Decisions

<!-- Top 2-3 architectural decisions and their rationale -->
```

---

## Step 6 — Update Registry

All registry reads and writes go through `scripts/registry.mjs` in the starter kit (run it from the kit folder, or use the kit path saved in `~/.claude/starter-kit-source-path`). It reads every shape the file has taken, always writes `{"projects": [...]}`, backs the file up before repairing it, and refuses to overwrite a file that is not valid JSON. Never edit the registry by hand or rewrite it yourself.

```bash
node "$SOURCE/scripts/registry.mjs" touch --path "$TARGET"
```

This sets `updatedAt`, increments `updateCount`, and registers the project (profile `existing`) if it was not in the registry yet.

---

## Step 7 — Commit + Summary

Git projects:

```bash
cd "$TARGET"
git add -A
git commit -m "chore: sync project with Claude Code Starter Kit"
```

The working tree was clean before this command started, so the commit contains only what the sync changed. `.tessera/` and `.mcp.json` are ignored. If there is nothing to commit, report "Already up to date" and switch back: `git switch "$ORIGINAL_BRANCH" && git branch -d "$BRANCH"`.

Show a per-project summary:

```
=== Starter Kit Sync Complete ===

Project:  <name>  (<path>)
Branch:   chore/starter-kit-sync-YYYYMMDD   (was on: <ORIGINAL_BRANCH>)
Commit:   <hash>

Commands:  N new, N updated, N unchanged, N custom
Skills / Agents / Hooks: same breakdown
settings.json:  <engine line>
.gitignore:     <engine line>
CLAUDE.md:      workflow block <added/updated/unchanged>
Tools:          <engine lines>

Review:    git diff <ORIGINAL_BRANCH>..HEAD
Accept:    git switch <ORIGINAL_BRANCH> && git merge <branch>
Undo:      git switch <ORIGINAL_BRANCH> && git branch -D <branch>
```

Non-git projects: show `Backup: $BACKUP_DIR` and "To restore a file, copy it back from the backup folder (same relative path)."

After the last project, remind: run `/help` to see new commands, and ask Claude to run the Beacon skill-discovery step for projects where it has not been run.

---

## Edge Cases

1. **Already up to date** — `RESULT: changes=0` and no feature-file changes: report "Already up to date — no changes needed." No branch, no commit.
2. **Dirty working tree** — skipped with an explicit message; never committed, stashed, or reset for the user.
3. **Engine or git failure** — stop for that target, leave the new branch for inspection, never leave a half-written state without saying so. Other targets continue.
4. **Custom file with a kit file's name** — it shows as UPDATED in the dry run (content differs) and is backed up in non-git mode. Review the dry run before confirming.
5. **Tracked managed-ignore paths** (for example committed `.mdd/` audits) — reported, never untracked automatically.
6. **Many projects** — `--all` and `--scan` process targets one at a time and report per project; one failure does not stop the others.
7. **Kit repo as target** — refused.

---

## Clean Mode — `--clean`

**If `$CLEAN` is true, skip Steps 3-7 entirely and run this flow instead. Step 2 (pre-flight, branch) still applies: clean mode never runs on a dirty working tree.**

Clean mode scans a project for commands that have `scope: starter-kit` in their frontmatter — these are kit-management commands that should NOT be in scaffolded projects. Older versions of the starter kit copied all commands without filtering, so existing projects may have them.

### Clean Step 1 — Scan for starter-kit commands

Read every `.md` file in `$TARGET/.claude/commands/`. For each file, parse the YAML frontmatter and check for `scope: starter-kit`.

Build a list of files to remove.

### Clean Step 2 — Display findings

If no `scope: starter-kit` commands found:
```
No cleanup needed — this project has no starter-kit-scoped commands.
```
Stop here.

If found, display the list:

```
=== Clean: Starter-Kit Commands Found ===

These commands are kit-management tools that don't belong in project repos:

  1. new-project.md          — Create a new project with all scaffolding rules applied
  2. update-project.md       — Update a starter-kit project with the latest commands, hooks, skills, and rules
  3. install-global.md       — Install global Claude config
  4. convert-project-to-starter-kit.md — Merge starter kit into an existing project
  5. quickstart.md           — Interactive first-run walkthrough for new users
  6. projects-created.md     — List all projects created by the starter kit
  7. remove-project.md       — Remove a project from the registry
  8. set-project-profile-default.md — Set the default profile for /new-project
  9. add-project-setup.md    — Create a named project profile
  10. add-feature.md          — Add capabilities to an existing project

Found N starter-kit commands that should be removed.
```

### Clean Step 3 — Ask what to remove

Use AskUserQuestion:

"Which commands do you want to remove?"
- **Remove all N** (Recommended) — Delete all starter-kit-scoped commands
- **Let me pick** — Show each file and ask individually

**If "Remove all":** delete all listed files.

**If "Let me pick":** for each file, ask via AskUserQuestion (batch up to 4 at a time):
- "Remove `<filename>`? (<description>)"
  - Yes, remove it
  - No, keep it

### Clean Step 4 — Execute removal

For each file to remove:
```bash
rm "$TARGET/.claude/commands/<filename>"
```

### Clean Step 5 — Commit + Summary

```bash
cd "$TARGET"
git add .claude/commands
git commit -m "chore: remove starter-kit-scoped commands (clean)"
```

Display summary:

```
=== Clean Complete ===

Removed N starter-kit commands:
  - new-project.md
  - update-project.md
  - ...

Kept N project commands.

To undo: git revert HEAD
```

**If nothing was removed** (user said "no" to everything): skip the commit, note "No changes made."
