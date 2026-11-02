# Infrastructure

> **Always check this file before making infrastructure or release decisions.**

This is the infrastructure of the Claude Code Starter Kit repository. It is a tooling repository: nothing here is deployed as a service. The only published surface is the documentation site.

---

## Environment Overview

```
 GitHub (dr-code/claude-code-mastery-project-starter-kit, public fork)
   |  main branch   <- pull requests only; the branch guard blocks direct commits
   |  docs/         -> GitHub Pages site (static files)
   |  .github/workflows/  CI (never run on this fork, see below)
   v
 Your machine (macOS)
   repo clone            run /new-project, /update-project, /convert-project-to-starter-kit from here
   ~/.claude/            global hooks, settings, registry, backups, Beacon index, plugins
   ~/.local/bin/         plannotator
   tessera (pipx)        editable install of the local Tessera repo
```

---

## Machine Setup (once per machine)

| Item | How it gets there | Check |
|------|-------------------|-------|
| 3 global hooks and the global `settings.json` entries | `/install-global` (asks before replacing a differing file) | `ls ~/.claude/hooks` |
| Beacon | installed by `kit-apply.sh` when missing | engine prints `tool: beacon` |
| Plannotator | the vendor installer (run it yourself; the assistant cannot pipe curl to bash here) | `plannotator --version` |
| Tessera CLI and plugin | `pipx install` from the Tessera repo, then the plugin | `claude plugin list` |
| Node 20, pnpm | manual | `node -v`, `pnpm -v` |

Set `STARTER_KIT_SKIP_INSTALL=1` to make the engine only report missing tools.

---

## Files the Kit Keeps in `~/.claude/`

| Path | Purpose | Safe to delete? |
|------|---------|-----------------|
| `starter-kit-projects.json` | Registry of projects (`{"projects":[...]}`), managed only by `scripts/registry.mjs` | Yes, but you lose the list |
| `starter-kit-source-path` | Where the kit is cloned, so the commands can find it | Yes, it is rewritten |
| `starter-kit-backups/` | Per-project backups made in backup mode (non-git folders) | Only after you have confirmed the converted project |
| `hooks/` | The 3 global hooks | No: the global `settings.json` points at them |

`STARTER_KIT_REGISTRY` overrides the registry path (used by tests).

---

## Release and Change Flow

There is no deploy step. Changes reach `main` like this:

1. Branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. `pnpm typecheck` and `pnpm test:unit` pass locally.
3. Secret scan of the staged files; confirm no personal name, username, or absolute home paths.
4. Commit (conventional format), push, open a pull request.
5. The user merges. Nothing is published or deployed without explicit approval.

Projects pick up kit changes by running `/update-project`, which opens a `chore/starter-kit-sync-*` branch in each project for review.

---

## Continuous Integration

| Fact | Status |
|------|--------|
| Workflow file | present under `.github/workflows/` |
| Has it ever run on the fork | **No.** Cause not confirmed (forks usually need Actions enabled by the owner). No repository setting was changed. |
| Where tests have run | macOS only (BSD `sed`/`awk`, bash 3.2) |
| Where tests have never run | Linux (GitHub `ubuntu-latest` uses `mawk` and GNU `sed`/`grep`); the engine and hook tests may differ there |
| Docker | The Docker CLI is installed locally but the daemon was not running, so container checks have not been run |

Treat a green local run as "passes on macOS", not "passes everywhere", until CI has run once.

---

## Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `STARTER_KIT_SKIP_INSTALL` | `kit-apply.sh` | `1` = report missing tools, do not install |
| `STARTER_KIT_REGISTRY` | `registry.mjs` | Alternate registry file (tests, experiments) |
| `CLAUDE_PROJECT_DIR` | project hooks | Set by Claude Code; the root of the open project |
| `SUPERPOWERS_CHECKOUT` | Tessera skills build tests | Path to a Superpowers clone (Tessera repo, not this one) |

This repository has no application secrets. `.env` files must never be committed.

---

## Documentation Site

`docs/` is published with GitHub Pages. The three documents `ARCHITECTURE.md`, `INFRASTRUCTURE.md`, and `DECISIONS.md` live there but are reference files for working on the kit; the website build does not read them.

---

## Monitoring

None. The signals are the test suite, the engine's `RESULT: changes=<n>` line (a second run must report `changes=0`), and `/projects-created` for the registry.

---

## Known Gaps (not verified)

- Hooks using `${CLAUDE_PROJECT_DIR}` have not been checked in a cloud session.
- CI has never run; tests have never run on Linux.
- The Go, Python, and framework modes of `/new-project` still have spec gaps that are not fixed.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-10-12 | Replaced the placeholder template with the kit's real environments, files, release flow, and CI status |
