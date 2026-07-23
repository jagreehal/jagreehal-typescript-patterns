---
title: Resilience Patterns
description: Add retries, timeouts, and circuit breakers to handle transient failures without cluttering your business logic.
---

*Previously: [Point-in-Time Capture](..//point-in-time-capture). We keep a durable record of every decision. Records don't prevent failures, and some are temporary.*

---

Your database connection drops for a second. Your HTTP client times out. An external service hiccups during deployment.

These failures are transient. Wait a moment, try again, and the call goes through. Right now your functions fail on the first error: the user sees an error page and the operation fails.

It's 3pm on Tuesday. Your payment provider has a 2-second outage that happens once a month and lasts seconds. Every checkout in that window fails. Users see "Payment failed," your support queue fills up, and your Slack channel lights up. By the time you check, the provider is back. The incident lasted 2 seconds but generated 50 support tickets.

Should you add retry logic?

---

## The Wrong Place (Again)

The instinct is to add retries inside the business function:

```typescript
async function getUser(args: { userId: string }, deps: GetUserDeps) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const user = await deps.db.findUser(args.userId);
      return user ? ok(user) : err('NOT_FOUND');
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        return err('DB_ERROR');
      }
      await sleep(100 * Math.pow(2, attempts)); // Exponential backoff
    }
  }
}
```

Half of your clean function is now retry logic. The business logic, find the user and return it, is buried.

You'd repeat this for every function that touches infrastructure, then add timeouts and circuit breakers on top. The functions become unreadable.

Where does resilience belong?

---

## Resilience at the Workflow Level

Remember the architecture: validation at the boundary, explicit error handling, orthogonal tracing.

Resilience follows the same principle: it's a composition concern that belongs at the workflow level.

```mermaid
graph TD
    A[Workflows<br/>createWorkflow<br/>step.retry and step.withTimeout<br/>resilience here] --> B[Business Functions<br/>fn args, deps: Result<br/>no retry logic here]
    B --> C[Infrastructure<br/>pg, redis, http<br/>just transport]
    
    style A fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style B fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style C fill:#94a3b8,stroke:#0f172a,stroke-width:2px,color:#0f172a
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
```

You add resilience at the workflow level. Your business functions stay clean: they return Results, and the workflow handles retries and timeouts.

---

## Resilience in Workflows

Retry and timeout are built into `awaitly`. Use them at the workflow level:

```typescript
import { createWorkflow } from 'awaitly/workflow';

const loadUserData = createWorkflow({ getUser, getPosts });

const result = await loadUserData(async (step) => {
  // Retry with exponential backoff
  const user = await step.retry(
    () => getUser({ userId }, deps),
    {
      attempts: 3,
      backoff: 'exponential',
      initialDelay: 100,
      maxDelay: 5000,
      jitter: true,
    }
  );

  // Timeout protection
  const posts = await step.withTimeout(
    () => getPosts({ userId: user.id }, deps),
    { ms: 2000 }
  );

  return { user, posts };
});
```

Now your business functions stay clean:

```typescript
async function getUser(args: { userId: string }, deps: { db: Database }) {
  const user = await deps.db.findUser(args.userId);
  return user ? ok(user) : err('NOT_FOUND');
}
```

They don't know about retries or timeouts. The workflow handles resilience.

---

## Why Workflow-Level Retry?

### 1. Business Functions Stay Clean

They do one thing: business logic. The workflow handles resilience.

### 2. Consistent Policy

Every call in a workflow can use the same retry policy. No "some code paths retry, some don't" drift.

### 3. No Double Retry

If you retry at both workflow and function levels, you get multiplicative attempts:

```typescript
// BAD: 3 × 3 = 9 attempts!
const user = await step.retry(
  () => getUserWithRetry(args, deps),  // Already retries internally
  { attempts: 3 }
);
```

By keeping retry at the workflow level, you avoid this explosion.

**The Blast Radius Problem:** Without centralized retry policy, a minor blip in a downstream service can become a self-inflicted DDoS. If every layer retries 3×, and you have 3 layers, a single failure becomes 27 requests. Multiply by 100 concurrent users and you've created a retry storm that prevents the failing service from recovering.

You add retries to make things more reliable. The database has a brief hiccup, your retries kick in at every layer for every user, and the database, already struggling, receives 27× the normal load. Instead of recovering, it crashes harder. Your retries made the outage worse.

```mermaid
graph TD
    A[User Request] -->|retries 3x| B[API Handler]
    B -->|retries 3x| C[Service Layer<br/>3 × 3 = 9 attempts already]
    C -->|retries 3x| D[Database Client<br/>3 × 3 × 3 = 27 attempts!]
    D --> E[Database<br/>already struggling]
    E --> F[Result: You DDoS your own infrastructure]
    
    style A fill:#f8fafc,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style B fill:#cbd5e1,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style C fill:#94a3b8,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style D fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style E fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style F fill:#1e293b,stroke:#0f172a,stroke-width:2px,color:#fff
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
    linkStyle 2 stroke:#0f172a,stroke-width:3px
    linkStyle 3 stroke:#0f172a,stroke-width:3px
    linkStyle 4 stroke:#0f172a,stroke-width:3px
```

**Solution:** Retry at ONE level only: the workflow level. Business functions and infrastructure clients should not retry internally.

> **Note:** This includes composition-level `withRetry` wrappers (see [Wrapping](..//composition#wrapping-add-behavior-without-modifying)). If you use `step.retry()` in workflows, don't also wrap channels with `withRetry`. Pick one layer for retry policy.

---

## What About Non-Idempotent Operations?

You noticed the example didn't retry writes:

```typescript
saveUser: (user) => rawDb.saveUser(user),  // No retry
```

**Never retry non-idempotent operations by default.** A retry might:
- Double-charge a credit card
- Create duplicate records
- Send multiple emails

A customer complains: "I was charged twice for the same order." You check the logs. The payment succeeded on the first attempt, but the database write timed out before the response reached your server. Your retry logic read that as a failure and charged the card again. The customer paid $200 instead of $100, and you have two orders in the system for the same thing.

For writes, either:

1. Don't retry (accept the failure)
2. Use idempotency keys (so retries are safe)
3. Use an outbox pattern (guaranteed delivery)

---

## Which Errors Should You Retry?

Not all errors are retryable. Some are permanent failures where retrying won't help.

| Error Type | Retry? | Why |
| ---------- | ------ | --- |
| `TIMEOUT` | ✓ Yes | Transient, might succeed next time |
| `CONNECTION_ERROR` | ✓ Yes | Network hiccup, likely temporary |
| `RATE_LIMITED` | ✓ Yes | Wait and try again (respect backoff) |
| `NOT_FOUND` | ✗ No | Resource doesn't exist, won't appear |
| `UNAUTHORIZED` | ✗ No | Credentials are wrong, retrying is pointless |
| `VALIDATION_FAILED` | ✗ No | Input is invalid, fix the input |
| `FATAL` | ✗ No | Unrecoverable, stop trying |

Use the `retryOn` predicate to control this:

```typescript
const data = await step.retry(
  () => fetchFromApi(),
  {
    attempts: 3,
    backoff: 'exponential',
    retryOn: (error) => {
      // Only retry transient errors
      const retryable = ['TIMEOUT', 'CONNECTION_ERROR', 'RATE_LIMITED'];
      return retryable.includes(error);
    },
  }
);
```

Now permanent failures fail fast instead of wasting time on doomed retries.

**Rule of thumb:** Retry infrastructure failures (network, timeout). Don't retry logic failures (not found, validation, auth).

---

## Timeouts

Every external call should have a timeout. Don't let one slow dependency hang your entire request:

```typescript
const result = await workflow(async (step) => {
  // Timeout after 2 seconds
  const data = await step.withTimeout(
    () => slowOperation(),
    { ms: 2000, name: 'slow-op' }
  );

  return data;
});
```

If the call takes longer than 2 seconds, the workflow aborts it.

With AbortSignal for cancellable operations:

```typescript
const data = await step.withTimeout(
  (signal) => fetch('/api/data', { signal }),
  { ms: 5000, signal: true }  // pass signal to operation
);
```

---

## Combining Retry and Timeout

Combine retry and timeout so each attempt gets its own timeout:

```typescript
const result = await workflow(async (step) => {
  // Retry up to 3 times, with 2s timeout per attempt
  const data = await step.retry(
    () => fetchData(),
    {
      attempts: 3,
      timeout: { ms: 2000 },  // 2s timeout per attempt
    }
  );

  return data;
});
```

This ensures that:

- Each retry attempt has a 2-second deadline
- If all 3 attempts timeout, the workflow fails
- The total time is bounded (3 attempts × 2s = 6s max)

**Important:** The timeout applies per attempt, not to the entire retry block. If you need a global timeout for the whole operation, wrap everything in `step.withTimeout()`:

```typescript
// Global timeout: entire operation must complete in 10s
const data = await step.withTimeout(
  async () => {
    return step.retry(() => fetchData(), { attempts: 3 });
  },
  { ms: 10000 }
);
```

---

## Connecting to Tracing

The workflow library records resilience events in your traces when you use OpenTelemetry. It emits events for:

- `step_retry` - When a step is retried
- `step_timeout` - When a step times out
- `step_retries_exhausted` - When all retry attempts are exhausted

Your traces show more than "this call failed." They show "this call failed, retried 3 times, then succeeded."

### Recommended Defaults

Use these as starting points and tune based on your SLOs:

| Operation Type | Attempts | Backoff | Initial Delay | Timeout |
| -------------- | -------- | ------- | ------------- | ------- |
| Database read | 3 | exponential | 50ms | 5s |
| Database write | 1 | -| -| 10s |
| HTTP API call | 3 | exponential | 100ms | 30s |
| Cache lookup | 2 | fixed | 10ms | 500ms |
| File I/O | 2 | linear | 100ms | 5s |

**Notes:**

- Writes default to 1 attempt (no retry) unless you have idempotency keys
- Set timeouts so no operation hangs
- Always use jitter for distributed systems (see below)

### Why Jitter Matters

Without jitter, all your service instances retry at the exact same moment. This creates a **thundering herd** that can overwhelm a recovering system:

```text
Without jitter:
  Instance A: retry at 100ms, 200ms, 400ms
  Instance B: retry at 100ms, 200ms, 400ms  ← Same times!
  Instance C: retry at 100ms, 200ms, 400ms  ← Thundering herd

With jitter:
  Instance A: retry at 87ms, 215ms, 380ms
  Instance B: retry at 112ms, 189ms, 420ms  ← Spread out
  Instance C: retry at 95ms, 208ms, 395ms   ← Infrastructure can recover
```

Always enable jitter in production:

```typescript
step.retry(() => fetchData(), {
  attempts: 3,
  backoff: 'exponential',
  jitter: true,  // Randomizes wait times
});
```

### When Retries Aren't Enough: Circuit Breakers

If a dependency fails repeatedly, retries can make things worse. While the service is down, you're still sending requests (wasting resources) and delaying responses to users.

**Circuit breakers** stop the bleeding. After N consecutive failures, the circuit "opens" and rejects requests for a cooldown period. This:

- Gives the failing service time to recover
- Returns fast errors instead of slow timeouts
- Prevents retry storms from cascading

`awaitly` includes `createCircuitBreaker` for protecting dependencies:

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/reliability';

// Create a circuit breaker
const apiBreaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 30000,       // Try again after 30 seconds
  halfOpenMax: 3,           // Allow 3 test requests in half-open state
  windowSize: 60000,        // Count failures within this window
});

const result = await workflow(async (step) => {
  // Wrap the step call with the circuit breaker
  // If circuit is open, execute() throws CircuitOpenError which step.try() catches
  const data = await step.try(
    () => apiBreaker.execute(() => fetchFromExternalApi()),
    { error: 'SERVICE_UNAVAILABLE' as const }
  );

  return data;
});
```

The circuit breaker tracks failures and opens when they cross the threshold, preventing cascading failures. When the circuit is open, calls fail fast instead of waiting for timeouts. After the reset timeout, the circuit transitions to HALF_OPEN to test whether the service recovered.

You can also access timeout metadata:

```typescript
import { isStepTimeoutError, getStepTimeoutMeta } from 'awaitly/workflow';

if (!result.ok && isStepTimeoutError(result.error)) {
  const meta = getStepTimeoutMeta(result.error);
  console.log(`Timed out after ${meta?.timeoutMs}ms on attempt ${meta?.attempt}`);
}
```

---

## Retrying Multi-Step Operations

Sometimes you need to retry a multi-step operation. Use `step.retry()` to wrap the entire sequence:

```typescript
const syncUserToProvider = createWorkflow({ findUser, syncUser, markSynced });

const result = await syncUserToProvider(async (step) => {
  // Retry the whole operation
  const user = await step.retry(
    async () => {
      const user = await step(() => findUser({ userId }, deps));
      await step(() => syncUser({ user }, deps));  // Must be idempotent!
      await step(() => markSynced({ userId }, deps));
      return user;
    },
    {
      attempts: 2,
      backoff: 'exponential',
    }
  );

  return user;
});
```

**Only do this when:**
- The operation is idempotent
- Or protected by an idempotency key / outbox
- You've explicitly designed the retry budget

---

## The Rules

| Failure Type | Where to Retry |
|--------------|----------------|
| Transport/network (transient) | Workflow level with `step.retry()` |
| Idempotent reads | Workflow level with `step.retry()` |
| Non-idempotent writes | Never (or with idempotency key) |
| Multi-step operation | Workflow level (if idempotent) |

**Default:** Retry at the workflow level using `step.retry()`.

**Exception:** Retry operations only when idempotent and designed for it.

**Never:** Double-retry at multiple layers without explicit budget.

---

## Full Example

```typescript
import { createWorkflow } from 'awaitly/workflow';

// Core function stays clean
async function getUser(
  args: { userId: string },
  deps: { db: Database }
): AsyncResult<User, 'NOT_FOUND' | 'DB_ERROR'> {
  try {
    const user = await deps.db.findUser(args.userId);
    return user ? ok(user) : err('NOT_FOUND');
  } catch {
    return err('DB_ERROR');
  }
}

// Workflow adds resilience
const loadUser = createWorkflow({ getUser });

const result = await loadUser(async (step) => {
  // Retry with exponential backoff and timeout
  const user = await step.retry(
    () => getUser({ userId }, deps),
    {
      attempts: 3,
      backoff: 'exponential',
      initialDelay: 100,
      maxDelay: 2000,
      timeout: { ms: 5000 },  // 5s timeout per attempt
    }
  );

  return user;
});
```

The business function `getUser` knows nothing about retries or timeouts. It returns a Result. The workflow handles resilience at the composition level.

---

## The Big Picture

We've built a complete architecture:

```mermaid
graph TD
    A[HTTP Handler<br/>validate input Zod<br/>call workflow, map Result to HTTP] --> B[Workflows<br/>createWorkflow<br/>step.retry and step.withTimeout<br/>resilience at composition level]
    B --> C[Business Functions<br/>fn args, deps: Result<br/>wrapped with trace<br/>clean, focused, explicit]
    C --> D[Infrastructure<br/>postgres, redis, http<br/>just transport]
    
    style A fill:#475569,stroke:#0f172a,stroke-width:2px,color:#fff
    style B fill:#64748b,stroke:#0f172a,stroke-width:2px,color:#fff
    style C fill:#94a3b8,stroke:#0f172a,stroke-width:2px,color:#0f172a
    style D fill:#cbd5e1,stroke:#0f172a,stroke-width:2px,color:#0f172a
    
    linkStyle 0 stroke:#0f172a,stroke-width:3px
    linkStyle 1 stroke:#0f172a,stroke-width:3px
    linkStyle 2 stroke:#0f172a,stroke-width:3px
```

Each layer has a single responsibility:
- **Handlers:** validation and HTTP mapping
- **Workflows:** composition with resilience (retry, timeout)
- **Business functions:** business logic with explicit deps and error types
- **Infrastructure:** transport only

---

## What's Next

We've handled runtime concerns: functions, validation, errors, observability, resilience. But there's one more boundary: how your application starts.

Environment variables are strings. They might be missing or invalid. Where do you validate and type them?

---

*Next: [Configuration at the Boundary](..//configuration). Validate environment variables at startup.*

