/**
 * Project registry tool — Unit Tests
 *
 * scripts/registry.mjs is the only reader/writer of ~/.claude/starter-kit-projects.json.
 * It must read every shape the file has been seen in, always write the canonical
 * { "projects": [...] } form, and never destroy a file it cannot parse.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? __dirname, '../..');
const TOOL = path.join(ROOT, 'scripts/registry.mjs');

interface Entry {
  name?: string;
  path: string;
  profile?: string;
  createdAt?: string;
  updatedAt?: string;
  updateCount?: number;
}

describe('registry.mjs', () => {
  let tmp: string;
  let registry: string;

  const run = (...args: string[]) =>
    spawnSync('node', [TOOL, ...args], {
      env: { ...process.env, STARTER_KIT_REGISTRY: registry },
      encoding: 'utf8',
    });

  const write = (value: unknown) => fs.writeFileSync(registry, typeof value === 'string' ? value : JSON.stringify(value));
  const read = (): { projects: Entry[] } => JSON.parse(fs.readFileSync(registry, 'utf8'));
  const backups = () => {
    const dir = path.join(tmp, 'starter-kit-backups');
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };

  const a: Entry = { name: 'alpha', path: '/work/alpha', profile: 'converted', createdAt: '2026-03-02T00:00:00Z' };
  const b: Entry = { name: 'beta', path: '/work/beta', profile: 'custom' };
  const c: Entry = { name: 'gamma', path: '/work/gamma', profile: 'python-api' };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-'));
    registry = path.join(tmp, 'starter-kit-projects.json');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads the canonical shape and leaves it untouched', () => {
    write({ projects: [a, b] });
    const before = fs.readFileSync(registry, 'utf8');
    const r = run('normalize');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/2 project\(s\).*already canonical/);
    expect(fs.readFileSync(registry, 'utf8')).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('repairs the shape seen in the wild: a nested array plus a loose entry', () => {
    write([[a, b], c]);
    const r = run('normalize');
    expect(r.status, r.stderr).toBe(0);
    expect(read().projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.stdout).toMatch(/flattened 1 nested/);
    expect(backups()).toHaveLength(1);
  });

  it('reads a bare array and a deeply nested array', () => {
    write([a, [b, [c]]]);
    expect(run('normalize').status).toBe(0);
    expect(read().projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('drops entries without a path and collapses duplicate paths (first wins)', () => {
    write([{ path: '' }, { name: 'no-path' }, a, { ...a, name: 'alpha-again' }, '/stray/string']);
    const r = run('normalize');
    expect(r.status, r.stderr).toBe(0);
    expect(read().projects.map((p) => p.name)).toEqual(['alpha']);
    expect(r.stderr).toMatch(/duplicate/);
    expect(r.stderr).toMatch(/no path/);
  });

  it('never overwrites a file that is not valid JSON', () => {
    write('{ this is not json');
    const r = run('add', '--path', '/work/new');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not valid JSON/);
    expect(fs.readFileSync(registry, 'utf8')).toBe('{ this is not json');
  });

  it('creates the file in canonical form when none exists', () => {
    const r = run('add', '--path', '/work/new', '--name', 'new', '--profile', 'default', '--language', 'node');
    expect(r.status, r.stderr).toBe(0);
    const { projects } = read();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'new', path: '/work/new', profile: 'default', language: 'node' });
    expect(projects[0]?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it('add on a legacy-shaped file writes the canonical shape and keeps every project', () => {
    write([[a, b], c]);
    expect(run('add', '--path', '/work/delta', '--name', 'delta').status).toBe(0);
    expect(read().projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  it('add on an existing path updates fields but keeps createdAt', () => {
    write({ projects: [a] });
    expect(run('add', '--path', a.path, '--profile', 'default').status).toBe(0);
    const { projects } = read();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.profile).toBe('default');
    expect(projects[0]?.createdAt).toBe(a.createdAt);
  });

  it('touch records an update and increments the count', () => {
    write({ projects: [a] });
    run('touch', '--path', a.path);
    const second = run('touch', '--path', a.path);
    expect(second.status, second.stderr).toBe(0);
    const entry = read().projects[0];
    expect(entry?.updateCount).toBe(2);
    expect(entry?.updatedAt).toBeDefined();
    expect(entry?.createdAt).toBe(a.createdAt);
  });

  it('touch registers a project that is missing', () => {
    write({ projects: [a] });
    expect(run('touch', '--path', '/work/unregistered').status).toBe(0);
    const added = read().projects.find((p) => p.path === '/work/unregistered');
    expect(added).toMatchObject({ name: 'unregistered', profile: 'existing', updateCount: 1 });
  });

  it('matches paths that differ only by a trailing slash', () => {
    write({ projects: [a] });
    expect(run('touch', '--path', `${a.path}/`).status).toBe(0);
    expect(read().projects).toHaveLength(1);
  });

  it('routine add and touch on a canonical file make no backups; remove makes one', () => {
    write({ projects: [a] });
    run('add', '--path', '/work/second');
    run('touch', '--path', a.path);
    expect(backups()).toEqual([]);
    run('remove', '--path', '/work/second');
    expect(backups()).toHaveLength(1);
  });

  it('remove drops only the registry entry', () => {
    write({ projects: [a, b] });
    expect(run('remove', '--path', a.path).status).toBe(0);
    expect(read().projects.map((p) => p.name)).toEqual(['beta']);
    expect(run('remove', '--path', '/work/never-there').stdout).toMatch(/not registered/);
  });

  it('list --json returns the flattened projects', () => {
    write([[a], b]);
    const r = run('list', '--json');
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Entry[]).map((p) => p.name)).toEqual(['alpha', 'beta']);
  });

  it('marks folders that no longer exist', () => {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    write({ projects: [{ name: 'real', path: real }, { name: 'gone', path: path.join(tmp, 'gone') }] });
    const r = run('list');
    expect(r.stdout).toMatch(/gone.*\(missing\)/);
    expect(r.stdout).not.toMatch(/real.*\(missing\)/);
  });

  it('rejects unknown commands and missing values', () => {
    expect(run('frobnicate').status).not.toBe(0);
    expect(run('add').status).not.toBe(0);
    expect(run('add', '--path').status).not.toBe(0);
  });
});
