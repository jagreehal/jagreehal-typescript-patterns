---
name: ts-opentelemetry
description: "Use when adding observability with OpenTelemetry tracing and structured logging using autotel, Pino, and canonical log lines."
---

## Overview

Add observability with the `trace()` wrapper from `autotel`, which creates OpenTelemetry spans around functions and leaves business logic untouched. Log with Pino and redaction. Correlate logs and traces through traceId/spanId, and emit one canonical log line (wide event) per request.

## Quick Setup

```typescript
import { init, trace, track, type TraceContext } from 'autotel';

init({
  service: 'my-service',
  endpoint: process.env.OTEL_ENDPOINT,
  debug: true, // console output in dev
});
```

## trace() Wrapper Pattern

Wrap functions with `trace()` to create spans automatically. The function signature `(args, deps) => Result<T, E>` stays unchanged.

```typescript
const myFunction = trace(
  (ctx: TraceContext) => async (args: MyArgs, deps: MyDeps) => {
    ctx.setAttribute('user.id', args.userId);

    const result = await doWork(args, deps);

    ctx.setStatus({ code: result.ok ? 1 : 2 });
    return result;
  }
);
```

- `ctx` is separate from deps, so span context stays out of business dependencies
- Nested traced functions create child spans automatically (no manual context propagation)
- Tests are unchanged: when tracing is disabled, `trace()` is a no-op wrapper
- Map `Result.ok` to span status code 1 (OK), `Result.err` to code 2 (ERROR)

## awaitly Workflows

awaitly opens its own spans for `run()`, `workflow.run()`, every `step()`, every retry attempt, and every `step.all`/`step.race` scope. `init()` registers the provider those spans write to, so you add nothing else.

Skip `trace()` on a workflow callback or a step function. awaitly already opened that span, and the wrapper reports the same call twice.

```typescript
// Wrong: two spans for one call
const charge = trace((ctx) => async (args: ChargeArgs, deps: Deps) => deps.charge(args));
await step('charge', () => charge(args, deps));

// Right: the step names the span
await step('charge', () => deps.charge(args));
```

Keep `trace()` for the functions no step calls: route handlers, cron entry points, service functions that run outside a workflow. Inside a step body, open a child span with `tracer.startActiveSpan()` when you want detail below the step.

## Structured Logging with Pino

Always use JSON fields, never string interpolation.

```typescript
import pino from 'pino';

const logger = pino({
  redact: ['password', 'apiKey', 'token', '*.secret', 'user.email'],
});

// Correct: structured
logger.info({ userId: args.userId, action: 'getUser' }, 'getUser called');

// Wrong: unstructured
logger.info(`getUser called with userId=${args.userId}`);
```

## Redaction

Redact sensitive data in both logs (Pino redact paths) and span attributes (global attribute filter).

```typescript
const SENSITIVE_KEYS = ['password', 'token', 'apiKey', 'secret', 'authorization'];

function sanitizeAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => {
      const isSensitive = SENSITIVE_KEYS.some(k =>
        key.toLowerCase().includes(k.toLowerCase())
      );
      return [key, isSensitive ? '[REDACTED]' : value];
    })
  );
}

init({ service: 'my-service', attributeFilter: sanitizeAttributes });
```

## Log-to-Trace Correlation

Include `traceId` and `spanId` in every log message so you can jump from traces to logs.

```typescript
import { context, trace } from '@opentelemetry/api';

const span = trace.getSpan(context.active());
const spanContext = span?.spanContext();
logger.info({ ...obj, traceId: spanContext?.traceId, spanId: spanContext?.spanId }, msg);
```

## Canonical Log Lines (Wide Events)

Emit one comprehensive log per request at span end with all accumulated context. Shape it for the queries you will run later.

```typescript
init({
  service: 'checkout-api',
  logger,
  canonicalLogLines: {
    enabled: true,
    rootSpansOnly: true, // one log per request
    logger,
  },
});
```

Accumulate context throughout the request with `ctx.setAttributes()`. Use flat dot-notation keys (`user.id`, `cart.total_cents`) and high-cardinality fields for precise queries.

## Semantic Conventions

Use OpenTelemetry standard attribute names for automatic backend correlation.

| Use | Instead Of |
|-----|-----------|
| `user.id` | `userId`, `user_id` |
| `http.method` | `method`, `httpMethod` |
| `db.system` | `database`, `dbType` |
| `error.type` | `errorCode` |

Custom business attributes follow `{domain}.{attribute}` convention (e.g., `order.item_count`).

## Rules

1. Use structured logging: JSON fields via Pino, never string interpolation.
2. Wrap with `trace()`: observability is orthogonal to business logic (Observer pattern).
3. Use semantic conventions: standard attribute names enable automatic backend correlation.
4. Correlate logs and traces: include `traceId` and `spanId` in every log message.
5. Emit canonical log lines: one wide event per request with all context.
6. Map Result to span status: `ok` = code 1, `err` = code 2.
7. Redact sensitive data in both Pino logs and span attributes.
8. Tests don't change: `trace()` is transparent when tracing is disabled.
9. Leave awaitly alone: `run()` and `step()` open their own spans, so `trace()` on either duplicates them.
