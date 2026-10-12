#!/usr/bin/env bash
# Branch Protection Hook — PreToolUse (Bash)
# Blocks committing directly to main/master when auto_branch is enabled.
# Exit code 2 = block operation and tell Claude why.
#
# The check is made against the repository the commit really targets, not the
# folder the session started in. For every `git commit` in the command it follows:
#   - `cd <dir> && ... git commit`   (relative paths, ~, $HOME and quotes)
#   - `git -C <dir> commit`          (also with -c options in between)
# and falls back to the current folder when neither is present.
#
# Based on Claude Code Mastery Guides V1-V5 by TheDecipherist

INPUT=$(cat)

# Extract the command from the hook's JSON input: jq, else python3, else a crude fallback.
if command -v jq &>/dev/null; then
    COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
elif command -v python3 &>/dev/null; then
    COMMAND=$(printf '%s' "$INPUT" | python3 -c 'import sys, json; print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))' 2>/dev/null)
else
    COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//')
fi

if [ -z "$COMMAND" ]; then
    exit 0
fi

# `git [options] commit` as a whole word (does not match commit-tree, commit-graph, ...).
COMMIT_RE='(^|[[:space:]])git[[:space:]]+((-c[[:space:]]+[^[:space:]]+|-C[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--[a-z-]+(=[^[:space:]]*)?)[[:space:]]+)*commit([[:space:]]|$)'
# The directory given to `git -C`.
GITC_RE='git[[:space:]]+((-c[[:space:]]+[^[:space:]]+)[[:space:]]+)*-C[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)'
CD_RE='^[[:space:]]*cd[[:space:]]+(.+[^[:space:]])[[:space:]]*$'

# Cheap exit: nothing in the command looks like a commit.
if ! [[ "$COMMAND" =~ $COMMIT_RE ]]; then
    exit 0
fi

# Strip one pair of surrounding quotes and expand a leading ~ or $HOME.
expand_path() {
    local p="$1"
    case "$p" in
        \"*\") p="${p#\"}"; p="${p%\"}" ;;
        \'*\') p="${p#\'}"; p="${p%\'}" ;;
    esac
    case "$p" in
        "~") p="$HOME" ;;
        "~/"*) p="$HOME/${p#\~/}" ;;
        '$HOME') p="$HOME" ;;
        '$HOME/'*) p="$HOME/${p#\$HOME/}" ;;
    esac
    printf '%s' "$p"
}

# Resolve a path (relative to $2, default the current folder) to an existing absolute folder.
resolve_dir() {
    local p base="${2:-$PWD}"
    p=$(expand_path "$1")
    case "$p" in
        /*) ;;
        *) p="$base/$p" ;;
    esac
    if [ -d "$p" ]; then
        (cd "$p" 2>/dev/null && pwd -P)
    else
        return 1
    fi
}

# Returns 0 and prints a message if committing in $1 should be blocked.
is_blocked() {
    local dir="$1" branch top conf setting auto_branch="true"
    git -C "$dir" rev-parse --is-inside-work-tree &>/dev/null || return 1
    # Allow initial commits (no previous commits yet).
    git -C "$dir" rev-parse HEAD &>/dev/null || return 1
    branch=$(git -C "$dir" branch --show-current 2>/dev/null)
    if [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
        return 1
    fi
    # auto_branch defaults to true; a project can turn it off in claude-mastery-project.conf.
    top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
    conf="$top/claude-mastery-project.conf"
    if [ -f "$conf" ]; then
        setting=$(grep -E '^[[:space:]]*auto_branch[[:space:]]*=' "$conf" 2>/dev/null | head -1 | sed 's/.*=[[:space:]]*//' | sed 's/[[:space:]]*#.*//' | tr -d ' ')
        [ -n "$setting" ] && auto_branch="$setting"
    fi
    [ "$auto_branch" = "true" ] || return 1
    echo "BLOCKED: You're committing directly to '$branch' in $top with auto_branch enabled." >&2
    echo "Create a feature branch first:" >&2
    echo "  git -C \"$top\" checkout -b feat/<feature-name>" >&2
    echo "  Or use: /worktree <name>" >&2
    return 0
}

# Walk the command left to right, tracking the folder after each `cd`.
CUR=""
while IFS= read -r seg; do
    if [[ "$seg" =~ $CD_RE ]]; then
        if next=$(resolve_dir "${BASH_REMATCH[1]}" "${CUR:-$PWD}"); then
            CUR="$next"
        fi
        continue
    fi
    if [[ "$seg" =~ $COMMIT_RE ]]; then
        target="${CUR:-$PWD}"
        if [[ "$seg" =~ $GITC_RE ]]; then
            if resolved=$(resolve_dir "${BASH_REMATCH[3]}" "${CUR:-$PWD}"); then
                target="$resolved"
            fi
        fi
        if is_blocked "$target"; then
            exit 2
        fi
    fi
done < <(printf '%s\n' "$COMMAND" | awk '{ gsub(/&&|\|\||;|\|/, "\n"); print }')

exit 0
