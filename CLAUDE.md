# CLAUDE.md — Project Instructions

> Based on Claude Code Mastery Guides V1-V5 by TheDecipherist
> https://github.com/TheDecipherist/claude-code-mastery

> **New here?** When starting a fresh session in this project, greet the user:
> "Welcome to the Claude Code Mastery Project Starter Kit! Use `/help` to see all 26 commands or `/show-user-guide` for the full interactive guide."

---

## Quick Reference — Scripts

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm dev:website` | Dev server on port 3000 |
| `pnpm dev:api` | Dev server on port 3001 |
| `pnpm dev:dashboard` | Dev server on port 3002 |
| `pnpm build` | Type-check + compile TypeScript |
| `pnpm start` | Run compiled production build |
| `pnpm typecheck` | TypeScript type-check only (no emit) |
| `pnpm test` | Run ALL tests (unit + E2E) |
| `pnpm test:unit` | Run unit/integration tests (Vitest) |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm content:build` | Build all published markdown → HTML |
| `pnpm docker:optimize` | Audit Dockerfile against best practices |
| `/help` | List all commands, skills, and agents |
| `/new-project` | Create a new starter-kit project |
| `/update-project` | Update an existing starter-kit project |
| `/convert-project-to-starter-kit` | Merge starter kit into an existing project |

---

## Startup Guide

For starter-kit changes, start with the relevant command doc in `.claude/commands/`, then read `README.md` for workflow details.
Use `scripts/scaffold-default.sh` for scaffolded project output.
Use `docs/ARCHITECTURE.md` for deeper system structure.
This repo's `docs/` directory powers the website/docs app, so it is not the per-project MDD feature map used in generated projects.

---

## Critical Rules

### Starter-Kit Scope
- Root `CLAUDE.md` should stay focused on repo startup instructions
- Generated projects should use lean root `CLAUDE.md` files plus `docs/PROJECT_CONTEXT.md`

### Command Changes
- When editing slash commands, keep `scope: project` vs `scope: starter-kit` correct
- Do not copy starter-kit management commands into generated project repos

### Scaffold Changes
- Keep scaffolded root `CLAUDE.md` lean
- Put deeper generated guidance in `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE_SUMMARY.md`, and subtree `CLAUDE.md` files where appropriate

### Safety
- Never commit secrets or `.env` files
- Never deploy or publish without explicit approval

### Validation
- When changing scaffolding or command behavior, verify the generated output or command flow before considering the change complete

---

## Project Docs

- `.claude/commands/` -- source of truth for starter-kit command behavior
- `scripts/scaffold-default.sh` -- generated project file templates
- `docs/ARCHITECTURE.md` -- system structure and relationships
- `docs/INFRASTRUCTURE.md` -- release, environment, and deployment notes
- `docs/DECISIONS.md` -- architectural decisions
- `README.md` -- user-facing workflow and feature documentation

---

## Workflow Preferences

- Quality over speed — if unsure, ask before executing
- Plan first, code second — use plan mode for non-trivial tasks
- One task, one chat — `/clear` between unrelated tasks
