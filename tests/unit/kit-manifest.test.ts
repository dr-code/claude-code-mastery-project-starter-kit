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
        const file = cmd.split(' ')[1].replace('.claude/hooks/', '');
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
      expect(fs.existsSync(path.join(project, cmd.split(' ')[1]))).toBe(true);
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
    expect(wiredCommands(path.join(project, '.claude/settings.json'))).toEqual([
      'bash .claude/hooks/lint-on-save.sh',
    ]);
  });

  it('rejects an unknown profile', () => {
    const r = run('--profile', 'nope');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/unknown profile/);
  });
});
