---
name: ts-resilience
description: "Use when adding retry logic, timeouts, circuit breakers, or backoff strategies to TypeScript workflows using awaitly."
---

## Overview

Put resilience (retries, timeouts, circuit breakers) at the **workflow level** and keep it out of business functions, which return `Result` types. You apply it in the workflow with per-dep policies (`retry`, `timeout`) or `step.retry()` / `step.withTimeout()`, all imported from `awaitly`.

## Quick Reference

| Operation Type | Attempts | Backoff | Initial Delay | Timeout |
|----------------|----------|---------|---------------|---------|
| Database read  | 3        | exponential | 50ms      | 5s      |
| Database write | 1 (no retry) | -    | -             | 10s     |
| HTTP API call  | 3        | exponential | 100ms     | 30s     |
| Cache lookup   | 2        | fixed       | 10ms      | 500ms   |

## Retry with Exponential Backoff and Jitter

```typescript
import { createWorkflow } from 'awaitly';

const workflow = createWorkflow({ getUser });

const result = await workflow.run(async ({ step }) => {
  const data = await step.retry(
    'getUser',
    () => getUser({ userId }, deps),
    {
      attempts: 3,
      backoff: 'exponential',
      initialDelay: 100,
      maxDelay: 5000,
      jitter: true, // Default on; keep it on in production to prevent thundering herd
    }
  );
  return data;
});
```

Use `shouldRetry` (alias `retryIf`) to retry only transient errors:

```typescript
step.retry('fetchFromApi', () => fetchFromApi(), {
  attempts: 3,
  backoff: 'exponential',
  shouldRetry: (error) => ['TIMEOUT', 'CONNECTION_ERROR', 'RATE_LIMITED'].includes(error),
});
```

## Timeouts

```typescript
// Per-call timeout
const data = await step.withTimeout('slowOp', () => slowOp(), { ms: 2000 });

// With AbortSignal for fetch
const data = await step.withTimeout(
  'fetchData',
  (signal) => fetch('/api/data', { signal }),
  { ms: 5000, signal: true }
);

// Per-attempt timeout inside retry
const data = await step.retry('fetchData', () => fetchData(), {
  attempts: 3,
  timeout: { ms: 2000 }, // 2s per attempt, not total
});

// Global timeout wrapping retries
const data = await step.withTimeout(
  'fetchDataWithRetries',
  async () => ok(await step.retry('fetchData', () => fetchData(), { attempts: 3 })),
  { ms: 10000 }
);
```

## Per-dep Policies

When a dependency always needs the same policy, declare it once where you wire deps. Call sites stay plain:

```typescript
import { createWorkflow, retry, timeout } from 'awaitly';

const workflow = createWorkflow({
  getUser: retry(timeout(getUser, 2000), { attempts: 3, backoff: 'exponential' }), // timeout per attempt
});

const result = await workflow.run(async ({ steps }) => steps.getUser({ userId }, deps));
```

`timeout()` adds `TimeoutError` to the error union. Use `step.retry()` / `step.withTimeout()` for one-off call sites.

## Circuit Breakers

```typescript
import { createCircuitBreaker } from 'awaitly';

const apiBreaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,   // Open after 5 failures
  resetTimeout: 30000,    // Try again after 30s
  halfOpenMax: 3,         // Allow 3 test requests in half-open state
  windowSize: 60000,      // Failure counting window
});

const data = await step.try(
  'externalApi',
  () => apiBreaker.execute(() => fetchFromExternalApi()),
  { error: 'SERVICE_UNAVAILABLE' as const }
);
```

## Rules

1. **Retry at ONE level only**: the workflow level via per-dep `retry()` or `step.retry()`. Never add retry logic inside business functions or infrastructure clients. Double-retry across layers causes multiplicative attempts (3 x 3 x 3 = 27 requests) creating retry storms.
2. **Never blindly retry non-idempotent writes.** Use idempotency keys or an outbox pattern, or accept the failure.
3. **Keep jitter on** (`jitter: true`, the default) in production to spread retry timing across instances.
4. **Always set timeouts** on external calls. Never let operations hang indefinitely.
5. **Only retry transient errors** (TIMEOUT, CONNECTION_ERROR, RATE_LIMITED). Do not retry logic failures (NOT_FOUND, UNAUTHORIZED, VALIDATION_FAILED).
6. **Use circuit breakers** when a dependency fails repeatedly to fail fast and let the service recover.
