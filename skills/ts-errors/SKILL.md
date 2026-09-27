---
name: ts-errors
description: "Use when implementing error handling with Result types, the awaitly library, TaggedError classes, or railway-oriented workflows."
---

## Overview

Return `Result<T, E>` instead of throwing. The type signature should tell callers what can succeed and what can fail. Use the `awaitly` library for Result utilities and workflow composition.

```typescript
import { ok, err, type Result, type AsyncResult } from 'awaitly';

// Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
// AsyncResult<T, E> = Promise<Result<T, E>>
```

## Quick Reference

### Results instead of throws

An operation that can fail returns `AsyncResult<T, E>`: either `ok(value)` or `err(error)`.

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

const divide = async (a: number, b: number): AsyncResult<number, 'DIVIDE_BY_ZERO'> =>
  b === 0 ? err('DIVIDE_BY_ZERO') : ok(a / b);

const result = await divide(10, 2);
if (result.ok) {
  result.value; // number
} else {
  result.error; // 'DIVIDE_BY_ZERO' -- the only possible error
}
```

The failure is in the return type, so the compiler sees it. With `catch (error: unknown)` you get an untyped value; `result.error` gives you the exact error union. Always narrow on `result.ok` first.

### Core function pattern

```typescript
async function getUser(
  args: { userId: string },
  deps: GetUserDeps
): AsyncResult<User, UserNotFound | DbError> {
  try {
    const user = await deps.db.findUser(args.userId);
    return user ? ok(user) : err(new UserNotFound({ userId: args.userId }));
  } catch {
    return err(new DbError({ operation: 'findUser' }));
  }
}
```

### run(deps, fn) -- default for multi-step flows

Pass your operations first. The callback gets an object with the same keys; each call returns the unwrapped value and exits early on `err`:

```typescript
import { run, ok, err, type AsyncResult } from 'awaitly';

const getUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
  id === '1' ? ok({ id: '1', name: 'Alice' }) : err('NOT_FOUND');

const getOrders = async (userId: string): AsyncResult<Order[], 'FETCH_ERROR'> =>
  ok([{ id: 1, total: 99.99 }]);

const result = await run({ getUser, getOrders }, async (s) => {
  const user = await s.getUser('1');          // User, not Result<User, ...>
  const orders = await s.getOrders(user.id);  // Order[]
  return { user, orders };
});
// result.error: 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError -- inferred
```

For fn(args, deps) functions, bind deps in the deps object: `run({ getUser: (userId: string) => getUser({ userId }, deps) }, ...)`. Plain functions that throw are valid deps; their throws become `UnexpectedError`.

Need per-step options (retry, timeout, cache key)? The classic step is the second argument, and it takes a string ID first:

```typescript
await run({ getUser }, async (s, { step }) => {
  const user = await step('getUser', () => getUser('1'), { key: 'user:1' });
});
```

Avoid `run(fn)` with no deps and no type params: `result.error` is typed as `UnexpectedError` only. Use `run(deps, fn)` or `run<T, E>(async ({ step }) => ...)`.

### createWorkflow() -- reusable flows with caching, resume, events

```typescript
import { createWorkflow } from 'awaitly';

const loadUserData = createWorkflow({ getUser, getOrders });

const result = await loadUserData.run(async ({ steps }) => {
  const user = await steps.getUser('1');
  return { user, orders: await steps.getOrders(user.id) };
});
```

Workflows are not callable: use `.run()`. Use `run(deps, fn)` for one-off flows, `createWorkflow()` when the flow is reusable or needs caching, resume, or events.

### step.try() -- bridge throwing code into Results

```typescript
const config = await step.try('parseConfig', () => JSON.parse(user.configJson), {
  error: 'INVALID_CONFIG' as const,
});
```

- `step('id', fn)` / `s.dep(...)` = functions returning `Result<T, E>` (your code)
- `step.try('id', fn, { error } | { onError })` = functions that throw (third-party/built-in code)

Outside workflows use `from()`, `fromPromise()`, or `tryAsync()`.

### TaggedError classes (recommended default)

```typescript
import { TaggedError } from 'awaitly';

class UserNotFound extends TaggedError("UserNotFound")<{ userId: string }> {}
class InsufficientFunds extends TaggedError("InsufficientFunds", {
  message: (p: { required: number; available: number }) =>
    `Need ${p.required}, have ${p.available}`,
})<{ required: number; available: number }> {}
```

Each class produces real `Error` instances with stack traces, a `_tag` for discrimination, and typed props.

### TaggedError.match() at boundaries

```typescript
if (!result.ok) {
  return TaggedError.match(result.error, {
    UserNotFound: (e) => json(404, { error: "User not found", userId: e.userId }),
    InsufficientFunds: (e) => json(400, { error: "Insufficient funds" }),
    DependencyFailed: (e) => e.retryable
      ? json(503, { retryAfter: 30 })
      : json(500, { error: "Internal error" }),
  });
}
```

The match is exhaustive: add a new error type and the compiler errors until you handle it.

### Error types progression

- **String literals** (`'NOT_FOUND' | 'DB_ERROR'`): simple, for small apps
- **Discriminated unions** (`{ type: 'NOT_FOUND'; resource: string }`): when errors carry data
- **TaggedError classes**: production default: stack traces + pattern matching + context

### Error grouping at scale

Namespace errors at boundaries. Keep detail internally for observability, collapse to categories at the HTTP/API layer:

```typescript
function collapseToHttp(error: DetailedError): HttpError {
  switch (error.type) {
    case 'NOT_FOUND': return { status: 404, message: 'Not found' };
    case 'INFRA_ERROR':
    case 'CIRCUIT_OPEN': return { status: 503, message: 'Unavailable' };
  }
}
```

## Rules

1. Business functions return Results. Make failure explicit in the type.
2. Use `run(deps, fn)` for multi-step flows; `createWorkflow(deps).run()` when reusable.
   Import everything from `'awaitly'` (sagas/durable machinery from `'awaitly/durable'`).
3. Use TaggedError for rich errors (stack traces, matching, context).
4. Use `step.try()` to bridge throwing code into Results.
5. Use `TaggedError.match()` at boundaries for exhaustive error-to-response mapping.
6. Throw only for impossible states (invariant violations, corrupted state).
