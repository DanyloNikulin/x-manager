import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIntervalLoopRunning, startIntervalLoop, stopIntervalLoop } from '@/lib/interval-loop';

afterEach(() => {
  stopIntervalLoop('test-loop');
  vi.useRealTimers();
});

describe('interval-loop', () => {
  it('runs immediately when requested and then on the interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);

    startIntervalLoop({
      key: 'test-loop',
      intervalSeconds: 5,
      run,
      runOnStart: true,
    });

    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(isIntervalLoopRunning('test-loop')).toBe(true);
  });

  it('does not start a second loop with the same key', () => {
    const run = vi.fn().mockResolvedValue(undefined);
    startIntervalLoop({ key: 'test-loop', intervalSeconds: 30, run, runOnStart: false });
    startIntervalLoop({ key: 'test-loop', intervalSeconds: 30, run, runOnStart: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('routes cycle failures to onError', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    startIntervalLoop({
      key: 'test-loop',
      intervalSeconds: 2,
      runOnStart: true,
      run: async () => {
        throw new Error('boom');
      },
      onError,
    });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
