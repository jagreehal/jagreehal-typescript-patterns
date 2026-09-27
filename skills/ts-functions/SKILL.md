---
name: ts-functions
description: "Use when creating or refactoring TypeScript functions to follow the fn(args, deps) pattern with explicit dependency injection, replacing classes with composable, testable functions."
---

## Core Pattern

Every business logic function follows the signature:

```typescript
fn(args, deps)
```

- **args**: per-call data (userId, input payload). Object type defined explicitly.
- **deps**: injected collaborators (db, logger, mailer). Object type defined explicitly.

Two parameters, not one merged object. They have different lifetimes: args vary per call, deps are long-lived. Don't add a third `opts` parameter; options belong in either args (per-call) or deps (per-app).

## Per-Function Deps Types

Each function declares only the dependencies it uses. No god objects.

```typescript
type GetUserArgs = { userId: string };
type GetUserDeps = { db: Database; logger: Logger };

async function getUser(args: GetUserArgs, deps: GetUserDeps): Promise<User | null> {
  deps.logger.info(`Getting user ${args.userId}`);
  return deps.db.findUser(args.userId);
}
```

## Contract-First Types

Define Args and Deps types **before** the function. The function conforms to the contract, not the other way around.

Never derive Args/Deps from the function:

```typescript
// WRONG
type GetUserArgs = Parameters<typeof getUser>[0];

// RIGHT
type GetUserArgs = { userId: string };
```

## Return Type Exports: XReturn vs XResult

- **XReturn** (derived): for internal helpers. `type GetUserReturn = Awaited<ReturnType<typeof getUser>>;`
- **XResult** (explicit): for boundary/public APIs. Prevents accidental leakage of infra types.

```typescript
// Internal helper -- derive
export type GetUserReturn = Awaited<ReturnType<typeof getUser>>;

// Boundary API -- define explicitly
export type SendWelcomeEmailResult = { messageId: string; sentAt: string };
export async function sendWelcomeEmail(
  args: SendWelcomeEmailArgs,
  deps: SendWelcomeEmailDeps,
): Promise<SendWelcomeEmailResult> { /* ... */ }
```

Map infra shapes to domain types at boundaries to prevent DB row leakage.

## Factory Functions and Composition Root

Wire deps once at the boundary using a factory:

```typescript
// user-service/index.ts
export function createUserService({ deps }: { deps: UserServiceDeps }) {
  return {
    getUser: ({ userId }: { userId: string }) => getUser({ userId }, deps),
    createUser: ({ name, email }: { name: string; email: string }) =>
      createUser({ name, email }, deps),
  };
}
export type UserService = ReturnType<typeof createUserService>;
```

The **Composition Root** (main.ts / server.ts) is the only place that knows all dependencies:

```typescript
const db = createDb(process.env.DATABASE_URL);
const logger = createLogger({ level: 'info' });
const userService = createUserService({ deps: { db, logger } });
```

## Partial Application

Keep the core function as `fn(args, deps)`. Bind deps at the boundary for ergonomic call sites:

```typescript
export const notifyViaSlack = (deps: NotifyDeps) => (args: NotifyArgs) =>
  notify(args, deps);
```

Tests hit the core function directly; app code uses the wired version.

## Rules

1. **Per-function deps.** Each function declares exactly what it needs.
2. **Contract-first inputs.** Define Args and Deps types explicitly before the function. Never use `Parameters<typeof fn>`.
3. **Inject what you'd mock.** Inject infra (db, logger, mailer). Import pure utilities directly (lodash, slugify, crypto).
4. **Trust validated input.** Core functions don't re-validate. Validation belongs at the boundary.
5. **Factory at the boundary.** Wire deps once, expose a clean API.
6. **No classes for business logic.** Classes are fine for thin infra wrappers or framework requirements only.

## Migration (3 Phases)

1. **Phase 1**: Add `deps` parameter with defaults from existing imports. Backwards compatible.
2. **Phase 2**: Remove defaults. All deps injected explicitly. Use `import type` for infra.
3. **Phase 3**: Convert positional args to an `Args` object. Full `fn(args, deps)` shape.

Enforce with `verbatimModuleSyntax` in tsconfig and `no-restricted-imports` ESLint rule blocking `**/infra/**` in domain code.
