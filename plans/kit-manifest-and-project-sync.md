# Plan: Kit manifest and uniform project sync

Status: Phases 1 and 2 complete and merged (kit PR #1 and PR #2; tessera PR #14). Paused before Phase 3. Resume from Phase 3.

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
- Project `settings.json` is generated from `templates/project-settings*.json` and never lists global hooks or Plannotator hooks.
- Plannotator hooks are owned by the Tessera plugin only.
- `.mcp.json` is gitignored in every project (it embeds an absolute path).
- Onshift's 17 commands are stale copies (old `project-docs/` paths; no project has that folder now). Fix them through the sync, not by copying onshift's versions into the kit.

## Findings that shape the work

- The default scaffold script hard-coded 16 of the 17 project commands, so new projects never got `/mdd`. Fixed; a test now fails if a `scope: project` command is missing from the manifest.
- There were four separate implementations of the same copy logic (two scripts plus prose for Go, Python, and framework modes). Replaced by `kit-apply.sh`.
- A missing global python hook file exits with code 2, which blocks Read/Edit/Write. Project settings must never point at `~/.claude/hooks`, or cloud sessions and other machines lose those tools. Listing a hook in both global and project settings also fires it twice.
- Two global hooks (`block-secrets.py`, `verify-no-secrets.sh`) have drifted from the kit's copies. The old `/install-global` skipped existing files, so kit fixes never reached them. It now shows a diff and asks before replacing.
- Tessera's `scan` replaces only the text between its own `TESSERA:START/END` markers. Its built-in template is v2 and lacks the `plan_save` bullet, so each scan resets the block to the older text. Fix is Phase 4.
- The Tessera plugin loaded neither its MCP server nor its Plannotator hooks (`claude plugin validate` errors: missing `mcpServers` file, `hooks` pointing at a directory). Fixed in tessera PR #14 with an inline `tessera mcp` server and `hooks/hooks.json`.
- Tessera's own regression test says `uvx --from tessera` pulls the wrong PyPI package, yet the README and `install.sh` still use `uvx` and `pip install tessera`. The PyPI lookup was not completed; unverified.
- Tessera versions disagree: `pyproject.toml` 0.3.0, `plugin.json` 0.4.1, and the installed binary 0.1.0.
- Standalone Plannotator plus the Tessera plugin duplicates ExitPlanMode hooks (tessera ADR-003). The install check warns and skips in that case.

## Existing project states (affects sync safety)

| Group | Projects |
|---|---|
| Clean git repo | frictionlog, onshift, onshift-native |
| Dirty working tree | lumiris, nodulerisk, nuklius, personalfinance, taxplanprep |
| Not a git repo | FinHub, frictionlog-ios, nodulerisk-ios, onshift-user-manual, workout, calibre-web-migration |

FinHub and onshift-user-manual have no `.claude/` at all and go through the convert path. States as of 2026-10-08; recheck before rollout.

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

### Phase 3: Extend `/update-project` (next)
- [ ] Add path argument, `--all`, `--dry-run`; auto-register touched projects; call `kit-apply.sh` for the file, settings, ignore, and block layers
- [ ] Safety: clean git repo gets a branch and commit; dirty repo stops and asks the user to commit or stash; non-git projects ask before `git init`
- [ ] Projects without `.claude/` use the convert path
- [ ] Decide whether the sync may remove globally-owned or Plannotator hooks from an existing project's `settings.json` (today `kit-apply.sh` only warns)
- [ ] User reviews the two drifted global hooks with `/install-global` before rollout
- [ ] Dry-run output reports managed-ignore paths already tracked by git (for example a committed `.mcp.json`)

### Phase 4: tessera repo (separate repo)
- [x] Plugin MCP server and hooks path fixed (tessera PR #14, merged)
- [ ] Update the policy template in `src/tessera/mcp/tools/scan.py` to the current text (plan_save bullet, workflow line) so scans stop downgrading CLAUDE.md
- [ ] Read-only gap report: bundled skills and hooks versus upstream obra/superpowers and plannotator
- [ ] Fix README and `install.sh` install lines once the PyPI name collision is verified; reconcile the three version numbers
- [ ] Apply approved skill and hook updates with tests

### Phase 5: Rollout
- [ ] Install and verify the fixed Tessera plugin on the user's machine; then remove the direct Plannotator hooks from the kit's own local `settings.json`
- [ ] Dry-run, then apply to onshift first (5 commands have stale `project-docs/` paths)
- [ ] Remaining projects one at a time, with user confirmation each

### Phase 6: Verification
- [ ] Sync a copy of onshift in a scratch directory; a second sync produces no diff
- [ ] Command files identical to the kit's; no secrets or home paths in committed files

## Known loose ends

- `pnpm typecheck` fails with TS18003 on a clean checkout (tsconfig includes `src/**/*`). Pre-existing and unrelated.
- `docs/index.html` screenshot alt text and caption still say "26 commands"; the screenshot image itself may show the old count.
- The kit's root CLAUDE.md greeting still says "26 commands". That file has uncommitted local edits, so it was left alone.

## What needs a local session

Phases 2 and 3 are file edits inside this repo and can run anywhere. Everything else needs the user's machine: the tessera repo, onshift and the other projects, the installed Beacon, Plannotator, and Tessera tools under the home `.claude` directory, and the Phase 6 runs.

## Rules to keep

- Never commit `.env`, secrets, runtime databases, `.tessera/`, `.mcp.json`, or `docs/transcripts/`.
- No real name, personal email, username, or absolute home paths in any committed file.
- Branch first, never work on main, no deploy or publish without explicit approval.
- Do not sweep unrelated uncommitted changes into a kit commit.
