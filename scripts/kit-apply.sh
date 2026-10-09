#!/usr/bin/env bash
# kit-apply.sh — Apply the starter-kit uniform layer to a project directory.
#
# Usage: bash scripts/kit-apply.sh <project-dir> [options]
#
#   --profile <default|clean>  which hook set and settings template to use (default: default)
#   --dry-run                  report what would change; write nothing, install nothing, scan nothing
#   --backup-dir <dir>         copy every existing file this run changes into <dir> first
#   --fix-settings             remove globally-owned or plugin-owned hooks from the project's
#                              settings.json, but only when their replacement is verified present
#   --skip-scan                do not run `tessera scan`
#   --no-overwrite             add missing kit files but keep any existing file that differs
#   --skip-claude-md           leave CLAUDE.md alone: no workflow block and no `tessera scan`
#                              (the scan edits CLAUDE.md)
#
# Reads starter-kit-manifest.json and, for the given project:
#   1. copies kit-owned commands, skills, agents and project hooks into .claude/
#      (kit-owned files are overwritten; files the kit does not own are never touched)
#   2. installs settings.json from the profile template, or, if one exists,
#      adds any missing template hooks and reports conflicting entries
#   3. adds the manifest's .gitignore entries (idempotent)
#   4. inserts or replaces the workflow block in CLAUDE.md between its markers
#   5. checks Beacon, Plannotator and the Tessera plugin (installs if missing)
#   6. runs `tessera scan`, which owns the Tessera policy block and .mcp.json
#
# Safe to run repeatedly. Set STARTER_KIT_SKIP_INSTALL=1 to never install tools
# (tests, CI, cloud sessions). The last output line is `RESULT: changes=<n>`.
# Used by scaffold-default.sh, scaffold-clean.sh, the Go/Python/framework modes of
# /new-project, and /update-project.

set -euo pipefail

STARTER_KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$STARTER_KIT/starter-kit-manifest.json"
PROFILE="default"
PROJECT_DIR=""
DRY_RUN=0
BACKUP_DIR=""
FIX_SETTINGS=0
SKIP_SCAN=0
NO_OVERWRITE=0
SKIP_CLAUDE_MD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a value}"; shift 2 ;;
    --fix-settings) FIX_SETTINGS=1; shift ;;
    --skip-scan) SKIP_SCAN=1; shift ;;
    --no-overwrite) NO_OVERWRITE=1; shift ;;
    --skip-claude-md) SKIP_CLAUDE_MD=1; shift ;;
    -*) echo "ERROR: unknown option: $1"; exit 1 ;;
    *) PROJECT_DIR="$1"; shift ;;
  esac
done

if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
  echo "Usage: bash scripts/kit-apply.sh <project-dir> [--profile default|clean] [--dry-run] [--backup-dir <dir>] [--fix-settings] [--skip-scan] [--no-overwrite] [--skip-claude-md]"
  exit 1
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: manifest not found: $MANIFEST"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to read starter-kit-manifest.json"
  exit 1
fi
if [ "$PROJECT_DIR" = "$STARTER_KIT" ]; then
  echo "ERROR: refusing to apply the layer to the starter kit itself"
  exit 1
fi

# manifest_list <dotted.path> -- print each array entry on its own line.
# A string value is treated as another dotted path (used by profiles).
manifest_list() {
  node -e '
    const m = require(process.argv[1]);
    const get = (p) => p.split(".").reduce((o, k) => o[k], m);
    let v = get(process.argv[2]);
    if (typeof v === "string") v = get(v);
    console.log(v.join("\n"));
  ' "$MANIFEST" "$1"
}

manifest_value() {
  node -e '
    const m = require(process.argv[1]);
    console.log(process.argv[2].split(".").reduce((o, k) => o[k], m));
  ' "$MANIFEST" "$1"
}

if ! node -e 'process.exit(require(process.argv[1]).profiles[process.argv[2]] ? 0 : 1)' "$MANIFEST" "$PROFILE"; then
  echo "ERROR: unknown profile: $PROFILE"
  exit 1
fi

CHANGES=0
MODE_LABEL=""
[ "$DRY_RUN" -eq 1 ] && MODE_LABEL=" [dry run: nothing will be written]"
echo "Applying starter-kit layer to: $PROJECT_DIR (profile: $PROFILE)${MODE_LABEL}"

# backup_path <absolute path> -- copy an existing file or directory into BACKUP_DIR, once.
backup_path() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ -n "$BACKUP_DIR" ] || return 0
  [ -e "$1" ] || return 0
  local rel="${1#"$PROJECT_DIR"/}"
  [ -e "$BACKUP_DIR/$rel" ] && return 0
  mkdir -p "$(dirname "$BACKUP_DIR/$rel")"
  cp -pR "$1" "$BACKUP_DIR/$rel"
}

if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$PROJECT_DIR"/.claude/{commands,skills,agents,hooks}
  [ -n "$BACKUP_DIR" ] && mkdir -p "$BACKUP_DIR"
fi

# ── 1. Kit-owned files ───────────────────────────────────────────────────────
# place_files <label> <kit dir> <project dir> <suffix> <is_dir 0|1> <manifest list path>
place_files() {
  local label="$1" src_dir="$2" dst_dir="$3" suffix="$4" is_dir="$5" list="$6"
  local n_new=0 n_upd=0 n_same=0 n_kept=0 names_new="" names_upd="" names_kept="" name src dst custom=0
  local owned=" "
  while IFS= read -r name; do
    owned+="${name}${suffix} "
    src="$src_dir/${name}${suffix}"
    dst="$dst_dir/${name}${suffix}"
    if [ ! -e "$dst" ]; then
      n_new=$((n_new + 1)); names_new+=" ${name}${suffix}"
      if [ "$DRY_RUN" -eq 0 ]; then cp -R "$src" "$dst_dir/"; fi
    elif { [ "$is_dir" -eq 1 ] && diff -rq "$src" "$dst" >/dev/null 2>&1; } || { [ "$is_dir" -eq 0 ] && cmp -s "$src" "$dst"; }; then
      n_same=$((n_same + 1))
    elif [ "$NO_OVERWRITE" -eq 1 ]; then
      n_kept=$((n_kept + 1)); names_kept+=" ${name}${suffix}"
    else
      n_upd=$((n_upd + 1)); names_upd+=" ${name}${suffix}"
      if [ "$DRY_RUN" -eq 0 ]; then
        backup_path "$dst"
        rm -rf "$dst"
        cp -R "$src" "$dst_dir/"
      fi
    fi
  done < <(manifest_list "$list")
  if [ -d "$dst_dir" ]; then
    for existing in "$dst_dir"/*; do
      [ -e "$existing" ] || continue
      case "$owned" in *" $(basename "$existing") "*) ;; *) custom=$((custom + 1)) ;; esac
    done
  fi
  CHANGES=$((CHANGES + n_new + n_upd))
  echo "  ${label}: ${n_new} new, ${n_upd} updated, ${n_same} unchanged, ${custom} custom (not touched)$([ "$n_kept" -gt 0 ] && echo ", ${n_kept} kept (yours differs)")"
  [ -n "$names_new" ] && echo "      + NEW:${names_new}"
  [ -n "$names_upd" ] && echo "      ~ UPDATED:${names_upd}"
  [ -n "$names_kept" ] && echo "      = KEPT (yours differs, --no-overwrite):${names_kept}"
  return 0
}

place_files "commands" "$STARTER_KIT/.claude/commands" "$PROJECT_DIR/.claude/commands" ".md" 0 files.commands
place_files "skills  " "$STARTER_KIT/.claude/skills" "$PROJECT_DIR/.claude/skills" "" 1 files.skills
place_files "agents  " "$STARTER_KIT/.claude/agents" "$PROJECT_DIR/.claude/agents" ".md" 0 files.agents
place_files "hooks   " "$STARTER_KIT/.claude/hooks" "$PROJECT_DIR/.claude/hooks" "" 0 "profiles.${PROFILE}.hooks"
if [ "$DRY_RUN" -eq 0 ]; then
  chmod +x "$PROJECT_DIR"/.claude/hooks/*.sh "$PROJECT_DIR"/.claude/hooks/*.py 2>/dev/null || true
fi

# Kit-management commands (scope: starter-kit) left behind by older kit versions.
STRAY=""
for f in "$PROJECT_DIR"/.claude/commands/*.md; do
  [ -e "$f" ] || continue
  if grep -q '^scope:[[:space:]]*starter-kit' "$f" 2>/dev/null; then STRAY+=" $(basename "$f")"; fi
done
[ -n "$STRAY" ] && echo "  note:      kit-management commands present (run /update-project --clean to remove):${STRAY}"

# ── 2. settings.json (project hooks only) ────────────────────────────────────
# block-secrets, verify-no-secrets and check-rulecatch are wired globally in
# ~/.claude/settings.json; Plannotator hooks come from the tessera plugin. Listing
# either here would fire them twice, and a missing global python hook exits 2,
# which blocks Read/Edit/Write.
SETTINGS_TEMPLATE="$STARTER_KIT/$(manifest_value "profiles.${PROFILE}.settingsTemplate")"
SETTINGS_PATH="$PROJECT_DIR/.claude/settings.json"

# Patterns for hooks the project must not carry, and the subset whose replacement
# is verified present on this machine (safe to remove).
GLOBAL_SETTINGS="$HOME/.claude/settings.json"
REMOVABLE_JSON="$(
  {
    while IFS= read -r hook; do
      if [ -f "$HOME/.claude/hooks/$hook" ] && [ -f "$GLOBAL_SETTINGS" ] && grep -q "$hook" "$GLOBAL_SETTINGS" 2>/dev/null; then
        echo "hook-file:$hook"
      fi
    done < <(manifest_list files.hooks.global)
    if [ -f "$HOME/.claude/plugins/installed_plugins.json" ] && grep -q '"tessera@' "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null; then
      echo "plannotator"
    fi
  } | node -e '
    const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
    console.log(JSON.stringify(lines));
  '
)"
GLOBAL_NAMES_JSON="$(manifest_list files.hooks.global | node -e 'console.log(JSON.stringify(require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)))')"

[ -f "$SETTINGS_PATH" ] && [ "$DRY_RUN" -eq 0 ] && backup_path "$SETTINGS_PATH"

SETTINGS_OUT="$(KIT_REMOVABLE="$REMOVABLE_JSON" KIT_GLOBAL_NAMES="$GLOBAL_NAMES_JSON" KIT_FIX="$FIX_SETTINGS" KIT_DRY="$DRY_RUN" node -e '
  const fs = require("fs");
  const [target, tmpl] = process.argv.slice(1);
  const dry = process.env.KIT_DRY === "1";
  const fix = process.env.KIT_FIX === "1";
  const removable = JSON.parse(process.env.KIT_REMOVABLE);
  const globalNames = JSON.parse(process.env.KIT_GLOBAL_NAMES);
  const t = JSON.parse(fs.readFileSync(tmpl, "utf8"));
  const write = (obj) => { if (!dry) fs.writeFileSync(target, JSON.stringify(obj, null, 2) + "\n"); };
  if (!fs.existsSync(target)) {
    write(t);
    console.log("CHANGE " + (dry ? "would be written from template" : "written from template"));
    process.exit(0);
  }
  const s = JSON.parse(fs.readFileSync(target, "utf8"));
  s.hooks = s.hooks || {};
  const has = (groups, cmd) => groups.some(g => (g.hooks || []).some(h => h.command === cmd));
  // The same hook script wired under a different path (for example ~/.claude/hooks/x
  // instead of .claude/hooks/x) is the same hook: migrate it, never add a second copy.
  const scriptName = (cmd) => { const m = /hooks\/([\w.-]+)\s*$/.exec(cmd || ""); return m ? m[1] : null; };
  const findByScript = (groups, name) => {
    for (const g of groups) for (const h of (g.hooks || [])) if (name && scriptName(h.command) === name) return h;
    return null;
  };
  let added = 0;
  let migrated = 0;
  for (const [event, groups] of Object.entries(t.hooks)) {
    s.hooks[event] = s.hooks[event] || [];
    for (const g of groups) {
      for (const h of g.hooks) {
        if (has(s.hooks[event], h.command)) continue;
        const same = findByScript(s.hooks[event], scriptName(h.command));
        if (same) { same.command = h.command; migrated++; continue; }
        let grp = s.hooks[event].find(x => (x.matcher || "") === (g.matcher || ""));
        if (!grp) {
          grp = g.matcher ? { matcher: g.matcher, hooks: [] } : { hooks: [] };
          s.hooks[event].push(grp);
        }
        grp.hooks.push(h);
        added++;
      }
    }
  }
  const isGlobalHook = (cmd) => globalNames.some(n => cmd.includes("hooks/" + n));
  const isPlannotator = (cmd) => /^plannotator( |$)/.test(cmd);
  const verified = (cmd) => (isGlobalHook(cmd) && removable.some(r => cmd.includes("hooks/" + r.replace("hook-file:", ""))))
    || (isPlannotator(cmd) && removable.includes("plannotator"));
  const redundant = [];
  JSON.stringify(s.hooks, (k, v) => { if (k === "command" && (isGlobalHook(v) || isPlannotator(v))) redundant.push(v); return v; });
  const removed = [];
  const kept = [];
  if (redundant.length) {
    if (fix) {
      for (const [event, groups] of Object.entries(s.hooks)) {
        for (const g of groups) {
          g.hooks = (g.hooks || []).filter(h => {
            if (typeof h.command === "string" && (isGlobalHook(h.command) || isPlannotator(h.command))) {
              if (verified(h.command)) { removed.push(h.command); return false; }
              kept.push(h.command);
            }
            return true;
          });
        }
        s.hooks[event] = groups.filter(g => (g.hooks || []).length > 0);
        if (s.hooks[event].length === 0) delete s.hooks[event];
      }
    } else {
      kept.push(...redundant);
    }
  }
  const changed = added > 0 || migrated > 0 || removed.length > 0;
  if (changed) write(s);
  const parts = [];
  if (added > 0) parts.push((dry ? "would add " : "added ") + added + " hook(s)");
  if (migrated > 0) parts.push((dry ? "would migrate " : "migrated ") + migrated + " hook path(s) to the project-local .claude/hooks");
  if (removed.length) parts.push((dry ? "would remove " : "removed ") + removed.length + " redundant (" + removed.join(" | ") + ")");
  if (kept.length) parts.push((fix ? "KEPT, replacement not verified: " : "WARNING globally-owned hooks listed here (run with --fix-settings once verified): ") + kept.join(" | "));
  console.log((changed ? "CHANGE " : "OK ") + (parts.length ? parts.join("; ") : "already up to date"));
' "$SETTINGS_PATH" "$SETTINGS_TEMPLATE")"
case "$SETTINGS_OUT" in CHANGE*) CHANGES=$((CHANGES + 1)) ;; esac
echo "  settings:  ${SETTINGS_OUT#* }"

# ── 3. .gitignore entries ────────────────────────────────────────────────────
GITIGNORE="$PROJECT_DIR/.gitignore"
IGNORE_ADDED=0
IGNORE_NAMES=""
[ -f "$GITIGNORE" ] && backup_path "$GITIGNORE"
[ "$DRY_RUN" -eq 0 ] && touch "$GITIGNORE"
while IFS= read -r entry; do
  if [ ! -f "$GITIGNORE" ] || ! grep -qxF "$entry" "$GITIGNORE"; then
    if [ "$DRY_RUN" -eq 0 ]; then
      if [ "$IGNORE_ADDED" -eq 0 ]; then
        [ -s "$GITIGNORE" ] && printf '\n' >> "$GITIGNORE"
        printf '%s\n' "# Starter-kit managed (MDD working files, Tessera graph, machine-specific MCP config)" >> "$GITIGNORE"
      fi
      printf '%s\n' "$entry" >> "$GITIGNORE"
    fi
    IGNORE_ADDED=$((IGNORE_ADDED + 1))
    IGNORE_NAMES+=" ${entry}"
  fi
done < <(manifest_list gitignore)
CHANGES=$((CHANGES + IGNORE_ADDED))
echo "  gitignore: ${IGNORE_ADDED} entr$([ "$IGNORE_ADDED" -eq 1 ] && echo y || echo ies) $([ "$DRY_RUN" -eq 1 ] && echo 'to add' || echo added)${IGNORE_NAMES:+ (${IGNORE_NAMES# })}"
if git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  TRACKED="$(git -C "$PROJECT_DIR" ls-files -- .mcp.json .tessera .mdd 2>/dev/null | head -5)"
  [ -n "$TRACKED" ] && echo "  WARNING:   these managed-ignore paths are already tracked by git, so ignoring them has no effect until untracked: $(echo "$TRACKED" | tr '\n' ' ')"
fi

# ── 4. Workflow block in CLAUDE.md ───────────────────────────────────────────
if [ "$SKIP_CLAUDE_MD" -eq 1 ]; then
  echo "  workflow:  skipped (--skip-claude-md)"
elif [ -f "$PROJECT_DIR/CLAUDE.md" ]; then
  backup_path "$PROJECT_DIR/CLAUDE.md"
  BLOCK_RESULT="$(KIT_DRY="$DRY_RUN" node -e '
    const fs = require("fs");
    const path = require("path");
    const [root, claudeMd, manifestPath] = process.argv.slice(1);
    const dry = process.env.KIT_DRY === "1";
    const b = require(manifestPath).managedBlocks.find(x => x.id === "workflow");
    const block = fs.readFileSync(path.join(root, b.source), "utf8").trimEnd();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc(b.startMarker) + "[^>]*-->[\\s\\S]*?" + esc(b.endMarker));
    const c = fs.readFileSync(claudeMd, "utf8");
    let out, action;
    if (re.test(c)) { out = c.replace(re, () => block); action = out === c ? "unchanged" : "updated"; }
    else { out = c.replace(/\s*$/, "\n\n") + block + "\n"; action = "added"; }
    if (out !== c && !dry) fs.writeFileSync(claudeMd, out);
    console.log(action);
  ' "$STARTER_KIT" "$PROJECT_DIR/CLAUDE.md" "$MANIFEST")"
  [ "$BLOCK_RESULT" != "unchanged" ] && CHANGES=$((CHANGES + 1))
  echo "  workflow:  CLAUDE.md block $([ "$DRY_RUN" -eq 1 ] && [ "$BLOCK_RESULT" != "unchanged" ] && echo "would be ")${BLOCK_RESULT}"
else
  echo "  workflow:  skipped (no CLAUDE.md in project)"
fi

# ── 5. Global tools: Beacon, Plannotator, Tessera plugin ─────────────────────
# Each missing tool's exact install command is printed before it runs. A failed
# install never aborts the run; it is reported.
while IFS=$'\t' read -r tool_id check_cmd install_cmd conflict_cmd; do
  if bash -c "$check_cmd" >/dev/null 2>&1; then
    echo "  tool:      ${tool_id} already installed"
    continue
  fi
  if [ "$conflict_cmd" != "-" ] && bash -c "$conflict_cmd" >/dev/null 2>&1; then
    echo "  tool:      ${tool_id} skipped (conflicting standalone plugin is installed)"
    continue
  fi
  if [ "$DRY_RUN" -eq 1 ] || [ "${STARTER_KIT_SKIP_INSTALL:-0}" = "1" ]; then
    echo "  tool:      ${tool_id} MISSING - install with: ${install_cmd}"
    continue
  fi
  echo "  tool:      installing ${tool_id}: ${install_cmd}"
  if bash -c "$install_cmd" >/dev/null && bash -c "$check_cmd" >/dev/null 2>&1; then
    echo "  tool:      ${tool_id} installed"
  else
    echo "  tool:      ${tool_id} FAILED - run manually: ${install_cmd}"
  fi
done < <(node -e '
  for (const t of require(process.argv[1]).globalTools) {
    const conflict = t.conflictsWith ? t.conflictsWith.check : "-";
    console.log([t.id, t.check, t.install, conflict].join("\t"));
  }
' "$MANIFEST")

# ── 6. Tessera scan (owns the Tessera CLAUDE.md block and .mcp.json) ──────────
if [ "$DRY_RUN" -eq 1 ] || [ "$SKIP_SCAN" -eq 1 ] || [ "$SKIP_CLAUDE_MD" -eq 1 ]; then
  echo "  tessera:   scan skipped ($([ "$DRY_RUN" -eq 1 ] && echo 'dry run' || { [ "$SKIP_CLAUDE_MD" -eq 1 ] && echo '--skip-claude-md' || echo '--skip-scan'; }))"
elif command -v tessera >/dev/null 2>&1; then
  [ -f "$PROJECT_DIR/CLAUDE.md" ] && backup_path "$PROJECT_DIR/CLAUDE.md"
  if (cd "$PROJECT_DIR" && tessera scan . >/dev/null 2>&1); then
    echo "  tessera:   scan ok (graph, .mcp.json, CLAUDE.md policy block)"
  else
    echo "  tessera:   scan FAILED - run 'tessera scan .' in the project"
  fi
else
  echo "  tessera:   scan skipped (tessera CLI not on PATH)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run complete: nothing was written."
else
  echo "Next: ask Claude to run the beacon skill-discovery step for this project."
fi
echo "RESULT: changes=${CHANGES}"
