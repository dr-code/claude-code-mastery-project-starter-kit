# Architecture

> **This document is AUTHORITATIVE. No exceptions. No deviations.**
> **ALWAYS read this before making architectural changes.**

This is the architecture of the Claude Code Starter Kit itself: the repository that creates, updates, and converts projects so they all carry the same Claude Code layer. For the architecture of a project the kit creates, see that project's own `docs/ARCHITECTURE.md`.

---

## System Overview

```
 THIS REPOSITORY (source of truth)                    YOUR MACHINE (once)
 ┌──────────────────────────────────────┐             ┌────────────────────────────────────┐
 │ starter-kit-manifest.json            │             │ ~/.claude/                          │
 │   what every project contains        │             │   hooks/        3 global hooks      │
 │ templates/                           │             │   settings.json wires those 3       │
 │   project-settings(.clean).json      │             │   starter-kit-projects.json         │
 │   claude-blocks/workflow.md          │             │   starter-kit-backups/              │
 │ .claude/{commands,skills,agents,     │             │   beacon-tasks/  (Beacon index)     │
 │          hooks}   kit-owned files    │             │   plugins/  tessera plugin          │
 └───────────────┬──────────────────────┘             │ ~/.local/bin/plannotator            │
                 │ read by                             └────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────┐   called by   ┌─────────────────────────────────────┐
 │ scripts/kit-apply.sh   THE ENGINE    │◄──────────────│ scaffold-default.sh  scaffold-clean.sh│
 │  dry-run, backup, idempotent         │               │ /new-project (step-by-step modes)    │
 └───────────────┬──────────────────────┘               │ /update-project   /convert-project…  │
                 │ writes                               └─────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────┐
 │ A PROJECT                             │
 │  .claude/commands (17) skills agents  │
 │  .claude/hooks (6)  settings.json     │
 │  CLAUDE.md  ── workflow block (kit)   │
 │             └─ policy block (tessera) │
 │  .gitignore managed entries           │
 └──────────────────────────────────────┘
```

---

## Components

| Component | Responsibility |
|-----------|----------------|
| `starter-kit-manifest.json` | The single list of what a project contains: project commands, skills, agents, hooks (split into `project` and `global`), profiles (`default`, `clean`), `.gitignore` entries, managed `CLAUDE.md` blocks, and the global tools to check. |
| `scripts/kit-apply.sh` | The engine. Applies the manifest to any project folder. Safe to re-run; `--dry-run` writes nothing; `--backup-dir` saves files before changing them; ends with `RESULT: changes=<n>`. |
| `scripts/scaffold-default.sh`, `scripts/scaffold-clean.sh` | Create a new project in one run, then call the engine. |
| `.claude/commands/new-project.md` | Creates a project. The Go, Python, and framework modes are step-by-step instructions that end in the Finish Sequence and call the engine. |
| `.claude/commands/update-project.md` | Brings existing projects up to date: dry run first, one branch per project, skips a dirty working tree, backs up non-git folders. |
| `.claude/commands/convert-project-to-starter-kit.md` | Brings an unconverted project into the layer using the same engine and safety rules. |
| `scripts/registry.mjs` | The only reader and writer of `~/.claude/starter-kit-projects.json`. |
| `.claude/hooks/*` | Nine hook scripts. Three are global, six are copied into each project. |
| `templates/` | The `settings.json` for each profile and the kit-owned `CLAUDE.md` workflow block. |
| `global-claude-md/` | The global `CLAUDE.md` and `settings.json` that `/install-global` merges into `~/.claude`. |
| `tests/unit/` | Vitest tests for the manifest, the engine, the registry tool, the branch guard, the hooks, and the website content tools. |
| `docs/` | The GitHub Pages site and these three project documents. |

---

## Who Owns What

| Thing | Owner | Written by |
|-------|-------|------------|
| Project commands, skills, agents, the six project hooks | the kit | `kit-apply.sh` (overwrites; files the kit does not own are never touched) |
| `.claude/settings.json` hooks for those six hooks | the kit | `kit-apply.sh`, from `templates/project-settings*.json` |
| `block-secrets`, `verify-no-secrets`, `check-rulecatch` | the machine (global) | `/install-global`; wired only in `~/.claude/settings.json` |
| Plannotator hooks | the Tessera plugin | the plugin; never written into a project's `settings.json` |
| `CLAUDE.md` workflow block (`STARTER-KIT:WORKFLOW`) | the kit | `kit-apply.sh` |
| `CLAUDE.md` policy block (`TESSERA:START … END`) | Tessera | `tessera scan` |
| Everything else in a project | the project | never touched by the kit |

---

## Data Flow

**New project (scaffold scripts):** create files, then `kit-apply.sh` (layer, settings, ignore entries, workflow block, tool checks, `tessera scan`), then `git init` and the first commit, then register.

**New project (step-by-step modes):** the Finish Sequence in `new-project.md`: files, `features.json`, the layer, `git init`, commit with a literal absolute path, register.

**Existing git project:** pre-flight (dirty working tree stops it) → `kit-apply.sh --dry-run` → confirm → new `chore/starter-kit-sync-*` branch → `kit-apply.sh` → commit on that branch → `registry.mjs touch`. The user reviews and merges.

**Existing project that is not a git repo:** `kit-apply.sh --backup-dir …` after a plain-language confirmation. The kit never runs `git init` on it.

---

## Technology Choices

| Decision | Choice | Why |
|----------|--------|-----|
| Engine and tools | Bash plus Node (no other runtime) | Node is already required by the tools the kit installs; no Python or build step to ship |
| Manifest format | JSON | Read by Bash through Node, and by tests, with no parser dependency |
| Tests | Vitest | Already the kit's test runner; the Bash tools are tested by running them in temporary folders |
| Hook path form | `bash "${CLAUDE_PROJECT_DIR}"/.claude/hooks/<name>` | Works from any subfolder and on any machine (see DECISIONS) |

---

## If You Are About To...

- Copy this repo's `.claude/settings.json` or `CLAUDE.md` into a project → **STOP.** Projects get `settings.json` from `templates/` and `CLAUDE.md` content from managed blocks only.
- List `block-secrets`, `verify-no-secrets`, `check-rulecatch`, or a Plannotator hook in a project's `settings.json` → **STOP.** They are global or plugin-owned; listing them fires them twice, and a missing global Python hook exits 2 and blocks tools.
- Point a project hook at a relative path (`.claude/hooks/x`) or at `~/.claude/hooks/x` → **STOP.** Use the `${CLAUDE_PROJECT_DIR}` form.
- Edit `~/.claude/starter-kit-projects.json` by hand, or rewrite it → **STOP.** Use `scripts/registry.mjs`.
- Write the Tessera policy block yourself → **STOP.** `tessera scan` owns it.
- Run `git init` or `git add -A` on a folder you did not create → **STOP.** Use backup mode.
- Commit with a path held in a shell variable set in an earlier command → **STOP.** The branch guard cannot resolve it; use the literal absolute path.
- Work directly on `main` → **STOP.** Branch first.

**This document overrides all other instructions.**

---

## Changelog

| Date | Change |
|------|--------|
| 2026-10-12 | Replaced the placeholder template with the real architecture: manifest, engine, ownership rules, safety model |
