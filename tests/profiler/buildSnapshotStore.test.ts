import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openSnapshotStore, type SnapshotStore } from '../../src/profiler/core/buildSnapshotStore';
import type { BuildSnapshot } from '../../src/profiler/core/types';

const sampleSnap = (gameId: string, capturedAt: number): BuildSnapshot => ({
  gameId,
  buildId: null,
  capturedAt,
  engineKind: 'PixiJS',
  windowMs: 30_000,
  fps: { p50: 120, p95: 110, p99: 105, min: 100, max: 135 },
  frameTimeMs: { p50: 8, p95: 9, p99: 10, max: 12 },
  frameTimeBuckets: [0, 0, 100, 50, 0, 0, 0, 0, 0, 0, 0, 0],
  heapMB: { start: 8, end: 8.5, min: 7.9, max: 8.6 },
  scoreOverall: 91,
  scoreSmooth: 89,
  scoreMemory: 100,
  sampleCount: 1800,
});

describe('buildSnapshotStore', () => {
  let store: SnapshotStore;

  beforeEach(async () => {
    // Reset the fake-indexeddb between tests. Connections must be closed first
    // or `deleteDatabase` blocks indefinitely.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('pixitools-profiler');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    store = await openSnapshotStore();
  });

  afterEach(() => {
    store?.close();
  });

  it('put + getLast returns the most recent for a gameId', async () => {
    await store.put(sampleSnap('g1', 100));
    await store.put(sampleSnap('g1', 200));
    const got = await store.getLast('g1');
    expect(got?.capturedAt).toBe(200);
  });

  it('isolates between gameIds', async () => {
    await store.put(sampleSnap('g1', 100));
    await store.put(sampleSnap('g2', 200));
    const g1 = await store.getLast('g1');
    const g2 = await store.getLast('g2');
    expect(g1?.gameId).toBe('g1');
    expect(g2?.gameId).toBe('g2');
  });

  it('getLast returns null when no snapshots exist for that gameId', async () => {
    expect(await store.getLast('ghost')).toBeNull();
  });

  it('getRecent returns up to N newest-first', async () => {
    for (let i = 0; i < 5; i++) await store.put(sampleSnap('g1', i));
    const recent = await store.getRecent('g1', 3);
    expect(recent.map((s) => s.capturedAt)).toEqual([4, 3, 2]);
  });

  it('prune keeps only N most recent per gameId', async () => {
    for (let i = 0; i < 15; i++) await store.put(sampleSnap('g1', i));
    await store.prune('g1', 10);
    const recent = await store.getRecent('g1', 100);
    expect(recent.length).toBe(10);
    expect(recent[0].capturedAt).toBe(14);
    expect(recent[9].capturedAt).toBe(5);
  });

  it('prune does not affect other gameIds', async () => {
    await store.put(sampleSnap('g1', 100));
    for (let i = 0; i < 12; i++) await store.put(sampleSnap('g2', i));
    await store.prune('g2', 5);
    expect((await store.getRecent('g1', 100)).length).toBe(1);
    expect((await store.getRecent('g2', 100)).length).toBe(5);
  });
});
