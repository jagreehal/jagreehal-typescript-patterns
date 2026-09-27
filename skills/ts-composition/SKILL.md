---
name: ts-composition
description: "Use when building extensible systems with uniform interfaces, fan-out broadcasting, and wrapper patterns instead of monolithic functions with growing conditionals."
---

## Core Idea

Replace do-everything functions (switch statements, option bags, nested conditionals) with small focused pieces that share a **uniform interface** and compose at startup. You change behaviour by adding pieces and leave existing code alone.

## Uniform Interface

Define a single type that every composable piece implements:

```typescript
type SendChannel = (args: { notification: Notification }) => Promise<void>;
```

All channels, wrappers, and arrays operate on this one shape. Any piece can replace another, and wrappers stack.

## Factory Functions (Bind Deps at Creation)

Each piece follows `fn(args, deps)` internally. A factory binds deps, returning the uniform interface:

```typescript
function createSendEmail(deps: { emailClient: EmailClient }): SendChannel {
  return async (args) => {
    await deps.emailClient.send({
      to: args.notification.email,
      subject: args.notification.subject,
      body: args.notification.body,
    });
  };
}
```

The caller only sees `SendChannel`; it never knows what dependencies are inside.

## Fan-Out Pattern

Broadcast to multiple destinations via an array. Adding a destination takes one line and changes no existing code:

```typescript
const channels: SendChannel[] = [sendEmail, sendSms, sendAudit];

// All-or-nothing (fail fast on first rejection)
await Promise.all(channels.map(ch => ch(args)));

// Best-effort (collect errors, continue)
const results = await Promise.allSettled(channels.map(ch => ch(args)));
const errors = results.filter(r => r.status === 'rejected');
```

Decide failure semantics (all-or-nothing vs best-effort) where you compose channels. Individual channels stay unaware of them.

## Wrapper Pattern (Add Behavior Without Modifying)

Wrappers take a `SendChannel` and return a new `SendChannel`. They stack because they preserve the interface.

```typescript
function withRetry(channel: SendChannel, attempts = 3): SendChannel {
  return async (args) => {
    for (let i = 0; i < attempts; i++) {
      try { await channel(args); return; }
      catch (e) { if (i === attempts - 1) throw e; await sleep(1000 * 2 ** i); }
    }
  };
}

function withLogging(logger: Logger, name: string) {
  return (channel: SendChannel): SendChannel => async (args) => {
    logger.info(`[${name}] Sending ${args.notification.id}`);
    try { await channel(args); logger.info(`[${name}] Sent ${args.notification.id}`); }
    catch (e) { logger.error(`[${name}] Failed ${args.notification.id}`, e); throw e; }
  };
}
```

Compose wrappers per channel:

```typescript
const channels: SendChannel[] = [
  withLogging(logger, 'email')(withRetry(sendEmail, 3)),
  withRetry(sendSms, 2),
  withLogging(logger, 'audit')(sendAudit),
];
```

## Compose at Startup (Composition Root)

Wire everything in `main.ts`. Service factories receive deps; business logic never knows how pieces are assembled:

```typescript
const notificationService = createNotificationService({
  emailClient, smsClient, auditDb, logger,
});
// notificationService.notify({ notification }) fans out to all channels
```

## Rules

1. **Build small, focused pieces.** One function, one job. `createSendEmail` sends email. `withRetry` adds retry. Never combine them.
2. **Use uniform interfaces.** Everything implements `SendChannel`. Arrays, wrappers, and conditionals all work interchangeably.
3. **Wrap, don't embed.** Add retry or logging with a wrapper and leave the original function untouched.
4. **Compose at startup.** Wire pieces in the composition root. Business logic does not know how pieces are composed.

## SOLID Alignment

- **Open/Closed**: You add a channel by writing a factory and appending it to the array. `notify` never changes.
- **Single Responsibility**: Each piece has one reason to change. Retry logic changes in `withRetry`, not in every channel.
- **Dependency Inversion**: `notify` depends on `SendChannel`, not on concrete clients. Policy and details both depend on the abstraction.
- **Liskov Substitution**: Any `SendChannel` replaces another. Wrappers preserve the contract, so they stack freely.
