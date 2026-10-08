#!/usr/bin/env bash
# kit-apply.sh — Apply the starter-kit uniform layer to a project directory.
#
# Usage: bash scripts/kit-apply.sh <project-dir> [--profile default|clean]
#
# Reads starter-kit-manifest.json and, for the given project:
#   1. copies kit-owned commands, skills, agents and project hooks into .claude/
#      (kit-owned files are overwritten; callers decide whether to confirm first)
#   2. installs settings.json from the profile template, or, if one exists,
#      adds any missing template hooks and reports conflicting entries
#   3. adds the manifest's .gitignore entries (idempotent)
#   4. inserts or replaces the workflow block in CLAUDE.md between its markers
#   5. checks Beacon, Plannotator and the Tessera plugin (installs if missing)
#   6. runs `tessera scan`, which owns the Tessera policy block and .mcp.json
#
# Safe to run repeatedly. Set STARTER_KIT_SKIP_INSTALL=1 to never install tools
# (tests, CI, cloud sessions). Used by scaffold-default.sh, scaffold-clean.sh,
# the Go/Python/framework modes of /new-project, and /update-project.

set -euo pipefail

STARTER_KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$STARTER_KIT/starter-kit-manifest.json"
PROFILE="default"
PROJECT_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    -*) echo "ERROR: unknown option: $1"; exit 1 ;;
    *) PROJECT_DIR="$1"; shift ;;
  esac
done

if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
  echo "Usage: bash scripts/kit-apply.sh <project-dir> [--profile default|clean]"
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

echo "Applying starter-kit layer to: $PROJECT_DIR (profile: $PROFILE)"
mkdir -p "$PROJECT_DIR"/.claude/{commands,skills,agents,hooks}

# ── 1. Kit-owned files ───────────────────────────────────────────────────────
COMMAND_COUNT=0
while IFS= read -r name; do
  cp "$STARTER_KIT/.claude/commands/${name}.md" "$PROJECT_DIR/.claude/commands/"
  COMMAND_COUNT=$((COMMAND_COUNT + 1))
done < <(manifest_list files.commands)

SKILL_COUNT=0
while IFS= read -r name; do
  rm -rf "$PROJECT_DIR/.claude/skills/${name}"
  cp -r "$STARTER_KIT/.claude/skills/${name}" "$PROJECT_DIR/.claude/skills/"
  SKILL_COUNT=$((SKILL_COUNT + 1))
done < <(manifest_list files.skills)

AGENT_COUNT=0
while IFS= read -r name; do
  cp "$STARTER_KIT/.claude/agents/${name}.md" "$PROJECT_DIR/.claude/agents/"
  AGENT_COUNT=$((AGENT_COUNT + 1))
done < <(manifest_list files.agents)

HOOK_COUNT=0
while IFS= read -r name; do
  cp "$STARTER_KIT/.claude/hooks/${name}" "$PROJECT_DIR/.claude/hooks/"
  HOOK_COUNT=$((HOOK_COUNT + 1))
done < <(manifest_list "profiles.${PROFILE}.hooks")
chmod +x "$PROJECT_DIR"/.claude/hooks/*.sh "$PROJECT_DIR"/.claude/hooks/*.py 2>/dev/null || true

echo "  files:     ${COMMAND_COUNT} commands, ${SKILL_COUNT} skills, ${AGENT_COUNT} agents, ${HOOK_COUNT} project hooks"

# ── 2. settings.json (project hooks only) ────────────────────────────────────
# block-secrets, verify-no-secrets and check-rulecatch are wired globally in
# ~/.claude/settings.json; Plannotator hooks come from the tessera plugin. Listing
# either here would fire them twice, and a missing global python hook exits 2,
# which blocks Read/Edit/Write.
SETTINGS_TEMPLATE="$STARTER_KIT/$(manifest_value "profiles.${PROFILE}.settingsTemplate")"
SETTINGS_RESULT="$(node -e '
  const fs = require("fs");
  const [target, tmpl] = process.argv.slice(1);
  const t = JSON.parse(fs.readFileSync(tmpl, "utf8"));
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, JSON.stringify(t, null, 2) + "\n");
    console.log("written from template");
    process.exit(0);
  }
  const s = JSON.parse(fs.readFileSync(target, "utf8"));
  s.hooks = s.hooks || {};
  const has = (groups, cmd) => groups.some(g => (g.hooks || []).some(h => h.command === cmd));
  let added = 0;
  for (const [event, groups] of Object.entries(t.hooks)) {
    s.hooks[event] = s.hooks[event] || [];
    for (const g of groups) {
      for (const h of g.hooks) {
        if (has(s.hooks[event], h.command)) continue;
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
  const forbidden = /block-secrets|verify-no-secrets|check-rulecatch|plannotator/;
  const conflicts = [];
  JSON.stringify(s.hooks, (k, v) => { if (k === "command" && forbidden.test(v)) conflicts.push(v); return v; });
  if (added > 0) fs.writeFileSync(target, JSON.stringify(s, null, 2) + "\n");
  let msg = added > 0 ? `merged, added ${added} hook(s)` : "already up to date";
  if (conflicts.length) msg += `; WARNING globally-owned hooks listed here (remove them): ${conflicts.join(" | ")}`;
  console.log(msg);
' "$PROJECT_DIR/.claude/settings.json" "$SETTINGS_TEMPLATE")"
echo "  settings:  ${SETTINGS_RESULT}"

# ── 3. .gitignore entries ────────────────────────────────────────────────────
GITIGNORE="$PROJECT_DIR/.gitignore"
touch "$GITIGNORE"
IGNORE_ADDED=0
while IFS= read -r entry; do
  if ! grep -qxF "$entry" "$GITIGNORE"; then
    if [ "$IGNORE_ADDED" -eq 0 ]; then
      [ -s "$GITIGNORE" ] && printf '\n' >> "$GITIGNORE"
      printf '%s\n' "# Starter-kit managed (MDD working files, Tessera graph, machine-specific MCP config)" >> "$GITIGNORE"
    fi
    printf '%s\n' "$entry" >> "$GITIGNORE"
    IGNORE_ADDED=$((IGNORE_ADDED + 1))
  fi
done < <(manifest_list gitignore)
echo "  gitignore: ${IGNORE_ADDED} entr$([ "$IGNORE_ADDED" -eq 1 ] && echo y || echo ies) added"
if git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  TRACKED="$(git -C "$PROJECT_DIR" ls-files -- .mcp.json .tessera .mdd 2>/dev/null | head -5)"
  [ -n "$TRACKED" ] && echo "  WARNING:   these managed-ignore paths are already tracked by git (not untracked here): $(echo "$TRACKED" | tr '\n' ' ')"
fi

# ── 4. Workflow block in CLAUDE.md ───────────────────────────────────────────
if [ -f "$PROJECT_DIR/CLAUDE.md" ]; then
  BLOCK_RESULT="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const [root, claudeMd, manifestPath] = process.argv.slice(1);
    const b = require(manifestPath).managedBlocks.find(x => x.id === "workflow");
    const block = fs.readFileSync(path.join(root, b.source), "utf8").trimEnd();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc(b.startMarker) + "[^>]*-->[\\s\\S]*?" + esc(b.endMarker));
    const c = fs.readFileSync(claudeMd, "utf8");
    let out, action;
    if (re.test(c)) { out = c.replace(re, () => block); action = out === c ? "unchanged" : "updated"; }
    else { out = c.replace(/\s*$/, "\n\n") + block + "\n"; action = "added"; }
    if (out !== c) fs.writeFileSync(claudeMd, out);
    console.log(action);
  ' "$STARTER_KIT" "$PROJECT_DIR/CLAUDE.md" "$MANIFEST")"
  echo "  workflow:  CLAUDE.md block ${BLOCK_RESULT}"
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
  if [ "${STARTER_KIT_SKIP_INSTALL:-0}" = "1" ]; then
    echo "  tool:      ${tool_id} MISSING (STARTER_KIT_SKIP_INSTALL=1) - install with: ${install_cmd}"
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
if command -v tessera >/dev/null 2>&1; then
  if (cd "$PROJECT_DIR" && tessera scan . >/dev/null 2>&1); then
    echo "  tessera:   scan ok (graph, .mcp.json, CLAUDE.md policy block)"
  else
    echo "  tessera:   scan FAILED - run 'tessera scan .' in the project"
  fi
else
  echo "  tessera:   scan skipped (tessera CLI not on PATH)"
fi

echo "Next: ask Claude to run the beacon skill-discovery step for this project."
