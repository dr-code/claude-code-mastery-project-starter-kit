#!/usr/bin/env node
// registry.mjs — the one reader/writer of the starter-kit project registry.
//
// Usage: node scripts/registry.mjs <command> [--option value ...]
//
//   normalize                    repair the file in place (backs it up first when it changes)
//   list [--json]                show registered projects; marks folders that no longer exist
//   add --path P [--name N] [--profile X] [--language L] [--framework F] [--database D]
//                                register a project, or update the fields of an existing entry
//   touch --path P               record an update (updatedAt, updateCount); registers P if missing
//   remove --path P              unregister a project (never deletes anything on disk)
//
// The registry lives at ~/.claude/starter-kit-projects.json (override with the
// STARTER_KIT_REGISTRY environment variable). It is always written as
//   { "projects": [ { name, path, profile, language, framework, database, createdAt, ... } ] }
// but is READ in every shape it has been seen in: that object, a bare array, and
// arrays nested inside arrays. Entries without a path are dropped (with a warning)
// and duplicate paths are collapsed (first one wins). A file that is not valid JSON
// is never overwritten.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY =
  process.env.STARTER_KIT_REGISTRY || path.join(os.homedir(), '.claude', 'starter-kit-projects.json');

function warn(message) {
  process.stderr.write(`registry: ${message}\n`);
}

function fail(message) {
  warn(message);
  process.exit(1);
}

const expandHome = (p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const keyOf = (p) => path.resolve(expandHome(p));

// Collect every project-looking object, whatever the nesting.
function collect(node, out, stats) {
  if (Array.isArray(node)) {
    if (out.depth > 0) stats.nested += 1;
    out.depth += 1;
    for (const item of node) collect(item, out, stats);
    out.depth -= 1;
  } else if (node && typeof node === 'object') {
    if (Array.isArray(node.projects) && typeof node.path !== 'string') {
      collect(node.projects, out, stats);
    } else if (typeof node.path === 'string' && node.path.trim() !== '') {
      out.items.push(node);
    } else {
      stats.dropped += 1;
      warn(`dropped an entry with no path: ${JSON.stringify(node).slice(0, 80)}`);
    }
  } else if (node !== null && node !== undefined) {
    stats.dropped += 1;
    warn(`dropped a non-object entry: ${JSON.stringify(node).slice(0, 80)}`);
  }
}

function load() {
  if (!fs.existsSync(REGISTRY)) {
    return { exists: false, raw: '', projects: [], stats: { nested: 0, dropped: 0, duplicates: 0 }, repaired: false };
  }
  const raw = fs.readFileSync(REGISTRY, 'utf8');
  let data;
  try {
    data = raw.trim() === '' ? { projects: [] } : JSON.parse(raw);
  } catch (error) {
    fail(`${REGISTRY} is not valid JSON (${error.message}). Not touching it; fix or move it first.`);
  }
  const stats = { nested: 0, dropped: 0, duplicates: 0 };
  const collected = { items: [], depth: 0 };
  collect(data, collected, stats);
  const canonicalShape =
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray(data.projects) &&
    data.projects.every((e) => e && typeof e === 'object' && !Array.isArray(e) && typeof e.path === 'string');
  const seen = new Set();
  const projects = [];
  for (const entry of collected.items) {
    const key = keyOf(entry.path);
    if (seen.has(key)) {
      stats.duplicates += 1;
      warn(`dropped a duplicate of ${entry.path}`);
      continue;
    }
    seen.add(key);
    projects.push(entry);
  }
  const repaired = !canonicalShape || stats.nested > 0 || stats.dropped > 0 || stats.duplicates > 0;
  return { exists: true, raw, projects, stats, repaired };
}

const serialize = (projects) => `${JSON.stringify({ projects }, null, 2)}\n`;

// True when the file already holds exactly these projects in the canonical shape,
// ignoring whitespace, so a formatting-only difference never causes a rewrite.
function sameStructure(raw, projects) {
  try {
    return JSON.stringify(JSON.parse(raw)) === JSON.stringify({ projects });
  } catch {
    return false;
  }
}

function save(state, projects, { backup = false } = {}) {
  const next = serialize(projects);
  if (state.exists && (state.raw === next || sameStructure(state.raw, projects))) return false;
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  if (state.exists && (state.repaired || backup)) {
    const backupDir = path.join(path.dirname(REGISTRY), 'starter-kit-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupDir, `registry-${stamp}.json`), state.raw);
  }
  const tmp = `${REGISTRY}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, REGISTRY);
  return true;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'json') {
      opts.json = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`--${key} needs a value`);
      opts[key] = value;
      i += 1;
    }
  }
  return opts;
}

function requirePath(opts) {
  if (!opts.path) fail('--path is required');
  return opts.path;
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const state = load();

  switch (command) {
    case 'normalize': {
      const changed = save(state, state.projects);
      const { nested, dropped, duplicates } = state.stats;
      process.stdout.write(
        `registry: ${state.projects.length} project(s)` +
          `${nested ? `, flattened ${nested} nested list(s)` : ''}` +
          `${dropped ? `, dropped ${dropped} without a path` : ''}` +
          `${duplicates ? `, collapsed ${duplicates} duplicate(s)` : ''}` +
          `${changed ? ' (file rewritten; previous copy saved in starter-kit-backups)' : ' (already canonical)'}\n`,
      );
      break;
    }
    case 'list': {
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(state.projects, null, 2)}\n`);
        break;
      }
      if (state.projects.length === 0) {
        process.stdout.write('No projects registered.\n');
        break;
      }
      for (const p of state.projects) {
        const missing = fs.existsSync(expandHome(p.path)) ? '' : ' (missing)';
        process.stdout.write(`${(p.name ?? path.basename(p.path)).padEnd(24)} ${(p.profile ?? '-').padEnd(10)} ${p.path}${missing}\n`);
      }
      break;
    }
    case 'add': {
      const p = requirePath(opts);
      const fields = {};
      for (const key of ['name', 'profile', 'language', 'framework', 'database']) {
        if (opts[key] !== undefined) fields[key] = opts[key];
      }
      const existing = state.projects.find((e) => keyOf(e.path) === keyOf(p));
      if (existing) {
        Object.assign(existing, fields);
      } else {
        state.projects.push({
          name: fields.name ?? path.basename(path.resolve(expandHome(p))),
          path: p,
          profile: fields.profile ?? 'custom',
          language: fields.language ?? 'unknown',
          framework: fields.framework ?? 'unknown',
          database: fields.database ?? 'unknown',
          createdAt: now(),
        });
      }
      save(state, state.projects);
      process.stdout.write(`registry: ${existing ? 'updated' : 'added'} ${p}\n`);
      break;
    }
    case 'touch': {
      const p = requirePath(opts);
      let entry = state.projects.find((e) => keyOf(e.path) === keyOf(p));
      if (!entry) {
        entry = {
          name: path.basename(path.resolve(expandHome(p))),
          path: p,
          profile: 'existing',
          language: 'unknown',
          framework: 'unknown',
          database: 'unknown',
          createdAt: now(),
        };
        state.projects.push(entry);
      }
      entry.updatedAt = now();
      entry.updateCount = (Number.isInteger(entry.updateCount) ? entry.updateCount : 0) + 1;
      save(state, state.projects);
      process.stdout.write(`registry: recorded update #${entry.updateCount} for ${p}\n`);
      break;
    }
    case 'remove': {
      const p = requirePath(opts);
      const before = state.projects.length;
      const kept = state.projects.filter((e) => keyOf(e.path) !== keyOf(p));
      save(state, kept, { backup: true });
      process.stdout.write(`registry: ${before === kept.length ? 'not registered' : 'removed'} ${p}\n`);
      break;
    }
    default:
      fail('usage: registry.mjs <normalize|list|add|touch|remove> [--path P ...]');
  }
}

main();
