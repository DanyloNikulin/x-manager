const runningLoops = new Map<string, NodeJS.Timeout>();

export interface IntervalLoopLogger {
  info: (msg: string) => void;
}

export interface StartIntervalLoopOptions {
  key: string;
  intervalSeconds: number;
  run: () => Promise<void> | void;
  runOnStart?: boolean;
  unref?: boolean;
  onError?: (error: unknown) => void;
  logger?: IntervalLoopLogger;
}

export function isIntervalLoopRunning(key: string): boolean {
  return runningLoops.has(key);
}

export function stopIntervalLoop(key: string, logger?: IntervalLoopLogger): void {
  const timer = runningLoops.get(key);
  if (!timer) return;
  clearInterval(timer);
  runningLoops.delete(key);
  logger?.info(`Loop "${key}" stopped.`);
}

export function startIntervalLoop(options: StartIntervalLoopOptions): () => void {
  const {
    key,
    intervalSeconds,
    run,
    runOnStart = true,
    unref = false,
    onError,
    logger,
  } = options;
  const seconds = Math.max(1, Math.floor(intervalSeconds));

  if (runningLoops.has(key)) {
    logger?.info(`Loop "${key}" already active. Skipping duplicate start.`);
    return () => stopIntervalLoop(key, logger);
  }

  const invoke = () => {
    void Promise.resolve(run()).catch((error) => {
      onError?.(error);
    });
  };

  if (runOnStart) {
    invoke();
  }

  const timer = setInterval(invoke, seconds * 1000);
  if (unref && typeof timer.unref === 'function') {
    timer.unref();
  }

  runningLoops.set(key, timer);
  logger?.info(`Loop "${key}" started (${seconds}s interval).`);

  return () => stopIntervalLoop(key, logger);
}
