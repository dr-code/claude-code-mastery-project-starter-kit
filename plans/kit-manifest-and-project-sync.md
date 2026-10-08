# Plan: Kit manifest and uniform project sync

Status: Phase 1 complete, paused before Phase 2. Resume from Phase 2.

Goal: every project (new and existing) gets the same commands, skills, hooks, gitignore entries, and CLAUDE.md blocks, driven by one manifest. Includes Beacon, /mdd, Tessera, and the Superpowers + Plannotator workflow.

## Approved decisions

- Target command is the kit's `/new-project` (`.claude/commands/new-project.md`) and `scripts/scaffold-default.sh`, not a copy in the user's global `~/.claude/commands`.
- Beacon: check it is installed, auto-install if missing, then run the existing skill-discovery step.
- Tessera, full set: policy block in CLAUDE.md, `.tessera/` in `.gitignore`, `graph_scan` at the end of scaffolding, and a plugin install check.
- The tessera repo is also updated (separate repo, branch only, no push).
- Extend `/update-project` (path argument, `--all`, `--dry-run`, auto-register) and use a shared manifest so new-project and update-project never drift apart.
- All projects get the same set, including iOS and native projects.
- Block ownership: Tessera owns its CLAUDE.md block (injected by `graph_scan`). The kit owns a separate workflow block with its own markers.
- Onshift's 17 commands are stale copies (old `project-docs/` paths; no project has that folder now). Fix them through the sync, not by copying onshift's versions into the kit.

## Findings that shape the work

- `scaffold-default.sh` copies 16 commands and leaves out `mdd.md`, so new projects never got `/mdd`. The kit has 17 project commands.
- Tessera's `graph_scan` replaces only the text between `TESSERA:START` and `TESSERA:END`. Its built-in template is v2; the user's canonical template is v3. Each scan resets the block to v2 text, which lacks the `plan_save` bullet. Phase 4 updates the tessera template.
- The 14 Superpowers skills and the Plannotator hooks are bundled in the Tessera plugin (tessera ADR-003). They are not files in the kit, so the manifest checks the plugin install instead of copying them.
- Standalone Plannotator plus the Tessera plugin duplicates ExitPlanMode hooks. The install check must warn and skip, not stack them.
- Untested risk: a project `.mcp.json` entry for Tessera plus the plugin may register the MCP server twice. Test in a throwaway project before Phase 2.

## Existing project states (affects sync safety)

| Group | Projects |
|---|---|
| Clean git repo | frictionlog, onshift, onshift-native |
| Dirty working tree | lumiris, nodulerisk, nuklius, personalfinance, taxplanprep |
| Not a git repo | FinHub, frictionlog-ios, nodulerisk-ios, onshift-user-manual, workout, calibre-web-migration |

FinHub and onshift-user-manual have no `.claude/` at all and go through the convert path.

## Phases

### Phase 1: Manifest (done, merged with this plan)
- [x] `starter-kit-manifest.json`: 17 commands, 2 skills, 2 agents, 9 hooks, gitignore entries, managed blocks, global tools with check and install commands
- [x] `templates/claude-blocks/workflow.md`: kit-owned workflow block with `STARTER-KIT:WORKFLOW` markers

### Phase 2: Scaffold reads the manifest
- [ ] Test the duplicate-MCP risk in a throwaway project first
- [ ] Update `.claude/commands/new-project.md` (default, clean, go, python modes)
- [ ] Update `scripts/scaffold-default.sh` (read the manifest with `node -e`; copy all 17 commands including mdd)
- [ ] Beacon, Plannotator, and Tessera plugin install steps print the exact command before running

### Phase 3: Extend `/update-project`
- [ ] Add path argument, `--all`, `--dry-run`; auto-register touched projects
- [ ] Safety: clean git repo gets a branch and commit; dirty repo stops and asks the user to commit or stash; non-git projects ask before `git init`
- [ ] Projects without `.claude/` use the convert path
- [ ] Managed-block merge by markers, so re-runs are idempotent

### Phase 4: tessera repo (separate repo; branch only, no push)
- [ ] Read-only gap report: bundled skills and hooks versus upstream obra/superpowers and plannotator
- [ ] Update the policy template in `src/tessera/mcp/tools/scan.py` to the current text (plan_save bullet, workflow line)
- [ ] Apply approved skill and hook updates with tests

### Phase 5: Rollout
- [ ] Dry-run, then apply to onshift first (5 commands have stale `project-docs/` paths)
- [ ] Remaining projects one at a time, with user confirmation each

### Phase 6: Verification
- [ ] Scaffold a throwaway project and sync a copy of onshift in a scratch directory
- [ ] Second sync produces no diff; command files identical to the kit's; no secrets or home paths in committed files

## What needs a local session

Phases 2 and 3 are file edits inside this repo and can run anywhere. Everything else needs the user's machine: the tessera repo, onshift and the other projects, the installed Beacon, Plannotator, and Tessera tools under the home `.claude` directory, and the Phase 6 runs.

## Rules to keep

- Never commit `.env`, secrets, runtime databases, `.tessera/`, or `docs/transcripts/`.
- No real name, personal email, username, or absolute home paths in any committed file.
- Branch first, never work on main, no deploy or publish without explicit approval.
- Do not sweep unrelated uncommitted changes into a kit commit.
