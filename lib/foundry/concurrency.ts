export const MAX_CONCURRENT_WORKERS = Number(process.env.FOUNDRY_MAX_CONCURRENT_WORKERS ?? 2);

type Waiter = {
  resolve: () => void;
};

let active = 0;
const waiters: Waiter[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_WORKERS) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push({ resolve });
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    next.resolve();
  } else {
    active -= 1;
  }
}

export async function withWorkerSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export function workerQueueDepth(): number {
  return waiters.length;
}
