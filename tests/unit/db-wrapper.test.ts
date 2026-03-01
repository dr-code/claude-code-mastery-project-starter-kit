/**
 * Database Wrapper — Unit Tests
 *
 * Tests the centralized StrictDB adapter (src/core/db/index.ts).
 * StrictDB itself is mocked — these tests verify the wrapper's
 * singleton behavior, URI validation, and lifecycle management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factory
const mockDb = vi.hoisted(() => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  queryWithLookup: vi.fn().mockResolvedValue(null),
  count: vi.fn().mockResolvedValue(0),
  insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  insertMany: vi.fn().mockResolvedValue({ acknowledged: true }),
  updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  batch: vi.fn().mockResolvedValue({ ok: true }),
  describe: vi.fn().mockResolvedValue({ fields: [] }),
  validate: vi.fn().mockResolvedValue({ valid: true }),
  explain: vi.fn().mockResolvedValue({ plan: 'scan' }),
  registerCollection: vi.fn(),
  registerIndex: vi.fn(),
  ensureIndexes: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('strictdb', () => ({
  StrictDB: {
    create: vi.fn().mockResolvedValue(mockDb),
  },
}));

// Import after mock setup
import {
  connect,
  closePool,
  queryOne,
  queryMany,
  queryWithLookup,
  count,
  insertOne,
  insertMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
  batch,
  bulkOps,
  describe as describeCollection,
  validate,
  explain,
  gracefulShutdown,
  _resetShutdownFlag,
  registerCollection,
  ensureIndexes,
} from '../../src/core/db/index.js';

// Clean up globalThis singleton between tests
const INSTANCE_KEY = Symbol.for('__strictdb_instance__');
const URI_KEY = Symbol.for('__strictdb_uri__');

function clearSingleton(): void {
  (globalThis as Record<symbol, unknown>)[INSTANCE_KEY] = undefined;
  (globalThis as Record<symbol, unknown>)[URI_KEY] = undefined;
}

describe('Database Wrapper', () => {
  beforeEach(() => {
    clearSingleton();
    _resetShutdownFlag();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearSingleton();
  });

  describe('connect()', () => {
    it('should connect with an explicit URI', async () => {
      const db = await connect('mongodb://localhost:27017/test');
      expect(db).toBe(mockDb);
    });

    it('should throw if no URI provided and STRICTDB_URI not set', async () => {
      const originalEnv = process.env.STRICTDB_URI;
      delete process.env.STRICTDB_URI;

      await expect(connect()).rejects.toThrow('No database URI provided');

      process.env.STRICTDB_URI = originalEnv;
    });

    it('should return same instance on repeated calls with same URI', async () => {
      const db1 = await connect('mongodb://localhost:27017/test');
      const db2 = await connect('mongodb://localhost:27017/test');
      expect(db1).toBe(db2);
    });

    it('should throw when connecting with a different URI', async () => {
      await connect('mongodb://localhost:27017/test');
      await expect(connect('mongodb://localhost:27017/other')).rejects.toThrow(
        'Already connected to a different database',
      );
    });

    it('should allow reconnect after closePool()', async () => {
      await connect('mongodb://localhost:27017/test');
      await closePool();
      const db = await connect('mongodb://localhost:27017/other');
      expect(db).toBe(mockDb);
    });
  });

  describe('read operations', () => {
    beforeEach(async () => {
      await connect('mongodb://localhost:27017/test');
    });

    it('queryOne should delegate to StrictDB', async () => {
      await queryOne('users', { email: 'test@test.com' });
      expect(mockDb.queryOne).toHaveBeenCalledWith('users', { email: 'test@test.com' });
    });

    it('queryMany should delegate with options', async () => {
      await queryMany('users', { role: 'admin' }, { limit: 10, sort: { name: 1 } });
      expect(mockDb.queryMany).toHaveBeenCalledWith(
        'users',
        { role: 'admin' },
        { limit: 10, sort: { name: 1 } },
      );
    });

    it('queryWithLookup should delegate correctly', async () => {
      const options = {
        match: { _id: '123' },
        lookup: { from: 'orders', localField: '_id', foreignField: 'userId', as: 'orders' },
      };
      await queryWithLookup('users', options);
      expect(mockDb.queryWithLookup).toHaveBeenCalled();
    });

    it('count should delegate correctly', async () => {
      await count('users', { role: 'admin' });
      expect(mockDb.count).toHaveBeenCalledWith('users', { role: 'admin' });
    });

    it('count should default to empty filter', async () => {
      await count('users');
      expect(mockDb.count).toHaveBeenCalledWith('users', {});
    });
  });

  describe('write operations', () => {
    beforeEach(async () => {
      await connect('mongodb://localhost:27017/test');
    });

    it('insertOne should delegate correctly', async () => {
      await insertOne('users', { email: 'new@test.com' });
      expect(mockDb.insertOne).toHaveBeenCalledWith('users', { email: 'new@test.com' });
    });

    it('insertMany should delegate correctly', async () => {
      const docs = [{ email: 'a@test.com' }, { email: 'b@test.com' }];
      await insertMany('users', docs);
      expect(mockDb.insertMany).toHaveBeenCalledWith('users', docs);
    });

    it('updateOne should delegate with upsert', async () => {
      await updateOne('users', { _id: '1' }, { $set: { name: 'New' } }, true);
      expect(mockDb.updateOne).toHaveBeenCalledWith('users', { _id: '1' }, { $set: { name: 'New' } }, true);
    });

    it('updateMany should delegate correctly', async () => {
      await updateMany('users', { role: 'user' }, { $set: { active: true } });
      expect(mockDb.updateMany).toHaveBeenCalledWith('users', { role: 'user' }, { $set: { active: true } });
    });

    it('deleteOne should delegate correctly', async () => {
      await deleteOne('users', { _id: '1' });
      expect(mockDb.deleteOne).toHaveBeenCalledWith('users', { _id: '1' });
    });

    it('deleteMany should delegate correctly', async () => {
      await deleteMany('users', { expired: true });
      expect(mockDb.deleteMany).toHaveBeenCalledWith('users', { expired: true });
    });

    it('batch should delegate correctly', async () => {
      const ops = [
        { operation: 'insertOne' as const, collection: 'logs', doc: { msg: 'test' } },
      ];
      await batch(ops);
      expect(mockDb.batch).toHaveBeenCalledWith(ops);
    });

    it('bulkOps should be an alias for batch', () => {
      expect(bulkOps).toBe(batch);
    });
  });

  describe('AI-first discovery', () => {
    beforeEach(async () => {
      await connect('mongodb://localhost:27017/test');
    });

    it('describe should delegate correctly', async () => {
      await describeCollection('users');
      expect(mockDb.describe).toHaveBeenCalledWith('users');
    });

    it('validate should delegate correctly', async () => {
      await validate('users', { filter: { role: 'admin' } });
      expect(mockDb.validate).toHaveBeenCalledWith('users', { filter: { role: 'admin' } });
    });

    it('explain should delegate correctly', async () => {
      await explain('users', { filter: { role: 'admin' }, limit: 50 });
      expect(mockDb.explain).toHaveBeenCalledWith('users', { filter: { role: 'admin' }, limit: 50 });
    });
  });

  describe('schema registration', () => {
    it('should queue registrations before connect and flush on ensureIndexes', async () => {
      registerCollection({ name: 'users', schema: {} as never, indexes: [] });
      await connect('mongodb://localhost:27017/test');
      await ensureIndexes();
      expect(mockDb.registerCollection).toHaveBeenCalled();
      expect(mockDb.ensureIndexes).toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('closePool should close connection and clear singleton', async () => {
      await connect('mongodb://localhost:27017/test');
      await closePool();
      expect(mockDb.close).toHaveBeenCalled();
      // Should be able to reconnect after closing
      const db = await connect('mongodb://localhost:27017/test');
      expect(db).toBe(mockDb);
    });

    it('closePool should be safe to call without connection', async () => {
      await expect(closePool()).resolves.toBeUndefined();
    });

    it('gracefulShutdown should close pool and call exit', async () => {
      await connect('mongodb://localhost:27017/test');
      const mockExit = vi.fn();
      await gracefulShutdown(0, mockExit);
      expect(mockDb.close).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('gracefulShutdown should default to exit code 1 for non-number input', async () => {
      const mockExit = vi.fn();
      await gracefulShutdown('some error', mockExit);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('gracefulShutdown should be idempotent', async () => {
      const mockExit = vi.fn();
      await gracefulShutdown(0, mockExit);
      await gracefulShutdown(0, mockExit);
      expect(mockExit).toHaveBeenCalledTimes(1);
    });
  });
});
