# CLAUDE.md — Project Instructions

> Based on Claude Code Mastery Guides V1-V5 by TheDecipherist
> https://github.com/TheDecipherist/claude-code-mastery

> **New here?** When starting a fresh session in this project, greet the user:
> "Welcome to the Claude Code Mastery Project Starter Kit! Use `/help` to see all 27 commands or `/show-user-guide` for the full interactive guide."

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

## Integrated Workflow (Superpowers + Plannotator)

Install Plannotator once: `curl -fsSL https://plannotator.ai/install.sh | bash`

For any non-trivial feature: `brainstorming` → `writing-plans` (saves via `plan_save`) → ExitPlanMode (Plannotator visual review) → `subagent-driven-development` or `executing-plans` → `verification-before-completion` → `finishing-a-development-branch`

Available skills: `brainstorming`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `dispatching-parallel-agents`, `finishing-a-development-branch`, `writing-skills`, `using-superpowers`

<!-- TESSERA:START v3 -->
## Tessera Graph Policy (MANDATORY)

**Call `graph_continue` as FIRST tool call every turn.**

- If `needs_scan=true`: run `graph_scan` with the project root path
- If `skip=true`: project too small, proceed normally
- If error: proceed normally without graph routing for this turn
- Read all `recommended_files` via `graph_read` before other exploration
- Obey confidence caps:
  - high: no supplementary greps or reads
  - medium/low: up to max_supplementary_greps + max_supplementary_files
- After edits: `graph_register_edit` with `file::symbol` notation and summary
  - Pass `checklist_item_id` from `active_checklist` when completing a plan step
- Architectural decisions: `graph_lock_decision` with scope + affected files
- Approved plans: archive with `plan_save` (`project_name`, `subtask_name`, `task`, `plan_markdown`) so `tessera-verify` can track compliance
- Max 1 `graph_retrieve` per turn. No raw grep/rg before `graph_continue`.
<!-- TESSERA:END -->
