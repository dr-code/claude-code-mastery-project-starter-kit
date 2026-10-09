/**
 * Kit manifest and kit-apply.sh — Unit/Integration Tests
 *
 * Guards the uniformity guarantees:
 * - the manifest matches what is actually in .claude/ (catches commands that
 *   exist in the kit but are never copied into projects, as /mdd once was)
 * - project settings never wire globally-owned or plugin-owned hooks
 * - kit-apply.sh produces the same project layer every time and is idempotent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? __dirname, '../..');
const KIT_APPLY = path.join(ROOT, 'scripts/kit-apply.sh');

interface Profile {
  hooks: string | string[];
  settingsTemplate: string;
}
interface Manifest {
  files: {
    commands: string[];
    skills: string[];
    agents: string[];
    hooks: { project: string[]; global: string[] };
  };
  profiles: Record<string, Profile>;
  gitignore: string[];
  managedBlocks: { id: string; source?: string; startMarker: string; endMarker: string }[];
  globalTools: { id: string; check: string; install: string }[];
}

const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'starter-kit-manifest.json'), 'utf8'),
);

// Project hooks are wired through the project-root variable so they work from any subfolder.
const hookCmd = (name: string) => `bash "\${CLAUDE_PROJECT_DIR}"/.claude/hooks/${name}`;
const scriptOf = (cmd: string) => /hooks\/([\w.-]+)\s*$/.exec(cmd)?.[1] ?? '';

const FORBIDDEN_IN_PROJECT_SETTINGS = /block-secrets|verify-no-secrets|check-rulecatch|plannotator/;

function wiredCommands(settingsPath: string): string[] {
  const out: string[] = [];
  JSON.stringify(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), (k, v) => {
    if (k === 'command') out.push(v as string);
    return v;
  });
  return out;
}

describe('starter-kit-manifest.json', () => {
  it('lists exactly the commands whose frontmatter says scope: project', () => {
    const dir = path.join(ROOT, '.claude/commands');
    const projectScoped = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => /^scope:\s*project\s*$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
    expect([...manifest.files.commands].sort()).toEqual(projectScoped);
  });

  it('references only files that exist', () => {
    for (const c of manifest.files.commands) {
      expect(fs.existsSync(path.join(ROOT, `.claude/commands/${c}.md`)), `command ${c}`).toBe(true);
    }
    for (const s of manifest.files.skills) {
      expect(fs.existsSync(path.join(ROOT, `.claude/skills/${s}`)), `skill ${s}`).toBe(true);
    }
    for (const a of manifest.files.agents) {
      expect(fs.existsSync(path.join(ROOT, `.claude/agents/${a}.md`)), `agent ${a}`).toBe(true);
    }
    for (const h of [...manifest.files.hooks.project, ...manifest.files.hooks.global]) {
      expect(fs.existsSync(path.join(ROOT, `.claude/hooks/${h}`)), `hook ${h}`).toBe(true);
    }
    for (const p of Object.values(manifest.profiles)) {
      expect(fs.existsSync(path.join(ROOT, p.settingsTemplate)), p.settingsTemplate).toBe(true);
    }
    for (const b of manifest.managedBlocks) {
      if (b.source) expect(fs.existsSync(path.join(ROOT, b.source)), b.source).toBe(true);
    }
  });

  it("the kit's own .claude/settings.json is exactly the default project template", () => {
    const own = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
    const template = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/project-settings.json'), 'utf8'));
    expect(own).toEqual(template);
  });

  it('lint-on-save fires on both Write and Edit in every settings template', () => {
    for (const profile of Object.values(manifest.profiles)) {
      const t = JSON.parse(fs.readFileSync(path.join(ROOT, profile.settingsTemplate), 'utf8'));
      const group = t.hooks.PostToolUse.find((g: { hooks: { command: string }[] }) =>
        g.hooks.some((h) => h.command.includes('lint-on-save')),
      );
      expect(group.matcher).toBe('Write|Edit');
    }
  });

  it('keeps project and global hooks disjoint', () => {
    const overlap = manifest.files.hooks.project.filter((h) => manifest.files.hooks.global.includes(h));
    expect(overlap).toEqual([]);
  });

  it('ignores .mcp.json so its absolute project path can never be committed', () => {
    expect(manifest.gitignore).toContain('.mcp.json');
  });

  it('settings templates wire only existing project hooks, never global or plugin-owned ones', () => {
    for (const [name, profile] of Object.entries(manifest.profiles)) {
      const allowed = Array.isArray(profile.hooks) ? profile.hooks : manifest.files.hooks.project;
      const cmds = wiredCommands(path.join(ROOT, profile.settingsTemplate));
      for (const cmd of cmds) {
        expect(cmd, `${name}: ${cmd}`).not.toMatch(FORBIDDEN_IN_PROJECT_SETTINGS);
        const file = scriptOf(cmd);
        expect(cmd, `${name}: ${cmd}`).toBe(hookCmd(file));
        expect(allowed, `${name} wires ${file}`).toContain(file);
      }
    }
  });
});

describe('kit-apply.sh', () => {
  let tmp: string;
  let project: string;

  // PATH without tessera/claude so results do not depend on the developer machine.
  const env = () => ({
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: path.join(tmp, 'home'),
    STARTER_KIT_SKIP_INSTALL: '1',
  });

  const run = (...args: string[]) =>
    spawnSync('bash', [KIT_APPLY, project, ...args], { env: env(), encoding: 'utf8' });

  function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out[path.relative(dir, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
      }
    };
    walk(dir);
    return out;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-apply-'));
    fs.mkdirSync(path.join(tmp, 'home'));
    project = path.join(tmp, 'proj');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# Test project\n');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('applies the default profile: all manifest commands including mdd, project hooks, managed blocks', () => {
    const r = run();
    expect(r.status, r.stderr + r.stdout).toBe(0);

    const cmds = fs.readdirSync(path.join(project, '.claude/commands')).sort();
    expect(cmds).toEqual(manifest.files.commands.map((c) => `${c}.md`).sort());
    expect(cmds).toContain('mdd.md');

    expect(fs.readdirSync(path.join(project, '.claude/hooks')).sort()).toEqual(
      [...manifest.files.hooks.project].sort(),
    );

    const settings = path.join(project, '.claude/settings.json');
    for (const cmd of wiredCommands(settings)) {
      expect(cmd).not.toMatch(FORBIDDEN_IN_PROJECT_SETTINGS);
      expect(cmd).toBe(hookCmd(scriptOf(cmd)));
      expect(fs.existsSync(path.join(project, '.claude/hooks', scriptOf(cmd)))).toBe(true);
    }

    const gitignore = fs.readFileSync(path.join(project, '.gitignore'), 'utf8').split('\n');
    for (const entry of manifest.gitignore) expect(gitignore).toContain(entry);

    const claudeMd = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    expect(claudeMd.match(/STARTER-KIT:WORKFLOW:START/g)).toHaveLength(1);
    expect(claudeMd.match(/STARTER-KIT:WORKFLOW:END/g)).toHaveLength(1);
    expect(claudeMd).toContain('# Test project');
  });

  it('is idempotent: a second run changes nothing', () => {
    expect(run().status).toBe(0);
    const first = snapshot(project);
    expect(run().status).toBe(0);
    expect(snapshot(project)).toEqual(first);
  });

  it('warns about globally-owned hooks in an existing settings.json without deleting anything', () => {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    const settings = path.join(project, '.claude/settings.json');
    fs.writeFileSync(
      settings,
      JSON.stringify({
        permissions: { allow: ['Bash(ls)'] },
        hooks: {
          PreToolUse: [
            { matcher: 'Read|Edit|Write', hooks: [{ type: 'command', command: 'python3 .claude/hooks/block-secrets.py' }] },
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'bash my-custom.sh' }] }],
        },
      }),
    );

    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/WARNING globally-owned hooks/);

    const after = fs.readFileSync(settings, 'utf8');
    expect(after).toContain('my-custom.sh');
    expect(after).toContain('block-secrets.py');
    expect(JSON.parse(after).permissions).toEqual({ allow: ['Bash(ls)'] });
  });

  it('applies the clean profile with only lint-on-save', () => {
    const r = run('--profile', 'clean');
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(path.join(project, '.claude/hooks'))).toEqual(['lint-on-save.sh']);
    expect(wiredCommands(path.join(project, '.claude/settings.json'))).toEqual([hookCmd('lint-on-save.sh')]);
  });

  it('rejects an unknown profile', () => {
    const r = run('--profile', 'nope');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unknown profile/);
  });

  const changesOf = (stdout: string) => Number(/RESULT: changes=(\d+)/.exec(stdout)?.[1] ?? NaN);
  const commandsIn = (file: string) => wiredCommands(file);

  describe('update mode on an existing project', () => {
    function seedExisting() {
      fs.mkdirSync(path.join(project, '.claude/commands'), { recursive: true });
      fs.writeFileSync(path.join(project, '.claude/commands/mdd.md'), 'OLD STALE CONTENT\n');
      fs.writeFileSync(path.join(project, '.claude/commands/my-own.md'), 'user command\n');
      fs.writeFileSync(
        path.join(project, '.claude/settings.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/check-rybbit.sh' }],
              },
            ],
          },
        }),
      );
    }

    it('--dry-run reports changes but writes nothing', () => {
      seedExisting();
      const before = snapshot(project);
      const r = run('--dry-run');
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(r.stdout).toMatch(/Dry run complete: nothing was written/);
      expect(changesOf(r.stdout)).toBeGreaterThan(0);
      expect(r.stdout).toMatch(/UPDATED: mdd\.md/);
      expect(snapshot(project)).toEqual(before);
    });

    it('--backup-dir saves the old copy of every changed file and leaves custom files alone', () => {
      seedExisting();
      const backup = path.join(tmp, 'backup');
      const r = run('--backup-dir', backup);
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(fs.readFileSync(path.join(backup, '.claude/commands/mdd.md'), 'utf8')).toBe('OLD STALE CONTENT\n');
      expect(fs.existsSync(path.join(backup, '.claude/settings.json'))).toBe(true);
      expect(fs.readFileSync(path.join(project, '.claude/commands/mdd.md'), 'utf8')).not.toContain('OLD STALE');
      expect(fs.readFileSync(path.join(project, '.claude/commands/my-own.md'), 'utf8')).toBe('user command\n');
    });

    it.each([
      ['~/.claude path', 'bash ~/.claude/hooks/check-rybbit.sh'],
      ['project-relative path (fails from a subfolder)', 'bash .claude/hooks/check-rybbit.sh'],
    ])('migrates a project hook wired through a %s to the project-root form instead of duplicating it', (_label, legacy) => {
      seedExisting();
      const settings = path.join(project, '.claude/settings.json');
      fs.writeFileSync(
        settings,
        JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: legacy }] }] } }),
      );
      expect(run().status).toBe(0);
      const cmds = commandsIn(settings);
      expect(cmds.filter((c) => c.includes('check-rybbit.sh'))).toEqual([hookCmd('check-rybbit.sh')]);
      expect(new Set(cmds).size).toBe(cmds.length);
      expect(cmds.some((c) => c.includes('~/.claude') || /(^|\s)\.claude\/hooks/.test(c))).toBe(false);
    });

    it('moves a hook that sits under a different matcher to the template matcher, without duplicating it', () => {
      fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(project, '.claude/settings.json'),
        JSON.stringify({
          hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: hookCmd('lint-on-save.sh') }] }] },
        }),
      );
      const r = run();
      expect(r.status, r.stderr + r.stdout).toBe(0);
      const post = JSON.parse(fs.readFileSync(path.join(project, '.claude/settings.json'), 'utf8')).hooks.PostToolUse;
      const lintGroups = post.filter((g: { hooks: { command: string }[] }) => g.hooks.some((h) => h.command.includes('lint-on-save')));
      expect(lintGroups).toHaveLength(1);
      expect(lintGroups[0].matcher).toBe('Write|Edit');
      expect(post.every((g: { hooks: unknown[] }) => g.hooks.length > 0)).toBe(true);
      expect(changesOf(run().stdout)).toBe(0);
    });

    it('reports changes=0 on a second run', () => {
      seedExisting();
      expect(changesOf(run().stdout)).toBeGreaterThan(0);
      expect(changesOf(run().stdout)).toBe(0);
    });

    const seedRedundant = () => {
      fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(project, '.claude/settings.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { matcher: 'Read|Edit|Write', hooks: [{ type: 'command', command: 'python3 .claude/hooks/block-secrets.py' }] },
            ],
            PermissionRequest: [{ matcher: 'ExitPlanMode', hooks: [{ type: 'command', command: 'plannotator' }] }],
          },
        }),
      );
    };

    it('--fix-settings keeps globally-owned hooks whose replacement is NOT verified', () => {
      seedRedundant();
      const r = run('--fix-settings');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/KEPT, replacement not verified/);
      const after = fs.readFileSync(path.join(project, '.claude/settings.json'), 'utf8');
      expect(after).toContain('block-secrets.py');
      expect(after).toContain('"plannotator"');
    });

    it('--fix-settings removes them once the global hook and the plugin are verified present', () => {
      seedRedundant();
      const home = path.join(tmp, 'home/.claude');
      fs.mkdirSync(path.join(home, 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(home, 'hooks/block-secrets.py'), '#!/usr/bin/env python3\n');
      fs.writeFileSync(
        path.join(home, 'settings.json'),
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'python3 ~/.claude/hooks/block-secrets.py' }] }] } }),
      );
      fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
      fs.writeFileSync(
        path.join(home, 'plugins/installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: { 'tessera@tessera': [{ scope: 'user' }] } }),
      );
      const r = run('--fix-settings');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/removed 2 redundant/);
      const after = fs.readFileSync(path.join(project, '.claude/settings.json'), 'utf8');
      expect(after).not.toContain('block-secrets.py');
      expect(after).not.toContain('"plannotator"');
    });

    it('--no-overwrite adds missing files but keeps a differing file of the user', () => {
      seedExisting();
      const r = run('--no-overwrite');
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(fs.readFileSync(path.join(project, '.claude/commands/mdd.md'), 'utf8')).toBe('OLD STALE CONTENT\n');
      expect(r.stdout).toMatch(/KEPT \(yours differs/);
      expect(fs.existsSync(path.join(project, '.claude/commands/commit.md'))).toBe(true);
    });

    it('--skip-claude-md never touches CLAUDE.md and skips the scan', () => {
      const original = '# My own rules\n\nDo not change.\n';
      fs.writeFileSync(path.join(project, 'CLAUDE.md'), original);
      const r = run('--skip-claude-md');
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8')).toBe(original);
      expect(r.stdout).toMatch(/workflow:\s+skipped \(--skip-claude-md\)/);
      expect(r.stdout).toMatch(/scan skipped \(--skip-claude-md\)/);
    });

    it('refuses to run against the starter kit itself', () => {
      const r = spawnSync('bash', [KIT_APPLY, ROOT, '--dry-run'], { env: env(), encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/refusing to apply/);
    });
  });
});

describe('command docs stay wired to the engine', () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const command = (name: string) => read(`.claude/commands/${name}.md`);

  it('new-project.md applies the layer through kit-apply.sh in every mode', () => {
    const t = command('new-project');
    expect(t).not.toMatch(/copied in full/);
    expect(t).not.toMatch(/block-secrets\.py ~\/\.claude\/hooks/);
    // clean + default script descriptions, Go step, Python step, and four framework bullets
    expect((t.match(/kit-apply\.sh/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('update-project.md is dry-run first, branch-based, and never sweeps a dirty tree', () => {
    const t = command('update-project');
    expect(t).toMatch(/kit-apply\.sh" "\$TARGET" --dry-run/);
    expect(t).toMatch(/chore\/starter-kit-sync-/);
    expect(t).toMatch(/uncommitted changes/);
    expect(t).toMatch(/Never runs `git init`|Do NOT run `git init`/);
    expect(t).not.toMatch(/pre-update snapshot/);
    expect(t).not.toMatch(/git add -A && git commit -m "chore: pre-/);
    expect(t).not.toMatch(/deep.merge/i);
  });

  it('convert-project-to-starter-kit.md uses the engine and the dirty-tree stop', () => {
    const t = command('convert-project-to-starter-kit');
    expect(t).toMatch(/kit-apply\.sh/);
    expect(t).toMatch(/\*\*STOP\.\*\*/);
    expect(t).not.toMatch(/Safety Commit/);
    expect(t).not.toMatch(/pre-conversion snapshot/);
    expect(t).not.toMatch(/from the starter kit CLAUDE\.md/);
  });

  it('documents every option kit-apply.sh parses in its usage header', () => {
    const script = read('scripts/kit-apply.sh');
    const header = script.split('\nset -euo pipefail')[0];
    const parsed = [...script.matchAll(/^\s+(--[a-z-]+)\)/gm)].map((m) => m[1]);
    expect(parsed.length).toBeGreaterThanOrEqual(7);
    for (const flag of parsed) expect(header, flag).toContain(flag);
  });
});
