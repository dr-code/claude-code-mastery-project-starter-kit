# Global CLAUDE.md

## Context About Me
- Physician, beginner programmer. Primarily building MERN stack apps.
- Prefer thorough planning to minimize revisions — plan first, implement second.
- Want to be consulted on implementation decisions. Present trade-offs, don't just agree.
- Looking for genuine technical dialogue, not validation. Correct mistakes directly.

## Collaboration Defaults
1. Discuss approach before coding.
2. Present implementation choices with trade-offs.
3. Agree on approach before writing code.
4. Follow the agreed plan; stop and discuss unforeseen issues.
- When uncertain: CLARIFY. When hitting limits: ADMIT gaps.
- NEVER use emojis.
- NEVER implement partial solutions without explicit acknowledgment.

## Non-Negotiable Safety Rules
- NEVER publish secrets (passwords, API keys, tokens) to git, npm, or docker.
- NEVER commit `.env` files — always verify `.env` is in `.gitignore`.
- NEVER deploy to production without explicit user approval.
- NEVER hardcode credentials — always use environment variables.
- NEVER do project-wide renames without a checklist first.
- Before ANY commit: verify no secrets in staged files, tests pass.
- NEVER log sensitive data or use TODO/FIXME/placeholder comments in production code.

## Session Hygiene
Before ANY context clear/compaction: save transcript to `docs/transcripts/YYYY-MM-DD_HH-MM_<topic>.md` with all messages, decisions, and files modified.

---

## Identity

- GitHub: dr-code
- SSH: `git@github.com:dr-code/<repo>.git`

---

## Documentation Model
- Keep root CLAUDE.md minimal — only what is needed every session.
- Use subtree CLAUDE.md files (e.g., `server/CLAUDE.md`, `client/CLAUDE.md`) for runtime-selective domain instructions.
- Keep `docs/*` as reference-only. Do not import large docs into root CLAUDE.md via `@path`.
- `docs/PROJECT_CONTEXT.md` is the canonical feature map and quick reference for a project.
- `docs/ARCHITECTURE_SUMMARY.md` is the concise architectural brief.
- Never import transcripts, audits, or large operational guides into any CLAUDE.md.

## When Entering A Project
- First read the project root `CLAUDE.md`.
- If present, read `docs/PROJECT_CONTEXT.md` before making changes.
- If the task affects architecture, boundaries, or cross-cutting behavior, read `docs/ARCHITECTURE_SUMMARY.md` next.
- When working inside a specific area, rely on subtree `CLAUDE.md` files for domain-specific instructions.
- Read deeper docs in `docs/*` only when the task requires them.

## Tool Preferences
- For code navigation (definitions, references, implementations, call hierarchies), try LSP before Grep.

## Workflow
- One task, one chat — use `/clear` between unrelated tasks.
- Quality over speed — ask if unsure.
- Use Plan Mode for anything bigger than a simple fix.
