---
name: ts-workflows
description: "Use when orchestrating multi-step operations with the awaitly workflow and saga patterns, including parallel execution, batch processing, and human-in-the-loop approvals."
---

# Workflow Patterns (awaitly)

## createWorkflow -- Linear Composition

Pass Result-returning operations to `createWorkflow`, then call `.run()` (workflows are not callable). `steps.<dep>(...)` unwraps `ok` values and short-circuits on `err`. awaitly infers the error type as a union across all deps, plus `UnexpectedError` for thrown exceptions.

```typescript
import { createWorkflow } from 'awaitly';

const checkout = createWorkflow({ chargePayment, reserveInventory, createOrder });

const result = await checkout.run(async ({ steps }) => {
  const payment = await steps.chargePayment({ amount: 99, method: 'card_xxx' });
  const reservation = await steps.reserveInventory({ items: cartItems });
  return await steps.createOrder({ userId, payment, reservation });
});
// result.error is typed as union of all dep errors | UnexpectedError
```

Need per-step options (retry, timeout, cache key, compensate)? Use the classic step, string ID first: `async ({ step, deps }) => step('charge', () => deps.chargePayment(args), { key: 'charge:1' })`. For one-off flows, `run(deps, async (s) => ...)` from `awaitly` does the same without caching/resume.

## createSagaWorkflow -- Steps with Compensation

Compensation is a step option: `step('id', fn, { compensate })`. On failure, compensations run in reverse (LIFO). `createSagaWorkflow(name, deps)` is `createWorkflow` with `SagaCompensationError` added to the error union.

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/durable';

const saga = createSagaWorkflow('checkout', { chargePayment, refundPayment, reserveInventory, releaseInventory });

const result = await saga.run(async ({ step, deps }) => {
  const payment = await step('chargePayment', () => deps.chargePayment({ amount: 99, method: 'card_xxx' }), {
    compensate: (p) => deps.refundPayment({ paymentId: p.id }),
  });
  const reservation = await step('reserveInventory', () => deps.reserveInventory({ items }), {
    compensate: (r) => deps.releaseInventory({ reservationId: r.id }),
  });
  return { payment, reservation };
});

// result.error is the original failure; if a compensation itself failed:
if (!result.ok && isSagaCompensationError(result.error)) {
  // Alert ops -- result.error.compensationErrors lists failed cleanups
}
```

Read-only or idempotent-via-upsert steps can omit `compensate`.

## Parallel Execution

```typescript
import { allAsync, allSettledAsync, anyAsync } from 'awaitly';

// allAsync -- fail fast on first error (like Promise.all for Results)
const [profile, orders, recs] = await step('loadDashboard', () =>
  allAsync([deps.fetchProfile({ userId }), deps.fetchOrders({ userId }), deps.fetchRecs({ userId })])
);

// allSettledAsync -- collect ALL errors, ok only if all succeed
const result = await allSettledAsync([op1(), op2(), op3()]);

// anyAsync -- first success wins (failover pattern)
const result = await anyAsync([fetchFromPrimary(id), fetchFromBackup(id)]);
```

Sequential then parallel (dependency graph):

```typescript
const user = await steps.fetchUser({ userId });
const [posts, friends] = await step('loadSocial', () =>
  allAsync([deps.fetchPosts({ userId: user.id }), deps.fetchFriends({ userId: user.id })])
);
```

## processInBatches

```typescript
import { processInBatches, batchPresets } from 'awaitly';

await processInBatches(
  items,
  async (item, index) => { /* return AsyncResult */ },
  { batchSize: 100, concurrency: 10, batchDelayMs: 50 },  // or batchPresets.conservative / balanced / aggressive
  {
    onProgress: (p) => console.log(`${p.percent}%`),
    afterBatch: async () => { await db.checkpoint(); return ok(undefined); },
  }
);
```

Presets: `conservative` (20/3/50ms), `balanced` (50/5/10ms), `aggressive` (100/10/0ms). Use `isBatchProcessingError` to get `itemIndex` and `batchNumber` for resumption. Prefer cursor-based checkpoints over array indices.

## Human-in-the-Loop (Approval)

```typescript
import {
  createWorkflow, createApprovalStep, isPendingApproval, createResumeStateCollector,
  injectApproval, serializeResumeState, deserializeResumeState,
} from 'awaitly';

const approvalKey = `refund-approval:${refundId}`;
const approvalStep = createApprovalStep({
  key: approvalKey,
  checkApproval: async () => { /* return { status: 'pending' } | { status: 'approved', value } | { status: 'rejected', reason } */ },
});

const refundFlow = async ({ step, deps }) => {
  const refund = await step('calculateRefund', () => deps.calculateRefund({ orderId }));
  if (refund.amount > 1000) {
    await step('approval', approvalStep, { key: approvalKey });
  }
  return await step('processRefund', () => deps.processRefund({ refund }));
};

// Run -- pauses at approval
const collector = createResumeStateCollector();
const workflow = createWorkflow({ calculateRefund, processRefund }, { onEvent: collector.handleEvent });
const result = await workflow.run(refundFlow);

if (!result.ok && isPendingApproval(result.error)) {
  await db.save({ id: refundId, state: JSON.stringify(serializeResumeState(collector.getResumeState())) });
}

// Resume after approval
const state = deserializeResumeState(JSON.parse(saved.state));
const updated = injectApproval(state, { stepKey: approvalKey, value: { approvedBy: '...' } });
const resumed = await createWorkflow({ calculateRefund, processRefund }, { resumeState: updated }).run(refundFlow);
```

The approval step's `key` option must match the `stepKey` you inject.

## Idempotency Keys

Always use idempotency keys for side-effecting steps combined with retries. Without them, retries after timeouts cause double-application (e.g., double charges).

Put retry on the step itself, alongside `compensate`, so awaitly registers the compensation once for the successful attempt:

```typescript
await step('chargePayment', () => deps.charge({ amount, idempotencyKey: `order-${orderId}` }), {
  retry: { attempts: 3, backoff: 'exponential' },
  compensate: (p) => deps.refund({ paymentId: p.id }),
});
```

## Rules

1. Use `createWorkflow(deps).run()` for linear composition; `step(..., { compensate })` / `createSagaWorkflow` when steps need rollback.
2. Make all side-effecting steps idempotent. Use idempotency keys for financial operations.
3. Persist state (`collector.getResumeState()`) after each step in critical workflows.
4. Return minimal, JSON-serializable values from steps (IDs, not full objects or secrets).
5. Use `allAsync` for mandatory parallel data; `allSettledAsync` to collect all errors.
6. Use `processInBatches` with cursor-based checkpoints for large-scale processing.
7. Make compensations safe, idempotent, observable, and bounded by timeouts.
8. Test approval workflows by injecting approvals via `injectApproval` with `resumeState`.
9. Every `step` / `step.try` / `step.retry` takes a string ID first; import from `'awaitly'` (sagas from `'awaitly/durable'`).
