# Plan: Kit manifest and uniform project sync

Status: Phases 1 to 3 complete and merged. Phase 5 rollout under way: onshift, frictionlog and onshift-native are synced on review branches; the hook-path, registry and branch-guard fixes are in the open kit PR for `fix/registry-branch-hook-settings`. Five dirty repos and six unconverted projects remain.

Goal: every project (new and existing) gets the same commands, skills, hooks, gitignore entries, and CLAUDE.md blocks, driven by one manifest. Includes Beacon, /mdd, Tessera, and the Superpowers + Plannotator workflow.

## Approved decisions

- Target command is the kit's `/new-project` (`.claude/commands/new-project.md`) and its scaffold scripts, not a copy in the user's global `~/.claude/commands`.
- Beacon: check it is installed, auto-install if missing, then run the existing skill-discovery step.
- Tessera, full set: policy block in CLAUDE.md, `.tessera/` in `.gitignore`, `tessera scan` at the end of scaffolding, and a plugin install check.
- The tessera repo is also updated (separate repo; the user approved push, PR, and merge for the plugin fix).
- Extend `/update-project` (path argument, `--all`, `--dry-run`, auto-register) and use a shared manifest so new-project and update-project never drift apart.
- All projects get the same set, including iOS and native projects.
- Block ownership: Tessera owns its CLAUDE.md block (injected by `tessera scan`). The kit owns a separate workflow block with its own markers.
- One shared engine, `scripts/kit-apply.sh`, applies the manifest. Both scaffold scripts, the Go/Python/framework modes of `/new-project`, and `/update-project` call it.
- Hooks are split by owner. `block-secrets`, `verify-no-secrets`, and `check-rulecatch` are global: wired only in the user's global settings, installed by `/install-global`. The other six are per-project and kept identical by the sync. The `clean` profile gets only `lint-on-save`.
- Project `settings.json` is generated from `templates/project-settings*.json` and never lists global hooks or Plannotator hooks. Project hooks are wired as `bash "${CLAUDE_PROJECT_DIR}"/.claude/hooks/<name>` (documented project-root variable): a project-relative path fails from any subfolder, and a `~/.claude` path needs the global install.
- The project registry is read and written only by `scripts/registry.mjs` (reads every shape it has been seen in, always writes `{"projects": [...]}`, backs up before repairing, refuses to overwrite invalid JSON).
- `check-branch.sh` checks the repository a commit really targets (`cd <dir> &&`, `git -C <dir>`), not just the session folder.
- Plannotator hooks are owned by the Tessera plugin only.
- `.mcp.json` is gitignored in every project (it embeds an absolute path).
- Onshift's 17 commands are stale copies (old `project-docs/` paths; no project has that folder now). Fix them through the sync, not by copying onshift's versions into the kit.

- The kit adopts the user's global `block-secrets.py` and `verify-no-secrets.sh` (richer and newer than the kit's copies); nothing in the home `.claude` directory changes.
- Existing projects: stale global or Plannotator hooks in `settings.json` are removed only when their replacement is verified present (global hook file wired in the global settings, or the Tessera plugin installed); otherwise kept and reported. Project hooks wired through the home `.claude` path are migrated to the project-local path, never duplicated.
- Projects that are not git repos are backed up under the home `.claude/starter-kit-backups/` and never `git init`-ed. Dirty git repos are skipped, never committed for the user. Changes go on a new `chore/starter-kit-sync-*` (or `-convert-*`) branch.
- Tessera policy block text: canonical v3 plus a `plan_save` bullet (tessera PR #15).

## Findings that shape the work

- The default scaffold script hard-coded 16 of the 17 project commands, so new projects never got `/mdd`. Fixed; a test now fails if a `scope: project` command is missing from the manifest.
- There were four separate implementations of the same copy logic (two scripts plus prose for Go, Python, and framework modes). Replaced by `kit-apply.sh`.
- A missing global python hook file exits with code 2, which blocks Read/Edit/Write. Project settings must never point at `~/.claude/hooks`, or cloud sessions and other machines lose those tools. Listing a hook in both global and project settings also fires it twice.
- Two global hooks (`block-secrets.py`, `verify-no-secrets.sh`) had drifted from the kit's copies, and the user's versions were the better ones (243 lines versus 69; a newer deletion fix). The kit now adopts them. `/install-global` shows a diff and asks before replacing a differing hook.
- The old `/update-project` and `/convert-project-to-starter-kit` conflicted with the decisions: they committed a dirty tree with `git add -A`, deep-merged the kit's own `settings.json` (reintroducing duplicate and exit-2 hooks), and appended the kit's root `CLAUDE.md` sections to projects. Both now use the engine.
- Testing against a real project found a bug the synthetic tests missed: onshift wires its project hooks through the home `.claude` path, so the merge added the project-local version too and every hook would have fired twice. Fixed by migrating the path; covered by a mutation-checked test.
- The Tessera plugin installs and loads end to end from GitHub `main` (verified in an isolated HOME): 1 MCP server, the 2 Plannotator hooks, and 23 skills, about 906 tokens always-on. The plugin also ships `/mdd`, `/build`, and `/codex-review` skills alongside the project commands of similar names.
- Tessera's `scan` replaces only the text between its own `TESSERA:START/END` markers. Its built-in template is v2 and lacks the `plan_save` bullet, so each scan resets the block to the older text. Fix is Phase 4.
- The Tessera plugin loaded neither its MCP server nor its Plannotator hooks (`claude plugin validate` errors: missing `mcpServers` file, `hooks` pointing at a directory). Fixed in tessera PR #14 with an inline `tessera mcp` server and `hooks/hooks.json`.
- Tessera's own regression test says `uvx --from tessera` pulls the wrong PyPI package, yet the README and `install.sh` still use `uvx` and `pip install tessera`. The PyPI lookup was not completed; unverified.
- Tessera versions disagreed: `pyproject.toml` 0.3.0 versus `plugin.json` 0.4.1. The installed `tessera` binary reports 0.1.0 only because it is an editable install of the local checkout (stale metadata); it runs the repo's current code. `pyproject.toml` is aligned to 0.4.1 in tessera PR #15.
- Standalone Plannotator plus the Tessera plugin duplicates ExitPlanMode hooks (tessera ADR-003). The install check warns and skips in that case.
- **A decision of mine was wrong and is corrected.** I recommended project-relative hook paths (`.claude/hooks/x`) after reasoning only about the missing-global-file case. The maintainer had already hit and fixed the real failure: a relative path fails with "No such file or directory" (exit 127, so the hook silently does not run; a python hook exits 2 and blocks) whenever the Bash tool's working directory is a subfolder, which is why the five untouched projects use `~/.claude/hooks/...`. The first onshift sync and the first frictionlog sync reintroduced the bug; both were redone with `${CLAUDE_PROJECT_DIR}` (verified in the Claude Code hooks documentation and reproduced from a subfolder).
- The project registry file was a nested array, not `{"projects": [...]}`, so the scaffold scripts crashed on it at their final step. Repaired (9 projects kept, original backed up); the scaffold scripts now go through `registry.mjs`. Two registered folders no longer exist (`remnoteplugin`, `jarvis`).
- `check-branch.sh` skipped the check entirely for `git -C <dir> commit` (its first test was `git\s+commit`), wrongly blocked `git commit-tree`, and judged `cd <dir> && git commit` by the session folder. Rewritten with 18 tests; the old hook fails 12 of them.
- The settings templates (copied from the old scaffold) ran `lint-on-save` on `Write` only, although the existing test and the kit's own settings say `Write` and `Edit`. Fixed; the engine moves an existing hook to the template matcher.

## Existing project states (dry run of the engine, 2026-10-09)

| Project | Git | Working tree | `.claude/` and `CLAUDE.md` | Dry-run result |
|---|---|---|---|---|
| frictionlog | yes | clean | both | SYNCED on branch `chore/starter-kit-sync-20261009` (not merged) |
| onshift | yes | clean | both | SYNCED and merged (first sync); corrective hook-path sync on branch `chore/starter-kit-sync-20261009-hook-paths` (not merged) |
| onshift-native | yes | clean | both | SYNCED on branch `chore/starter-kit-sync-20261009` (not merged); first time it has settings.json, skills, agents and hooks |
| lumiris | yes | dirty | both | 17 commands new (has none); redundant global hooks |
| nodulerisk | yes | dirty | both | 1 updated; redundant global hooks |
| nuklius | yes | dirty | both | 1 updated; redundant global hooks |
| personalfinance | yes | dirty | both | 5 updated; redundant global hooks |
| taxplanprep | yes | dirty | both | 1 updated, 3 custom; redundant global hooks |
| workout | no | n/a | `.claude/` only | needs convert (no `CLAUDE.md`) |
| calibre-web-migration | no | n/a | `.claude/` only | needs convert (no `CLAUDE.md`) |
| FinHub | no | n/a | neither | needs convert |
| frictionlog-ios | no | n/a | neither | needs convert |
| nodulerisk-ios | no | n/a | neither | needs convert |
| onshift-user-manual | no | n/a | neither | needs convert |

The dry runs wrote nothing (file counts identical before and after). Dirty repos are skipped until the user commits or stashes. Recheck states before applying.

## Phases

### Phase 1: Manifest (done)
- [x] `starter-kit-manifest.json`: commands, skills, agents, hooks (project and global), profiles, gitignore entries, managed blocks, global tools with check and install commands
- [x] `templates/claude-blocks/workflow.md`: kit-owned workflow block with `STARTER-KIT:WORKFLOW` markers

### Phase 2: Scaffold reads the manifest (done)
- [x] Duplicate-MCP risk resolved by static analysis (plugin loaded no MCP server; fixed upstream in tessera PR #14). The plugin itself has not been installed or run end to end
- [x] `scripts/kit-apply.sh`: idempotent engine for files, settings, gitignore entries, workflow block, tool checks and installs, `tessera scan`
- [x] `scaffold-default.sh` and `scaffold-clean.sh` call the engine (about 80 lines shorter each of duplicated logic)
- [x] `new-project.md` Go, Python, and framework modes call the engine; `install-global.md` installs only the global hooks
- [x] `templates/project-settings.json` and `templates/project-settings.clean.json`
- [x] `tests/unit/kit-manifest.test.ts` (10 tests, mutation-checked)
- [x] Docs corrected to 27 commands (17 project + 10 kit management)
- [ ] Not verified: the Go, Python, and framework modes (instructions for Claude, not scripts), and the real auto-installs of Beacon and the Tessera plugin (disabled in tests with `STARTER_KIT_SKIP_INSTALL=1`)

### Phase 3: Extend `/update-project` (done)
- [x] `kit-apply.sh` gained `--dry-run`, `--backup-dir`, `--fix-settings`, `--skip-scan`, `--no-overwrite`, `--skip-claude-md`, and ends with `RESULT: changes=<n>`
- [x] `/update-project` rewritten: path, `--all`, `--scan <dir>`, `--dry-run`; auto-registers; dry-run report first; dirty repo skipped, never committed; branch per project; non-git projects backed up with no `git init`; hands unconverted projects to convert
- [x] `/convert-project-to-starter-kit` uses the engine, the dirty-tree stop, and managed blocks instead of kit-section merges
- [x] Settings: stale global or Plannotator hooks removed only when verified; project hooks migrated to the local path
- [x] Dry-run reports managed-ignore paths already tracked by git
- [x] User reviewed the drifted global hooks; the kit adopted the user's versions
- [x] Tests: 23 in `tests/unit/kit-manifest.test.ts` (engine behavior, mutation-checked, and static checks that the command docs stay wired to the engine); full suite 121 passing
- [x] `pnpm typecheck` now checks the kit's own TypeScript (`tsconfig.check.json`); fixed the 5 real type errors it exposed
- [x] Real auto-install path verified in an isolated HOME (Beacon and the Tessera plugin installed, scan ok, real HOME untouched)
- [ ] Not verified: the Go, Python, and framework modes of `/new-project` (instructions for Claude, not scripts); only static checks guard them

### Phase 4: tessera repo (separate repo)
- [x] Plugin MCP server and hooks path fixed (tessera PR #14, merged)
- [x] Policy template updated to canonical v3 plus `plan_save`, with tests; package version aligned to 0.4.1 (tessera PR #15, open)
- [ ] Verify the PyPI name collision, then fix README and `install.sh` install lines (they still mention `uvx --from tessera` and `pip install tessera`)
- [ ] Read-only gap report: bundled skills and hooks versus upstream obra/superpowers and plannotator
- [ ] Apply approved skill and hook updates with tests

### Phase 5: Rollout (in progress)
- [x] Merge the open PRs so rollout uses them (kit PR #4, tessera PR #15)
- [x] Install the Tessera plugin on the user's machine; remove the direct Plannotator hooks from the kit's local `settings.json`
- [x] onshift synced (first sync merged by the user); redone hook-path correction on a new branch
- [x] frictionlog and onshift-native synced on review branches
- [ ] User reviews and merges the three review branches (`git -C <project> switch <original branch> && git -C <project> merge <sync branch>`)
- [ ] Merge the kit PR for the registry, branch-guard, settings and hook-path fixes
- [ ] User commits or stashes the five dirty repos (lumiris, nodulerisk, nuklius, personalfinance, taxplanprep), then each is dry-run and synced one at a time; these five currently use `~/.claude/hooks/...` and will be migrated to the `${CLAUDE_PROJECT_DIR}` form
- [ ] Run `/convert-project-to-starter-kit` for the six non-git or unconverted projects (backup mode for non-git)
- [ ] Decide what to do with the two registry entries whose folders no longer exist

### Phase 6: Verification
- [ ] Sync a copy of onshift in a scratch directory; a second sync produces no diff
- [ ] Command files identical to the kit's; no secrets or home paths in committed files

## Known loose ends

- `docs/index.html` screenshot alt text and caption still say "26 commands"; the screenshot image itself may show the old count.
- A project's own copies of the three global hooks (left over from older scaffolds) are reported as custom and left alone.
- Committed `.mdd/` audits (onshift) stay tracked; the ignore entry only affects new files.

## What needs a local session

Phases 2 and 3 are file edits inside this repo and can run anywhere. Everything else needs the user's machine: the tessera repo, onshift and the other projects, the installed Beacon, Plannotator, and Tessera tools under the home `.claude` directory, and the Phase 6 runs.

## Rules to keep

- Never commit `.env`, secrets, runtime databases, `.tessera/`, `.mcp.json`, or `docs/transcripts/`.
- No real name, personal email, username, or absolute home paths in any committed file.
- Branch first, never work on main, no deploy or publish without explicit approval.
- Do not sweep unrelated uncommitted changes into a kit commit.
