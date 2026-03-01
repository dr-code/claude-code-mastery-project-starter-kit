/**
 * Centralized Database Adapter — StrictDB
 *
 * ALL database access MUST go through this file.
 * NEVER import StrictDB or native drivers directly in other files.
 *
 * Thin adapter around StrictDB preserving standalone function exports.
 * Supports: MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, Elasticsearch.
 * Backend auto-detected from STRICTDB_URI scheme.
 */

import { StrictDB, type StrictDBError } from 'strictdb';
import type {
  BatchOperation,
  CollectionSchema,
  IndexDefinition,
  StrictFilter,
} from 'strictdb';

// Singleton instance via globalThis symbol
const INSTANCE_KEY = Symbol.for('__strictdb_instance__');
const URI_KEY = Symbol.for('__strictdb_uri__');

function getInstance(): StrictDB | undefined {
  return (globalThis as Record<symbol, StrictDB | undefined>)[INSTANCE_KEY];
}

function getStoredUri(): string | undefined {
  return (globalThis as Record<symbol, string | undefined>)[URI_KEY];
}

function setInstance(db: StrictDB, uri: string): void {
  (globalThis as Record<symbol, unknown>)[INSTANCE_KEY] = db;
  (globalThis as Record<symbol, unknown>)[URI_KEY] = uri;
}

async function getDb(): Promise<StrictDB> {
  const existing = getInstance();
  if (existing) return existing;
  return connect();
}

// Connection

interface ConnectOptions {
  pool?: 'high' | 'standard' | 'low';
  dbName?: string;
  label?: string;
}

/** Connect to the database. Safe to call multiple times — only connects once. */
export async function connect(
  uri?: string,
  options: ConnectOptions = {},
): Promise<StrictDB> {
  const connectionUri = uri ?? process.env.STRICTDB_URI ?? '';
  if (!connectionUri) {
    throw new Error('No database URI provided. Set STRICTDB_URI environment variable.');
  }

  const existing = getInstance();
  if (existing) {
    const storedUri = getStoredUri();
    if (storedUri && storedUri !== connectionUri) {
      throw new Error(
        `Already connected to a different database. Call closePool() before connecting to a new URI.`,
      );
    }
    return existing;
  }

  const db = await StrictDB.create({
    uri: connectionUri,
    pool: options.pool ?? 'standard',
    dbName: options.dbName,
    label: options.label,
  });

  setInstance(db, connectionUri);
  return db;
}

// Read operations

export async function queryOne<T>(
  collection: string,
  filter: Record<string, unknown>,
): Promise<T | null> {
  const db = await getDb();
  return db.queryOne<T>(collection, filter as StrictFilter<T>);
}

export async function queryMany<T>(
  collection: string,
  filter: Record<string, unknown>,
  options?: { sort?: Record<string, 1 | -1>; limit?: number; skip?: number },
): Promise<T[]> {
  const db = await getDb();
  return db.queryMany<T>(collection, filter as StrictFilter<T>, options);
}

export async function queryWithLookup<T>(
  collection: string,
  options: {
    match: Record<string, unknown>;
    lookup: { from: string; localField: string; foreignField: string; as: string };
    unwind?: string;
  },
): Promise<T | null> {
  const db = await getDb();
  return db.queryWithLookup<T>(collection, {
    ...options,
    match: options.match as StrictFilter<T>,
  });
}

export async function count(
  collection: string,
  filter: Record<string, unknown> = {},
): Promise<number> {
  const db = await getDb();
  return db.count(collection, filter as StrictFilter<Record<string, unknown>>);
}

// Write operations — all return OperationReceipt

export async function insertOne(collection: string, doc: Record<string, unknown>) {
  const db = await getDb();
  return db.insertOne(collection, doc);
}

export async function insertMany(collection: string, docs: Record<string, unknown>[]) {
  const db = await getDb();
  return db.insertMany(collection, docs);
}

export async function updateOne(
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  upsert = false,
) {
  const db = await getDb();
  return db.updateOne(collection, filter, update, upsert);
}

export async function updateMany(
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  const db = await getDb();
  return db.updateMany(collection, filter, update);
}

export async function deleteOne(collection: string, filter: Record<string, unknown>) {
  const db = await getDb();
  return db.deleteOne(collection, filter);
}

export async function deleteMany(collection: string, filter: Record<string, unknown>) {
  const db = await getDb();
  return db.deleteMany(collection, filter);
}

export async function batch(operations: BatchOperation[]) {
  const db = await getDb();
  return db.batch(operations);
}

/** @deprecated Use `batch` instead. Will be removed in next major version. */
export const bulkOps = batch;

// AI-first discovery

export async function describe(collection: string) {
  const db = await getDb();
  return db.describe(collection);
}

export async function validate(
  collection: string,
  check: { filter?: Record<string, unknown>; doc?: Record<string, unknown> },
) {
  const db = await getDb();
  return db.validate(collection, check);
}

export async function explain(
  collection: string,
  query: { filter?: Record<string, unknown>; limit?: number },
) {
  const db = await getDb();
  return db.explain(collection, query);
}

// Schema registration + indexes

const _pendingRegistrations: CollectionSchema<unknown>[] = [];
const _pendingIndexes: IndexDefinition[] = [];

export function registerCollection<T = unknown>(def: CollectionSchema<T>) {
  const db = getInstance();
  if (!db) { _pendingRegistrations.push(def as CollectionSchema<unknown>); return; }
  db.registerCollection(def);
}

export function registerIndex(def: IndexDefinition) {
  const db = getInstance();
  if (!db) { _pendingIndexes.push(def); return; }
  db.registerIndex(def);
}

export async function ensureIndexes(options?: { dryRun?: boolean }) {
  const db = await getDb();
  for (const def of _pendingRegistrations) { db.registerCollection(def); }
  _pendingRegistrations.length = 0;
  for (const def of _pendingIndexes) { db.registerIndex(def); }
  _pendingIndexes.length = 0;
  return db.ensureIndexes(options);
}

// Lifecycle

export async function closePool(): Promise<void> {
  const db = getInstance();
  if (!db) return;
  await db.close();
  (globalThis as Record<symbol, unknown>)[INSTANCE_KEY] = undefined;
  (globalThis as Record<symbol, unknown>)[URI_KEY] = undefined;
}

let _shuttingDown = false;

/** Gracefully close all connections and exit. Safe to call from multiple signal handlers. */
export async function gracefulShutdown(
  exitCode: number | unknown = 0,
  exit: (code: number) => void = process.exit,
): Promise<void> {
  if (_shuttingDown) return;
  _shuttingDown = true;

  const code = typeof exitCode === 'number' ? exitCode : 1;
  console.log(`[db] Graceful shutdown initiated (exit code: ${code})...`);

  try {
    await closePool();
    console.log('[db] All connections closed.');
  } catch (err) {
    console.error('[db] Error during shutdown:', err);
  }

  exit(code);
}

/** Reset shutdown flag — for testing only. */
export function _resetShutdownFlag(): void {
  _shuttingDown = false;
}

/** Get the raw StrictDB instance for advanced use. */
export async function raw(): Promise<StrictDB> {
  return getDb();
}

// Re-export StrictDB types
export {
  StrictDB,
  type StrictDBError,
  type BatchOperation,
  type CollectionSchema,
  type IndexDefinition,
  type OperationReceipt,
} from 'strictdb';
