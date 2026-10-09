/**
 * check-branch.sh — Unit Tests
 *
 * The hook must judge the repository a `git commit` really targets (following
 * `cd <dir> &&` and `git -C <dir>`), not just the folder the session started in.
 * Exit code 2 = blocked, 0 = allowed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOK = path.resolve(import.meta.dirname ?? __dirname, '../../.claude/hooks/check-branch.sh');

function git(dir: string, ...args: string[]) {
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { stdio: 'ignore' });
}

describe('check-branch.sh', () => {
  let tmp: string;
  let onMain: string; // repository on main
  let onFeature: string; // repository on a feature branch
  let optedOut: string; // on main, but auto_branch = false
  let fresh: string; // on main with no commits yet
  let notRepo: string;

  const hook = (cwd: string, command: string, env: Record<string, string> = {}) =>
    spawnSync('bash', [HOOK], {
      cwd,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      env: { ...process.env, HOME: tmp, ...env },
      encoding: 'utf8',
    });

  const blocked = (cwd: string, command: string) => hook(cwd, command).status === 2;

  function makeRepo(name: string, branch: string, withCommit = true): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', branch], { stdio: 'ignore' });
    if (withCommit) git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
    return dir;
  }

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-branch-')));
    onMain = makeRepo('on-main', 'main');
    onFeature = makeRepo('on-feature', 'main');
    git(onFeature, 'checkout', '-q', '-b', 'feat/work');
    optedOut = makeRepo('opted-out', 'main');
    fs.writeFileSync(path.join(optedOut, 'claude-mastery-project.conf'), 'auto_branch = false  # I work on main\n');
    fresh = makeRepo('fresh', 'main', false);
    notRepo = path.join(tmp, 'not-a-repo');
    fs.mkdirSync(notRepo);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('current folder', () => {
    it('blocks a commit on main', () => {
      const r = hook(onMain, 'git commit -m "x"');
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/BLOCKED/);
      expect(r.stderr).toContain('on-main');
    });

    it('allows a commit on a feature branch', () => {
      expect(blocked(onFeature, 'git commit -m "x"')).toBe(false);
    });

    it('ignores commands that are not commits', () => {
      for (const cmd of ['git status', 'git log --oneline', 'echo hello', 'git commit-tree HEAD^{tree}', 'git add -A']) {
        expect(blocked(onMain, cmd), cmd).toBe(false);
      }
    });

    it('allows an initial commit (no commits yet) and a non-repository', () => {
      expect(blocked(fresh, 'git commit -m "first"')).toBe(false);
      expect(blocked(notRepo, 'git commit -m "x"')).toBe(false);
    });

    it('respects auto_branch = false in the target repository', () => {
      expect(blocked(optedOut, 'git commit -m "x"')).toBe(false);
    });
  });

  describe('follows cd', () => {
    it('allows cd to a feature-branch repo from a session sitting on main (the original false positive)', () => {
      expect(blocked(onMain, `cd ${onFeature} && git add -A && git commit -m "x"`)).toBe(false);
    });

    it('blocks cd into a repo on main from a session sitting on a feature branch', () => {
      expect(blocked(onFeature, `cd ${onMain} && git commit -m "x"`)).toBe(true);
    });

    it('resolves relative paths against the session folder', () => {
      expect(blocked(onFeature, 'cd ../on-main && git commit -m "x"')).toBe(true);
      expect(blocked(onMain, 'cd ../on-feature && git commit -m "x"')).toBe(false);
    });

    it('expands ~ and quotes', () => {
      expect(blocked(onFeature, 'cd ~/on-main && git commit -m "x"')).toBe(true);
      expect(blocked(onFeature, `cd "${onMain}" && git commit -m "x"`)).toBe(true);
      expect(blocked(onMain, 'cd "$HOME/on-feature" && git commit -m "x"')).toBe(false);
    });

    it('is not fooled by separators inside the commit message', () => {
      expect(blocked(onFeature, `cd ${onMain} && git add -A && git commit -m "fix: a; b && c | d"`)).toBe(true);
    });
  });

  describe('follows git -C (the old hook skipped these entirely)', () => {
    it('blocks git -C into a repo on main', () => {
      expect(blocked(onFeature, `git -C ${onMain} commit -m "x"`)).toBe(true);
    });

    it('allows git -C into a feature-branch repo from a session on main', () => {
      expect(blocked(onMain, `git -C ${onFeature} commit -m "x"`)).toBe(false);
    });

    it('expands ~ and quotes in the -C path', () => {
      expect(blocked(onFeature, 'git -C ~/on-main commit -m "x"')).toBe(true);
      expect(blocked(onFeature, `git -C "${onMain}" commit -m "x"`)).toBe(true);
    });

    it('handles -c options and other flags before commit', () => {
      expect(blocked(onFeature, `git -c user.name=t -C ${onMain} commit -m "x"`)).toBe(true);
      expect(blocked(onFeature, `git -C ${onMain} --no-pager commit -m "x"`)).toBe(true);
    });

    it('combines cd and a relative -C', () => {
      expect(blocked(onMain, `cd ${tmp} && git -C on-feature commit -m "x"`)).toBe(false);
      expect(blocked(onFeature, `cd ${tmp} && git -C on-main commit -m "x"`)).toBe(true);
    });
  });

  describe('several commands in one line', () => {
    it('blocks if ANY commit in the line targets main', () => {
      const cmd = `git commit -m "a" && cd ${onMain} && git commit -m "b"`;
      expect(blocked(onFeature, cmd)).toBe(true);
    });

    it('allows when every commit targets a feature branch', () => {
      const cmd = `git commit -m "a"; git -C ${onFeature} commit -m "b"`;
      expect(blocked(onFeature, cmd)).toBe(false);
    });
  });

  it('fails open on empty or malformed input', () => {
    const r = spawnSync('bash', [HOOK], { cwd: onMain, input: '', encoding: 'utf8' });
    expect(r.status).toBe(0);
    const bad = spawnSync('bash', [HOOK], { cwd: onMain, input: 'not json', encoding: 'utf8' });
    expect(bad.status).toBe(0);
  });
});
