import { describe, expect, it } from 'vitest';
import { AsyncLoadGate } from './async-load-gate';

describe('AsyncLoadGate', () => {
  it('deduplicates concurrent reads and caches a successful load', async () => {
    const gate = new AsyncLoadGate();
    let calls = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const loader = async () => {
      calls += 1;
      await blocker;
    };

    const first = gate.run(loader);
    const second = gate.run(loader);
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);

    await gate.run(loader);
    expect(calls).toBe(1);
  });

  it('queues one refresh when data becomes stale during an in-flight load', async () => {
    const gate = new AsyncLoadGate();
    let calls = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const loader = async () => {
      calls += 1;
      if (calls === 1) await blocker;
    };

    const first = gate.run(loader);
    const refresh = gate.run(loader, true);
    expect(calls).toBe(1);
    release();
    await Promise.all([first, refresh]);
    expect(calls).toBe(2);
  });

  it('allows explicit refresh after the cached load', async () => {
    const gate = new AsyncLoadGate();
    let calls = 0;
    const loader = async () => { calls += 1; };

    await gate.run(loader);
    await gate.run(loader, true);
    expect(calls).toBe(2);
  });

  it('does not mark a failed load as cached', async () => {
    const gate = new AsyncLoadGate();
    let calls = 0;
    await expect(gate.run(async () => {
      calls += 1;
      throw new Error('failed');
    })).rejects.toThrow('failed');

    await gate.run(async () => { calls += 1; });
    expect(calls).toBe(2);
  });
});
